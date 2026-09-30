import React, { useState } from 'react'
import { libraryApi, type MaterialItem } from '../api/client'
import { PlayIcon, EyeIcon, HeartIcon } from './icons'
import { formatCount, formatDuration, formatSize } from '../data/format'

/* ============================================================
   视频卡片（考生端共用：教材/视频页的视频流 + 我的收藏页）
   封面优先级：
     1. 管理员上传的自定义封面（has_cover = true → GET /library/{id}/cover）
     2. 自动取视频首帧（<video preload="metadata" src="…#t=0.1">）
     3. 兜底：主色浅底 + 线性图标（首帧也取不到时，卡片不会空白）
   底部一行：播放量（每次打开 +1）· 收藏数
   修改注意：
     - 图标只用 icons.tsx 的线性图标，颜色只用 var(--token)（深色模式）
     - 点卡片由父级 onOpen 决定去详情页还是别的行为
   ============================================================ */

/** 逐张错落的高度比例，做出双列瀑布流的观感 */
const VIDEO_ASPECTS = ['4 / 5', '1 / 1', '3 / 4', '5 / 6']

interface VideoCardProps {
  item: MaterialItem
  /** 卡片序号（决定高度比例，做瀑布流错落） */
  index?: number
  onOpen: () => void
  /** 是否显示「已收藏」小标（我的收藏页用） */
  showFavorited?: boolean
}

export function VideoCard({ item, index = 0, onOpen, showFavorited = false }: VideoCardProps) {
  const [framed, setFramed] = useState(false)
  const [duration, setDuration] = useState('')
  const [coverFailed, setCoverFailed] = useState(false)
  const useCover = item.has_cover && !coverFailed

  return (
    <button onClick={onOpen} className="card overflow-hidden flex flex-col card-tap text-left">
      <div
        className="w-full relative overflow-hidden"
        style={{ aspectRatio: VIDEO_ASPECTS[index % VIDEO_ASPECTS.length], background: 'var(--track)' }}
      >
        {/* 兜底底图：封面与首帧都没出来时也不空白 */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(155deg, var(--accent-weak), var(--track))' }}
        >
          <span style={{ color: 'var(--accent)', opacity: 0.30 }}><PlayIcon size={40} /></span>
        </div>

        {/* 自动首帧：既当封面兜底，也用来读真实时长 */}
        <video
          src={`${libraryApi.fileUrl(item.id)}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          onLoadedData={e => {
            setFramed(true)
            setDuration(formatDuration(e.currentTarget.duration))
          }}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: !useCover && framed ? 1 : 0, transition: 'opacity 0.3s ease' }}
        />

        {/* 管理员指定的自定义封面 */}
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

        {/* 底部柔和压暗，保证角标可读 */}
        <div
          className="absolute inset-x-0 bottom-0 pointer-events-none"
          style={{ height: '42%', background: 'linear-gradient(to top, rgba(20,24,28,0.55), rgba(20,24,28,0))' }}
        />

        {/* 播放键 */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.30)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
          >
            <PlayIcon size={17} color="#FFFFFF" />
          </div>
        </div>

        {/* 方向徽标 / 时长 */}
        {item.method && (
          <span
            className="absolute top-2 left-2 text-[9px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.88)', color: 'var(--accent)' }}
          >
            {item.method}
          </span>
        )}
        {showFavorited && (
          <span
            className="absolute top-2 right-2 text-[9px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(20,24,28,0.55)', color: '#FFFFFF' }}
          >
            已收藏
          </span>
        )}
        {duration && (
          <span
            className="absolute bottom-2 right-2 text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(20,24,28,0.60)', color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}
          >
            {duration}
          </span>
        )}
      </div>

      {/* 标题与互动数据 */}
      <div className="p-2.5 flex-1 flex flex-col justify-between">
        <p className="text-xs font-bold line-clamp-2 leading-snug" style={{ color: 'var(--text-1)' }}>{item.title}</p>
        <div className="mt-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
            <EyeIcon size={12} color="var(--text-3)" />
            {formatCount(item.view_count)}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-3)' }}>
            <HeartIcon size={12} color="var(--text-3)" />
            {formatCount(item.fav_count)}
          </span>
        </div>
        {item.description ? (
          <p className="text-[10px] mt-1 line-clamp-1" style={{ color: 'var(--text-3)' }}>{item.description}</p>
        ) : (
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>{formatSize(item.file_size)}</p>
        )}
      </div>
    </button>
  )
}
