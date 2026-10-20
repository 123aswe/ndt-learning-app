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
/** 系统通知专用：盾牌 + 对勾（区别于普通铃铛，代表官方/系统下发） */
export const ShieldIcon = (p: IconProps) => base(p, (
  <>
    <path d="M12 3.2 19 5.8v5.4c0 4.6-3 7.6-7 9.6-4-2-7-5-7-9.6V5.8z" />
    <path d="M9.2 11.9l2 2 3.6-3.9" />
  </>
))
export const ChevronRightIcon = (p: IconProps) => base(p, <path d="M9 5.5l6.5 6.5L9 18.5" />)
export const ChevronLeftIcon = (p: IconProps) => base(p, <path d="M15 5.5 8.5 12l6.5 6.5" />)
export const CheckIcon = (p: IconProps) => base(p, <path d="M4.5 12.5l5 5 10-11" />)
export const XIcon = (p: IconProps) => base(p, <path d="M6 6l12 12M18 6L6 18" />)
export const HeartIcon = (p: IconProps) => base(p, <path d="M12 20s-7.5-4.7-9.2-9.1C1.4 7.5 3.4 4.8 6.2 4.8c2 0 3.6 1.1 4.4 2.6h2.8c.8-1.5 2.4-2.6 4.4-2.6 2.8 0 4.8 2.7 3.4 6.1C19.5 15.3 12 20 12 20z" />)
/* 播放量 / 浏览量（视频详情页与卡片上的统计用） */
export const EyeIcon = (p: IconProps) => base(p, (
  <>
    <path d="M2.8 12S6.3 6.6 12 6.6 21.2 12 21.2 12 17.7 17.4 12 17.4 2.8 12 2.8 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </>
))
/* 评论（视频详情页评论区） */
export const MessageIcon = (p: IconProps) => base(p, (
  <path d="M20.4 12c0 4-3.8 7.2-8.4 7.2-1 0-1.9-.15-2.8-.42L4.3 20.5l1.3-3.4C4.2 15.7 3.6 14 3.6 12c0-4 3.8-7.2 8.4-7.2s8.4 3.2 8.4 7.2z" />
))
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
export const CameraIcon = (p: IconProps) => base(p, (
  <>
    <path d="M3 9.1A2.6 2.6 0 0 1 5.6 6.5h1.7l1.3-2h6.8l1.3 2h1.7A2.6 2.6 0 0 1 21 9.1v7.3a2.6 2.6 0 0 1-2.6 2.6H5.6A2.6 2.6 0 0 1 3 16.4z" />
    <circle cx="12" cy="12.6" r="3.3" />
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
export const MusicIcon = (p: IconProps) => base(p, (
  <>
    <path d="M9 18.5V6.6l9.5-2.1V16" />
    <circle cx="6.7" cy="18.5" r="2.3" />
    <circle cx="16.2" cy="16" r="2.3" />
  </>
))
export const PauseIcon = (p: IconProps) => base(p, <path d="M8.6 5.5v13M15.4 5.5v13" />)
export const SkipBackIcon = (p: IconProps) => base(p, (
  <>
    <path d="M18.5 6.3v11.4L9.2 12z" />
    <path d="M5.5 6.2v11.6" />
  </>
))
export const SkipForwardIcon = (p: IconProps) => base(p, (
  <>
    <path d="M5.5 6.3v11.4L14.8 12z" />
    <path d="M18.5 6.2v11.6" />
  </>
))
export const MoreIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="5" cy="12" r="0.6" />
    <circle cx="12" cy="12" r="0.6" />
    <circle cx="19" cy="12" r="0.6" />
  </>
))
/* 调色盘：主题商店（背景 + 配色皮肤） */
export const PaletteIcon = (p: IconProps) => base(p, (
  <>
    <path d="M12 3.6c-4.5 0-8.2 3.4-8.2 7.7 0 3 2.3 5.4 5.2 5.4h1.5c.9 0 1.6.7 1.6 1.6 0 .4-.1.7-.3 1-.2.3-.3.6-.3 1 0 .8.7 1.5 1.5 1.5 4.6 0 8.2-3.4 8.2-7.7 0-5.2-4-10.5-9.2-10.5z" />
    <circle cx="8" cy="10.4" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="12" cy="8.1" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="16" cy="10.4" r="1.05" fill="currentColor" stroke="none" />
  </>
))
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
/* 刷新（可爱版）：顺时针环绕箭头 + 两端圆点箭羽，比 RefreshIcon 更圆润俏皮 ——
   音乐页「点击刷新」按钮专用（v1.65） */
export const RefreshCuteIcon = (p: IconProps) => base(p, (
  <>
    <path d="M19.4 8.1A7.8 7.8 0 1 0 19.8 14" />
    <path d="M16.2 7.3l3.7.6.6-3.7" />
    <circle cx="4.9" cy="14.6" r="0.55" />
    <circle cx="8.4" cy="18.4" r="0.55" />
  </>
))
export const PlayIcon = (p: IconProps) => base(p, <path d="M8 5.5v13l10-6.5z" />)

/* ── v1.73 播放/暂停「形态过渡」图标（只给播放页主按钮用） ──
   原理：同一个 <path> 的两个状态写成**命令结构完全一致**的 d，
   靠 CSS 过渡 d 属性做真正的形态插值（Material Symbols 的做法）。
   · 两个子路径都是 M/L/L/L/Z：子路径 1 = 左竖条 → 三角形；
     子路径 2 = 右竖条 → 收缩成一个点（视觉上被三角形吸收）。
   · stroke 与 fill 同色 + strokeLinejoin:round：给直角描一圈圆角，
     视觉上与全站线性图标的圆头风格一致。
   · 内核不支持 d 插值（如 Firefox）时自动降级为「缩放 + 交叉淡入」，
     仍然平滑，绝不出现硬切。
   ⚠️ 不要删旧的 PlayIcon / PauseIcon：首页悬浮条、迷你面板、榜单等处还在用。 */
export const PLAUSE_PAUSE_D =
  'M7.6 5.5L7.6 18.5L9.6 18.5L9.6 5.5Z M14.4 5.5L14.4 18.5L16.4 18.5L16.4 5.5Z'
export const PLAUSE_PLAY_D =
  'M7.6 5.5L7.6 18.5L18.6 12L18.6 12Z M18.6 11.85L18.6 12.15L18.6 12.15L18.6 11.85Z'

const SUPPORTS_PATH_MORPH =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('d', 'path("M0 0")')

export function PlayPauseIcon({
  playing,
  size = 28,
  className = '',
  color,
}: {
  playing: boolean
  size?: number
  className?: string
  color?: string
}) {
  const c = color || 'currentColor'
  if (SUPPORTS_PATH_MORPH) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
        <path
          className="music-playpath"
          d={playing ? PLAUSE_PAUSE_D : PLAUSE_PLAY_D}
          fill={c}
          stroke={c}
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  const fade = (show: boolean) => ({
    position: 'absolute' as const,
    inset: 0,
    opacity: show ? 1 : 0,
    transform: show ? 'scale(1)' : 'scale(0.72)',
    transition: 'opacity 0.24s ease, transform 0.24s cubic-bezier(0.22,1,0.36,1)',
  })
  return (
    <span
      className={className}
      style={{ position: 'relative', display: 'inline-block', width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size} height={size} style={fade(!playing)}>
        <path
          d="M7.6 5.5L7.6 18.5L18.6 12Z"
          fill={c}
          stroke={c}
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <svg viewBox="0 0 24 24" width={size} height={size} style={fade(playing)}>
        <path
          d={PLAUSE_PAUSE_D}
          fill={c}
          stroke={c}
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}

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
/** 系列 / 分组（叠层）*/
export const LayersIcon = (p: IconProps) => base(p, (
  <>
    <path d="M12 3.8 3.8 8l8.2 4.2L20.2 8 12 3.8Z" />
    <path d="M3.8 12.6 12 16.8l8.2-4.2" />
    <path d="M3.8 16.9 12 21.1l8.2-4.2" />
  </>
))
export const InfoIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11.5v4.2" />
    <path d="M12 8.2h.01" />
  </>
))
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
export const LogoutIcon = (p: IconProps) => base(p, (
  <>
    <path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </>
))
export const TrashIcon = (p: IconProps) => base(p, (
  <>
    <path d="M4.5 6.5h15M9.5 6V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3V6" />
    <path d="M6.5 6.5l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.8-12" />
    <path d="M10 10.5v6M14 10.5v6" />
  </>
))
export const GlobeIcon = (p: IconProps) => base(p, (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.4 2.3 3.7 5.3 3.7 8.5s-1.3 6.2-3.7 8.5c-2.4-2.3-3.7-5.3-3.7-8.5s1.3-6.2 3.7-8.5z" />
  </>
))
/** 排序（上下双箭头）：资料 / 视频列表的「顺序 · 倒序」切换按钮用 */
export const SortIcon = (p: IconProps) => base(p, (
  <>
    <path d="M8 20V4.5M8 4.5 4.6 8M8 4.5 11.4 8" />
    <path d="M16 4v15.5M16 19.5 12.6 16M16 19.5 19.4 16" />
  </>
))

/* ── AI 智能助手 ── */
/** 星光（AI）：一颗大的四角星 + 两颗小星，用于「AI 解析 / AI 概括」入口 */
export const SparklesIcon = (p: IconProps) => base(p, (
  <>
    <path d="M11 3.5c.9 3.1 1.9 4.1 5 5-3.1.9-4.1 1.9-5 5-.9-3.1-1.9-4.1-5-5 3.1-.9 4.1-1.9 5-5z" />
    <path d="M18 14.5c.45 1.55.95 2.05 2.5 2.5-1.55.45-2.05.95-2.5 2.5-.45-1.55-.95-2.05-2.5-2.5 1.55-.45 2.05-.95 2.5-2.5z" />
    <path d="M6.6 16.4c.3 1.05.65 1.4 1.7 1.7-1.05.3-1.4.65-1.7 1.7-.3-1.05-.65-1.4-1.7-1.7 1.05-.3 1.4-.65 1.7-1.7z" />
  </>
))
/** 文档摘要：三横线 + 右下角小星，用于「视频 AI 概括」入口 */
export const SummaryIcon = (p: IconProps) => base(p, (
  <>
    <path d="M5 5.5h11M5 9.5h9M5 13.5h6" />
    <path d="M17.5 12.6c.4 1.5.9 2 2.4 2.4-1.5.4-2 .9-2.4 2.4-.4-1.5-.9-2-2.4-2.4 1.5-.4 2-.9 2.4-2.4z" />
  </>
))
