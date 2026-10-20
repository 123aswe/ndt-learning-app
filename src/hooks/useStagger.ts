import { useEffect, useRef } from 'react'

/* ============================================================
   useStagger —— 整屏进场动效（配合 index.css 的 .ui-stagger 使用）
   - 挂载时由 CSS 动画自然播放一次（切 Tab / 切页面都会重新挂载 → 自动重播，与首页一致）
   - 传入 key（刷新计数、筛选条件、周期等）变化时，把子元素动画的 currentTime 归零重播；
     不重挂载 DOM → 不丢内部状态、不丢输入焦点、也不会闪一下
   用法：
     const ref = useStagger(reloadTick)
     <div className="ui-stagger" ref={ref} style={{ paddingBottom: 110 }}>…</div>
   ============================================================ */
export function useStagger<T extends HTMLElement = HTMLDivElement>(key?: unknown) {
  const ref = useRef<T>(null)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const el = ref.current
    if (!el || typeof el.getAnimations !== 'function') return
    Array.from(el.children).forEach(child => {
      child.getAnimations().forEach(anim => { anim.currentTime = 0 })
    })
  }, [key])

  return ref
}
