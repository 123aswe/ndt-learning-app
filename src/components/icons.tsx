import React from 'react'

/* ============================================================
   极简线性图标库（NDT-劳人 · 苹果式设计规范）
   - 全部为 24 viewBox 线性图标，stroke 统一 1.7，圆头端点
   - 用 color 继承当前文字颜色（默认 currentColor）
   - 新增图标先查本文件，风格统一：克制、均匀、无填充装饰
   修改注意：不要给单个图标加渐变/发光/填充，保持线条一致。
   ============================================================ */

interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
  color?: string
}

function base({ size = 20, strokeWidth = 1.7, className = '', color }: IconProps, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke={color || 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/* ── 底部导航 ── */
export const HomeIcon = (p: IconProps) => base(p, <path d="M3 10.5 12 3l9 7.5V21h-5.5v-6h-7v6H3z" />)
export const GridIcon = (p: IconProps) => base(p, (
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
  </>
))
export const WrongIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
  </>
))
export const ChartIcon = (p: IconProps) => base(p, (
  <>
    <path d="M4 20h16" />
    <path d="M6.5 16.5v-5M12 16.5v-9M17.5 16.5v-3" />
  </>
))
export const UserIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.8 20c.9-3.3 3.9-5.2 7.2-5.2s6.3 1.9 7.2 5.2" />
  </>
))

/* ── 通用 ── */
export const BellIcon = (p: IconProps) => base(p, (
  <>
    <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.6 2.3 6 2.3 6H4.2s2.3-1.4 2.3-6" />
    <path d="M10 19.5a2.1 2.1 0 0 0 4 0" />
  </>
))
export const SearchIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="11" cy="11" r="6.6" />
    <path d="M16 16l4.4 4.4" />
  </>
))
export const ChevronRightIcon = (p: IconProps) => base(p, <path d="M9 5.5l6.5 6.5L9 18.5" />)
export const ChevronLeftIcon = (p: IconProps) => base(p, <path d="M15 5.5 8.5 12l6.5 6.5" />)
export const CheckIcon = (p: IconProps) => base(p, <path d="M4.5 12.5l5 5 10-11" />)
export const XIcon = (p: IconProps) => base(p, <path d="M6 6l12 12M18 6L6 18" />)
export const HeartIcon = (p: IconProps) => base(p, <path d="M12 20s-7.5-4.7-9.2-9.1C1.4 7.5 3.4 4.8 6.2 4.8c2 0 3.6 1.1 4.4 2.6h2.8c.8-1.5 2.4-2.6 4.4-2.6 2.8 0 4.8 2.7 3.4 6.1C19.5 15.3 12 20 12 20z" />)
export const ClockIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.2V12l3.2 1.9" />
  </>
))
export const TargetIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
  </>
))
export const PencilIcon = (p: IconProps) => base(p, (
  <>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19l-4 1z" />
    <path d="M14.5 6.5l3 3" />
  </>
))
export const BookIcon = (p: IconProps) => base(p, (
  <>
    <path d="M4 4.8A2.6 2.6 0 0 1 6.6 2.8H11v15.6H6.6A2.6 2.6 0 0 0 4 21z" />
    <path d="M20 4.8a2.6 2.6 0 0 0-2.6-2H13v15.6h4.4A2.6 2.6 0 0 1 20 21z" />
  </>
))
export const AwardIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="9" r="5.6" />
    <path d="M8.6 13.8 7 21l5-2.8L17 21l-1.6-7.2" />
  </>
))
export const GearIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7" />
  </>
))
/* 火焰：双层轮廓 + 内芯，更精细（用于连续打卡） */
export const FlameIcon = (p: IconProps) => base(p, (
  <>
    <path d="M12 21.4c-4.1 0-7-2.8-7-6.5 0-3.2 2.4-5.2 4-6.8.9-.9 1.6-2.1 1.9-3.6 3.8 1.8 6.1 5.2 6.1 8.4 0 1.9-.6 3.5-1.6 4.9" />
    <path d="M12 21.4c-2.5 0-4.2-1.5-4.2-3.7 0-2.2 1.5-3.4 2.7-4.5.9 1.2 1.5 2.2 1.5 3.3" />
  </>
))
export const PercentIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9 15.4l6-6.8" />
    <path d="M9.1 9.2h.01M14.9 14.8h.01" />
  </>
))
export const ZapIcon = (p: IconProps) => base(p, <path d="M13 3 5 13.5h5.4L9.6 21 19 10.5h-5.6z" />)
export const StarIcon = (p: IconProps) => base(p, <path d="M12 3.6l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" />)
export const ActivityIcon = (p: IconProps) => base(p, (
  <path d="M3 12h4l2.5-6.5L14 18l2.5-6H21" />
))
export const ShuffleIcon = (p: IconProps) => base(p, (
  <>
    <path d="M3 6.5h3.5c3 0 4.5 3.5 6.5 5.5s3.5 5.5 6.5 5.5H21" />
    <path d="M18 3.5 21 6.5l-3 3M3 17.5h3.5c1.2 0 2.3-.5 3.3-1.2M17 14.5l4 3-4 3" />
  </>
))
export const ClipboardIcon = (p: IconProps) => base(p, (
  <>
    <rect x="5" y="4.5" width="14" height="16.5" rx="2.2" />
    <path d="M9 4.5V3.6A1.6 1.6 0 0 1 10.6 2h2.8A1.6 1.6 0 0 1 15 3.6v.9" />
    <path d="M9 10.5h6M9 14.5h6" />
  </>
))
export const WrenchIcon = (p: IconProps) => base(p, (
  <path d="M14.5 6.5a4.5 4.5 0 0 0-6 5.6L3.4 17.2a2 2 0 0 0 2.8 2.8l5.1-5.1a4.5 4.5 0 0 0 5.6-6l-3 3-2.4-.6-.6-2.4z" />
))
export const LayersIcon = (p: IconProps) => base(p, (
  <>
    <path d="M12 3.5 21 8l-9 4.5L3 8z" />
    <path d="M3 12.5l9 4.5 9-4.5" />
  </>
))
export const FilterIcon = (p: IconProps) => base(p, (
  <>
    <path d="M4 6.5h16" />
    <path d="M7.5 12h9" />
    <path d="M10.5 17.5h3" />
  </>
))
export const RefreshIcon = (p: IconProps) => base(p, (
  <>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
    <path d="M4 3.5v3.6h3.6" />
  </>
))
export const PlayIcon = (p: IconProps) => base(p, <path d="M8 5.5v13l10-6.5z" />)
export const CalendarIcon = (p: IconProps) => base(p, (
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
    <path d="M3.5 9.5h17M8 3v3.4M16 3v3.4" />
  </>
))
export const ListIcon = (p: IconProps) => base(p, (
  <>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4 6.5h.5M4 12h.5M4 17.5h.5" />
  </>
))
export const InfoIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11.5v4.2" />
    <path d="M12 8.2h.01" />
  </>
))
export const SendIcon = (p: IconProps) => base(p, <path d="M4 12 20 4l-4.5 16-3.5-5.5z" />)
export const FlagIcon = (p: IconProps) => base(p, (
  <>
    <path d="M5 21V4.5" />
    <path d="M5 5c4-2.4 8 2.4 14 0v9c-6 2.4-10-2.4-14 0" />
  </>
))
export const RulerIcon = (p: IconProps) => base(p, (
  <>
    <rect x="3" y="9" width="18" height="7" rx="1.6" transform="rotate(-45 12 12.5)" />
    <path d="m8.4 8.4 1.4 1.4M11.6 11.6l1.4 1.4M14.8 14.8l1.4 1.4" />
  </>
))
export const CheckCircleIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M8.2 12.4l2.6 2.6 5-5.4" />
  </>
))
export const XCircleIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
  </>
))
