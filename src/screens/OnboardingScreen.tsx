import React, { useState } from 'react'
import { ClipboardIcon, StarIcon, ZapIcon, AwardIcon, BookIcon, WrenchIcon, CheckIcon } from '../components/icons'
import { BrandIcon } from '../components/BrandIcon'
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

/* 品牌 Logo：官方 App 图标原图 + 薄荷青同色弥散柔光（图标按原始比例显示） */
function BrandLogo() {
  return (
    <div
      className="flex h-16 items-center justify-center rounded-[20px]"
      style={{ boxShadow: '0 12px 28px rgba(59,180,162,0.25)' }}
    >
      <BrandIcon size={64} />
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

/* ════════════════════════════════════════════════════════════
   方案三 · 情感化叙事插画风
   步骤 1 六个检测方法各配一张精致小场景插画（扁平柔和配色），
   顶部配"技师选择工具"人物插画；选中卡片彩色边框高亮。
   仅影响步骤 1，步骤 0/2 与全部交互逻辑不变。
   ════════════════════════════════════════════════════════════ */

/* UT · 手持超声探头检测管道（声波同心弧） */
function UtScene() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="26" ry="5" fill="#C9EDE6" opacity="0.55" />
      <rect x="8" y="30" width="48" height="8" rx="4" fill="#A8B8C4" />
      <rect x="8" y="30" width="48" height="3" rx="1.5" fill="#C4D2DC" />
      <path d="M22 15a11 11 0 0 1 20 0" stroke="#3BB4A2" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <path d="M25 18a8 8 0 0 1 14 0" stroke="#3BB4A2" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      <rect x="24" y="16" width="16" height="10" rx="3" fill="#3BB4A2" />
      <rect x="26" y="18" width="12" height="3" rx="1.5" fill="#C9EDE6" opacity="0.85" />
      <path d="M40 20 q8 -2 6 -8" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
      <circle cx="48" cy="11" r="4.5" fill="#F6C9A0" />
    </svg>
  )
}

/* RT · 观片灯下查看 X 光胶片（裂纹缺陷显影） */
function RtScene() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="26" ry="5" fill="#FBE3CF" opacity="0.6" />
      <rect x="8" y="10" width="48" height="24" rx="6" fill="#E8A7B0" />
      <rect x="12" y="14" width="40" height="16" rx="4" fill="#FFF8EE" />
      <rect x="16" y="17" width="32" height="10" rx="2" fill="#F4F6F8" stroke="#C4D2DC" strokeWidth="1" />
      <path d="M19 22 l5 0 l4 -3 l5 6 l4 -4 l5 2" stroke="#64748B" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="42" cy="20.5" r="1.5" fill="#E0566B" />
      <path d="M52 4 l3.5 3.5 M55.5 4 l-3.5 3.5" stroke="#E8A7B0" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

/* MT · 手持磁粉刷在工件上显磁痕 */
function MtScene() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="26" ry="5" fill="#DCEAF8" opacity="0.55" />
      <rect x="8" y="29" width="46" height="7" rx="3.5" fill="#B9C6D0" />
      <circle cx="18" cy="32.5" r="1.3" fill="#3BB4A2" />
      <circle cx="24" cy="33" r="1.1" fill="#3BB4A2" opacity="0.8" />
      <circle cx="30" cy="32" r="1.4" fill="#3BB4A2" />
      <circle cx="35" cy="33.5" r="1" fill="#3BB4A2" opacity="0.7" />
      <path d="M14 25 a6 6 0 0 1 10 0" stroke="#7DB8E8" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" fill="none" />
      <path d="M34 25 a6 6 0 0 1 10 0" stroke="#7DB8E8" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" fill="none" />
      <rect x="42" y="8" width="4" height="15" rx="2" fill="#A8845C" />
      <rect x="39" y="21" width="10" height="6" rx="2.5" fill="#3BB4A2" />
      <circle cx="52" cy="10" r="4.5" fill="#F6C9A0" />
    </svg>
  )
}

/* PT · 喷罐渗透显像（品红裂纹显示） */
function PtScene() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="26" ry="5" fill="#FBE3CF" opacity="0.6" />
      <rect x="8" y="29" width="34" height="7" rx="3.5" fill="#B9C6D0" />
      <path d="M16 31 l4 3 M20 34 l4 -3 M24 31 l5 4" stroke="#E0566B" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <circle cx="24" cy="18" r="1" fill="#7DB8E8" opacity="0.7" />
      <circle cx="27" cy="14" r="1.2" fill="#7DB8E8" opacity="0.6" />
      <circle cx="21" cy="13" r="1" fill="#7DB8E8" opacity="0.8" />
      <circle cx="25" cy="10" r="1.1" fill="#7DB8E8" opacity="0.5" />
      <rect x="36" y="10" width="11" height="15" rx="3.5" fill="#E8A7B0" />
      <rect x="38" y="12" width="7" height="4" rx="2" fill="#F7D0D6" />
      <rect x="34" y="7" width="5" height="3.5" rx="1.75" fill="#F2C94C" />
      <rect x="32" y="4" width="3" height="3.5" rx="1.5" fill="#A8845C" />
      <circle cx="54" cy="8" r="4.5" fill="#F6C9A0" />
    </svg>
  )
}

/* ET · 涡流线圈与探头 */
function EtScene() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="26" ry="5" fill="#C9EDE6" opacity="0.5" />
      <path d="M10 26 q9 -12 18 0 q9 12 18 0 q9 -12 18 0" stroke="#7DB8E8" strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.9" />
      <path d="M25 14 a7 7 0 0 1 14 0" stroke="#3BB4A2" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" fill="none" />
      <rect x="30" y="3" width="3" height="7" rx="1.5" fill="#64748B" />
      <circle cx="31.5" cy="13" r="6.5" fill="#3BB4A2" />
      <circle cx="31.5" cy="13" r="3" fill="#C9EDE6" opacity="0.7" />
    </svg>
  )
}

/* 综合 · 多工具场景（探头 + 磁粉刷 + 喷罐） */
function ComboScene() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="26" ry="5" fill="#FBE3CF" opacity="0.55" />
      <rect x="9" y="15" width="13" height="8" rx="2.5" fill="#3BB4A2" />
      <rect x="11" y="17" width="9" height="3" rx="1.5" fill="#C9EDE6" opacity="0.8" />
      <circle cx="15.5" cy="11" r="3" fill="#F6C9A0" />
      <rect x="28" y="10" width="3.5" height="12" rx="1.75" fill="#A8845C" />
      <rect x="26" y="21" width="8" height="5" rx="2.5" fill="#7DB8E8" />
      <rect x="44" y="12" width="10" height="13" rx="3.5" fill="#E8A7B0" />
      <rect x="42" y="9" width="4.5" height="3" rx="1.5" fill="#F2C94C" />
      <circle cx="58" cy="24" r="1.2" fill="#3BB4A2" opacity="0.8" />
    </svg>
  )
}

/* VT · 目视检测（放大镜观察工件表面） */
function VtScene() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none" aria-hidden="true">
      <ellipse cx="32" cy="36" rx="26" ry="5" fill="#DCEAF8" opacity="0.5" />
      <rect x="8" y="28" width="48" height="7" rx="3.5" fill="#B9C6D0" />
      <path d="M20 30 l3 2 M23 32 l3 -2" stroke="#64748B" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <circle cx="36" cy="20" r="9" fill="#C9EDE6" />
      <circle cx="36" cy="20" r="7" fill="#FFF" stroke="#3BB4A2" strokeWidth="2" />
      <circle cx="34.5" cy="18.5" r="0.9" fill="#3BB4A2" />
      <path d="M41 24 l5 5" stroke="#3BB4A2" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

/* 顶部插画：技师选择工具（小人 + 虚线选中框 + 一组工具） */
function TechScene() {
  return (
    <svg width="104" height="52" viewBox="0 0 104 52" fill="none" aria-hidden="true">
      <circle cx="50" cy="26" r="24" fill="#C9EDE6" opacity="0.5" />
      <circle cx="39" cy="17" r="7" fill="#F6C9A0" />
      <circle cx="36.6" cy="15.5" r="0.9" fill="#5B4636" />
      <circle cx="41.4" cy="15.5" r="0.9" fill="#5B4636" />
      <path d="M37 19.5 q2 1.6 4 0" stroke="#5B4636" strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d="M39 24 q-5 3 -9 5.5 q-2 1.2 -2 2.2 l3 1 q6 -2.5 9 -4.5 z" fill="#3BB4A2" />
      <path d="M39 24 q5 3 9 5.5 q2 1.2 2 2.2 l-3 1 q-6 -2.5 -9 -4.5 z" fill="#3BB4A2" opacity="0.85" />
      <path d="M45 25 q7 -1 11 -7" stroke="#F6C9A0" strokeWidth="3" strokeLinecap="round" />
      <rect x="60" y="27" width="10" height="7" rx="2.5" fill="#3BB4A2" />
      <rect x="62" y="29" width="6" height="3" rx="1.5" fill="#C9EDE6" opacity="0.8" />
      <rect x="74" y="25" width="3" height="9" rx="1.5" fill="#A8845C" />
      <rect x="72" y="33" width="7" height="4.5" rx="2.25" fill="#7DB8E8" />
      <rect x="86" y="26" width="9" height="12" rx="3" fill="#E8A7B0" />
      <rect x="84" y="23" width="4" height="3" rx="1.5" fill="#F2C94C" />
      <rect x="58" y="21" width="40" height="21" rx="7" stroke="#3BB4A2" strokeWidth="1.4" strokeDasharray="3 2.5" fill="none" opacity="0.85" />
    </svg>
  )
}

const methodScenes: Record<NDTMethod, React.ReactNode> = {
  UT: <UtScene />,
  RT: <RtScene />,
  MT: <MtScene />,
  PT: <PtScene />,
  ET: <EtScene />,
  VT: <VtScene />,
  综合: <ComboScene />,
}

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

      {/* ── Step 1 · 选择检测方向（方案三 · 插画叙事风） ── */}
      {step === 1 && (
        <div className="anim-slide-up flex min-h-screen flex-col px-6 pb-8 pt-14">
          {/* 顶部：技师选择工具的人物插画 */}
          <div className="mb-3 flex justify-center">
            <TechScene />
          </div>

          <div className="mb-2">
            <p className="mb-2 text-sm font-medium text-slate-500">第 1 步 / 2</p>
            <h2 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">选择你的检测方向</h2>
            <p className="text-sm text-slate-500">可多选，后续可以随时更改</p>
          </div>

          <div className="mt-5 flex-1 grid grid-cols-2 gap-3">
            {methods.map((m, i) => {
              const selected = selectedMethods.includes(m.id)
              return (
                <button
                  key={m.id}
                  onClick={() => toggleMethod(m.id)}
                  className={`anim-slide-up relative rounded-2xl p-3 text-left transition-all duration-200 tap ${
                    selected
                      ? 'border-[#3BB4A2] bg-[#3BB4A2]/6'
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
                  {/* 插画区：场景插画 + 选中时柔和底色变化 */}
                  <div
                    className="flex h-[54px] w-full items-center justify-center rounded-xl transition-colors duration-200"
                    style={{ background: selected ? '#E3F2EE' : '#F4F1E9' }}
                  >
                    {methodScenes[m.id]}
                  </div>

                  {/* 文本：UT / 超声波检测 / 描述 */}
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-lg font-bold" style={{ color: selected ? '#3BB4A2' : '#0F172A' }}>
                      {m.name}
                    </div>
                    {selected && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#3BB4A2]">
                        <CheckIcon size={10} strokeWidth={2.6} color="#fff" />
                      </div>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-slate-900">{m.full}</div>
                  <div className="mt-0.5 text-xs leading-tight text-slate-500">{m.desc}</div>
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
