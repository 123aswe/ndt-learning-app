import React, { useMemo, useState } from 'react'
import { BellIcon, ChevronLeftIcon, ChevronRightIcon, RefreshIcon, ShieldIcon, TrashIcon } from '../components/icons'
import { useNotifications } from '../hooks/useNotifications'
import { isDeletable, NOTIFICATION_TYPE_LABEL, type AppNotification } from '../data/notifications'

/* ============================================================
   通知中心（考生端）
   - 数据来源：管理员在后台「通知管理」发送（全体 / 指定考生）
   - 类型由管理员设置：
       system（系统通知）→ 不可删除，用于密码重置结果、版本公告等
       notice（普通通知）→ 考生可自行删除
   - 交互：点卡片展开 / 收起正文（展开即标记已读）；普通通知可删除
   - 数据读写统一走 src/hooks/useNotifications.ts（内部调 /api/user/notifications）
   - 修改注意：整屏页面根必须是唯一 .scroll-area bg-page（见 FRONTEND.md §11）
   ============================================================ */

interface NotificationsScreenProps {
  onBack: () => void
}

export function NotificationsScreen({ onBack }: NotificationsScreenProps) {
  const { items, unread, loading, reload, remove, markRead, markAllRead } = useNotifications()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2000)
  }

  const visible = useMemo(
    () => (filter === 'unread' ? items.filter(i => !i.read) : items),
    [items, filter]
  )

  /** 点卡片：展开 / 收起，展开即标记已读 */
  const toggle = (id: number) => {
    setExpandedId(prev => (prev === id ? null : id))
    markRead(id)
  }

  /** 删除：系统通知不给按钮，这里再兜一层（后端也会拦） */
  const handleRemove = async (item: AppNotification) => {
    if (!item.deletable || !isDeletable(item.type)) { showToast('系统通知不可删除'); return }
    if (busy) return
    setBusy(true)
    const ok = await remove(item.id)
    setBusy(false)
    if (ok) {
      if (expandedId === item.id) setExpandedId(null)
      showToast('通知已删除')
    } else {
      showToast('删除失败，请稍后重试')
    }
  }

  return (
    <div className="scroll-area bg-page">
      {/* 顶栏 */}
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="返回"
          className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
          style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
        >
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>
        <h1 className="text-xl font-bold flex-1" style={{ color: 'var(--text-1)' }}>通知中心</h1>
        <button
          onClick={reload}
          aria-label="刷新"
          className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
          style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
        >
          <RefreshIcon size={16} color="var(--text-2)" />
        </button>
        {unread > 0 && (
          <button
            onClick={() => { markAllRead(); showToast('已全部标记为已读') }}
            className="text-xs font-medium tap"
            style={{ color: 'var(--accent)' }}
          >
            全部已读
          </button>
        )}
      </div>

      {/* 筛选 */}
      <div className="px-4 mb-4">
        <div className="flex rounded-xl p-1" style={{ background: 'var(--field-bg)', border: '1px solid var(--line)' }}>
          {([
            { id: 'all', label: `全部 ${items.length}` },
            { id: 'unread', label: `未读 ${unread}` },
          ] as Array<{ id: 'all' | 'unread'; label: string }>).map(t => {
            const active = filter === t.id
            return (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className="flex-1 h-9 rounded-lg text-xs font-semibold tap"
                style={{
                  background: active ? 'var(--surface-raised)' : 'transparent',
                  color: active ? 'var(--accent)' : 'var(--text-2)',
                  boxShadow: active ? '0 1px 3px rgba(27,30,35,0.12)' : 'none',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 列表 */}
      <div className="px-4" style={{ paddingBottom: 40 }}>
        {loading && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div
              className="w-8 h-8 rounded-full anim-spin"
              style={{ border: '2px solid var(--line)', borderTopColor: 'var(--accent)' }}
            />
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>正在加载通知…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
              <span style={{ color: 'var(--accent)' }}><BellIcon size={28} /></span>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              {filter === 'unread' ? '没有未读通知' : '暂时没有通知'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map(n => {
              const isSystem = n.type === 'system'
              const expanded = expandedId === n.id
              return (
                <div key={n.id} className="card overflow-hidden">
                  <button onClick={() => toggle(n.id)} className="w-full p-4 text-left card-tap">
                    <div className="flex items-start gap-3">
                      {/* 系统通知：accent 实底 + 白色盾牌，一眼可辨；普通通知：浅底铃铛 */}
                      {isSystem ? (
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: 'var(--accent-fill)' }}
                        >
                          <ShieldIcon size={17} color="#FFFFFF" />
                        </div>
                      ) : (
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: 'var(--field-bg)', border: '1px solid var(--line)' }}
                        >
                          <BellIcon size={17} color="var(--text-2)" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>{n.title}</span>
                          {!n.read && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded-md"
                            style={{
                              background: isSystem ? 'var(--chip-bg-soft)' : 'var(--field-bg)',
                              color: isSystem ? 'var(--accent)' : 'var(--text-2)',
                              border: `1px solid ${isSystem ? 'var(--accent-border)' : 'var(--line)'}`,
                            }}
                          >
                            {NOTIFICATION_TYPE_LABEL[n.type]}
                          </span>
                          <span className="text-[10px] truncate" style={{ color: 'var(--text-3)' }}>
                            {n.sender} · {n.created_at}
                          </span>
                        </div>
                      </div>

                      <ChevronRightIcon
                        size={14}
                        color="var(--text-3)"
                        className={`mt-1 flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
                      />
                    </div>

                    {/* 收起时显示一行摘要 */}
                    {!expanded && (
                      <p className="text-xs mt-2.5 line-clamp-1" style={{ color: 'var(--text-3)' }}>
                        {n.content.replace(/\n/g, ' ')}
                      </p>
                    )}
                  </button>

                  {/* 展开区：正文 + 删除 */}
                  {expanded && (
                    <div className="px-4 pb-4" style={{ borderTop: '1px solid var(--line)' }}>
                      <p className="text-xs whitespace-pre-wrap leading-relaxed mt-3" style={{ color: 'var(--text-2)' }}>
                        {n.content}
                      </p>
                      <div className="flex items-center justify-between mt-4">
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                          {isSystem ? '系统通知 · 不可删除' : '普通通知 · 可删除'}
                        </span>
                        {isSystem ? (
                          <span
                            className="text-[10px] px-2.5 py-1 rounded-lg"
                            style={{ background: 'var(--field-bg)', color: 'var(--text-3)', border: '1px solid var(--line)' }}
                          >
                            该通知由系统发送
                          </span>
                        ) : (
                          <button
                            onClick={() => handleRemove(n)}
                            disabled={busy}
                            className="h-8 px-3 rounded-lg text-xs font-semibold tap flex items-center gap-1.5"
                            style={{
                              background: 'var(--err-weak)',
                              color: 'var(--err)',
                              border: '1px solid var(--err-border)',
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            <TrashIcon size={13} /> 删除
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 z-[70] anim-slide-up">
          <div
            className="px-4 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: 'rgba(27,30,35,0.88)', color: '#FFFFFF', boxShadow: '0 8px 24px rgba(27,30,35,0.28)' }}
          >
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
