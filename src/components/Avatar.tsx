import React from 'react'
import { getAvatarPreset, isUploadedAvatar } from '../data/avatars'

/* ============================================================
   头像组件 —— 全站统一渲染用户头像
   三种来源（优先级从高到低）：
     1. value 是本地上传图片（data URL / http）→ 直接 <img>
     2. value 是预设头像 "preset:N"          → 渐变圆底 + emoji
     3. 其它 / 空                            → 昵称首字 + 主色底
   用法：
     <Avatar value={profile.avatar} name={profile.nickname} size={64} online />
   修改注意：
     - 预设头像的颜色与图案在 src/data/avatars.ts，不要在本文件写死
   ============================================================ */

interface AvatarProps {
  /** 头像值：preset:N / data URL / http 链接 / 空 */
  value?: string
  /** 昵称或账号，空头像时取首字兜底 */
  name?: string
  /** 直径（px） */
  size?: number
  /** 是否显示右下角在线状态小圆点 */
  online?: boolean
  className?: string
  style?: React.CSSProperties
}

export function Avatar({ value = '', name = '', size = 64, online = false, className = '', style }: AvatarProps) {
  const preset = getAvatarPreset(value)
  const uploaded = isUploadedAvatar(value)
  const initial = (name || '').trim().slice(0, 1) || '学'

  const background = preset
    ? `linear-gradient(160deg, ${preset.from} 0%, ${preset.to} 100%)`
    : 'rgba(95,141,140,0.16)'

  const dotSize = Math.max(10, Math.round(size * 0.22))

  return (
    <div
      className={`relative flex-shrink-0 ${className}`}
      style={{ width: size, height: size, ...style }}
    >
      <div
        className="w-full h-full overflow-hidden flex items-center justify-center"
        style={{
          borderRadius: '50%',
          background,
          border: '1px solid rgba(255,255,255,0.9)',
          boxShadow:
            'inset 1px 1px 0 var(--inset-hi), inset -1px -1px 0 rgba(95,141,140,0.12), 0 4px 12px rgba(95,141,140,0.18)',
        }}
      >
        {uploaded ? (
          <img
            src={value}
            alt={name || '头像'}
            className="w-full h-full"
            style={{ objectFit: 'cover' }}
            draggable={false}
          />
        ) : preset ? (
          <span style={{ fontSize: Math.round(size * 0.46), lineHeight: 1 }}>{preset.emoji}</span>
        ) : (
          <span
            className="font-bold"
            style={{ fontSize: Math.round(size * 0.4), color: 'var(--accent)', lineHeight: 1 }}
          >
            {initial}
          </span>
        )}
      </div>

      {online && (
        <div
          className="absolute -bottom-0.5 -right-0.5 rounded-full"
          style={{ width: dotSize, height: dotSize, background: 'var(--ok)', border: '2px solid var(--bg)' }}
        />
      )}
    </div>
  )
}
