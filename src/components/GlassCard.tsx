import React from 'react'

/* ============================================================
   卡片容器（苹果式浅色规范）
   - GlassCard：白底 + 浅灰描边 + 极轻阴影 + 18px 圆角
   - 保留原 props 签名，调用方无需改动
   ============================================================ */

interface GlassCardProps {
  children: React.ReactNode
  className?: string
  variant?: 'sm' | 'md' | 'lg'
  gradient?: boolean
  gradientColors?: [string, string]
  onClick?: () => void
  style?: React.CSSProperties
  noPad?: boolean
}

export function GlassCard({
  children,
  className = '',
  variant = 'md',
  gradient = false,
  gradientColors,
  onClick,
  style,
  noPad = false,
}: GlassCardProps) {
  const surfaceClass = { sm: 'glass', md: 'glass-md', lg: 'glass-lg' }[variant]

  return (
    <div
      onClick={onClick}
      className={`relative rounded-[18px] ${surfaceClass} ${noPad ? '' : 'p-4'} ${onClick ? 'card-tap' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}
