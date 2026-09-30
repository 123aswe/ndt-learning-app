import { useEffect, useRef, useState } from 'react'
import { BellIcon, XIcon } from '../components/icons'

/* ============================================================
   新通知横幅提示（信息提示）
   - 数据侧：useNotifications 轮询发现「没见过的新通知」时派发
     window CustomEvent 'ndt-new-notify'（detail = 那条通知）
   - 本组件监听该事件，在页面顶部弹出横幅：点击打开通知中心，5 秒自动消失
   - 连续来多条：排队逐条展示（后一条覆盖前一条）
   - 修改注意：只挂在主 Tab 布局（App.tsx），练习/考试页不打扰；颜色一律用语义令牌
   ============================================================ */

interface NotifyBannerData {
  id: number
  title: string
  content: string
  sender: string
  key: number
}

export function NotifyToast({ onOpen }: { onOpen: () => void }) {
  const [banner, setBanner] = useState<NotifyBannerData | null>(null)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      // key 用时间戳：同一条通知来两次也能触发重新动画
      setBanner({ id: detail.id, title: detail.title, content: detail.content, sender: detail.sender, key: Date.now() })
      hideTimer.current = window.setTimeout(() => setBanner(null), 5000)
    }
    window.addEventListener('ndt-new-notify', handler)
    return () => {
      window.removeEventListener('ndt-new-notify', handler)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  if (!banner) return null

  const open = () => {
    setBanner(null)
    onOpen()
  }

  return (
    <div
      key={banner.key}
      className="absolute left-4 right-4 z-50 notify-toast-in"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
    >
      <button
        onClick={open}
        className="w-full text-left card p-3.5 flex items-start gap-3 tap"
        style={{ borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--accent-border)', background: 'var(--surface)' }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
        >
          <BellIcon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{banner.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
              新通知
            </span>
          </span>
          <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-2)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {banner.content}
          </span>
        </span>
        <span
          className="flex-shrink-0 p-1 tap"
          onClick={(e) => { e.stopPropagation(); setBanner(null) }}
        >
          <XIcon size={13} color="var(--text-3)" />
        </span>
      </button>
    </div>
  )
}
