import { useCallback, useEffect, useRef, useState } from 'react'
import { libraryApi, type MaterialItem } from '../api/client'

/* ============================================================
   文档应用内预览浮层（教材/视频页点开 doc 类资料时用）
   - pdf  → **单页翻阅模式**（服务端已按页切片时）：
              一次只下载一页（首屏 ~40KB，中位页 ~340KB），左右翻页 / 页码跳转，
              相邻页后台预取。批量 148 页的文件不用再整份下载。
            **整份模式**（未切片 / 切片失败时自动回落）：
              pdf.js 走 HTTP Range 按需取 + 视口内才渲染 + 小说式分批建页。
   - docx → docx-preview 渲染成 DOM（样式接近 Word，可翻页滚动）
   - xlsx/xls/csv → SheetJS 解析成 HTML 表格（多工作表时顶部可切换）
   - txt  → 纯文本直接显示
   - doc/ppt/pptx 等前端渲染不了的格式 → **服务端转成 PDF**（后端 modules/office_view.py）：
              先轮询 /library/{id}/preview 等转换完成（首次约 1 分钟，之后秒开），
              转好后同样走上面的「单页翻阅」；转换失败给「本地打开」兜底。
   - 库都走动态 import（import()），不拖累首屏包体积
   - 修改注意：颜色一律用 var(--token)；预览内容区统一白底黑字（文档内容与主题无关）
   - 跨端同步：CONVERT_EXTS 必须与后端 modules/office_view.py 的 NEEDS_CONVERT 一致
   ============================================================ */

type DocStatus =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  /** 服务端转 PDF 中（doc/ppt/pptx 首次打开时；40MB 的课件约 1 分钟） */
  | { phase: 'converting'; message: string; waited: number }
  /** 单页翻阅模式（服务端切片可用）：page = 当前第几页（1 起） */
  | { phase: 'pdf-paged'; numPages: number; page: number }
  /** 整份模式（回落）：pdf.js 持有整个文档对象，按需分段取 */
  | { phase: 'pdf'; numPages: number }
  | { phase: 'docx' }
  | { phase: 'sheet'; sheets: { name: string; html: string }[] }
  /** 纯文本（.txt）：直接把内容贴进 <pre>，不引入任何库 */
  | { phase: 'text'; content: string }

/** 需要服务端先转成 PDF 才能预览的格式
 *  （与后端 modules/office_view.py 的 NEEDS_CONVERT 保持一致） */
const CONVERT_EXTS = new Set([
  'doc', 'docm', 'dot', 'dotx',
  'ppt', 'pptx', 'pps', 'ppsx', 'pptm', 'pot', 'potx',
  'xlsm',
])

/** 轮询转换状态的间隔 / 最长等待（毫秒） */
const CONVERT_POLL_MS = 1500
const CONVERT_MAX_MS = 20 * 60 * 1000

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy
type PdfTask = import('pdfjs-dist').PDFDocumentLoadingTask

/** 保留在视口附近多少页已渲染的画布，超出即回收（控制手机内存） */
const KEEP_RANGE = 6
/** 视口外提前多少像素开始渲染下一页 */
const PRELOAD_MARGIN = '900px 0px'
/** 分批加载：先建前 N 页占位，滚动到底部哨兵再建下一批（小说式边看边载，不一次性铺完全部页） */
const BATCH_SIZE = 10
/** 哨兵距底部多少像素就提前拉下一批 */
const SENTINEL_MARGIN = '600px 0px'
/** 单页翻阅：预取当前页前后各 N 页（翻页瞬间即可上屏） */
const PAGED_PREFETCH = 2
/** 单页翻阅：左右滑动的判定距离 / 时间上限 */
const SWIPE_MIN_X = 48
const SWIPE_MAX_Y = 60

/** 从文件名取扩展名（小写） */
function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 人类可读的文件大小（加载提示用） */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 把 pdf.js 的异常翻译成考生看得懂的话 */
function pdfErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name ?? ''
  if (name === 'PasswordException') return '该 PDF 有打开密码，无法在应用内预览'
  if (name === 'InvalidPDFException') return 'PDF 文件已损坏或格式异常，请联系管理员重新上传'
  if (name === 'UnexpectedResponseException') {
    const status = (err as { status?: number })?.status
    if (status === 404) return '文件已丢失，请联系管理员'
    if (status === 401 || status === 403) return '登录已过期，请重新登录后再试'
    return `文件获取失败（${status ?? '网络异常'}），请稍后重试`
  }
  return err instanceof Error ? err.message : '文档加载失败'
}

export function DocViewer({ item, onClose }: { item: MaterialItem; onClose: () => void }) {
  const [status, setStatus] = useState<DocStatus>({ phase: 'loading' })
  const [sheetIdx, setSheetIdx] = useState(0)
  /** PDF 分段下载进度（0~1），用来给「加载中」一个可见的推进感（仅整份模式用） */
  const [ratio, setRatio] = useState(0)
  /** 单页模式：当前页渲染中（画布空白时显示提示） */
  const [pageBusy, setPageBusy] = useState(false)
  /** 单页模式：页码输入框的草稿值（失焦/回车才跳转，避免边打字边翻页） */
  const [pageDraft, setPageDraft] = useState('1')
  const docxHostRef = useRef<HTMLDivElement | null>(null)
  const pdfHostRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pdfDocRef = useRef<PdfDoc>(null)
  const pdfTaskRef = useRef<PdfTask>(null)

  /** 单页模式：单页 PDF 的 pdf.js 文档 + 渲染任务，翻页时整体换掉 */
  const pagedDocRef = useRef<PdfDoc>(null)
  const pagedTaskRef = useRef<PdfTask>(null)
  const pagedCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pagedHostRef = useRef<HTMLDivElement | null>(null)
  /** 单页模式：已经用 fetch 预热过的页地址（浏览器缓存命中后 pdf.js 秒开） */
  const warmedRef = useRef<Set<number>>(new Set())
  /** 单页模式：翻页序号，用来丢弃迟到的旧页渲染结果 */
  const pageSeqRef = useRef(0)
  /** 单页模式：容器宽度变化计数器 —— 强制重跑渲染 effect（page 值没变时 setStatus 不生效） */
  const [resizeTick, setResizeTick] = useState(0)

  /* ── 打开时拉文件并按类型渲染；关闭时销毁 pdf.js 文档对象 ── */
  useEffect(() => {
    let cancelled = false
    setStatus({ phase: 'loading' })
    setSheetIdx(0)
    setRatio(0)
    setPageDraft('1')
    warmedRef.current = new Set()

    ;(async () => {
      /** 整份 pdf.js 预览（未切片 / 切片不可用时的兜底）。
       *  url 由调用方给：PDF 资料是原件，Office 资料是服务端转换出来的 PDF。 */
      const openFullPdf = async (url: string) => {
        // 动态加载 pdf.js 与 worker（?url 让 Vite 把 worker 当静态资源打包）
        const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ])
        GlobalWorkerOptions.workerSrc = worker.default

        /* 关键：传地址而不是字节流 —— pdf.js 会走 HTTP Range 按需取
           （服务端 FileResponse 已支持 206，公网隧道也透传）。

           disableStream 是必须的：pdf.js 的首个探测请求**不带 Range**，
           服务端会回 200 + 整个文件并开始流式下发；非线性化 PDF 又要读到
           文件末尾的 xref 才能解析，结果就是「整包下完才出第一页」。
           打开 disableStream 后，它一确认服务端支持 Range 就立刻掐断这条整包流，
           之后所有数据都走分段请求。

           注：非线性化 PDF 即使这样仍可能拉满整份（这是本文件为何要引入切片），
           所以优先走上面的单页翻阅；这里只是兜底路径。 */
        const task = getDocument({
          url,
          rangeChunkSize: 262144, // 每次最多取 256KB
          disableStream: true, // 掐断「整包流式」回退
          disableAutoFetch: true, // 不预取整份文件
          withCredentials: false,
        })
        pdfTaskRef.current = task
        task.onProgress = (progress: import('pdfjs-dist').OnProgressParameters) => {
          if (!cancelled && progress.total) setRatio(Math.min(1, progress.loaded / progress.total))
        }

        const doc = await task.promise
        if (cancelled) {
          task.destroy()
          return
        }
        pdfDocRef.current = doc
        setStatus({ phase: 'pdf', numPages: doc.numPages })
      }

      try {
        const e = ext(item.file_name)

        if (e === 'pdf') {
          /* 先问服务端有没有切片。有 → 单页翻阅（一次一页，首屏 ~40KB）；
             没有 → 整份 pdf.js 预览（老逻辑，Range 按需取）。
             切片信息接口本身极小，失败也不影响后续。 */
          let paged = false
          let numPages = 0
          try {
            const info = await libraryApi.pages(item.id)
            if (!cancelled && info.sliced && info.count > 0) {
              paged = true
              numPages = info.count
            }
          } catch {
            /* 取不到切片信息就当没切片，走整份预览 */
          }
          if (cancelled) return
          if (paged) {
            setStatus({ phase: 'pdf-paged', numPages, page: 1 })
            return
          }

          await openFullPdf(libraryApi.fileUrl(item.id))
          return
        }

        /* doc / ppt / pptx：浏览器里没有渲染方案 → 让后端用本机 Office 转成 PDF，
           转好后同样走「单页翻阅」。首次打开要等转换（40MB / 253 页的课件约 1 分钟），
           之后就是秒开；期间可以关掉窗口，转换在后台继续。 */
        if (CONVERT_EXTS.has(e)) {
          const started = Date.now()
          for (;;) {
            if (cancelled) return
            const info = await libraryApi.preview(item.id)
            if (cancelled) return

            if (info.state === 'ready') {
              if (info.pages > 0) {
                setStatus({ phase: 'pdf-paged', numPages: info.pages, page: 1 })
              } else {
                // 转好了但没切成页（文件太小 / 服务端缺切片组件）→ 整份兜底
                await openFullPdf(libraryApi.previewFileUrl(item.id))
              }
              return
            }
            if (info.state === 'failed') {
              setStatus({ phase: 'error', message: info.message || '转换失败，暂时无法在线预览' })
              return
            }

            const waitedMs = Date.now() - started
            if (waitedMs > CONVERT_MAX_MS) {
              setStatus({ phase: 'error', message: '转换等待超时，请稍后再试，或先用右上角「本地打开」' })
              return
            }
            setStatus({
              phase: 'converting',
              message: info.state === 'converting' ? '正在转换成可在线翻阅的 PDF…' : '已排入转换队列，稍候…',
              waited: Math.round(waitedMs / 1000),
            })
            await new Promise(r => setTimeout(r, CONVERT_POLL_MS))
          }
        }

        const res = await fetch(libraryApi.fileUrl(item.id))
        if (!res.ok) throw new Error(`文件获取失败（${res.status}）`)
        const blob = await res.blob()

        if (e === 'docx') {
          const buf = await blob.arrayBuffer()
          const { renderAsync } = await import('docx-preview')
          if (cancelled || !docxHostRef.current) return
          await renderAsync(buf, docxHostRef.current, undefined, {
            className: 'docx-preview-doc',
            inWrapper: false,
            ignoreWidth: false,
            breakPages: true,
            experimental: true,
          })
          setStatus({ phase: 'docx' })
          return
        }

        if (['xlsx', 'xls', 'csv'].includes(e)) {
          const buf = await blob.arrayBuffer()
          const XLSX = await import('xlsx')
          const wb = XLSX.read(buf, { type: 'array' })
          const sheets = wb.SheetNames.slice(0, 12).map(name => ({
            name,
            html: XLSX.utils.sheet_to_html(wb.Sheets[name], { editable: false }),
          }))
          if (!sheets.length) throw new Error('表格内容为空')
          setStatus({ phase: 'sheet', sheets })
          return
        }

        if (e === 'txt' || e === 'text' || e === 'md' || e === 'log') {
          // 纯文本零成本：直接贴进 <pre>（自己就是完整内容，不需要任何渲染库）
          const text = await blob.text()
          if (cancelled) return
          setStatus({ phase: 'text', content: text.slice(0, 400000) })
          return
        }

        setStatus({ phase: 'error', message: '该格式暂不支持应用内预览，可用右上角「本地打开」下载后用本机软件查看' })
      } catch (err) {
        if (!cancelled) {
          const e = ext(item.file_name)
          setStatus({ phase: 'error', message: e === 'pdf' ? pdfErrorMessage(err) : err instanceof Error ? err.message : '文档加载失败' })
        }
      }
    })()

    return () => {
      cancelled = true
      if (pdfTaskRef.current) {
        pdfTaskRef.current.destroy()
        pdfTaskRef.current = null
        pdfDocRef.current = null
      }
      if (pagedTaskRef.current) {
        pagedTaskRef.current.destroy()
        pagedTaskRef.current = null
        pagedDocRef.current = null
      }
    }
  }, [item.id, item.file_name])

  /* ── 单页翻阅模式：当前页单独开一个 pdf.js 文档，画完即弃 ──
     一页 = 一个独立 PDF = 一个 HTTP 请求。切页时销毁上一个文档，
     内存里永远只有当前这一页。相邻页用 fetch 预热（进浏览器缓存，
     pdf.js 再打开时直接命中，不用等网络）。 */
  useEffect(() => {
    if (status.phase !== 'pdf-paged') return
    const host = pagedHostRef.current
    if (!host) return

    const page = status.page
    const seq = ++pageSeqRef.current
    let cancelled = false
    let disposed = false

    const warm = (n: number) => {
      if (n < 1 || n > status.numPages || warmedRef.current.has(n)) return
      warmedRef.current.add(n)
      // 只预热，不解析；失败无所谓
      void fetch(libraryApi.pageUrl(item.id, n), { cache: 'force-cache' }).catch(() => {})
    }

    ;(async () => {
      setPageBusy(true)
      try {
        const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ])
        GlobalWorkerOptions.workerSrc = worker.default

        const task = getDocument({
          url: libraryApi.pageUrl(item.id, page),
          // 单页文件很小，一次拿完；不设 Range 相关参数避免多余探测请求
          withCredentials: false,
        })
        pagedTaskRef.current = task
        const doc = await task.promise
        if (cancelled || disposed) {
          task.destroy()
          return
        }
        pagedDocRef.current = doc

        const pdfPage = await doc.getPage(1)
        if (cancelled || disposed) return

        const slot = host.querySelector<HTMLElement>('[data-paged-slot]')
        if (!slot) return
        const cssWidth = Math.max(240, slot.clientWidth || 320)
        const base = pdfPage.getViewport({ scale: 1 })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const viewport = pdfPage.getViewport({ scale: (cssWidth / base.width) * dpr })

        let canvas = pagedCanvasRef.current
        if (!canvas) {
          canvas = document.createElement('canvas')
          pagedCanvasRef.current = canvas
          canvas.style.display = 'block'
          canvas.style.width = '100%'
          canvas.style.height = 'auto'
          canvas.style.borderRadius = '4px'
          slot.appendChild(canvas)
        }
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        await pdfPage.render({ canvas, viewport }).promise
      } catch (err) {
        if (!cancelled && !disposed) {
          const status404 = (err as { status?: number })?.status === 404
          setStatus({
            phase: 'error',
            message: status404 ? '该页切片已丢失，请联系管理员重新上传' : pdfErrorMessage(err),
          })
        }
      } finally {
        if (!cancelled && !disposed) setPageBusy(false)
      }
    })()

    // 预热当前页前后（翻页时几乎瞬开）
    for (let d = 1; d <= PAGED_PREFETCH; d++) {
      warm(page + d)
      warm(page - d)
    }

    return () => {
      cancelled = true
      // 销毁上一个文档：pdf.js 的 worker 会释放这页的资源
      if (pagedTaskRef.current) {
        pagedTaskRef.current.destroy()
        pagedTaskRef.current = null
        pagedDocRef.current = null
      }
      const c = pagedCanvasRef.current
      if (c) {
        c.width = 0
        c.height = 0
        c.remove()
        pagedCanvasRef.current = null
      }
    }
  }, [status, item.id, resizeTick])

  /* ── 单页模式：页码输入框跟随当前页同步 ── */
  useEffect(() => {
    if (status.phase === 'pdf-paged') setPageDraft(String(status.page))
  }, [status])

  /** 单页模式：跳到指定页（超出范围自动夹到 1..numPages） */
  const goPage = useCallback(
    (target: number) => {
      setStatus(prev => {
        if (prev.phase !== 'pdf-paged') return prev
        const next = Math.min(Math.max(1, Math.floor(target) || 1), prev.numPages)
        if (next === prev.page) return prev
        return { ...prev, page: next }
      })
    },
    [],
  )

  /* ── 单页模式：键盘翻页（← → ↑ ↓ PageUp / PageDown / Home / End / Esc） ── */
  useEffect(() => {
    if (status.phase !== 'pdf-paged') return
    const onKey = (ev: KeyboardEvent) => {
      const tag = (ev.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' || ev.key === 'PageDown') {
        ev.preventDefault()
        goPage(status.page + 1)
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' || ev.key === 'PageUp') {
        ev.preventDefault()
        goPage(status.page - 1)
      } else if (ev.key === 'Home') {
        ev.preventDefault()
        goPage(1)
      } else if (ev.key === 'End') {
        ev.preventDefault()
        goPage(status.numPages)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, goPage])

  /* ── 单页模式：左右滑动翻页（移动端主要交互） ── */
  useEffect(() => {
    if (status.phase !== 'pdf-paged') return
    const host = pagedHostRef.current
    if (!host) return
    let sx = 0
    let sy = 0
    let st = 0
    const onStart = (ev: TouchEvent) => {
      const t = ev.touches[0]
      sx = t.clientX
      sy = t.clientY
      st = Date.now()
    }
    const onEnd = (ev: TouchEvent) => {
      const t = ev.changedTouches[0]
      const dx = t.clientX - sx
      const dy = t.clientY - sy
      if (Date.now() - st > 700) return
      if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) > SWIPE_MAX_Y) return
      goPage(status.page + (dx < 0 ? 1 : -1))
    }
    host.addEventListener('touchstart', onStart, { passive: true })
    host.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      host.removeEventListener('touchstart', onStart)
      host.removeEventListener('touchend', onEnd)
    }
  }, [status, goPage])

  /* PDF 虚拟渲染（整份模式下才用）：小说式分批加载——先只建前 BATCH_SIZE 页占位，
     滚到底部哨兵再拉下一批；只有滚进视口的页才真正画到 canvas，离太远的画布回收。
     手机上一次只看得到一两页，内存占用从「148 页」降到「十来页」，首屏也不用等全部 DOM 建好。 */
  useEffect(() => {
    if (status.phase !== 'pdf') return
    const host = pdfHostRef.current
    const scroller = scrollRef.current
    const doc = pdfDocRef.current
    if (!host || !scroller || !doc) return

    let cancelled = false
    let cssWidth = 0
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2)
    const slots: HTMLDivElement[] = []
    const canvases = new Map<number, HTMLCanvasElement>()
    const painting = new Set<number>()
    const visible = new Set<number>()
    let io: IntersectionObserver | null = null
    let sentinelIo: IntersectionObserver | null = null
    let sentinel: HTMLDivElement | null = null
    /** 下一批要创建的第一页号（1 起） */
    let nextBatchStart = 1
    /** 首页宽高比，给占位框用 */
    let pageRatio = 1.4
    /** 防 buildBatch 重入 */
    let building = false

    const release = (i: number) => {
      const canvas = canvases.get(i)
      const slot = slots[i]
      if (!canvas || !slot) return
      canvas.width = 0
      canvas.height = 0
      canvas.remove()
      canvases.delete(i)
      slot.style.background = '#F3F4F6'
    }

    const paint = async (i: number) => {
      if (cancelled || canvases.has(i) || painting.has(i)) return
      const slot = slots[i]
      if (!slot) return
      painting.add(i)
      try {
        const page = await doc.getPage(i)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr() })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.display = 'block'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.borderRadius = '4px'
        slot.style.height = `${Math.floor(viewport.height / dpr())}px`
        slot.style.background = '#FFFFFF'
        slot.appendChild(canvas)
        canvases.set(i, canvas)
        await page.render({ canvas, viewport }).promise
      } catch {
        /* 单页渲染失败不影响其它页，留灰底即可 */
      } finally {
        painting.delete(i)
      }
    }

    const prune = () => {
      if (!visible.size) return
      const min = Math.min(...visible)
      const max = Math.max(...visible)
      for (const i of [...canvases.keys()]) {
        if (i < min - KEEP_RANGE || i > max + KEEP_RANGE) release(i)
      }
    }

    /** 创建下一批 BATCH_SIZE 页的占位框，插在哨兵之前；建完最后一批就撤掉哨兵 */
    const buildBatch = async () => {
      if (cancelled || building || !io) return
      building = true
      try {
        const end = Math.min(nextBatchStart + BATCH_SIZE - 1, doc.numPages)
        for (let i = nextBatchStart; i <= end; i++) {
          const slot = document.createElement('div')
          slot.dataset.page = String(i)
          slot.style.width = `${cssWidth}px`
          slot.style.height = `${Math.round(cssWidth * pageRatio)}px`
          slot.style.margin = '0 auto 10px'
          slot.style.borderRadius = '4px'
          slot.style.background = '#F3F4F6'
          slot.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12)'
          if (sentinel) host.insertBefore(slot, sentinel)
          else host.appendChild(slot)
          slots[i] = slot
          io.observe(slot)
        }
        nextBatchStart = end + 1
        if (nextBatchStart > doc.numPages) {
          sentinel?.remove()
          sentinel = null
        } else if (sentinel) {
          sentinel.textContent = '加载更多…'
        }
      } finally {
        building = false
      }
    }

    const build = async () => {
      cssWidth = Math.max(240, host.clientWidth || 320)
      const first = await doc.getPage(1)
      if (cancelled) return
      const base = first.getViewport({ scale: 1 })
      pageRatio = base.height / base.width

      host.innerHTML = ''

      // 哨兵：滚动到这里（提前 SENTINEL_MARGIN）就建下一批
      sentinel = document.createElement('div')
      sentinel.dataset.sentinel = ''
      sentinel.className = 'text-xs text-center py-6'
      sentinel.style.color = '#6B7280'
      sentinel.textContent = '加载更多…'
      host.appendChild(sentinel)

      io = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const i = Number((entry.target as HTMLElement).dataset.page)
            if (entry.isIntersecting) {
              visible.add(i)
              void paint(i)
            } else {
              visible.delete(i)
            }
          }
          prune()
        },
        { root: scroller, rootMargin: PRELOAD_MARGIN },
      )

      sentinelIo = new IntersectionObserver(
        entries => {
          if (entries[0].isIntersecting) void buildBatch()
        },
        { root: scroller, rootMargin: SENTINEL_MARGIN },
      )
      sentinelIo.observe(sentinel)

      // 先只建第一批（前 BATCH_SIZE 页），其余等滚动到哨兵再建
      await buildBatch()
    }

    /* 转屏 / 窗口宽度变化：按比例重排占位框并重画当前可见页 */
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        const next = Math.max(240, host.clientWidth || 320)
        if (!cssWidth || Math.abs(next - cssWidth) < 8) return
        const k = next / cssWidth
        cssWidth = next
        for (let i = 1; i < nextBatchStart; i++) {
          const slot = slots[i]
          if (!slot) continue
          if (canvases.has(i)) release(i)
          slot.style.width = `${cssWidth}px`
          slot.style.height = `${Math.round(parseFloat(slot.style.height || '0') * k)}px`
        }
        for (const i of visible) void paint(i)
      }, 200)
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
    ro?.observe(host)

    void build()

    return () => {
      cancelled = true
      if (resizeTimer) clearTimeout(resizeTimer)
      ro?.disconnect()
      io?.disconnect()
      sentinelIo?.disconnect()
      canvases.forEach(c => {
        c.width = 0
        c.height = 0
        c.remove()
      })
      canvases.clear()
    }
  }, [status])

  /* 单页模式下转屏 / 宽度变化重绘当前页：canvas 尺寸依赖容器宽度，
     但 page 值没变、setStatus 不会触发重渲染 → 用一个 tick 计数器强制重跑渲染 effect。 */
  useEffect(() => {
    if (status.phase !== 'pdf-paged') return
    const host = pagedHostRef.current
    if (!host) return
    let last = host.clientWidth
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          const w = host.clientWidth
          if (Math.abs(w - last) < 24) return  // 移动端地址栏收起只差几像素，忽略
          last = w
          setResizeTick(t => t + 1)
        })
      : null
    ro?.observe(host)
    return () => ro?.disconnect()
  }, [status.phase])

  const isPaged = status.phase === 'pdf-paged'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onClose}>
      <div
        className="w-full mx-4 rounded-3xl overflow-hidden flex flex-col"
        style={{ background: 'var(--surface-raised)', maxWidth: 640, height: '86vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 顶栏：标题 + 打开/下载兜底 + 关闭 */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{item.title}</p>
            <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
              {item.file_name}
              {item.file_size ? ` · ${formatSize(item.file_size)}` : ''}
            </p>
          </div>
          {/* 大文件在弱网下首屏依然要等：给一个交给系统/浏览器打开的兜底入口 */}
          <button
            onClick={() => window.open(libraryApi.fileUrl(item.id), '_blank')}
            className="text-[11px] font-medium px-2.5 py-1.5 rounded-full flex-shrink-0 tap"
            style={{ background: 'var(--chip-bg)', color: 'var(--text-2)' }}
          >
            本地打开
          </button>
          <button
            aria-label="关闭预览"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 tap"
            style={{ background: 'var(--chip-bg)', color: 'var(--text-2)' }}
          >
            ✕
          </button>
        </div>

        {/* 多工作表切换（Excel） */}
        {status.phase === 'sheet' && status.sheets.length > 1 && (
          <div className="flex gap-1.5 px-4 py-2 overflow-x-auto flex-shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
            {status.sheets.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setSheetIdx(i)}
                className="text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap tap flex-shrink-0"
                style={{
                  background: i === sheetIdx ? 'var(--accent-weak)' : 'var(--chip-bg)',
                  color: i === sheetIdx ? 'var(--accent)' : 'var(--text-3)',
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* 内容区。docx 容器始终挂载（renderAsync 需要提前拿到 DOM，不能等加载完再渲染） */}
        <div ref={scrollRef} className="flex-1 overflow-auto relative" style={{ background: '#FFFFFF' }}>
          {status.phase === 'loading' && (
            <div className="text-center py-16 px-6">
              <p className="text-sm" style={{ color: '#6B7280' }}>文档加载中…</p>
              <p className="text-[11px] mt-1.5" style={{ color: '#9CA3AF' }}>
                {formatSize(item.file_size)}
                {ratio > 0 ? ` · 已加载 ${Math.round(ratio * 100)}%` : ''}
              </p>
              {item.file_size > 10 * 1024 * 1024 && (
                <p className="text-[11px] mt-3 leading-relaxed" style={{ color: '#9CA3AF' }}>
                  大文件首次打开要等一会儿，
                  <br />
                  嫌慢可以点右上角「本地打开」
                </p>
              )}
            </div>
          )}

          {/* Office 文档（doc/ppt/pptx）首次打开：后端正在把它转成可翻阅的 PDF */}
          {status.phase === 'converting' && (
            <div className="text-center py-16 px-8">
              <div
                className="w-9 h-9 mx-auto mb-4 rounded-full animate-spin"
                style={{ border: '3px solid #E5E7EB', borderTopColor: 'var(--accent)' }}
              />
              <p className="text-sm font-medium" style={{ color: '#374151' }}>{status.message}</p>
              <p className="text-[11px] mt-1.5" style={{ color: '#9CA3AF' }}>
                {status.waited > 0 ? `已等待 ${status.waited} 秒 · ` : ''}
                首次打开需要转换，转好之后就能秒开
              </p>
              <p className="text-[11px] mt-4 leading-relaxed" style={{ color: '#9CA3AF' }}>
                转换在服务器后台进行，可以关掉这个窗口稍后再回来
                <br />
                着急看也可以点右上角「本地打开」
              </p>
            </div>
          )}

          {status.phase === 'error' && (
            <div className="text-center py-16 px-8">
              <p className="text-sm" style={{ color: '#6B7280' }}>{status.message}</p>
              <button
                onClick={() => window.open(libraryApi.fileUrl(item.id), '_blank')}
                className="mt-4 text-xs font-semibold px-4 py-2 rounded-full tap"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                新标签页打开
              </button>
            </div>
          )}

          {/* ── 单页翻阅模式 ── */}
          {isPaged && (
            <div className="h-full flex flex-col">
              <div ref={pagedHostRef} className="flex-1 overflow-auto px-3 pt-3 pb-2">
                <div
                  data-paged-slot
                  className="relative mx-auto rounded"
                  style={{ maxWidth: 560, minHeight: 200, background: '#F9FAFB' }}
                >
                  {pageBusy && (
                    <p className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: '#9CA3AF' }}>
                      正在加载第 {status.page} 页…
                    </p>
                  )}
                </div>
              </div>

              {/* 底部翻页条：上一页 / 页码 / 下一页 + 进度条 */}
              <div className="flex-shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid #E5E7EB' }}>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={() => goPage(status.page - 1)}
                    disabled={status.page <= 1}
                    className="text-xs font-medium px-3 py-2 rounded-full tap disabled:opacity-35"
                    style={{ background: '#F3F4F6', color: '#374151' }}
                  >
                    ← 上一页
                  </button>
                  <div className="flex items-center gap-1 text-xs" style={{ color: '#6B7280' }}>
                    <input
                      value={pageDraft}
                      inputMode="numeric"
                      onChange={e => setPageDraft(e.target.value.replace(/[^\d]/g, ''))}
                      onBlur={() => goPage(Number(pageDraft))}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                      className="w-11 text-center rounded-md py-1.5 outline-none"
                      style={{ background: '#F3F4F6', color: '#111827', border: '1px solid #E5E7EB' }}
                      aria-label="跳转到页码"
                    />
                    <span>/ {status.numPages}</span>
                  </div>
                  <button
                    onClick={() => goPage(status.page + 1)}
                    disabled={status.page >= status.numPages}
                    className="text-xs font-medium px-3 py-2 rounded-full tap disabled:opacity-35"
                    style={{ background: '#F3F4F6', color: '#374151' }}
                  >
                    下一页 →
                  </button>
                </div>
                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: '#F3F4F6' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round((status.page / status.numPages) * 100)}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
                <p className="text-[10px] text-center mt-1.5" style={{ color: '#9CA3AF' }}>
                  左右滑动或按方向键翻页 · 单页加载，打开更快
                </p>
              </div>
            </div>
          )}

          {/* ── 整份预览模式（未切片时回落） ── */}
          {status.phase === 'pdf' && (
            <div ref={pdfHostRef} className="w-full px-3 py-3">
              <p
                data-pdf-loading
                className="text-xs text-center py-6"
                style={{ color: '#6B7280' }}
              >
                正在渲染（共 {status.numPages} 页）…
              </p>
            </div>
          )}

          <div
            className="docx-preview-host p-4"
            style={{ display: status.phase === 'docx' ? 'block' : 'none' }}
          >
            <div ref={docxHostRef} />
          </div>

          {status.phase === 'sheet' && (
            <div
              className="sheet-html p-3"
              dangerouslySetInnerHTML={{ __html: status.sheets[sheetIdx]?.html ?? '' }}
            />
          )}

          {status.phase === 'text' && (
            <pre className="p-4 text-[12px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: '#111827' }}>
              {status.content}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
