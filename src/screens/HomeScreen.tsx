import React, { useState, useEffect } from 'react'
import { ProgressRing } from '../components/ProgressRing'
import {
  BellIcon, SearchIcon, PlayIcon, ShuffleIcon, ClipboardIcon, RefreshIcon,
  TargetIcon, PencilIcon, ClockIcon, FlameIcon, ChevronRightIcon, CheckIcon, PercentIcon,
  ActivityIcon, ZapIcon, StarIcon, FlagIcon, RulerIcon,
} from '../components/icons'
import { userStats, trainingSets, achievements, wrongRecords, getQuestionById } from '../data/mockData'
import type { Screen } from '../types'

/* ============================================================
   首页（苹果式浅色）
   结构保持：顶栏问候 / 今日进度卡 / 快捷入口 / 学习数据 / 周趋势 / 推荐训练 / 最近错题 / 成就
   修改注意：颜色一律用 index.css 令牌，图标用 icons.tsx
   ============================================================ */

interface HomeScreenProps {
  onNavigate: (screen: Screen) => void
  onStartPractice: (categoryId: string) => void
}

/* 成就图标映射：数据里是 emoji，渲染时换成极简线性图标 */
const achIconMap: Record<string, React.ReactNode> = {
  '🏁': <FlagIcon size={22} />,
  '🔥': <FlameIcon size={22} />,
  '〜': <ActivityIcon size={22} />,
  '⚡': <ZapIcon size={22} />,
  '✦': <StarIcon size={22} />,
  '📐': <RulerIcon size={22} />,
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

/* 极简柱状图：只保留柱与日期，无网格线、无装饰 */
function WeeklyBar({ days, values }: { days: string[]; values: number[] }) {
  const max = Math.max(...values)
  return (
    <div className="flex items-end gap-2.5 h-16">
      {days.map((day, i) => {
        const isToday = i === days.length - 1
        const h = Math.max(Math.round((values[i] / max) * 100), 4)
        return (
          <div key={day} className="flex flex-col items-center gap-1.5 flex-1">
            <div className="w-full rounded-[5px]" style={{ height: `${h}%`, background: isToday ? 'var(--accent)' : '#DFE2E6' }} />
            <span className="text-[9px] font-medium" style={{ color: isToday ? 'var(--accent)' : 'var(--text-3)' }}>{day}</span>
          </div>
        )
      })}
    </div>
  )
}

const quickActions: Array<{ id: string; label: string; sub: string; icon: React.ReactNode; screen: Screen }> = [
  { id: 'continue', label: '继续学习', sub: 'UT · 第12/50题', icon: <PlayIcon size={18} />, screen: 'practice' },
  { id: 'random', label: '随机刷题', sub: '500+ 题目随机', icon: <ShuffleIcon size={18} />, screen: 'question-bank' },
  { id: 'exam', label: '模拟考试', sub: '标准考试模式', icon: <ClipboardIcon size={18} />, screen: 'exam-setup' },
  { id: 'wrong', label: '错题复习', sub: `${wrongRecords.filter(w => !w.mastered).length} 道待复习`, icon: <RefreshIcon size={18} />, screen: 'wrong-questions' },
]

export function HomeScreen({ onNavigate, onStartPractice }: HomeScreenProps) {
  const [visible, setVisible] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVisible(true), 50); return () => clearTimeout(t) }, [])

  const progress = userStats.todayTotal > 0
    ? Math.round((userStats.todayCorrect / userStats.todayTotal) * 100)
    : 0

  const todayProgress = Math.round((userStats.todayTotal / 60) * 100)

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* ── 顶栏：问候 ── */}
        <div className={`flex items-center justify-between px-5 pt-14 pb-5 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
              style={{
                background: 'var(--accent-weak)',
                color: 'var(--accent)',
                border: '1px solid rgba(255,255,255,0.9)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 2px 6px rgba(95,141,140,0.18)',
              }}
            >
              张
            </div>
            <div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>晚上好</div>
              <div className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{userStats.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onNavigate('notifications')} className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.7)' }}>
              <span style={{ color: 'var(--text-2)' }}><BellIcon size={18} /></span>
            </button>
            <button onClick={() => onNavigate('search')} className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.7)' }}>
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
                  今天也来做几道题吧
                </h2>
              </div>
              <div
                className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
                style={{
                  background: 'rgba(95,141,140,0.16)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(95,141,140,0.35)',
                  boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.75), inset -1px -1px 0 rgba(95,141,140,0.10), 0 2px 8px rgba(95,141,140,0.14)',
                }}
              >
                <span className="flame-flicker inline-flex"><FlameIcon size={13} /></span> {userStats.streak} 天连续
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
                    <span className="text-xl" style={{ color: 'var(--accent)' }}>{userStats.todayTotal}</span>
                    <span className="text-sm font-normal" style={{ color: 'var(--text-3)' }}> / 60 题</span>
                  </div>
                </div>

                {/* 三个略微凸起的子面板 */}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { icon: <CheckIcon size={12} strokeWidth={2.4} />, label: '正确', value: String(userStats.todayCorrect), color: 'var(--ok)', iconBg: 'var(--ok-weak)' },
                    { icon: <PercentIcon size={12} />, label: '正确率', value: `${progress}%`, color: 'var(--accent)', iconBg: 'var(--accent-weak)' },
                    { icon: <ClockIcon size={12} />, label: '学习时长', value: '1h 24m', color: 'var(--text-1)', iconBg: '#EDEFF2' },
                  ].map(s => (
                    <div
                      key={s.label}
                      className="rounded-xl px-2.5 py-2"
                      style={{
                        background: 'rgba(255,255,255,0.72)',
                        border: '1px solid rgba(255,255,255,0.90)',
                        boxShadow: '0 2px 8px rgba(27,30,35,0.05), inset 0 1px 0 rgba(255,255,255,0.95)',
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
                onClick={() => onNavigate(action.screen)}
                className="glass-panel rounded-2xl p-4 text-left card-tap"
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center mb-3"
                  style={{
                    background: 'var(--accent-weak)',
                    border: '1px solid var(--accent-border)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.80), 0 2px 6px rgba(95,141,140,0.18)',
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

        {/* ── 学习数据 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>学习数据</h3>
            <button className="text-xs tap" style={{ color: 'var(--text-3)' }}>本周 <ChevronRightIcon size={12} /></button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            <StatCard value={`${progress}%`} label="今日正确率" sub="较昨日 +3%" icon={<TargetIcon size={17} />} />
            <StatCard value={`${userStats.weeklyQuestions}`} label="本周答题" sub="日均 40 题" icon={<PencilIcon size={17} />} />
            <StatCard value="3h 24m" label="学习时长" sub="本周合计" icon={<ClockIcon size={17} />} />
            <StatCard value={`${userStats.streak}天`} label="连续打卡" sub="最高 18 天" icon={<FlameIcon size={17} />} />
          </div>
        </div>

        {/* ── 本周趋势 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-200 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>本周答题趋势</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>共 {userStats.weeklyQuestions} 道题</p>
              </div>
              <span className="text-xs font-medium" style={{ color: 'var(--ok)' }}>↑ 12%</span>
            </div>
            <WeeklyBar
              days={['周一', '周二', '周三', '周四', '周五', '周六', '今天']}
              values={[32, 45, 38, 52, 41, 60, 42]}
            />
          </div>
        </div>

        {/* ── 推荐训练 ── */}
        <div className={`mb-6 transition-all duration-500 delay-250 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="flex items-center justify-between px-4 mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>推荐训练</h3>
            <button onClick={() => onNavigate('question-bank')} className="text-xs tap" style={{ color: 'var(--text-3)' }}>全部 <ChevronRightIcon size={12} /></button>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2">
            {trainingSets.map((ts) => (
              <button
                key={ts.id}
                onClick={() => onStartPractice(ts.category)}
                className="card flex-shrink-0 w-60 p-4 text-left card-tap"
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
                    {ts.category}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {ts.difficulty === 'easy' ? '入门' : ts.difficulty === 'medium' ? '中等' : '进阶'}
                  </span>
                </div>
                <div className="font-semibold text-sm mb-1" style={{ color: 'var(--text-1)' }}>{ts.title}</div>
                <div className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>{ts.description}</div>
                <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-2)' }}>
                  <span>剩余 {ts.questionCount - ts.completedCount} 题</span>
                  <span>约 {ts.estimatedMinutes} 分钟</span>
                </div>
                <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: '#EDEFF2' }}>
                  <div
                    className="h-full rounded-full progress-fill"
                    style={{ width: `${(ts.completedCount / ts.questionCount) * 100}%`, background: 'var(--accent)' }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── 最近错题 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>最近错题</h3>
            <button onClick={() => onNavigate('wrong-questions')} className="text-xs tap" style={{ color: 'var(--text-3)' }}>全部 <ChevronRightIcon size={12} /></button>
          </div>
          <div className="space-y-2.5">
            {wrongRecords.filter(w => !w.mastered).slice(0, 3).map(record => {
              const q = getQuestionById(record.questionId)
              if (!q) return null
              return (
                <button
                  key={record.questionId}
                  onClick={() => onNavigate('wrong-questions')}
                  className="w-full card p-4 text-left card-tap"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                      style={{ background: 'var(--err-weak)', color: 'var(--err)', border: '1px solid var(--err-border)' }}
                    >
                      {q.category}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-2)' }}>{q.text}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>错误 {record.wrongCount} 次</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{q.knowledgePoint}</span>
                      </div>
                    </div>
                    <ChevronRightIcon size={14} className="mt-1 flex-shrink-0" color="var(--text-3)" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── 成就 ── */}
        <div className={`px-4 mb-6 transition-all duration-500 delay-350 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>成就</h3>
            <button onClick={() => onNavigate('achievements')} className="text-xs tap" style={{ color: 'var(--text-3)' }}>查看全部 <ChevronRightIcon size={12} /></button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {achievements.map(ach => (
              <button key={ach.id} className="flex-shrink-0 w-[72px] flex flex-col items-center gap-2 tap">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center"
                  style={{
                    background: ach.earned ? 'var(--accent-weak)' : '#EDEFF2',
                    border: ach.earned ? '1px solid var(--accent-border)' : '1px solid var(--line)',
                    color: ach.earned ? 'var(--accent)' : 'var(--text-3)',
                    opacity: ach.earned ? 1 : 0.6,
                  }}
                >
                  {achIconMap[ach.icon] || <StarIcon size={20} />}
                </div>
                <span className="text-[10px] text-center leading-tight" style={{ color: 'var(--text-2)' }}>{ach.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
