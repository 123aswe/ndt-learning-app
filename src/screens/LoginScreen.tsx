import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BrandIcon } from '../components/BrandIcon'
import { PasswordResetSheet } from '../components/PasswordResetSheet'
import { authApi, saveSession, ApiError } from '../api/client'
import type { LegalKey } from '../data/legal'

/* ============================================================
   登录 / 注册页（iOS 极简 × Material Design 3）
   - 职责：引导页之后展示，登录成功后回调 onSuccess 进入主界面
   - 双模式：
       · 账号登录（账号 + 密码）→ POST /auth/password/login
       · 注册（提交申请，需管理员审核）→ GET /auth/captcha + POST /auth/register
   - 注册不即时生效：提交后进入管理后台「注册申请」待审，管理员通过后才能登录
   - 图形验证码用于注册页人机校验（短信验证码已下线）
   - 修改注意：只改本文件；设计规范见根目录 FRONTEND.md §10 / §11
   ============================================================ */

interface LoginScreenProps {
  onSuccess: () => void
  /** 打开《服务协议》/《隐私政策》页面 */
  onOpenLegal: (docKey: LegalKey) => void
}

type AuthMode = 'login' | 'register'

/** 账号规则：与后端 security / registrations.ACCOUNT_PATTERN 保持一致 */
const ACCOUNT_PATTERN = /^[A-Za-z0-9_]{4,20}$/

/* ── 品牌 Logo（官方 App 图标原图 + 薄荷绿微发光，与引导页一致） ── */
function BrandLogo() {
  return (
    <div
      className="flex h-16 items-center justify-center rounded-[20px]"
      style={{ boxShadow: '0 10px 30px rgba(16, 185, 129, 0.25)' }}
    >
      <BrandIcon size={64} />
    </div>
  )
}

/* ── 图标（本地内联，不污染共享图标库） ── */
function EyeIcon({ open = true, size = 18 }: { open?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {open ? (
        <>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M4 4l16 16" />
          <path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.4 4.1" />
          <path d="M6.3 7.8A16.8 16.8 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.2-.2 3.1-.6" />
        </>
      )}
    </svg>
  )
}

/* ── M3 风格输入框：柔和浅色底 + 获焦双色边框 ── */
const inputClass =
  'h-12 w-full rounded-xl border border-transparent bg-slate-100/80 px-4 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 outline-none transition-all duration-200 ' +
  'focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100/70'

/** 带「显示/隐藏」的眼睛按钮的密码输入 */
function PasswordInput({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onEnter?: () => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        className={inputClass + ' pr-11'}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onEnter?.()
        }}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        aria-label={show ? '隐藏密码' : '显示密码'}
        className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:text-slate-600"
      >
        <EyeIcon open={show} />
      </button>
    </div>
  )
}

export function LoginScreen({ onSuccess, onOpenLegal }: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login') // 默认账号登录，便于直接用后台账号验证

  /* 账号登录字段 */
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')

  /* 注册字段 */
  const [regAccount, setRegAccount] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirm, setRegConfirm] = useState('')
  const [regOrg, setRegOrg] = useState('')
  const [captchaCode, setCaptchaCode] = useState('')
  const [captchaId, setCaptchaId] = useState('')
  const [captchaImage, setCaptchaImage] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)

  /* 通用状态 */
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  /** 密码重置申请弹层（忘记密码 / 忘记账号，提交后由管理员处理） */
  const [resetOpen, setResetOpen] = useState(false)
  const toastTimer = useRef<number | null>(null)
  const aliveRef = useRef(true)

  /* Toast 自动消失 */
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2600)
  }, [])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  /* 图形验证码：拉一张新的（切到注册页、或点击图片刷新时调用） */
  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true)
    try {
      const data = await authApi.captcha()
      if (!aliveRef.current) return
      setCaptchaId(data.captcha_id)
      setCaptchaImage(data.image)
      setCaptchaCode('')
    } catch (err) {
      if (!aliveRef.current) return
      setCaptchaImage('')
      const message = err instanceof ApiError ? err.message : '图形验证码加载失败'
      setError(message)
    } finally {
      if (aliveRef.current) setCaptchaLoading(false)
    }
  }, [])

  /* 切到注册页时自动加载一张验证码 */
  useEffect(() => {
    if (mode === 'register' && !captchaImage) refreshCaptcha()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setError('')
    setInfo('')
  }

  /* 登录提交 */
  const handleLogin = async () => {
    if (loading) return
    if (!agreed) {
      setError('请先阅读并同意《服务协议》和《隐私政策》')
      return
    }
    const name = account.trim()
    if (!name || !password) {
      setError('请输入账号和密码')
      return
    }
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const result = await authApi.passwordLogin(name, password)
      saveSession(
        result.token,
        result.identity,
        (result.identity === 'admin' ? result.admin : result.user) || {},
      )
      showToast('登录成功，正在进入…')
      window.setTimeout(onSuccess, 600)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '登录失败，请稍后重试'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  /* 注册提交：只提交申请，等管理员审核 */
  const handleRegister = async () => {
    if (loading) return
    if (!agreed) {
      setError('请先阅读并同意《服务协议》和《隐私政策》')
      return
    }
    if (!ACCOUNT_PATTERN.test(regAccount.trim())) {
      setError('账号需为 4-20 位字母 / 数字 / 下划线')
      return
    }
    if (regPassword.length < 6) {
      setError('密码至少 6 位')
      return
    }
    if (regPassword !== regConfirm) {
      setError('两次输入的密码不一致')
      return
    }
    if (!regOrg.trim()) {
      setError('请填写单位 / 学校')
      return
    }
    if (!captchaCode.trim()) {
      setError('请输入图形验证码')
      return
    }

    setError('')
    setInfo('')
    setLoading(true)
    try {
      const result = await authApi.register({
        account: regAccount.trim(),
        password: regPassword,
        confirm_password: regConfirm,
        org: regOrg.trim(),
        captcha_id: captchaId,
        captcha_code: captchaCode.trim(),
      })
      // 注册成功 ≠ 可登录：提示等待审核，并切回登录页
      setInfo(result.message || '注册申请已提交，请等待管理员审核通过后再登录')
      showToast('注册申请已提交，等待管理员审核')
      setRegAccount('')
      setRegPassword('')
      setRegConfirm('')
      setRegOrg('')
      setCaptchaCode('')
      setCaptchaImage('')
      setMode('login')
      setAccount(regAccount.trim())
    } catch (err) {
      const message = err instanceof ApiError ? err.message : '注册申请提交失败，请稍后重试'
      setError(message)
      // 验证码一次性：失败后刷新一张，避免用户反复用同一张
      refreshCaptcha()
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = mode === 'login' ? handleLogin : handleRegister

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden px-6 pb-10 pt-14">
      {/* 背景由 body 提供（主题感渐变），此处保持透明以适配深色模式 */}
      {/* 品牌 Header */}
      <div className="anim-slide-up flex flex-col items-center text-center">
        <BrandLogo />
        <h1 className="mt-4 text-[26px] font-extrabold tracking-tight text-slate-800">NDT-劳人</h1>
        <p className="mt-1 text-sm text-slate-400">无损检测学习与考试训练平台</p>
      </div>

      {/* Slogan */}
      <p
        className="anim-slide-up d-100 mt-7 text-[22px] font-bold text-slate-800"
        style={{ letterSpacing: '0.05em' }}
      >
        让每一道题，都变成你的能力。
      </p>

      {/* 卡片（毛玻璃） */}
      <div className="anim-slide-up d-150 mt-8 w-full rounded-3xl border border-white/70 bg-white/70 p-6 shadow-xl shadow-slate-200/60 backdrop-blur-md">
        {/* 模式切换：账号登录 / 注册 */}
        <div className="mb-5 flex rounded-full bg-slate-100/90 p-1">
          {([
            { id: 'login', label: '账号登录' },
            { id: 'register', label: '注册' },
          ] as Array<{ id: AuthMode; label: string }>).map(item => (
            <button
              key={item.id}
              onClick={() => switchMode(item.id)}
              className={`h-9 flex-1 rounded-full text-sm font-medium transition-all duration-200 tap ${
                mode === item.id
                  ? 'bg-white text-emerald-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* 表单区 */}
        <div className="space-y-3">
          {mode === 'login' ? (
            <>
              <input
                className={inputClass}
                type="text"
                placeholder="请输入账号"
                value={account}
                onChange={e => setAccount(e.target.value)}
              />
              <PasswordInput
                value={password}
                onChange={setPassword}
                placeholder="请输入密码"
                onEnter={handleLogin}
              />
              {/* 忘记密码 / 忘记账号：提交重置申请给管理员 */}
              <button
                type="button"
                onClick={() => setResetOpen(true)}
                className="tap w-full px-1 text-left text-xs font-medium text-emerald-600"
              >
                忘记密码 / 忘记账号？点击提交重置申请
              </button>
            </>
          ) : (
            <>
              <input
                className={inputClass}
                type="text"
                placeholder="设置登录账号（4-20 位字母 / 数字 / 下划线）"
                value={regAccount}
                onChange={e => setRegAccount(e.target.value)}
              />
              <PasswordInput value={regPassword} onChange={setRegPassword} placeholder="设置密码（至少 6 位）" />
              <PasswordInput
                value={regConfirm}
                onChange={setRegConfirm}
                placeholder="确认密码"
              />
              <input
                className={inputClass}
                type="text"
                placeholder="单位 / 学校"
                value={regOrg}
                onChange={e => setRegOrg(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRegister()
                }}
              />

              {/* 图形验证码 */}
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  type="text"
                  maxLength={6}
                  placeholder="请输入图形验证码"
                  value={captchaCode}
                  onChange={e => setCaptchaCode(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRegister()
                  }}
                />
                <button
                  type="button"
                  onClick={refreshCaptcha}
                  title="点击刷新验证码"
                  className="flex h-12 w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition-colors hover:border-emerald-300"
                >
                  {captchaImage ? (
                    <img src={captchaImage} alt="图形验证码" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-slate-400">
                      {captchaLoading ? '加载中…' : '点击获取'}
                    </span>
                  )}
                </button>
              </div>

              <p className="px-1 text-xs leading-relaxed text-slate-400">
                提交后需管理员审核通过，才能使用该账号登录。
              </p>
            </>
          )}
        </div>

        {/* 错误 / 成功提示 */}
        {error && <p className="mt-3 px-1 text-xs font-medium text-rose-500">{error}</p>}
        {info && !error && (
          <p className="mt-3 px-1 text-xs font-medium leading-relaxed text-emerald-600">{info}</p>
        )}

        {/* 主按钮：登录 / 提交注册申请 */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="tap mt-4 flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-500 text-sm font-semibold tracking-wide text-white shadow-lg shadow-emerald-200/60 transition-all duration-200 hover:opacity-90 disabled:opacity-60"
        >
          {loading ? (
            <>
              <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {mode === 'login' ? '登录中…' : '提交中…'}
            </>
          ) : mode === 'login' ? (
            '登录'
          ) : (
            '提交注册申请'
          )}
        </button>

        {/* 隐私协议勾选 */}
        <label className="mt-5 flex cursor-pointer items-start gap-2 select-none">
          <button
            type="button"
            onClick={() => setAgreed(a => !a)}
            aria-checked={agreed}
            role="checkbox"
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-200 ${
              agreed ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white'
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M4.5 12.5l5 5 10-11" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span className="text-xs leading-relaxed text-slate-400">
            我已阅读并同意
            <button
              type="button"
              className="px-0.5 text-emerald-600"
              onClick={() => onOpenLegal('terms')}
            >《服务协议》</button>
            和
            <button
              type="button"
              className="px-0.5 text-emerald-600"
              onClick={() => onOpenLegal('privacy')}
            >《隐私政策》</button>
          </span>
        </label>
      </div>

      {/* 密码重置申请弹层（忘记密码 / 忘记账号 → 管理员处理） */}
      <PasswordResetSheet
        open={resetOpen}
        defaultAccount={account}
        onClose={() => setResetOpen(false)}
      />

      {/* 底部 Toast */}
      {toast && (
        <div className="anim-scale-in fixed bottom-14 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
          {toast}
        </div>
      )}
    </div>
  )
}
