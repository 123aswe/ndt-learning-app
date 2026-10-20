import React, { useEffect, useMemo, useRef, useState } from 'react'
import { libraryApi, type MaterialItem, type MaterialSeries } from '../api/client'
import { BookIcon, PlayIcon, ChevronRightIcon, ClockIcon, ClipboardIcon, ListIcon, LayersIcon, EyeIcon, SortIcon } from '../components/icons'
import { DocViewer } from '../components/DocViewer'
import { VideoCard } from '../components/VideoCard'
import { formatSize, formatCount } from '../data/format'
import { loadLibOrder, saveLibOrder } from '../data/libraryOrder'
import { useStagger } from '../hooks/useStagger'
import type { Screen } from '../types'

/* ============================================================
   教材 / 视频 Tab 页（苹果式浅色 · 双列卡片布局）
   数据全部实时：GET /api/library + GET /api/library/series
   —— 管理员后台「资料库」上传后动态出现

   布局层级（三层）：
     大类 Tab（教材 & 资料 / 视频课程）
       → 系列卡列表（GET /library/series，点进系列详情页）
       → 未归系列的「散资料」直接跟在系列卡下方，不需要多点一层

    - 二级 Tag：资料 = 分类（标准/教材/资料）；视频 = 方向（UT/RT/MT…，取自实际数据）
    - 视频卡片：管理员指定封面优先，其次自动取视频首帧（见 components/VideoCard.tsx）；
      点卡片进「视频详情页」（播放器 + 收藏 + 评论区）
    - 文档 → 应用内 DocViewer 预览：
        pdf / docx / xlsx·xls·csv / txt 前端直接渲染；
        doc / ppt / pptx 由服务端转成 PDF 后走「单页翻阅」
        （见 components/DocViewer.tsx 与后端 modules/office_view.py）
    - 「观看记录」入口保留
    - 「顺序 / 倒序」切换（工具栏右侧）：服务端给的是**管理员后台排定的顺序**
      （新上传的排在最前），点一下就地反转 —— 系列卡、散资料、视频三类一起翻转。
   修改注意：
     - 一级 Tab 的分类口径要与 server/modules/materials.py MATERIAL_CATEGORIES 同步
     - 颜色一律用 var(--token)，不要写死 hex（深色模式）
   ============================================================ */

interface MaterialsScreenProps {
  onNavigate: (screen: Screen) => void
  /** 点视频卡片 → 进视频详情页（由 App.tsx 切视图） */
  onOpenVideo: (materialId: number) => void
  /** 点系列卡 → 进系列详情页（由 App.tsx 切视图） */
  onOpenSeries: (series: MaterialSeries) => void
}

/** 一级 Tab（教材&资料 / 视频课程） */
const VIEWS = [
  { v: 'doc', label: '教材 & 资料' },
  { v: 'video', label: '视频课程' },
] as const

/** 分批渲染的批大小：首屏先出这么多张，滑到底再补同样多 */
const PAGE_SIZE = 8

/** 资料分类 Tag（与后端 MATERIAL_CATEGORIES 同步，video 归到视频 Tab 不在此列） */
const DOC_CHIPS = [
  { v: '', label: '全部' },
  { v: 'standard', label: '标准规范' },
  { v: 'textbook', label: '教材' },
  { v: 'material', label: '辅导资料' },
] as const

function isSeriesVideo(s: MaterialSeries): boolean {
  return s.category === 'video'
}

function isVideoItem(item: MaterialItem): boolean {
  return item.kind === 'video' || item.category === 'video'
}

function categoryIcon(item: MaterialItem, size: number): React.ReactNode {
  if (isVideoItem(item)) return <PlayIcon size={size} />
  if (item.category === 'standard') return <ClipboardIcon size={size} />
  if (item.category === 'material') return <ListIcon size={size} />
  return <BookIcon size={size} />
}

/* ── 系列卡（横向条：封面缩略 + 名称 + 简介 + 数量），点进系列详情 ── */
function SeriesCard({ series, onOpen }: { series: MaterialSeries; onOpen: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false)
  const useCover = series.has_cover && !coverFailed
  const video = isSeriesVideo(series)
  return (
    <button onClick={onOpen} className="card w-full px-3 py-3 flex items-center gap-3.5 card-tap text-left">
      <div
        className="w-16 h-16 rounded-2xl flex-shrink-0 relative overflow-hidden flex items-center justify-center"
        style={{
          background: 'linear-gradient(150deg, var(--accent-weak), var(--surface-warm))',
          border: '1px solid var(--accent-border)',
        }}
      >
        {useCover ? (
          <img
            src={libraryApi.seriesCoverUrl(series.id)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span style={{ color: 'var(--accent)', opacity: 0.3 }}>{video ? <PlayIcon size={26} /> : <BookIcon size={28} />}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <LayersIcon size={12} color="var(--accent)" />
          <span className="text-[9.5px] font-bold tracking-wide" style={{ color: 'var(--accent)' }}>
            {series.method ? `${series.method} 系列` : '通用系列'}
          </span>
        </div>
        <p className="text-[13.5px] font-bold mt-1 line-clamp-1" style={{ color: 'var(--text-1)' }}>{series.title}</p>
        <p className="text-[10.5px] mt-0.5 line-clamp-1" style={{ color: 'var(--text-3)' }}>
          {series.description || `${series.item_count} 份内容`}
        </p>
        <p className="text-[10px] mt-1 font-semibold" style={{ color: 'var(--text-2)' }}>
          共 {series.item_count} {video ? '个视频' : '份资料'}
        </p>
      </div>

      <ChevronRightIcon size={16} color="var(--text-3)" />
    </button>
  )
}

/* ── 资料卡（书封网格）：封面 + 标题 + 简介 + 尺寸/预览 ── */
function DocCard({ item, onOpen }: { item: MaterialItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card p-2.5 flex flex-col justify-between card-tap text-left">
      <div>
        {/* 封面：主色浅底 + 水印图标 + 分类徽标 + 方向书脊 */}
        <div
          className="w-full rounded-xl relative overflow-hidden"
          style={{
            height: 132,
            background: 'linear-gradient(155deg, var(--accent-weak), var(--surface-warm))',
            border: '1px solid var(--accent-border)',
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <span style={{ color: 'var(--accent)', opacity: 0.22 }}>{categoryIcon(item, 46)}</span>
          </div>
          <span
            className="absolute top-2 left-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--surface-raised)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
          >
            {item.category_name}
          </span>
          <div className="absolute left-2.5 right-2.5 bottom-2.5">
            <p className="text-[9px] font-semibold tracking-wide" style={{ color: 'var(--accent)' }}>
              {item.method ? `${item.method} 方向` : '通用方向'}
            </p>
            <p className="text-[11px] font-bold mt-0.5 line-clamp-1" style={{ color: 'var(--text-2)' }}>
              {item.file_name.split('.').pop()?.toUpperCase() || '资料'}
            </p>
          </div>
        </div>

        {/* 标题与简介 */}
        <h3 className="text-[13px] font-bold mt-2.5 line-clamp-1" style={{ color: 'var(--text-1)' }}>{item.title}</h3>
        <p className="text-[10px] mt-0.5 line-clamp-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          {item.description || item.file_name}
        </p>
      </div>

      {/* 底部：文件大小 + 动作 */}
      <div className="mt-3 pt-2 flex items-center justify-between" style={{ borderTop: '1px solid var(--line)' }}>
        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{formatSize(item.file_size)}</span>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
        >
          预览
        </span>
      </div>
    </button>
  )
}

export function MaterialsScreen({ onNavigate, onOpenVideo, onOpenSeries }: MaterialsScreenProps) {
  const [items, setItems] = useState<MaterialItem[] | null>(null)
  const [series, setSeries] = useState<MaterialSeries[]>([])
  /** 正在预览的文档资料（非空 = 显示 DocViewer 浮层） */
  const [previewDoc, setPreviewDoc] = useState<MaterialItem | null>(null)
  const [error, setError] = useState('')
  /** 一级 Tab：doc（教材&资料）/ video（视频课程） */
  const [view, setView] = useState<'doc' | 'video'>('doc')
  /** 二级 Tag：资料按分类，视频按方向（'' = 全部） */
  const [chip, setChip] = useState<string>('')
  /** 排序方向：desc = 管理端排定的顺序（新上传在最前），asc = 倒序
   *  初值来自本机偏好（与系列详情页共享），切换即写回 —— 退出重进仍保留 */
  const [order, setOrder] = useState<'desc' | 'asc'>(() => loadLibOrder())
  /* 整屏进场动效：切换一级 Tab / 二级筛选（数据重算）时，分区再错峰播一次 */
  const staggerRef = useStagger<HTMLDivElement>(`${view}-${chip}-${order}`)

  useEffect(() => {
    saveLibOrder(order)
  }, [order])

  useEffect(() => {
    let cancelled = false
    Promise.all([libraryApi.list(), libraryApi.series()])
      .then(([listRes, seriesRes]) => {
        if (cancelled) return
        setItems(listRes.items)
        setSeries(seriesRes.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '资料加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const all = useMemo(() => {
    const list = items ?? []
    // 「倒序」= 把服务端顺序整体反过来（服务端已经按管理员排定的顺序返回）
    return order === 'asc' ? [...list].reverse() : list
  }, [items, order])
  const docItems = useMemo(() => all.filter(it => !isVideoItem(it)), [all])
  const videoItems = useMemo(() => all.filter(isVideoItem), [all])

  /** 视频方向 Tag：只列出实际存在的方向（'' → 全部） */
  const videoChips = useMemo(() => {
    const methods = Array.from(new Set(videoItems.map(it => it.method).filter(Boolean))).sort()
    return [{ v: '', label: '全部' }, ...methods.map(m => ({ v: m, label: m }))]
  }, [videoItems])

  const chips = view === 'doc' ? DOC_CHIPS : videoChips
  /** 二级 Tag：资料 Tab 存 category、视频 Tab 存 method，两套口径分开过滤 */
  const list = useMemo(() => {
    if (view === 'doc') return chip ? docItems.filter(it => it.category === chip) : docItems
    return chip ? videoItems.filter(it => it.method === chip) : videoItems
  }, [view, chip, docItems, videoItems])

  /* 当前 Tab 的系列：按 chip 口径过滤（资料 Tab 用 category、视频 Tab 用 method） */
  const visibleSeries = useMemo(() => {
    const ordered = order === 'asc' ? [...series].reverse() : series
    const inView = ordered.filter(s => (view === 'video' ? isSeriesVideo(s) : !isSeriesVideo(s)))
    if (!chip) return inView
    return view === 'video'
      ? inView.filter(s => !s.method || s.method === chip)
      : inView.filter(s => s.category === chip)
  }, [series, view, chip, order])

  /* 散资料：没有归入任何系列（series_id = 0）。有系列时它们跟在系列卡下方展示 */
  const looseList = useMemo(() => list.filter(it => !it.series_id), [list])

  /* 选了具体 chip 时，系列卡的归属系列名过滤会因 category 与 chip 一致而不受影响（same thing） */

  /* ── 分批渲染（手机端体验的关键）─────────────────────────────
     不把整屏卡片一次性塞进 DOM：首屏先出 PAGE_SIZE 张，底部哨兵滚进视口再补一批。
     配合 VideoCard 的封面按需加载，手机上打开资料页不再几十个视频同时拉首帧。
     切 Tab / 换分类时回到首批数量，避免残留上次的展开状态。 */
  const [visible, setVisible] = useState(PAGE_SIZE)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const shown = useMemo(() => looseList.slice(0, visible), [looseList, visible])
  const hasMore = visible < looseList.length

  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [view, chip, order])

  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) setVisible(v => v + PAGE_SIZE)
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
    // visible 进依赖是必须的：追加后重建观察器，哨兵若仍在视口内就继续补，直到填满一屏
  }, [hasMore, looseList.length, visible])

  const switchView = (next: 'doc' | 'video') => {
    setView(next)
    setChip('')   // 两个 Tab 的 Tag 口径不同，切 Tab 时重置筛选
  }

  const emptyHint = all.length > 0
    ? (view === 'video' ? '这个筛选下暂时没有视频' : '这个分类下暂时没有资料')
    : (view === 'video' ? '还没有课程视频' : '还没有学习资料')

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" ref={staggerRef} style={{ paddingBottom: 110 }}>
        {/* 标题 */}
        <div className="px-5 pt-14 pb-3">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>教材 / 视频</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>标准、教材与课程视频，管理员发布后这里同步</p>
        </div>

        {/* 一级 Tab：教材 & 资料 / 视频课程（下划线式） */}
        <div className="relative px-5 flex gap-6">
          <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ height: 1, background: 'var(--line)' }} />
          {VIEWS.map(t => {
            const active = view === t.v
            return (
              <button
                key={t.v}
                onClick={() => switchView(t.v)}
                className="pb-2.5 text-sm font-semibold transition-all duration-200 tap"
                style={{
                  borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  color: active ? 'var(--accent)' : 'var(--text-3)',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {/* 二级 Tag 筛选（横向滚动，全局已隐藏滚动条）+ 右侧「顺序 / 倒序」开关 */}
        <div className="px-5 pt-3 pb-1 flex items-center gap-2">
          <div className="flex gap-2 overflow-x-auto flex-1 min-w-0">
            {chips.map(t => {
              const active = chip === t.v
              return (
                <button
                  key={t.v || 'all'}
                  onClick={() => setChip(t.v)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold shrink-0 tap"
                  style={{
                    background: active ? 'var(--accent-weak)' : 'var(--track)',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                    border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>

          {/* 顺序 / 倒序：只反转展示顺序，不改变管理员排定的顺序本身 */}
          <button
            onClick={() => setOrder(o => (o === 'desc' ? 'asc' : 'desc'))}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold tap"
            style={{
              background: order === 'asc' ? 'var(--accent-weak)' : 'var(--surface-raised)',
              color: order === 'asc' ? 'var(--accent)' : 'var(--text-2)',
              border: `1px solid ${order === 'asc' ? 'var(--accent-border)' : 'var(--line)'}`,
            }}
            title="切换顺序 / 倒序（系列、资料、视频一起变）"
            aria-label={`当前${order === 'desc' ? '顺序' : '倒序'}，点击切换`}
          >
            <SortIcon size={12} />
            {order === 'desc' ? '顺序' : '倒序'}
          </button>
        </div>

        {error && (
          <div className="px-5 pt-3">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
            </div>
          </div>
        )}

        {items === null && !error ? (
          <p className="text-sm py-24 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
        ) : (
          <>
            {/* ① 系列层：大类下的系列卡（点进系列详情页） */}
            {visibleSeries.length > 0 && (
              <div className="px-5 mt-4">
                <div className="flex items-center justify-between px-0.5 mb-3">
                  <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--text-3)' }}>
                    {view === 'video' ? '系列课程' : '资料系列'}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{visibleSeries.length} 个系列</span>
                </div>
                <div className="flex flex-col gap-3">
                  {visibleSeries.map(s => (
                    <SeriesCard key={s.id} series={s} onOpen={() => onOpenSeries(s)} />
                  ))}
                </div>
              </div>
            )}

            {/* ② 散资料层：未归入系列的资料直接平铺 */}
            <div className="px-5 mt-6">
              {list.length === 0 && visibleSeries.length === 0 ? (
                <div className="flex flex-col items-center py-16 gap-4 px-4 text-center">
                  <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                    <span style={{ color: 'var(--accent)' }}>{view === 'video' ? <PlayIcon size={26} /> : <BookIcon size={28} />}</span>
                  </div>
                  <div className="font-medium" style={{ color: 'var(--text-2)' }}>{emptyHint}</div>
                  <div className="text-sm" style={{ color: 'var(--text-3)' }}>
                    管理员在后台「资料库」上传后，这里会自动出现
                  </div>
                </div>
              ) : (
                <>
                  {(looseList.length > 0 || visibleSeries.length === 0) && (
                    <div className="flex items-center justify-between px-0.5 mb-3">
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--text-3)' }}>
                        {visibleSeries.length > 0
                          ? (view === 'video' ? '其他视频' : '其他资料')
                          : (view === 'video' ? '课程视频' : '推荐教材与资料')}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        共 {looseList.length} {view === 'video' ? '个视频' : '份资源'}
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {view === 'video'
                      ? shown.map((item, i) => (
                          <VideoCard key={item.id} item={item} index={i} onOpen={() => onOpenVideo(item.id)} />
                        ))
                      : shown.map(item => (
                          <DocCard key={item.id} item={item} onOpen={() => setPreviewDoc(item)} />
                        ))}
                  </div>

                  {/* 分批渲染哨兵：滚到这里就自动补下一批 */}
                  {hasMore && (
                    <div ref={sentinelRef} className="flex items-center justify-center py-5">
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        正在加载更多…（已显示 {shown.length} / {looseList.length}）
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* 观看历史入口：看过的视频都会记录在这里 */}
        {view === 'video' && (
          <div className="px-5 mt-6">
            <p className="text-xs font-medium mb-3 px-1" style={{ color: 'var(--text-2)' }}>观看记录</p>
            <button
              onClick={() => onNavigate('watch-history')}
              className="w-full card px-4 py-3.5 flex items-center gap-4 card-tap"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}><ClockIcon size={18} /></span>
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>观看历史</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>看过的视频都在这里</div>
              </div>
              <ChevronRightIcon size={15} color="var(--text-3)" />
            </button>
          </div>
        )}
      </div>

      {/* 文档预览浮层（pdf 原生查看器 / docx 渲染 / Excel 表格） */}
      {previewDoc && <DocViewer item={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </div>
  )
}
