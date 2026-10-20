import React, { useState } from 'react'
import { musicApi, type MusicTrackItem } from '../api/client'
import { formatCount, formatMoment } from '../data/format'
import { MusicIcon } from '../components/icons'

/* ============================================================
   音乐历史 / 收藏行（「我的 → 观看历史 / 我的收藏」两页共用）
   - 左侧方形封面：管理员上传的封面图，没传回落音符图标占位
   - 中间歌名 / 歌手·播放量 / 时间说明
   - 右侧动作区（爱心 / ✕ 由页面传入，这里只管展示）
   颜色全部走语义令牌（深浅色主题自适配），见 FRONTEND.md 深色模式红线
   ============================================================ */

function MusicThumb({ item }: { item: MusicTrackItem }) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className="relative flex h-[60px] w-[60px] flex-shrink-0 items-center justify-center overflow-hidden rounded-xl"
      style={{ background: 'var(--track)' }}
    >
      {item.has_cover && !failed ? (
        <img
          src={musicApi.coverUrl(item.id)}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span style={{ color: 'var(--accent)', opacity: 0.5 }}><MusicIcon size={22} /></span>
      )}
    </div>
  )
}

export function MusicRow({ item, note, action, onOpen }: {
  item: MusicTrackItem
  /** 副标题说明（收藏时间 / 最近播放时间等，已格式化好的字符串） */
  note?: string
  /** 右侧动作按钮（收藏爱心 / 移除 ✕），由页面自渲染 */
  action?: React.ReactNode
  onOpen: () => void
}) {
  return (
    <div className="card p-2.5 flex items-center gap-3">
      <button onClick={onOpen} className="flex items-center gap-3 flex-1 min-w-0 text-left tap">
        <MusicThumb item={item} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{item.title}</p>
          <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--text-3)' }}>
            {item.artist || '未知歌手'} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(item.play_count)}</span>次播放
          </p>
          {note && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{note}</p>
          )}
        </div>
      </button>
      {action && <div className="flex-shrink-0 flex items-center gap-1">{action}</div>}
    </div>
  )
}

/** 收藏列表的「收藏时间」说明文案 */
export function favNote(item: MusicTrackItem) {
  return item.favorited_at ? `收藏于 ${formatMoment(item.favorited_at)}` : undefined
}

/** 历史列表的「最近播放时间」说明文案 */
export function playedNote(item: MusicTrackItem) {
  return item.played_at ? `最近播放 ${formatMoment(item.played_at)}` : undefined
}
