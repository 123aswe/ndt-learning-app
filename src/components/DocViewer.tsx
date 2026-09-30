import { useEffect, useRef, useState } from 'react'
import { libraryApi, type MaterialItem } from '../api/client'

/* ============================================================
   文档应用内预览浮层（教材/视频页点开 doc 类资料时用）
   - pdf  → pdf.js 逐页渲染成 canvas（普通 DOM 滚动，手机竖屏 iframe 原生查看器
            滚不动，弃用 <iframe> 方案；页面按容器宽度自适应，支持连续上下滑动）
   - docx → docx-preview 渲染成 DOM（样式接近 Word，可翻页滚动）
   - xlsx/xls/csv → SheetJS 解析成 HTML 表格（多工作表时顶部可切换）
   - doc/xls/ppt/pptx 等旧格式 → 前端无轻量渲染方案，给「新标签页打开」兜底
   - 库都走动态 import（import()），不拖累首屏包体积
   - 修改注意：颜色一律用 var(--token)；预览内容区统一白底黑字（文档内容与主题无关）
   ============================================================ */

type DocStatus =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'pdf'; numPages: number }
  | { phase: 'docx' }
  | { phase: 'sheet'; sheets: { name: string; html: string }[] }

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy
type PdfTask = import('pdfjs-dist').PDFDocumentLoadingTask

/** 从文件名取扩展名（小写） */
function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function DocViewer({ item, onClose }: { item: MaterialItem; onClose: () => void }) {
  const [status, setStatus] = useState<DocStatus>({ phase: 'loading' })
  const [sheetIdx, setSheetIdx] = useState(0)
  const docxHostRef = useRef<HTMLDivElement | null>(null)
  const pdfHostRef = useRef<HTMLDivElement | null>(null)
  const pdfDocRef = useRef<PdfDoc>(null)
  const pdfTaskRef = useRef<PdfTask>(null)

  /* 打开时拉文件并按类型渲染；关闭时销毁 pdf.js 文档对象 */
  useEffect(() => {
    let cancelled = false
    setStatus({ phase: 'loading' })
    setSheetIdx(0)

    ;(async () => {
      try {
        const res = await fetch(libraryApi.fileUrl(item.id))
        if (!res.ok) throw new Error(`文件获取失败（${res.status}）`)
        const blob = await res.blob()
        const e = ext(item.file_name)

        if (e === 'pdf') {
          // 动态加载 pdf.js 与 worker（?url 让 Vite 把 worker 当静态资源打包）
          const [{ getDocument, GlobalWorkerOptions }, worker] = await Promise.all([
            import('pdfjs-dist'),
            import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          ])
          GlobalWorkerOptions.workerSrc = worker.default
          const buf = await blob.arrayBuffer()
          const task = getDocument({ data: new Uint8Array(buf) })
          pdfTaskRef.current = task
          const doc = await task.promise
          if (cancelled) {
            task.destroy()
            return
          }
          pdfDocRef.current = doc
          setStatus({ phase: 'pdf', numPages: doc.numPages })
          return
        }

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

        setStatus({ phase: 'error', message: '该格式暂不支持应用内预览（旧版 Office 格式请转存为 docx / xlsx 后重新上传）' })
      } catch (err) {
        if (!cancelled) setStatus({ phase: 'error', message: err instanceof Error ? err.message : '文档加载失败' })
      }
    })()

    return () => {
      cancelled = true
      if (pdfTaskRef.current) {
        pdfTaskRef.current.destroy()
        pdfTaskRef.current = null
        pdfDocRef.current = null
      }
    }
  }, [item.id, item.file_name])

  /* PDF 逐页渲染成 canvas：按容器宽度自适应缩放，叠上 devicePixelRatio 保证清晰度。
     渲染完一页插一页（大文件不用等全部页就绪），首页出来后移除「加载中」提示。 */
  useEffect(() => {
    if (status.phase !== 'pdf') return
    const host = pdfHostRef.current
    const doc = pdfDocRef.current
    if (!host || !doc) return
    let cancelled = false

    ;(async () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cssWidth = host.clientWidth || 320
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
        canvas.style.display = 'block'
        canvas.style.margin = '0 auto 10px'
        canvas.style.borderRadius = '4px'
        canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12)'
        host.appendChild(canvas)
        if (i === 1) host.querySelector('[data-pdf-loading]')?.remove()
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await page.render({ canvas, viewport }).promise
        if (cancelled) return
      }
    })()

    return () => {
      cancelled = true
    }
  }, [status])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={onClose}>
      <div
        className="w-full mx-4 rounded-3xl overflow-hidden flex flex-col"
        style={{ background: 'var(--surface-raised)', maxWidth: 640, height: '86vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 顶栏：标题 + 关闭 */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{item.title}</p>
            <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-3)' }}>{item.file_name}</p>
          </div>
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
        <div className="flex-1 overflow-auto relative" style={{ background: '#FFFFFF' }}>
          {status.phase === 'loading' && (
            <p className="text-sm text-center py-16" style={{ color: '#6B7280' }}>文档加载中…</p>
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
        </div>
      </div>
    </div>
  )
}
