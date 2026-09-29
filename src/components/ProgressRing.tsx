import React from 'react'

/* ============================================================
   环形进度（苹果式浅色规范）
   - 默认轨道浅灰 #EDEFF2，进度默认低饱和蓝绿主色
   - 保留 gradient 参数兼容旧调用，默认不使用
   ============================================================ */

interface ProgressRingProps {
  progress: number         // 0-100
  size?: number            // px
  strokeWidth?: number
  color?: string
  trackColor?: string
  gradient?: [string, string]
  gradientId?: string
  children?: React.ReactNode
  className?: string
  animate?: boolean
}

export function ProgressRing({
  progress,
  size = 80,
  strokeWidth = 6,
  color = '#5F8D8C',
  trackColor = '#EDEFF2',
  gradient,
  gradientId = 'ring-grad',
  children,
  className = '',
  animate = true,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress / 100)

  const strokeColor = gradient ? `url(#${gradientId})` : color

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        {gradient && (
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="100%" stopColor={gradient[1]} />
            </linearGradient>
          </defs>
        )}
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={animate ? { transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)' } : undefined}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  )
}

interface MiniRingProps {
  progress: number
  color?: string
  size?: number
}

export function MiniRing({ progress, color = '#5F8D8C', size = 32 }: MiniRingProps) {
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress / 100)

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#EDEFF2" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
      />
    </svg>
  )
}
