import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeftIcon, ChevronRightIcon, ListIcon, MusicIcon, PauseIcon, PlayIcon, PlayPauseIcon, SearchIcon,
  SkipBackIcon, SkipForwardIcon, RefreshCuteIcon,
} from '../components/icons'
import { Avatar } from '../components/Avatar'
import { useProfile } from '../hooks/useProfile'
/* v1.71 全局音乐引擎：音频元素与播放状态都在模块级单例里，
   本组件（以及全局迷你播放条）只是遥控器 —— 这样切到别的页面/整页视图时音乐不断 */
import {
  useMusicEngine, musicEngine, getMusicAudio,
  setMusicPageVisible, useMusicPageVisible, openMusicPage,
} from '../hooks/useMusicEngine'
import { useCoverAccent, paletteTriple, type AccentTriple } from '../hooks/useCoverAccent'
/* v1.73 动效系统：设置 store（模块级） + 律动总线（唯一 rAF，只写 CSS 变量） */
import {
  useMusicFx, setMusicFx, resetMusicFx, onOpenMusicFx, requestOpenMusicFx,
  FX_RANGES, DEFAULT_MUSIC_FX, ORB_STYLE_LABELS,
  useReducedMotion, type MusicOrbStyle,
} from '../hooks/useMusicFx'
import { useVizTarget, useVizStatus, VIZ_BANDS } from '../hooks/useMusicViz'
import { musicApi, getProfile, type MusicAlbumItem, type MusicCommentItem, type MusicTrackItem } from '../api/client'
import { parseKrcLyric, KaraokeLyrics, type KaraokeChar, type KaraokeLine } from '../components/KaraokeLyrics'
import { formatCount, formatMoment } from '../data/format'

/* ============================================================
   音乐模块（Tab：音乐）· 国产音乐 App 风格（浅色极简 · #f7f8fa 底）
   ------------------------------------------------------------
   数据源：管理后台「音乐」页上传的曲目（server/modules/music.py）——
     只用真实曲库，不再内置示例曲目（v1.45 起，库里没歌显示空态引导）。
     - 列表：GET  /api/music          （含歌词 / 播放量 / 收藏数 / 评论数 / 我是否收藏）
     - 音频：      /api/music/{id}/file?token=…（<audio> 播放，支持 Range 拖动）
     - 封面：      /api/music/{id}/cover?token=…（没传封面 → 内置山水/黄昏/书法插画）
     - 播放：POST /api/music/{id}/play   （播放量 +1 并写入「观看历史」的音乐条目）
     - 收藏：POST /api/music/{id}/favorite（「我的 → 收藏」可见）
     - 评论：GET/POST/DELETE /api/music/…（播放页评论区，入库）
   视图状态机（页内自管理，播放状态跨视图共享）：
     home       音乐首页（标签栏 / 搜索 / 横向推荐卡 / 歌曲列表板块 / 推荐板块）
     player     全屏播放页（黑胶唱片机：旋转唱片 + 封面圆标 + 唱臂；评论/收藏/歌词）
     lyrics     全屏歌词页（v1.70：播放页横向滑动进入，QQ 音乐式大字歌词 + 右下播放钮）
     search     搜索页    playlists 歌单列表    playlist 歌单详情
   播放页布局（参考 QQ 音乐黑胶页，用户指定；v1.60 调序）：
     顶部返回 → 歌名 + 收藏爱心(数) → 歌手 + 「N次播放」「标准」标签
     → 透明底黑胶唱片（播放中匀速旋转，唱臂搭在盘上；v1.60 白卡改透明）
     → 卡拉OK逐字歌词面板（胶片下面，约 5 行，上下边缘渐隐）
     → 图标行（评论N / 下载 / 分享）→ 进度条 → 循环·上下曲·播放·列表
   v1.70 三件事（用户需求）：
     ① 播放页左右横滑进入全屏歌词页（弹/伴/词/星等按钮不加，只留返回 / 页点 / 爱心 / 播放暂停）；
     ② MediaSession 系统媒体播放器：退后台 / 锁屏后音乐继续播，系统通知栏 / 锁屏出现
        「封面 + 歌名 + 歌手 + 上下曲 + 播放暂停 + 进度」系统卡片（参考系统播放器截图），可直接操控；
     ③ 音乐首页悬浮条上的「显示导航栏」按钮：播放中导航默认隐藏，点它把 App 底部导航唤出来，
        之后可以一边唱歌一边点导航切去别的 Tab（音乐 Tab 组件常驻挂载不卸载，不停播）。
   v1.81（用户需求）：
     **全屏播放页 / 歌词页强制没有 App 底部导航**（沉浸播放面，暂停也不冒出导航，
     「显示导航栏」也不作用于这两页）；音乐首页 / 搜索 / 歌单 / 专辑等其余页面行为不变。
   ============================================================ */

interface MusicScreenProps {
  /** 当前是否处于音乐 Tab（v1.70）：切走 Tab 时本组件不再卸载（后台继续播），
      active=false 时悬浮条只在播放中显示，点它经 onRequestSwitchToMusic 切回音乐 Tab */
  active: boolean
  /** 顶栏返回 / 首页顶栏返回：回首页 Tab */
  onBack: () => void
  /** 播放中且用户未手动展开导航时通知 App 隐藏底部导航（v1.70 语义：App 端只在音乐 Tab 内生效） */
  onOverlayChange: (overlay: boolean) => void
  /** 在其他 Tab 点悬浮播放条时请求切回音乐 Tab（App 侧 goMain('music')） */
  onRequestSwitchToMusic: () => void
  /** 从「我的 → 观看历史 / 收藏」点音乐条目跳过来：直接播这首并进播放页 */
  autoTrackId?: number
  /** App 通知完毕后回调（清掉 autoTrackId，避免下次进 Tab 重复触发） */
  onAutoTrackConsumed?: () => void
}

/* 强调色（QQ 音乐绿） */
const GREEN = '#31C27C'

/* ============================================================
   歌词配色（v1.67）· 播放页歌词「已唱填充色 / 未唱底色」自定义
   ------------------------------------------------------------
   · 一套配方 = { fill: 已唱填充色, base: 未唱底色 }；
   · DEFAULT_LYRIC_CFG 为出厂默认配色（v1.69：填充 #C212FC / 底色 #733030），
     用户不动设置时即此配色；
   · 用户保存的配色记在 localStorage（按账号隔离、跟随账号），重进 App 自动恢复。
   ============================================================ */
export interface LyricColorConfig {
  /** 已唱部分的填充高亮色 */
  fill: string
  /** 未唱部分的颜色 */
  base: string
}

export interface LyricPreset extends LyricColorConfig {
  id: string
  name: string
}

/** 默认配色（v1.69：未唱底色 #733030 + 已唱填充色 #C212FC） */
export const DEFAULT_LYRIC_CFG: LyricColorConfig = { fill: '#C212FC', base: '#733030' }

/** Google 风预设配色：低饱和、克制、彼此拉开色相但都适合浅色背景 */
export const LYRIC_PRESETS: LyricPreset[] = [
  { id: 'default', name: '默认蓝', fill: '#3D6E93', base: '#A9BACA' },
  { id: 'graphite', name: '石墨灰', fill: '#3F4A52', base: '#B6BFC7' },
  { id: 'forest', name: '森林绿', fill: '#2F7D63', base: '#A6C6B8' },
  { id: 'sunset', name: '日落橙', fill: '#C56A38', base: '#E0BFA8' },
  { id: 'rose', name: '玫瑰粉', fill: '#C2587C', base: '#E1BCCA' },
  { id: 'violet', name: '紫罗兰', fill: '#6C5CC0', base: '#C0B7E4' },
  { id: 'teal', name: '青碧', fill: '#2B8A9B', base: '#A6CDD5' },
  { id: 'amber', name: '琥珀金', fill: '#B8860B', base: '#DDC79A' },
]

/* 自定义弹层草稿：默认当前生效配色 */
const FALLBACK_LYRIC_DRAFT: LyricColorConfig = { ...DEFAULT_LYRIC_CFG }

/* ── 封面配色（低饱和淡彩多套；没上传封面时按曲目顺序取色） ── */
interface CoverPalette {
  skyTop: string
  skyBottom: string
  sun: string
  far: string
  mid: string
  near: string
  mist: string
  water: string
}

interface Track {
  id: number
  title: string
  artist: string
  album: string
  /** 时长（秒）；0 = 未知，播放时以音频实际时长为准 */
  duration: number
  palette: CoverPalette
  src: string
  coverUrl: string
  lyric: string
  playCount: number
  favCount: number
  commentCount: number
  favorited: boolean
  /** 音频 MIME 与原始文件名（下载按钮推导扩展名用） */
  mime: string
  fileName: string
}

const PALETTES: CoverPalette[] = [
  { skyTop: '#F7FAF9', skyBottom: '#DCEBE3', sun: '#E9CFA4', far: '#B5CDBE', mid: '#8AAE9A', near: '#5F8A76', mist: '#F4FAF6', water: '#C3DBCD' },
  { skyTop: '#F6F9FC', skyBottom: '#D8E6F3', sun: '#E8D6BC', far: '#AFBFD4', mid: '#829EC0', near: '#5C7CA5', mist: '#F3F8FC', water: '#BDD3E6' },
  { skyTop: '#FBF8F4', skyBottom: '#F0E3D7', sun: '#E3AB7E', far: '#D8BFAE', mid: '#BC9A80', near: '#96705A', mist: '#FAF3EC', water: '#E3CBB8' },
  { skyTop: '#F6FAF6', skyBottom: '#DDEEDF', sun: '#E7D8B8', far: '#B7D0B9', mid: '#8BB091', near: '#5E8A68', mist: '#F2FAF3', water: '#C2DEC6' },
  { skyTop: '#F5F9FC', skyBottom: '#DCEAF5', sun: '#EDD9BC', far: '#B3C6D8', mid: '#85A4BE', near: '#5A7FA0', mist: '#F2F8FC', water: '#BED6E6' },
  { skyTop: '#FAFBF7', skyBottom: '#E9EDDC', sun: '#E6CE9F', far: '#C4CCA8', mid: '#9AA878', near: '#6B7C50', mist: '#F5F8EC', water: '#CFD9B0' },
  { skyTop: '#F5F7FB', skyBottom: '#DDE2F0', sun: '#D9DCEA', far: '#B4BBD6', mid: '#8A93B8', near: '#5E6890', mist: '#F1F4FA', water: '#C6CEE4' },
  { skyTop: '#FCF9F5', skyBottom: '#F6E7DA', sun: '#E8A87C', far: '#DCBEA8', mid: '#C09878', near: '#94684C', mist: '#FBF2EA', water: '#E6C8B0' },
]

/* ── 歌单（按下标引用当前曲库；曲目少时自动过滤空歌单） ── */
interface Playlist {
  id: string
  name: string
  desc: string
  trackIdx: number[]
}

const PLAYLIST_DEFS = [
  { id: 'guofeng', name: '国风山水', desc: '山河入画，古意悠然', idx: [0, 3, 4, 6] },
  { id: 'sleep', name: '静心助眠', desc: '睡前一小时，缓缓入眠', idx: [1, 5, 7] },
  { id: 'guzheng', name: '古筝清音', desc: '弦上流水，指尖生风', idx: [2, 3, 6] },
]

/* ── 首页数据 ── */
type CoverKind = 'ink' | 'sunset' | 'calli'

/* v1.49：首页标签栏 = 推荐 + 专辑（专辑由后台创建、歌曲归入；其余乐馆/儿童/听书/AI作曲/AI唱 已按需求删除）
   v1.61：顶部标签栏整体删除（用户要求）——专辑 / 歌单改为「大家都在听」下面的两个独立内容区块 */
const KINDS: CoverKind[] = ['ink', 'sunset', 'calli', 'ink', 'sunset', 'calli']

function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** 歌词解析已抽到 src/components/KaraokeLyrics.tsx（parseKrcLyric，KRC 结构）：
 *  播放页卡拉OK面板与首页悬浮条共用同一份解析结果。 */

/* ── 封面 ①：国风山水（内联 SVG，随曲目换配色） ── */
function MountainCover({ track }: { track: Track }) {
  const p = track.palette
  const gid = `mc-${track.id}`
  return (
    <svg viewBox="0 0 300 300" width="100%" height="100%" role="img" aria-label={`${track.title} 封面`}>
      <defs>
        <linearGradient id={`${gid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.skyTop} />
          <stop offset="100%" stopColor={p.skyBottom} />
        </linearGradient>
      </defs>
      <rect width="300" height="300" fill={`url(#${gid}-sky)`} />
      <circle cx="228" cy="72" r="26" fill={p.sun} opacity="0.55" />
      <circle cx="228" cy="72" r="18" fill={p.sun} opacity="0.7" />
      <path d="M0 158 Q46 112 92 150 T186 146 T300 128 V300 H0 Z" fill={p.far} opacity="0.75" />
      <path d="M0 208 Q60 150 128 196 T252 186 T300 196 V300 H0 Z" fill={p.mid} opacity="0.85" />
      <g stroke={p.mist} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.85">
        <path d="M96 96 q6 -6 12 0 M108 96 q6 -6 12 0" />
        <path d="M148 82 q5 -5 10 0" />
      </g>
      <ellipse cx="90" cy="206" rx="98" ry="14" fill={p.mist} opacity="0.5" />
      <ellipse cx="226" cy="188" rx="80" ry="11" fill={p.mist} opacity="0.42" />
      <path d="M0 300 V232 Q58 168 108 224 Q140 190 172 226 Q216 196 258 236 Q278 218 300 232 V300 Z" fill={p.near} />
      <g stroke={p.water} strokeWidth="2.4" strokeLinecap="round" opacity="0.7">
        <path d="M34 262 h44" />
        <path d="M108 274 h58" />
        <path d="M196 262 h52" />
        <path d="M64 284 h34" />
      </g>
    </svg>
  )
}

/* ── 封面 ②：黄昏风景（暖橙 → 粉紫渐变 + 落日 + 层叠山影 + 归鸟） ── */
function SunsetCover({ uid }: { uid: string }) {
  return (
    <svg viewBox="0 0 300 300" width="100%" height="100%" role="img" aria-label="黄昏风景封面">
      <defs>
        <linearGradient id={`ss-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE7CB" />
          <stop offset="46%" stopColor="#FBC9A8" />
          <stop offset="78%" stopColor="#F0A98F" />
          <stop offset="100%" stopColor="#C98A86" />
        </linearGradient>
      </defs>
      <rect width="300" height="300" fill={`url(#ss-${uid})`} />
      <circle cx="150" cy="150" r="34" fill="#FFB877" opacity="0.95" />
      <circle cx="150" cy="150" r="52" fill="#FFD9A8" opacity="0.35" />
      <ellipse cx="86" cy="88" rx="62" ry="9" fill="#FFF0DC" opacity="0.7" />
      <ellipse cx="214" cy="112" rx="52" ry="7" fill="#FFE6CE" opacity="0.6" />
      <path d="M0 178 Q54 142 108 170 T210 164 T300 150 V300 H0 Z" fill="#B57C74" opacity="0.55" />
      <path d="M0 300 V214 Q48 186 96 210 Q132 190 168 214 Q214 184 258 216 Q280 202 300 214 V300 Z" fill="#8A5A55" />
      <g stroke="#FFD3A4" strokeWidth="2.6" strokeLinecap="round" opacity="0.55">
        <path d="M118 250 h64" />
        <path d="M92 266 h40" />
        <path d="M182 264 h46" />
        <path d="M138 282 h52" />
      </g>
      <g stroke="#7A4A45" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.75">
        <path d="M196 78 q6 -6 12 0 M208 78 q6 -6 12 0" />
        <path d="M166 62 q5 -5 10 0" />
      </g>
    </svg>
  )
}

/* ── 封面 ③：古风书法（宣纸底 + 墨迹晕染 + 毛笔字 + 朱印） ── */
function CalligraphyCover({ uid, char }: { uid: string; char: string }) {
  return (
    <svg viewBox="0 0 300 300" width="100%" height="100%" role="img" aria-label={`${char} 书法封面`}>
      <defs>
        <linearGradient id={`cl-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F8F4EA" />
          <stop offset="100%" stopColor="#EDE5D6" />
        </linearGradient>
      </defs>
      <rect width="300" height="300" fill={`url(#cl-${uid})`} />
      <ellipse cx="212" cy="80" rx="76" ry="46" fill="#2B2B2B" opacity="0.06" />
      <ellipse cx="84" cy="236" rx="88" ry="40" fill="#2B2B2B" opacity="0.05" />
      <g stroke="#3A3A3A" fill="none" strokeLinecap="round" opacity="0.16">
        <path d="M18 96 q60 -26 128 -14" strokeWidth="14" />
        <path d="M24 268 q92 -18 176 -6" strokeWidth="9" />
      </g>
      <text
        x="150" y="196" textAnchor="middle"
        fontFamily="'Songti SC','STSong','SimSun',serif"
        fontSize="150" fontWeight="700" fill="#2F2F2F" opacity="0.9"
      >
        {char}
      </text>
      <rect x="216" y="212" width="42" height="42" rx="6" fill="#B5433A" opacity="0.9" />
      <text
        x="237" y="242" textAnchor="middle"
        fontFamily="'Songti SC','STSong','SimSun',serif"
        fontSize="24" fill="#FBF6EE"
      >
        印
      </text>
    </svg>
  )
}

/* 封面分发：管理员上传了封面就用真图，否则按类型渲染矢量插画 */
function TrackCover({ track, kind = 'ink', uid, className = '' }: {
  track: Track
  kind?: CoverKind
  uid: string
  className?: string
}) {
  if (track.coverUrl) {
    return (
      <img
        src={track.coverUrl}
        alt={`${track.title} 封面`}
        draggable={false}
        className={`h-full w-full object-cover ${className}`}
      />
    )
  }
  return (
    <div className={`h-full w-full ${className}`}>
      {kind === 'sunset' ? (
        <SunsetCover uid={uid} />
      ) : kind === 'calli' ? (
        <CalligraphyCover uid={uid} char={track.title.slice(-1)} />
      ) : (
        <MountainCover track={track} />
      )}
    </div>
  )
}

/* ── Gemini 风格彩色四角星（播放页装饰） ── */
function GeminiStar({ size, uid, floatSec = 6, twinkleSec = 3, drift = false, style }: {
  size: number
  uid: string
  floatSec?: number
  twinkleSec?: number
  drift?: boolean
  style?: React.CSSProperties
}) {
  return (
    <div
      className={drift ? 'music-drift' : 'music-float'}
      style={{ ...style, animationDuration: `${floatSec}s`, position: 'absolute', pointerEvents: 'none' }}
    >
      <div className="music-twinkle" style={{ animationDuration: `${twinkleSec}s` }}>
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
          <defs>
            <linearGradient id={`gem-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5B9DF7" />
              <stop offset="38%" stopColor="#9B72CB" />
              <stop offset="72%" stopColor="#E4708C" />
              <stop offset="100%" stopColor="#F2B04E" />
            </linearGradient>
            <filter id={`glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="4.5" />
            </filter>
          </defs>
          <path
            d="M50 4 C55 34 66 45 96 50 C66 55 55 66 50 96 C45 66 34 55 4 50 C34 45 45 34 50 4 Z"
            fill={`url(#gem-${uid})`} opacity="0.45" filter={`url(#glow-${uid})`}
          />
          <path
            d="M50 4 C55 34 66 45 96 50 C66 55 55 66 50 96 C45 66 34 55 4 50 C34 45 45 34 50 4 Z"
            fill={`url(#gem-${uid})`}
          />
        </svg>
      </div>
    </div>
  )
}

/* ── 黑胶唱片机（v1.60 白卡改透明：唱片整体浮在页面渐变背景上，唱臂从右上角搭到盘面上） ── */

/* ============================================================
   FloatBarLyric · 悬浮播放条副行的「逐字渐变填充」歌词（v1.59）
   ------------------------------------------------------------
   和播放页 KaraokeLyrics 是同一套原理，只是排版不同：
     · 只显示当前这一行（单行截断，不滚动、不居中）；
     · 每个字一个 <span>，background-clip:text 把文字挖成蒙版，
       背景 = linear-gradient(to right, 已唱色 var(--kr-p), 未唱色 var(--kr-p))，
       帧循环里只写 --kr-p（0%~100%），文字像进度条一样被从左到右填满；
     · 已唱完的字 --kr-p=100%（全亮）、正在唱的字部分填充、未唱的字 --kr-p=0%（灰）；
     · 时间源同样是 rAF 直读 audio.currentTime（不是 ~4Hz 的 timeupdate 事件），
       拖动进度条 / 点行跳转后 seekSignal +1 再补刷一次，立即同步；
     · 节流：百分比取整成 0~100，和上一次相同就完全不碰 DOM（播放中通常每帧只写 0~1 个字）。
   ============================================================ */
function FloatBarLyric({ line, getTime, playing, seekSignal, fillColor, baseColor }: {
  /** 当前正在唱的歌词行（带 KRC 逐字时间轴） */
  line: KaraokeLine
  /** 读实时播放时间（秒） */
  getTime: () => number
  playing: boolean
  /** 跳转信号：+1 时立刻刷新填充状态 */
  seekSignal: number
  /** 已唱部分填充色（默认同播放页默认配色） */
  fillColor?: string
  /** 未唱部分颜色（默认同播放页默认配色） */
  baseColor?: string
}) {
  const fill = fillColor || '#3E6F97'
  const base = baseColor || '#A9BACA'
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([])
  const pctCache = useRef<number[]>([])
  const getTimeRef = useRef(getTime)
  getTimeRef.current = getTime

  /* 有逐字标签就用逐字时间轴；普通 LRC 在解析阶段已把行时长均摊到每个字，
     所以这里 chars 基本都是满的；万一为空则整行按行起止均摊兜底 */
  const chars = useMemo<KaraokeChar[]>(() => {
    if (line.chars.length) return line.chars
    const t = line.text || ''
    if (!t) return []
    const span = Math.max(0.2, line.end - line.start)
    return t.split('').map((ch, i) => ({
      text: ch,
      start: line.start + (span * i) / t.length,
      end: line.start + (span * (i + 1)) / t.length,
    }))
  }, [line])

  /* 帧循环：只改 CSS 变量 --kr-p（触发 paint，不触发 layout）；
     百分比没变就跳过 → 这就是「减少频繁 DOM 重绘」的节流点 */
  useEffect(() => {
    pctCache.current = new Array(chars.length).fill(-1)
    const apply = () => {
      const t = getTimeRef.current()
      for (let i = 0; i < chars.length; i++) {
        const s = chars[i].start
        const e = chars[i].end
        const q = t <= s ? 0 : t >= e ? 100 : Math.round(((t - s) / Math.max(1e-3, e - s)) * 100)
        if (pctCache.current[i] === q) continue
        pctCache.current[i] = q
        spanRefs.current[i]?.style.setProperty('--kr-p', `${q}%`)
      }
    }
    apply()
    if (!playing) return
    let raf = 0
    const loop = () => {
      apply()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [chars, playing, seekSignal])

  return (
    <p className="truncate text-[11px] font-medium" style={{ color: '#9FB2C0', fontVariantNumeric: 'tabular-nums' }}>
      {chars.map((c, i) => (
        <span
          key={i}
          ref={(el) => {
            spanRefs.current[i] = el
          }}
          style={{
            backgroundImage:
              `linear-gradient(to right, ${fill} var(--kr-p, 0%), ${base} var(--kr-p, 0%))`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {c.text}
        </span>
      ))}
    </p>
  )
}

function VinylPlayer({ track, kind, playing, uid }: {
  track: Track
  kind: CoverKind
  playing: boolean
  uid: string
}) {
  const reduced = useReducedMotion()
  /* 暂停 / 用户要求减少动态效果 → 移除呼吸动画，由 transition 平缓回到静止（不冻结在半途） */
  const idle = !playing || reduced
  return (
    <div
      className="relative mx-auto mt-3 mb-6 w-full"
      style={{
        /* v1.53 矮屏适配：高度不足的小屏（dvh 小）唱片随视口收缩，大屏仍 320px；flex-shrink:0 防滚动容器内被压扁
           v1.55：44dvh → 40dvh，矮屏再让一点给歌名 / 歌词（≥800px 高视口仍 320px 不变）
           v1.59：36dvh → 32dvh —— 底部玻璃控制舱（评论/进度/控制）占约 200px，
                 与歌词面板 150px 配对后 844 屏内容刚好放得下：唱片首屏完整可见、不被舱体裁切
           v1.60：白卡改全透明（用户要求：跟导航栏差不多、背景跟界面一样透出来）——
                 去掉白色渐变与卡片投影，唱片 / 唱臂直接浮在播放页渐变背景上；
                 盘体 / 圆标自带投影保留，深度感不变 */
        maxWidth: 'min(320px, 32dvh)', aspectRatio: '1 / 1', flexShrink: 0, borderRadius: 32,
        background: 'transparent',
      }}
    >
      {/* v1.63 Google 风动态律动：唱片外圈随封面主色的呼吸光环 + 两圈错峰扩散的水波纹
          （播放中才动，暂停时停住；颜色全部来自 --mu-glow，跟随封面变色） */}
      <div className={`music-halo ${playing ? '' : 'is-paused'}`} aria-hidden />
      <div className={`music-ripple ${playing ? '' : 'is-paused'}`} aria-hidden />
      <div className={`music-ripple r2 ${playing ? '' : 'is-paused'}`} aria-hidden />

      {/*
        唱片四层栈（v1.73）—— 每层只负责一件事，解决「多个动画改同一元素」：
          ① .music-pulse   律动：真实低频 → scale（拿不到频谱时恒为 1，等于不存在）
          ② .music-breathe 呼吸：极轻微 scale，暂停时平缓归位
          ③ .music-spin    旋转：黑胶匀速自转（沿用 v1.45 的两层解法）
          ④ 封面内容        切歌时按 track.id 重挂 → 缩放淡入
        ⚠️ rotate 动画会覆盖元素自身的 transform，绝不能和 scale 层合并
           —— 单层方案会让唱片脱锚跑到卡片外（v1.45 踩过）。
        ⚠️ 旋转层【不能】挂 key：切歌时 React 要复用这个节点，旋转不重头开始（否则视觉断层）。
           要重挂的只有最里面的封面内容。
      */}
      <div className="absolute" style={{ width: '70%', height: '70%', left: '50%', top: '52%', transform: 'translate(-50%, -50%)' }}>
        <div className="music-pulse absolute inset-0">
          <div className={`music-breathe absolute inset-0 ${idle ? 'is-idle' : ''}`}>
            {/* 外圈频谱光带：12 条沿轮廓起伏的短光带（不是柱状条）。
                频率按左右对称分配，两侧接缝同值 → 看不到断点。 */}
            <div className="music-spectrum" aria-hidden>
              {Array.from({ length: VIZ_BANDS }, (_, i) => (
                <span key={i} style={{ '--i': i } as React.CSSProperties}>
                  <i />
                </span>
              ))}
            </div>

            <div className="music-spin relative h-full w-full" style={{ animationPlayState: playing ? 'running' : 'paused' }}>
              {/* 盘体：深色胶盘 + 唱纹 */}
              <div
                className="absolute inset-0 overflow-hidden rounded-full"
                style={{
                  background: 'radial-gradient(circle, #3C4A52 0%, #2C3840 52%, #22303A 100%)',
                  boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.06), 0 10px 26px rgba(31,45,61,0.28)',
                }}
              >
                {[0.94, 0.86, 0.78, 0.7].map((r) => (
                  <div
                    key={r}
                    className="absolute rounded-full"
                    style={{ inset: `${((1 - r) / 2) * 100}%`, border: '1px solid rgba(255,255,255,0.055)' }}
                  />
                ))}
              </div>
              {/* 盘心圆标：封面图 / 插画 */}
              <div
                className="absolute overflow-hidden rounded-full"
                style={{
                  width: '46%', height: '46%', left: '27%', top: '27%',
                  border: '3px solid rgba(255,255,255,0.92)',
                  boxShadow: '0 3px 12px rgba(20,32,40,0.35)',
                }}
              >
                {/* 切歌连续过渡：key 换 → 新封面从 0.88 缩放淡入，旧封面不残留。
                    放在旋转层内部，所以不会打断黑胶自转。 */}
                <div key={`vc-${track.id}`} className="music-cover-swap h-full w-full">
                  <TrackCover track={track} kind={kind} uid={uid} />
                </div>
              </div>
              {/* 中孔 */}
              <div
                className="absolute rounded-full"
                style={{ width: 10, height: 10, left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: '#F2F6F9' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 唱臂：转轴固定在卡片右上角，臂杆搭到唱片盘面上（与卡片一体） */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g stroke="#8FA3B0" strokeLinecap="round" fill="none">
          <circle cx="79" cy="16" r="6" fill="#E8EEF2" stroke="#9DB0BC" strokeWidth="1.4" />
          <circle cx="79" cy="16" r="2" fill="#8FA3B0" />
          <path d="M79 19 C 74.5 30, 68 38, 61 46.5" strokeWidth="3.2" />
          <rect
            x="56" y="45" width="9.5" height="6.6" rx="2.2"
            fill="#E8EEF2" stroke="#9DB0BC" strokeWidth="1.2"
            transform="rotate(42 60.75 48.3)"
          />
        </g>
      </svg>
    </div>
  )
}

/* ── 通用小组件 ── */
function CircleBtn({ onClick, label, children, size = 40, active = false }: {
  onClick: () => void
  label: string
  children: React.ReactNode
  size?: number
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="tap flex shrink-0 items-center justify-center rounded-full transition-colors"
      style={{
        width: size, height: size,
        background: active ? 'rgba(111,163,201,0.22)' : 'rgba(255,255,255,0.72)',
        border: '1px solid rgba(255,255,255,0.9)',
        color: active ? '#4E7FA6' : '#5D7284',
      }}
    >
      {children}
    </button>
  )
}

/** 绿色小播放圆钮（列表 / 卡片通用） */
function GreenPlay({ onClick, size = 26, label = '播放' }: { onClick: () => void; size?: number; label?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={label}
      className="tap flex shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
      style={{
        width: size, height: size, background: GREEN, color: '#FFFFFF',
        boxShadow: '0 3px 10px rgba(49,194,124,0.36)',
      }}
    >
      <PlayIcon size={Math.round(size * 0.5)} />
    </button>
  )
}

/** 红色爱心（收藏） */
function HeartIcon({ filled, size = 19 }: { filled: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 20s-7.5-4.9-9.1-9.2C1.5 7.4 3.5 4.9 6.3 4.9c1.9 0 3.5 1 4.3 2.4h2.8c.8-1.4 2.4-2.4 4.3-2.4 2.8 0 4.8 2.5 3.4 5.9C19.5 15.1 12 20 12 20z" />
    </svg>
  )
}

/** v1.70 页点指示器（播放页 ↔ 歌词页）：当前页的点拉长加粗，两个点都可点直接互切 */
function PageDots({ current, onPlayer, onLyrics }: {
  current: 'player' | 'lyrics'
  onPlayer: () => void
  onLyrics: () => void
}) {
  const dot = (isCur: boolean) => ({
    width: isCur ? 16 : 6,
    background: isCur ? '#43586A' : 'rgba(93,114,132,0.32)',
  })
  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="播放页 / 歌词页切换">
      <button aria-label="播放页" onClick={onPlayer} className="tap h-1.5 rounded-full transition-all" style={dot(current === 'player')} />
      <button aria-label="歌词页" onClick={onLyrics} className="tap h-1.5 rounded-full transition-all" style={dot(current === 'lyrics')} />
    </div>
  )
}

/* ============================================================
   主组件
   ============================================================ */
type MusicView = 'home' | 'player' | 'lyrics' | 'search' | 'playlists' | 'playlist' | 'album'

/* ============================================================
   v1.70 MediaSession artwork · 无封面曲目兜底封面
   ------------------------------------------------------------
   系统媒体卡片（通知栏 / 锁屏）需要一张封面图；管理员没上传封面时，
   用内置插画配色在 canvas 上现画一张 512×512（山 + 太阳渐变，与 App 内插画同风格），
   toDataURL 成 PNG 喂给 MediaMetadata.artwork。按曲目 id 模块级缓存，不重复画。
   ============================================================ */
/* v1.70：当前浏览器是否支持 MediaSession（系统媒体卡片能力检测，模块级判断一次） */
const msSupported = typeof navigator !== 'undefined' && 'mediaSession' in navigator

/* v1.71：播放量去重标记（模块级，不随组件卸载重置；避免切页面回来重复记播放量） */
let lastCountedTrackId = -1

const artworkCache = new Map<number, string>()

function artworkForTrack(t: Track): string {
  const hit = artworkCache.get(t.id)
  if (hit) return hit
  try {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 512
    const ctx = c.getContext('2d')
    if (!ctx) return ''
    const p = t.palette
    const bg = ctx.createLinearGradient(0, 0, 0, 512)
    bg.addColorStop(0, p.skyTop)
    bg.addColorStop(1, p.skyBottom)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, 512, 512)
    /* 太阳 */
    ctx.globalAlpha = 0.75
    ctx.fillStyle = p.sun
    ctx.beginPath()
    ctx.arc(376, 132, 58, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    /* 远山 */
    ctx.fillStyle = p.far
    ctx.beginPath()
    ctx.moveTo(0, 330)
    ctx.quadraticCurveTo(150, 210, 310, 320)
    ctx.quadraticCurveTo(430, 400, 512, 300)
    ctx.lineTo(512, 512)
    ctx.lineTo(0, 512)
    ctx.closePath()
    ctx.fill()
    /* 近山 */
    ctx.fillStyle = p.near
    ctx.beginPath()
    ctx.moveTo(0, 452)
    ctx.quadraticCurveTo(170, 330, 350, 448)
    ctx.quadraticCurveTo(450, 512, 512, 448)
    ctx.lineTo(512, 512)
    ctx.lineTo(0, 512)
    ctx.closePath()
    ctx.fill()
    const url = c.toDataURL('image/png')
    artworkCache.set(t.id, url)
    return url
  } catch {
    return ''
  }
}

/* ── 歌词配色持久化（按账号隔离，无后端改动） ── */
const LYRIC_CFG_PREFIX = 'ndt_music_lyric_cfg'
const HEX_RE = /^#[0-9a-fA-F]{6}$/

function lyricCfgKey(): string {
  const acct = getProfile()?.account || ''
  return acct ? `${LYRIC_CFG_PREFIX}:${acct}` : LYRIC_CFG_PREFIX
}

/** 读当前账号的歌词配色；没存过 / 脏数据 → 回落默认配色 */
function readLyricCfg(): LyricColorConfig {
  try {
    const raw = localStorage.getItem(lyricCfgKey())
    if (!raw) return { ...DEFAULT_LYRIC_CFG }
    const o = JSON.parse(raw) as Partial<LyricColorConfig>
    return {
      fill: typeof o.fill === 'string' && HEX_RE.test(o.fill) ? o.fill : DEFAULT_LYRIC_CFG.fill,
      base: typeof o.base === 'string' && HEX_RE.test(o.base) ? o.base : DEFAULT_LYRIC_CFG.base,
    }
  } catch {
    return { ...DEFAULT_LYRIC_CFG }
  }
}

function writeLyricCfg(cfg: LyricColorConfig) {
  try {
    localStorage.setItem(lyricCfgKey(), JSON.stringify(cfg))
  } catch {
    /* 隐私模式写不了：本次会话内仍生效 */
  }
}

export function MusicScreen({ active, onBack, onOverlayChange, onRequestSwitchToMusic, autoTrackId, onAutoTrackConsumed }: MusicScreenProps) {
  const [view, setView] = useState<MusicView>('home')
  /* ── v1.71 播放状态全部搬到【全局引擎】（不再是组件内 useState）─────────────
     原因：App.tsx 里「观看历史 / 收藏 / 设置 / 搜索 / 通知 / 做题 / 考试」等整页视图
     走的是 `if (view.name === '…') return <XxxScreen/>` 提前返回，会把本组件卸载；
     状态若还留在组件里就会归零、组件内的 <audio> 也会被销毁 → 音乐当场中断。
     现在状态读全局引擎（见 src/hooks/useMusicEngine.ts），变量名保持不变，
     所以下方 2000 多行的 UI 代码一行都不用改。 */
  const engineState = useMusicEngine()
  const index = engineState.index
  const playing = engineState.playing
  const seconds = engineState.seconds
  const audioDur = engineState.duration
  /** 兼容旧写法：musicEngine.setPlaying 支持 setPlaying(true) / setPlaying((p) => !p) */
  const setPlaying = musicEngine.setPlaying
  const [showList, setShowList] = useState(false)
  const [showComments, setShowComments] = useState(false)
  /* ── 歌词配色（v1.67）：弹层开关 + 生效配置 + 弹层内草稿 ── */
  const [showLyricColor, setShowLyricColor] = useState(false)
  const [lyricCfg, setLyricCfg] = useState<LyricColorConfig>(readLyricCfg)
  const [draftCfg, setDraftCfg] = useState<LyricColorConfig>(FALLBACK_LYRIC_DRAFT)
  const [comments, setComments] = useState<MusicCommentItem[] | null>(null)
  const [commentText, setCommentText] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  /** 播放模式：顺序播放 → 单曲循环 → 随机播放（左下按钮循环切换）· v1.71 存于全局引擎 */
  const playMode = engineState.mode
  const [keyword, setKeyword] = useState('')
  const [openPlaylistId, setOpenPlaylistId] = useState('guofeng')
  /** 内容区 2 板块是否关闭（X 按钮） */
  const [listBlockOpen, setListBlockOpen] = useState(true)
  /** 服务端曲目（唯一数据源；库里没歌 → 空态引导去后台上传） */
  const [remote, setRemote] = useState<MusicTrackItem[] | null>(null)
  /** 服务端专辑（含每张专辑的歌曲；「专辑」Tab 数据源） */
  const [albums, setAlbums] = useState<MusicAlbumItem[] | null>(null)
  /** 当前打开的专辑 id（专辑详情视图用） */
  const [openAlbumId, setOpenAlbumId] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  /* v1.71：audioRef 指向【全局引擎里唯一的音频元素】（不再由本组件渲染 <audio>）。
     本组件卸载时它不受影响，音乐继续播；这里只是给旧代码一个统一的读取入口。 */
  const audioRef = useRef<HTMLAudioElement | null>(getMusicAudio())

  /* 登录账号资料：顶部头像小组件用真实头像（本地缓存秒显 + 后端刷新）；评论发自己昵称 */
  const { profile } = useProfile()

  /* ── 歌词配色：账号就绪 / 切换后重读一次（设置按账号隔离，保证保存过的配色总能恢复） ── */
  const lyricAcct = profile?.account || ''
  useEffect(() => {
    setLyricCfg(readLyricCfg())
  }, [lyricAcct])

  /* ── 歌词配色：弹层打开时把当前生效配色灌进草稿（关掉重开不残留上次未保存的选择） ── */
  useEffect(() => {
    if (showLyricColor) setDraftCfg(lyricCfg)
  }, [showLyricColor, lyricCfg])

  /* ── 拉真实曲库（含播放量 / 收藏数 / 评论数 / 我是否收藏） ── */
  const loadTracks = useCallback(async () => {
    try {
      const data = await musicApi.list()
      setRemote(Array.isArray(data.items) ? data.items : [])
    } catch {
      setRemote([])
    }
  }, [])

  useEffect(() => {
    void loadTracks()
  }, [loadTracks])

  /* ── 拉专辑（含每张专辑的歌曲，后台创建） ── */
  const loadAlbums = useCallback(async () => {
    try {
      const data = await musicApi.albums()
      setAlbums(Array.isArray(data.items) ? data.items : [])
    } catch {
      setAlbums([])
    }
  }, [])

  useEffect(() => {
    void loadAlbums()
  }, [loadAlbums])

  /* ── 点击刷新（v1.67）：音乐页已去掉全站下拉刷新外壳，改由首页搜索栏旁的小图标触发。
     同时重拉曲库 + 专辑，图标旋转一圈表示正在刷新（最少转满一圈，避免网络太快看不到反馈）。 ── */
  const [refreshing, setRefreshing] = useState(false)
  const refreshMusic = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await Promise.all([loadTracks(), loadAlbums(), new Promise((r) => setTimeout(r, 620))])
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, loadTracks, loadAlbums])

  const tracks: Track[] = useMemo(
    () =>
      (remote ?? []).map((t, i) => ({
        id: t.id,
        title: t.title,
        artist: t.artist || '未知歌手',
        album: t.album || '',
        duration: t.duration || 0,
        palette: PALETTES[i % PALETTES.length],
        src: musicApi.fileUrl(t.id),
        coverUrl: t.has_cover ? musicApi.coverUrl(t.id) : '',
        lyric: t.lyric || '',
        playCount: t.play_count || 0,
        favCount: t.fav_count || 0,
        commentCount: t.comment_count || 0,
        favorited: Boolean(t.favorited),
        mime: t.mime || '',
        fileName: t.file_name || '',
      })),
    [remote],
  )

  /* ── v1.71 把曲库同步进全局引擎 ──────────────────────────────────
     引擎是唯一「记得住」曲库的地方：本组件卸载后（切去设置页 / 做题页等），
     全局迷你播放条仍要靠它显示歌名、切上下曲。
     引擎内部按「当前曲目 id」重新定位下标，所以下拉刷新 / 点刷新图标
     重新拉到同一批数据时不会跳歌，也不会打断正在播的歌。 */
  useEffect(() => {
    musicEngine.setQueue(
      tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        src: t.src,
        coverUrl: t.coverUrl,
      })),
    )
  }, [tracks])

  const playlists: Playlist[] = useMemo(() => {
    const n = tracks.length
    if (!n) return []
    const groups: Playlist[] = PLAYLIST_DEFS
      .map((g) => ({ ...g, trackIdx: g.idx.filter((i) => i < n) }))
      .filter((g) => g.trackIdx.length > 0)
      .map((g) => ({ id: g.id, name: g.name, desc: g.desc, trackIdx: g.trackIdx }))
    groups.push({ id: 'all', name: '全部歌曲', desc: '曲库内全部曲目', trackIdx: tracks.map((_, i) => i) })
    return groups
  }, [tracks])

  const openPlaylist = playlists.find((p) => p.id === openPlaylistId) || playlists[playlists.length - 1]
  const safeIndex = tracks.length ? Math.min(index, tracks.length - 1) : 0
  const track = tracks[safeIndex]
  const hasAudio = Boolean(track && track.src)

  /* ── 播放页按封面动态变色（v1.63）──
     取色优先级：真封面（canvas 提主色）→ 内置插画配色（track.palette 派生）。
     useCoverAccent 内部按封面 URL 缓存，切歌来回切不重复解码；
     拿不到图 / 取色失败都静默回落到插画配色，绝不报错、绝不闪白。 */
  const fallbackAccent: AccentTriple = useMemo(
    () =>
      paletteTriple(
        track?.palette ?? {
          skyTop: '#F7FAF9', skyBottom: '#DCEBE3', mid: '#8AAE9A',
        },
      ),
    [track?.palette],
  )
  const accent = useCoverAccent(track?.coverUrl ?? '', fallbackAccent)

  /* v1.73 律动总线的挂载点：把播放页 / 歌词页的外壳注册进去，
     useMusicViz 每帧把 --mv-level / --mv-bass / --mv-b0..11 写到这个元素上，
     里面的唱片呼吸、律动层、外圈频谱光带全部靠 CSS 变量继承消费 ——
     全程零 React 重渲染。 */
  const pageVizRef = useVizTarget<HTMLDivElement>()
  /* 用户「减少动态效果」偏好：唱片呼吸 / 光点 / 氛围光斑一并静止 */
  const reducedMotion = useReducedMotion()

  const duration = hasAudio ? (audioDur || track.duration || 0) : (track?.duration || 0)
  const pct = duration > 0 ? Math.min(100, (seconds / duration) * 100) : 0

  /* v1.70 底部导航显隐：播放中默认隐藏（沉浸播放），音乐首页悬浮条上的「显示导航栏」按钮可唤出；
     唤出（navOpen）后导航常驻 —— 可以一边唱歌一边点导航切去别的 Tab，音乐不停（组件不卸载）。
     暂停时导航恢复显示，且 navOpen 复位（下次播放重新默认隐藏，与原习惯一致）。
     barLifted：悬浮条 / 各子视图底部要不要给 App 导航让位（在其他 Tab 时导航必在 → 让位）

     v1.81：**播放页 / 歌词页强制没有导航栏** —— 这两页是同一张「全屏沉浸播放面」，
     导航一律不出现（不看播放状态、也不受「显示导航栏」按钮影响）；其余子视图
     （首页 / 搜索 / 歌单 / 专辑）保持原逻辑：播放中默认隐藏，暂停或点「显示导航栏」唤出。 */
  const [navOpen, setNavOpen] = useState(false)
  /** 沉浸播放面（播放页 / 歌词页）—— 下方 fullBleed 用同一判定，只此一处定义 */
  const immersive = view === 'player' || view === 'lyrics'
  const navVisible = !immersive && (!playing || navOpen)
  const barLifted = active ? navVisible : true

  useEffect(() => {
    if (!playing) setNavOpen(false)
  }, [playing])

  /* ── v1.71 → v1.72 向全局上报「音乐页是否正被用户看着」────────────
     全局悬浮球播放器（GlobalMusicFab）据此决定显示与否：
     音乐 Tab 可见（含页内播放页 / 歌词 / 搜索 / 歌单等所有子视图）→ 隐藏全局悬浮球，
     一切播放 UI 归本组件自己；
     切走 Tab / 进整页视图（做题 · 考试 · 看视频 · 设置 · 观看历史…）→ 悬浮球接管，
     音乐在后台继续响。

     ⚠️ 上报的是 active（Tab 可见性）而不是「组件是否挂载」——
     v1.70 起音乐 Tab 是常驻挂载（切走只 display:none），挂载 ≠ 可见。 */
  useEffect(() => {
    setMusicPageVisible(active)
    return () => setMusicPageVisible(false)
  }, [active])

  /** 播放页入场动画标记：从歌词页滑回时播放页带「左滑入场」动画（v1.70，其余入口无动画） */
  const [playerFromLyrics, setPlayerFromLyrics] = useState(false)

  /* 隐藏 App 底部导航（沉浸播放）—— 只在音乐 Tab 内生效（App 端以 activeTab === 'music'
     为前提，见 App.tsx）；MusicScreen 卸载时兜底恢复，避免导航残留隐藏。
     v1.81：播放页 / 歌词页（immersive）**无条件隐藏**；其余子视图仍是
     「播放中隐藏、暂停 / 手动唤出恢复」（保持原习惯） */
  useEffect(() => {
    onOverlayChange(immersive || (playing && !navOpen))
    return () => onOverlayChange(false)
  }, [immersive, playing, navOpen, onOverlayChange])

  /* ── v1.71 播放控制全部委托给全局引擎 ──────────────────────────────
     引擎自己持有曲库与下标，所以本组件即使被卸载（切去设置页 / 观看历史等）也能正常切歌。
     行为与改造前完全一致：单曲循环在引擎的 ended 监听里处理，随机播放在引擎 next() 里处理。 */
  const switchTo = useCallback((nextIndex: number, autoPlay = true) => {
    musicEngine.switchTo(nextIndex, autoPlay)
  }, [])

  const handlePrev = useCallback(() => {
    musicEngine.prev()
  }, [])

  /** 下一曲：随机模式下随机挑一首（避免重复当前曲），其余顺序 +1 */
  const handleNext = useCallback(() => {
    musicEngine.next()
  }, [])

  /** 播放模式循环切换：顺序播放 → 单曲循环 → 随机播放 */
  const cyclePlayMode = useCallback(() => {
    musicEngine.cycleMode()
  }, [])

  /* ── v1.73 播放页主按钮：状态 + 点击涟漪 ──
     · 播放状态永远是引擎的真实状态（setPlaying 写引擎，按钮读引擎 → 与锁屏 /
       通知栏 / 悬浮球的操控完全同步，不存在"按钮显示在播但其实没播"）；
     · tapTick 只用于给涟漪 span 换 key 重启动画，连续点击不冲突。 */
  const [tapTick, setTapTick] = useState(0)
  const handleMainToggle = useCallback(() => {
    setPlaying((p) => !p)
    setTapTick((t) => t + 1)
  }, [setPlaying])

  /* 播放量 +1：切到某首曲目并开始播放时记一次（同一首只记一次；写播放历史）
     v1.71：去重标记改成【模块级变量】—— 原来是 useRef，
     本组件卸载再挂载（切去设置页再回来）会重置，导致同一首被重复记播放量。 */
  useEffect(() => {
    if (!playing || !track) return
    if (lastCountedTrackId === track.id) return
    lastCountedTrackId = track.id
    musicApi.play(track.id).catch(() => { /* 记播放量失败不影响播放 */ })
  }, [playing, track])

  /* ── v1.70 MediaSession 进度同步 ──────────────────────────────────
     引擎在 timeupdate / loadedmetadata / seek 时都会自动调用 setPositionState，
     所以本组件不再需要 updatePositionState（原实现已整体搬进 useMusicEngine.ts）。 */

  /* 进度条可点按跳转 */
  const barRef = useRef<HTMLDivElement | null>(null)
  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = barRef.current
    if (!bar || duration <= 0) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const target = ratio * duration
    /* v1.71：改到全局引擎的音频元素上（引擎会顺带同步进度状态与系统媒体卡片） */
    if (hasAudio) musicEngine.seek(target)
    setSeekTick((n) => n + 1) /* v1.59：暂停状态下拖进度条也让逐字填充立刻同步（需求 6） */
  }, [duration, hasAudio])

  /** 跳到指定时间（点歌词行跳播用）：音频与进度状态一起改 */
  const seekTo = useCallback((t: number) => {
    if (hasAudio) musicEngine.seek(t)
    setSeekTick((n) => n + 1) /* v1.59：点歌词行跳转后逐字填充立刻同步 */
  }, [hasAudio])

  const searchResults = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return []
    return tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) =>
        t.title.toLowerCase().includes(kw)
        || t.artist.toLowerCase().includes(kw)
        || t.album.toLowerCase().includes(kw),
      )
  }, [keyword, tracks])

  /** 打开播放页（v1.70 统一入口）：fromLyrics=true 表示从歌词页滑回 → 带左滑入场动画 */
  const openPlayer = useCallback((fromLyrics = false) => {
    setPlayerFromLyrics(fromLyrics)
    setView('player')
  }, [])

  /** 在任意 Tab / 任意视图点悬浮条 → 打开播放页；不在音乐 Tab 时先请求切回音乐 Tab */
  const openPlayerAnywhere = useCallback(() => {
    if (!active) onRequestSwitchToMusic()
    openPlayer(false)
  }, [active, onRequestSwitchToMusic, openPlayer])

  /** 播放指定曲目（并回到播放页） */
  const playFrom = useCallback((i: number) => {
    switchTo(i)
    openPlayer(false)
  }, [switchTo, openPlayer])

  /** 点卡片 / 列表行：播放但停留在首页（符合音乐 App 习惯，点悬浮条再进播放页） */
  const playInline = useCallback((i: number) => switchTo(i), [switchTo])

  const openPlaylistDetail = useCallback((pl: Playlist) => {
    setOpenPlaylistId(pl.id)
    setView('playlist')
  }, [])

  /* ── 收藏（入库，返回最新收藏数） ── */
  const toggleFav = useCallback(async (i: number) => {
    const t = tracks[i]
    if (!t) return
    try {
      const res = await musicApi.favorite(t.id)
      setRemote((prev) =>
        (prev ?? []).map((x) => (x.id === t.id ? { ...x, favorited: res.favorited, fav_count: res.fav_count } : x)),
      )
    } catch {
      /* 失败静默：下次进页以服务端为准 */
    }
  }, [tracks])

  /* ── 下载当前歌曲：带登录态拉音频 → blob 触发保存（扩展名按 MIME / 原文件名推导） ── */
  const [downloadBusy, setDownloadBusy] = useState(false)
  const handleDownload = useCallback(async () => {
    if (!track || downloadBusy) return
    setDownloadBusy(true)
    try {
      const res = await fetch(track.src)
      if (!res.ok) throw new Error('fetch failed')
      const blob = await res.blob()
      const MIME_EXT: Record<string, string> = {
        'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
        'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
        'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg',
        'audio/opus': 'opus', 'audio/webm': 'weba',
      }
      const dot = track.fileName.lastIndexOf('.')
      const ext = MIME_EXT[track.mime] || (dot > 0 ? track.fileName.slice(dot + 1).toLowerCase() : '') || 'mp3'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${track.title} - ${track.artist}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 3000)
    } catch {
      window.alert('下载失败，请稍后再试')
    } finally {
      setDownloadBusy(false)
    }
  }, [track, downloadBusy])

  /* ── 分享当前歌曲：有系统分享面板就唤起，否则复制文案 ── */
  const handleShare = useCallback(async () => {
    if (!track) return
    const text = `我在听《${track.title}》 - ${track.artist}，一起来刷题听歌吧～`
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: track.title, text }) } catch { /* 用户取消分享 */ }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      window.alert('分享文案已复制，去粘贴给朋友吧')
    } catch {
      window.alert(text)
    }
  }, [track])

  /* ════════ v1.70 系统媒体播放器（MediaSession） ════════
     用户需求：音乐可以后台播放，暂时退出 App（切后台 / 锁屏）后系统上出现系统级播放卡片
     （参考系统播放器截图：封面 + 歌名 + 歌手 + 上下曲 + 播放暂停 + 进度）。
     浏览器音频在退后台 / 锁屏时本来就继续响；这里负责把「系统卡片」挂出来并保持同步：
       · metadata：标题 / 歌手 / 专辑 / 封面 —— 有真封面用封面 URL（带 token，绝对地址），
         没封面用 artworkForTrack 现画的插画 PNG，系统卡片不空着；
       · 控制按钮 + playbackState + setPositionState 的实现在【全局引擎】
         （src/hooks/useMusicEngine.ts）—— 放在那里才能在退出音乐页后继续生效，
         否则锁屏上的「上一首 / 下一首」会在组件卸载时失效。
     本组件只负责「随当前曲目更新卡片文案与封面」，而且【刻意不做卸载清理】：
     组件卸载时音乐还在播，卡片必须继续挂着（v1.71）。 */
  useEffect(() => {
    if (!msSupported || !track) return
    try {
      let artwork: MediaImage[] = []
      if (track.coverUrl) {
        artwork = [{ src: new URL(track.coverUrl, window.location.href).toString(), sizes: '512x512' }]
      } else {
        const url = artworkForTrack(track)
        if (url) artwork = [{ src: url, sizes: '512x512', type: 'image/png' }]
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'NDT 学习刷题 · 音乐',
        artwork,
      })
    } catch {
      /* 浏览器不支持 MediaMetadata：静默降级（音频照常后台播） */
    }
  }, [track])

  /* ── v1.71 移除的三个 effect（原 v1.70 逻辑，已整体搬进全局引擎）──────────
     删掉的是：
       ① playbackState 同步 effect  —— 引擎在 playing 变化时自动同步；
       ② MediaSession 动作处理器 effect（play/pause/上一首/下一首/seekto/快进快退）
          + 它的卸载注销 —— 引擎在模块加载时注册一次且【永不注销】，
          这样即使本组件被卸载，锁屏 / 通知栏上的控制按钮依然有效；
       ③ 组件卸载时清空媒体卡片的 cleanup —— 现在卸载 ≠ 停止播放，
          清掉卡片会造成「音乐还在响但卡片消失」，所以必须去掉。
     退出登录 / 主动停止播放请调用 musicEngine.stop()（见「我的 → 退出登录」处）。 */

  /* ── 评论：打开拉取 / 发布 / 删自己的 ── */
  const openComments = useCallback(async () => {
    if (!track) return
    setShowComments(true)
    setComments(null)
    try {
      const res = await musicApi.comments(track.id)
      setComments(res.items)
    } catch {
      setComments([])
    }
  }, [track])

  const submitComment = useCallback(async () => {
    if (!track || commentBusy) return
    const content = commentText.trim()
    if (!content) return
    setCommentBusy(true)
    try {
      const res = await musicApi.addComment(track.id, content)
      setCommentText('')
      setComments((prev) => [
        ...(prev ?? []),
        { id: res.id, user_id: -1, nickname: profile?.nickname || '我', avatar: profile?.avatar || '', content, created_at: new Date().toISOString(), mine: true },
      ])
      setRemote((prev) =>
        (prev ?? []).map((x) => (x.id === track.id ? { ...x, comment_count: res.comment_count } : x)),
      )
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '评论发布失败')
    } finally {
      setCommentBusy(false)
    }
  }, [track, commentBusy, commentText, profile])

  const removeComment = useCallback(async (cid: number) => {
    if (!track) return
    try {
      const res = await musicApi.deleteComment(cid)
      setComments((prev) => (prev ?? []).filter((c) => c.id !== cid))
      setRemote((prev) =>
        (prev ?? []).map((x) => (x.id === track.id ? { ...x, comment_count: res.comment_count } : x)),
      )
    } catch {
      /* 忽略 */
    }
  }, [track])

  /* ── 歌词：KRC 结构（行起止 + 逐字起止），卡拉OK面板与悬浮条共用一份解析 ── */
  const krcLines = useMemo(() => parseKrcLyric(track?.lyric || ''), [track?.lyric])
  const hasTimeline = krcLines.some((l) => l.start >= 0)
  /* v1.59：歌词逐字填充的时间源 / 跳转信号 ——
     lyricTime 是稳定引用，返回的永远是当前 audio 的实时 currentTime（不是 React 状态副本），
     KaraokeLyrics 的 rAF 帧循环每帧调它 → 拖动进度条后下一帧全部字立刻跟上（需求 6）；
     seekTick 只做「暂停状态下也强制刷一遍」的触发器。 */
  const lyricTime = useCallback(() => audioRef.current?.currentTime ?? 0, [])
  const [seekTick, setSeekTick] = useState(0)
  const activeLyric = useMemo(() => {
    if (!hasTimeline) return -1
    let idx = -1
    krcLines.forEach((l, i) => { if (l.start >= 0 && l.start <= seconds + 0.3) idx = i })
    return idx
  }, [krcLines, hasTimeline, seconds])
  /* 当前正在唱的那一行（悬浮条用；带逐字时间轴才拿去逐字填充） */
  const activeLyricLine = activeLyric >= 0 ? krcLines[activeLyric] : null

  const listPct = useMemo(
    () => tracks.map((t) => (t.duration > 0 ? Math.min(100, (t.duration / 300) * 100) : 0)),
    [tracks],
  )

  /* ── 「观看历史 / 收藏」点音乐条目跳进来：直接播这首并进播放页 ── */
  useEffect(() => {
    if (!autoTrackId || !tracks.length) return
    const i = tracks.findIndex((t) => t.id === autoTrackId)
    if (i >= 0) {
      switchTo(i)
      openPlayer(false)
    }
    onAutoTrackConsumed?.()
  }, [autoTrackId, tracks, switchTo, openPlayer, onAutoTrackConsumed])

  /* ── v1.70 播放页 ↔ 歌词页 横滑翻页手势（QQ 音乐式）：
     在播放页横向滑动（左右皆可）→ 进歌词页；在歌词页横滑 → 回播放页。
     阈值：横向位移 ≥64px 且 |dx| 明显大于 |dy|（1.4 倍）——
     竖着滑歌词 / 滚页面不会误触；其他视图（首页 / 搜索等）不启用。 ── */
  const pageTouchRef = useRef<{ x: number; y: number } | null>(null)
  const handlePageTouchStart = useCallback((e: React.TouchEvent) => {
    if (view !== 'player' && view !== 'lyrics') return
    const t = e.touches[0]
    pageTouchRef.current = { x: t.clientX, y: t.clientY }
  }, [view])
  const handlePageTouchEnd = useCallback((e: React.TouchEvent) => {
    if (view !== 'player' && view !== 'lyrics') return
    const st = pageTouchRef.current
    pageTouchRef.current = null
    if (!st) return
    const t = e.changedTouches[0]
    const dx = t.clientX - st.x
    const dy = t.clientY - st.y
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    if (view === 'player') setView('lyrics')
    else openPlayer(true)
  }, [view, openPlayer])

  /* ── 悬浮底部播放条（小唱片 + 听我想听 + 播放 + 列表）──
     v1.70：① 改为根级渲染 —— 音乐 Tab 首页显示；点它切回音乐 Tab 并开播放页；
     ② 播放中导航隐藏 → 贴着底边；导航显示（暂停 / 用户唤出）→ 抬到导航上方；
     ③ 播放中且导航隐藏时，条上方出现「显示导航栏」小按钮（用户需求 ③：点它唤出导航，
        之后一边唱歌一边可以点导航去别的 Tab，音乐不停）。
     v1.72：只在音乐 Tab 内显示（active && view === 'home'）—— 切到其他页面 / 整页视图时
     播放器「缩小成悬浮球」（GlobalMusicFab），由它接管遥控，两条不再重复挂底。
     ⚠️ 必须 createPortal 挂到 document.body：fixed 元素一旦处在带 transform / filter /
     backdrop-filter 的祖先内，定位基准就会从视口变成那个祖先。放到 body 直下最稳，
     也保证播放条浮在所有页面内容之上。 */
  const floatBar = track && active && view === 'home' && createPortal(
    <div
      className="fixed left-1/2 z-40 w-[calc(100%-28px)] max-w-[402px] -translate-x-1/2"
      /* 悬浮条是 fixed 定位、不吃页面安全区 → 贴底距离同样加上 env(safe-area-inset-bottom)；
         导航显示时抬到导航上方（104px），隐藏时贴底（24px），env=0 时与原数值一致 */
      style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${barLifted ? 104 : 24}px)` }}
    >
      {/* 「显示导航栏」按钮：只在音乐 Tab 首页、播放中、导航隐藏时出现 */}
      {active && playing && !navOpen && (
        <div className="mb-2 flex justify-center">
          <button
            onClick={() => setNavOpen(true)}
            className="tap flex items-center gap-1 rounded-full px-3.5 py-1.5 text-[11px] font-semibold"
            style={{
              background: 'rgba(255,255,255,0.94)', color: '#5D7284',
              border: '1px solid #F0F2F5', boxShadow: '0 4px 12px rgba(31,45,61,0.12)',
            }}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 14l6-6 6 6" />
            </svg>
            显示导航栏
          </button>
        </div>
      )}
      {/* v1.54：卡片背景换成底部导航同款 nav-liquid 磨砂玻璃（透明 blur，浅色白玻璃 / 深色深玻璃跟主题）；
          [&>*]:relative 让子元素垫在辉光层 ::before 之上（同 BottomNav 内部做法） */}
      <div className="nav-liquid [&>*]:relative flex items-center gap-3 py-2 pl-2 pr-2.5">
        {/* 小唱片（播放中旋转）：点进全屏播放页（其他 Tab 点它 → 切回音乐 Tab 再开播放页） */}
        <button
          onClick={openPlayerAnywhere}
          aria-label="打开播放页"
          className="tap shrink-0 rounded-full"
          style={{ width: 40, height: 40 }}
        >
          <div
            className="music-spin h-10 w-10 overflow-hidden rounded-full"
            style={{ border: '2px solid #FFFFFF', boxShadow: '0 2px 8px rgba(31,45,61,0.16)', animationPlayState: playing ? 'running' : 'paused' }}
          >
            <TrackCover track={track} kind={KINDS[safeIndex % KINDS.length]} uid={`fb-${track.id}`} />
          </div>
        </button>
        {/* 文案：歌名（主） + 实时歌词行（副，唱到哪句显示哪句；无歌词回落歌手·播放量）
            颜色用主题令牌（v1.54）：玻璃底跟深浅主题走，深色下深底配浅字才可读
            v1.59：副行歌词改为「卡拉OK逐字渐变填充」—— 与播放页歌词同一套做法
            （每字一个 span + background-clip:text + 只写 --kr-p 变量），
            已唱的字填满、正在唱的字从左到右填、还没唱的字保持灰色（需求 3 / 4） */}
        <button onClick={openPlayerAnywhere} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--text-1)' }}>{track.title}</p>
          {activeLyricLine ? (
            <FloatBarLyric
              line={activeLyricLine}
              getTime={lyricTime}
              playing={playing}
              seekSignal={seekTick}
              fillColor={lyricCfg.fill}
              baseColor={lyricCfg.base}
            />
          ) : (
            <p className="truncate text-[11px]" style={{ color: 'var(--text-3)' }}>
              {`${track.artist} · ${formatCount(track.playCount)}次播放`}
            </p>
          )}
        </button>
        {/* 播放 / 暂停 */}
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? '暂停' : '播放'}
          className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
          style={{ background: GREEN, color: '#FFFFFF', boxShadow: '0 3px 10px rgba(49,194,124,0.36)' }}
        >
          {playing ? <PauseIcon size={16} strokeWidth={2} /> : <PlayIcon size={16} />}
        </button>
        {/* 列表 → 弹出歌曲播放列表（其他 Tab 点它 → 先切回音乐 Tab 再弹列表） */}
        <button
          onClick={() => { if (!active) onRequestSwitchToMusic(); setShowList(true) }}
          aria-label="播放列表"
          className="tap flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors"
          style={{ color: 'var(--text-2)' }}
        >
          <ListIcon size={19} />
        </button>
      </div>
    </div>,
    document.body,
  )

  /* ── 子视图小播放条（搜索 / 歌单 / 专辑 / 歌曲列表页）──
     导航隐藏（播放中且未唤出）→ 贴底；导航显示 → 抬到导航上方
     ⚠️ 同 floatBar：必须 portal 到 body，否则易被祖先的 transform 等属性改变定位基准 */
  const miniBar = track && active && view !== 'player' && view !== 'home' && createPortal(
    <div
      className="fixed left-1/2 z-40 w-[calc(100%-28px)] max-w-[402px] -translate-x-1/2"
      style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${barLifted ? 104 : 16}px)` }}
    >
      <div
        className="flex items-center gap-3 rounded-full py-2 pl-2 pr-3"
        style={{ background: 'rgba(255,255,255,0.94)', border: '1px solid #F0F2F5', boxShadow: '0 8px 24px rgba(31,45,61,0.14)' }}
      >
        <button onClick={() => openPlayer(false)} aria-label="打开播放页" className="tap h-10 w-10 shrink-0 overflow-hidden rounded-full" style={{ border: '2px solid #FFFFFF' }}>
          <TrackCover track={track} kind={KINDS[safeIndex % KINDS.length]} uid={`mb-${track.id}`} />
        </button>
        <button onClick={() => openPlayer(false)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-semibold" style={{ color: '#22303A' }}>{track.title}</p>
          <p className="truncate text-[11px]" style={{ color: '#9AA2AC' }}>{track.artist}</p>
        </button>
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? '暂停' : '播放'}
          className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
          style={{ background: GREEN, color: '#FFFFFF', boxShadow: '0 3px 10px rgba(49,194,124,0.36)' }}
        >
          {playing ? <PauseIcon size={17} strokeWidth={2} /> : <PlayIcon size={17} />}
        </button>
        <button onClick={() => setShowList(true)} aria-label="播放列表" className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ color: '#5D7284' }}>
          <ListIcon size={19} />
        </button>
      </div>
    </div>,
    document.body,
  )

  /* ── 专辑：封面节点 / 详情数据 / 按 id 播放 ── */
  /** 专辑封面节点：上传了专辑封面用真图，否则回落专辑内首曲封面 / 首页内置插画 */
  const albumCoverNode = (a: MusicAlbumItem, uid: string) => {
    if (a.has_cover) {
      return (
        <img
          src={musicApi.albumCoverUrl(a.id)}
          alt={`${a.name} 封面`}
          draggable={false}
          className="h-full w-full object-cover"
        />
      )
    }
    const firstId = a.tracks && a.tracks[0] ? a.tracks[0].id : null
    const t = firstId != null ? tracks.find((x) => x.id === firstId) : tracks[0]
    return t ? (
      <TrackCover track={t} kind={KINDS[0]} uid={uid} />
    ) : (
      <div className="h-full w-full" style={{ background: 'linear-gradient(160deg, #EAF2F7 0%, #D6E6F0 100%)' }} />
    )
  }

  /** 按歌曲 id 播放（专辑里的歌要映射回全局曲库下标，才能接上上一曲 / 下一曲） */
  const playById = useCallback((trackId: number) => {
    const i = tracks.findIndex((t) => t.id === trackId)
    if (i >= 0) playFrom(i)
  }, [tracks, playFrom])

  const openAlbum = (albums ?? []).find((a) => a.id === openAlbumId) || null
  const albumTracks = openAlbum?.tracks ?? []

  /* ── 「专辑」Tab：专辑卡片网格（后台创建，歌曲归入；点卡片进专辑详情） ── */
  const albumGrid = (
    <div className="mt-4 px-4">
      {albums === null ? (
        <p className="py-12 text-center text-sm" style={{ color: '#9AA2AC' }}>加载中…</p>
      ) : albums.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-8 py-14 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: 'rgba(49,194,124,0.1)' }}>
            <span style={{ color: GREEN }}><MusicIcon size={28} /></span>
          </div>
          <p className="text-[15px] font-semibold" style={{ color: '#22303A' }}>还没有专辑</p>
          <p className="text-xs leading-5" style={{ color: '#9AA2AC' }}>
            请管理员在后台「音乐 → 专辑管理」创建专辑，并把歌曲归入专辑后，这里就会显示
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3.5">
          {albums.map((a) => (
            <button
              key={a.id}
              onClick={() => { setOpenAlbumId(a.id); setView('album') }}
              className="tap overflow-hidden rounded-2xl text-left transition-transform active:scale-[0.97]"
              style={{ background: '#FFFFFF', boxShadow: '0 4px 14px rgba(31,45,61,0.06)' }}
            >
              <div className="relative aspect-square overflow-hidden">
                {albumCoverNode(a, `alb-${a.id}`)}
                <span
                  className="absolute bottom-1.5 right-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ background: 'rgba(20,32,40,0.5)', color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}
                >
                  {a.track_count} 首
                </span>
              </div>
              <div className="px-3 py-2.5">
                <p className="truncate text-[13.5px] font-bold" style={{ color: '#22303A' }}>{a.name}</p>
                <p className="mt-0.5 truncate text-[11px]" style={{ color: '#9AA2AC' }}>
                  {a.description || `${a.track_count} 首歌曲`}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  /* ════════ 音乐首页 ════════ */
  const featured = tracks.slice(0, 4)
  const listSongs = tracks.slice(0, 5)
  const recoTracks = tracks.slice(0, 6)

  const emptyView = remote !== null && tracks.length === 0 && (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background: 'rgba(49,194,124,0.1)' }}>
        <span style={{ color: GREEN }}><MusicIcon size={28} /></span>
      </div>
      <p className="text-[15px] font-semibold" style={{ color: '#22303A' }}>曲库还是空的</p>
      <p className="text-xs leading-5" style={{ color: '#9AA2AC' }}>
        请管理员在后台「音乐」页上传歌曲（音频、封面、歌词）后，这里就能播放了
      </p>
    </div>
  )

  const homeView = (
    <>
      <div className="flex-1 pb-[204px]" style={{ overflowY: 'auto' }}>
        {/* ── 顶部标签栏已删除（v1.61 用户要求）：专辑 / 歌单统一放到「大家都在听」下面 ── */}

        {/* ── 搜索框 + 圆形音乐按钮 ── */}
        <div className="flex items-center gap-3 px-4 pb-1 pt-2">
          <div
            className="flex h-11 flex-1 items-center gap-2 rounded-full px-4"
            style={{ background: '#FFFFFF', boxShadow: '0 2px 10px rgba(31,45,61,0.05)' }}
          >
            <SearchIcon size={16} color="#B7BEC7" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setView('search') }}
              placeholder="搜索歌曲、歌手、歌单"
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: '#22303A' }}
            />
          </div>
          <button
            onClick={() => setView('search')}
            aria-label="搜索"
            className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.94]"
            style={{ background: '#FFFFFF', color: GREEN, boxShadow: '0 2px 10px rgba(31,45,61,0.05)' }}
          >
            <MusicIcon size={19} />
          </button>
          {/* 点击刷新（v1.67）：音乐页唯一刷新入口 —— 可爱小手绘风刷新图标，转一圈表示正在刷新 */}
          <button
            onClick={() => void refreshMusic()}
            aria-label="刷新"
            title="刷新"
            className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.94]"
            style={{ background: '#FFFFFF', color: GREEN, boxShadow: '0 2px 10px rgba(31,45,61,0.05)' }}
          >
            <span className="music-spin" style={{ display: 'inline-flex', animationDuration: '0.9s', animationPlayState: refreshing ? 'running' : 'paused' }}>
              <RefreshCuteIcon size={19} />
            </span>
          </button>
        </div>

        {/* ── 内容区 1：横向歌曲卡片（带播放量） ── */}
        <div className="mt-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {featured.map((t, n) => (
            <div
              key={`ft-${t.id}`}
              className="w-[152px] shrink-0 rounded-2xl p-2.5"
              style={{ background: '#FFFFFF', boxShadow: '0 4px 14px rgba(31,45,61,0.06)' }}
            >
              <div className="relative mb-2 aspect-square overflow-hidden rounded-xl">
                <TrackCover track={t} kind={KINDS[n % KINDS.length]} uid={`ft-${t.id}`} />
                {/* 卡片右下角绿色播放钮 */}
                <div className="absolute bottom-2 right-2">
                  <GreenPlay onClick={() => playInline(n)} size={30} />
                </div>
                {/* 播放量角标 */}
                <span
                  className="absolute left-2 top-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ background: 'rgba(20,32,40,0.5)', color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}
                >
                  ▶ {formatCount(t.playCount)}
                </span>
              </div>
              <p className="truncate text-[13px] font-semibold" style={{ color: '#22303A' }}>{t.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-4" style={{ color: '#9AA2AC' }}>
                {t.album || t.artist}
              </p>
            </div>
          ))}
        </div>

        {/* ── 内容区 2：歌曲列表板块（可关闭，爱心=收藏入库） ── */}
        {listBlockOpen && listSongs.length > 0 && (
          <div className="mt-5 px-4">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="flex-1 truncate text-[16px] font-bold" style={{ color: '#22303A' }}>
                重温曾经你最爱听的歌
              </h2>
              <GreenPlay onClick={() => playInline(0)} size={28} />
              <button
                onClick={() => setListBlockOpen(false)}
                aria-label="关闭板块"
                className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ color: '#B7BEC7' }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="overflow-hidden rounded-2xl" style={{ background: '#FFFFFF', boxShadow: '0 4px 14px rgba(31,45,61,0.05)' }}>
              {listSongs.map((t, n) => {
                const fav = t.favorited
                const active = n === safeIndex && playing
                return (
                  <div
                    key={`ls-${t.id}`}
                    className="flex items-center gap-3 px-3 py-2.5"
                    style={{ borderTop: n === 0 ? 'none' : '1px solid #F5F6F8' }}
                  >
                    <button onClick={() => playInline(n)} className="tap flex min-w-0 flex-1 items-center gap-3 text-left">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl">
                        <TrackCover track={t} kind={KINDS[(n + 1) % KINDS.length]} uid={`ls-${t.id}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold" style={{ color: active ? GREEN : '#22303A' }}>{t.title}</p>
                        <p className="truncate text-[11px]" style={{ color: '#9AA2AC' }}>
                          {t.artist} · {formatCount(t.playCount)}次播放
                        </p>
                      </div>
                    </button>
                    {/* 红色爱心收藏（入库） */}
                    <button
                      onClick={() => void toggleFav(n)}
                      aria-label={fav ? '取消收藏' : '收藏'}
                      className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={{ color: fav ? '#F5484B' : '#CDD3D9' }}
                    >
                      <HeartIcon filled={fav} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── 内容区 3：推荐板块 ── */}
        <div className="mt-5">
          <h2 className="mb-2.5 px-4 text-[16px] font-bold" style={{ color: '#22303A' }}>
            大家都在听
          </h2>
          <div className="flex gap-3 overflow-x-auto px-4 pb-1">
            {recoTracks.map((t, n) => (
              <button
                key={`rc-${t.id}`}
                onClick={() => playInline(n)}
                className="tap w-[96px] shrink-0 text-left"
              >
                <div className="relative mb-1.5 aspect-square overflow-hidden rounded-xl" style={{ boxShadow: '0 3px 10px rgba(31,45,61,0.07)' }}>
                  <TrackCover track={t} kind={KINDS[(n + 2) % KINDS.length]} uid={`rc-${t.id}`} />
                  <span
                    className="absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                    style={{ background: 'rgba(20,32,40,0.5)', color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}
                  >
                    ▶ {formatCount(t.playCount)}
                  </span>
                </div>
                <p className="truncate text-[12px] font-semibold" style={{ color: '#22303A' }}>{t.title}</p>
                <p className="truncate text-[10px]" style={{ color: '#9AA2AC' }}>{t.artist.split(' · ')[0]}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── 内容区 4：专辑（v1.61 从顶部 Tab 挪到「大家都在听」下面，整块展示） ── */}
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-2 px-4">
            <h2 className="flex-1 text-[16px] font-bold" style={{ color: '#22303A' }}>专辑</h2>
          </div>
          {albumGrid}
        </div>

        {/* ── 内容区 5：歌单（v1.61 从顶部入口挪到「大家都在听」下面，整块展示） ── */}
        <div className="mt-5">
          <div className="mb-2.5 flex items-center gap-2 px-4">
            <h2 className="flex-1 text-[16px] font-bold" style={{ color: '#22303A' }}>歌单</h2>
          </div>
          {playlists.length === 0 ? (
            <p className="px-4 py-6 text-center text-[12px]" style={{ color: '#9AA2AC' }}>暂无歌单</p>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 px-4">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => openPlaylistDetail(pl)}
                  className="tap overflow-hidden rounded-3xl text-left transition-transform active:scale-[0.97]"
                  style={{ background: '#FFFFFF', boxShadow: '0 4px 14px rgba(31,45,61,0.06)' }}
                >
                  <div className="grid aspect-square grid-cols-2 gap-px" style={{ background: '#FFFFFF' }}>
                    {[0, 1, 2, 3].map((n) => {
                      const t = tracks[pl.trackIdx[n % pl.trackIdx.length]]
                      return (
                        <div key={n} className="overflow-hidden">
                          <TrackCover track={t} kind={KINDS[(n + 1) % KINDS.length]} uid={`pls-home-${pl.id}-${n}-${t.id}`} />
                        </div>
                      )
                    })}
                  </div>
                  <div className="px-3.5 pb-3.5 pt-2.5">
                    <p className="truncate text-sm font-bold" style={{ color: '#22303A' }}>{pl.name}</p>
                    <p className="mt-0.5 truncate text-[11px]" style={{ color: '#9AA2AC' }}>{pl.trackIdx.length} 首 · {pl.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )

  /* v1.70 播放页 / 歌词页共用「全屏沉浸」外壳：透明底 + 封面取色氛围渐变 + 100dvh 扣安全区
     （判定复用上面的 immersive，v1.81 起同一变量也决定「这两页强制没有底部导航」） */
  const fullBleed = immersive

  return (
    <div
      ref={pageVizRef}
      className={`relative flex flex-col ${fullBleed ? 'overflow-hidden' : ''}`}
      style={{
        background: fullBleed ? 'transparent' : '#F7F8FA',
        /* 安全区（v1.52）：高度扣除刘海屏顶部 / 底部横条 env(safe-area-inset-*)——
           外壳（App.tsx safe-top/safe-bottom）已留好安全区，音乐页原 100dvh 会把这块
           顶出去导致播放页底部被横条遮挡；env=0（桌面 / 普通浏览器）时与原 100dvh 完全一致 */
        height: fullBleed
          ? 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))'
          : undefined,
        minHeight: fullBleed
          ? undefined
          : 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
        /* v1.63：播放页配色变量 —— 由当前曲目封面提取（无封面用插画配色派生），
           驱动 .music-ambient 的背景渐变与柔光光斑；切歌时 CSS 走 1.2s 过渡平滑变色。
           v1.70：歌词页同一套配色（与播放页视觉连续，滑过去像同一张纸的两面）。 */
        ...(fullBleed
          ? ({
              '--mu-a': accent.a,
              '--mu-b': accent.b,
              '--mu-glow': accent.glow,
            } as React.CSSProperties)
          : {}),
        /* v1.70 翻页手势：全屏两页只保留纵向滚动（歌词面板自己滚），横向让给 JS 判滑页 */
        touchAction: fullBleed ? 'pan-y' : undefined,
      }}
      onTouchStart={handlePageTouchStart}
      onTouchEnd={handlePageTouchEnd}
    >
      {/* 播放页 / 歌词页动态氛围底：按封面取色的渐变 + 两枚缓慢流动的柔光光斑
          （Google Material You / Gemini 风格；绝对定位在最底层，不参与布局、不吃点击）
          v1.73：① is-active 只在播放中挂 —— will-change 不再常驻（省合成层）；
                 ② is-paused 让两枚光斑在暂停时停住，符合「暂停后自然静止」；
                 ③ 减少动态效果时同样视为静止。 */}
      {fullBleed && (
        <div
          className={`music-ambient ${playing && !reducedMotion ? 'is-active' : ''} ${
            playing && !reducedMotion ? '' : 'is-paused'
          }`}
          aria-hidden
        />
      )}
      {/* 真实音频播放器（v1.71 已移出本组件）─────────────────────────────
          原来这里是 <audio ref={audioRef} src={track.src} onTimeUpdate=… />，
          它跟着本组件渲染，组件一卸载（切去设置页 / 观看历史 / 做题页等）音频就被销毁。
          现在音频元素由全局引擎持有（new Audio()，不进 React 树），
          事件监听（timeupdate / loadedmetadata / ended / error）也都在引擎里注册。
          详见 src/hooks/useMusicEngine.ts。本组件通过 audioRef 读取它，行为不变。 */}

      {/* ════════ 音乐首页 ════════ */}
      {view === 'home' && (tracks.length ? homeView : emptyView)}

      {/* ════════ 全屏播放页（黑胶唱片机） ════════ */}
      {view === 'player' && track && (
        <div
          className={`relative z-10 flex flex-1 flex-col ${playerFromLyrics ? 'music-page-in-left' : ''}`}
          style={{ minHeight: 0 }}
        >
          {/* 顶栏：返回 + 页点指示器（v1.70：点第二个点或横滑进歌词页） */}
          <div className="relative z-10 flex items-center justify-between px-5 pt-12 pb-1">
            <CircleBtn onClick={() => setView('home')} label="返回">
              <ChevronLeftIcon size={19} />
            </CircleBtn>
            <PageDots current="player" onPlayer={() => openPlayer(false)} onLyrics={() => setView('lyrics')} />
            <div className="h-10 w-10 shrink-0" aria-hidden />
          </div>

          {/* 唱片机 + 歌词区（弹性列）：外层锚星星（在滚动容器外，不被裁剪）
              v1.56 内容顺序改为 歌词 → 歌名 → 唱片（矮屏首屏必须看到歌词）
              v1.60 顺序再改为 歌名 → 唱片 → 歌词（用户要求：歌词放胶片下面，约 5 行 + 上下渐隐）
              v1.61 整页固定不滑动（用户要求：播放页界面固定，只有歌词自己能滑）——
                   内容容器去掉 overflowY:auto（原矮屏滚动整页），改 overflow:hidden 只负责居中；
                   歌词面板自带 overflow-y:auto，手指滑歌词区只滚歌词，其余部分纹丝不动 */}
          <div className="relative z-10 flex flex-1 flex-col" style={{ minHeight: 0 }}>
            {/* v1.63 氛围光点（Google 风）：缓慢漂浮的柔光小点，颜色跟随封面主色。
                位置 / 尺寸 / 节奏各不相同，避免规律感；数量克制，只做氛围。
                v1.73：暂停 / 减少动态效果时停住，不空转。 */}
            <span className={`music-mote ${playing && !reducedMotion ? '' : 'is-paused'}`} aria-hidden style={{ width: 9, height: 9, top: '14%', left: '14%', animationDuration: '10s' }} />
            <span className={`music-mote ${playing && !reducedMotion ? '' : 'is-paused'}`} aria-hidden style={{ width: 6, height: 6, top: '30%', right: '16%', animationDuration: '13s', animationDelay: '1.4s' }} />
            <span className={`music-mote ${playing && !reducedMotion ? '' : 'is-paused'}`} aria-hidden style={{ width: 12, height: 12, bottom: '18%', left: '10%', animationDuration: '15s', animationDelay: '0.7s' }} />
            <span className={`music-mote ${playing && !reducedMotion ? '' : 'is-paused'}`} aria-hidden style={{ width: 7, height: 7, bottom: '26%', right: '12%', animationDuration: '12s', animationDelay: '2.2s' }} />

            <GeminiStar uid="main" size={40} floatSec={6.5} twinkleSec={2.8} style={{ top: '2%', right: '6%' }} />
            <GeminiStar uid="s1" size={14} floatSec={8} twinkleSec={2.2} drift style={{ top: '-2%', left: '9%' }} />
            <GeminiStar uid="s2" size={11} floatSec={9.5} twinkleSec={3.4} drift style={{ bottom: '6%', left: '16%' }} />

            <div className="flex flex-1 flex-col justify-center gap-1 overflow-hidden px-6 pt-2" style={{ minHeight: 0 }}>
            {/* 歌名（最大最粗）+ 歌手 / 播放量 / 音质标签（同一行同一规格）；shrink-0：固定区不被压缩 */}
            <div className="mt-4 flex shrink-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[24px] font-bold leading-tight" style={{ color: '#22303A' }}>{track.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="max-w-[150px] truncate text-[12px] font-medium" style={{ color: '#5D7284' }}>{track.artist}</span>
                  <span className="rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none" style={{ background: 'rgba(49,194,124,0.12)', color: GREEN, fontVariantNumeric: 'tabular-nums' }}>
                    {formatCount(track.playCount)}次播放
                  </span>
                  <span className="rounded-full px-2 py-[3px] text-[10px] font-semibold leading-none" style={{ background: 'rgba(93,114,132,0.1)', color: '#7C93A3' }}>标准</span>
                </div>
              </div>
              <button
                onClick={() => void toggleFav(safeIndex)}
                aria-label={track.favorited ? '取消收藏' : '收藏'}
                className="tap flex shrink-0 flex-col items-center pt-1"
                style={{ color: track.favorited ? '#F5484B' : '#9AAEBB' }}
              >
                <HeartIcon filled={track.favorited} size={24} />
                <span className="mt-1 text-[10px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(track.favCount)}</span>
              </button>
            </div>

            {/* 唱片机（v1.60：位于歌名下方、歌词上方；白卡改透明见 VinylPlayer 内注释） */}
            <VinylPlayer track={track} kind={KINDS[safeIndex % KINDS.length]} playing={playing} uid={`vp-${track.id}`} />

            {/* 歌词（v1.60 从顶部挪到胶片下面；v1.59 恢复卡拉OK逐字渐变填充面板）：复用 KaraokeLyrics 组件实现
                左侧 1 列布局 —— 「正在播放」那一列永远垂直居中，上面是已唱行、下面是待唱行。
                组件内自带 18% 上下渐隐蒙版 —— 歌词从上边缘「渐变进来」、往下边缘「渐变出去」；
                固定高约 5 行（844 屏 170px），满足「显示 5 行 + 渐变进出」。
                逐字填充原理：每个字一个 span，background-clip:text 挖空文字做蒙版，背景是
                linear-gradient(高亮色 var(--kr-p), 灰色 var(--kr-p))，帧循环里只写 --kr-p（只重绘不重排）。
                时间源：组件内 requestAnimationFrame 直接读 audio.currentTime（参考实现里说的
                「监听 timeupdate 节流」在浏览器里约 4Hz，逐字会一跳一跳；rAF 每一帧都是实时时间，
                填充天然平滑，是需求 2 / 7 的更优实现）；暂停时停帧循环，seekSignal 变化补刷一次
                （拖进度条 / 点行跳转立刻同步，需求 6）。
                select-none：歌词不可选中（v1.56 要求保留）。 */}
            <div className="w-full shrink-0 select-none" style={{ WebkitUserSelect: 'none' }}>
              {krcLines.length === 0 ? (
                <p className="py-5 text-[14px]" style={{ color: '#9FB2C0' }}>暂无歌词</p>
              ) : !hasTimeline ? (
                <p className="whitespace-pre-line text-[13px] leading-relaxed" style={{ color: '#7C93A3' }}>
                  {krcLines.map((l) => l.text).join('\n')}
                </p>
              ) : (
                <KaraokeLyrics
                  lines={krcLines}
                  getTime={lyricTime}
                  playing={playing}
                  seekSignal={seekTick}
                  /* 固定高度：844 屏 150px（约 4~5 行），矮屏收到 96~120。
                     v1.61 起父容器不再滚动（整页固定），面板自带 overflow-y:auto ——
                     它是播放页唯一可滑动区域；与唱片 32dvh 配对后 844 屏内容总高 ≈ 可视区，
                     唱片 + 歌词首屏完整可见。 */
                  height={Math.min(150, Math.max(96, Math.round(window.innerHeight * 0.18)))}
                  fillColor={lyricCfg.fill}
                  baseColor={lyricCfg.base}
                  emptyText="暂无歌词"
                  onSeekLine={(_, line) => seekTo(line.start)}
                />
              )}
            </div>
            </div>
          </div>

          {/* 固定 12px 间隙（v1.54：原 min-h-3 flex-1 会和上面滚动区平分剩余高度——
              矮屏滚动区被砍半、唱片裁一半、中间一大段空白；改固定高度后滚动区拿满
              topbar → 图标行之间的全部空间，高屏歌词下方留白仅多 12px 无感） */}
          <div className="h-3 shrink-0" />

          {/* 底部玻璃控制舱（v1.82 精简）：评论 / 下载 / 分享 + 进度 + 控制 包进一块
              整体尺寸压小，按钮 / 内边距 / 圆角全部收紧，玻璃质感保留。
              导航显示时整体抬到 App 导航上方（暂停 / 用户点「显示导航栏」唤出后），
              沉浸播放时贴底（安全区已由根容器扣除） */}
          <div className={`px-4 ${navVisible ? 'pb-[92px]' : 'pb-3'}`}>
          <div
            className="rounded-[24px] transition-[background,box-shadow] duration-700"
            style={{
              /* v1.63：玻璃舱底色叠一层当前封面的光晕色 —— 播放页整体随封面「微妙变化」，
                 只是极淡的染色（透明度很低），不影响原本的浅玻璃观感与写死浅色图标的对比度。
                 切歌时 background / box-shadow 走 700ms 过渡 → 颜色平滑挪过去，不闪。 */
              background: `linear-gradient(165deg, rgba(255,255,255,0.62) 0%, var(--mu-glow) 60%, rgba(255,255,255,0.52) 100%)`,
              backdropFilter: 'blur(28px) saturate(170%)',
              WebkitBackdropFilter: 'blur(28px) saturate(170%)',
              border: '1px solid rgba(255,255,255,0.72)',
              boxShadow: '0 5px 16px rgba(27,30,35,0.07), 0 14px 40px rgba(27,30,35,0.09), inset 0 1px 0 rgba(255,255,255,0.9)',
            }}
          >
              {/* 图标行：歌词配色 / 评论 / 下载 / 分享（v1.82 整体压小：14px 图标 + 8px 文案） */}
              <div className="flex items-start justify-around px-4 pt-2.5 pb-1">
            <button
              onClick={() => setShowLyricColor(true)}
              aria-label="歌词配色"
              className="tap flex w-9 flex-col items-center gap-0.5"
              style={{ color: '#5D7284' }}
            >
              <span className="flex h-[14px] items-center">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="9.2" cy="9.4" r="1.5" fill={lyricCfg.fill} stroke="none" />
                  <circle cx="14.8" cy="9.4" r="1.5" fill={lyricCfg.base} stroke="none" />
                  <path d="M8.2 15.2c1 1.3 2.4 2 3.8 2s2.8-.7 3.8-2" />
                </svg>
              </span>
              <span className="text-[8px] leading-none">配色</span>
            </button>
            <button
              onClick={() => void openComments()}
              aria-label="评论"
              className="tap flex w-9 flex-col items-center gap-0.5"
              style={{ color: '#5D7284' }}
            >
              <span className="flex h-[14px] items-center">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z" />
                </svg>
              </span>
              <span className="text-[8px] leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {track.commentCount > 0 ? track.commentCount : '评论'}
              </span>
            </button>
            <button
              onClick={() => void handleDownload()}
              aria-label="下载歌曲"
              className="tap flex w-9 flex-col items-center gap-0.5"
              style={{ color: downloadBusy ? '#9AAEBB' : '#5D7284' }}
            >
              <span className="flex h-[14px] items-center">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M4 19h16" />
                </svg>
              </span>
              <span className="text-[8px] leading-none">{downloadBusy ? '下载中' : '下载'}</span>
            </button>
            <button
              onClick={() => void handleShare()}
              aria-label="分享歌曲"
              className="tap flex w-9 flex-col items-center gap-0.5"
              style={{ color: '#5D7284' }}
            >
              <span className="flex h-[14px] items-center">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="17" cy="5.5" r="3" />
                  <circle cx="17" cy="18.5" r="3" />
                  <path d="M8.7 10.6l5.6-3.7" />
                  <path d="M8.7 13.4l5.6 3.7" />
                </svg>
              </span>
              <span className="text-[8px] leading-none">分享</span>
            </button>
          </div>

              {/* 进度 + 控制按钮（玻璃舱内；暂停时露出 App 底部导航，外层已留出导航高度） */}
              <div className="px-4 pb-1.5">
            <div ref={barRef} onClick={handleSeek} className="relative mx-auto w-full max-w-[300px] cursor-pointer py-1.5" aria-label="播放进度">
              {/* 轨道（relative 定位基准）：滑块以轨道为锚，圆点始终骑在条上而不是浮在条外（v1.48） */}
              <div className="relative h-[3px] w-full rounded-full" style={{ background: 'rgba(148,177,196,0.32)' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #9BB8CE, #6FA3C9)' }}
                />
                {/* 圆形滑块（跟随进度，垂直居中于轨道） */}
                <div
                  className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${pct}%`,
                    background: '#FFFFFF',
                    border: '2px solid #6FA3C9',
                    boxShadow: '0 1px 5px rgba(31,45,61,0.22)',
                  }}
                />
              </div>
              {/* 当前时间 / 总时间：两端对齐 */}
              <div className="mt-1 flex justify-between text-[10px] font-medium" style={{ color: '#9AAEBB', fontVariantNumeric: 'tabular-nums' }}>
                <span>{formatTime(seconds)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="mt-1 flex items-center justify-center gap-4">
              {/* 播放模式：顺序播放 → 单曲循环 → 随机播放（点按循环切换，非顺序时高亮） */}
              <button
                onClick={cyclePlayMode}
                aria-label={`播放模式：${playMode === 'order' ? '顺序播放' : playMode === 'one' ? '单曲循环' : '随机播放'}`}
                className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{ color: playMode === 'order' ? '#5D7284' : GREEN }}
              >
                {playMode === 'random' ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 3h5v5" />
                    <path d="M4 20L21 3" />
                    <path d="M21 16v5h-5" />
                    <path d="M15 15l6 6" />
                    <path d="M4 4l5 5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 2l4 4-4 4" />
                    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                    <path d="M7 22l-4-4 4-4" />
                    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                    {playMode === 'one' && <text x="9.4" y="15.6" fontSize="8" fill="currentColor" stroke="none" fontWeight="700">1</text>}
                  </svg>
                )}
              </button>
              <button
                onClick={handlePrev}
                aria-label="上一曲"
                className="tap flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
                style={{ color: '#43586A' }}
              >
                <SkipBackIcon size={20} />
              </button>
              <button
                onClick={handleMainToggle}
                aria-label={playing ? '暂停' : '播放'}
                className="tap relative flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.93]"
                style={{
                  background: '#FFFFFF', color: '#22303A',
                  border: '2px solid rgba(148,177,196,0.5)',
                  boxShadow: '0 8px 22px rgba(111,163,201,0.26)',
                }}
              >
                {/* v1.73 播放/暂停「形态过渡」：同一 path 的两个 d 之间做插值
                    （内核不支持时自动降级为缩放交叉淡入）。
                    ⚠️ 仍保留原视觉规格与按钮本身的一切样式，只换图标实现。 */}
                <PlayPauseIcon playing={playing} size={24} />
                {/* 点击涟漪：key 自增重挂 → 连续快速点击每次都能重新播放动画，
                    不会因为"类名没变"而卡住（要求：连续点击不能出现动画冲突）。
                    fill-mode: both → 播完停在 opacity 0，不残留。 */}
                {tapTick > 0 && <span key={tapTick} className="music-btn-ripple" aria-hidden />}
              </button>
              <button
                onClick={handleNext}
                aria-label="下一曲"
                className="tap flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
                style={{ color: '#43586A' }}
              >
                <SkipForwardIcon size={20} />
              </button>
              <button
                onClick={() => setShowList(true)}
                aria-label="播放列表"
                className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ color: '#5D7284' }}
              >
                <ListIcon size={18} />
              </button>
              </div>
              </div>
          </div>
          </div>
        </div>
      )}

      {/* ════════ 全屏歌词页（v1.70：播放页横滑进入；参考 QQ 音乐歌词页，按钮只留必要项） ════════ */}
      {view === 'lyrics' && track && (
        <div className="music-page-in-right relative z-10 flex flex-1 flex-col" style={{ minHeight: 0 }}>
          {/* 顶栏：返回播放页 + 页点指示器（与播放页同一套，当前在歌词页） */}
          <div className="flex items-center justify-between px-5 pt-12 pb-1">
            <CircleBtn onClick={() => openPlayer(true)} label="返回播放页">
              <ChevronLeftIcon size={19} />
            </CircleBtn>
            <PageDots current="lyrics" onPlayer={() => openPlayer(true)} onLyrics={() => setView('lyrics')} />
            <div className="h-10 w-10 shrink-0" aria-hidden />
          </div>

          {/* 歌名 + 歌手 + 收藏爱心（同播放页数据；收藏点击两边状态同步） */}
          <div className="mt-3 flex shrink-0 items-start justify-between gap-3 px-6">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[24px] font-bold leading-tight" style={{ color: '#22303A' }}>{track.title}</h1>
              <p className="mt-2 truncate text-[12px] font-medium" style={{ color: '#5D7284' }}>{track.artist}</p>
            </div>
            <button
              onClick={() => void toggleFav(safeIndex)}
              aria-label={track.favorited ? '取消收藏' : '收藏'}
              className="tap flex shrink-0 flex-col items-center pt-1"
              style={{ color: track.favorited ? '#F5484B' : '#9AAEBB' }}
            >
              <HeartIcon filled={track.favorited} size={24} />
              <span className="mt-1 text-[10px] font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCount(track.favCount)}</span>
            </button>
          </div>

          {/* 全屏歌词：占据剩余全部高度（有逐字时间轴 → 大号卡拉OK面板，点行跳播；
              纯文本 → 可滚动静态歌词；没歌词 → 占位提示） */}
          <div className="min-h-0 flex-1 px-2 pt-2">
            {krcLines.length === 0 ? (
              <p className="pt-16 text-center text-[14px]" style={{ color: '#9FB2C0' }}>暂无歌词</p>
            ) : !hasTimeline ? (
              <div className="h-full overflow-y-auto px-4 py-8">
                <p className="whitespace-pre-line text-center text-[16px] font-semibold leading-9" style={{ color: '#43586A' }}>
                  {krcLines.map((l) => l.text).join('\n')}
                </p>
              </div>
            ) : (
              <KaraokeLyrics
                lines={krcLines}
                getTime={lyricTime}
                playing={playing}
                seekSignal={seekTick}
                /* 大面板：约半屏高（矮屏保底 240px），当前行永远垂直居中 + 上下渐隐 */
                height={Math.max(240, Math.round(window.innerHeight * 0.5))}
                fillColor={lyricCfg.fill}
                baseColor={lyricCfg.base}
                emptyText="暂无歌词"
                onSeekLine={(_, line) => seekTo(line.start)}
              />
            )}
          </div>

          {/* 底部：右下角播放 / 暂停大圆钮（参考图样式；弹/伴/词/星等按钮按需求不加）。
              导航显示时抬到导航上方，沉浸时贴底（含安全区） */}
          <div
            className="flex shrink-0 items-center justify-end px-8 pt-2"
            style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${navVisible ? 108 : 28}px)` }}
          >
            <button
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? '暂停' : '播放'}
              className="tap flex h-14 w-14 items-center justify-center rounded-full transition-transform active:scale-[0.93]"
              style={{ background: '#22303A', color: '#FFFFFF', boxShadow: '0 10px 26px rgba(34,48,58,0.32)' }}
            >
              {playing ? <PauseIcon size={22} strokeWidth={2} /> : <PlayIcon size={22} />}
            </button>
          </div>
        </div>
      )}

      {/* ════════ 专辑详情页（专辑内的歌曲） ════════ */}
      {view === 'album' && openAlbum && (
        <>
          <div className="flex items-center gap-2.5 px-4 pt-11 pb-3">
            <CircleBtn onClick={() => setView('home')} label="返回">
              <ChevronLeftIcon size={19} />
            </CircleBtn>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold" style={{ color: '#22303A' }}>{openAlbum.name}</h2>
              <p className="truncate text-[11px]" style={{ color: '#9AA2AC' }}>
                {openAlbum.track_count} 首{openAlbum.description ? ` · ${openAlbum.description}` : ''}
              </p>
            </div>
            {albumTracks.length > 0 && (
              <button
                onClick={() => playById(albumTracks[0].id)}
                className="tap shrink-0 rounded-full px-4 py-2 text-xs font-semibold text-white transition-transform active:scale-[0.96]"
                style={{ background: GREEN, boxShadow: '0 4px 12px rgba(49,194,124,0.35)' }}
              >
                ▶ 播放全部
              </button>
            )}
            <CircleBtn onClick={() => void refreshMusic()} label="刷新">
              <span className="music-spin" style={{ display: 'inline-flex', animationDuration: '0.9s', animationPlayState: refreshing ? 'running' : 'paused' }}>
                <RefreshCuteIcon size={18} />
              </span>
            </CircleBtn>
          </div>

          <div className={`flex-1 px-4 ${barLifted ? 'pb-44' : 'pb-28'}`} style={{ overflowY: 'auto' }}>
            {albumTracks.length === 0 ? (
              <p className="pt-16 text-center text-sm" style={{ color: '#9AA2AC' }}>这张专辑还没有歌曲</p>
            ) : (
              <div className="space-y-2 pt-1">
                {albumTracks.map((at, n) => {
                  const ti = tracks.findIndex((t) => t.id === at.id)
                  const active = ti === safeIndex
                  return (
                    <button
                      key={at.id}
                      onClick={() => playById(at.id)}
                      className="tap flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left"
                      style={{ background: '#FFFFFF', boxShadow: '0 3px 12px rgba(31,45,61,0.05)' }}
                    >
                      <span className="w-6 shrink-0 text-center text-xs font-semibold" style={{ color: active ? GREEN : '#C3CAD1', fontVariantNumeric: 'tabular-nums' }}>
                        {active && playing ? '♪' : n + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" style={{ color: active ? GREEN : '#22303A' }}>{at.title}</p>
                        <p className="truncate text-xs" style={{ color: '#9AA2AC' }}>{at.artist || '未知歌手'} · {formatCount(at.play_count || 0)}次播放</p>
                      </div>
                      <span className="shrink-0 text-xs" style={{ color: '#9AA2AC', fontVariantNumeric: 'tabular-nums' }}>{formatTime(at.duration)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {miniBar}
        </>
      )}

      {/* ════════ 搜索页 ════════ */}
      {view === 'search' && (
        <>
          <div className="flex items-center gap-2.5 px-4 pt-11 pb-3">
            <CircleBtn onClick={() => setView('home')} label="返回">
              <ChevronLeftIcon size={19} />
            </CircleBtn>
            <div
              className="flex h-10 flex-1 items-center gap-2 rounded-full px-4"
              style={{ background: '#FFFFFF', boxShadow: '0 2px 10px rgba(31,45,61,0.05)' }}
            >
              <SearchIcon size={16} color="#B7BEC7" />
              <input
                ref={searchRef}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索歌曲、歌手"
                autoFocus
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: '#22303A' }}
              />
              {keyword && (
                <button onClick={() => setKeyword('')} aria-label="清空" className="text-xs" style={{ color: '#9AA2AC' }}>✕</button>
              )}
            </div>
            <CircleBtn onClick={() => void refreshMusic()} label="刷新">
              <span className="music-spin" style={{ display: 'inline-flex', animationDuration: '0.9s', animationPlayState: refreshing ? 'running' : 'paused' }}>
                <RefreshCuteIcon size={18} />
              </span>
            </CircleBtn>
          </div>

          <div className={`flex-1 px-4 ${barLifted ? 'pb-44' : 'pb-28'}`} style={{ overflowY: 'auto' }}>
            {keyword.trim() === '' ? (
              <div className="pt-10 text-center">
                <p className="text-sm" style={{ color: '#9AA2AC' }}>搜一首想听的吧</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {tracks.slice(0, 5).map((t) => (
                    <button
                      key={`hot-${t.id}`}
                      onClick={() => setKeyword(t.title)}
                      className="tap rounded-full px-3.5 py-1.5 text-xs"
                      style={{ background: '#FFFFFF', color: '#5D7284', boxShadow: '0 2px 8px rgba(31,45,61,0.05)' }}
                    >
                      {t.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : searchResults.length === 0 ? (
              <p className="pt-10 text-center text-sm" style={{ color: '#9AA2AC' }}>没有找到「{keyword.trim()}」相关的歌曲</p>
            ) : (
              <div className="space-y-2 pt-2">
                {searchResults.map(({ t, i }) => {
                  const active = i === safeIndex
                  return (
                    <button
                      key={`sr-${t.id}`}
                      onClick={() => playFrom(i)}
                      className="tap flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left"
                      style={{ background: '#FFFFFF', boxShadow: '0 3px 12px rgba(31,45,61,0.05)' }}
                    >
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl">
                        <TrackCover track={t} kind={KINDS[i % KINDS.length]} uid={`sr-${t.id}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" style={{ color: active ? GREEN : '#22303A' }}>{t.title}</p>
                        <p className="truncate text-xs" style={{ color: '#9AA2AC' }}>{t.artist} · {formatCount(t.playCount)}次播放</p>
                      </div>
                      <span className="shrink-0 text-xs" style={{ color: '#9AA2AC', fontVariantNumeric: 'tabular-nums' }}>{formatTime(t.duration)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {miniBar}
        </>
      )}

      {/* ════════ 歌单列表页 ════════ */}
      {view === 'playlists' && (
        <>
          <div className="flex items-center gap-2.5 px-4 pt-11 pb-3">
            <CircleBtn onClick={() => setView('home')} label="返回">
              <ChevronLeftIcon size={19} />
            </CircleBtn>
            <h2 className="flex-1 text-[17px] font-bold" style={{ color: '#22303A' }}>歌单</h2>
            <CircleBtn onClick={() => void refreshMusic()} label="刷新">
              <span className="music-spin" style={{ display: 'inline-flex', animationDuration: '0.9s', animationPlayState: refreshing ? 'running' : 'paused' }}>
                <RefreshCuteIcon size={18} />
              </span>
            </CircleBtn>
          </div>

          <div className={`flex-1 px-4 ${barLifted ? 'pb-44' : 'pb-28'}`} style={{ overflowY: 'auto' }}>
            <div className="grid grid-cols-2 gap-3.5 pt-1">
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => openPlaylistDetail(pl)}
                  className="tap overflow-hidden rounded-3xl text-left transition-transform active:scale-[0.97]"
                  style={{ background: '#FFFFFF', boxShadow: '0 4px 14px rgba(31,45,61,0.06)' }}
                >
                  <div className="grid aspect-square grid-cols-2 gap-px" style={{ background: '#FFFFFF' }}>
                    {[0, 1, 2, 3].map((n) => {
                      const t = tracks[pl.trackIdx[n % pl.trackIdx.length]]
                      return (
                        <div key={n} className="overflow-hidden">
                          <TrackCover track={t} kind={KINDS[(n + 1) % KINDS.length]} uid={`pls-${pl.id}-${n}-${t.id}`} />
                        </div>
                      )
                    })}
                  </div>
                  <div className="px-3.5 pb-3.5 pt-2.5">
                    <p className="truncate text-sm font-bold" style={{ color: '#22303A' }}>{pl.name}</p>
                    <p className="mt-0.5 truncate text-[11px]" style={{ color: '#9AA2AC' }}>{pl.trackIdx.length} 首 · {pl.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          {miniBar}
        </>
      )}

      {/* ════════ 歌单详情 / 歌曲列表页 ════════ */}
      {view === 'playlist' && openPlaylist && (
        <>
          <div className="flex items-center gap-2.5 px-4 pt-11 pb-3">
            <CircleBtn onClick={() => setView('playlists')} label="返回歌单列表">
              <ChevronLeftIcon size={19} />
            </CircleBtn>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold" style={{ color: '#22303A' }}>{openPlaylist.name}</h2>
              <p className="truncate text-[11px]" style={{ color: '#9AA2AC' }}>{openPlaylist.trackIdx.length} 首 · {openPlaylist.desc}</p>
            </div>
            <button
              onClick={() => playFrom(openPlaylist.trackIdx[0])}
              className="tap shrink-0 rounded-full px-4 py-2 text-xs font-semibold text-white transition-transform active:scale-[0.96]"
              style={{ background: GREEN, boxShadow: '0 4px 12px rgba(49,194,124,0.35)' }}
            >
              ▶ 播放全部
            </button>
            <CircleBtn onClick={() => void refreshMusic()} label="刷新">
              <span className="music-spin" style={{ display: 'inline-flex', animationDuration: '0.9s', animationPlayState: refreshing ? 'running' : 'paused' }}>
                <RefreshCuteIcon size={18} />
              </span>
            </CircleBtn>
          </div>

          <div className={`flex-1 px-4 ${barLifted ? 'pb-44' : 'pb-28'}`} style={{ overflowY: 'auto' }}>
            <div className="space-y-2 pt-1">
              {openPlaylist.trackIdx.map((ti, n) => {
                const t = tracks[ti]
                const active = ti === safeIndex
                return (
                  <button
                    key={`${openPlaylist.id}-${t.id}`}
                    onClick={() => playFrom(ti)}
                    className="tap flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left"
                    style={{ background: '#FFFFFF', boxShadow: '0 3px 12px rgba(31,45,61,0.05)' }}
                  >
                    <span className="w-6 shrink-0 text-center text-xs font-semibold" style={{ color: active ? GREEN : '#C3CAD1', fontVariantNumeric: 'tabular-nums' }}>
                      {active && playing ? '♪' : n + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" style={{ color: active ? GREEN : '#22303A' }}>{t.title}</p>
                      <p className="truncate text-xs" style={{ color: '#9AA2AC' }}>{t.artist} · {formatCount(t.playCount)}次播放</p>
                    </div>
                    <span className="shrink-0 text-xs" style={{ color: '#9AA2AC', fontVariantNumeric: 'tabular-nums' }}>{formatTime(t.duration)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {miniBar}
        </>
      )}

      {/* ════════ 悬浮播放条（v1.70 根级渲染）：
          音乐 Tab 首页显示；切走 Tab 且播放中在其他 Tab 底部也显示（后台播放入口） ════════ */}
      {floatBar}

      {/* ════════ 播放列表弹层 ════════ */}
      {showList && createPortal(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0" style={{ background: 'rgba(52,74,88,0.28)' }} onClick={() => setShowList(false)} />
          <div
            className="anim-sheet-in absolute bottom-0 left-1/2 w-full max-w-[430px] -translate-x-1/2 rounded-t-3xl px-5 pb-10 pt-3"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 24px rgba(31,45,61,0.14)' }}
          >
            <div className="mb-3 flex justify-center">
              <div className="h-1 w-10 rounded-full" style={{ background: '#E4E7EB' }} />
            </div>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: '#22303A' }}>播放列表</h3>
              <div className="flex items-center gap-2.5">
                <span className="text-xs" style={{ color: '#9AA2AC' }}>{tracks.length} 首 · 在线播放</span>
                <button
                  onClick={() => { setShowList(false); setView('playlists') }}
                  className="tap rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: 'rgba(49,194,124,0.1)', color: GREEN }}
                >
                  歌单 ›
                </button>
              </div>
            </div>
            <div className="max-h-[52vh] space-y-2" style={{ overflowY: 'auto' }}>
              {tracks.map((t, i) => {
                const active = i === safeIndex
                return (
                  <button
                    key={`ql-${t.id}`}
                    onClick={() => { switchTo(i); setShowList(false) }}
                    className="tap flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left"
                    style={{ background: active ? 'rgba(49,194,124,0.08)' : '#F7F8FA' }}
                  >
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl">
                      <TrackCover track={t} kind={KINDS[i % KINDS.length]} uid={`ql-${t.id}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" style={{ color: active ? GREEN : '#22303A' }}>{t.title}</p>
                      <p className="truncate text-xs" style={{ color: '#9AA2AC' }}>{t.artist} · {formatCount(t.playCount)}次播放</p>
                      <div className="mt-1.5 h-[3px] w-full rounded-full" style={{ background: '#E9ECEF' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${active ? pct : listPct[i]}%`, background: active ? GREEN : '#CFD6DC' }}
                        />
                      </div>
                    </div>
                    {active && <span className="text-[10px] font-bold" style={{ color: GREEN }}>{playing ? '播放中' : '已暂停'}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ════════ 评论弹层（播放页） ════════ */}
      {showComments && track && createPortal(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0" style={{ background: 'rgba(52,74,88,0.28)' }} onClick={() => setShowComments(false)} />
          <div
            className="anim-sheet-in absolute bottom-0 left-1/2 flex w-full max-w-[430px] -translate-x-1/2 flex-col rounded-t-3xl px-5 pb-6 pt-3"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 24px rgba(31,45,61,0.14)', maxHeight: '72vh' }}
          >
            <div className="mb-3 flex justify-center">
              <div className="h-1 w-10 rounded-full" style={{ background: '#E4E7EB' }} />
            </div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: '#22303A' }}>评论（{track.commentCount}）</h3>
              <span className="max-w-[150px] truncate text-xs" style={{ color: '#9AA2AC' }}>{track.title}</span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto pb-2" style={{ minHeight: 120 }}>
              {comments === null ? (
                <p className="py-10 text-center text-sm" style={{ color: '#9AA2AC' }}>加载中…</p>
              ) : comments.length === 0 ? (
                <p className="py-10 text-center text-sm" style={{ color: '#9AA2AC' }}>还没有评论，来说两句吧</p>
              ) : (
                comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <Avatar value={c.avatar} name={c.nickname} size={30} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold" style={{ color: '#5D7284' }}>
                        {c.nickname}
                        <span className="ml-1.5 font-normal" style={{ color: '#B7BEC7' }}>{formatMoment(c.created_at)}</span>
                      </p>
                      <p className="mt-0.5 text-[13px] leading-5" style={{ color: '#22303A', wordBreak: 'break-word' }}>{c.content}</p>
                    </div>
                    {c.mine && (
                      <button onClick={() => void removeComment(c.id)} aria-label="删除评论" className="tap mt-1 shrink-0 text-[11px]" style={{ color: '#CDD3D9' }}>
                        ✕
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* 发布框 */}
            <div className="mt-3 flex items-center gap-2">
              <div
                className="flex h-10 flex-1 items-center rounded-full px-4"
                style={{ background: '#F4F6F8' }}
              >
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submitComment() }}
                  maxLength={300}
                  placeholder="说点什么…"
                  className="w-full bg-transparent text-sm outline-none"
                  style={{ color: '#22303A' }}
                />
              </div>
              <button
                onClick={() => void submitComment()}
                disabled={commentBusy || !commentText.trim()}
                aria-label="发送评论"
                className="tap flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-transform active:scale-[0.92]"
                style={{ background: GREEN, opacity: commentBusy || !commentText.trim() ? 0.5 : 1 }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2L11 13" />
                  <path d="M22 2l-7 20-4-9-9-4 20-7z" />
                </svg>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ════════ 歌词配色弹层（v1.67） ════════ */}
      {showLyricColor && createPortal(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0" style={{ background: 'rgba(52,74,88,0.28)' }} onClick={() => setShowLyricColor(false)} />
          <div
            className="anim-sheet-in absolute bottom-0 left-1/2 flex w-full max-w-[430px] -translate-x-1/2 flex-col rounded-t-3xl px-5 pb-6 pt-3"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 24px rgba(31,45,61,0.14)', maxHeight: '78vh' }}
          >
            <div className="mb-3 flex justify-center">
              <div className="h-1 w-10 rounded-full" style={{ background: '#E4E7EB' }} />
            </div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold" style={{ color: '#22303A' }}>歌词配色</h3>
              <span className="text-xs" style={{ color: '#9AA2AC' }}>已唱填充 / 未唱底色</span>
            </div>

            {/* 实时预览：小唱片歌词卡片（配色即时反映草稿选择） */}
            <div
              className="mb-4 rounded-2xl px-4 py-4"
              style={{ background: 'linear-gradient(165deg,#F4F8FB 0%,#E7F1F8 100%)' }}
            >
              <p className="text-[11px]" style={{ color: '#9AA2AC' }}>预览</p>
              <p className="mt-1.5 text-[15px] font-semibold">
                <span style={{ color: draftCfg.fill }}>山重水复疑无路</span>
                <span style={{ color: draftCfg.base }}>，柳暗花明又一村</span>
              </p>
            </div>

            <div className="flex-1 overflow-y-auto pb-1" style={{ minHeight: 80 }}>
              {/* 预设配色（Google 风：低饱和、克制、色相拉开但都适合浅底） */}
              <p className="mb-2 text-xs font-semibold" style={{ color: '#5D7284' }}>精选配色</p>
              <div className="grid grid-cols-4 gap-2.5">
                {LYRIC_PRESETS.map((ps) => {
                  const active = draftCfg.fill === ps.fill && draftCfg.base === ps.base
                  return (
                    <button
                      key={ps.id}
                      onClick={() => setDraftCfg({ fill: ps.fill, base: ps.base })}
                      aria-label={`配色：${ps.name}`}
                      className="tap flex flex-col items-center gap-1.5 rounded-2xl py-2.5"
                      style={{
                        background: active ? 'rgba(49,194,124,0.08)' : '#F7F8FA',
                        border: active ? '1.5px solid ' + GREEN : '1.5px solid transparent',
                      }}
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: ps.fill }}>
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: ps.base }} />
                      </span>
                      <span className="text-[10px] leading-none" style={{ color: active ? GREEN : '#5D7284' }}>{ps.name}</span>
                    </button>
                  )
                })}
              </div>

              {/* 自定义：用户可选任意两色 */}
              <p className="mb-2 mt-4 text-xs font-semibold" style={{ color: '#5D7284' }}>自定义</p>
              <div className="flex gap-3">
                <label className="flex flex-1 items-center gap-2.5 rounded-2xl px-3 py-2.5" style={{ background: '#F7F8FA' }}>
                  <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full" style={{ border: '1px solid #E4E7EB' }}>
                    <input
                      type="color"
                      value={draftCfg.fill}
                      onChange={(e) => setDraftCfg((c) => ({ ...c, fill: e.target.value }))}
                      aria-label="已唱填充色"
                      className="absolute -left-1 -top-1 h-10 w-10 cursor-pointer border-0 bg-transparent p-0"
                      style={{ appearance: 'none' }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold" style={{ color: '#22303A' }}>已唱填充色</span>
                    <span className="block text-[10px] uppercase" style={{ color: '#9AA2AC' }}>{draftCfg.fill}</span>
                  </span>
                </label>
                <label className="flex flex-1 items-center gap-2.5 rounded-2xl px-3 py-2.5" style={{ background: '#F7F8FA' }}>
                  <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full" style={{ border: '1px solid #E4E7EB' }}>
                    <input
                      type="color"
                      value={draftCfg.base}
                      onChange={(e) => setDraftCfg((c) => ({ ...c, base: e.target.value }))}
                      aria-label="未唱底色"
                      className="absolute -left-1 -top-1 h-10 w-10 cursor-pointer border-0 bg-transparent p-0"
                      style={{ appearance: 'none' }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold" style={{ color: '#22303A' }}>未唱底色</span>
                    <span className="block text-[10px] uppercase" style={{ color: '#9AA2AC' }}>{draftCfg.base}</span>
                  </span>
                </label>
              </div>
            </div>

            {/* 操作：恢复默认 / 应用 */}
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => setDraftCfg({ ...DEFAULT_LYRIC_CFG })}
                className="tap shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold"
                style={{ background: '#F2F4F6', color: '#5D7284' }}
              >
                恢复默认
              </button>
              <button
                onClick={() => {
                  setLyricCfg(draftCfg)
                  writeLyricCfg(draftCfg)
                  setShowLyricColor(false)
                }}
                className="tap flex-1 rounded-full py-2.5 text-sm font-semibold text-white transition-transform active:scale-[0.98]"
                style={{ background: GREEN, boxShadow: '0 4px 12px rgba(49,194,124,0.35)' }}
              >
                应用
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   v1.72 全局悬浮球播放器 GlobalMusicFab
   ------------------------------------------------------------------------
   【它解决什么问题】
     音乐页 MusicScreen 自己有完整的播放 UI（悬浮条 / 播放页 / 歌词页）。
     但用户切到别的 Tab（首页 / 题库 / 资料 / 我的）或进「整页视图」
     （做题 / 考试 / 看视频 / 设置 / 观看历史 / 成绩记录 …）时，那些界面里
     一个播放控件都没有 —— 歌在响，却看不到在放什么、也没法暂停 / 切歌。

   【本组件做的事】
     在音乐页之外的任何界面挂一个可以自由拖动的小悬浮球：
       · 收起态：圆形唱片（播放中匀速旋转）+ 外圈进度环 —— 一眼看出放的是哪首、播到哪；
       · 拖动：按住球拖到任意位置，松手记住位置（localStorage: ndt_music_fab_pos），
         旋屏 / 改窗口尺寸时自动夹回可视区，不会被拖丢；
       · 单击：展开成迷你播放器 —— 封面 + 歌名 + 歌手 + 上一首 / 播放暂停 / 下一首 + 收起钮；
         再点球（或点收起钮）收回小球；拖动时自动收起面板，免得挡视线；
       · 点封面 / 歌名：回音乐 Tab 继续看播放页（openMusicPage）。

   【显示时机】
     MusicScreen 用 setMusicPageVisible(active) 上报「音乐页是否正被用户看着」：
       · 音乐页可见（含页内播放页 / 歌词 / 搜索 / 歌单等所有子视图）→ 返回 null，
         一切都是音乐页自己的 UI，【音乐界面完全不变】；
       · 音乐页不可见 且 引擎里有曲目 → 显示悬浮球（首页 / 题库 / 资料 / 我的 / 做题 /
         考试 / 看视频 / 设置 … 全都覆盖）。
     ⚠️ 必须 createPortal 到 document.body：fixed 元素一旦处在带 transform /
        filter / backdrop-filter 的祖先内，定位基准会从视口变成那个祖先。
     ⚠️ 球上必须 touch-action:none —— 否则手机上拖动会被页面滚动"抢走"手势。
     ⚠️ 拖拽期间直接改 DOM 的 left/top（不走 setState），松手才落一次状态：
        否则每个 pointermove 都会重渲染整棵树，低端机上会掉帧。
   ============================================================================ */

/** 悬浮球直径（px） */
const FAB_SIZE = 54
/** 展开面板宽度（px）：固定宽度才能在主屏边缘做精确夹紧，不至于把面板推出屏幕外 */
const FAB_PANEL_W = 296
/** 展开面板高度（px）：由内容决定（34px 封面 + 上下 6px 内边距 ≈ 46）。
 *  只用于「共享元素形变」那一层玻璃胶囊的起止尺寸，不参与面板自身布局。 */
const FAB_PANEL_H = 46
/** 悬浮球位置存储键（视口左上角为原点的像素坐标） */
const FAB_POS_KEY = 'ndt_music_fab_pos'
/** 悬浮球离屏幕边缘的最小间距 */
const FAB_EDGE = 8
/** 判定「这是拖拽而不是点击」的位移阈值（px） */
const FAB_DRAG_THRESHOLD = 6

interface FabPos { x: number; y: number }

/** 悬浮球的活动区域。
 *  桌面端整个应用只有中间一条（.app-shell，max-width 430px）是界面，
 *  球要是按视口右边缘定位就会飘到手机壳外面去 —— 所以优先贴合 App 外壳，
 *  取不到外壳（异常 / 首帧）时回落到整个视口。 */
function fabBounds() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = 0
  let right = vw
  const shell = document.querySelector('.app-shell')
  if (shell) {
    const r = shell.getBoundingClientRect()
    if (r.width > 0) {
      left = Math.max(0, r.left)
      right = Math.min(vw, r.right)
    }
  }
  /* 外壳比球还窄（理论上不会）：干脆用整个视口 */
  if (right - left < FAB_SIZE + FAB_EDGE * 2) {
    left = 0
    right = vw
  }
  return {
    left,
    right,
    /* 球的 minX / maxX + 纵向范围 */
    minX: left + FAB_EDGE,
    maxX: Math.max(left + FAB_EDGE, right - FAB_SIZE - FAB_EDGE),
    minY: FAB_EDGE,
    maxY: Math.max(FAB_EDGE, vh - FAB_SIZE - FAB_EDGE),
  }
}

/** 把坐标夹进活动区，避免球被拖到屏幕外拿不回来 */
function clampFabPos(p: FabPos): FabPos {
  const b = fabBounds()
  return {
    x: Math.min(Math.max(b.minX, p.x), b.maxX),
    y: Math.min(Math.max(b.minY, p.y), b.maxY),
  }
}

/** 读上次摆放的位置；没有记录时给默认位（右侧、62% 高度处，避开底部导航） */
function readFabPos(): FabPos {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<FabPos>
      if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        return clampFabPos({ x: p.x, y: p.y })
      }
    }
  } catch {
    /* 存储不可用 / 数据损坏：落到默认位置 */
  }
  const b = fabBounds()
  /* 默认贴右下（底部导航上方一点），最像"播放器缩小成了球" */
  return { x: b.maxX - 6, y: Math.min(Math.max(b.minY, window.innerHeight - FAB_SIZE - 96), b.maxY) }
}

export function GlobalMusicFab() {
  const engineState = useMusicEngine()
  const pageVisible = useMusicPageVisible()
  /* v1.73 动效设置 + 用户减少动态效果偏好 + 律动总线挂载点 */
  const fx = useMusicFx()
  const reducedMotion = useReducedMotion()
  const vizRef = useVizTarget<HTMLButtonElement>()

  const index = engineState.index
  const playing = engineState.playing
  /* 引擎里的曲目就是本文件的 Track（setQueue 时原样传入），这里收回类型方便复用
     TrackCover / KINDS —— 封面插画、配色与音乐页内的播放条完全一致。 */
  const track = engineState.queue[index] as unknown as Track | undefined

  /* 球体配色：与播放页同一套取色逻辑（真封面提主色 → 插画配色派生），
     缓存与回落都在 hook 内部，切歌来回切不会重复解码。
     挂在最外层，供 .music-orb-flow / .music-orb-glow 消费（CSS 变量继承）。
     切歌时 conic-gradient 只换颜色、结构不变 → 浏览器可插值 → 颜色连续不跳。 */
  const fallbackAccent: AccentTriple = useMemo(
    () =>
      paletteTriple(
        track?.palette ?? { skyTop: '#F7FAF9', skyBottom: '#DCEBE3', mid: '#8AAE9A' },
      ),
    [track?.palette],
  )
  const accent = useCoverAccent(track?.coverUrl ?? '', fallbackAccent)

  /* 球的位置（收起 / 展开共用同一锚点，展开面板相对球弹出 → 拖球即拖整条） */
  const [pos, setPos] = useState<FabPos>(() => readFabPos())
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)
  /* 拖拽期间的实时坐标：播放进度会让本组件每秒重渲染好几次，
     渲染必须读它，否则球会被"弹"回拖拽前的位置 */
  const livePosRef = useRef<FabPos>(pos)
  /* 拖拽会话：pointerId / 起点 / 球起点坐标 / 最新坐标 / 是否已判定为拖拽 */
  const dragRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; lx: number; ly: number; moved: boolean } | null>(null)
  /* 拖拽刚结束要吞掉紧随其后的 click（浏览器 pointerup 后仍会补一个 click） */
  const swallowClickRef = useRef(false)

  /* ── v1.73 按压 / 长按 / 拉伸：全部走 DOM 直改，不进 React state ──
     原因同拖拽：播放进度每秒让本组件重渲染数次，按压反馈如果用 state，
     会和重渲染打架（这也是"点击反馈与拖拽互相干扰"的常见来源）。 */
  const pressRef = useRef<HTMLSpanElement | null>(null)
  const stretchRef = useRef<HTMLSpanElement | null>(null)
  const longPressTimer = useRef<number | null>(null)
  const longFiredRef = useRef(false)

  /** 按下：压缩。先摘掉上一轮的回弹动画并强制重排，保证连续点击每次都从头播 */
  const pressDown = useCallback(() => {
    const el = pressRef.current
    if (!el) return
    el.classList.remove('is-release')
    void el.offsetWidth
    el.classList.add('is-down')
  }, [])

  /** 松开：扩张回弹（bounce=false 时只做平滑归位，例如拖动开始时） */
  const pressUp = useCallback((bounce: boolean) => {
    const el = pressRef.current
    if (!el) return
    const wasDown = el.classList.contains('is-down')
    el.classList.remove('is-down')
    if (bounce && wasDown) {
      el.classList.remove('is-release')
      void el.offsetWidth
      el.classList.add('is-release')
    }
  }, [])

  /** 拖动开始 / 长按触发时清掉按压态，避免按压动画和拖拽叠在一起 */
  const pressClear = useCallback(() => {
    const el = pressRef.current
    if (!el) return
    el.classList.remove('is-down')
    el.classList.remove('is-release')
  }, [])

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  /* 旋屏 / 改窗口尺寸：把球重新夹回可视区 */
  useEffect(() => {
    const onResize = () => setPos((p) => clampFabPos(p))
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
    livePosRef.current = pos
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, lx: pos.x, ly: pos.y, moved: false }
    pressDown()
    /* 长按唤出动效设置：与拖拽互斥 —— 拖拽要求位移 ≥6px，长按要求 480ms 内不动，
       两个条件不可能同时成立，所以不会互相误触。 */
    longFiredRef.current = false
    clearLongPress()
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      const d = dragRef.current
      if (d?.moved) return
      longFiredRef.current = true
      swallowClickRef.current = true
      pressUp(false)
      try { navigator.vibrate?.(12) } catch { /* 硬件不支持就算了 */ }
      requestOpenMusicFx()
    }, 480)
  }, [pos, pressDown, pressUp, clearLongPress])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved) {
      if (Math.hypot(dx, dy) < FAB_DRAG_THRESHOLD) return
      d.moved = true
      swallowClickRef.current = true
      clearLongPress()
      pressClear()
      setDragging(true)
      setExpanded(false) /* 开始拖动就收起面板 */
      /* 拖拽期间关掉拉伸过渡：跟手不能有延迟；松手时再打开，走回弹过渡 */
      const st = stretchRef.current
      if (st) st.style.transition = 'none'
    }
    const next = clampFabPos({ x: d.ox + dx, y: d.oy + dy })
    d.lx = next.x
    d.ly = next.y
    livePosRef.current = next
    /* 直接改 DOM：拖拽期间零额外重渲染，松手才落状态 */
    const box = boxRef.current
    if (box) {
      box.style.left = `${next.x}px`
      box.style.top = `${next.y}px`
    }
    /* 软球被拖着走：沿拖动方向拉伸、垂直方向收窄（等比，幅度上限 ~11%）。
       用 rotate(θ) scale rotate(-θ) 让拉伸轴跟着手指方向转，球内封面不会歪。 */
    const st = stretchRef.current
    if (st) {
      const dist = Math.hypot(dx, dy)
      const k = Math.min(0.11, dist / 620)
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI
      st.style.setProperty('--fab-rot', `${ang.toFixed(1)}deg`)
      st.style.setProperty('--fab-sx', (1 + k).toFixed(3))
      st.style.setProperty('--fab-sy', (1 - k * 0.55).toFixed(3))
    }
  }, [clearLongPress, pressClear])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    clearLongPress()
    if (!d || d.id !== e.pointerId) {
      pressUp(true)
      return
    }
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 忽略 */ }
    if (!d.moved) {
      /* 没动过：给一次"扩张回弹"的反馈，然后交给 onClick 去展开 / 收起。
         （长按已触发时 pressUp(false) 已经清掉按压态，这里不会再回弹） */
      if (!longFiredRef.current) pressUp(true)
      return
    }
    setDragging(false)
    setPos({ x: d.lx, y: d.ly }) /* 落状态，让 React 与 DOM 对齐 */
    try { localStorage.setItem(FAB_POS_KEY, JSON.stringify({ x: d.lx, y: d.ly })) } catch { /* 忽略 */ }
    /* 松手：恢复过渡 → 拉伸量归零，走 0.4s 回弹（"平滑吸附"的观感由它给出） */
    const st = stretchRef.current
    if (st) {
      st.style.transition = ''
      st.style.removeProperty('--fab-rot')
      st.style.removeProperty('--fab-sx')
      st.style.removeProperty('--fab-sy')
    }
  }, [clearLongPress, pressUp])

  const onBallClick = useCallback(() => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false
      return
    }
    setExpanded((v) => !v)
  }, [])

  /* 组件卸载时清掉长按定时器，避免"人走了还在跳" */
  useEffect(() => clearLongPress, [clearLongPress])

  /* 展开 / 收起时的「共享元素形变」：一块玻璃胶囊从球的尺寸长成面板的尺寸（再缩回去）。
     transform-only，且不用 backdrop-filter（面板自己那层 blur 已经够，别叠模糊）。
     morphOn 用一帧延迟翻起来，保证挂载首帧停在"球的尺寸"，过渡才看得见。 */
  const [morphAlive, setMorphAlive] = useState(false)
  const [morphOn, setMorphOn] = useState(false)
  useEffect(() => {
    if (expanded) {
      setMorphAlive(true)
      const raf = requestAnimationFrame(() => setMorphOn(true))
      return () => cancelAnimationFrame(raf)
    }
    setMorphOn(false)
    const t = window.setTimeout(() => setMorphAlive(false), 400)
    return () => window.clearTimeout(t)
  }, [expanded])

  /* 音乐页可见 → 完全交给音乐页自己的 UI（音乐界面不变）；没有曲目 → 不显示 */
  if (!track || pageVisible) return null

  /* 拖拽中读实时坐标（播放进度导致的高频重渲染不能把球弹回原位） */
  const viewPos = dragging ? livePosRef.current : pos

  /* 展开面板的水平位置：先按球在哪半边决定朝左 / 朝右伸，再整体夹进活动区（不推出去） */
  const bounds = fabBounds()
  const onRightHalf = viewPos.x + FAB_SIZE / 2 > (bounds.left + bounds.right) / 2
  const panelMaxLeft = Math.max(bounds.minX, bounds.right - FAB_PANEL_W - FAB_EDGE)
  const rawLeft = onRightHalf ? viewPos.x - FAB_EDGE - FAB_PANEL_W : viewPos.x + FAB_SIZE + FAB_EDGE
  const panelLeft = Math.min(Math.max(bounds.minX, rawLeft), panelMaxLeft)

  /* 外圈进度环：走满一圈 = 这首放完 */
  const dur = engineState.duration || track.duration || 0
  const pct = dur > 0 ? Math.min(100, Math.max(0, (engineState.seconds / dur) * 100)) : 0
  const ringR = (FAB_SIZE - 5) / 2
  const ringC = 2 * Math.PI * ringR

  return createPortal(
    <div
      ref={boxRef}
      className="fixed"
      style={{
        left: viewPos.x,
        top: viewPos.y,
        width: FAB_SIZE,
        height: FAB_SIZE,
        zIndex: 55,
        touchAction: 'none',
        /* 球体配色（与播放页同一套取色逻辑派生）：挂在最外层，内部各层用 var() 继承消费 */
        ...({
          '--mo-a': accent.a,
          '--mo-b': accent.b,
          '--mo-glow': accent.glow,
        } as React.CSSProperties),
      }}
    >
      {/* ── 共享元素形变层（v1.73）──
          展开时：这块玻璃胶囊从「球的尺寸」长成「面板的尺寸」，所以看起来是
          球自己变形成了迷你播放器，而不是两个无关组件硬切。
          收起时反向缩回球里（缩完再卸载）。
          只用 transform / opacity —— 不加 backdrop-filter，面板自身那层模糊已经够，
          绝不叠第二层持续运行的模糊。 */}
      {(expanded || morphAlive) && (
        <div
          className="music-fab-morph"
          aria-hidden
          style={{
            position: 'absolute',
            top: FAB_SIZE / 2 - FAB_PANEL_H / 2,
            left: panelLeft - viewPos.x,
            width: FAB_PANEL_W,
            height: FAB_PANEL_H,
            transformOrigin: onRightHalf ? 'right center' : 'left center',
            transform: morphOn
              ? 'scale(1)'
              : `scale(${(FAB_SIZE / FAB_PANEL_W).toFixed(4)}, ${(FAB_SIZE / FAB_PANEL_H).toFixed(4)})`,
            opacity: morphOn ? 1 : 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* ── 展开态：迷你播放器（磨砂玻璃胶囊，相对球弹出，水平已夹进视口） ── */}
      {expanded && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: panelLeft - viewPos.x,
            width: FAB_PANEL_W,
            transform: 'translateY(-50%)',
          }}
        >
          <div
            className="nav-liquid music-fab-panel [&>*]:relative flex items-center gap-1.5 py-1.5 pr-1.5 pl-1.5"
            style={{ transformOrigin: onRightHalf ? 'right center' : 'left center' }}
          >
            {/* 封面（播放中旋转）：点它回音乐 Tab 看播放页 */}
            <button
              onClick={() => { setExpanded(false); openMusicPage() }}
              aria-label="回到音乐播放页"
              className="tap shrink-0 rounded-full"
              style={{ width: 34, height: 34 }}
            >
              <div
                className="music-spin h-[34px] w-[34px] overflow-hidden rounded-full"
                style={{
                  border: '2px solid #FFFFFF',
                  boxShadow: '0 2px 8px rgba(31,45,61,0.16)',
                  animationPlayState: playing ? 'running' : 'paused',
                }}
              >
                <TrackCover track={track} kind={KINDS[index % KINDS.length]} uid={`gf-${track.id}`} />
              </div>
            </button>

            {/* 歌名 / 歌手：点回音乐 Tab */}
            <button onClick={() => { setExpanded(false); openMusicPage() }} className="min-w-0 flex-1 text-left">
              <p className="truncate text-[12px] font-semibold leading-tight" style={{ color: 'var(--text-1)' }}>{track.title}</p>
              <p className="mt-0.5 truncate text-[10px] leading-tight" style={{ color: 'var(--text-3)' }}>{track.artist}</p>
            </button>

            {/* 上一首 */}
            <button
              onClick={() => musicEngine.prev()}
              aria-label="上一首"
              className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
              style={{ color: 'var(--text-2)' }}
            >
              <SkipBackIcon size={15} />
            </button>

            {/* 播放 / 暂停（与播放页主按钮同一套形态过渡图标，视觉语言统一） */}
            <button
              onClick={() => musicEngine.toggle()}
              aria-label={playing ? '暂停' : '播放'}
              className="tap flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
              style={{ background: GREEN, color: '#FFFFFF', boxShadow: '0 3px 10px rgba(49,194,124,0.36)' }}
            >
              <PlayPauseIcon playing={playing} size={15} />
            </button>

            {/* 下一首 */}
            <button
              onClick={() => musicEngine.next()}
              aria-label="下一首"
              className="tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
              style={{ color: 'var(--text-2)' }}
            >
              <SkipForwardIcon size={15} />
            </button>

            {/* 收起（箭头指向球的那一侧）*/}
            <button
              onClick={() => setExpanded(false)}
              aria-label="收起悬浮播放器"
              className="tap flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-transform active:scale-[0.92]"
              style={{ color: 'var(--text-3)' }}
            >
              {onRightHalf ? <ChevronRightIcon size={15} /> : <ChevronLeftIcon size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* ── 悬浮球本体（v1.73 分层重做）──
          结构自外向内：外光晕 → 进度环 → 按压层 → 拉伸层 → 呼吸层 → 球体
            （球体内：流动渐变 → 高光雾 → 封面 → 高光层）
          每层只做一件事，所以「呼吸 + 律动 + 旋转 + 按压 + 拖拽拉伸」可以同时进行、
          互不覆盖 —— 这也是把它们拆开的原因（合在一层必然互相抢 transform）。
          ⚠️ 以下三条原有行为一条没动：
            ① 拖拽期间直接改 DOM 的 left/top，零额外重渲染；
            ② touch-action:none，手机上不会被页面滚动抢走手势；
            ③ 外圈进度环仍是这把 SVG，走满一圈 = 这首放完。 */}
      <button
        ref={vizRef}
        onClick={onBallClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label={expanded ? '收起音乐播放器' : '展开音乐播放器 · 长按调动效'}
        className={`music-fab-ball relative block rounded-full ${dragging ? 'is-drag' : ''} ${expanded ? 'is-expanded' : ''}`}
        style={{
          width: FAB_SIZE,
          height: FAB_SIZE,
          padding: 0,
          border: 'none',
          background: 'transparent',
          touchAction: 'none',
          cursor: dragging ? 'grabbing' : 'grab',
          transform: dragging ? 'scale(1.06)' : 'scale(1)',
          transition: dragging ? 'none' : 'transform 0.14s ease',
        }}
      >
        {/* 外光晕：随真实低频轻微扩张、随整体电平加浓（只在播放时有变化） */}
        <span className="music-orb-glow" aria-hidden />

        {/* 外圈进度环（旋转 -90° 让起点在正上方） */}
        <svg
          width={FAB_SIZE}
          height={FAB_SIZE}
          viewBox={`0 0 ${FAB_SIZE} ${FAB_SIZE}`}
          className="pointer-events-none absolute inset-0"
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden="true"
        >
          <circle
            cx={FAB_SIZE / 2} cy={FAB_SIZE / 2} r={ringR}
            fill="none" stroke="rgba(31,45,61,0.16)" strokeWidth="2.5"
          />
          <circle
            cx={FAB_SIZE / 2} cy={FAB_SIZE / 2} r={ringR}
            fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={ringC} strokeDashoffset={ringC * (1 - pct / 100)}
          />
        </svg>

        {/* 按压层：按下压缩 / 松手扩张回弹。用命令式 class 而不是 state ——
            播放进度每秒让本组件重渲染数次，用 state 会和重渲染打架。 */}
        <span ref={pressRef} className="music-orb-press">
          {/* 拉伸层：拖动时沿手指方向拉伸（--fab-* 由 JS 直写，拖拽中 transition:none 保证跟手） */}
          <span ref={stretchRef} className="music-orb-stretch">
            {/* 呼吸层：极轻微缩放；暂停 / 减少动态效果时移除动画 → 平缓回到静止 */}
            <span
              className={`music-breathe absolute inset-0 ${playing && !reducedMotion ? '' : 'is-idle'}`}
            >
              {/* 球体：形态由设置决定（唱片 / 流体球 / 玻璃球），展开时圆角收一点形成"让位" */}
              <span
                className={`music-orb ${expanded ? 'is-expanded' : ''} ${
                  fx.orb === 'orb' ? 'is-orb' : fx.orb === 'glass' ? 'is-glass' : ''
                }`}
              >
                {/* 内部色彩缓慢流动（两枚反向自转的渐变层叠出流体感；不用 blur 滤镜） */}
                <span className={`music-orb-flow ${playing && !reducedMotion ? '' : 'is-paused'}`} aria-hidden />
                <span className={`music-orb-haze ${playing && !reducedMotion ? '' : 'is-paused'}`} aria-hidden />
                {/* 封面：播放中匀速自转（沿用原有 music-spin），切歌时按 track.id 重挂 → 缩放淡入 */}
                <span
                  className="music-orb-cover music-spin"
                  style={{ animationPlayState: playing ? 'running' : 'paused' }}
                >
                  <span key={`gf-${track.id}`} className="music-cover-swap block h-full w-full">
                    <TrackCover track={track} kind={KINDS[index % KINDS.length]} uid={`gf-${track.id}`} />
                  </span>
                </span>
                {/* 高光 + 半透明层次：给球体一点空间感（不随光晕设置变化，避免过曝） */}
                <span className="music-orb-spec" aria-hidden />
              </span>
            </span>
          </span>
        </span>
      </button>
    </div>,
    document.body,
  )
}

/* ════════════════════════════════════════════════════════════════
   v1.73 音乐动效设置弹层（GlobalMusicFxSheet）
   ------------------------------------------------------------------
   【入口】长按悬浮球 480ms → requestOpenMusicFx() → 这里打开。
     为什么不做成悬浮球的子组件：悬浮球在「音乐页可见」时整体返回 null，
     弹层若依附于它，会被连带关掉。
   【为什么每一项都能立即生效】
     · 所有值都进 useMusicFx 的模块级 store，并立刻写进 :root 的 CSS 变量；
     · 本弹层里的预览球、全局悬浮球、播放页唱片共用同一套类与变量；
     · 所以拖动滑块时，预览球当场变，页面上的球也当场变 —— 不需要刷新。
   【拿不到真实频谱时绝不假装】
     顶部状态行会明确写出「已接入真实音频频谱」/「装饰动效 · 本机未取到音频数据」。
   ════════════════════════════════════════════════════════════════ */

/** 设置项滑块（拖动即写 store，无防抖 —— 写的是 CSS 变量，成本极低） */
function FxSlider({ label, hint, value, range, onChange }: {
  label: string
  hint?: string
  value: number
  range: { min: number; max: number; step: number }
  onChange: (v: number) => void
}) {
  return (
    <div className="py-2">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>{label}</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-3)' }}>
          {value.toFixed(2)}×
        </span>
      </div>
      <input
        className="music-fx-range"
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? <p className="mt-1 text-[10.5px]" style={{ color: 'var(--text-3)' }}>{hint}</p> : null}
    </div>
  )
}

export function GlobalMusicFxSheet() {
  const [open, setOpen] = useState(false)
  const fx = useMusicFx()
  const reducedMotion = useReducedMotion()
  const vizStatus = useVizStatus()
  const engineState = useMusicEngine()
  /* 预览球也接到律动总线上：所以它不只反映设置，还会跟着真实音乐一起跳 */
  const previewRef = useVizTarget<HTMLDivElement>()

  const track = engineState.queue[engineState.index] as unknown as Track | undefined
  const previewAccent = useCoverAccent(
    track?.coverUrl ?? '',
    paletteTriple(track?.palette ?? { skyTop: '#F7FAF9', skyBottom: '#DCEBE3', mid: '#8AAE9A' }),
  )
  const playing = engineState.playing
  /* 预览球的"动态"条件与真球完全一致，否则设置面板会给出误导性的预览 */
  const previewLive = playing && !reducedMotion && fx.enabled

  useEffect(() => onOpenMusicFx(() => setOpen(true)), [])

  if (!open) return null

  const statusText = !fx.enabled
    ? '已关闭 · 全部静态（仅保留配色与层次）'
    : reducedMotion
      ? '跟随系统「减少动态效果」，已自动降级为静态'
      : vizStatus === 'live'
        ? '已接入真实音频频谱（低频/频谱光带随音乐跳动）'
        : '装饰动效 · 本机未取到音频数据，律动不做假响应'

  return createPortal(
    <div
      className="fixed inset-0 z-[78] flex items-end justify-center"
      style={{ background: 'rgba(20,26,32,0.34)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="anim-sheet-in w-full max-w-[430px] overflow-y-auto overscroll-contain rounded-t-[24px] px-5 pb-8 pt-3.5"
        style={{
          background: 'var(--surface)',
          boxShadow: '0 -10px 40px rgba(27,30,35,0.18)',
          /* 小高度视口（横屏 / 小屏手机）下四项滑块会超出屏幕，必须能滚到底部的按钮 */
          maxHeight: 'min(88vh, 720px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 抓手 */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full" style={{ background: 'var(--line-strong)' }} />

        <div className="flex items-start gap-3.5">
          {/* 预览球：改任何一项都当场反馈，不用回播放页看效果 */}
          <div
            ref={previewRef}
            className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center"
            style={{
              '--mo-a': previewAccent.a,
              '--mo-b': previewAccent.b,
              '--mo-glow': previewAccent.glow,
            } as React.CSSProperties}
            aria-hidden
          >
            <span className="music-orb-glow" />
            <span className={`music-breathe absolute inset-0 ${previewLive ? '' : 'is-idle'}`}>
              <span
                className={`music-orb ${fx.orb === 'orb' ? 'is-orb' : fx.orb === 'glass' ? 'is-glass' : ''}`}
              >
                <span className={`music-orb-flow ${previewLive ? '' : 'is-paused'}`} />
                <span className={`music-orb-haze ${previewLive ? '' : 'is-paused'}`} />
                <span className="music-orb-cover music-spin" style={{ animationPlayState: playing ? 'running' : 'paused' }}>
                  {track ? (
                    <span key={`fx-${track.id}`} className="music-cover-swap block h-full w-full">
                      <TrackCover track={track} kind={KINDS[engineState.index % KINDS.length]} uid="fx-preview" />
                    </span>
                  ) : null}
                </span>
                <span className="music-orb-spec" />
              </span>
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px] font-bold" style={{ color: 'var(--text-1)' }}>音乐动效</h3>
              {/* 动效总开关 */}
              <button
                onClick={() => setMusicFx({ enabled: !fx.enabled })}
                aria-label={fx.enabled ? '关闭动效' : '开启动效'}
                className="tap relative h-6 w-11 shrink-0 rounded-full"
                style={{ background: fx.enabled ? GREEN : 'rgba(148,177,196,0.42)', transition: 'background 0.22s ease' }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white"
                  style={{
                    left: 2,
                    transform: fx.enabled ? 'translateX(20px)' : 'translateX(0)',
                    transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1)',
                    boxShadow: '0 1px 4px rgba(31,45,61,0.22)',
                  }}
                />
              </button>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-snug" style={{ color: 'var(--text-3)' }}>
              {statusText}
            </p>
          </div>
        </div>

        <div className="mt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <FxSlider
            label="动态强度"
            hint="统一控制呼吸幅度、律动幅度与按压回弹"
            value={fx.intensity}
            range={FX_RANGES.intensity}
            onChange={(v) => setMusicFx({ intensity: v })}
          />
          <FxSlider
            label="呼吸速度"
            hint="越大呼吸越快（同时影响球体内部色彩流动速度）"
            value={fx.breath}
            range={FX_RANGES.breath}
            onChange={(v) => setMusicFx({ breath: v })}
          />
          <FxSlider
            label="光晕强度"
            hint="球体外圈光晕的浓度（0.3 基本看不出，1.6 最明显）"
            value={fx.glow}
            range={FX_RANGES.glow}
            onChange={(v) => setMusicFx({ glow: v })}
          />
          <FxSlider
            label="音频响应灵敏度"
            hint="真实频谱换算成律动幅度的放大系数；0 = 不跟音乐跳动"
            value={fx.sensitivity}
            range={FX_RANGES.sensitivity}
            onChange={(v) => setMusicFx({ sensitivity: v })}
          />

          {/* 球体形态 */}
          <div className="py-2.5">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[12.5px] font-semibold" style={{ color: 'var(--text-1)' }}>球体形态</span>
              <span className="text-[10.5px]" style={{ color: 'var(--text-3)' }}>默认「唱片」= 与原来完全一致</span>
            </div>
            <div className="flex gap-2">
              {(['disc', 'orb', 'glass'] as MusicOrbStyle[]).map((s) => {
                const active = fx.orb === s
                return (
                  <button
                    key={s}
                    onClick={() => setMusicFx({ orb: s })}
                    className="tap flex-1 rounded-full py-2 text-[12px] font-semibold"
                    style={{
                      background: active ? 'rgba(49,194,124,0.12)' : 'var(--surface)',
                      color: active ? GREEN : 'var(--text-2)',
                      border: `1px solid ${active ? 'rgba(49,194,124,0.5)' : 'var(--line)'}`,
                      transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                    }}
                  >
                    {ORB_STYLE_LABELS[s]}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-[10.5px]" style={{ color: 'var(--text-3)' }}>
              唱片 = 封面铺满；流体球 = 封面缩小、四周流动渐变；玻璃球 = 更薄的高光层次
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <button
            onClick={() => resetMusicFx()}
            className="tap flex-1 rounded-full py-2.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--surface)', color: 'var(--text-2)', border: '1px solid var(--line)' }}
          >
            恢复默认
          </button>
          <button
            onClick={() => setOpen(false)}
            className="tap flex-1 rounded-full py-2.5 text-[12.5px] font-semibold"
            style={{ background: GREEN, color: '#FFFFFF', boxShadow: '0 3px 10px rgba(49,194,124,0.32)' }}
          >
            完成
          </button>
        </div>
        <p className="mt-2 text-center text-[10px]" style={{ color: 'var(--text-3)' }}>
          提示：长按悬浮球随时打开本面板 · 默认值 {DEFAULT_MUSIC_FX.intensity.toFixed(2)}× / {DEFAULT_MUSIC_FX.breath.toFixed(2)}×
        </p>
      </div>
    </div>,
    document.body,
  )
}
