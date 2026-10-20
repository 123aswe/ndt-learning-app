/* ============================================================
   主题商店运行时（皮肤） —— 背景图 + 配色
   ------------------------------------------------------------
   一个主题 = 背景图 + 主色 + 辅色 + 字色（深色字 / 浅色字）。
   本模块负责「把选中的主题贴到界面上」，做三件事：
     1. 背景层：固定在视口底部的整屏图层，背景图 cover 铺满（裁剪、不拉伸 → 不变形），
        叠一层同色调的蒙版保证文字对比度；没有背景图时用主色/辅色调出的柔和渐变兜底。
     2. 配色令牌：覆盖 html 上的 CSS 变量（--accent*、--text-*、--surface*、--glass-*、
        以及 Tailwind 用到的 --color-emerald-* / --color-teal-500），组件全部走令牌 →
        自觉跟着变；**不碰任何尺寸**，所以界面布局不会变形。
     3. 明暗基调：按字色写 html[data-skin]（light = 浅色字配深底，dark = 深色字配浅底），
        theme.ts 的 paint() 会让 data-theme 跟随它 —— 这样登录/注册页里写死的
        slate 文本类、白玻璃卡片类的深色重映射也会跟着走。

   选择结果存本机 localStorage（ndt_skin），不入库：登录 / 注册页在未登录时就要应用主题，
   必须能在拿到令牌之前读出来；换设备重新挑一次即可。

   用法：
     initSkin()                // main.tsx 启动时调用一次（渲染前，避免首屏闪一下）
     applySkin(theme)          // 应用某个主题（theme = null 表示恢复默认外观）
     fetchThemes()             // 拉可用主题列表（公开接口，无需登录）
     subscribeSkin(cb)         // 订阅「当前皮肤」变化，返回取消订阅函数
     getSkin()                 // 读当前皮肤（没有则 null）
   ============================================================ */

import { API_BASE, apiRequest } from './api/client'
import { getThemeMode, setThemeMode } from './theme'

/** 字色：dark = 深色字（配浅色背景主题）；light = 浅色字（配深色背景主题） */
export type TextTone = 'dark' | 'light'

export interface ThemeItem {
  id: number
  name: string
  primary_color: string
  secondary_color: string
  text_tone: TextTone
  has_preview: boolean
  has_background: boolean
  sort_order?: number
  created_by?: string
  created_at?: string
}

/** 本地保存的皮肤快照（带 created_at 当图片版本号，重开 App 不用等接口就能先贴上） */
export interface SkinSnapshot extends ThemeItem {
  /** 图片缓存版本号（取主题的 created_at） */
  version: string
}

const SKIN_KEY = 'ndt_skin'
const BG_LAYER_ID = 'ndt-skin-bg'
const DEFAULT_PRIMARY = '#5F8D8C'
const DEFAULT_SECONDARY = '#C9A063'

/* 会被皮肤覆盖的全部 CSS 变量：清除皮肤时按这份清单逐个 removeProperty */
const SKIN_VARS = [
  '--accent', '--accent-weak', '--accent-border', '--accent-fill', '--on-accent',
  '--color-accent', '--color-accent-deep',
  '--color-emerald-100', '--color-emerald-200', '--color-emerald-300',
  '--color-emerald-400', '--color-emerald-500', '--color-emerald-600',
  '--color-teal-500', '--emerald-600-text',
  '--bg', '--text-1', '--text-2', '--text-3',
  '--surface', '--surface-warm', '--surface-raised', '--surface-translucent',
  '--field-bg', '--track', '--line', '--line-strong', '--hairline',
  '--chip-bg', '--chip-bg-soft', '--chip-border', '--inset-hi',
  '--glass-bg', '--glass-border', '--glass-shadow',
]

/* ── 颜色小工具 ──────────────────────────────────────────── */

function parseHex(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  if (!isFinite(n) || full.length !== 6) return [95, 141, 140]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 十六进制 + 透明度 → rgba() */
function toRgba(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** 两色线性混合：ratio = 目标色的占比（0 = 全是 a，1 = 全是 b） */
function mix(a: string, b: string, ratio: number): string {
  const [r1, g1, b1] = parseHex(a)
  const [r2, g2, b2] = parseHex(b)
  const to = (x: number, y: number) => Math.round(x * (1 - ratio) + y * ratio)
  return `#${[to(r1, r2), to(g1, g2), to(b1, b2)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/** 变暗（amount < 0）/ 变亮（amount > 0），amount ∈ (0, 1] */
function shade(hex: string, amount: number): string {
  return mix(hex, amount < 0 ? '#000000' : '#ffffff', Math.abs(amount))
}

/* ── 图片地址（公开接口，不带令牌） ──────────────────────── */

export function previewUrl(t: ThemeItem): string {
  const v = encodeURIComponent(t.created_at || '')
  return `${API_BASE}/themes/${t.id}/preview?v=${v}`
}

export function backgroundUrl(t: ThemeItem): string {
  const v = encodeURIComponent(t.created_at || '')
  return `${API_BASE}/themes/${t.id}/background?v=${v}`
}

/* ── 配色令牌 ────────────────────────────────────────────── */

function buildVars(t: ThemeItem): Record<string, string> {
  const P = t.primary_color || DEFAULT_PRIMARY
  const S = t.secondary_color || P
  const light = t.text_tone === 'light' // 浅色字 → 深色底

  const vars: Record<string, string> = {
    /* 主色：跟着主题走（按钮 / 强调 / 进度 / 图标底色全是这几个令牌） */
    '--accent': P,
    '--accent-weak': toRgba(P, light ? 0.22 : 0.13),
    '--accent-border': toRgba(P, 0.38),
    '--accent-fill': toRgba(P, 0.92),
    '--on-accent': '#FFFFFF',
    '--color-accent': P,
    '--color-accent-deep': shade(P, -0.22),

    /* emerald / teal：登录页渐变按钮与部分强调色用的是这两档，
       覆盖后「登录/注册」和 App 内的绿色强调也会跟着主题走。
       深浅基调下链接色要分别取值，否则深底上深绿看不清。 */
    '--color-emerald-400': P,
    '--color-emerald-500': P,
    '--color-emerald-600': shade(P, -0.18),
    '--emerald-600-text': light ? mix(P, '#ffffff', 0.34) : shade(P, -0.18),
    '--color-emerald-300': mix(P, light ? '#000000' : '#ffffff', light ? 0.42 : 0.52),
    '--color-emerald-200': mix(P, light ? '#000000' : '#ffffff', light ? 0.62 : 0.74),
    '--color-emerald-100': mix(P, light ? '#000000' : '#ffffff', light ? 0.80 : 0.88),
    '--color-teal-500': S,
  }

  if (light) {
    /* 浅色字：深底 + 半透明深面（让背景图透出来一点） */
    Object.assign(vars, {
      '--bg': '#12151A',
      '--text-1': '#F2F4F6',
      '--text-2': 'rgba(255,255,255,0.80)',
      '--text-3': 'rgba(255,255,255,0.58)',
      '--surface': '#1B2025',
      '--surface-warm': '#212730',
      '--surface-raised': '#1F252A',
      '--surface-translucent': 'rgba(22,26,31,0.66)',
      '--field-bg': 'rgba(255,255,255,0.08)',
      '--track': 'rgba(255,255,255,0.14)',
      '--line': 'rgba(255,255,255,0.14)',
      '--line-strong': 'rgba(255,255,255,0.22)',
      '--hairline': 'rgba(255,255,255,0.24)',
      '--chip-bg': 'rgba(255,255,255,0.10)',
      '--chip-bg-soft': 'rgba(255,255,255,0.07)',
      '--chip-border': 'rgba(255,255,255,0.16)',
      '--inset-hi': 'rgba(255,255,255,0.10)',
      '--glass-bg': 'linear-gradient(165deg, rgba(34,40,46,0.84) 0%, rgba(24,29,34,0.70) 55%, rgba(30,35,41,0.78) 100%)',
      '--glass-border': 'rgba(255,255,255,0.10)',
      '--glass-shadow': '0 1px 2px rgba(0,0,0,0.35), 0 8px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06)',
    })
  } else {
    /* 深色字：浅底 + 半透明浅面 */
    Object.assign(vars, {
      '--bg': '#F3F4F6',
      '--text-1': '#1B1E23',
      '--text-2': '#5F6670',
      '--text-3': '#8E969E',
      '--surface': '#FFFFFF',
      '--surface-warm': '#FAF9F6',
      '--surface-raised': '#FFFFFF',
      '--surface-translucent': 'rgba(255,255,255,0.78)',
      '--field-bg': 'rgba(255,255,255,0.74)',
      '--track': 'rgba(27,30,35,0.08)',
      '--line': 'rgba(27,30,35,0.10)',
      '--line-strong': 'rgba(27,30,35,0.16)',
      '--hairline': 'rgba(27,30,35,0.18)',
      '--chip-bg': 'rgba(255,255,255,0.82)',
      '--chip-bg-soft': 'rgba(255,255,255,0.70)',
      '--chip-border': 'rgba(255,255,255,0.85)',
      '--inset-hi': 'rgba(255,255,255,0.80)',
      '--glass-bg': 'linear-gradient(165deg, rgba(255,255,255,0.90) 0%, rgba(255,255,255,0.68) 55%, rgba(255,255,255,0.76) 100%)',
      '--glass-border': 'rgba(255,255,255,0.85)',
      '--glass-shadow': '0 1px 2px rgba(27,30,35,0.05), 0 6px 20px rgba(27,30,35,0.08), inset 0 1px 0 rgba(255,255,255,0.92)',
    })
  }
  return vars
}

/** 没有背景图时的兜底：用主色 / 辅色调出的柔和渐变（同样是整屏铺满，不会拉伸变形） */
function fallbackGradient(t: ThemeItem): string {
  const P = t.primary_color || DEFAULT_PRIMARY
  const S = t.secondary_color || P
  const light = t.text_tone === 'light'
  if (light) {
    return `linear-gradient(160deg, ${mix(P, '#0B0D11', 0.80)} 0%, ${mix(S, '#0B0D11', 0.88)} 55%, #0B0D11 100%)`
  }
  return `linear-gradient(160deg, ${mix(P, '#FFFFFF', 0.86)} 0%, ${mix(S, '#FFFFFF', 0.90)} 55%, #FFFFFF 100%)`
}

/* ── 背景层 ──────────────────────────────────────────────── */

function bgLayer(): HTMLDivElement {
  let el = document.getElementById(BG_LAYER_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = BG_LAYER_ID
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }
  return el
}

function renderLayer(t: ThemeItem) {
  const el = bgLayer()
  const light = t.text_tone === 'light'
  /* 蒙版：保证正文对比度（浅色字 → 压暗；深色字 → 提亮） */
  const scrim = light
    ? 'linear-gradient(180deg, rgba(9,11,15,0.46) 0%, rgba(9,11,15,0.28) 42%, rgba(9,11,15,0.50) 100%)'
    : 'linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.22) 42%, rgba(255,255,255,0.46) 100%)'
  el.style.backgroundImage = `${scrim}, ${fallbackGradient(t)}`
  if (!t.has_background) return
  /* 先探一次图：加载成功再换上背景图（避免 URL 失效时留下只剩蒙版的黑/白屏） */
  const url = backgroundUrl(t)
  const probe = new Image()
  probe.onload = () => {
    if (current?.id !== t.id) return
    el.style.backgroundImage = `${scrim}, url("${url}")`
  }
  probe.src = url
}

function removeLayer() {
  document.getElementById(BG_LAYER_ID)?.remove()
}

/* ── 对外状态 ────────────────────────────────────────────── */

let current: SkinSnapshot | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((cb) => {
    try {
      cb()
    } catch {
      /* 订阅者自己出错不影响其它订阅者 */
    }
  })
}

/** 订阅「当前皮肤」变化（应用 / 恢复默认时触发），返回取消订阅函数 */
export function subscribeSkin(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 当前皮肤（没有应用主题时为 null） */
export function getSkin(): SkinSnapshot | null {
  return current
}

function snapshotOf(t: ThemeItem): SkinSnapshot {
  return {
    id: t.id,
    name: t.name,
    primary_color: t.primary_color,
    secondary_color: t.secondary_color,
    text_tone: t.text_tone,
    has_preview: t.has_preview,
    has_background: t.has_background,
    sort_order: t.sort_order,
    created_at: t.created_at,
    version: t.created_at || '',
  }
}

/** 应用主题；传 null 表示「恢复默认外观」（回到系统 / 设置页选的深浅色） */
export function applySkin(theme: ThemeItem | null): void {
  const root = document.documentElement
  SKIN_VARS.forEach((key) => root.style.removeProperty(key))

  if (!theme) {
    root.removeAttribute('data-skin')
    removeLayer()
    try {
      localStorage.removeItem(SKIN_KEY)
    } catch {
      /* 隐私模式写不了就忽略：本次会话仍按默认外观显示 */
    }
    current = null
    setThemeMode(getThemeMode()) // 让 paint() 重新按「用户自己的深浅色设置」写 data-theme
    notify()
    return
  }

  const vars = buildVars(theme)
  Object.entries(vars).forEach(([key, value]) => root.style.setProperty(key, value))
  root.dataset.skin = theme.text_tone === 'light' ? 'dark' : 'light'
  renderLayer(theme)
  current = snapshotOf(theme)
  try {
    localStorage.setItem(SKIN_KEY, JSON.stringify(current))
  } catch {
    /* 忽略：下次打开退化为默认外观 */
  }
  setThemeMode(getThemeMode())
  notify()
}

/** 启动时调用（React 渲染前）：把上次选的主题先贴上，避免首屏闪一下 */
export function initSkin(): void {
  let stored: SkinSnapshot | null = null
  try {
    const raw = localStorage.getItem(SKIN_KEY)
    stored = raw ? (JSON.parse(raw) as SkinSnapshot) : null
  } catch {
    stored = null
  }
  if (!stored || typeof stored.id !== 'number') {
    current = null
    return
  }
  applySkin(stored)
}

/** 拉可用主题列表（公开接口，登录 / 注册页也能用） */
export async function fetchThemes(): Promise<ThemeItem[]> {
  const data = await apiRequest<{ items: ThemeItem[] }>('/themes', { auth: false })
  return data.items || []
}
