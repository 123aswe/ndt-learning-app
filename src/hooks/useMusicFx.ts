/**
 * v1.73 音乐动效设置 store（模块级单例 · 改一项全站立即生效）
 * ============================================================
 * 【为什么单独一个文件】
 *   「动态强度 / 呼吸速度 / 光晕强度 / 球体形态 / 音频响应灵敏度 / 动画开关」
 *   这六项既要被播放页用、又要被全局悬浮球用，还要在设置弹层里被读写。
 *   放在组件里会变成层层透传；放 App.tsx 又拿不到（整页视图是提前返回）。
 *   所以和 useMusicEngine 一样做成模块级 store + useSyncExternalStore。
 *
 * 【写入策略】
 *   任何一项变更 → 落 localStorage（ndt_music_fx，按账号前缀隔离）→ 广播。
 *   订阅方（播放页 / 悬浮球 / 律动循环）当场读到新值 → 立即反馈，无需刷新。
 *
 * 【与已有设置的关系】
 *   不碰 ndt_music_fab_pos（悬浮球位置）、ndt_music_lyric_cfg（歌词配色）。
 *   本文件只新增 ndt_music_fx。
 */

import { useSyncExternalStore } from 'react'

/** 悬浮球形态：唱片（沿用现状）/ 流体球（封面缩小·四周流光）/ 玻璃球（半透明高光） */
export type MusicOrbStyle = 'disc' | 'orb' | 'glass'

export interface MusicFxSettings {
  /** 动效总开关：关 → 全部静态（仍保留配色，不做运动） */
  enabled: boolean
  /** 动态强度 0.4~1.6：统一乘到呼吸幅度 / 律动幅度 / 按压缩放上 */
  intensity: number
  /** 呼吸速度 0.5~1.8：越大越快（用于换算动画周期） */
  breath: number
  /** 光晕强度 0.3~1.6：外圈光晕的浓度 */
  glow: number
  /** 球体形态 */
  orb: MusicOrbStyle
  /** 音频响应灵敏度 0~2：真实频谱 -> 律动幅度的放大系数 */
  sensitivity: number
}

export const DEFAULT_MUSIC_FX: MusicFxSettings = {
  enabled: true,
  intensity: 1,
  breath: 1,
  glow: 1,
  orb: 'disc',
  sensitivity: 1,
}

/** 数值范围（设置面板滑块用同一份，避免两边写死不一致） */
export const FX_RANGES = {
  intensity: { min: 0.4, max: 1.6, step: 0.05 },
  breath: { min: 0.5, max: 1.8, step: 0.05 },
  glow: { min: 0.3, max: 1.6, step: 0.05 },
  sensitivity: { min: 0, max: 2, step: 0.05 },
} as const

export const ORB_STYLE_LABELS: Record<MusicOrbStyle, string> = {
  disc: '唱片',
  orb: '流体球',
  glass: '玻璃球',
}

/** 设置项存储键（跟随账号：与歌词配色的口径一致，换账号互不影响） */
const KEY_BASE = 'ndt_music_fx'

function storageKey(): string {
  try {
    const id = localStorage.getItem('ndt_last_account') || ''
    return id ? `${KEY_BASE}:${id}` : KEY_BASE
  } catch {
    return KEY_BASE
  }
}

const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 任何来源（localStorage 旧数据 / 面板传入）都过一遍这里，杜绝非法值把动画带崩 */
function sanitize(raw: Partial<MusicFxSettings> | null | undefined): MusicFxSettings {
  const r = raw || {}
  const orb: MusicOrbStyle =
    r.orb === 'orb' || r.orb === 'glass' || r.orb === 'disc' ? r.orb : DEFAULT_MUSIC_FX.orb
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_MUSIC_FX.enabled,
    intensity: clampNum(r.intensity, FX_RANGES.intensity.min, FX_RANGES.intensity.max, DEFAULT_MUSIC_FX.intensity),
    breath: clampNum(r.breath, FX_RANGES.breath.min, FX_RANGES.breath.max, DEFAULT_MUSIC_FX.breath),
    glow: clampNum(r.glow, FX_RANGES.glow.min, FX_RANGES.glow.max, DEFAULT_MUSIC_FX.glow),
    orb,
    sensitivity: clampNum(r.sensitivity, FX_RANGES.sensitivity.min, FX_RANGES.sensitivity.max, DEFAULT_MUSIC_FX.sensitivity),
  }
}

function readStored(): MusicFxSettings {
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return { ...DEFAULT_MUSIC_FX }
    return sanitize(JSON.parse(raw) as Partial<MusicFxSettings>)
  } catch {
    return { ...DEFAULT_MUSIC_FX }
  }
}

let settings: MusicFxSettings = readStored()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function subscribeMusicFx(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getMusicFx(): MusicFxSettings {
  return settings
}

/** 局部更新：只传要改的字段；非法值自动夹回区间 */
export function setMusicFx(patch: Partial<MusicFxSettings>) {
  const next = sanitize({ ...settings, ...patch })
  const same = (Object.keys(next) as (keyof MusicFxSettings)[]).every((k) => next[k] === settings[k])
  if (same) return
  settings = next
  try {
    localStorage.setItem(storageKey(), JSON.stringify(next))
  } catch {
    /* 存储不可用：内存态照常生效 */
  }
  emit()
}

/** 恢复出厂动效设置（设置面板里的「恢复默认」） */
export function resetMusicFx() {
  settings = { ...DEFAULT_MUSIC_FX }
  try {
    localStorage.removeItem(storageKey())
  } catch {
    /* 忽略 */
  }
  emit()
}

/** 换账号后重新读一次（登录时调用；不调用也不影响，只是沿用上个账号的动效偏好） */
export function reloadMusicFx() {
  settings = readStored()
  emit()
}

export function useMusicFx(): MusicFxSettings {
  return useSyncExternalStore(subscribeMusicFx, getMusicFx, getMusicFx)
}

/* ════════════ 用户「减少动态效果」偏好 ════════════ */
/* 要求三：动画必须遵守 prefers-reduced-motion。这里只读不写，作为动效的硬降级开关。 */
const MQ = '(prefers-reduced-motion: reduce)'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia(MQ).matches
  } catch {
    return false
  }
}

const rmListeners = new Set<() => void>()
let rmValue = prefersReducedMotion()
let rmBound = false

function bindReducedMotion() {
  if (rmBound || typeof window === 'undefined' || !window.matchMedia) return
  rmBound = true
  try {
    const mq = window.matchMedia(MQ)
    const onChange = () => {
      rmValue = mq.matches
      rmListeners.forEach((l) => l())
    }
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
  } catch {
    /* 忽略 */
  }
}

export function useReducedMotion(): boolean {
  bindReducedMotion()
  return useSyncExternalStore(
    (onChange) => {
      rmListeners.add(onChange)
      return () => {
        rmListeners.delete(onChange)
      }
    },
    () => rmValue,
    () => rmValue,
  )
}

/* ════════════ 「长按悬浮球 → 打开动效设置」的跨组件通道 ════════════ */
/* 悬浮球在 MusicScreen.tsx 里，设置弹层挂在 AppShell 那一层（或同一文件根部）。
   两者互不 import 组件，用事件打通，避免循环依赖。 */
export const OPEN_MUSIC_FX_EVENT = 'ndt:open-music-fx'

/** 悬浮球长按结束时调用 */
export function requestOpenMusicFx() {
  try {
    window.dispatchEvent(new CustomEvent(OPEN_MUSIC_FX_EVENT))
  } catch {
    /* 忽略 */
  }
}

/** 设置弹层宿主订阅 */
export function onOpenMusicFx(handler: () => void): () => void {
  window.addEventListener(OPEN_MUSIC_FX_EVENT, handler)
  return () => window.removeEventListener(OPEN_MUSIC_FX_EVENT, handler)
}
