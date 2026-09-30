import React, { useEffect, useState } from 'react'
import { libraryApi, type MaterialItem } from '../api/client'
import { VideoCard } from '../components/VideoCard'
import { ChevronLeftIcon, HeartIcon } from '../components/icons'

/* ============================================================
   我的收藏（视频收藏列表）
   数据源：GET /api/library/favorites —— 按收藏时间倒序，带播放量/收藏数
   点卡片进视频详情页（详情页可取消收藏，返回本页自动刷新）
   修改注意：根元素必须是唯一一个 .scroll-area（FRONTEND.md §11 滚动结构约定）
   ============================================================ */

interface FavoriteVideosScreenProps {
  onBack: () => void
  onOpenVideo: (materialId: number) => void
}

export function FavoriteVideosScreen({ onBack, onOpenVideo }: FavoriteVideosScreenProps) {
  const [items, setItems] = useState<MaterialItem[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    libraryApi
      .favorites()
      .then(res => {
        if (!cancelled) setItems(res.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setItems([])
          setError(err instanceof Error ? err.message : '收藏列表加载失败')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

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
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>我的收藏</h1>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {items === null ? '加载中…' : `共 ${items.length} 个视频`}
            </p>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-3">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
            </div>
          </div>
        )}

        <div className="px-5 mt-2">
          {items === null ? (
            <p className="text-sm py-16 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-4 px-4 text-center">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}><HeartIcon size={26} /></span>
              </div>
              <div className="font-medium" style={{ color: 'var(--text-2)' }}>还没有收藏的视频</div>
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>
                在视频详情页点「收藏」，这里就能随时回看
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {items.map((item, i) => (
                <VideoCard key={item.id} item={item} index={i} showFavorited onOpen={() => onOpenVideo(item.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
