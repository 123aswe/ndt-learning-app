/* ============================================================
   通知中心 · 数据模型与展示工具
   - 正式数据来自后端 notifications 表（管理员在后台「通知管理」发送）
   - 类型由管理员设置：
       system（系统通知）→ 考生不可删除（密码重置结果、版本公告等）
       notice（普通通知）→ 考生可自行删除
   - 读写统一走 src/hooks/useNotifications.ts（内部调 /api/user/notifications），
     页面不要自己 fetch
   - 后端字段：id / type / title / content / sender / created_at / read / deletable
     created_at 形如 "2026-09-29 16:20:00"，列表展示前用 formatNotificationTime 转一次
   ============================================================ */

export type NotificationType = 'system' | 'notice'

/** 通知类型 → 中文标签（后台发送时的下拉与此保持一致：server/modules/notifications.py） */
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  system: '系统通知',
  notice: '普通通知',
}

/** 系统通知不可删除 */
export function isDeletable(type: NotificationType): boolean {
  return type !== 'system'
}

export interface AppNotification {
  id: number
  type: NotificationType
  title: string
  content: string
  /** 发送方显示名（管理员账号 / 系统） */
  sender: string
  /** 展示用时间（已由 formatNotificationTime 转换） */
  created_at: string
  read: boolean
  /** 后端给出的可删除标记（系统通知为 false） */
  deletable: boolean
}

/** 把后端时间 "2026-09-29 16:20:00" 转成列表里显示的 "今天 16:20" / "09-29 16:20" */
export function formatNotificationTime(value: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value || '')
  if (!matched) return value || ''
  const [, year, month, day, hour, minute] = matched
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (`${year}-${month}-${day}` === today) return `今天 ${hour}:${minute}`
  return `${month}-${day} ${hour}:${minute}`
}
