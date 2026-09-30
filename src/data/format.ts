/* ============================================================
   展示格式化工具（考生端通用）
   - formatSize：文件大小（B / KB / MB / GB）
   - formatCount：互动数字（1.2万 / 3.4亿，B 站式口径）
   - formatDuration：视频时长（m:ss / h:mm:ss），取不到返回空串
   修改注意：只在展示层用，不要拿它做业务计算。
   ============================================================ */

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 播放量 / 收藏数：过万换算成「万」，过亿换算成「亿」 */
export function formatCount(n: number): string {
  const value = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  if (value < 10000) return String(value)
  if (value < 100000000) return `${trimZero(value / 10000)}万`
  return `${trimZero(value / 100000000)}亿`
}

function trimZero(v: number): string {
  if (v >= 100) return String(Math.round(v))
  return v.toFixed(1).replace(/\.0$/, '')
}

/** 秒 → m:ss（超过 1 小时 → h:mm:ss）；无效值返回空串，调用方据此不渲染角标 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** ISO / 'YYYY-MM-DD HH:MM:SS' → 'MM-DD HH:MM'（评论时间展示用，解析失败原样返回） */
export function formatMoment(value: string): string {
  if (!value) return ''
  const iso = value.replace(' ', 'T')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
