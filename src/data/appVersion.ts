/* ============================================================
   版本号（前端唯一来源）
   - 修改注意：发版时改这里的 APP_VERSION，并同步 server/data/version.json 的 latest_version
     （两处比较，差值为正说明服务端有新版本 → 设置页「检查更新」会提示）
   - 版本号格式：主.次.修订（x.y.z），逐段按数值比较，不要带 v 前缀
   ============================================================ */

export const APP_VERSION = '1.0.0'

/** 解析 "1.2.3" → [1,2,3]；非法段按 0 处理 */
function parse(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map(part => {
      const n = parseInt(part, 10)
      return Number.isFinite(n) ? n : 0
    })
}

/** a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareVersion(a: string, b: string): number {
  const left = parse(a)
  const right = parse(b)
  const len = Math.max(left.length, right.length)
  for (let i = 0; i < len; i++) {
    const x = left[i] ?? 0
    const y = right[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 服务端版本是否比本地新 */
export function hasUpdate(latest: string, current: string = APP_VERSION): boolean {
  return compareVersion(latest, current) > 0
}
