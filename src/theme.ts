/* ============================================================
   主题（外观）模块 —— 浅色 / 深色 / 跟随系统
   - 只做一件事：把当前模式写到 <html data-theme="light|dark">
     具体颜色全部在 src/index.css 的 [data-theme='dark'] 段里，组件不要写死颜色
   - 「跟随系统」= 监听 prefers-color-scheme，系统切换时自动同步属性
   用法：
     initTheme()                 // main.tsx 启动时调用一次（避免首屏闪白）
     setThemeMode('dark')        // 设置并持久化，返回实际生效的模式
     getThemeMode()              // 读当前模式（localStorage，默认 system）
     onThemeChange(cb)           // 订阅「实际生效的明暗」变化，返回取消订阅函数
   ============================================================ */

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const THEME_KEY = 'ndt_theme'

const mql = (): MediaQueryList | null =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

/** 读当前设置的模式；没设置过默认「跟随系统」 */
export function getThemeMode(): ThemeMode {
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** 模式 → 实际生效的明暗（system 时看系统偏好） */
export function resolveTheme(mode: ThemeMode = getThemeMode()): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode
  return mql()?.matches ? 'dark' : 'light'
}

/** 把实际明暗写到 html[data-theme]，并同步 meta theme-color */
function paint(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#14171A' : '#F8F3E8')
}

/** 设置模式并持久化；返回实际生效的明暗 */
export function setThemeMode(mode: ThemeMode): ResolvedTheme {
  localStorage.setItem(THEME_KEY, mode)
  const resolved = resolveTheme(mode)
  paint(resolved)
  return resolved
}

/** 订阅实际明暗变化（系统主题切换时也会触发）；返回取消订阅函数 */
export function onThemeChange(cb: (resolved: ResolvedTheme) => void): () => void {
  const m = mql()
  if (!m) return () => {}
  const handler = () => {
    if (getThemeMode() !== 'system') return
    const resolved = resolveTheme('system')
    paint(resolved)
    cb(resolved)
  }
  m.addEventListener('change', handler)
  return () => m.removeEventListener('change', handler)
}

/** 应用启动时调用：写入一次属性，并挂上系统主题监听（常驻） */
export function initTheme(): ResolvedTheme {
  const resolved = resolveTheme()
  paint(resolved)
  onThemeChange(() => {})
  return resolved
}
