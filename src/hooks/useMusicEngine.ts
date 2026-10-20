/**
 * v1.71 全局音乐引擎（模块级单例 · 跨页面后台播放的核心）
 * ============================================================
 * 【为什么要这个文件】
 *   改造前：音乐页 MusicScreen 在自己的 JSX 里渲染 <audio>，播放/暂停/进度都用组件内 useState。
 *   App.tsx 的状态机里有一批「整页视图」（观看历史 / 收藏 / 设置 / 搜索 / 通知 / 做题 / 考试…）
 *   是 `if (view.name === 'xxx') return <XxxScreen/>` 的提前返回 —— 一旦走进去，
 *   MusicScreen 整个被卸载，它渲染的 <audio> 随之从 DOM 移除 → 音乐立刻中断。
 *
 *   改造后：音频元素与播放状态全部提到【模块级单例】，在页面加载时创建一次，
 *   之后任何 React 组件挂载 / 卸载都不会影响它。MusicScreen 与全局悬浮球播放器
 *   都只是「遥控器」，读同一份状态、调同一批动作。
 *
 * 【本文件负责】
 *   ① 唯一的 HTMLAudioElement（不进任何 React 组件树）
 *   ② 播放状态 store（queue / index / playing / seconds / duration / mode）+ useSyncExternalStore 绑定
 *   ③ 音频事件监听（timeupdate / loadedmetadata / ended / error / play / pause）
 *   ④ MediaSession（锁屏 / 通知栏媒体卡片）：动作处理 + 播放状态 + 进度同步
 *      —— 注册在这里而不是组件里，所以退出音乐页后锁屏上的「上一首 / 下一首」依然有效
 *
 * 【注意】本文件不 import 任何业务组件，避免循环依赖。
 */

import { useSyncExternalStore } from 'react'

export type MusicPlayMode = 'order' | 'one' | 'random'

/** 引擎需要的曲目字段（MusicScreen 的 Track 是它的超集，可直接传入） */
export interface MusicEngineTrack {
  id: number
  title: string
  artist: string
  album: string
  duration: number
  src: string
  coverUrl: string
}

export interface MusicEngineSnapshot {
  /** 当前曲库（由 MusicScreen 拉到数据后同步进来，此后即使它卸载也一直保留） */
  queue: MusicEngineTrack[]
  /** 当前播放下标（相对 queue） */
  index: number
  /** 播放意图：true = 应该在播（等价于原来的 playing） */
  playing: boolean
  /** 当前播放位置（秒） */
  seconds: number
  /** 音频真实时长（秒），拿不到时回落到曲目自带 duration */
  duration: number
  /** 播放模式：顺序 / 单曲循环 / 随机 */
  mode: MusicPlayMode
}

/* ════════════ ① 唯一的音频元素 ════════════ */
/* 用 new Audio() 而不是 <audio> JSX：它只存在于 JS 堆里，不进 React 组件树，
   组件卸载不会碰它，页面不休就不销毁 —— 这就是「切页面音乐不断」的物理基础。 */
const audio: HTMLAudioElement = new Audio()
audio.preload = 'metadata'

const msSupported = typeof navigator !== 'undefined' && 'mediaSession' in navigator

/* ════════════ ② 状态 store ════════════ */
let snapshot: MusicEngineSnapshot = {
  queue: [],
  index: 0,
  playing: false,
  seconds: 0,
  duration: 0,
  mode: 'order',
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** 广播状态（playing 变化时顺手同步系统媒体卡片的播放状态） */
function patch(next: Partial<MusicEngineSnapshot>) {
  snapshot = { ...snapshot, ...next }
  if ('playing' in next) syncMediaSessionState()
  emit()
}

export function subscribeMusic(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getMusicSnapshot(): MusicEngineSnapshot {
  return snapshot
}

/** 供需要直接操作音频元素的场景使用（进度条读取 currentTime 等） */
export function getMusicAudio(): HTMLAudioElement {
  return audio
}

/** 兼容 React setState 写法：支持直接值，也支持 (prev) => next */
function resolveValue<T>(value: T | ((prev: T) => T), prev: T): T {
  return typeof value === 'function' ? (value as (prev: T) => T)(prev) : value
}

/* ════════════ ③ 把「状态」落到真实音频上 ════════════ */
let loadedSrc = ''

function syncAudio() {
  const track = snapshot.queue[snapshot.index]
  if (!track || !track.src) {
    // 曲库为空 / 该曲没有音频文件：不播
    audio.pause()
    if (snapshot.playing) patch({ playing: false })
    return
  }

  if (track.src !== loadedSrc) {
    loadedSrc = track.src
    audio.src = track.src
    audio.load()
    patch({ seconds: 0, duration: 0 })
  }

  if (snapshot.playing) {
    // 真实频谱分析（v1.73）：接线一次，失败即永久降级，播放行为不受影响
    ensureMusicAnalyser()
    // 浏览器自动播放策略可能拒绝：静默把按钮状态改回暂停，不弹错
    void audio.play().catch(() => patch({ playing: false }))
  } else {
    audio.pause()
  }
}

/* ════════════ ④ MediaSession（锁屏 / 通知栏媒体卡片） ════════════ */

/** 把真实进度报给系统媒体卡片（锁屏进度条才准） */
export function pushMusicPositionState() {
  if (!msSupported) return
  const d = audio.duration
  if (!Number.isFinite(d) || d <= 0) return
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(Math.max(0, audio.currentTime), d),
    })
  } catch {
    /* 部分浏览器无 metadata 时会抛错：忽略 */
  }
}

function syncMediaSessionState() {
  if (!msSupported) return
  try {
    navigator.mediaSession.playbackState = snapshot.playing ? 'playing' : 'paused'
  } catch {
    /* 忽略 */
  }
}

/* 动作处理器只在模块加载时注册一次，且【不注销】——
   所以在音乐页被卸载（例如进了「设置」页）之后，锁屏上的上下曲依然能切歌。 */
function registerMediaActions() {
  if (!msSupported) return
  const ms = navigator.mediaSession
  const safe = (action: MediaSessionAction, fn: (details: MediaSessionActionDetails) => void) => {
    try {
      ms.setActionHandler(action, fn)
    } catch {
      /* 该动作此浏览器不支持：忽略 */
    }
  }
  safe('play', () => musicEngine.play())
  safe('pause', () => musicEngine.pause())
  safe('previoustrack', () => musicEngine.prev())
  safe('nexttrack', () => musicEngine.next())
  safe('seekto', (d) => {
    if (typeof d.seekTime === 'number' && Number.isFinite(d.seekTime)) musicEngine.seek(d.seekTime)
  })
  safe('seekbackward', (d) => musicEngine.seek(audio.currentTime - (d.seekOffset || 10)))
  safe('seekforward', (d) => musicEngine.seek(audio.currentTime + (d.seekOffset || 10)))
}

/* 音频事件监听：同样只注册一次，与任何组件的生命周期无关 */
audio.addEventListener('timeupdate', () => {
  patch({ seconds: audio.currentTime })
  pushMusicPositionState()
})

audio.addEventListener('loadedmetadata', () => {
  const d = audio.duration
  if (Number.isFinite(d) && d > 0) patch({ duration: d })
  pushMusicPositionState()
})

audio.addEventListener('ended', () => {
  // 单曲循环：原地重播；其余模式交给 next()（顺序 +1 / 随机抽一首）
  if (snapshot.mode === 'one') {
    audio.currentTime = 0
    void audio.play().catch(() => patch({ playing: false }))
    return
  }
  musicEngine.next()
})

audio.addEventListener('error', () => {
  if (snapshot.playing) patch({ playing: false })
})

audio.addEventListener('play', () => {
  if (!snapshot.playing) patch({ playing: true })
})

audio.addEventListener('pause', () => {
  // 浏览器 / 系统主动暂停（如被其他 App 抢占音频）时同步按钮状态
  if (snapshot.playing) patch({ playing: false })
})

/* ════════════ ⑤ 对外动作 ════════════ */

/** 切到指定下标并（默认）开始播放；下标自动取模，支持负数（上一首） */
function switchTo(nextIndex: number, autoPlay = true) {
  const n = snapshot.queue.length
  if (!n) return
  const index = ((nextIndex % n) + n) % n
  patch({ index, seconds: 0, duration: 0, ...(autoPlay ? { playing: true } : {}) })
  syncAudio()
}

export const musicEngine = {
  /**
   * 同步曲库（MusicScreen 拉到数据后调用）。
   * 刷新曲库时按「当前曲目 id」重新定位，保证刷新后不会跳歌、也不会中断播放。
   *
   * ⚠️ 关键：空数组【不能覆盖】已有曲库。
   *     MusicScreen 重新挂载时（从设置页 / 观看历史等整页视图返回音乐 Tab），
   *     它自己的 remote 还是 null、tracks 先是空数组 —— 如果让这个空数组盖掉引擎里
   *     的曲库，syncAudio() 会认为「没有可播的曲目」而把音乐掐断。
   */
  setQueue(list: MusicEngineTrack[]) {
    if (!list.length && snapshot.queue.length) return

    const current = snapshot.queue[snapshot.index]
    let index = snapshot.queue.length ? Math.min(snapshot.index, Math.max(0, list.length - 1)) : 0
    if (current) {
      const same = list.findIndex((t) => t.id === current.id)
      if (same >= 0) index = same
    }
    patch({ queue: list, index })
    syncAudio()
  },

  /** 兼容旧调用点的 setPlaying：支持 setPlaying(true) / setPlaying((p) => !p) */
  setPlaying(value: boolean | ((prev: boolean) => boolean)) {
    patch({ playing: resolveValue(value, snapshot.playing) })
    syncAudio()
  },

  setMode(value: MusicPlayMode | ((prev: MusicPlayMode) => MusicPlayMode)) {
    patch({ mode: resolveValue(value, snapshot.mode) })
  },

  /** 播放模式循环切换：顺序播放 → 单曲循环 → 随机播放 */
  cycleMode() {
    const m = snapshot.mode
    patch({ mode: m === 'order' ? 'one' : m === 'one' ? 'random' : 'order' })
  },

  play() {
    patch({ playing: true })
    syncAudio()
  },

  pause() {
    patch({ playing: false })
    syncAudio()
  },

  toggle() {
    if (snapshot.playing) musicEngine.pause()
    else musicEngine.play()
  },

  /** 切换曲目（MusicScreen 的 switchTo 就是它） */
  switchTo,

  /** 播放指定下标的曲目 */
  playAt(i: number) {
    switchTo(i)
  },

  /** 上一首 */
  prev() {
    switchTo(snapshot.index - 1)
  },

  /** 下一首：随机模式下随机挑一首（避免与当前重复），其余模式顺序 +1 */
  next() {
    const n = snapshot.queue.length
    if (!n) return
    if (snapshot.mode === 'random' && n > 1) {
      let r = snapshot.index
      while (r === snapshot.index) r = Math.floor(Math.random() * n)
      switchTo(r)
      return
    }
    switchTo(snapshot.index + 1)
  },

  /** 跳转到指定秒数（进度条 / 点歌词行 / 锁屏拖动都用它） */
  seek(seconds: number) {
    const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : snapshot.duration
    const target = Math.max(0, d > 0 ? Math.min(seconds, d) : seconds)
    if (Number.isFinite(target)) audio.currentTime = target
    patch({ seconds: target })
    pushMusicPositionState()
  },

  /**
   * 退出登录 / 需要彻底收尾时调用：
   * 停止播放 + 清空曲库 + 清掉系统媒体卡片与音频 src。
   *
   * 为什么必须清曲库：全局迷你播放条是靠「引擎里有曲目」来决定显示的，
   * 只 pause 不清曲库的话，退出登录回到登录页后迷你条还会挂在下面。
   * （旧版是 MusicScreen 卸载时清媒体卡片来收尾，现在播放器在全局引擎里，
   *   卸载不再等于停止，必须显式调用本方法。） */
  stop() {
    loadedSrc = ''
    patch({ queue: [], index: 0, playing: false, seconds: 0, duration: 0 })
    try {
      audio.pause()
      // removeAttribute + load()：比直接 audio.src = '' 干净（后者会触发一次 error 事件）
      audio.removeAttribute('src')
      audio.load()
    } catch {
      /* 忽略 */
    }
    if (msSupported) {
      try {
        navigator.mediaSession.metadata = null
      } catch {
        /* 忽略 */
      }
    }
    syncMediaSessionState()
  },
}

registerMediaActions()

/* ════════════ ⑧ 真实频谱分析（v1.73 · 可选能力，失败即永久降级） ════════════ */
/*
 * 【为什么放在引擎里】
 *   分析器必须挂在【唯一的那个 audio 元素】上。组件卸载不影响它，
 *   所以切到「设置 / 观看历史 / 做题」等整页视图后，律动依然连续，不会断。
 *
 * 【接线方式】audio → MediaElementSource → AnalyserNode → GainNode → destination
 *   注意：createMediaElementSource 会接管元素的输出，之后声音只走这条图。
 *   因此 Gain 的增益恒为 1、且必须连到 destination —— 否则会直接没声音。
 *
 * 【三道保险 · 任何一道不满足就永远不做分析，播放走原生路径】
 *   ① 同源检测：跨域音频经 Web Audio 会被静音（CORS 污染），必须跳过。
 *      （生产是同源 /api/…；只有把 VITE_API_BASE 配成跨域绝对地址时才会命中这条）
 *   ② 全流程 try/catch：任何一步抛错 → analyserDisabled = true，此生不再尝试。
 *   ③ resume 兜底：AudioContext 在非用户手势下会是 suspended（= 静音），
 *      首次接线天然发生在用户点击播放的调用栈内；再挂一次性全局手势监听兜底。
 *
 * 【已知限制】MediaElementSource 无法撤销。若某个内核能播但取不到 PCM
 *   （表现为有声音、频谱恒为 0），useMusicViz 会在 2.5s 后把律动降级为装饰动效，
 *   并在控制台给出明确提示 —— 不会用随机数据冒充真实频谱。
 *   需要彻底关掉该能力时，把下面的 ENABLE_AUDIO_ANALYSER 改成 false 即可。
 */
const ENABLE_AUDIO_ANALYSER = true

let analyserNode: AnalyserNode | null = null
let audioCtx: AudioContext | null = null
let analyserDisabled = !ENABLE_AUDIO_ANALYSER
let resumeHooked = false

/** 音频是否与页面同源（跨域会让 Web Audio 输出静音） */
function isSameOriginSource(src: string): boolean {
  if (!src) return false
  try {
    return new URL(src, location.href).origin === location.origin
  } catch {
    return false
  }
}

/** AudioContext 被挂起时，任何一次用户手势都尝试恢复（防止"有画面没声音"） */
function hookResumeOnGesture() {
  if (resumeHooked) return
  resumeHooked = true
  const resume = () => {
    const ctx = audioCtx
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
  }
  document.addEventListener('pointerdown', resume, { passive: true })
  document.addEventListener('touchstart', resume, { passive: true })
  document.addEventListener('keydown', resume)
}

/** 惰性接线：已经有分析器就直接返回；不可用则永久返回 null */
export function ensureMusicAnalyser(): AnalyserNode | null {
  if (analyserNode) return analyserNode
  if (analyserDisabled) return null

  const Ctor =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined
  if (!Ctor) {
    analyserDisabled = true
    return null
  }
  if (!isSameOriginSource(audio.currentSrc || audio.src)) {
    analyserDisabled = true
    console.warn('[music-viz] 音频与页面不同源，已跳过频谱分析（避免 Web Audio 静音），律动用装饰动效。')
    return null
  }

  try {
    const ctx = new Ctor()
    const source = ctx.createMediaElementSource(audio)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512 // 256 个频点：足够 12 条光带 + 三段，开销极低
    analyser.smoothingTimeConstant = 0.7
    /* ⚠️ 动态范围必须放宽：默认 -100 ~ -30 dB，而流行/舞曲的低频段常年高于 -30dB，
       会直接顶到 255 → 电平恒为 1 → 视觉上"一直满格、看不出在动"。
       改成 -92 ~ -14：满刻度需要非常热的频段，低频一般落在 0.6~0.85，留出动态余量。 */
    analyser.minDecibels = -92
    analyser.maxDecibels = -14
    const gain = ctx.createGain()
    gain.gain.value = 1

    source.connect(analyser)
    analyser.connect(gain)
    gain.connect(ctx.destination)

    audioCtx = ctx
    analyserNode = analyser
    hookResumeOnGesture()
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return analyser
  } catch {
    // 抛错就彻底放弃，audio 保持原生输出路径，发声不受影响
    analyserDisabled = true
    try {
      void audioCtx?.close()
    } catch {
      /* 忽略 */
    }
    audioCtx = null
    analyserNode = null
    return null
  }
}

/** 供 useMusicViz 每帧取数据用；没接线返回 null（→ 电平恒 0 → 自动装饰动效） */
export function getMusicAnalyser(): AnalyserNode | null {
  return analyserNode
}

/** 调试用：分析器是否已接上 */
export function isMusicAnalyserLive(): boolean {
  return !!analyserNode
}

/* ════════════ ⑥ React 绑定 ════════════ */

/**
 * 订阅全局播放状态。
 * 用法与 useState 一致（变量名照搬），但状态在组件卸载后依然存在。
 */
export function useMusicEngine(): MusicEngineSnapshot {
  return useSyncExternalStore(subscribeMusic, getMusicSnapshot, getMusicSnapshot)
}

/* ════════════ ⑦ 全局悬浮球协调 ════════════ */
/* 目的：音乐页 MusicScreen 自己已经有一整套播放 UI（悬浮条 / 播放页），
   而「切到别的 Tab」或「进整页视图」时需要由全局悬浮球接管 —— 两者不能同时出现。

   ⚠️ 判断依据是「音乐页当前是否可见」，不是「组件是否挂载」：
     v1.70 起音乐 Tab 是常驻挂载（切走只 display:none，为的是不中断播放），
     所以组件挂载 ≠ 用户正在看音乐页。若按挂载判断，切到首页 / 题库时悬浮球就不会出现。
     因此 MusicScreen 用 active（是否处于音乐 Tab）上报。

   做法：MusicScreen 上报，全局悬浮球订阅。
   用「上报 + 订阅」而不是把状态塞进 App.tsx，是因为 App.tsx 的整页视图
   走的是提前返回（return <XxxScreen/>），拿不到 MusicScreen 的状态。 */
let musicPageVisible = false
const pageVisibleListeners = new Set<() => void>()

/** MusicScreen 在 active 变化 / 卸载时调用（true = 用户正看着音乐页，悬浮球让位） */
export function setMusicPageVisible(visible: boolean) {
  if (musicPageVisible === visible) return
  musicPageVisible = visible
  pageVisibleListeners.forEach((l) => l())
}

/** 供全局悬浮球判断「该不该显示自己」 */
export function useMusicPageVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      pageVisibleListeners.add(onChange)
      return () => {
        pageVisibleListeners.delete(onChange)
      }
    },
    () => musicPageVisible,
    () => musicPageVisible,
  )
}

/* 「点悬浮球 → 回到音乐 Tab」的入口。
   由 App 挂载时注册（App 始终在挂载状态，即使切到整页视图也不会卸载），
   这样全局悬浮球不需要层层透传回调。 */
let openMusicPageHandler: (() => void) | null = null

/** App 挂载时注册：一般是 goMain('music')；卸载时传 null 注销 */
export function setOpenMusicPageHandler(handler: (() => void) | null) {
  openMusicPageHandler = handler
}

/** 全局悬浮球里点歌名 / 封面时调用：请求 App 切回音乐 Tab */
export function openMusicPage() {
  openMusicPageHandler?.()
}
