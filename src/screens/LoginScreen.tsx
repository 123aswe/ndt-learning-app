import React, { useEffect, useRef, useState } from 'react'

/* ============================================================
   登录 / 注册页（iOS 极简 × Material Design 3）
   - 职责：引导页之后展示，登录成功后回调 onSuccess 进入主界面
   - 双模式：验证码登录（手机号+动态验证码）/ 账号登录（账号+密码）
   - 演示账号：admin / admin123（阶段一为 Mock 校验，阶段二再抽成正式逻辑）
   - 修改注意：只改本文件；设计规范见 .modular/ui-brief.md 与本页顶部注释
   ============================================================ */

interface LoginScreenProps {
  onSuccess: () => void
}

type LoginMode = 'code' | 'password'

/* ── 品牌 Logo（与引导页一致的 N 字标，薄荷绿圆角方块 + 微发光） ── */
function BrandLogo() {
  return (
    <div
      className="flex h-16 w-16 items-center justify-center rounded-[20px]"
      style={{
        background: 'linear-gradient(135deg, #6EE7B7 0%, #2DD4BF 100%)',
        boxShadow: '0 10px 30px rgba(16, 185, 129, 0.32), inset 0 1px 0 rgba(255,255,255,0.55)',
      }}
    >
      <svg width="34" height="34" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <text x="2" y="26" fontFamily="'Inter', sans-serif" fontSize="18" fontWeight="800" fill="#fff">N</text>
        <path d="M24,10 L24,26 L28,16 L32,24 L36,14 L36,30" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.9" />
      </svg>
    </div>
  )
}

/* ── 快捷登录图标（微信 / Apple，本地内联，不污染共享图标库） ── */
function WeChatIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.5 4C5.9 4 3 6.6 3 9.9c0 1.9 1 3.5 2.5 4.6l-.7 2.2 2.2-1.2c.5.2 1 .3 1.6.3.3 0 .6 0 .9-.1-.1-.5-.1-1-.1-1.5 0-3.4 3.1-6.1 6.9-6.1h.4C14.9 5.8 12.4 4 9.5 4z" />
      <path d="M7 7.6c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9zm5 0c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9z" />
      <path d="M21 14.2c0-2.8-2.6-5-5.8-5s-5.8 2.2-5.8 5 2.6 5 5.8 5c.7 0 1.4-.1 2-.4l1.8 1-.6-1.7c1.6-.9 2.6-2.2 2.6-3.9z" />
      <path d="M13.5 13.5c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9zm3.4 0c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9z" />
    </svg>
  )
}

function AppleIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.4 12.9c0-2 1.6-3 1.7-3.1-.9-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.6-.7c-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2.1 2.5 2.1s1.4-.6 2.6-.6 1.6.6 2.6.6 1.8-1 2.4-2c.8-1.1 1.1-2.2 1.1-2.2s-2-.8-2.1-3.2z" />
      <path d="M14.4 6.7c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.7-.9 2.7 1 .1 1.9-.5 2.5-1.3z" />
    </svg>
  )
}

/* ── M3 风格输入框：柔和浅色底 + 获焦双色边框（emerald 边框 + 浅色光晕） ── */
const inputClass =
  'h-12 w-full rounded-xl border border-transparent bg-slate-100/80 px-4 text-sm text-slate-800 ' +
  'placeholder:text-slate-400 outline-none transition-all duration-200 ' +
  'focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100/70'

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<LoginMode>('password') // 默认账号登录，便于直接用演示账号
  /* 验证码登录字段 */
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)
  /* 账号登录字段 */
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  /* 通用状态 */
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | null>(null)

  /* 验证码倒计时 */
  useEffect(() => {
    if (countdown <= 0) return
    const t = window.setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => window.clearTimeout(t)
  }, [countdown])

  /* Toast 自动消失 */
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2400)
  }

  /* 发送验证码（Mock：任何合法手机号都返回 123456） */
  const handleSendCode = () => {
    if (!/^1\d{10}$/.test(phone)) {
      setError('请输入正确的手机号')
      return
    }
    setError('')
    setCountdown(60)
    showToast('验证码已发送（演示验证码：123456）')
  }

  /* 登录 / 注册二合一提交（阶段一 Mock 校验） */
  const handleSubmit = () => {
    if (loading) return
    if (!agreed) {
      setError('请先阅读并同意《服务协议》和《隐私政策》')
      return
    }
    setError('')
    setLoading(true)

    /* 模拟 600ms 请求 */
    window.setTimeout(() => {
      let ok = false
      if (mode === 'password') {
        ok = account.trim() === 'admin' && password === 'admin123'
        if (!ok) setError('账号或密码错误（演示账号：admin / admin123）')
      } else {
        if (!/^1\d{10}$/.test(phone)) {
          setError('请输入正确的手机号')
        } else if (code !== '123456') {
          setError('验证码错误')
        } else {
          ok = true
        }
      }
      setLoading(false)
      if (ok) {
        showToast('登录成功，正在进入…')
        window.setTimeout(onSuccess, 600)
      }
    }, 600)
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden bg-gradient-to-b from-slate-50 via-slate-50 to-slate-100 backdrop-blur-md px-6 pb-10 pt-14">
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

      {/* 登录卡片（毛玻璃） */}
      <div className="anim-slide-up d-150 mt-8 w-full rounded-3xl border border-white/70 bg-white/70 p-6 shadow-xl shadow-slate-200/60 backdrop-blur-md">
        {/* 模式切换：验证码登录 / 账号登录 */}
        <div className="mb-5 flex rounded-full bg-slate-100/90 p-1">
          {([
            { id: 'code', label: '验证码登录' },
            { id: 'password', label: '账号登录' },
          ] as Array<{ id: LoginMode; label: string }>).map(item => (
            <button
              key={item.id}
              onClick={() => {
                setMode(item.id)
                setError('')
              }}
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
          {mode === 'code' ? (
            <>
              {/* 手机号 + 获取验证码 */}
              <div className="flex items-center gap-2">
                <input
                  className={inputClass}
                  type="tel"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="请输入手机号"
                  value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g, ''))}
                />
                <button
                  onClick={handleSendCode}
                  disabled={countdown > 0}
                  className={`h-12 w-[118px] shrink-0 rounded-xl text-sm font-medium transition-all duration-200 tap ${
                    countdown > 0
                      ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                      : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                  }`}
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                </button>
              </div>
              {/* 验证码 */}
              <input
                className={inputClass}
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="请输入验证码"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </>
          ) : (
            <>
              <input
                className={inputClass}
                type="text"
                placeholder="请输入账号"
                value={account}
                onChange={e => setAccount(e.target.value)}
              />
              <input
                className={inputClass}
                type="password"
                placeholder="请输入密码"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSubmit()
                }}
              />
              <p className="px-1 text-xs text-slate-400">演示账号：admin　密码：admin123</p>
            </>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <p className="mt-3 px-1 text-xs font-medium text-rose-500">{error}</p>
        )}

        {/* 登录 / 注册二合一主按钮：渐变青绿，hover 降透明度 */}
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
              登录中…
            </>
          ) : (
            '登录 / 注册'
          )}
        </button>

        {/* 快捷登录 */}
        <div className="mt-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400">其他登录方式</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => showToast('演示环境暂未接入微信登录')}
            className="tap flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50"
          >
            <span className="text-[#07C160]"><WeChatIcon size={20} /></span>
            微信登录
          </button>
          <button
            onClick={() => showToast('演示环境暂未接入 Apple 登录')}
            className="tap flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50"
          >
            <span className="text-slate-900"><AppleIcon size={20} /></span>
            Apple 登录
          </button>
        </div>

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
            登录即代表您已同意
            <button
              type="button"
              className="px-0.5 text-emerald-600"
              onClick={() => showToast('《服务协议》即将上线')}
            >《服务协议》</button>
            和
            <button
              type="button"
              className="px-0.5 text-emerald-600"
              onClick={() => showToast('《隐私政策》即将上线')}
            >《隐私政策》</button>
          </span>
        </label>
      </div>

      {/* 底部 Toast */}
      {toast && (
        <div className="anim-scale-in fixed bottom-14 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-sm">
          {toast}
        </div>
      )}
    </div>
  )
}
