import React, { useCallback, useEffect, useState } from 'react'
import { libraryApi, musicApi, type MaterialItem, type MusicTrackItem } from '../api/client'
import { VideoCard } from '../components/VideoCard'
import { MusicRow, favNote } from '../components/MusicRow'
import { ChevronLeftIcon, HeartIcon, MusicIcon } from '../components/icons'

/* ============================================================
   我的收藏（视频 + 音乐，v1.45 起音乐收藏也在这里）
   数据源：
     - 视频：GET /api/library/favorites —— 按收藏时间倒序，带播放量/收藏数
     - 音乐：GET /api/music/favorites —— 按收藏时间倒序（音乐页爱心 / 列表收藏）
   分类：顶部「全部 / 视频 / 音乐」分段切换
   点视频卡片进视频详情页（详情页可取消收藏，返回本页自动刷新）；
   点音乐条目跳音乐 Tab 播放这首。
   修改注意：根元素必须是唯一一个 .scroll-area（FRONTEND.md §11 滚动结构约定）
   ============================================================ */

type FavTab = 'all' | 'video' | 'music'

const TABS: Array<{ id: FavTab; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'video', label: '视频' },
  { id: 'music', label: '音乐' },
]

interface FavoriteVideosScreenProps {
  onBack: () => void
  onOpenVideo: (materialId: number) => void
  /** 点音乐条目：跳音乐 Tab 播放这首 */
  onOpenMusic: (trackId: number) => void
}

export function FavoriteVideosScreen({ onBack, onOpenVideo, onOpenMusic }: FavoriteVideosScreenProps) {
  const [videos, setVideos] = useState<MaterialItem[] | null>(null)
  const [music, setMusic] = useState<MusicTrackItem[] | null>(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<FavTab>('all')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await libraryApi.favorites()
        if (!cancelled) setVideos(res.items)
      } catch (err: unknown) {
        if (!cancelled) {
          setVideos([])
          setError(err instanceof Error ? err.message : '收藏列表加载失败')
        }
      }
      try {
        const res = await musicApi.favorites()
        if (!cancelled) setMusic(res.items)
      } catch {
        if (!cancelled) setMusic([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* 取消音乐收藏（爱心点亮状态再点一下取消，本地即时摘除） */
  const unfavoriteMusic = useCallback(async (id: number) => {
    setMusic(prev => (prev ? prev.filter(x => x.id !== id) : prev))
    try {
      await musicApi.favorite(id)
    } catch { /* 失败不回滚，下次进页以服务端为准 */ }
  }, [])

  const videoCount = videos?.length ?? 0
  const musicCount = music?.length ?? 0
  const totalCount = videoCount + musicCount
  const shownVideos = tab === 'music' ? [] : (videos ?? [])
  const shownMusic = tab === 'video' ? [] : (music ?? [])
  const loading = videos === null || music === null

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" style={{ paddingBottom: 56 }}>
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
              {loading ? '加载中…' : `共 ${totalCount} 条（视频 ${videoCount} · 音乐 ${musicCount}）`}
            </p>
          </div>
        </div>

        {/* 分类：全部 / 视频 / 音乐 */}
        <div className="px-5 pb-2 flex items-center gap-2">
          {TABS.map(t => {
            const a = t.id === tab
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="text-xs font-semibold px-3.5 py-1.5 rounded-full tap transition-colors"
                style={{
                  background: a ? 'var(--accent)' : 'var(--chip-bg)',
                  color: a ? 'var(--on-accent)' : 'var(--text-2)',
                  border: `1px solid ${a ? 'transparent' : 'var(--chip-border)'}`,
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="px-5 pb-3">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
            </div>
          </div>
        )}

        <div className="px-5 mt-2">
          {loading ? (
            <p className="text-sm py-16 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
          ) : shownVideos.length === 0 && shownMusic.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-4 px-4 text-center">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}><HeartIcon size={26} /></span>
              </div>
              <div className="font-medium" style={{ color: 'var(--text-2)' }}>还没有收藏内容</div>
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>
                视频详情页点「收藏」、音乐播放页点爱心，这里就能随时回看
              </div>
            </div>
          ) : (
            <>
              {shownVideos.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {shownVideos.map((item, i) => (
                    <VideoCard key={item.id} item={item} index={i} showFavorited onOpen={() => onOpenVideo(item.id)} />
                  ))}
                </div>
              )}

              {shownMusic.length > 0 && (
                <div className={shownVideos.length > 0 ? 'mt-3 space-y-2.5' : 'space-y-2.5'}>
                  {shownMusic.map(item => (
                    <MusicRow
                      key={`mf-${item.id}`}
                      item={item}
                      note={favNote(item)}
                      onOpen={() => onOpenMusic(item.id)}
                      action={
                        <button
                          onClick={() => void unfavoriteMusic(item.id)}
                          aria-label="取消收藏"
                          className="w-8 h-8 rounded-full flex items-center justify-center tap"
                          style={{ color: '#F5484B' }}
                        >
                          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                            <path d="M12 20s-7.5-4.9-9.1-9.2C1.5 7.4 3.5 4.9 6.3 4.9c1.9 0 3.5 1 4.3 2.4h2.8c.8-1.4 2.4-2.4 4.3-2.4 2.8 0 4.8 2.5 3.4 5.9C19.5 15.1 12 20 12 20z" />
                          </svg>
                        </button>
                      }
                    />
                  ))}
                  <p className="text-[10px] text-center pt-1 flex items-center justify-center gap-1" style={{ color: 'var(--text-3)' }}>
                    <MusicIcon size={11} color="var(--text-3)" />
                    点右侧红心取消收藏；点条目去音乐页播放
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
