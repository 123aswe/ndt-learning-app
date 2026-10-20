/**
 * v1.73 音乐律动数据层（唯一一条 rAF 循环 · 只写 CSS 变量，零 React 重渲染）
 * ============================================================
 * 【它解决的问题】
 *   要求三明确点名：「高频状态更新导致整个页面反复渲染」。
 *   所以真实频谱数据【绝对不能】进 React state —— 每秒 60 次 setState 会把
 *   播放页整棵树重渲染，必然掉帧。这里的做法是：
 *     引擎里的 AnalyserNode → 本文件的 rAF 循环 → 平滑 → 写成 CSS 变量
 *     → CSS 里用 calc()/var() 消费 → 只触发合成，不触发重排，不触发 React。
 *
 * 【三条硬约束】
 *   ① 全站只跑一条 rAF（模块级单例），不是每个组件一条；
 *   ② 有停止条件：开关关 / 未播放且已衰减到 0 / 页面隐藏 / 减少动态效果 / 无订阅元素；
 *   ③ 差值节流：与上一帧写入值差异小于阈值就整帧跳过，120Hz 屏上也按 ~60Hz 写。
 *
 * 【装饰 vs 真实】
 *   拿不到分析器（跨域 / 内核不支持 / 本机解码不出 PCM）时，电平恒为 0，
 *   CSS 侧自动退化成纯呼吸动效 —— 这一点会在动效设置面板里以状态文字明示，
 *   绝不用随机数据冒充真实频谱。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getMusicAnalyser, getMusicSnapshot, subscribeMusic } from './useMusicEngine'
import { getMusicFx, prefersReducedMotion, subscribeMusicFx } from './useMusicFx'

/** 外圈频谱光带的条数（与 index.css 的 .music-spectrum 一一对应） */
export const VIZ_BANDS = 12

/** 分析器状态：真实 / 未取到 / 待观察 */
export type VizStatus = 'idle' | 'live' | 'silent'

/* ════════════ 内部状态 ════════════ */
const targets = new Set<HTMLElement>()
/** 当前真正可见的目标（display:none / 卸载后不写、也不为它跑循环） */
let visibleTargets: HTMLElement[] = []
let visCheckTs = 0
let visTimer = 0

let rafId = 0
let lastTs = 0
let lastWriteTs = 0

/** 平滑后的电平（0~1） */
let level = 0
let bass = 0
let mid = 0
/** 低频起音脉冲（0~1）：由低频能量的"上升沿"算出，是真正的"随拍脉动"。
    只用平滑后的低频做缩放会得到一个恒定偏移（看着像被永久拉大），
    所以脉动必须用变化量，而不是绝对值。 */
let pulse = 0
let bassPrev = 0
const bands: number[] = new Array(VIZ_BANDS).fill(0)

/** 上一帧真正写进 DOM 的值（差值节流用） */
let wroteLevel = -1
let wroteBass = -1
let wrotePulse = -1
const wroteBands: number[] = new Array(VIZ_BANDS).fill(-1)

let freqData: Uint8Array<ArrayBuffer> | null = null
let bandRanges: Array<[number, number]> | null = null

/** 状态与订阅（给设置面板显示「已接入真实频谱 / 装饰动效」） */
let status: VizStatus = 'idle'
const statusListeners = new Set<() => void>()
let silentMs = 0
let warnedSilent = false

function setStatus(next: VizStatus) {
  if (status === next) return
  status = next
  statusListeners.forEach((l) => l())
}

export function getVizStatus(): VizStatus {
  return status
}

export function useVizStatus(): VizStatus {
  return useSyncExternalStore(
    (onChange) => {
      statusListeners.add(onChange)
      return () => {
        statusListeners.delete(onChange)
      }
    },
    getVizStatus,
    getVizStatus,
  )
}

/** 归一化：除以 255 后做一次很轻的曲线。
 *  ⚠️ 不要用 x^1.35 * 1.15 这类"抬升"曲线 —— 热门舞曲的低频常年接近满刻度，
 *  那样算出来会恒等于 1，视觉上就是"一直满格、看不出在动"。
 *  动态范围靠 AnalyserNode 的 min/maxDecibels（见 useMusicEngine）留余量，
 *  这里只做接近线性的轻微压缩。 */
function norm(v: number): number {
  const x = v / 255
  return Math.min(1, Math.pow(x, 1.12))
}

const avgRange = (data: Uint8Array, from: number, to: number): number => {
  const end = Math.min(data.length, to)
  if (end <= from) return 0
  let sum = 0
  for (let i = from; i < end; i++) sum += data[i]
  return sum / (end - from)
}

/** 12 条光带的频率区间：不是等分，走 ~1.6 次幂的近对数分布（低频细、高频粗） */
function ensureBandRanges(binCount: number): Array<[number, number]> {
  if (bandRanges && bandRanges[bandRanges.length - 1][1] === binCount) return bandRanges
  const ranges: Array<[number, number]> = []
  for (let i = 0; i < VIZ_BANDS; i++) {
    const from = Math.floor(binCount * Math.pow(i / VIZ_BANDS, 1.6))
    const to = Math.max(from + 1, Math.floor(binCount * Math.pow((i + 1) / VIZ_BANDS, 1.6)))
    ranges.push([from, to])
  }
  bandRanges = ranges
  return ranges
}

/** 快起慢落：起音 55ms 跟上，收音 300ms 回落 —— 视觉上"跟得住但不抖" */
function follow(cur: number, target: number, dt: number): number {
  const tau = target > cur ? 0.055 : 0.30
  return cur + (target - cur) * (1 - Math.exp(-dt / tau))
}

/* ════════════ 可见性：display:none 的目标不写、也不为它跑循环 ════════════ */
/* 音乐 Tab 是常驻挂载（切走只 display:none），如果不判可见性，
   切到别的 Tab 后我们仍会为那个隐藏元素每帧写变量 —— 白耗。
   用 getClientRects()（对 position:fixed 也准，offsetParent 对 fixed 会误判为 null）。
   ⚠️ 每帧调会强制同步布局，所以按 500ms 节流，并额外用 600ms 定时器兜住
   「重新显示」的情况（可见数量变化时才重新拉起循环）。 */
function refreshVisibility(ts: number, force = false) {
  if (!force && ts - visCheckTs < 500) return
  visCheckTs = ts
  const next: HTMLElement[] = []
  for (const el of targets) {
    if (!el.isConnected) continue
    try {
      if (el.getClientRects().length > 0) next.push(el)
    } catch {
      next.push(el)
    }
  }
  visibleTargets = next
}

function ensureVisibilityTimer() {
  if (visTimer) return
  visTimer = window.setInterval(() => {
    if (!targets.size) return
    const before = visibleTargets.length
    refreshVisibility(performance.now(), true)
    if (before !== visibleTargets.length) kick()
  }, 600)
}

/* ════════════ 设置类变量（变化少 → 直接写 :root，靠 CSS 继承） ════════════ */
function syncRootVars() {
  const fx = getMusicFx()
  const reduced = prefersReducedMotion()
  const root = document.documentElement
  const on = fx.enabled && !reduced
  /* 总开关：用一个根属性统一关掉全站音乐动效（同深色模式的做法），
     这样播放页与全局悬浮球两处不必各自判断。 */
  if (fx.enabled) root.removeAttribute('data-mv-off')
  else root.setAttribute('data-mv-off', '1')
  root.style.setProperty('--mv-amp', String(fx.intensity))
  root.style.setProperty('--mv-breath', String(fx.breath))
  root.style.setProperty('--mv-glow', String(fx.glow))
  root.style.setProperty('--mv-on', on ? '1' : '0')
  root.style.setProperty('--mv-live', status === 'live' && on ? '1' : '0')
  // 动画周期：呼吸 6.4s 基准 ÷ 速度；光带 26s 基准 ÷ 速度
  root.style.setProperty('--mv-breath-dur', `${(6.4 / fx.breath).toFixed(2)}s`)
  root.style.setProperty('--mv-flow-dur', `${(26 / fx.breath).toFixed(2)}s`)
}

/* ════════════ 电平类变量（每帧变 → 只写注册过的元素） ════════════ */
function flushLevels() {
  for (const el of visibleTargets) {
    el.style.setProperty('--mv-level', level.toFixed(3))
    el.style.setProperty('--mv-bass', bass.toFixed(3))
    el.style.setProperty('--mv-mid', mid.toFixed(3))
    el.style.setProperty('--mv-pulse', pulse.toFixed(3))
    for (let i = 0; i < VIZ_BANDS; i++) el.style.setProperty(`--mv-b${i}`, bands[i].toFixed(3))
  }
  wroteLevel = level
  wroteBass = bass
  wrotePulse = pulse
  for (let i = 0; i < VIZ_BANDS; i++) wroteBands[i] = bands[i]
}

function dirtyEnough(): boolean {
  if (Math.abs(level - wroteLevel) > 0.004) return true
  if (Math.abs(bass - wroteBass) > 0.004) return true
  if (Math.abs(pulse - wrotePulse) > 0.006) return true
  for (let i = 0; i < VIZ_BANDS; i++) if (Math.abs(bands[i] - wroteBands[i]) > 0.006) return true
  return false
}

/** 全部电平是否已静默（静默后才允许停循环） */
function quiet(): boolean {
  if (level > 0.0035 || bass > 0.0035 || pulse > 0.006) return false
  for (let i = 0; i < VIZ_BANDS; i++) if (bands[i] > 0.005) return false
  return true
}

function shouldRun(): boolean {
  if (!targets.size) return false
  if (!visibleTargets.length) return false
  if (!getMusicFx().enabled) return false
  if (prefersReducedMotion()) return false
  if (document.hidden) return false
  if (getMusicSnapshot().playing) return true
  return !quiet() // 暂停后让电平自然衰减完再停（禁止瞬间冻结）
}

function tick(ts: number) {
  rafId = 0
  const dt = lastTs ? Math.min(64, ts - lastTs) / 1000 : 0.016
  lastTs = ts
  refreshVisibility(ts)

  const playing = getMusicSnapshot().playing
  const fx = getMusicFx()
  const analyser = getMusicAnalyser()

  let tLevel = 0
  let tBass = 0
  let tMid = 0
  const tBands = new Array(VIZ_BANDS).fill(0)

  if (playing && analyser) {
    const binCount = analyser.frequencyBinCount
    if (!freqData || freqData.length !== binCount) freqData = new Uint8Array(binCount)
    analyser.getByteFrequencyData(freqData)

    // 三个主频段（binHz ≈ 采样率/512 ≈ 86~94Hz）
    tLevel = norm(avgRange(freqData, 0, Math.min(binCount, 64)))
    tBass = norm(avgRange(freqData, 0, 4))
    tMid = norm(avgRange(freqData, 13, 48))

    // 12 条光带
    const ranges = ensureBandRanges(binCount)
    for (let i = 0; i < VIZ_BANDS; i++) {
      const [from, to] = ranges[i]
      tBands[i] = norm(avgRange(freqData, from, to))
    }

    // 取到真实信号 → live；播放中长时间全 0 → 判定本机拿不到 PCM（装饰模式）
    if (tLevel > 0.006 || tBass > 0.006) {
      silentMs = 0
      setStatus('live')
    } else {
      silentMs += dt * 1000
      if (silentMs > 2500) {
        setStatus('silent')
        if (!warnedSilent) {
          warnedSilent = true
          console.warn(
            '[music-viz] 已接入 AnalyserNode 但连续 2.5s 取不到音频数据，' +
              '律动自动降级为装饰动效（可能该内核不解码此音频格式，或页面与音频不同源）。',
          )
        }
      }
    }
  }

  // 灵敏度只放大律动，不影响呼吸
  const gain = fx.sensitivity
  level = follow(level, Math.min(1, tLevel * gain), dt)
  const nextBass = follow(bass, Math.min(1, tBass * gain), dt)
  /* 起音脉冲：取低频的"上升沿"，所以是随拍跳一下，而不是一个恒定偏移。
     上升快（55ms）回落慢（300ms）→ 像心跳。 */
  const onset = Math.max(0, nextBass - bassPrev)
  bassPrev = nextBass
  bass = nextBass
  pulse = follow(pulse, Math.min(1, onset * 3), dt)
  mid = follow(mid, Math.min(1, tMid * gain), dt)
  for (let i = 0; i < VIZ_BANDS; i++) {
    bands[i] = follow(bands[i], Math.min(1, tBands[i] * gain), dt)
  }

  // 写入节流：目标 ~60Hz，且差异足够大才写（120Hz 屏 / 静态段不白刷）
  if (ts - lastWriteTs >= 12 && (dirtyEnough() || (playing && quiet() && wroteLevel !== 0))) {
    lastWriteTs = ts
    flushLevels()
  }

  if (shouldRun()) rafId = requestAnimationFrame(tick)
  else {
    lastTs = 0
    // 停循环前把最后一帧的静默值落下去，保证 CSS 侧停在「静止」而不是半途
    if (!playing && !quiet()) {
      flushLevels()
    }
  }
}

function kick() {
  syncRootVars()
  refreshVisibility(performance.now(), true)
  if (!rafId && shouldRun()) {
    lastTs = 0
    rafId = requestAnimationFrame(tick)
  }
}

/** 注册一个「接收律动 CSS 变量」的元素；返回注销函数 */
export function registerVizTarget(el: HTMLElement): () => void {
  targets.add(el)
  ensureVisibilityTimer()
  kick()
  return () => {
    targets.delete(el)
    refreshVisibility(performance.now(), true)
    if (!targets.size && rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
      lastTs = 0
    }
  }
}

/* ════════════ 事件绑定（模块加载时一次） ════════════ */
subscribeMusic(kick)
subscribeMusicFx(kick)
document.addEventListener('visibilitychange', kick)
try {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', kick)
} catch {
  /* 老内核用 addListener，这里容错即可 */
}
syncRootVars()

/* ════════════ React 绑定 ════════════ */

/**
 * 把一个 DOM 元素挂到律动总线：返回**回调 ref**，直接写到需要接收的容器上。
 * 例：`<div ref={useVizTarget<HTMLDivElement>()}>`
 */
export function useVizTarget<T extends HTMLElement>(): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null)
  useEffect(() => {
    if (!el) return
    return registerVizTarget(el)
  }, [el])
  return setEl
}

/** 只做设置同步（元素不需要电平）：设置面板 / 播放页外壳可用它保证 :root 变量最新 */
export function useVizSync(): void {
  const fx = useMusicFxRef()
  useEffect(() => {
    syncRootVars()
  }, [fx])
}

function useMusicFxRef() {
  const ref = useRef(getMusicFx())
  const fx = useSyncExternalStore(subscribeMusicFx, getMusicFx, getMusicFx)
  ref.current = fx
  return fx
}
