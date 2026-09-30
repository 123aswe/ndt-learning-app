import React, { useState, useCallback, useEffect } from 'react'
import { BottomNav } from './components/BottomNav'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { LoginScreen } from './screens/LoginScreen'
import { HomeScreen } from './screens/HomeScreen'
import { QuestionBankScreen } from './screens/QuestionBankScreen'
import { PracticeScreen } from './screens/PracticeScreen'
import { PracticeResultScreen } from './screens/PracticeResultScreen'
import { WrongQuestionsScreen } from './screens/WrongQuestionsScreen'
import { MaterialsScreen } from './screens/MaterialsScreen'
import { VideoDetailScreen } from './screens/VideoDetailScreen'
import { FavoriteVideosScreen } from './screens/FavoriteVideosScreen'
import { AchievementsScreen } from './screens/AchievementsScreen'
import { WatchHistoryScreen } from './screens/WatchHistoryScreen'
import { ScoreRecordsScreen } from './screens/ScoreRecordsScreen'
import { LearningScreen } from './screens/LearningScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { NotificationsScreen } from './screens/NotificationsScreen'
import { LegalScreen } from './screens/LegalScreen'
import { ExamSetupScreen } from './screens/ExamSetupScreen'
import { ExamScreen } from './screens/ExamScreen'
import { ExamResultScreen } from './screens/ExamResultScreen'
import { ExamDetailScreen } from './screens/ExamDetailScreen'
import { ChevronLeftIcon, SearchIcon } from './components/icons'
import { NotifyToast } from './components/NotifyToast'
import type { LegalKey } from './data/legal'
import type { Screen, Tab } from './types'
import type { ExamStartResult, ExamSubmitResult } from './api/client'

type PracticeOpts = { topic?: string; mode?: 'sequential' | 'random' | 'wrong'; qtype?: string; setId?: number; setTitle?: string }

type AppView =
  | { name: 'onboarding' }
  | { name: 'login' }
  | { name: 'legal'; docKey: LegalKey }
  | { name: 'main'; tab: Tab }
  | ({ name: 'practice'; categoryId: string } & PracticeOpts)
  | ({ name: 'practice-result'; correct: number; total: number; timeSeconds: number; categoryId: string } & PracticeOpts)
  | { name: 'exam-setup' }
  | { name: 'exam'; session: ExamStartResult }
  | { name: 'exam-result'; result: ExamSubmitResult }
  | { name: 'exam-detail'; examId: string; from: 'records' | 'result'; isPractice?: boolean; result?: ExamSubmitResult }
  | { name: 'search' }
  | { name: 'notifications' }
  | { name: 'achievements' }
  | { name: 'score-records' }
  | { name: 'watch-history'; from: 'profile' | 'materials' }
  | { name: 'favorites' }
  | { name: 'video-detail'; materialId: number; from: 'materials' | 'favorites' | 'history'; historyFrom?: 'profile' | 'materials' }
  | { name: 'settings' }

/* ============================================================
   占位页（浅色）：搜索（成就 / 观看历史已是真实实现，见 screens/）
   ============================================================ */

function PlaceholderScreen({ title, icon, onBack }: { title: string; icon: React.ReactNode; onBack: () => void }) {
  return (
    <div className="app-shell flex flex-col bg-page min-h-screen">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center" style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}>
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{title}</h1>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
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

  /* 会话失效（管理员重置密码踢会话 / 令牌过期）→ 自动退回登录页。
     事件由 client.ts 在收到 401 时广播。 */
  useEffect(() => {
    const onSessionExpired = () => setView({ name: 'login' })
    window.addEventListener('ndt:session-expired', onSessionExpired)
    return () => window.removeEventListener('ndt:session-expired', onSessionExpired)
  }, [])

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
      case 'score-records':   setView({ name: 'score-records' }); break
      case 'watch-history':   setView({ name: 'watch-history', from: activeTab === 'materials' ? 'materials' : 'profile' }); break
      case 'favorites':       setView({ name: 'favorites' }); break
      case 'settings':        setView({ name: 'settings' }); break
      default:                goMain('home')
    }
  }, [goMain, activeTab])

  /* 进练习：opts 可带 topic（章节）/ mode（顺序·随机·错题重练）/ qtype（题型）/ setId（自定义题库） */
  const handleStartPractice = useCallback((categoryId: string, opts?: PracticeOpts) => {
    setView({ name: 'practice', categoryId, topic: opts?.topic, mode: opts?.mode, qtype: opts?.qtype, setId: opts?.setId, setTitle: opts?.setTitle })
  }, [])

  const handlePracticeComplete = useCallback((correct: number, total: number, timeSeconds: number) => {
    const prev = view as { name: 'practice'; categoryId: string } & PracticeOpts
    setView({
      name: 'practice-result', correct, total, timeSeconds,
      categoryId: prev.categoryId || 'UT',
      topic: prev.topic, mode: prev.mode, qtype: prev.qtype, setId: prev.setId, setTitle: prev.setTitle,
    })
  }, [view])

  /* ── Render ── */

  if (view.name === 'onboarding') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <OnboardingScreen onComplete={() => setView({ name: 'login' })} />
        </div>
      </div>
    )
  }

  if (view.name === 'login') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <LoginScreen
            onSuccess={() => goMain('home')}
            onOpenLegal={(docKey) => setView({ name: 'legal', docKey })}
          />
        </div>
      </div>
    )
  }

  /* 《服务协议》/《隐私政策》：从登录页点开，返回即回到登录页 */
  if (view.name === 'legal') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <LegalScreen docKey={view.docKey} onBack={() => setView({ name: 'login' })} />
        </div>
      </div>
    )
  }

  if (view.name === 'practice') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PracticeScreen
            categoryId={view.categoryId}
            topic={view.topic}
            mode={view.mode}
            qtype={view.qtype}
            setId={view.setId}
            title={view.setTitle}
            onExit={() => goMain('home')}
            onComplete={handlePracticeComplete}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'practice-result') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PracticeResultScreen
            correct={view.correct}
            total={view.total}
            timeSeconds={view.timeSeconds}
            categoryId={view.categoryId}
            onRetry={() => setView({ name: 'practice', categoryId: view.categoryId, topic: view.topic, mode: view.mode, qtype: view.qtype, setId: view.setId, setTitle: view.setTitle })}
            onHome={() => goMain('home')}
            onReviewWrong={() => goMain('wrong')}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'exam-setup') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <ExamSetupScreen
            onBack={() => goMain('home')}
            onStarted={(session) => setView({ name: 'exam', session })}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'exam') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <ExamScreen
            session={view.session}
            onExit={() => goMain('home')}
            onComplete={(result) => setView({ name: 'exam-result', result })}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'exam-result') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <ExamResultScreen
            result={view.result}
            onReviewPaper={() => setView({ name: 'exam-detail', examId: view.result.exam_id, from: 'result', result: view.result })}
            onHome={() => goMain('home')}
            onRetry={() => setView({ name: 'exam-setup' })}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'exam-detail') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <ExamDetailScreen
            examId={view.examId}
            kind={view.isPractice ? 'practice' : 'exam'}
            onBack={() => {
              if (view.from === 'result' && view.result) setView({ name: 'exam-result', result: view.result })
              else setView({ name: 'score-records' })
            }}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'search') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <PlaceholderScreen title="搜索" icon={<SearchIcon size={30} />} onBack={() => goMain('home')} />
        </div>
      </div>
    )
  }

  if (view.name === 'notifications') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <NotificationsScreen onBack={() => goMain('home')} />
        </div>
      </div>
    )
  }

  if (view.name === 'achievements') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <AchievementsScreen onBack={() => goMain('profile')} />
        </div>
      </div>
    )
  }

  if (view.name === 'score-records') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <ScoreRecordsScreen
            onBack={() => goMain('profile')}
            onStartPractice={(categoryId) => setView({ name: 'practice', categoryId })}
            onOpenDetail={(sessionId, isExam) =>
              setView({ name: 'exam-detail', examId: sessionId, from: 'records', isPractice: !isExam })
            }
          />
        </div>
      </div>
    )
  }

  if (view.name === 'watch-history') {
    const from = view.from
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <WatchHistoryScreen
            onBack={() => goMain(from === 'materials' ? 'materials' : 'profile')}
            onOpenVideo={(materialId) =>
              setView({ name: 'video-detail', materialId, from: 'history', historyFrom: from })
            }
          />
        </div>
      </div>
    )
  }

  /* 我的收藏：收藏过的视频（点卡片进视频详情页，返回时自动刷新） */
  if (view.name === 'favorites') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <FavoriteVideosScreen
            onBack={() => goMain('profile')}
            onOpenVideo={(materialId) => setView({ name: 'video-detail', materialId, from: 'favorites' })}
          />
        </div>
      </div>
    )
  }

  /* 视频详情页：播放器 + 收藏 + 评论区（返回回到来源页） */
  if (view.name === 'video-detail') {
    const from = view.from
    const historyFrom = view.historyFrom ?? 'profile'
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <VideoDetailScreen
            materialId={view.materialId}
            onBack={() => {
              if (from === 'favorites') setView({ name: 'favorites' })
              else if (from === 'history') setView({ name: 'watch-history', from: historyFrom })
              else goMain('materials')
            }}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'settings') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <SettingsScreen
            onBack={() => goMain('profile')}
            onLogout={() => setView({ name: 'login' })}
          />
        </div>
      </div>
    )
  }

  /* ── 主 Tab 布局 ── */
  return (
    <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
      <div className="app-shell relative">
        <div className="w-full" key={activeTab}>
          {activeTab === 'home' && (
            <HomeScreen onNavigate={handleNavigate} onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'questions' && (
            <QuestionBankScreen onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'materials' && (
            <MaterialsScreen
              onNavigate={handleNavigate}
              onOpenVideo={(materialId) => setView({ name: 'video-detail', materialId, from: 'materials' })}
            />
          )}
          {activeTab === 'wrong' && (
            <WrongQuestionsScreen onStartPractice={handleStartPractice} onBack={() => goMain('profile')} />
          )}
          {activeTab === 'learning' && (
            <LearningScreen onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'profile' && (
            <ProfileScreen onNavigate={handleNavigate} />
          )}
        </div>

        {/* 新通知横幅提示：监听 useNotifications 的 'ndt-new-notify' 事件，点击进通知中心 */}
        <NotifyToast onOpen={() => handleNavigate('notifications')} />

        <BottomNav activeTab={activeTab} onChange={handleTabChange} />
      </div>
    </div>
  )
}
