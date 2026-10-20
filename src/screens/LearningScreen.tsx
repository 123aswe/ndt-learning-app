import React, { useEffect, useMemo, useState } from 'react'
import { statsApi, type UserStatsReport } from '../api/client'
import { PencilIcon, TargetIcon, ClockIcon, FlameIcon, CalendarIcon, InfoIcon, ChevronRightIcon, ChevronLeftIcon } from '../components/icons'
import { useStagger } from '../hooks/useStagger'

/* ============================================================
   学习报告页（苹果式浅色）
   结构保持：标题 / 周期切换 / 汇总数字卡 / 学习日历 / 知识掌握度 / 学习建议 / 周目标
   数据全部实时：GET /api/user/stats/report?period=week|month
   - 汇总数字：周期内答题 / 正确率 / 时长（session 去重）/ 连续打卡
   - 学习日历：近 140 天每日答题量（接口返回），前端组装为真实月历（可翻月/选日期）
   - 知识掌握度：按方向全量统计的正确率
   ============================================================ */

interface LearningScreenProps {
  onStartPractice: (categoryId: string) => void
  /** 返回上一级（我的页） */
  onBack?: () => void
}

/** 目标常量（与产品口径一致：周 300 题 / 300 分钟 / 正确率 85%） */
const GOAL_QUESTIONS = 300
const GOAL_MINUTES = 300
const GOAL_ACCURACY = 85

/* ============================================================
   学习日历（Material Design 3 风格真实月历）
   - 后端返回近 140 天每日答题量，前端按「月」组装真实月历
   - 左右翻月（限制在数据起点 ~ 本月）、点选任意日期
   - 每个日期格：日期数字 + 当日答题量；色深映射答题量
   - 全部颜色走语义令牌（color-mix 引用 --accent），深浅色主题自适应
   ============================================================ */

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmtDate = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function StudyCalendar({ calendar }: { calendar: UserStatsReport['calendar'] }) {
  const byDate = useMemo(() => new Map(calendar.map(d => [d.date, d.count])), [calendar])
  const maxCount = useMemo(() => Math.max(1, ...calendar.map(d => d.count)), [calendar])

  const now = new Date()
  const todayStr = fmtDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
  const [view, setView] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() + 1 }))
  const [selected, setSelected] = useState(todayStr)

  /* 可翻阅范围：数据最早一天所在月 ~ 本月 */
  const minBound = useMemo(() => {
    if (calendar.length > 0) {
      const [y, m] = calendar[0].date.split('-').map(Number)
      return { y, m }
    }
    return { y: now.getFullYear(), m: now.getMonth() + 1 }
  }, [calendar])
  const curBound = { y: now.getFullYear(), m: now.getMonth() + 1 }
  const cmp = (a: { y: number; m: number }, b: { y: number; m: number }) => a.y * 12 + a.m - (b.y * 12 + b.m)
  const canPrev = cmp(view, minBound) > 0
  const canNext = cmp(view, curBound) < 0

  const shiftMonth = (dir: 1 | -1) => {
    if (dir === -1 && !canPrev) return
    if (dir === 1 && !canNext) return
    const next = view.m + dir > 12 ? { y: view.y + 1, m: 1 } : view.m + dir < 1 ? { y: view.y - 1, m: 12 } : { y: view.y, m: view.m + dir }
    setView(next)
    /* 翻月后自动选中：本月选今天，历史月选该月最近一个有记录的日子，否则选 1 号 */
    const daysIn = new Date(next.y, next.m, 0).getDate()
    let pick = next.y === curBound.y && next.m === curBound.m ? todayStr : ''
    if (!pick) {
      for (let d = daysIn; d >= 1; d--) {
        const s = fmtDate(next.y, next.m, d)
        if ((byDate.get(s) ?? 0) > 0 && s <= todayStr) { pick = s; break }
      }
    }
    setSelected(pick || fmtDate(next.y, next.m, 1))
  }

  /* 组装 6×7 网格（周一开头），不足补空 */
  const firstDow = (new Date(view.y, view.m - 1, 1).getDay() + 6) % 7 // 周一=0
  const daysInMonth = new Date(view.y, view.m, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const selCount = byDate.get(selected) ?? 0
  const selDate = selected ? new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1, Number(selected.slice(8, 10))) : null
  const selLabel = selDate
    ? `${selDate.getMonth() + 1}月${selDate.getDate()}日 周${'日一二三四五六'[selDate.getDay()]}`
    : ''

  return (
    <div>
      {/* 月份切换行 */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => shiftMonth(-1)}
          disabled={!canPrev}
          aria-label="上一月"
          className="w-8 h-8 rounded-full flex items-center justify-center tap transition-colors duration-150 disabled:opacity-30"
          style={{ color: 'var(--text-2)' }}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
          {view.y} 年 {view.m} 月
        </span>
        <button
          onClick={() => shiftMonth(1)}
          disabled={!canNext}
          aria-label="下一月"
          className="w-8 h-8 rounded-full flex items-center justify-center tap transition-colors duration-150 disabled:opacity-30"
          style={{ color: 'var(--text-2)' }}
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>

      {/* 星期行 */}
      <div className="grid gap-1 mb-1.5" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {WEEKDAY_LABELS.map(d => (
          <div key={d} className="text-center text-[9px] font-medium" style={{ color: 'var(--text-3)' }}>{d}</div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} />
          const dateStr = fmtDate(view.y, view.m, day)
          const count = byDate.get(dateStr) ?? 0
          const isFuture = dateStr > todayStr
          const isToday = dateStr === todayStr
          const isSelected = dateStr === selected
          const intensity = count > 0 ? Math.round(8 + (count / maxCount) * 34) : 0

          return (
            <button
              key={dateStr}
              onClick={() => !isFuture && setSelected(dateStr)}
              disabled={isFuture}
              className="aspect-square rounded-full flex flex-col items-center justify-center tap transition-all duration-150 disabled:cursor-default"
              style={{
                /* 选中格＝低饱和淡青底 + 主色细环（M3 tonal 容器），不再用实心主色（浅色下刺眼） */
                background: isSelected
                  ? 'color-mix(in srgb, var(--accent) 24%, transparent)'
                  : intensity > 0
                  ? `color-mix(in srgb, var(--accent) ${intensity}%, transparent)`
                  : 'var(--track)',
                color: isFuture ? 'var(--text-3)' : 'var(--text-1)',
                opacity: isFuture ? 0.45 : 1,
                border: isSelected
                  ? '1.5px solid var(--accent)'
                  : isToday
                  ? '1.5px solid color-mix(in srgb, var(--accent) 55%, transparent)'
                  : '1.5px solid transparent',
              }}
            >
              <span className="text-[11px] font-semibold leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>{day}</span>
              {count > 0 && (
                <span
                  className="text-[8px] leading-none mt-0.5 font-medium"
                  style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 选中日期详情 */}
      <div
        className="mt-3 rounded-xl px-3.5 py-2.5 flex items-center justify-between"
        style={{ background: 'var(--track)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{selLabel}</span>
        {selCount > 0 ? (
          <span className="text-xs font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
            答题 {selCount} 题
          </span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>当天没有答题记录</span>
        )}
      </div>

      {/* 色阶图例 */}
      <div className="flex items-center gap-2 mt-2.5 justify-end">
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>少</span>
        {[8, 17, 25, 34, 42].map(v => (
          <div key={v} className="w-3 h-3 rounded-full" style={{ background: `color-mix(in srgb, var(--accent) ${v}%, transparent)` }} />
        ))}
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>多</span>
      </div>
    </div>
  )
}

function KnowledgeBar({ topic, accuracy }: { topic: string; accuracy: number }) {
  const pct = Math.round(accuracy)
  const level = pct >= 85 ? '已掌握' : pct >= 65 ? '学习中' : '需加强'
  const levelColor = pct >= 85 ? 'var(--ok)' : pct >= 65 ? 'var(--accent)' : 'var(--err)'

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>{topic}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold" style={{ color: levelColor }}>{level}</span>
            <span className="text-xs font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
          </div>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
          <div
            className="h-full rounded-full progress-fill"
            style={{ width: `${pct}%`, background: 'var(--accent)' }}
          />
        </div>
      </div>
    </div>
  )
}

export function LearningScreen({ onStartPractice, onBack }: LearningScreenProps) {
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [report, setReport] = useState<UserStatsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /* 整屏进场动效：切换「本周 / 本月」重新拉数据时，分区再错峰播一次 */
  const staggerRef = useStagger<HTMLDivElement>(period)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    statsApi
      .report(period)
      .then(res => {
        if (!cancelled) {
          setReport(res)
          setError('')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '学习报告加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [period])

  const periodMinutes = Math.round((report?.period_duration_seconds ?? 0) / 60)
  const breakdown = report?.breakdown ?? []

  /* 学习建议：正确率最低的两个方向（至少答过 5 题才算薄弱） */
  const weakTopics = [...breakdown]
    .filter(k => k.answered >= 5 && k.accuracy < 75)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 2)
  const hasData = (report?.total_answered ?? 0) > 0

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" ref={staggerRef} style={{ paddingBottom: 110 }}>
        {/* 标题（带返回上一级按钮） */}
        <div className="px-5 pt-14 pb-4">
          <div className="mb-2 -ml-2 flex items-center">
            {onBack && (
              <button
                onClick={onBack}
                aria-label="返回上一级"
                className="tap flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                style={{ color: 'var(--text-2)', background: 'var(--card)' }}
              >
                <ChevronLeftIcon size={18} />
              </button>
            )}
          </div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>学习报告</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            {hasData ? `你已连续学习 ${report?.streak_days ?? 0} 天，保持！` : '开始答题后，这里会生成你的专属学习报告'}
          </p>
        </div>
        {error && (
          <div className="px-5 pb-3">
            <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
          </div>
        )}

        {/* 周期切换（分段控件） */}
        <div className="px-4 mb-5">
          <div className="rounded-2xl p-1 flex gap-1" style={{ background: 'var(--track)' }}>
            {(['week', 'month'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="flex-1 h-9 rounded-xl text-sm font-semibold transition-all duration-200 tap"
                style={{
                  background: period === p ? 'var(--surface-raised)' : 'transparent',
                  color: period === p ? 'var(--text-1)' : 'var(--text-3)',
                  boxShadow: period === p ? 'var(--shadow-card)' : 'none',
                }}
              >
                {p === 'week' ? '本周' : '本月'}
              </button>
            ))}
          </div>
        </div>

        {/* 汇总数字卡 */}
        <div className="px-4 mb-5 grid grid-cols-2 gap-3">
          {[
            { label: '答题总数', value: report?.period_total ?? 0, unit: '题', icon: <PencilIcon size={18} /> },
            { label: '正确率', value: report?.period_accuracy ?? 0, unit: '%', icon: <TargetIcon size={18} /> },
            { label: '学习时长', value: periodMinutes, unit: '分钟', icon: <ClockIcon size={18} /> },
            { label: '连续天数', value: report?.streak_days ?? 0, unit: '天', icon: <FlameIcon size={18} /> },
          ].map(stat => (
            <div key={stat.label} className="card p-4">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center mb-2.5" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}>{stat.icon}</span>
              </div>
              <div className="text-2xl font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                {stat.value}<span className="text-sm font-medium ml-0.5" style={{ color: 'var(--text-3)' }}>{stat.unit}</span>
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* 学习日历（近 140 天真实答题量，真实月历可翻页/选日期） */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>学习日历</h3>
              <span
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold"
                style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
              >
                <CalendarIcon size={12} /> 连续 {report?.streak_days ?? 0} 天
              </span>
            </div>
            <StudyCalendar calendar={report?.calendar ?? []} />
          </div>
        </div>

        {/* 知识掌握度（按方向实时统计） */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>知识掌握度</h3>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>按检测方向统计</span>
            </div>
            {breakdown.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {loading ? '统计加载中…' : '还没有答题记录，去首页开始练习吧'}
              </p>
            ) : (
              <div className="space-y-4">
                {breakdown.map(k => (
                  <KnowledgeBar key={k.category} topic={`${k.topic}（${k.category}）`} accuracy={k.accuracy} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 学习建议（根据真实薄弱方向动态生成） */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                <InfoIcon size={15} color="var(--accent)" />
              </div>
              <span className="text-xs font-bold tracking-wide" style={{ color: 'var(--accent)' }}>学习建议</span>
            </div>

            {hasData ? (
              <>
                {weakTopics.length > 0 ? (
                  <>
                    <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                      你最近在「<span className="font-semibold" style={{ color: 'var(--text-1)' }}>{weakTopics[0].topic}</span>」
                      {weakTopics[1] && (
                        <>和「<span className="font-semibold" style={{ color: 'var(--text-1)' }}>{weakTopics[1].topic}</span>」</>
                      )}
                      方向的正确率偏低（分别为 {weakTopics.map(t => `${t.accuracy}%`).join(' 和 ')}），建议进行专项训练。
                    </p>
                    <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--text-3)' }}>
                      建议优先复习错题本中的题目，再回归教材对应章节巩固知识点。
                    </p>
                  </>
                ) : (
                  <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                    各方向正确率表现不错，保持节奏！可以尝试全科综合刷题，检验跨方向的综合掌握情况。
                  </p>
                )}

                <div className="flex gap-2">
                  {weakTopics.slice(0, 2).map(topic => (
                    <button
                      key={topic.category}
                      onClick={() => onStartPractice(topic.category)}
                      className="px-3 py-2 gb-pill rounded-xl text-xs font-semibold"
                      style={{
                        background: 'var(--accent-weak)',
                        color: 'var(--accent)',
                        border: '1px solid rgba(95,141,140,0.35)',
                        boxShadow: 'inset 1px 1px 0 var(--chip-border), 0 2px 6px rgba(95,141,140,0.12)',
                      }}
                    >
                      练习 {topic.category}
                    </button>
                  ))}
                  <button
                    onClick={() => onStartPractice('综合')}
                    className="ml-auto px-4 py-2 gb gb-primary rounded-xl text-xs font-semibold inline-flex items-center gap-1"
                  >
                    立即训练 <ChevronRightIcon size={12} color="#10B981" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
                  先做一组题，系统会根据你的正确率自动找出薄弱方向并给出练习建议。
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onStartPractice('综合')}
                    className="ml-auto px-4 py-2 gb gb-primary rounded-xl text-xs font-semibold inline-flex items-center gap-1"
                  >
                    开始第一组练习 <ChevronRightIcon size={12} color="#10B981" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 本周目标（周期内真实进度） */}
        <div className="px-4">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{period === 'week' ? '本周' : '本月'}目标</h3>
              <span className="text-xs font-semibold" style={{ color: 'var(--ok)' }}>
                {Math.min(Math.round(((report?.period_total ?? 0) / GOAL_QUESTIONS) * 100), 100)}% 完成
              </span>
            </div>

            <div className="space-y-3">
              {[
                { label: '答题数量', current: report?.period_total ?? 0, target: GOAL_QUESTIONS },
                { label: '练习时长', current: periodMinutes, target: GOAL_MINUTES, unit: 'min' },
                { label: '正确率', current: report?.period_accuracy ?? 0, target: GOAL_ACCURACY, unit: '%' },
              ].map(goal => (
                <div key={goal.label}>
                  <div className="flex justify-between items-center mb-1.5 text-xs">
                    <span style={{ color: 'var(--text-2)' }}>{goal.label}</span>
                    <span style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {goal.current}{goal.unit || ''} / {goal.target}{goal.unit || ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                    <div
                      className="h-full rounded-full progress-fill"
                      style={{ width: `${Math.min((goal.current / goal.target) * 100, 100)}%`, background: 'var(--accent)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
