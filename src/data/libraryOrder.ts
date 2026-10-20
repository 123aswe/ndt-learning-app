/* ============================================================
   资料库「顺序 / 倒序」本机偏好
   「教材 / 视频」页与系列详情页共用同一份：任一处切换，
   两边同步生效；写入 localStorage，退出重进后仍保留。
   修改注意：
     - 键名加入 SettingsScreen 的 SESSION_KEYS（清缓存保留名单）
     - 隐私模式等 localStorage 不可用场景静默降级为默认「顺序」
   ============================================================ */

export type LibOrder = 'desc' | 'asc'

const KEY = 'ndt_lib_order'

/** 读取偏好；没存过 / 存了脏值 → 默认 'desc'（管理员排定的顺序） */
export function loadLibOrder(): LibOrder {
  try {
    return localStorage.getItem(KEY) === 'asc' ? 'asc' : 'desc'
  } catch {
    return 'desc'
  }
}

export function saveLibOrder(order: LibOrder): void {
  try {
    localStorage.setItem(KEY, order)
  } catch {
    /* 存不进去就算了，本次会话内仍然生效 */
  }
}
