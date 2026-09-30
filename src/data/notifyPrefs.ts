/* ============================================================
   通知偏好（设置 → 通知 的开关）
   - 本机设置存 localStorage，首页提醒条与设置页共用此模块
   - 新增开关：加 KEY + 读取函数，两个页面都从这里拿，别再各自写死字符串
   ============================================================ */

/** 学习提醒（每日练习提醒）：关闭后首页不再显示「今天还没练习」提示条 */
export const NOTIFY_STUDY_KEY = 'ndt_notify_study'

/** 错题复习提醒：关闭后首页不再显示「N 道错题待复习」提示条 */
export const NOTIFY_REVIEW_KEY = 'ndt_notify_review'

function on(key: string): boolean {
  // 未设置过 = 开启；只有显式存过 '0' 才算关闭
  return localStorage.getItem(key) !== '0'
}

/** 学习提醒是否开启 */
export function studyReminderOn(): boolean {
  return on(NOTIFY_STUDY_KEY)
}

/** 错题复习提醒是否开启 */
export function reviewReminderOn(): boolean {
  return on(NOTIFY_REVIEW_KEY)
}
