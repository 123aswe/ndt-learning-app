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
import { SeriesDetailScreen } from './screens/SeriesDetailScreen'
import { BankSeriesScreen } from './screens/BankSeriesScreen'
import { VideoDetailScreen } from './screens/VideoDetailScreen'
import { FavoriteVideosScreen } from './screens/FavoriteVideosScreen'
import { AchievementsScreen } from './screens/AchievementsScreen'
import { WatchHistoryScreen } from './screens/WatchHistoryScreen'
import { ScoreRecordsScreen } from './screens/ScoreRecordsScreen'
import { LearningScreen } from './screens/LearningScreen'
import { MusicScreen, GlobalMusicFab, GlobalMusicFxSheet } from './screens/MusicScreen'
/* v1.71 全局音乐引擎：注册「点迷你播放条回音乐页」的入口，供顶层 App 渲染的迷你条使用 */
import { setOpenMusicPageHandler, musicEngine } from './hooks/useMusicEngine'
import { ProfileScreen } from './screens/ProfileScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { ThemeStoreScreen } from './screens/ThemeStoreScreen'
import { NotificationsScreen } from './screens/NotificationsScreen'
import { LegalScreen } from './screens/LegalScreen'
import { ExamSetupScreen } from './screens/ExamSetupScreen'
import { ExamScreen } from './screens/ExamScreen'
import { ExamResultScreen } from './screens/ExamResultScreen'
import { ExamDetailScreen } from './screens/ExamDetailScreen'
import { ChevronLeftIcon, InfoIcon, SearchIcon, XIcon } from './components/icons'
import { NotifyToast } from './components/NotifyToast'
import { UpdateBanner } from './components/UpdateBanner'
import { REALTIME_EVENT } from './api/realtime'
import {
  forgetView, hasUsedApp, isLoggedIn, markAppUsed, readRememberedView, rememberView,
} from './api/client'
import { useAppUpdate } from './hooks/useAppUpdate'
import { useRealtime } from './hooks/useRealtime'
import { useSoftKeyboard } from './hooks/useSoftKeyboard'
import type { LegalKey } from './data/legal'
import type { Screen, Tab } from './types'
import type { BankSeries, ExamStartResult, ExamSubmitResult, MaterialSeries } from './api/client'

/**
 * 练习参数。
 * backTo（v1.76）：进练习前所在的那一页的快照 —— 退出练习 / 交卷后回到这里，
 *   而不是一律回首页（「题库里进的练习，返回就回题库」）。
 *   由 handleStartPractice 自动记录，调用方（首页 / 题库 / 题库系列 / 错题 / 学习 / 成绩记录）
 *   一律不用传；不传且没有来源时才回首页。
 */
type PracticeOpts = { topic?: string; mode?: 'sequential' | 'random' | 'wrong'; qtype?: string; setId?: number; setTitle?: string; backTo?: AppView }

/**
 * 结果页底部按钮文案：按「进练习前那一页」取名。
 * 只在确实没有来源时才叫「返回首页」。
 */
function backLabelOf(backTo?: AppView): string {
  if (!backTo) return '返回首页'
  if (backTo.name === 'main') {
    switch (backTo.tab) {
      case 'questions': return '返回题库'
      case 'wrong':     return '返回错题本'
      case 'learning':  return '返回学习'
      case 'materials': return '返回资料'
      case 'music':     return '返回音乐'
      case 'profile':   return '返回我的'
      default:          return '返回首页'
    }
  }
  if (backTo.name === 'bank-series')  return '返回题库'
  if (backTo.name === 'score-records') return '返回成绩记录'
  return '返回上一页'
}

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
  | { name: 'video-detail'; materialId: number; from: 'materials' | 'favorites' | 'history' | 'series'; seriesBack?: MaterialSeries; historyFrom?: 'profile' | 'materials' }
  | { name: 'series-detail'; series: MaterialSeries }
  | { name: 'bank-series'; series: BankSeries }
  | { name: 'theme-store' }
  | { name: 'settings' }

/* ============================================================
   启动路由 + 页面记忆
   ------------------------------------------------------------
   打开 App 看到哪一屏，只看两件事：
     1. 本地有没有有效登录态（有 → 直接进主界面，不退出登录就一直登录着）
        —— 令牌真实有效期由服务端说了算（15 天，活跃自动续期，见 server/deps.py）；
           万一真的过期了，第一个接口返回 401 → 自动退回登录页
     2. 没有登录态时看「这台设备用过没有」（ndt_onboarded）：
        用过 → 登录页；从没用过（新装 / 新用户）→ 引导页
   刷新 / 重开 App 停在原页面：切页时把当前 AppView 快照写进 localStorage，
   下次启动原样还原（练习页靠服务端续做进度恢复现场；考试页只在内存里，不记）
   ============================================================ */

const TABS: Tab[] = ['home', 'questions', 'materials', 'wrong', 'learning', 'music', 'profile']

function isTab(value: unknown): value is Tab {
  return typeof value === 'string' && TABS.includes(value as Tab)
}

/** 可记忆的页面：不记 onboarding / login / legal（未登录流程）与 exam（刷新没有半场试卷） */
const REMEMBERABLE = new Set<string>([
  'main', 'practice', 'practice-result', 'exam-setup', 'exam-result', 'exam-detail',
  'search', 'notifications', 'achievements', 'score-records', 'watch-history',
  'favorites', 'video-detail', 'series-detail', 'bank-series', 'theme-store', 'settings',
])

/** 落盘前裁剪：需要重建的参数原样存；exam-detail 的 result（整卷判分明细）不存，省几 KB */
function serializeView(view: AppView): AppView | null {
  if (view.name === 'onboarding' || view.name === 'login' || view.name === 'legal') return null
  if (view.name === 'exam') return null
  if (view.name === 'exam-detail') {
    return { name: 'exam-detail', examId: view.examId, from: view.from, isPractice: view.isPractice }
  }
  return view
}

/** 还原快照：白名单 + 关键参数逐个校验，脏数据一律放弃（回首页），别让某屏炸在渲染里 */
function parseView(raw: unknown): AppView | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const name = typeof v.name === 'string' ? v.name : ''
  if (!REMEMBERABLE.has(name)) return null

  switch (name) {
    case 'main':
      return { name: 'main', tab: isTab(v.tab) ? v.tab : 'home' }
    case 'practice':
      if (typeof v.categoryId !== 'string' || !v.categoryId) return null
      break
    case 'practice-result':
      if (typeof v.categoryId !== 'string' || typeof v.correct !== 'number' || typeof v.total !== 'number') return null
      break
    case 'exam-detail':
      if (typeof v.examId !== 'string' || !v.examId) return null
      break
    case 'video-detail':
      if (typeof v.materialId !== 'number') return null
      break
    case 'series-detail':
      // 系列快照：至少要有个合法的 id，否则还原后详情页取不到数据
      if (!v.series || typeof (v.series as Record<string, unknown>).id !== 'number') return null
      break
    case 'bank-series':
      // 题库系列快照：同系列，校验 id 合法性
      if (!v.series || typeof (v.series as Record<string, unknown>).id !== 'number') return null
      break
    default:
      break
  }
  const view: Record<string, unknown> = { ...v }
  /* 练习来源（practice / practice-result 的 backTo）：递归校验一遍，
     脏数据直接丢掉（退化成回首页，绝不让它炸在渲染里） */
  if (view.backTo !== undefined) {
    const back = parseView(view.backTo)
    if (back) view.backTo = back
    else delete view.backTo
  }
  return view as unknown as AppView
}

interface ViewSnapshot {
  view?: unknown
  tab?: unknown
}

/** 启动时的初始屏 + 初始 Tab */
function bootState(): { view: AppView; tab: Tab } {
  const snap = readRememberedView<ViewSnapshot>()

  /* 已登录：直接进上次停留的页面（没记过就进首页） */
  if (isLoggedIn()) {
    const view = parseView(snap?.view)
    if (view) {
      const tab = view.name === 'main' ? view.tab : (isTab(snap?.tab) ? snap.tab : 'home')
      return { view, tab }
    }
    return { view: { name: 'main', tab: 'home' }, tab: 'home' }
  }

  /* 没登录：老用户（这台设备用过）直接去登录页，只有新用户看引导页 */
  return { view: hasUsedApp() ? { name: 'login' } : { name: 'onboarding' }, tab: 'home' }
}

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

   v1.71 结构调整（音乐后台播放）：
   原来的 App 改名 AppShell，新增顶层 App = <AppShell/> + <GlobalMusicFab/>。
   原因：本组件里「观看历史 / 收藏 / 设置 / 搜索 / 通知 / 做题 / 考试 …」等整页视图
   都是 `if (view.name === '…') return <XxxScreen/>` 提前返回 —— 这些分支不会渲染到
   文件末尾的 JSX，所以悬浮球必须挂在 AppShell 外面（文件末尾的 App）才能
   在整页视图上也出现。音乐播放状态本身在 src/hooks/useMusicEngine.ts（全局引擎）。
   v1.72：全局播放条 → 可拖动 / 可展开的悬浮球（GlobalMusicFab），
   首页 / 题库 / 资料 / 我的 / 做题 / 考试 / 看视频时都在，音乐页内自动隐藏。
   ============================================================ */
function AppShell() {
  /* 启动屏由 bootState() 决定：已登录 → 上次停留的页面；未登录 → 引导页（新用户）/ 登录页（老用户） */
  const [boot] = useState(bootState)
  const [view, setView] = useState<AppView>(boot.view)
  const [activeTab, setActiveTab] = useState<Tab>(boot.tab)
  /** 音乐页子视图（搜索 / 歌单 / 歌曲列表）时隐藏底部导航，底部改为迷你播放条；其他情况导航不变
      v1.70 语义收窄：只在音乐 Tab 内生效（切走 Tab 时导航恢复显示，音乐后台继续播） */
  const [musicOverlay, setMusicOverlay] = useState(false)
  /** v1.70 音乐后台播放：音乐 Tab 首次进入后 MusicScreen 常驻挂载（切走 Tab 仅 display:none 隐藏），
      音频元素不销毁 → 切 Tab / 回首页时歌不停；悬浮播放条在其他 Tab 也可见可控 */
  const [musicMounted, setMusicMounted] = useState(boot.view.name === 'main' && boot.tab === 'music')
  /** 「我的」编辑头像 / 昵称面板打开时隐藏底部导航（底部抽屉不被导航压住）；关闭恢复（v1.68） */
  const [profileOverlay, setProfileOverlay] = useState(false)
  /** 「我的 → 观看历史 / 收藏」点音乐条目跳过来要播的歌（进音乐 Tab 后由 MusicScreen 消费） */
  const [musicAutoTrack, setMusicAutoTrack] = useState<number | null>(null)
  /** v1.76 从题库页进练习 → 返回题库页时自动重新展开原来那套题库的练习面板（接着选别的章节）。
      值 = 题库 id；QuestionBankScreen 挂载后消费一次并回调清空。 */
  const [restoreSetId, setRestoreSetId] = useState<number | null>(null)
  /** v1.85 软键盘弹出（搜索 / 填答案）时收起底部导航，屏幕上只留输入框和键盘。
      各页自己的「底部按钮条」也各自用这个 hook 判断（PracticeScreen / ExamScreen）。 */
  const softKeyboard = useSoftKeyboard()

  /* 实时通道（SSE 长连接）：登录后自动建立、退出登录自动断开。
     通知 / 评论回复 / 版本更新 / 被踢下线都走它，不用等 30 秒轮询。 */
  useRealtime()

  /* v1.70：进过一次音乐 Tab 后就把 MusicScreen 常驻挂上（此后切 Tab 不卸载，音乐后台不停） */
  useEffect(() => {
    if (activeTab === 'music') setMusicMounted(true)
  }, [activeTab])

  /* 新版本检测：进 App 查一次 + 收到服务端推送的 update 事件 */
  const { update, dismiss: dismissUpdate, applyUpdate } = useAppUpdate()

  /* 被踢下线的说明文案（改密码 / 管理员重置密码 / 封号 / 删号 → 退回登录页时告诉考生原因） */
  const [kickNotice, setKickNotice] = useState('')

  useEffect(() => {
    const onKick = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
      setKickNotice(reason || '登录已失效，请重新登录')
    }
    window.addEventListener(REALTIME_EVENT.KICK, onKick)
    return () => window.removeEventListener(REALTIME_EVENT.KICK, onKick)
  }, [])

  /* 提示条几秒后自动消失，别一直占着登录页顶部 */
  useEffect(() => {
    if (!kickNotice) return
    const timer = window.setTimeout(() => setKickNotice(''), 6000)
    return () => window.clearTimeout(timer)
  }, [kickNotice])

  /* 会话失效（管理员重置密码踢会话 / 令牌过期）→ 自动退回登录页。
     事件由 client.ts 在收到 401 时广播。
     注意：这里**不清**页面记忆 —— 重新登录后会回到被踢走时那一页（登录事件里还原）。 */
  useEffect(() => {
    const onSessionExpired = () => {
      // 被踢下线时 realtime 已经写了原因，别覆盖它（同一个批次里 prev 就是那个原因）
      setKickNotice(prev => prev || '登录已过期，请重新登录')
      /* v1.71：会话失效也要停掉音乐 —— 音频 URL 带 token，token 失效后继续播会报错，
         而且播放器在全局引擎里，不会因为 MusicScreen 卸载而自动停止。 */
      musicEngine.stop()
      setView({ name: 'login' })
    }
    window.addEventListener('ndt:session-expired', onSessionExpired)
    return () => window.removeEventListener('ndt:session-expired', onSessionExpired)
  }, [])

  /* 页面记忆：切页 / 切 Tab 就落盘，刷新或重开 App 时 bootState() 会读它还原现场 */
  useEffect(() => {
    const snapshot = serializeView(view)
    if (snapshot) rememberView({ view: snapshot, tab: activeTab })
  }, [view, activeTab])

  const goMain = useCallback((tab: Tab = 'home') => {
    setActiveTab(tab)
    setView({ name: 'main', tab })
  }, [])

  /* ── 微信小程序 web-view 侧滑返回同步（v1.82）────────────────────────
     微信里左右侧滑会触发 H5 的 history.back。登录成功后若 history 里还留着
     登录页，侧滑就会回到登录页；退出登录后若 history 里留着主界面，侧滑又
     会进入主界面。这里在状态切换时用 replaceState 覆盖当前 history 条目，
     让 history 栈里始终只有「当前这一屏」，侧滑没有上一页可回 → 直接退出
     小程序；popstate 兜底处理极端情况。 */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history) return
    const logged = isLoggedIn()
    const path = window.location.pathname || '/'
    if (view.name === 'main' && logged) {
      window.history.replaceState({ ndt_view: 'main' }, '', path)
    } else if ((view.name === 'login' || view.name === 'onboarding' || view.name === 'legal') && !logged) {
      window.history.replaceState({ ndt_view: 'login' }, '', '/login')
    }
  }, [view.name])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      const logged = isLoggedIn()
      /* 已登录却出现在登录相关页：兜底回到主界面 */
      if (logged && (view.name === 'login' || view.name === 'onboarding' || view.name === 'legal')) {
        goMain('home')
        return
      }
      /* 未登录却出现在主界面：兜底回到登录页 */
      if (!logged && view.name === 'main') {
        setView({ name: 'login' })
      }
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [view.name, goMain])

  /* ── v1.71 注册「回到音乐页」入口给全局迷你播放条 ──────────────────
     迷你播放条挂在 AppShell 外面（见文件末尾的 App），拿不到这里的 goMain，
     所以用「注册回调」的方式打通：点迷你条 → 切回音乐 Tab 并展示播放页。
     AppShell 始终处于挂载状态（整页视图只是提前返回不同 JSX），所以回调一直有效。 */
  useEffect(() => {
    setOpenMusicPageHandler(() => goMain('music'))
    return () => setOpenMusicPageHandler(null)
  }, [goMain])

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
      case 'theme-store':     setView({ name: 'theme-store' }); break
      case 'settings':        setView({ name: 'settings' }); break
      default:                goMain('home')
    }
  }, [goMain, activeTab])

  /* 进练习：opts 可带 topic（章节）/ mode（顺序·随机·错题重练）/ qtype（题型）/ setId（自定义题库）
     v1.76：同时把「进练习前的这一页」记进 backTo —— 退出 / 交卷后回到那里，不再一律回首页。
     各调用方（首页 / 题库 / 题库系列 / 错题 / 学习 / 成绩记录）都不用传，这里自动记。 */
  const handleStartPractice = useCallback((categoryId: string, opts?: PracticeOpts) => {
    setView(prev => {
      /* 已经在练习链路里（结果页「再次练习」）→ 沿用最初的来源，别把练习页自己当成来源 */
      const inPracticeFlow = prev.name === 'practice' || prev.name === 'practice-result'
      const backTo = opts?.backTo ?? (inPracticeFlow ? (prev as { backTo?: AppView }).backTo : prev)
      return { name: 'practice', categoryId, topic: opts?.topic, mode: opts?.mode, qtype: opts?.qtype, setId: opts?.setId, setTitle: opts?.setTitle, backTo }
    })
  }, [])

  /* 离开练习（退出 / 交卷后点返回）：回到「进练习前那一页」
     - 来源是主界面 → 切回对应 Tab（题库里进的练习就回题库）
     - 来源是整页视图（题库系列 / 成绩记录）→ 原样还原
     - 没有来源（如刷新后直接落在练习页）→ 回首页兜底
     回题库页时顺手带上 setId：题库页会自动重新展开那套题库的练习面板 */
  const leavePractice = useCallback((backTo?: AppView, setId?: number) => {
    if (!backTo) { setRestoreSetId(null); goMain('home'); return }
    if (backTo.name === 'main') {
      setRestoreSetId(backTo.tab === 'questions' && typeof setId === 'number' ? setId : null)
      goMain(backTo.tab)
      return
    }
    setRestoreSetId(null)
    setView(backTo)
  }, [goMain])

  /* 题库页消费完「重新展开哪套题库」后清空，避免之后每次切回题库 Tab 又自动弹面板 */
  const handleRestoreConsumed = useCallback(() => setRestoreSetId(null), [])

  /* 登录成功：① 打上「这台设备用过」标记（以后不再显示引导页）
     ② 有页面记忆就回到那一页（被踢下线 / 令牌过期后重登录会回到原处），没有则进首页
     ③ 主动「退出登录」会清掉记忆（见 handleLogout），所以退出后再登录仍从首页开始 */
  const handleLoginSuccess = useCallback(() => {
    markAppUsed()
    const snap = readRememberedView<ViewSnapshot>()
    const restored = parseView(snap?.view)
    if (restored) {
      if (restored.name === 'main') goMain(restored.tab)
      else {
        setActiveTab(isTab(snap?.tab) ? snap.tab : 'home')
        setView(restored)
      }
      return
    }
    goMain('home')
  }, [goMain])

  /** 主动退出登录：清掉页面记忆（下次登录从首页开始）+ 回登录页
      v1.71：同时停掉音乐（音频 URL 带 token，退出后 token 失效会报错；
      旧版靠 MusicScreen 卸载时清理媒体卡片来收尾，现在播放器在全局引擎里，必须显式停） */
  const handleLogout = useCallback(() => {
    musicEngine.stop()
    forgetView()
    setView({ name: 'login' })
  }, [])

  const handlePracticeComplete = useCallback((correct: number, total: number, timeSeconds: number) => {
    const prev = view as { name: 'practice'; categoryId: string } & PracticeOpts
    setView({
      name: 'practice-result', correct, total, timeSeconds,
      categoryId: prev.categoryId || 'UT',
      topic: prev.topic, mode: prev.mode, qtype: prev.qtype, setId: prev.setId, setTitle: prev.setTitle,
      /* 结果页也要能「返回上一级」，来源一路带下去 */
      backTo: prev.backTo,
    })
  }, [view])

  /* ── Render ── */

  if (view.name === 'onboarding') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
          <OnboardingScreen
            onComplete={() => {
              // 引导页看过了 → 这台设备不再是「新用户」，以后直接进登录页
              markAppUsed()
              setView({ name: 'login' })
            }}
          />
        </div>
      </div>
    )
  }

  if (view.name === 'login') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell relative">
          {/* 被踢下线的原因提示（实时通道推来的 kick 事件），几秒后自动消失 */}
          {kickNotice && (
            <div
              className="absolute left-4 right-4 z-50 anim-slide-up"
              style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
            >
              <div
                className="card p-3 flex items-start gap-2.5"
                style={{
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: 'var(--accent-border)',
                  background: 'var(--surface)',
                }}
              >
                <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }}>
                  <InfoIcon size={15} />
                </span>
                <p className="text-[11px] min-w-0 flex-1" style={{ color: 'var(--text-1)' }}>
                  {kickNotice}
                </p>
                <button onClick={() => setKickNotice('')} className="flex-shrink-0 p-0.5 tap" aria-label="关闭">
                  <XIcon size={13} color="var(--text-3)" />
                </button>
              </div>
            </div>
          )}
          <LoginScreen
            onSuccess={handleLoginSuccess}
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
            <LegalScreen key={`legal`} docKey={view.docKey} onBack={() => setView({ name: 'login' })} />
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
            onExit={() => leavePractice(view.backTo, view.setId)}
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
            <PracticeResultScreen key={`practice-result`}
              correct={view.correct}
              total={view.total}
              timeSeconds={view.timeSeconds}
              categoryId={view.categoryId}
              onRetry={() => setView({ name: 'practice', categoryId: view.categoryId, topic: view.topic, mode: view.mode, qtype: view.qtype, setId: view.setId, setTitle: view.setTitle, backTo: view.backTo })}
              onHome={() => leavePractice(view.backTo, view.setId)}
              onReviewWrong={() => goMain('wrong')}
              backLabel={backLabelOf(view.backTo)}
            />
        </div>
      </div>
    )
  }

  if (view.name === 'exam-setup') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
            <ExamSetupScreen key={`exam-setup`}
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
            <ExamResultScreen key={`exam-result`}
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
            <ExamDetailScreen key={`exam-detail`}
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
            <NotificationsScreen key={`notifications`} onBack={() => goMain('home')} />
        </div>
      </div>
    )
  }

  if (view.name === 'achievements') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
            <AchievementsScreen key={`achievements`} onBack={() => goMain('profile')} />
        </div>
      </div>
    )
  }

  if (view.name === 'score-records') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
            <ScoreRecordsScreen key={`score-records`}
              onBack={() => goMain('profile')}
              onStartPractice={handleStartPractice}
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
            <WatchHistoryScreen key={`watch-history`}
              onBack={() => goMain(from === 'materials' ? 'materials' : 'profile')}
              onOpenVideo={(materialId) =>
                setView({ name: 'video-detail', materialId, from: 'history', historyFrom: from })
              }
              onOpenMusic={(trackId) => { setMusicAutoTrack(trackId); goMain('music') }}
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
            <FavoriteVideosScreen key={`favorites`}
              onBack={() => goMain('profile')}
              onOpenVideo={(materialId) => setView({ name: 'video-detail', materialId, from: 'favorites' })}
              onOpenMusic={(trackId) => { setMusicAutoTrack(trackId); goMain('music') }}
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
            <VideoDetailScreen key={`video-detail-${view.materialId}`}
              materialId={view.materialId}
              onBack={() => {
                if (from === 'favorites') setView({ name: 'favorites' })
                else if (from === 'history') setView({ name: 'watch-history', from: historyFrom })
                else if (from === 'series' && view.seriesBack) setView({ name: 'series-detail', series: view.seriesBack })
                else goMain('materials')
              }}
            />
        </div>
      </div>
    )
  }

  /* 系列详情页：某个系列里的全部视频与教材资料（返回回到大类页） */
  if (view.name === 'series-detail') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
            <SeriesDetailScreen key={`series-detail`}
              series={view.series}
              onBack={() => goMain('materials')}
              onOpenVideo={(materialId) =>
                setView({ name: 'video-detail', materialId, from: 'series', seriesBack: view.series })
              }
            />
        </div>
      </div>
    )
  }

  /* 题库系列详情页：某个题库系列里的全部题库（返回回到题库页） */
  if (view.name === 'bank-series') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
            <BankSeriesScreen key={`bank-series`}
              series={view.series}
              onBack={() => goMain('questions')}
              onStartPractice={handleStartPractice}
            />
        </div>
      </div>
    )
  }

  /* 主题商店：换个背景与配色（皮肤存本机，登录页与主界面一起生效） */
  if (view.name === 'theme-store') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
            <ThemeStoreScreen key={`theme-store`} onBack={() => goMain('profile')} />
        </div>
      </div>
    )
  }

  if (view.name === 'settings') {
    return (
      <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
        <div className="app-shell">
            <SettingsScreen key={`settings`}
              onBack={() => goMain('profile')}
              onLogout={handleLogout}
            />
        </div>
      </div>
    )
  }

  /* ── 主 Tab 布局 ── */
  return (
    <div className="safe-top safe-bottom min-h-screen bg-page flex items-center justify-center">
      <div className="app-shell relative flex flex-col">
        {/* v1.68：全站下拉刷新已删除（用户要求），各页数据靠自身 useEffect / 页面内刷新按钮更新。
            内容层 key 保留 —— 切 Tab 时用它把上一屏卸载干净，避免状态串页。 */}
        <div className="w-full" key={activeTab}>
          {activeTab === 'home' && (
            <HomeScreen onNavigate={handleNavigate} onStartPractice={handleStartPractice} />
          )}
          {activeTab === 'questions' && (
            <QuestionBankScreen
              onStartPractice={handleStartPractice}
              onOpenBankSeries={(series: BankSeries) => setView({ name: 'bank-series', series })}
              /* v1.76：从这套题库进的练习，返回时自动重新展开它的练习面板（接着选别的章节） */
              restoreSetId={restoreSetId}
              onRestoreConsumed={handleRestoreConsumed}
            />
          )}
          {activeTab === 'materials' && (
            <MaterialsScreen
              onNavigate={handleNavigate}
              onOpenVideo={(materialId) => setView({ name: 'video-detail', materialId, from: 'materials' })}
              onOpenSeries={(series) => setView({ name: 'series-detail', series })}
            />
          )}
          {activeTab === 'wrong' && (
            <WrongQuestionsScreen onStartPractice={handleStartPractice} onBack={() => goMain('profile')} />
          )}
          {activeTab === 'learning' && (
            <LearningScreen onStartPractice={handleStartPractice} onBack={() => goMain('profile')} />
          )}
          {activeTab === 'profile' && (
            <ProfileScreen onNavigate={handleNavigate} onOverlayChange={setProfileOverlay} />
          )}
        </div>

        {/* v1.70 音乐 Tab 常驻挂载（后台播放核心）：切走 Tab 时仅隐藏不卸载，音频元素活着 → 歌不停。
            首次进音乐 Tab 由上面的 effect 置 true 挂载；此后回到音乐 Tab 只是取消隐藏。 */}
        {musicMounted && (
          <div className="w-full" style={activeTab === 'music' ? undefined : { display: 'none' }}>
            <MusicScreen
              active={activeTab === 'music'}
              onBack={() => goMain('home')}
              onOverlayChange={setMusicOverlay}
              onRequestSwitchToMusic={() => goMain('music')}
              autoTrackId={musicAutoTrack ?? undefined}
              onAutoTrackConsumed={() => setMusicAutoTrack(null)}
            />
          </div>
        )}

        {/* 新通知横幅提示：监听 useNotifications 的 'ndt-new-notify' 事件，点击进通知中心 */}
        <NotifyToast onOpen={() => handleNavigate('notifications')} />

        {/* 新版本提示：普通版本 = 底部提示条（可稍后）；强制更新 = 不可关闭的弹层。
            只挂在主 Tab 布局 —— 练习 / 考试 / 成绩页一律不打扰，交卷回到这里再提示 */}
        {update && <UpdateBanner info={update} onDismiss={dismissUpdate} onUpdate={applyUpdate} />}

        {/* App 底部导航：音乐 Tab 内播放中且未手动唤出（musicOverlay）或「我的」编辑资料面板打开时隐藏。
            v1.70：musicOverlay 只在 activeTab === 'music' 时生效 —— 切去别的 Tab 导航必显示，
            音乐后台继续放；音乐页的「显示导航栏」按钮负责在播放中把导航唤出来。
            v1.81：音乐页的**全屏播放页 / 歌词页**由 MusicScreen 无条件上报 overlay=true（强制没有
            底部导航，暂停也不出现），本文件逻辑不用改。
            v1.85：软键盘弹出（搜索框 / 计算题答案框获得焦点）时也收起导航，只留键盘。
            onOverlayChange 的调用方（MusicScreen / ProfileScreen）都会在卸载时兜底恢复。 */}
        {!(musicOverlay && activeTab === 'music') && !profileOverlay && !softKeyboard && (
          <BottomNav activeTab={activeTab} onChange={handleTabChange} />
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   v1.72 顶层 App：AppShell（原有全部界面与状态机）+ 全局悬浮球播放器
   ------------------------------------------------------------------------
   之所以要把悬浮球放在 AppShell 外面：AppShell 内部的整页视图
   （观看历史 / 收藏 / 设置 / 搜索 / 通知 / 做题 / 考试 / 看视频 …）都是提前 return 的，
   那些分支不会渲染到 AppShell 末尾的 JSX。挂在这一层就与分支无关，永远都在。

   悬浮球自己判断该不该显示（音乐页不可见 且 当前有曲目），
   所以放在这里也不会和音乐页自带的悬浮条同时出现。
   ============================================================================ */
export default function App() {
  return (
    <>
      <AppShell />
      <GlobalMusicFab />
      {/* v1.73 音乐动效设置弹层：入口是「长按悬浮球」。
          必须和悬浮球同级挂在这里 —— 悬浮球在音乐页可见时整体返回 null，
          弹层跟着它就会被连带关掉。 */}
      <GlobalMusicFxSheet />
    </>
  )
}
