import React, { useEffect, useState } from 'react'
import { CheckCircleIcon, InfoIcon, XIcon } from './icons'
import { resetApi, ApiError } from '../api/client'

/* ============================================================
   申请重置密码 · 底部弹层（组件，登录页与设置页共用）
   - 场景：考生忘记原密码 / 忘记登录账号时，提交「账号 + 邮箱」申请
   - 流程：提交 → 管理员后台「密码重置」工单 → 处理后将新密码发到 App 通知中心
   - 接口：POST /api/auth/password-reset（公开，无需登录）
     同一账号重复提交会「覆盖上一条待处理申请」，不会堆积（与下方提示文案一致）
   - 修改注意：
     - 本弹层 z-[80]，高于设置页的弹层（z-[60]）与 Toast（z-[70]）
     - 账号规则与 LoginScreen / 后端 registrations.py 一致：4-20 位字母数字下划线
     - 邮箱规则与后端 password_resets.py 的 EMAIL_PATTERN 一致
   ============================================================ */

const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{4,20}$/
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const EMAIL_MAX = 100

interface PasswordResetSheetProps {
  /** 是否显示 */
  open: boolean
  /** 预填账号（考生在设置页里已知自己的账号，登录页则为空） */
  defaultAccount?: string
  onClose: () => void
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--field-bg)',
  border: '1px solid var(--line)',
  color: 'var(--text-1)',
}

export function PasswordResetSheet({ open, defaultAccount = '', onClose }: PasswordResetSheetProps) {
  const [account, setAccount] = useState(defaultAccount)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /** 提交成功后的结果页（显示「申请已提交」说明） */
  const [done, setDone] = useState(false)
  /** 后端返回的提示（区分「新提交」和「已更新原有申请」） */
  const [doneMessage, setDoneMessage] = useState('')

  // 每次打开都重置表单，避免上次的内容残留
  useEffect(() => {
    if (!open) return
    setAccount(defaultAccount)
    setEmail('')
    setError('')
    setDone(false)
    setDoneMessage('')
    setSubmitting(false)
  }, [open, defaultAccount])

  if (!open) return null

  const submit = async () => {
    if (submitting) return
    const acc = account.trim()
    const mail = email.trim()
    if (!ACCOUNT_PATTERN.test(acc)) { setError('请输入 4-20 位字母 / 数字 / 下划线的登录账号'); return }
    if (!mail) { setError('请填写邮箱，便于管理员核对身份'); return }
    if (!EMAIL_PATTERN.test(mail)) { setError('邮箱格式不正确，请检查后重新输入'); return }
    if (mail.length > EMAIL_MAX) { setError(`邮箱不超过 ${EMAIL_MAX} 个字符`); return }

    setError('')
    setSubmitting(true)
    try {
      const res = await resetApi.apply(acc, mail)
      setDoneMessage(res.message || '')
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && onClose()} />
      <div
        className="relative w-full max-w-[430px] rounded-t-3xl px-5 pt-5 pb-10 anim-sheet-in"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--line)',
          boxShadow: '0 -4px 24px rgba(27,30,35,0.20)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex justify-center mb-4">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
        </div>

        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>
            {done ? '申请已提交' : '申请重置密码'}
          </h3>
          <button
            onClick={() => !submitting && onClose()}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center tap"
            style={{ background: 'var(--field-bg)', border: '1px solid var(--line)' }}
          >
            <XIcon size={15} color="var(--text-2)" />
          </button>
        </div>

        {done ? (
          /* ── 提交成功：说明后续流程 ── */
          <>
            <div className="flex flex-col items-center py-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                style={{ background: 'var(--ok-weak)', color: 'var(--ok)' }}
              >
                <CheckCircleIcon size={28} />
              </div>
              <p className="text-sm font-medium text-center" style={{ color: 'var(--text-1)' }}>
                管理员已收到你的重置申请
              </p>
              <p className="text-[11px] mt-1.5 text-center leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {doneMessage || '处理完成后，新密码会通过通知中心发送给你'}
                <br />请留意首页右上角的铃铛
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full h-12 gb gb-primary rounded-2xl text-sm font-semibold mt-2"
            >
              知道了
            </button>
          </>
        ) : (
          /* ── 申请表单：账号 + 邮箱 ── */
          <>
            <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>
              提交后由管理员核对身份并重置密码，无需原密码
            </p>

            <div className="mb-4">
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>登录账号</label>
              <input
                type="text"
                value={account}
                maxLength={20}
                autoComplete="off"
                onChange={e => setAccount(e.target.value)}
                placeholder="请输入需要重置的账号"
                className="w-full h-12 px-4 rounded-xl text-sm outline-none"
                style={fieldStyle}
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>邮箱</label>
              <input
                type="email"
                value={email}
                maxLength={EMAIL_MAX}
                autoComplete="email"
                inputMode="email"
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit() }}
                placeholder="用于管理员核对身份，例如 name@example.com"
                className="w-full h-12 px-4 rounded-xl text-sm outline-none"
                style={fieldStyle}
              />
            </div>

            {error && <p className="text-xs mb-3" style={{ color: 'var(--err)' }}>{error}</p>}

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full h-12 gb gb-primary rounded-2xl text-sm font-semibold mt-1"
            >
              {submitting ? '提交中…' : '提交申请'}
            </button>

            <div
              className="flex items-start gap-2 mt-4 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--field-bg)', border: '1px solid var(--line)' }}
            >
              <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--text-3)' }}><InfoIcon size={14} /></span>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
                同一个账号重复提交会覆盖上一条待处理申请；管理员处理后你会收到一条系统通知。
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
