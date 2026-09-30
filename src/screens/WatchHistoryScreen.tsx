import React, { useCallback, useEffect, useState } from 'react'
import { libraryApi, type MaterialItem } from '../api/client'
import { formatCount, formatMoment } from '../data/format'
import { ChevronLeftIcon, EyeIcon, PlayIcon, TrashIcon, XIcon } from '../components/icons'

/* ============================================================
   观看历史（我的 → 观看历史 / 教材视频页底部入口）
   数据源：GET /api/library/history —— 我打开过的视频，按最近观看时间倒序，
           同一视频只出现一次（带「最近观看时间」与「我看过几次」）
   操作：点条目进视频详情页；单条移除 / 一键清空（都是隐藏标记，不删播放记录
        → 视频的播放量不受影响；之后再看一次会自动回到历史里）
   修改注意：
     - 根元素必须是唯一一个 .scroll-area（本工程滚动结构约定，见 FRONTEND.md §11）
     - 颜色一律 var(--token)；缩略图三级兜底：管理员封面 → 视频首帧 → 渐变占位
   ============================================================ */

interface WatchHistoryScreenProps {
  onBack: () => void
  onOpenVideo: (materialId: number) => void
}

/** 列表左侧缩略图（16:10 小图，封面/首帧/渐变三级兜底） */
function HistoryThumb({ item }: { item: MaterialItem }) {
  const [framed, setFramed] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)
  const useCover = item.has_cover && !coverFailed

  return (
    <div
      className="relative rounded-xl overflow-hidden flex-shrink-0"
      style={{ width: 96, height: 60, background: 'var(--track)' }}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: 'linear-gradient(155deg, var(--accent-weak), var(--track))' }}
      >
        <span style={{ color: 'var(--accent)', opacity: 0.3 }}><PlayIcon size={20} /></span>
      </div>
      <video
        src={`${libraryApi.fileUrl(item.id)}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        aria-hidden="true"
        onLoadedData={() => setFramed(true)}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ opacity: !useCover && framed ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />
      {item.has_cover && (
        <img
          src={libraryApi.coverUrl(item.id)}
          alt=""
          aria-hidden="true"
          onError={() => setCoverFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: useCover ? 1 : 0, transition: 'opacity 0.3s ease' }}
        />
      )}
    </div>
  )
}

export function WatchHistoryScreen({ onBack, onOpenVideo }: WatchHistoryScreenProps) {
  const [items, setItems] = useState<MaterialItem[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 两步确认清空（第一步点「清空」→ 变成「确认清空？」） */
  const [confirmClear, setConfirmClear] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await libraryApi.history()
      setItems(res.items)
    } catch (err: unknown) {
      setItems([])
      setError(err instanceof Error ? err.message : '观看历史加载失败')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await libraryApi.history()
        if (!cancelled) setItems(res.items)
      } catch (err: unknown) {
        if (!cancelled) {
          setItems([])
          setError(err instanceof Error ? err.message : '观看历史加载失败')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* 单条移除：先本地摘掉（即时反馈），失败再拉回真实列表 */
  const removeOne = useCallback(async (id: number) => {
    setItems(prev => (prev ? prev.filter(x => x.id !== id) : prev))
    try {
      await libraryApi.removeHistory(id)
    } catch {
      await load()
    }
  }, [load])

  const clearAll = useCallback(async () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setBusy(true)
    try {
      await libraryApi.clearHistory()
      setItems([])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '清空失败')
    } finally {
      setBusy(false)
      setConfirmClear(false)
    }
  }, [confirmClear])

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 56 }}>
        {/* 顶栏 */}
        <div className="px-5 pt-12 pb-3 flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="返回"
            className="w-9 h-9 rounded-full flex items-center justify-center tap"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-2)' }}
          >
            <ChevronLeftIcon size={17} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>观看历史</h1>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {items === null ? '加载中…' : `共 ${items.length} 个视频`}
            </p>
          </div>
          {items && items.length > 0 && (
            <button
              onClick={clearAll}
              disabled={busy}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-full tap flex items-center gap-1"
              style={{
                background: confirmClear ? 'var(--err)' : 'var(--chip-bg)',
                color: confirmClear ? 'var(--on-accent)' : 'var(--text-2)',
                border: `1px solid ${confirmClear ? 'transparent' : 'var(--chip-border)'}`,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {confirmClear ? <><TrashIcon size={11} /> 确认清空</> : <>清空</>}
            </button>
          )}
          {confirmClear && (
            <button
              onClick={() => setConfirmClear(false)}
              aria-label="取消清空"
              className="w-7 h-7 rounded-full flex items-center justify-center tap flex-shrink-0"
              style={{ background: 'var(--chip-bg)', color: 'var(--text-3)', border: '1px solid var(--chip-border)' }}
            >
              <XIcon size={12} />
            </button>
          )}
        </div>

        {error && (
          <div className="px-5 pb-3">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
            </div>
          </div>
        )}

        <div className="px-4 mt-1 space-y-2.5">
          {items === null ? (
            <p className="text-sm py-16 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-4 px-4 text-center">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}><PlayIcon size={26} /></span>
              </div>
              <div className="font-medium" style={{ color: 'var(--text-2)' }}>还没有观看记录</div>
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>
                在「教材/视频」页打开视频后，这里会自动记录
              </div>
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="card p-2.5 flex items-center gap-3">
                <button onClick={() => onOpenVideo(item.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left tap">
                  <HistoryThumb item={item} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{item.title}</p>
                    <p className="text-[10px] mt-1 inline-flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
                      最近观看 {formatMoment(item.watched_at || '')}
                    </p>
                    <div className="flex items-center gap-2.5 mt-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
                      <span className="inline-flex items-center gap-1">
                        <EyeIcon size={11} color="var(--text-3)" />
                        看过 <span style={{ fontVariantNumeric: 'tabular-nums' }}>{item.my_view_count ?? 1}</span> 次
                      </span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(item.view_count)} 次播放</span>
                      {item.method && (
                        <span className="px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
                          {item.method}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => removeOne(item.id)}
                  aria-label="从观看历史移除"
                  className="w-8 h-8 rounded-full flex items-center justify-center tap flex-shrink-0"
                  style={{ background: 'var(--chip-bg)', color: 'var(--text-3)', border: '1px solid var(--chip-border)' }}
                >
                  <XIcon size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {items && items.length > 0 && (
          <p className="text-[10px] text-center mt-4 px-8 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            从历史里移除不会影响视频的播放量；重新打开视频会再次记录
          </p>
        )}
      </div>
    </div>
  )
}
