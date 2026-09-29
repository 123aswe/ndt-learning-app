import React, { useState } from 'react'
import { Button } from '../components/Button'
import { ActivityIcon, StarIcon, ZapIcon, ClipboardIcon, AwardIcon, BookIcon, WrenchIcon, CheckIcon } from '../components/icons'
import type { NDTMethod } from '../types'

/* ============================================================
   引导页（苹果式浅色）
   结构保持：3 步（logo 介绍 / 选检测方向 / 选学习目标）+ 底部 CTA
   ============================================================ */

interface OnboardingScreenProps {
  onComplete: (selectedMethods: NDTMethod[], goal: string) => void
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
    <div className="app-shell flex flex-col bg-page">
      {/* Step 0 — 介绍 */}
      {step === 0 && (
        <div className="flex flex-col items-center justify-center h-full min-h-screen px-8 text-center anim-fade-in">
          <div className="mb-8 anim-slide-up">
            <div
              className="w-20 h-20 rounded-[24px] flex items-center justify-center mx-auto mb-6"
              style={{ background: 'var(--accent)' }}
            >
              <div className="text-white">
                <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                  <text x="2" y="26" fontFamily="'Inter', sans-serif" fontSize="18" fontWeight="800" fill="#fff">N</text>
                  <path d="M24,10 L24,26 L28,16 L32,24 L36,14 L36,30" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.9" />
                </svg>
              </div>
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight mb-2" style={{ color: 'var(--text-1)', letterSpacing: '-0.02em' }}>
              NDT-劳人
            </h1>
            <p className="text-sm font-medium" style={{ color: 'var(--text-3)' }}>无损检测学习与考试训练平台</p>
          </div>

          <div className="anim-slide-up d-200 space-y-3 mb-12">
            <p className="text-xl font-semibold leading-relaxed" style={{ color: 'var(--text-1)' }}>
              让每一道题，
            </p>
            <p className="text-xl font-semibold leading-relaxed" style={{ color: 'var(--text-1)' }}>
              都变成你的能力。
            </p>
          </div>

          <div className="anim-slide-up d-300 grid grid-cols-3 gap-3 mb-12 w-full">
            {[
              { icon: <ActivityIcon size={22} />, text: '专业题库', sub: '1,462 题' },
              { icon: <StarIcon size={22} />, text: '智能分析', sub: '知识图谱' },
              { icon: <ZapIcon size={22} />, text: '高效刷题', sub: '多种模式' },
            ].map(item => (
              <div key={item.text} className="card p-3 text-center">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mx-auto mb-2" style={{ background: 'var(--accent-weak)' }}>
                  <span style={{ color: 'var(--accent)' }}>{item.icon}</span>
                </div>
                <div className="text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{item.text}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 1 — 选择方向 */}
      {step === 1 && (
        <div className="flex flex-col h-full min-h-screen px-6 pt-16 anim-slide-up">
          <div className="mb-2">
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-3)' }}>第 1 步 / 2</p>
            <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>选择你的检测方向</h2>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>可多选，后续可以随时更改</p>
          </div>

          <div className="flex-1 mt-6 grid grid-cols-2 gap-3">
            {methods.map((m, i) => {
              const selected = selectedMethods.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleMethod(m.id)}
                  className={`anim-slide-up relative rounded-2xl p-4 text-left transition-colors duration-200 tap`}
                  style={{
                    animationDelay: `${i * 0.06}s`,
                    background: selected ? 'rgba(95,141,140,0.14)' : 'rgba(255,255,255,0.72)',
                    border: selected ? '1.5px solid rgba(95,141,140,0.55)' : '1px solid rgba(255,255,255,0.75)',
                    boxShadow: selected
                      ? 'inset 1px 1px 0 rgba(255,255,255,0.75), inset -1px -1px 0 rgba(95,141,140,0.12), 0 5px 14px rgba(95,141,140,0.18)'
                      : 'inset 1px 1px 0 rgba(255,255,255,0.55), 0 2px 8px rgba(27,30,35,0.05)',
                  }}
                >
                  {selected && (
                    <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                      <CheckIcon size={10} strokeWidth={2.6} color="#fff" />
                    </div>
                  )}
                  <div className="text-xl font-bold mb-1" style={{ color: selected ? 'var(--accent)' : 'var(--text-1)' }}>
                    {m.name}
                  </div>
                  <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-1)' }}>{m.full}</div>
                  <div className="text-xs leading-tight" style={{ color: 'var(--text-3)' }}>{m.desc}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Step 2 — 选择目标 */}
      {step === 2 && (
        <div className="flex flex-col h-full min-h-screen px-6 pt-16 anim-slide-up">
          <div className="mb-2">
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-3)' }}>第 2 步 / 2</p>
            <h2 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>你的学习目标是？</h2>
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>帮助我们为你生成个性化学习计划</p>
          </div>

          <div className="flex-1 mt-6 flex flex-col gap-3">
            {goals.map((goal, i) => {
              const selected = selectedGoal === goal.id
              return (
                <button
                  key={goal.id}
                  onClick={() => setSelectedGoal(goal.id)}
                  className="relative rounded-2xl p-4 text-left transition-colors duration-200 tap flex items-center gap-4"
                  style={{
                    animationDelay: `${i * 0.07}s`,
                    background: selected ? 'rgba(95,141,140,0.14)' : 'rgba(255,255,255,0.72)',
                    border: selected ? '1.5px solid rgba(95,141,140,0.55)' : '1px solid rgba(255,255,255,0.75)',
                    boxShadow: selected
                      ? 'inset 1px 1px 0 rgba(255,255,255,0.75), inset -1px -1px 0 rgba(95,141,140,0.12), 0 5px 14px rgba(95,141,140,0.18)'
                      : 'inset 1px 1px 0 rgba(255,255,255,0.55), 0 2px 8px rgba(27,30,35,0.05)',
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{
                      background: selected ? 'var(--surface)' : 'var(--surface-warm)',
                      color: selected ? 'var(--accent)' : 'var(--text-2)',
                    }}
                  >
                    {goal.icon}
                  </div>
                  <div>
                    <div className={`font-semibold text-sm ${selected ? '' : ''}`} style={{ color: 'var(--text-1)' }}>{goal.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{goal.desc}</div>
                  </div>
                  {selected && (
                    <div className="ml-auto w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent)' }}>
                      <CheckIcon size={10} strokeWidth={2.6} color="#fff" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 底部 CTA */}
      <div className="px-6 pb-12 pt-4 flex flex-col gap-3">
        {step > 0 && (
          <div className="flex gap-2 justify-center mb-2">
            {[0, 1].map(i => (
              <div
                key={i}
                className="h-1 rounded-full transition-all duration-300"
                style={{ width: i === step - 1 ? 24 : 8, background: i === step - 1 ? 'var(--accent)' : '#D9DCE0' }}
              />
            ))}
          </div>
        )}

        <Button fullWidth size="lg" onClick={handleNext} disabled={!canNext} className="rounded-2xl">
          {step === 0 ? '开始体验' : step < 2 ? '下一步' : '开始学习 →'}
        </Button>

        {step === 0 && (
          <button
            onClick={() => onComplete(['UT'], 'learning')}
            className="text-sm text-center py-2 tap"
            style={{ color: 'var(--text-3)' }}
          >
            跳过引导
          </button>
        )}
      </div>
    </div>
  )
}
