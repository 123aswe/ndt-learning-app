import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { getToken, notificationApi, type NotificationItem } from '../api/client'
import { REALTIME_EVENT, startRealtime } from '../api/realtime'
import {
  formatNotificationTime, isDeletable, type AppNotification,
} from '../data/notifications'

/* ============================================================
   通知中心数据 Hook（首页铃铛未读数 + 通知中心页面共用）
   - 数据来源：后端 /api/user/notifications（管理员在后台「通知管理」发送）
   - **实时优先、轮询兜底**：
       实时通道在线（src/api/realtime.ts）→ 服务端一发通知就推过来，
       立刻上屏 + 弹横幅，基本无感；
       通道不可用（后端关掉了实时通道 / 网络异常 / 连接一直失败）→ 自动退回定时轮询，
       功能完全不受影响，只是回到原来的延迟水平
   - 模块级 store：两处拿到的永远是同一份数据，读 / 删一处，另一处立刻同步
   - 管理员在后台删除通知 → 实时移除事件（REALTIME_EVENT.NOTIFICATION_REMOVED）到达时静默从列表去掉
   - 页面挂载时自动刷新一次；未登录 / 网络异常 → 按空列表处理，不打断页面
   - 写操作用「乐观更新 + 失败回滚」，失败时会重新向后端拉一次
   - 修改注意：本项目没有全局状态库，所以用模块级 store + useSyncExternalStore，
     不要在页面里再存一份通知数组
   ============================================================ */

interface NotificationSnapshot {
  items: AppNotification[]
  /** 未读数（首页铃铛红点） */
  unread: number
  loading: boolean
}

let snapshot: NotificationSnapshot = { items: [], unread: 0, loading: false }
const listeners = new Set<() => void>()

/** 与服务端一致：本地最多保留 200 条（后端列表也是这个上限） */
const LIST_CAP = 200

/** 模型统一改状态并通知所有订阅者（react 之外的组件也能拿到同一份数据） */
function setSnapshot(items: AppNotification[], loading = false) {
  snapshot = { items: items.slice(0, LIST_CAP), unread: items.filter(i => !i.read).length, loading }
  listeners.forEach(listener => listener())
}

function setLoading(loading: boolean) {
  snapshot = { ...snapshot, loading }
  listeners.forEach(listener => listener())
}

/* ── 轮询（兜底通道） ──────────────────────────────────────
   实时通道在线时拉长到 2 分钟，只用来「补漏」（连接抖动期间丢掉的推送）；
   实时通道不可用时回到 30 秒，等于以前的体验。
   注意：管理员重置密码踢会话的兜底也在这里
   —— 收不到实时的 kick 事件时，最多 30 秒后请求拿到 401 → client.ts 广播事件 → 退回登录页 */
const POLL_MS_REALTIME = 120_000
const POLL_MS_FALLBACK = 30_000

let realtimeOnline = false
let pollTimer: number | null = null

function pollIntervalMs() {
  return realtimeOnline ? POLL_MS_REALTIME : POLL_MS_FALLBACK
}

/** 重建定时器（连接状态变化时调用，让新节奏立刻生效） */
function restartPollTimer() {
  if (pollTimer != null) window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => {
    if (getToken()) void load()
  }, pollIntervalMs())
}

function startPolling() {
  if (pollTimer != null) return
  restartPollTimer()
}

function stopPolling() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // 保证「有人在看通知」时长连接是活的（App 顶层也会启动，这里是幂等的兜底）
  startRealtime()
  startPolling()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopPolling()
  }
}

function getSnapshot(): NotificationSnapshot {
  return snapshot
}

/** 后端结构 → 页面结构（时间转成 "今天 16:20" 这类展示文案） */
function mapItem(raw: NotificationItem): AppNotification {
  const type = raw.type === 'system' ? 'system' : 'notice'
  return {
    id: raw.id,
    type,
    title: raw.title,
    content: raw.content,
    sender: raw.sender || '系统',
    created_at: formatNotificationTime(raw.created_at),
    read: !!raw.read,
    deletable: raw.deletable ?? isDeletable(type),
  }
}

let inflight: Promise<void> | null = null

/** 已见过的通知 id 集合：首次拉取只做基线（不弹提示），之后出现新 id 才算「来了新通知」 */
let knownIds: Set<number> | null = null

/**
 * 新通知到达事件（'ndt-new-notify'）
 * detail: AppNotification —— App.tsx 里的横幅提示监听这个事件；只在新通知真正到达时触发
 */
function emitNewNotifications(items: AppNotification[]) {
  const fresh = items.filter(i => !i.read)
  if (!fresh.length) return
  // 只挑 id 最大的一条（最新），避免一次来一批时连环弹窗
  const latest = fresh.reduce((a, b) => (b.id > a.id ? b : a))
  window.dispatchEvent(new CustomEvent<AppNotification>('ndt-new-notify', { detail: latest }))
}

/** 拉取我的通知列表（并发调用共用同一次请求）；未登录时直接清空、不发请求 */
function load(): Promise<void> {
  if (!getToken()) {
    knownIds = null
    setSnapshot([])
    return Promise.resolve()
  }
  if (inflight) return inflight
  setLoading(true)
  inflight = (async () => {
    try {
      const data = await notificationApi.list()
      const items = (data.items || []).map(mapItem)
      if (knownIds === null) {
        // 首次拉取：只建立基线，历史未读不弹提示
        knownIds = new Set(items.map(i => i.id))
      } else {
        const fresh = items.filter(i => !knownIds!.has(i.id))
        fresh.forEach(i => knownIds!.add(i.id))
        if (fresh.length) emitNewNotifications(fresh)
      }
      setSnapshot(items)
    } catch {
      // 未登录 / 令牌过期 / 服务未启动：当作「暂时没有通知」，页面照常可用
      setSnapshot([])
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** 实时通道推来的单条通知：去重后直接插到最前面（不再请求后端，所以是真正的「秒达」） */
function acceptRealtime(raw: NotificationItem) {
  if (snapshot.items.some(i => i.id === raw.id)) return // 轮询已经把它拉回来了
  const item = mapItem(raw)
  knownIds?.add(item.id)
  setSnapshot([item, ...snapshot.items])
  emitNewNotifications([item])
}

/* ── 订阅实时通道（模块级注册，只注册一次） ──────────────── */

window.addEventListener(REALTIME_EVENT.STATE, (event) => {
  const next = (event as CustomEvent<{ state?: string }>).detail?.state
  const online = next === 'online'
  if (online === realtimeOnline) return
  realtimeOnline = online
  if (pollTimer != null) restartPollTimer() // 立刻按新节奏重排定时器
})

window.addEventListener(REALTIME_EVENT.NOTIFICATION, (event) => {
  const raw = (event as CustomEvent<NotificationItem>).detail
  if (raw && typeof raw.id === 'number') acceptRealtime(raw)
})

/* 管理员在后台删掉了通知 → 在线考生的列表里立刻去掉（不弹提示，静默移除） */
window.addEventListener(REALTIME_EVENT.NOTIFICATION_REMOVED, (event) => {
  const ids = (event as CustomEvent<{ ids?: number[] }>).detail?.ids
  if (!Array.isArray(ids) || !ids.length) return
  const gone = new Set(ids)
  gone.forEach(id => knownIds?.delete(id))
  if (!snapshot.items.some(i => gone.has(i.id))) return
  setSnapshot(snapshot.items.filter(i => !gone.has(i.id)))
})

/** 展开即已读：先本地置已读，再同步后端（失败则以后端为准重拉） */
async function markRead(id: number) {
  const target = snapshot.items.find(i => i.id === id)
  if (!target || target.read) return
  setSnapshot(snapshot.items.map(i => (i.id === id ? { ...i, read: true } : i)))
  try {
    await notificationApi.markRead(id)
  } catch {
    void load()
  }
}

async function markAllRead() {
  if (!snapshot.items.some(i => !i.read)) return
  setSnapshot(snapshot.items.map(i => ({ ...i, read: true })))
  try {
    await notificationApi.markAllRead()
  } catch {
    void load()
  }
}

/** 删除一条；系统通知不可删，后端也会拦，返回 false 表示没删成 */
async function remove(id: number): Promise<boolean> {
  const target = snapshot.items.find(i => i.id === id)
  if (!target) return false
  if (!target.deletable || !isDeletable(target.type)) return false

  const backup = snapshot.items
  setSnapshot(snapshot.items.filter(i => i.id !== id))
  try {
    await notificationApi.remove(id)
    return true
  } catch {
    setSnapshot(backup) // 回滚，避免界面和后端不一致
    return false
  }
}

export interface UseNotificationsResult {
  items: AppNotification[]
  /** 未读数（首页铃铛红点用） */
  unread: number
  loading: boolean
  reload: () => void
  /** 删除一条（系统通知不可删，返回 false） */
  remove: (id: number) => Promise<boolean>
  /** 展开某条即标记已读 */
  markRead: (id: number) => void
  markAllRead: () => void
}

export function useNotifications(): UseNotificationsResult {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // 每次进入页面都拉一次，保证换账号登录后立刻看到自己的通知 + 补齐断开期间漏掉的
  useEffect(() => { void load() }, [])

  const reload = useCallback(() => { void load() }, [])

  return {
    items: state.items,
    unread: state.unread,
    loading: state.loading,
    reload,
    remove,
    markRead: (id: number) => { void markRead(id) },
    markAllRead: () => { void markAllRead() },
  }
}
