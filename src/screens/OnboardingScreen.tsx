import React, { useState } from 'react'
import { ClipboardIcon, StarIcon, ZapIcon, AwardIcon, BookIcon, WrenchIcon, CheckIcon } from '../components/icons'
import type { NDTMethod } from '../types'

/* ============================================================
   引导页（Onboarding）· 重构版
   - 职责：3 步引导（logo 介绍 / 选检测方向 / 选学习目标），完成后回调 onComplete
   - 配色规范（本页专用，不改全局令牌）：
       背景 #F6F4EE 奶油米白 / 品牌 #3BB4A2 薄荷青 / 主字 slate-900 / 次字 slate-500
   - 布局：内容垂直居中、底部 CTA 胶囊主按钮 + 跳过，移动端比例下无需滚动即可点击
   - 修改注意：只改本文件；步骤逻辑（selectedMethods / selectedGoal）保持原样
   ============================================================ */

interface OnboardingScreenProps {
  onComplete: (selectedMethods: NDTMethod[], goal: string) => void
}

/* 品牌 Logo：青绿圆角矩形 + 内嵌白色 NDT 字母 + 同色弥散发光 */
function BrandLogo() {
  return (
    <div
      className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-[#3BB4A2]"
      style={{ boxShadow: '0 12px 28px rgba(59,180,162,0.38), inset 0 1px 0 rgba(255,255,255,0.45)' }}
    >
      <svg width="40" height="40" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <text x="22" y="29" textAnchor="middle" fontFamily="'Inter', sans-serif" fontSize="15" fontWeight="800" fill="#fff">
          NDT
        </text>
      </svg>
    </div>
  )
}

/* 胶囊主按钮：品牌青绿底 + 白字 + 同色弥散阴影（全页通用，含禁用态） */
function CtaButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="tap flex h-[52px] w-full items-center justify-center rounded-full bg-[#3BB4A2] text-base font-semibold text-white shadow-lg shadow-[#3BB4A2]/30 transition-all duration-200 hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
    >
      {label}
    </button>
  )
}

/* 顶部步骤指示点（第 1/2 步时显示） */
function StepDots({ active }: { active: number }) {
  return (
    <div className="flex justify-center gap-2">
      {[0, 1].map(i => (
        <div
          key={i}
          className="h-1 rounded-full transition-all duration-300"
          style={{ width: i === active ? 24 : 8, background: i === active ? '#3BB4A2' : '#E0DDD4' }}
        />
      ))}
    </div>
  )
}

const methods: Array<{ id: NDTMethod; name: string; full: string; desc: string }> = [
  { id: 'UT', name: 'UT', full: '超声波检测', desc: '声波探伤、厚度测量' },
  { id: 'RT', name: 'RT', full: '射线检测', desc: 'X射线 / γ射线透照' },
  { id: 'MT', name: 'MT', full: '磁粉检测', desc: '铁磁性材料表面缺陷' },
  { id: 'PT', name: 'PT', full: '渗透检测', desc: '毛细渗透表面开口缺陷' },
  { id: 'ET', name: 'ET', full: '涡流检测', desc: '导电材料电磁感应' },
  { id: '综合', name: '综合', full: '综合全科', desc: '多方法综合备考' },
]

const goals = [
  { id: 'exam', label: '考试备考', icon: <ClipboardIcon size={24} />, desc: '一级 / 二级资质考试' },
  { id: 'contest', label: '竞赛训练', icon: <AwardIcon size={24} />, desc: 'NDT 职业技能竞赛' },
  { id: 'learning', label: '技能学习', icon: <BookIcon size={24} />, desc: '系统学习检测知识' },
  { id: 'work', label: '工作需要', icon: <WrenchIcon size={24} />, desc: '实习 / 在职提升' },
]

/* 步骤 0 的三张功能白卡片（垂直排列，替代原散乱浅灰小方框） */
const features = [
  { icon: <ClipboardIcon size={22} />, title: '专业题库', desc: '内置 1,462+ 权威考试真题' },
  { icon: <StarIcon size={22} />, title: '智能分析', desc: '精准构建无损检测知识图谱' },
  { icon: <ZapIcon size={22} />, title: '高效刷题', desc: '支持顺序、随机及模拟考多种模式' },
]

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState(0)
  const [selectedMethods, setSelectedMethods] = useState<NDTMethod[]>([])
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null)

  const toggleMethod = (id: NDTMethod) => {
    setSelectedMethods(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  const handleNext = () => {
    if (step < 2) setStep(s => s + 1)
    else onComplete(selectedMethods.length > 0 ? selectedMethods : ['UT'], selectedGoal || 'learning')
  }

  const canNext = step === 0 || (step === 1 && selectedMethods.length > 0) || (step === 2 && selectedGoal !== null)

  return (
    <div className="app-shell flex flex-col bg-[#F6F4EE]">
      {/* ── Step 0 · 品牌介绍 ── */}
      {step === 0 && (
        <div className="anim-fade-in flex min-h-screen flex-col px-7 pb-8 pt-14">
          {/* 内容区：垂直居中 */}
          <div className="flex w-full flex-1 flex-col items-center justify-center text-center">
            {/* 品牌 Header */}
            <div className="anim-slide-up flex flex-col items-center">
              <BrandLogo />
              <h1 className="mt-4 text-2xl font-bold text-slate-900">NDT-劳人</h1>
              <p className="mt-1.5 text-xs tracking-wider text-slate-500">无损检测学习与考试训练平台</p>
            </div>

            {/* Slogan */}
            <div className="anim-slide-up d-200 mt-8">
              <p className="text-xl font-bold text-slate-800" style={{ letterSpacing: '0.06em' }}>让每一道题，</p>
              <p className="text-xl font-bold text-slate-800" style={{ letterSpacing: '0.06em' }}>都变成你的能力。</p>
            </div>

            {/* 三张功能白卡片：左青绿圆角图标 + 标题 + 小字说明 */}
            <div className="anim-slide-up d-300 mt-9 w-full space-y-3">
              {features.map(f => (
                <div
                  key={f.title}
                  className="flex items-center gap-4 rounded-2xl bg-white/90 p-4 text-left"
                  style={{ boxShadow: '0 2px 12px rgba(120,110,90,0.08)' }}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#3BB4A2]/12 text-[#3BB4A2]">
                    {f.icon}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{f.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 底部 CTA：胶囊主按钮 + 跳过 */}
          <div className="anim-slide-up d-400 mt-8 w-full space-y-3">
            <CtaButton label="开始体验" onClick={handleNext} />
            <button onClick={() => onComplete(['UT'], 'learning')} className="tap w-full py-2 text-center text-sm text-slate-400 transition-colors duration-200 hover:text-slate-600">
              跳过
            </button>
          </div>
        </div>
      )}

      {/* ── Step 1 · 选择检测方向 ── */}
      {step === 1 && (
        <div className="anim-slide-up flex min-h-screen flex-col px-6 pb-8 pt-16">
          <div className="mb-2">
            <p className="mb-2 text-sm font-medium text-slate-500">第 1 步 / 2</p>
            <h2 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">选择你的检测方向</h2>
            <p className="text-sm text-slate-500">可多选，后续可以随时更改</p>
          </div>

          <div className="mt-6 flex-1 grid grid-cols-2 gap-3">
            {methods.map((m, i) => {
              const selected = selectedMethods.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleMethod(m.id)}
                  className={`anim-slide-up relative rounded-2xl p-4 text-left transition-all duration-200 tap ${
                    selected
                      ? 'border-[#3BB4A2] bg-[#3BB4A2]/8'
                      : 'border-transparent bg-white/90 hover:border-[#3BB4A2]/30'
                  }`}
                  style={{
                    animationDelay: `${i * 0.06}s`,
                    borderWidth: 1.5,
                    boxShadow: selected
                      ? '0 6px 16px rgba(59,180,162,0.18)'
                      : '0 2px 12px rgba(120,110,90,0.08)',
                  }}
                >
                  {selected && (
                    <div className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#3BB4A2]">
                      <CheckIcon size={10} strokeWidth={2.6} color="#fff" />
                    </div>
                  )}
                  <div className="mb-1 text-xl font-bold" style={{ color: selected ? '#3BB4A2' : '#0F172A' }}>
                    {m.name}
                  </div>
                  <div className="mb-1 text-xs font-medium text-slate-900">{m.full}</div>
                  <div className="text-xs leading-tight text-slate-500">{m.desc}</div>
                </button>
              )
            })}
          </div>

          {/* 底部 CTA */}
          <div className="mt-6 space-y-3">
            <StepDots active={0} />
            <CtaButton label="下一步" onClick={handleNext} disabled={!canNext} />
          </div>
        </div>
      )}

      {/* ── Step 2 · 选择学习目标 ── */}
      {step === 2 && (
        <div className="anim-slide-up flex min-h-screen flex-col px-6 pb-8 pt-16">
          <div className="mb-2">
            <p className="mb-2 text-sm font-medium text-slate-500">第 2 步 / 2</p>
            <h2 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">你的学习目标是？</h2>
            <p className="text-sm text-slate-500">帮助我们为你生成个性化学习计划</p>
          </div>

          <div className="mt-6 flex-1 flex flex-col gap-3">
            {goals.map((goal, i) => {
              const selected = selectedGoal === goal.id
              return (
                <button
                  key={goal.id}
                  onClick={() => setSelectedGoal(goal.id)}
                  className={`relative flex items-center gap-4 rounded-2xl p-4 text-left transition-all duration-200 tap ${
                    selected
                      ? 'border-[#3BB4A2] bg-[#3BB4A2]/8'
                      : 'border-transparent bg-white/90 hover:border-[#3BB4A2]/30'
                  }`}
                  style={{
                    animationDelay: `${i * 0.07}s`,
                    borderWidth: 1.5,
                    boxShadow: selected
                      ? '0 6px 16px rgba(59,180,162,0.18)'
                      : '0 2px 12px rgba(120,110,90,0.08)',
                  }}
                >
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                    style={{
                      background: selected ? '#3BB4A2' : '#F0EEE7',
                      color: selected ? '#fff' : '#64748B',
                    }}
                  >
                    {goal.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-slate-900">{goal.label}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{goal.desc}</div>
                  </div>
                  {selected && (
                    <div className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#3BB4A2]">
                      <CheckIcon size={10} strokeWidth={2.6} color="#fff" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* 底部 CTA */}
          <div className="mt-6 space-y-3">
            <StepDots active={1} />
            <CtaButton label="开始学习 →" onClick={handleNext} disabled={!canNext} />
          </div>
        </div>
      )}
    </div>
  )
}
