import { useEffect, useState } from 'react'

/* ============================================================
   软键盘是否正在弹出（v1.85）
   ------------------------------------------------------------
   用途：搜索 / 填写计算题答案时，把「底部导航栏」和「页面底部按钮条」收起来，
   屏幕上只留输入框 + 键盘，避免它们被键盘顶起来叠在一起。

   判断方式：全局 focusin / focusout —— 焦点落在 input / textarea / 可编辑元素上
   且当前是触摸设备，就认为软键盘正在显示。
   为什么不用 visualViewport.height：微信 web-view 与部分安卓 WebView 里
   视口高度变化不可靠（有时完全不报），focus 状态是最稳的信号。

   注意：
   - 桌面浏览器（鼠标）不触发 —— 没有软键盘，底部导航不应该消失。
   - 焦点在多个输入框之间跳转时不闪：focusout 延后一拍再复查 activeElement。
   ============================================================ */
export function useSoftKeyboard(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isTouch) return

    const isEditable = (el: Element | null): boolean => {
      if (!(el instanceof HTMLElement)) return false
      if (el.isContentEditable) return true
      const tag = el.tagName
      if (tag === 'TEXTAREA') return true
      if (tag !== 'INPUT') return false
      const type = (el as HTMLInputElement).type
      // 这些 input 不唤起软键盘
      return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'file', 'color'].includes(type)
    }

    const onFocusIn = (e: FocusEvent) => {
      if (isEditable(e.target as Element)) setOpen(true)
    }
    const onFocusOut = () => {
      // 输入框 → 输入框 的跳转不要让底部栏闪一下
      window.setTimeout(() => {
        if (!isEditable(document.activeElement)) setOpen(false)
      }, 80)
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return open
}
