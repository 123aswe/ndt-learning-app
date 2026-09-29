import React from 'react'

/* ============================================================
   通用按钮（苹果式浅色规范 · 玻璃按钮三层光影）
   - 光影/渐变/纹理由 index.css `.gb` 系统统一提供
   - primary：半透明低饱和蓝绿；secondary：半透浅灰；ghost：半透白
   - danger / success：半透状态色；glass：半透白玻璃
   修改注意：样式类只改这里与 index.css，页面无需改
   ============================================================ */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'glass'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps {
  children: React.ReactNode
  variant?: Variant
  size?: Size
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
  className?: string
  icon?: React.ReactNode
}

const variantClasses: Record<Variant, string> = {
  primary: 'gb gb-primary',
  secondary: 'gb gb-secondary',
  ghost: 'gb gb-ghost',
  danger: 'gb gb-danger',
  success: 'gb gb-success',
  glass: 'gb gb-glass',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm gb-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-[52px] px-6 text-base gb-lg',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  onClick,
  disabled = false,
  loading = false,
  fullWidth = false,
  className = '',
  icon,
}: ButtonProps) {
  return (
    <button
      onClick={!disabled && !loading ? onClick : undefined}
      disabled={disabled || loading}
      className={`
        relative inline-flex items-center justify-center gap-2
        font-semibold tracking-tight
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
    >
      {loading ? (
        <>
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>加载中…</span>
        </>
      ) : (
        <>
          {icon && <span>{icon}</span>}
          {children}
        </>
      )}
    </button>
  )
}

/* 图标按钮：浅色圆角底 */
export function IconButton({
  icon,
  onClick,
  className = '',
  size = 10,
  glass = false,
}: {
  icon: React.ReactNode
  onClick?: () => void
  className?: string
  size?: number
  glass?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`tap flex items-center justify-center rounded-xl transition-colors duration-100
        ${glass ? 'bg-card border border-line' : 'bg-[#EDEFF2] hover:bg-[#E4E7EA]'}
        ${className}`}
      style={{ width: `${size * 4}px`, height: `${size * 4}px` }}
    >
      {icon}
    </button>
  )
}
