import React, { useState, useCallback } from 'react'
import { BottomNav } from './components/BottomNav'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { LoginScreen } from './screens/LoginScreen'
import { HomeScreen } from './screens/HomeScreen'
import { QuestionBankScreen } from './screens/QuestionBankScreen'
import { PracticeScreen } from './screens/PracticeScreen'
import { PracticeResultScreen } from './screens/PracticeResultScreen'
import { WrongQuestionsScreen } from './screens/WrongQuestionsScreen'
import { LearningScreen } from './screens/LearningScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { ChevronLeftIcon, SearchIcon, BellIcon, AwardIcon, GearIcon, CheckIcon } from './components/icons'
import type { Screen, Tab } from './types'

type AppView =
  | { name: 'onboarding' }
  | { name: 'login' }
  | { name: 'main'; tab: Tab }
  | { name: 'practice'; categoryId: string }
  | { name: 'practice-result'; correct: number; total: number; timeSeconds: number; categoryId: string }
  | { name: 'exam-setup' }
  | { name: 'search' }
  | { name: 'notifications' }
  | { name: 'achievements' }
  | { name: 'settings' }

/* ============================================================
   占位页（浅色）：考试设置 / 搜索 / 通知 / 成就 / 设置
   ============================================================ */

const examTypes: Array<{ label: string }> = [
  { label: 'UT 一级' },
  { label: 'UT 二级' },
  { label: 'RT 一级' },
  { label: 'MT 一级' },
  { label: 'PT 一级' },
  { label: '综合考试' },
]

function ExamSetupStub({ onBack }: { onBack: () => void }) {
  return (
    <div className="app-shell flex flex-col bg-page min-h-screen">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.7)' }}>
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>模拟考试</h1>
      </div>

      <div className="flex-1 px-4 space-y-4 overflow-y-auto" style={{ paddingBottom: 40 }}>
        {/* 考试类型 */}
        <div>
          <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-2)' }}>考试类型</p>
          <div className="grid grid-cols-2 gap-3">
            {examTypes.map((t, i) => (
              <button
                key={t.label}
                className="card rounded-2xl p-4 text-left card-tap"
                style={{
                  border: i === 0 ? '1.5px solid rgba(95,141,140,0.55)' : '1px solid rgba(255,255,255,0.75)',
                  background: i === 0 ? 'rgba(95,141,140,0.14)' : 'rgba(255,255,255,0.72)',
                  boxShadow: i === 0
                    ? 'inset 1px 1px 0 rgba(255,255,255,0.75), 0 4px 12px rgba(95,141,140,0.15)'
                    : 'inset 1px 1px 0 rgba(255,255,255,0.55), 0 2px 8px rgba(27,30,35,0.05)',
                }}
              >
                <div className="font-bold text-sm" style={{ color: i === 0 ? 'var(--accent)' : 'var(--text-1)' }}>{t.label}</div>
                {i === 0 && <div className="text-[10px] mt-1" style={{ color: 'var(--accent)' }}>已选择</div>}
              </button>
            ))}
          </div>
        </div>

        {/* 题目数量 */}
        <div>
          <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-2)' }}>题目数量</p>
          <div className="flex gap-2">
            {[20, 50, 100].map(n => (
              <button
                key={n}
                className="flex-1 h-11 gb gb-pill rounded-xl text-sm font-semibold"
                style={{
                  background: n === 50 ? 'rgba(95,141,140,0.90)' : 'rgba(248,249,251,0.9)',
                  color: n === 50 ? '#fff' : 'var(--text-2)',
                  border: n === 50 ? '1px solid rgba(95,141,140,0.6)' : '1px solid rgba(255,255,255,0.75)',
                  boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.5), inset -1px -1px 0 rgba(27,30,35,0.04), 0 2px 6px rgba(27,30,35,0.05)',
                }}
              >
                {n} 题
              </button>
            ))}
          </div>
        </div>

        {/* 考试时间 */}
        <div>
          <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-2)' }}>考试时间</p>
          <div className="flex gap-2 flex-wrap">
            {['不限时', '30分钟', '60分钟', '90分钟'].map(t => (
              <button
                key={t}
                className="px-4 h-10 gb gb-pill rounded-xl text-sm font-medium"
                style={{
                  background: t === '60分钟' ? 'rgba(95,141,140,0.90)' : 'rgba(248,249,251,0.9)',
                  color: t === '60分钟' ? '#fff' : 'var(--text-2)',
                  border: t === '60分钟' ? '1px solid rgba(95,141,140,0.6)' : '1px solid rgba(255,255,255,0.75)',
                  boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.5), inset -1px -1px 0 rgba(27,30,35,0.04), 0 2px 6px rgba(27,30,35,0.05)',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onBack}
          className="w-full gb gb-primary gb-lg font-semibold text-base mt-4 flex items-center justify-center gap-2"
          style={{ height: 52 }}
        >
          开始考试 <CheckIcon size={16} color="#10B981" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  )
}

function PlaceholderScreen({ title, icon, onBack }: { title: string; icon: React.ReactNode; onBack: () => void }) {
  return (
    <div className="app-shell flex flex-col bg-page min-h-screen">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.7)' }}>
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{title}</h1>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
          <span style={{ color: 'var(--accent)' }}>{icon}</span>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>即将推出</p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>第二阶段将完整实现此功能</p>
      </div>
    </div>
  )
}

/* ============================================================
   根组件：视图状态机 + Tab 布局
   ============================================================ */
export default function App() {
  const [view, setView] = useState<AppView>({ name: 'onboarding' })
  const [activeTab, setActiveTab] = useState<Tab>('home')

  const goMain = useCallback((tab: Tab = 'home') => {
    setActiveTab(tab)
    setView({ name: 'main', tab })
  }, [])

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab)
    setView({ name: 'main', tab })
  }, [])

  const handleNavigate = useCallback((screen: Screen) => {
    switch (screen) {
      case 'home':            goMain('home'); break
      case 'question-bank':  goMain('questions'); break
      case 'wrong-questions': goMain('wrong'); break
      case 'learning':        goMain('learning'); break
      case 'profile':         goMain('profile'); break
      case 'exam-setup':      setView({ name: 'exam-setup' }); break
      case 'search':          setView({ name: 'search' }); break
      case 'notifications':   setView({ name: 'notifications' }); break
      case 'achievements':    setView({ name: 'achievements' }); break
      case 'settings':        setView({ name: 'settings' }); break
      default:                goMain('home')
    }
  }, [goMain])

  const handleStartPractice = useCallback((categoryId: string) => {
    setView({ name: 'practice', categoryId })
  }, [])

  const handlePracticeComplete = useCallback((correct: number, total: number, timeSeconds: number) => {
    const prev = view as { name: 'practice'; categoryId: string }
    setView({ name: 'practice-result', correct, total, timeSeconds, categoryId: prev.categoryId || 'UT' })
  }, [view])

  /* ── Render ── */

  if (view.name === 'onboarding') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <OnboardingScreen onComplete={() => setView({ name: 'login' })} />
        </div>
      </div>
    )
  }

  if (view.name === 'login') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="app-shell">
          <LoginScreen onSuccess={() => goMain('home')} />
        </div>
      </div>
    )
  }

  if (view.name === 'practice') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PracticeScreen
            categoryId={view.categoryId}
            onExit={() => goMain('home')}
            onComplete={handlePracticeComplete}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'practice-result') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PracticeResultScreen
            correct={view.correct}
            total={view.total}
            timeSeconds={view.timeSeconds}
            categoryId={view.categoryId}
            onRetry={() => setView({ name: 'practice', categoryId: view.categoryId })}
            onHome={() => goMain('home')}
            onReviewWrong={() => goMain('wrong')}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'exam-setup') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <ExamSetupStub onBack={() => goMain('home')} />
        </div>
      </div>
    )
  }

  if (view.name === 'search') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PlaceholderScreen title="搜索" icon={<SearchIcon size={30} />} onBack={() => goMain('home')} />
        </div>
      </div>
    )
  }

  if (view.name === 'notifications') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PlaceholderScreen title="通知中心" icon={<BellIcon size={30} />} onBack={() => goMain('home')} />
        </div>
      </div>
    )
  }

  if (view.name === 'achievements') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PlaceholderScreen title="成就系统" icon={<AwardIcon size={30} />} onBack={() => goMain('profile')} />
        </div>
      </div>
    )
  }

  if (view.name === 'settings') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PlaceholderScreen title="设置" icon={<GearIcon size={30} />} onBack={() => goMain('profile')} />
        </div>
      </div>
    )
  }

  /* ── 主 Tab 布局 ── */
  return (
    <div className="min-h-screen bg-page flex items-center justify-center">
      <div className="app-shell relative">
        <div className="w-full" key={activeTab}>
          {activeTab === 'home' && (
            <HomeScreen onNavigate={handleNavigate} onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'questions' && (
            <QuestionBankScreen onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'wrong' && (
            <WrongQuestionsScreen onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'learning' && (
            <LearningScreen onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'profile' && (
            <ProfileScreen onNavigate={handleNavigate} />
          )}
        </div>

        <BottomNav activeTab={activeTab} onChange={handleTabChange} />
      </div>
    </div>
  )
}
