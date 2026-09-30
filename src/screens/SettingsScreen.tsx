import React, { useMemo, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { PasswordResetSheet } from '../components/PasswordResetSheet'
import { useProfile } from '../hooks/useProfile'
import {
  ApiError, appApi, authApi, clearSession, getIdentity, patchSavedProfile, securityApi,
} from '../api/client'
import { APP_VERSION, hasUpdate } from '../data/appVersion'
import { NOTIFY_STUDY_KEY, NOTIFY_REVIEW_KEY } from '../data/notifyPrefs'
import { getThemeMode, setThemeMode, type ThemeMode } from '../theme'
import {
  ChevronLeftIcon, ChevronRightIcon, UserIcon, BellIcon, TrashIcon, LogoutIcon, CheckIcon,
  RefreshIcon, XIcon,
} from '../components/icons'

/* ============================================================
   设置页（浅色 / 深色都支持）
   结构：账号（账号安全）/ 外观（浅色·深色·跟随系统）/ 通知 / 通用（清除缓存·检查更新·退出登录）
   - 账号安全：自助改登录密码（需原密码）与改登录账号（需登录密码）；
     忘记原密码 / 无法登录时提示联系管理员在后台重置
   - 外观：三种模式都立即生效并持久化（ndt_theme），样式在 src/index.css 的 [data-theme='dark']
   - 通知：本地开关，暂存 localStorage（推送后端尚未接入）
   - 清除缓存：清掉非登录态的本地缓存，不碰 ndt_token / ndt_identity / ndt_profile
   - 检查更新：比对 src/data/appVersion.ts 的 APP_VERSION 与 GET /api/app/version
   - 退出登录：调 /auth/logout（失败也照常清本地），回到登录页
   修改注意：
     - 页面滚动结构必须是唯一 .scroll-area bg-page 根容器（见 FRONTEND.md §11）
     - 弹层 z-[60]、Toast z-[70]，避免被底部导航（z-50）遮挡
     - 颜色一律用 var(--token)，写死 hex 会让深色模式变脏
   ============================================================ */

/** 登录态保留的键：清除缓存不会动它们 */
const SESSION_KEYS = ['ndt_token', 'ndt_identity', 'ndt_profile', 'ndt_notify_study', 'ndt_notify_review']

const PASSWORD_MIN = 6
const ACCOUNT_HINT = '账号为 4-20 位字母 / 数字 / 下划线'

interface SettingsScreenProps {
  /** 返回上一页（「我的」） */
  onBack: () => void
  /** 已退出登录，由 App 切回登录页 */
  onLogout: () => void
}

/* ── 小组件：设置行 / 开关 / 输入框 / 弹层（本页自用） ─── */

function SettingsRow({
  icon, label, sub, right, onClick, danger,
}: {
  icon: React.ReactNode
  label: string
  sub?: string
  right?: React.ReactNode
  onClick?: () => void
  danger?: boolean
}) {
  const clickable = !!onClick
  /* 注意：不可点击的行必须用 div——disabled 的 <button> 会吞掉子元素点击，
     里面的 Switch 开关将永远拨不动（踩过） */
  const Tag = (clickable ? 'button' : 'div') as 'button'
  return (
    <Tag
      onClick={onClick}
      disabled={!clickable}
      className={`w-full flex items-center gap-3.5 px-4 py-3.5 text-left ${clickable ? 'card-tap' : ''}`}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{
          background: danger ? 'var(--err-weak)' : 'var(--accent-weak)',
          color: danger ? 'var(--err)' : 'var(--accent)',
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium" style={{ color: danger ? 'var(--err)' : 'var(--text-1)' }}>
          {label}
        </div>
        {sub && <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{sub}</div>}
      </div>
      {right}
    </Tag>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      onClick={() => onChange(!checked)}
      className="tap relative inline-block flex-shrink-0"
      style={{
        width: 46,
        height: 28,
        borderRadius: 999,
        background: checked ? 'var(--accent)' : 'var(--hairline)',
        transition: 'background 0.2s ease',
      }}
      role="switch"
      aria-checked={checked}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 21 : 3,
          width: 22,
          height: 22,
          borderRadius: 999,
          background: '#FFFFFF', // 滑块固定白色，深浅色下都清晰
          boxShadow: '0 1px 4px rgba(27,30,35,0.28)',
          transition: 'left 0.22s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
    </span>
  )
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--field-bg)',
  border: '1px solid var(--line)',
  color: 'var(--text-1)',
}

/** 密码输入（带显示 / 隐藏） */
function PwdField({
  label, value, onChange, placeholder = '请输入密码',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full h-12 pl-4 pr-14 rounded-xl text-sm outline-none"
          style={fieldStyle}
        />
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          aria-label={show ? '隐藏密码' : '显示密码'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-xs tap"
          style={{ color: 'var(--text-3)' }}
        >
          {show ? '隐藏' : '显示'}
        </button>
      </div>
    </div>
  )
}

function TextField({
  label, value, onChange, placeholder, maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
}) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>{label}</label>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full h-12 px-4 rounded-xl text-sm outline-none"
        style={fieldStyle}
      />
    </div>
  )
}

/** 底部弹层容器：统一把手 / 圆角 / 滚动 */
function Sheet({ title, sub, onClose, children }: {
  title: string
  sub?: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative w-full max-w-[430px] rounded-t-3xl px-5 pt-5 pb-10 anim-sheet-in"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--line)',
          boxShadow: '0 -4px 24px rgba(27,30,35,0.16)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex justify-center mb-4">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
        </div>
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center tap"
            style={{ background: 'var(--field-bg)', border: '1px solid var(--line)' }}
          >
            <XIcon size={15} color="var(--text-2)" />
          </button>
        </div>
        {sub && <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>{sub}</p>}
        {children}
      </div>
    </div>
  )
}

/** 「忘记原密码 / 忘记账号」→ 提交密码重置申请（管理员后台生成工单） */
function ResetApplyBlock({ onApply }: { onApply: () => void }) {
  return (
    <div
      className="mt-4 rounded-2xl px-4 py-3.5 flex items-center gap-3"
      style={{ background: 'var(--field-bg)', border: '1px dashed var(--line-strong)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>忘记原密码 / 忘记登录账号？</div>
        <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
          提交申请由管理员重置，新密码会发到通知中心
        </div>
      </div>
      <button
        onClick={onApply}
        className="flex-shrink-0 h-9 px-3.5 rounded-xl text-xs font-semibold tap"
        style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
      >
        点击申请
      </button>
    </div>
  )
}

/* ── 主组件 ─────────────────────────────────────────────── */

export function SettingsScreen({ onBack, onLogout }: SettingsScreenProps) {
  const { profile, refresh } = useProfile()
  const identity = getIdentity()
  const isUser = identity === 'user'

  const displayName = profile?.nickname || profile?.account || '未登录'
  const displayAvatar = profile?.avatar || ''
  const account = profile?.account || ''
  const org = profile?.org || ''

  /* ── Toast ── */
  const [toast, setToast] = useState('')
  const timerRef = useRef<number | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setToast(''), 2400)
  }

  /* ── 外观：三种模式全部生效 ── */
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode())
  const pickTheme = (mode: ThemeMode) => {
    setThemeMode(mode)       // 写入 html[data-theme] 并持久化
    setThemeModeState(mode)
    showToast(mode === 'system' ? '已跟随系统外观' : mode === 'dark' ? '已切换深色模式' : '已切换浅色模式')
  }

  /* ── 通知开关（本地保存） ── */
  const [notifyStudy, setNotifyStudy] = useState(() => localStorage.getItem(NOTIFY_STUDY_KEY) !== '0')
  const [notifyReview, setNotifyReview] = useState(() => localStorage.getItem(NOTIFY_REVIEW_KEY) !== '0')
  const saveNotify = (key: string, v: boolean) => localStorage.setItem(key, v ? '1' : '0')

  /* ── 账号安全：改密码 / 改登录账号 ── */
  const [securityOpen, setSecurityOpen] = useState(false)
  /** 密码重置申请弹层（「点击申请」打开，由管理员在后台生成工单） */
  const [resetOpen, setResetOpen] = useState(false)
  const [securityTab, setSecurityTab] = useState<'password' | 'account'>('password')
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [newAccount, setNewAccount] = useState('')
  const [accountPwd, setAccountPwd] = useState('')
  const [secError, setSecError] = useState('')
  const [secSaving, setSecSaving] = useState(false)

  const openSecurity = () => {
    if (!isUser) {
      // 管理员登录时走管理后台改密码（authApi 也有 /auth/change-password，这里不重复做界面）
      showToast('管理员密码请在管理后台修改')
      return
    }
    setSecurityTab('password')
    setOldPwd(''); setNewPwd(''); setConfirmPwd('')
    setNewAccount(''); setAccountPwd('')
    setSecError('')
    setSecurityOpen(true)
  }

  const switchSecurityTab = (tab: 'password' | 'account') => {
    setSecurityTab(tab)
    setSecError('')
  }

  const submitPassword = async () => {
    if (secSaving) return
    if (!oldPwd) { setSecError('请输入当前密码'); return }
    if (newPwd.length < PASSWORD_MIN) { setSecError(`新密码至少 ${PASSWORD_MIN} 位`); return }
    if (newPwd !== confirmPwd) { setSecError('两次输入的新密码不一致'); return }
    setSecError('')
    setSecSaving(true)
    try {
      const res = await securityApi.changePassword(oldPwd, newPwd, confirmPwd)
      clearSession()          // 后端已吊销全部会话，本地一并清掉
      setSecurityOpen(false)
      showToast(res.message || '密码已修改，请重新登录')
      window.setTimeout(() => onLogout(), 900)
    } catch (err) {
      setSecError(err instanceof ApiError ? err.message : '修改失败，请稍后重试')
    } finally {
      setSecSaving(false)
    }
  }

  const submitAccount = async () => {
    if (secSaving) return
    const target = newAccount.trim()
    if (!/^[A-Za-z0-9_]{4,20}$/.test(target)) { setSecError('新账号需为 4-20 位字母 / 数字 / 下划线'); return }
    if (target === account) { setSecError('新账号与当前账号相同'); return }
    if (!accountPwd) { setSecError('请输入登录密码'); return }
    setSecError('')
    setSecSaving(true)
    try {
      await securityApi.changeAccount(target, accountPwd)
      patchSavedProfile({ account: target })  // 先更新本地缓存，避免界面还显示旧账号
      await refresh()                          // 再向后端拉一次最新资料
      setSecurityOpen(false)
      showToast('登录账号已修改')
    } catch (err) {
      setSecError(err instanceof ApiError ? err.message : '修改失败，请稍后重试')
    } finally {
      setSecSaving(false)
    }
  }

  /* ── 清除缓存 ── */
  const cacheInfo = useMemo(() => {
    let chars = 0
    let count = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || SESSION_KEYS.includes(key) || key === 'ndt_theme') continue
      chars += key.length + (localStorage.getItem(key)?.length || 0)
      count++
    }
    return { kb: Math.max(1, Math.round((chars * 2) / 1024)), count }
  }, [])
  const [clearOpen, setClearOpen] = useState(false)

  const doClearCache = () => {
    const doomed: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && !SESSION_KEYS.includes(key) && key !== 'ndt_theme') doomed.push(key)
    }
    doomed.forEach(key => localStorage.removeItem(key))
    setClearOpen(false)
    showToast('缓存已清除')
  }

  /* ── 检查更新 ── */
  const [updateOpen, setUpdateOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updateState, setUpdateState] = useState<
    | { kind: 'idle' }
    | { kind: 'latest' }
    | { kind: 'newer'; version: string; notes: string[]; url: string; publishedAt: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const checkUpdate = async () => {
    setChecking(true)
    try {
      const info = await appApi.version()
      if (hasUpdate(info.latest_version)) {
        setUpdateState({
          kind: 'newer',
          version: info.latest_version,
          notes: Array.isArray(info.notes) ? info.notes : [],
          url: info.download_url || '',
          publishedAt: info.published_at || '',
        })
      } else {
        setUpdateState({ kind: 'latest' })
      }
    } catch (err) {
      setUpdateState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : '检查更新失败，请稍后重试',
      })
    } finally {
      setChecking(false)
    }
  }

  const openUpdate = () => {
    setUpdateOpen(true)
    if (updateState.kind === 'idle') checkUpdate()
  }

  /* ── 退出登录 ── */
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const doLogout = async () => {
    setLoggingOut(true)
    try {
      await authApi.logout() // 通知后端吊销会话；失败也不阻断本地退出
    } catch {
      /* 忽略网络错误 */
    }
    clearSession()
    onLogout()
  }

  const themeOptions: Array<{ id: ThemeMode; label: string; desc: string }> = [
    { id: 'light', label: '浅色', desc: '始终使用浅色外观' },
    { id: 'dark', label: '深色', desc: '始终使用深色外观' },
    { id: 'system', label: '跟随系统', desc: '随系统深色 / 浅色自动切换' },
  ]

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
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>设置</h1>
      </div>

      {/* 账号 —— 只保留「账号安全」 */}
      <div className="px-4 mb-5">
        <p className="text-xs font-medium px-1 mb-2" style={{ color: 'var(--text-3)' }}>账号</p>
        <div className="card overflow-hidden">
          {/* 资料摘要（只读，编辑入口在「我的」页） */}
          <div className="flex items-center gap-3.5 px-4 py-3.5">
            <Avatar value={displayAvatar} name={displayName} size={40} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{displayName}</div>
              <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>
                {org ? `${account || '未登录'} · ${org}` : account || '未登录'}
              </div>
            </div>
            <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>
              {isUser ? '考生' : identity === 'admin' ? '管理员' : '—'}
            </span>
          </div>
          <div style={{ borderTop: '1px solid var(--line)' }}>
            <SettingsRow
              icon={<UserIcon size={18} />}
              label="账号安全"
              sub={isUser ? '修改登录密码、修改登录账号' : '管理员密码请在管理后台修改'}
              onClick={openSecurity}
              right={<ChevronRightIcon size={14} color="var(--text-3)" />}
            />
          </div>
        </div>
      </div>

      {/* 外观 */}
      <div className="px-4 mb-5">
        <p className="text-xs font-medium px-1 mb-2" style={{ color: 'var(--text-3)' }}>外观</p>
        <div className="card p-4">
          <div className="flex gap-2">
            {themeOptions.map(opt => {
              const active = themeMode === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => pickTheme(opt.id)}
                  title={opt.desc}
                  className="flex-1 h-10 rounded-xl text-xs font-semibold tap flex items-center justify-center gap-1"
                  style={{
                    background: active ? 'var(--accent-weak)' : 'var(--field-bg)',
                    border: active ? '1.5px solid var(--accent-border)' : '1px solid var(--line)',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                  }}
                >
                  {opt.label}
                  {active && <CheckIcon size={12} color="var(--accent)" strokeWidth={2.4} />}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] mt-2.5" style={{ color: 'var(--text-3)' }}>
            {themeOptions.find(t => t.id === themeMode)?.desc}，立即生效
          </p>
        </div>
      </div>

      {/* 通知 */}
      <div className="px-4 mb-5">
        <p className="text-xs font-medium px-1 mb-2" style={{ color: 'var(--text-3)' }}>通知</p>
        <div className="card overflow-hidden">
          <SettingsRow
            icon={<BellIcon size={18} />}
            label="学习提醒"
            sub="每日练习计划提醒"
            right={<Switch checked={notifyStudy} onChange={v => { setNotifyStudy(v); saveNotify(NOTIFY_STUDY_KEY, v) }} />}
          />
          <div style={{ borderTop: '1px solid var(--line)' }}>
            <SettingsRow
              icon={<BellIcon size={18} />}
              label="错题复习提醒"
              sub="有错题待复习时提醒"
              right={<Switch checked={notifyReview} onChange={v => { setNotifyReview(v); saveNotify(NOTIFY_REVIEW_KEY, v) }} />}
            />
          </div>
          <p className="text-[10px] px-4 pb-3" style={{ color: 'var(--text-3)' }}>
            开关控制首页顶部的提醒条；管理员发来的新通知会实时弹出提示，不受此开关影响
          </p>
        </div>
      </div>

      {/* 通用 */}
      <div className="px-4 mb-8">
        <p className="text-xs font-medium px-1 mb-2" style={{ color: 'var(--text-3)' }}>通用</p>
        <div className="card overflow-hidden">
          <SettingsRow
            icon={<TrashIcon size={18} />}
            label="清除缓存"
            sub={`约占 ${cacheInfo.kb} KB · ${cacheInfo.count} 项本地数据`}
            onClick={() => setClearOpen(true)}
            right={<ChevronRightIcon size={14} color="var(--text-3)" />}
          />
          <div style={{ borderTop: '1px solid var(--line)' }}>
            <SettingsRow
              icon={<RefreshIcon size={18} />}
              label="检查更新"
              sub="查看是否有新版本可用"
              onClick={openUpdate}
              right={
                <span className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>v{APP_VERSION}</span>
                  <ChevronRightIcon size={14} color="var(--text-3)" />
                </span>
              }
            />
          </div>
          <div style={{ borderTop: '1px solid var(--line)' }}>
            <SettingsRow
              icon={<LogoutIcon size={18} />}
              label="退出登录"
              sub="退出后需重新登录才能继续刷题"
              danger
              onClick={() => setLogoutOpen(true)}
              right={<ChevronRightIcon size={14} color="var(--text-3)" />}
            />
          </div>
        </div>
      </div>

      <div className="text-center pb-10">
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>NDT-劳人 v{APP_VERSION}</p>
      </div>

      {/* ── 账号安全弹层 ── */}
      {securityOpen && (
        <Sheet
          title="账号安全"
          sub={`当前登录账号：${account || '—'} · ${ACCOUNT_HINT}`}
          onClose={() => !secSaving && setSecurityOpen(false)}
        >
          <div className="flex rounded-xl p-1 mb-5" style={{ background: 'var(--field-bg)' }}>
            {([
              { id: 'password', label: '修改密码' },
              { id: 'account', label: '修改登录账号' },
            ] as Array<{ id: 'password' | 'account'; label: string }>).map(t => {
              const active = securityTab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => switchSecurityTab(t.id)}
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

          {securityTab === 'password' ? (
            <>
              <PwdField label="当前密码" value={oldPwd} onChange={setOldPwd} placeholder="请输入当前登录密码" />
              <PwdField label="新密码" value={newPwd} onChange={setNewPwd} placeholder={`至少 ${PASSWORD_MIN} 位`} />
              <PwdField label="确认新密码" value={confirmPwd} onChange={setConfirmPwd} placeholder="再次输入新密码" />
              {secError && <p className="text-xs mb-3" style={{ color: 'var(--err)' }}>{secError}</p>}
              <button
                onClick={submitPassword}
                disabled={secSaving}
                className="w-full h-12 gb gb-primary rounded-2xl text-sm font-semibold mt-1"
              >
                {secSaving ? '提交中…' : '确认修改密码'}
              </button>
              <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                修改成功后需要用新密码重新登录。
              </p>
              <ResetApplyBlock onApply={() => setResetOpen(true)} />
            </>
          ) : (
            <>
              <TextField
                label="新的登录账号"
                value={newAccount}
                onChange={setNewAccount}
                placeholder="4-20 位字母 / 数字 / 下划线"
                maxLength={20}
              />
              <PwdField label="登录密码" value={accountPwd} onChange={setAccountPwd} placeholder="用于确认身份" />
              {secError && <p className="text-xs mb-3" style={{ color: 'var(--err)' }}>{secError}</p>}
              <button
                onClick={submitAccount}
                disabled={secSaving}
                className="w-full h-12 gb gb-primary rounded-2xl text-sm font-semibold mt-1"
              >
                {secSaving ? '提交中…' : '确认修改账号'}
              </button>
              <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                修改后请用新账号登录，单位学校与学习记录都会保留。
              </p>
              <ResetApplyBlock onApply={() => setResetOpen(true)} />
            </>
          )}
        </Sheet>
      )}

      {/* ── 密码重置申请弹层（z-[80]，盖在账号安全弹层之上） ── */}
      <PasswordResetSheet
        open={resetOpen}
        defaultAccount={account}
        onClose={() => setResetOpen(false)}
      />

      {/* ── 检查更新弹层 ── */}
      {updateOpen && (
        <Sheet
          title="软件更新"
          sub={`当前版本 v${APP_VERSION}`}
          onClose={() => !checking && setUpdateOpen(false)}
        >
          <div className="rounded-2xl px-4 py-4 mb-4" style={{ background: 'var(--field-bg)', border: '1px solid var(--line)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>NDT-劳人刷题</span>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>v{APP_VERSION}</span>
            </div>
            <div className="text-[11px] mt-1.5" style={{ color: 'var(--text-3)' }}>
              {checking && '正在检查更新…'}
              {!checking && updateState.kind === 'idle' && '点击下方按钮检查是否有新版本'}
              {!checking && updateState.kind === 'latest' && '已是最新版本'}
              {!checking && updateState.kind === 'newer' && `发现新版本 v${updateState.version}`}
              {!checking && updateState.kind === 'error' && updateState.message}
            </div>
          </div>

          {updateState.kind === 'newer' && (
            <div className="mb-4">
              <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>
                更新内容{updateState.publishedAt ? ` · ${updateState.publishedAt}` : ''}
              </p>
              <ul className="space-y-1.5">
                {(updateState.notes.length ? updateState.notes : ['本次更新暂无说明']).map((n, i) => (
                  <li key={i} className="text-[11px] leading-relaxed flex gap-2" style={{ color: 'var(--text-2)' }}>
                    <span style={{ color: 'var(--accent)' }}>•</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
              {updateState.url ? (
                <a
                  href={updateState.url}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full h-12 gb gb-primary rounded-2xl text-sm font-semibold mt-4 flex items-center justify-center"
                >
                  前往更新
                </a>
              ) : (
                <p className="text-[11px] mt-3" style={{ color: 'var(--text-3)' }}>
                  暂无下载地址，请联系管理员获取新版安装包
                </p>
              )}
            </div>
          )}

          <button
            onClick={checkUpdate}
            disabled={checking}
            className="w-full h-12 gb gb-ghost rounded-2xl text-sm font-semibold"
          >
            {checking ? '检查中…' : '检查更新'}
          </button>
          <p className="text-[11px] mt-3 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            版本信息来自服务端 data/version.json，发新版时改那里即可。
          </p>
        </Sheet>
      )}

      {/* ── 清除缓存确认弹层 ── */}
      {clearOpen && (
        <Sheet title="清除本地缓存？" onClose={() => setClearOpen(false)}>
          <p className="text-xs mb-6" style={{ color: 'var(--text-3)' }}>
            将清除约 {cacheInfo.kb} KB 临时数据，登录状态与账号资料不受影响
          </p>
          <div className="flex gap-3">
            <button onClick={() => setClearOpen(false)} className="flex-1 h-12 gb gb-ghost rounded-2xl text-sm font-semibold">
              取消
            </button>
            <button onClick={doClearCache} className="flex-1 h-12 gb gb-primary rounded-2xl text-sm font-semibold">
              清除
            </button>
          </div>
        </Sheet>
      )}

      {/* ── 退出登录确认弹层 ── */}
      {logoutOpen && (
        <Sheet title="退出登录？" onClose={() => !loggingOut && setLogoutOpen(false)}>
          <p className="text-xs mb-6" style={{ color: 'var(--text-3)' }}>
            退出后需要重新输入账号密码才能继续刷题
          </p>
          <div className="flex gap-3">
            <button onClick={() => setLogoutOpen(false)} disabled={loggingOut} className="flex-1 h-12 gb gb-ghost rounded-2xl text-sm font-semibold">
              取消
            </button>
            <button onClick={doLogout} disabled={loggingOut} className="flex-1 h-12 gb gb-danger rounded-2xl text-sm font-semibold">
              {loggingOut ? '退出中…' : '退出登录'}
            </button>
          </div>
        </Sheet>
      )}

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
