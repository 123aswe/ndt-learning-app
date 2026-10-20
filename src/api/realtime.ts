/* ============================================================
   实时通道客户端 —— 与服务端的长连接（SSE，服务端单向推送给浏览器）

   解决什么问题：
     以前通知中心靠每 30 秒轮询一次，最坏要等 30 秒才看到新通知。
     现在改用一条长连接，服务端写库后立刻推过来，通知/评论回复/版本更新/踢下线都基本无感。
     轮询不删除，降级为兜底（见 hooks/useNotifications.ts）。

   为什么不用浏览器自带的 EventSource：
     EventSource 带不了请求头（令牌只能塞进 URL，会进访问日志）、拿不到 HTTP 状态码
     （401 时只会无限自动重连）、也不能自定义重连节奏。
     所以这里用 fetch + ReadableStream 手工解析 SSE 帧，以上三点都自己掌控。

   对外只有三件事：
     startRealtime() / stopRealtime() —— 生命周期（由 hooks/useRealtime.ts 在 App 顶层挂载）
     监听下面这些 window 事件        —— 拿数据（本项目没有全局状态库，沿用 CustomEvent 风格）

   事件（detail 见括号）：
     ndt:realtime-notification  （NotificationItem，与后端通知列表的单条结构一致）
     ndt:realtime-notification-removed （{ ids: number[] }，管理员在后台删掉了这些通知）
     ndt:realtime-update        （AppVersionInfo，新版本信息）
     ndt:realtime-kick          （{ reason }，账号被踢，随后会自动清登录态并退回登录页）
     ndt:realtime-state         （{ state }，连接状态，调试与轮询降级用）

   修改注意：
     1. 这是一个「模块级单例」：多个页面同时用也只是同一条连接，不要在每个页面各连一次
     2. 令牌失效（401）与实时通道被后端关闭（503）都不会重连，直接退回轮询，别改成无限重试
     3. 页面切回前台 / 网络恢复时会立刻重连，不用等退避计时器
     4. 服务端推送是「尽力而为」：断开期间的事件会丢，所以轮询兜底必须保留
   ============================================================ */

import { API_BASE, clearSession, getToken, SESSION_CHANGED_EVENT, type AppVersionInfo, type NotificationItem } from './client'

export type RealtimeState = 'idle' | 'connecting' | 'online' | 'retrying' | 'unavailable'

/** 服务端事件名（与 server/modules/realtime.py 的 EVENT_* 保持一致） */
const EVENT_NOTIFICATION = 'notification'
const EVENT_NOTIFICATION_REMOVED = 'notification-removed'
const EVENT_UPDATE = 'update'
const EVENT_KICK = 'kick'

export const REALTIME_EVENT = {
  /** 收到新通知 → detail: NotificationItem */
  NOTIFICATION: 'ndt:realtime-notification',
  /** 管理员删掉了通知 → detail: { ids: number[] }（在线考生列表里立刻消失） */
  NOTIFICATION_REMOVED: 'ndt:realtime-notification-removed',
  /** 服务端发了新版本 → detail: AppVersionInfo */
  UPDATE: 'ndt:realtime-update',
  /** 账号被踢下线 → detail: { reason: string } */
  KICK: 'ndt:realtime-kick',
  /** 连接状态变化 → detail: { state: RealtimeState } */
  STATE: 'ndt:realtime-state',
} as const

/** 事件流路径（⚠️ 不含 /api 前缀：API_BASE 已经带了，写成 '/api/…' 会拼成 /api/api/… 直接 404） */
const STREAM_PATH = '/user/stream'

/** 断线重连退避：1s 起，逐次翻倍，封顶 15s */
const FIRST_RETRY_MS = 1_000
const MAX_RETRY_MS = 15_000

let running = false
let state: RealtimeState = 'idle'
let controller: AbortController | null = null
let retryTimer: number | null = null
let retryDelay = FIRST_RETRY_MS

function setState(next: RealtimeState) {
  if (state === next) return
  state = next
  dispatch(REALTIME_EVENT.STATE, { state: next })
}

function dispatch(name: string, detail: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** 当前连接状态（'online' = 实时推送可用，其余情况前端走轮询兜底） */
export function getRealtimeState(): RealtimeState {
  return state
}

/* ── SSE 帧解析 ────────────────────────────────────────────
   服务端每帧形如：  event: notification\ndata: {...}\n\n
   心跳是注释帧（": ping"），直接忽略。
   一个 TCP 包可能只切到半帧，所以用 buffer 累积，只处理以 \n\n 收尾的完整帧。 */

interface SseFrame {
  event: string
  data: string
}

function parseFrames(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = []
  const blocks = buffer.split('\n\n')
  const rest = blocks.pop() ?? '' // 最后一段可能不完整，留到下一轮

  for (const block of blocks) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue // 注释帧（心跳），不派发
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest }
}

function handleFrame(frame: SseFrame) {
  let payload: unknown
  try {
    payload = JSON.parse(frame.data)
  } catch {
    return // 非法 JSON 直接丢，不能让一条坏数据打断整条流
  }

  switch (frame.event) {
    case EVENT_NOTIFICATION:
      dispatch(REALTIME_EVENT.NOTIFICATION, payload as NotificationItem)
      break
    case EVENT_NOTIFICATION_REMOVED:
      dispatch(REALTIME_EVENT.NOTIFICATION_REMOVED, payload as { ids?: number[] })
      break
    case EVENT_UPDATE:
      dispatch(REALTIME_EVENT.UPDATE, payload as AppVersionInfo)
      break
    case EVENT_KICK:
      handleKick((payload as { reason?: string })?.reason || '登录已失效，请重新登录')
      break
    default:
      break // ready 等握手事件前端不需要处理
  }
}

/** 账号被踢（改密码 / 管理员重置密码 / 封号 / 删号）：清登录态并让 App 退回登录页 */
function handleKick(reason: string) {
  dispatch(REALTIME_EVENT.KICK, { reason })
  clearSession() // 会广播 session-changed → 本模块自动 stop
  window.dispatchEvent(new CustomEvent('ndt:session-expired'))
}

/* ── 连接与重连 ──────────────────────────────────────────── */

function scheduleRetry() {
  if (!running || retryTimer != null) return
  const delay = retryDelay
  retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS)
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    void open()
  }, delay)
}

/** 立刻重连（跳过退避等待）：页面回到前台、网络恢复时用 */
function reconnectNow() {
  if (!running) return
  if (retryTimer != null) {
    window.clearTimeout(retryTimer)
    retryTimer = null
  }
  retryDelay = FIRST_RETRY_MS
  controller?.abort()
  controller = null
  void open()
}

async function open(): Promise<void> {
  if (!running) return
  const token = getToken()
  if (!token) {
    setState('idle')
    return
  }

  setState('connecting')
  const ctl = new AbortController()
  controller = ctl

  let response: Response
  try {
    response = await fetch(`${API_BASE}${STREAM_PATH}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: ctl.signal,
      cache: 'no-store',
    })
  } catch {
    if (ctl.signal.aborted) return
    setState('retrying')
    scheduleRetry()
    return
  }

  // 令牌失效：清登录态退回登录页，**不要重连**（否则无限 401）
  if (response.status === 401) {
    clearSession()
    window.dispatchEvent(new CustomEvent('ndt:session-expired'))
    setState('idle')
    return
  }
  // 后端关掉了实时通道（config.json 的 realtime.enabled=false）：停在这里，前端走轮询
  if (response.status === 503) {
    setState('unavailable')
    return
  }
  if (!response.ok || !response.body) {
    setState('retrying')
    scheduleRetry()
    return
  }

  setState('online')
  retryDelay = FIRST_RETRY_MS

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { frames, rest } = parseFrames(buffer)
      buffer = rest
      for (const frame of frames) handleFrame(frame)
    }
  } catch {
    /* 网络中断 / 主动 abort：统一按「断开了」处理，下面走重连 */
  }

  if (ctl.signal.aborted) return // 主动断开（退出登录 / 关页面），不重连
  setState('retrying')
  scheduleRetry()
}

/* ── 生命周期 ────────────────────────────────────────────── */

/** 开始维持实时通道（由 App 顶层调用一次；未登录时先待命，登录后自动连） */
export function startRealtime() {
  if (running) return
  running = true
  if (!getToken()) {
    setState('idle')
    return
  }
  void open()
}

/** 断开并停止重连（退出登录 / 组件卸载时调） */
export function stopRealtime() {
  running = false
  retryDelay = FIRST_RETRY_MS
  if (retryTimer != null) {
    window.clearTimeout(retryTimer)
    retryTimer = null
  }
  controller?.abort()
  controller = null
  setState('idle')
}

/* 登录 / 退出后自动连断（client.ts 的 saveSession / clearSession 会广播这个事件） */
window.addEventListener(SESSION_CHANGED_EVENT, () => {
  if (!running) return
  if (getToken()) {
    stopRealtime()
    startRealtime()
  } else {
    stopRealtime()
  }
})

/* 页面回到前台：手机切回浏览器时连接常已被系统掐掉，立刻重连而不是等退避 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running && state !== 'online') reconnectNow()
})

/* 网络恢复：同理 */
window.addEventListener('online', () => {
  if (running && state !== 'online') reconnectNow()
})
