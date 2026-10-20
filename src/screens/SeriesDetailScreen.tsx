import React, { useEffect, useMemo, useState } from 'react'
import { libraryApi, type MaterialItem, type MaterialSeries } from '../api/client'
import { ChevronLeftIcon, ChevronRightIcon, BookIcon, PlayIcon, ListIcon, EyeIcon, SortIcon } from '../components/icons'
import { DocViewer } from '../components/DocViewer'
import { VideoCard } from '../components/VideoCard'
import { formatSize, formatCount } from '../data/format'
import { loadLibOrder, saveLibOrder } from '../data/libraryOrder'

/* ============================================================
   系列详情页（考生端「教材 / 视频」→ 点系列卡进入）
   展示一个系列里的全部资料：
     - 视频类 → 双列视频流（VideoCard，点进视频详情页）
     - 文档类 → iOS 内嵌分组列表（行首序号 + 缩进细线，点开 DocViewer 预览）
   数据：GET /api/library?series_id=N（按管理员排定的顺序返回）
   「顺序 / 倒序」切换：就地反转视频列表与文档列表（服务端顺序不变）
   修改注意：
     - 颜色一律用 var(--token)，不要写死 hex（深色模式）
     - 系列内可能同时有视频和文档，两种卡片按 kind 分流渲染
   ============================================================ */

interface SeriesDetailScreenProps {
  series: MaterialSeries
  /** 返回上一页（大类页） */
  onBack: () => void
  /** 点视频卡 → 视频详情页 */
  onOpenVideo: (materialId: number) => void
}

/** 副标题去重：描述基本就是标题的复读（如标题「第8章 xx检测 (1)」/描述「xx检测 (1)」）时不显示，
 *  判据：互相包含即视为重复 —— 长列表里少一行噪音，行高也更整齐 */
function subtitleOf(item: MaterialItem): string {
  const desc = (item.description || '').trim()
  if (!desc) return ''
  const title = item.title.trim()
  if (title.includes(desc) || desc.includes(title)) return ''
  return desc
}

/** 文档行：iOS 内嵌分组列表的行 —— 序号 + 标题 + 右侧格式/大小
 *  index 从 0 起（行首序号显示 01、02…），first 控制是否带分隔线 */
function DocRow({ item, index, first, onOpen }: { item: MaterialItem; index: number; first: boolean; onOpen: () => void }) {
  const ext = item.file_name.split('.').pop()?.toUpperCase() || '资料'
  const sub = subtitleOf(item)
  return (
    <>
      {!first && <div style={{ height: 1, background: 'var(--line)', marginLeft: 54 }} aria-hidden />}
      <button
        onClick={onOpen}
        className="w-full px-3.5 py-3 flex items-center gap-3 tap text-left"
      >
        {/* 行首序号：这个列表多是按章节排的，序号本身就是信息 */}
        <span
          className="w-7 flex-shrink-0 text-[11px] font-bold tabular-nums"
          style={{ color: 'var(--accent)', opacity: 0.85 }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold line-clamp-1" style={{ color: 'var(--text-1)' }}>{item.title}</span>
          {sub && (
            <span className="block text-[10.5px] mt-0.5 line-clamp-1" style={{ color: 'var(--text-3)' }}>{sub}</span>
          )}
        </span>
        {/* 右侧元信息：格式 + 大小 一行排开，弱化处理 */}
        <span className="flex-shrink-0 flex items-center gap-1.5">
          <span className="text-[10px] font-bold" style={{ color: 'var(--accent)' }}>{ext}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{formatSize(item.file_size)}</span>
        </span>
        <ChevronRightIcon size={14} color="var(--text-3)" />
      </button>
    </>
  )
}

export function SeriesDetailScreen({ series, onBack, onOpenVideo }: SeriesDetailScreenProps) {
  const [items, setItems] = useState<MaterialItem[] | null>(null)
  const [error, setError] = useState('')
  const [previewDoc, setPreviewDoc] = useState<MaterialItem | null>(null)
  const [coverFailed, setCoverFailed] = useState(false)
  /** 排序方向：desc = 管理员排定的顺序，asc = 倒序
   *  初值来自本机偏好（与「教材/视频」页共享），切换即写回 —— 退出重进仍保留 */
  const [order, setOrder] = useState<'desc' | 'asc'>(() => loadLibOrder())

  useEffect(() => {
    saveLibOrder(order)
  }, [order])

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError('')
    libraryApi
      .seriesItems(series.id)
      .then(res => {
        if (!cancelled) setItems(res.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '系列内容加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [series.id])

  const all = useMemo(() => items ?? [], [items])
  /** 「倒序」= 整段反过来，视频与文档各翻各的（互不影响） */
  const ordered = useMemo(() => (order === 'asc' ? [...all].reverse() : all), [all, order])
  const videoItems = useMemo(
    () => ordered.filter(it => it.kind === 'video' || it.category === 'video'),
    [ordered],
  )
  const docItems = useMemo(
    () => ordered.filter(it => !(it.kind === 'video' || it.category === 'video')),
    [ordered],
  )
  /** 系列总播放量：把系列内所有资料的播放量加总（概览用，不做单独统计表） */
  const totalViews = useMemo(() => all.reduce((sum, it) => sum + (it.view_count || 0), 0), [all])

  const useCover = series.has_cover && !coverFailed

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" style={{ paddingBottom: 110 }}>
        {/* 顶栏：返回 */}
        <div className="px-4 pt-12 pb-2 flex items-center gap-2">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full flex items-center justify-center tap flex-shrink-0"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)' }}
            aria-label="返回"
          >
            <ChevronLeftIcon size={17} color="var(--text-1)" />
          </button>
          <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-3)' }}>
            {series.category_name} · 系列
          </span>
        </div>

        {/* 系列头部：封面 + 名称 + 简介 + 概览 */}
        <div className="px-5 pt-1">
          <div
            className="w-full rounded-3xl relative overflow-hidden"
            style={{
              height: 148,
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
              <div className="absolute inset-0 flex items-center justify-center">
                <span style={{ color: 'var(--accent)', opacity: 0.2 }}>
                  {series.category === 'video' ? <PlayIcon size={54} /> : <BookIcon size={56} />}
                </span>
              </div>
            )}
            <span
              className="absolute top-3 left-3 text-[9.5px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: 'var(--surface-raised)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-border)',
              }}
            >
              {series.method ? `${series.method} 方向` : '通用方向'}
            </span>
          </div>

          <h1 className="text-xl font-bold mt-3.5" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>
            {series.title}
          </h1>
          {series.description && (
            <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {series.description}
            </p>
          )}

          <div className="flex items-center gap-4 mt-3">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
              共 {series.item_count} 份内容
            </span>
            {videoItems.length > 0 && (
              <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                <EyeIcon size={12} /> {formatCount(totalViews)}
              </span>
            )}
            {/* 顺序 / 倒序：系列里只有一条内容时不给这个按钮（点了也没反应） */}
            {all.length > 1 && (
              <>
                <span className="flex-1" />
                <button
                  onClick={() => setOrder(o => (o === 'desc' ? 'asc' : 'desc'))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold tap"
                  style={{
                    background: order === 'asc' ? 'var(--accent-weak)' : 'var(--surface-raised)',
                    color: order === 'asc' ? 'var(--accent)' : 'var(--text-2)',
                    border: `1px solid ${order === 'asc' ? 'var(--accent-border)' : 'var(--line)'}`,
                  }}
                  title="切换顺序 / 倒序"
                  aria-label={`当前${order === 'desc' ? '顺序' : '倒序'}，点击切换`}
                >
                  <SortIcon size={12} />
                  {order === 'desc' ? '顺序' : '倒序'}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="px-5 pt-4">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}</p>
            </div>
          </div>
        )}

        {/* 主体内容 */}
        <div className="px-5 mt-5">
          {items === null && !error ? (
            <p className="text-sm py-16 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
          ) : all.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 px-4 text-center">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}><ListIcon size={26} /></span>
              </div>
              <div className="font-medium text-sm" style={{ color: 'var(--text-2)' }}>这个系列还在准备中</div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>管理员上传内容后这里就会显示</div>
            </div>
          ) : (
            <>
              {/* 视频部分 */}
              {videoItems.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center justify-between px-0.5 mb-3">
                    <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--text-3)' }}>
                      系列视频
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{videoItems.length} 个</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {videoItems.map((item, i) => (
                      <VideoCard key={item.id} item={item} index={i} onOpen={() => onOpenVideo(item.id)} />
                    ))}
                  </div>
                </div>
              )}

              {/* 文档部分：iOS 内嵌分组列表 —— 整块一个容器，行间缩进细线，
                  行首序号代替每行一块的大图标，几十条也整齐 */}
              {docItems.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between px-0.5 mb-3">
                    <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--text-3)' }}>
                      系列教材与资料
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{docItems.length} 份</span>
                  </div>
                  <div
                    className="rounded-2xl overflow-hidden"
                    style={{
                      background: 'var(--surface-translucent)',
                      border: '1px solid var(--line)',
                      boxShadow: 'var(--glass-shadow)',
                      backdropFilter: 'blur(18px) saturate(150%)',
                      WebkitBackdropFilter: 'blur(18px) saturate(150%)',
                    }}
                  >
                    {docItems.map((item, i) => (
                      <DocRow key={item.id} item={item} index={i} first={i === 0} onOpen={() => setPreviewDoc(item)} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {previewDoc && <DocViewer item={previewDoc} onClose={() => setPreviewDoc(null)} />}
    </div>
  )
}
