import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { getToken, notificationApi, type NotificationItem } from '../api/client'
import {
  formatNotificationTime, isDeletable, type AppNotification,
} from '../data/notifications'

/* ============================================================
   通知中心数据 Hook（首页铃铛未读数 + 通知中心页面共用）
   - 数据来源：后端 /api/user/notifications（管理员在后台「通知管理」发送）
   - 模块级 store：两处拿到的永远是同一份数据，读 / 删一处，另一处立刻同步
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

/** 统一改状态并通知所有订阅者（react 之外的组件也能拿到同一份数据） */
function setSnapshot(items: AppNotification[], loading = false) {
  snapshot = { items, unread: items.filter(i => !i.read).length, loading }
  listeners.forEach(listener => listener())
}

function setLoading(loading: boolean) {
  snapshot = { ...snapshot, loading }
  listeners.forEach(listener => listener())
}

/** 定时轮询：有组件订阅时每 30s 拉一次（首页铃铛未读数保持新鲜；
 *  管理员重置密码踢会话后，考生端最多 30s 内收到 401 → client.ts 广播事件 → 自动退回登录页） */
const POLL_MS = 30_000
let pollTimer: number | null = null

function startPolling() {
  if (pollTimer != null) return
  pollTimer = window.setInterval(() => {
    if (getToken()) void load()
  }, POLL_MS)
}

function stopPolling() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
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

  // 每次进入页面都拉一次，保证换账号登录后立刻看到自己的通知
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
