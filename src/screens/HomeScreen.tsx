import React, { useState, useEffect } from 'react'
import { ProgressRing } from '../components/ProgressRing'
import { Avatar } from '../components/Avatar'
import { RandomDrillSheet } from '../components/RandomDrillSheet'
import { useProfile } from '../hooks/useProfile'
import { useNotifications } from '../hooks/useNotifications'
import { useHomeData } from '../hooks/useHomeData'
import { studyReminderOn, reviewReminderOn } from '../data/notifyPrefs'
import {
  BellIcon, SearchIcon, PlayIcon, ShuffleIcon, ClipboardIcon, RefreshIcon,
  TargetIcon, PencilIcon, ClockIcon, FlameIcon, ChevronRightIcon, CheckIcon, PercentIcon,
} from '../components/icons'
import type { Screen } from '../types'

/* ============================================================
   首页（苹果式浅色）
   结构保持：顶栏问候 / 今日进度卡 / 快捷入口 / 学习数据 / 周趋势 / 推荐训练 / 最近错题
   （原「成就」区已按需求移除；成就入口仍在「我的」页）
   数据来源（全部实时，来自服务端数据库，每个账号只看到自己的数据）：
     - 学习统计 → useHomeData → GET /api/user/stats/summary
     - 题库概览 → useHomeData → GET /api/bank/summary
     - 最近错题 → useHomeData → GET /api/user/wrong-questions?limit=3
     - 昵称头像 → useProfile（登录账号资料）
   修改注意：颜色一律用 index.css 令牌，图标用 icons.tsx；不要把 Mock 数据加回来
   ============================================================ */

interface HomeScreenProps {
  onNavigate: (screen: Screen) => void
  onStartPractice: (categoryId: string, opts?: { topic?: string; mode?: 'sequential' | 'random' | 'wrong'; qtype?: string }) => void
}

/** 秒 → 「1h 24m」格式 */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function StatCard({ value, label, sub, icon }: { value: string; label: string; sub?: string; icon: React.ReactNode }) {
  return (
    <div className="glass rounded-2xl p-4 flex-shrink-0 w-36">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-2.5" style={{ background: 'var(--accent-weak)' }}>
        <span style={{ color: 'var(--accent)' }}>{icon}</span>
      </div>
      <div className="text-xl font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>{label}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  )
}

/* 极简柱状图：只保留柱与日期，无网格线、无装饰
   注意：柱高必须用 px 计算——外层列高由内容撑开，百分比高度解析不出来（踩过：柱子全隐形） */
function WeeklyBar({ days, values }: { days: string[]; values: number[] }) {
  const max = Math.max(...values, 0)
  const CHART_H = 44 // 柱子可用的最大像素高度
  return (
    <div className="flex items-end gap-2.5">
      {days.map((day, i) => {
        const isToday = i === days.length - 1
        const h = max > 0 ? Math.max(Math.round((values[i] / max) * CHART_H), 4) : 4
        return (
          <div key={day} className="flex flex-col items-center gap-1.5 flex-1">
            <span
              className="text-[9px] font-semibold leading-none"
              style={{ color: isToday ? 'var(--accent)' : 'var(--text-3)', opacity: values[i] > 0 ? 1 : 0.45, fontVariantNumeric: 'tabular-nums' }}
            >
              {values[i]}
            </span>
            <div
              className="w-full rounded-[5px] transition-all duration-500"
              style={{ height: `${h}px`, background: isToday ? 'var(--accent)' : 'var(--line-strong)' }}
            />
            <span className="text-[9px] font-medium" style={{ color: isToday ? 'var(--accent)' : 'var(--text-3)' }}>{day}</span>
          </div>
        )
      })}
    </div>
  )
}

export function HomeScreen({ onNavigate, onStartPractice }: HomeScreenProps) {
  const { profile } = useProfile()
  /** 未读通知数：铃铛红点（数据来自 useNotifications → /api/user/notifications） */
  const { unread } = useNotifications()
  /** 首页实时数据：学习统计 + 题库概览 + 最近错题 */
  const { loading, bank, stats, wrongPreview } = useHomeData()
  const [visible, setVisible] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVisible(true), 50); return () => clearTimeout(t) }, [])

  /** 问候栏显示的昵称：优先账号资料 */
  const displayName = profile?.nickname || profile?.account || '同学'
  /** 按时间问候 */
  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 6) return '凌晨好'
    if (h < 11) return '早上好'
    if (h < 13) return '中午好'
    if (h < 18) return '下午好'
    return '晚上好'
  })()

  /* ── 实时统计（未加载完时显示占位） ── */
  const todayTotal = stats?.today_total ?? 0
  const todayCorrect = stats?.today_correct ?? 0
  const accuracy = stats?.today_accuracy ?? 0
  const streak = stats?.streak_days ?? 0
  const todayDuration = formatDuration(stats?.today_duration_seconds ?? 0)
  const weeklyTotal = stats?.weekly_total ?? 0
  const totalAnswered = stats?.total_answered ?? 0
  const wrongPending = stats?.wrong_pending ?? 0
  const bankTotal = bank?.total ?? 0

  const todayProgress = stats
    ? Math.min(Math.round((todayTotal / (stats.daily_goal || 60)) * 100), 100)
    : 0

  /* ── 快捷入口：副标题全部用实时数据 ── */
  const continueMethod = stats?.last_method || 'UT'
  const quickActions: Array<{ id: string; label: string; sub: string; icon: React.ReactNode; screen: Screen }> = [
    { id: 'continue', label: '继续学习', sub: `${continueMethod} · 已答 ${totalAnswered} 题`, icon: <PlayIcon size={18} />, screen: 'practice' },
    { id: 'random', label: '随机刷题', sub: `${bankTotal} 道题目随机`, icon: <ShuffleIcon size={18} />, screen: 'question-bank' },
    { id: 'exam', label: '模拟考试', sub: '标准考试模式', icon: <ClipboardIcon size={18} />, screen: 'exam-setup' },
    { id: 'wrong', label: '错题复习', sub: wrongPending > 0 ? `${wrongPending} 道待复习` : '暂无待复习错题', icon: <RefreshIcon size={18} />, screen: 'wrong-questions' },
  ]

  /** 随机刷题选择面板开关（选方向 + 题型 → 随机出题） */
  const [randomSheetOpen, setRandomSheetOpen] = useState(false)

  /* ── 提醒条（设置 → 通知 开关控制，数据来自实时统计） ──
     - 学习提醒开 + 今天还没答题 → 「今天还没有练习」
     - 错题复习提醒开 + 有待复习错题 → 「错题待复习」 */
  const reminders: Array<{ key: string; icon: React.ReactNode; title: string; sub: string; action: () => void }> = []
  if (stats && studyReminderOn() && stats.today_total === 0) {
    reminders.push({
      key: 'study',
      icon: <PencilIcon size={15} />,
      title: '今天还没有练习',
      sub: '完成一组题，保持手感',
      action: () => onStartPractice(continueMethod),
    })
  }
  if (stats && reviewReminderOn() && stats.wrong_pending > 0) {
    reminders.push({
      key: 'review',
      icon: <RefreshIcon size={15} />,
      title: `有 ${stats.wrong_pending} 道错题待复习`,
      sub: '趁热打铁，错题重练一遍',
      action: () => onStartPractice('综合', { mode: 'wrong' }),
    })
  }

  /* 继续学习：带着上次方向进练习；随机刷题：打开选择面板（方向 + 题型）；
     错题复习：有待复习错题时直接进「错题重练」（错题随机重做一遍），没有则去错题集 */
  function handleQuickAction(action: { id: string; screen: Screen }) {
    if (action.id === 'continue') {
      onStartPractice(continueMethod)
      return
    }
    if (action.id === 'random') {
      setRandomSheetOpen(true)
      return
    }
    if (action.id === 'wrong') {
      if (wrongPending > 0) {
        onStartPractice('综合', { mode: 'wrong' })
      } else {
        onNavigate('wrong-questions')
      }
      return
    }
    onNavigate(action.screen)
  }

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* ── 顶栏：问候 ── */}
        <div className={`flex items-center justify-between px-5 pt-14 pb-5 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center gap-3">
            <Avatar value={profile?.avatar || ''} name={displayName} size={40} />
            <div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>{greeting}</div>
              <div className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{displayName}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* 注意：.gb 按钮自带 overflow:hidden，角标必须放在按钮外的 relative 包裹层上，否则会被裁掉 */}
            <div className="relative">
              <button onClick={() => onNavigate('notifications')} className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center" style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}>
                <span style={{ color: 'var(--text-2)' }}><BellIcon size={18} /></span>
              </button>
              {/* 未读角标：有多少条未读就显示多少（超 9 条显示 9+） */}
              {unread > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold leading-none"
                  style={{
                    background: 'var(--err)',
                    color: '#FFFFFF',
                    border: '2px solid var(--bg)',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                  }}
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </div>
            <button onClick={() => onNavigate('search')} className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center" style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}>
              <span style={{ color: 'var(--text-2)' }}><SearchIcon size={18} /></span>
            </button>
          </div>
        </div>

        {/* ── 今日进度卡片 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-100 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="card glass-glow p-5">
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-3)' }}>今日学习进度</p>
                <h2 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
                  {loading ? '正在同步学习数据…' : todayTotal > 0 ? '今天已经答了题，继续加油' : '今天也来做几道题吧'}
                </h2>
              </div>
              <div
                className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
                style={{
                  background: 'rgba(95,141,140,0.16)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(95,141,140,0.35)',
                  boxShadow: 'inset 1px 1px 0 var(--chip-border), inset -1px -1px 0 rgba(95,141,140,0.10), 0 2px 8px var(--accent-weak)',
                }}
              >
                <span className="flame-flicker inline-flex"><FlameIcon size={13} /></span> {streak} 天连续
              </div>
            </div>

            <div className="flex items-center gap-5">
              <ProgressRing progress={todayProgress} size={92} strokeWidth={7} gradient={['#5F8D8C', '#8FB8A4']} className="ring-glow">
                <div className="text-center">
                  <div className="text-lg font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{todayProgress}%</div>
                </div>
              </ProgressRing>

              <div className="flex-1">
                <div>
                  <div className="text-xs mb-0.5" style={{ color: 'var(--text-3)' }}>今日答题</div>
                  <div className="font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                    <span className="text-xl" style={{ color: 'var(--accent)' }}>{todayTotal}</span>
                    <span className="text-sm font-normal" style={{ color: 'var(--text-3)' }}> / {stats?.daily_goal ?? 60} 题</span>
                  </div>
                </div>

                {/* 三个略微凸起的子面板 */}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { icon: <CheckIcon size={12} strokeWidth={2.4} />, label: '正确', value: String(todayCorrect), color: 'var(--ok)', iconBg: 'var(--ok-weak)' },
                    { icon: <PercentIcon size={12} />, label: '正确率', value: `${accuracy}%`, color: 'var(--accent)', iconBg: 'var(--accent-weak)' },
                    { icon: <ClockIcon size={12} />, label: '学习时长', value: todayDuration, color: 'var(--text-1)', iconBg: 'var(--track)' },
                  ].map(s => (
                    <div
                      key={s.label}
                      className="rounded-xl px-2.5 py-2"
                      style={{
                        background: 'var(--chip-bg-soft)',
                        border: '1px solid var(--inset-hi)',
                        boxShadow: '0 2px 8px rgba(27,30,35,0.05), inset 0 1px 0 var(--inset-hi)',
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: s.iconBg, color: s.color }}>
                          {s.icon}
                        </span>
                        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>{s.label}</span>
                      </div>
                      <div className="text-sm font-bold leading-none" style={{ color: s.color, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── 快捷入口 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-150 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map(action => (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action)}
                className="glass-panel rounded-2xl p-4 text-left card-tap"
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center mb-3"
                  style={{
                    background: 'var(--accent-weak)',
                    border: '1px solid var(--accent-border)',
                    boxShadow: 'inset 0 1px 0 var(--inset-hi), 0 2px 6px rgba(95,141,140,0.18)',
                  }}
                >
                  <span style={{ color: 'var(--accent)' }}>{action.icon}</span>
                </div>
                <div className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{action.label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{action.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 提醒条（设置 → 通知 的开关控制；满足条件才出现） ── */}
        {reminders.length > 0 && (
          <div className="px-4 mb-5 space-y-2">
            {reminders.map(r => (
              <button
                key={r.key}
                onClick={r.action}
                className="w-full card p-3.5 flex items-center gap-3 text-left card-tap"
              >
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
                >
                  {r.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold" style={{ color: 'var(--text-1)' }}>{r.title}</span>
                  <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{r.sub}</span>
                </span>
                <ChevronRightIcon size={13} color="var(--text-3)" />
              </button>
            ))}
          </div>
        )}

        {/* ── 学习数据 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>学习数据</h3>
            <button className="text-xs tap" style={{ color: 'var(--text-3)' }}>本周 <ChevronRightIcon size={12} /></button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            <StatCard value={`${accuracy}%`} label="今日正确率" sub={`今日 ${todayTotal} 题`} icon={<TargetIcon size={17} />} />
            <StatCard value={`${weeklyTotal}`} label="本周答题" sub={`日均 ${Math.round(weeklyTotal / 7)} 题`} icon={<PencilIcon size={17} />} />
            <StatCard value={todayDuration} label="学习时长" sub="今日合计" icon={<ClockIcon size={17} />} />
            <StatCard value={`${streak}天`} label="连续打卡" sub={`累计 ${totalAnswered} 题`} icon={<FlameIcon size={17} />} />
          </div>
        </div>

        {/* ── 本周趋势 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>本周答题趋势</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>共 {weeklyTotal} 道题</p>
              </div>
              {(() => {
                const half = Math.floor((stats?.weekly.length ?? 0) / 2)
                const prev = (stats?.weekly ?? []).slice(0, half).reduce((s, d) => s + d.count, 0)
                const curr = (stats?.weekly ?? []).slice(half).reduce((s, d) => s + d.count, 0)
                if (prev === 0 || prev === curr) return null
                const up = curr > prev
                const pct = Math.min(Math.round((Math.abs(curr - prev) / prev) * 100), 999)
                return (
                  <span className="text-xs font-medium" style={{ color: up ? 'var(--ok)' : 'var(--err)' }}>
                    {up ? '↑' : '↓'} {pct}%
                  </span>
                )
              })()}
            </div>
            <WeeklyBar
              days={(stats?.weekly ?? []).map(w => w.label)}
              values={(stats?.weekly ?? []).map(w => w.count)}
            />
          </div>
        </div>

        {/* ── 推荐训练（真实题库：按方向推荐，进度是我已做题量占比） ── */}
        <div className={`mb-6 transition-all duration-500 delay-250 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="flex items-center justify-between px-4 mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>推荐训练</h3>
            <button onClick={() => onNavigate('question-bank')} className="text-xs tap" style={{ color: 'var(--text-3)' }}>全部 <ChevronRightIcon size={12} /></button>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2">
            {(bank?.methods ?? []).filter(m => m.count > 0).slice(0, 5).map((m, idx) => {
              const remaining = Math.max(m.count - m.answered, 0)
              const percent = m.count > 0 ? Math.round((m.answered / m.count) * 100) : 0
              return (
                <button
                  key={m.method}
                  onClick={() => onStartPractice(m.method)}
                  className="card flex-shrink-0 w-60 p-4 text-left card-tap"
                  style={{ animationDelay: `${idx * 0.05}s` }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
                      {m.method}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>{m.name} · 一级</span>
                  </div>
                  <div className="font-semibold text-sm mb-1" style={{ color: 'var(--text-1)' }}>{m.name} · 章节练习</div>
                  <div className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>官方题库 · 已完成 {percent}%</div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-2)' }}>
                    <span>剩余 {remaining} 题</span>
                    <span>共 {m.count} 题</span>
                  </div>
                  <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                    <div
                      className="h-full rounded-full progress-fill"
                      style={{ width: `${percent}%`, background: 'var(--accent)' }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 最近错题（实时：来自我的答题记录） ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>最近错题</h3>
            <button onClick={() => onNavigate('wrong-questions')} className="text-xs tap" style={{ color: 'var(--text-3)' }}>全部 <ChevronRightIcon size={12} /></button>
          </div>
          {wrongPreview.length === 0 ? (
            <div className="card p-5 flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--ok-weak)', color: 'var(--ok)' }}
              >
                <CheckIcon size={16} strokeWidth={2.4} />
              </div>
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>暂无待复习错题</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>做错的题会自动出现在这里</div>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {wrongPreview.map(record => (
                <button
                  key={record.id}
                  onClick={() => onNavigate('wrong-questions')}
                  className="w-full card p-4 text-left card-tap"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                      style={{ background: 'var(--err-weak)', color: 'var(--err)', border: '1px solid var(--err-border)' }}
                    >
                      {record.method}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-2)' }}>{record.content}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>错误 {record.wrong_count} 次</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{record.topic}</span>
                      </div>
                    </div>
                    <ChevronRightIcon size={14} className="mt-1 flex-shrink-0" color="var(--text-3)" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 随机刷题选择面板（方向 + 题型） ── */}
      {randomSheetOpen && (
        <RandomDrillSheet
          onClose={() => setRandomSheetOpen(false)}
          onStart={({ category, qtype }) => {
            setRandomSheetOpen(false)
            onStartPractice(category, { mode: 'random', qtype: qtype || undefined })
          }}
        />
      )}
    </div>
  )
}
