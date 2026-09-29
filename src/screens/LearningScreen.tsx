import React, { useState } from 'react'
import { userStats } from '../data/mockData'
import { PencilIcon, TargetIcon, ClockIcon, FlameIcon, CalendarIcon, InfoIcon, ChevronRightIcon } from '../components/icons'

/* ============================================================
   学习统计页（苹果式浅色）
   结构保持：标题 / 周期切换 / 汇总数字卡 / 学习日历 / 知识掌握度 / 学习建议 / 周目标
   图表极简：日历热力用低饱和蓝绿深浅，进度条纯色，无网格线
   ============================================================ */

interface LearningScreenProps {
  onStartPractice: (categoryId: string) => void
}

function CalendarHeatmap() {
  const days = Array.from({ length: 35 }, (_, i) => {
    const intensity = Math.random()
    return {
      active: intensity > 0.3,
      value: intensity > 0.3 ? Math.floor(intensity * 60) : 0,
      isToday: i === 34,
    }
  })

  const dayLabels = ['一', '二', '三', '四', '五', '六', '日']

  return (
    <div>
      <div className="flex gap-1 mb-1.5">
        {dayLabels.map(d => (
          <div key={d} className="flex-1 text-center text-[9px]" style={{ color: 'var(--text-3)' }}>{d}</div>
        ))}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {days.map((day, i) => (
          <div
            key={i}
            className="aspect-square rounded-md"
            style={{
              background: day.isToday
                ? 'var(--accent)'
                : day.active
                ? `rgba(95, 141, 140, ${0.10 + (day.value / 60) * 0.55})`
                : '#EDEFF2',
              border: day.isToday ? '1px solid var(--accent)' : '1px solid transparent',
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 mt-2 justify-end">
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>少</span>
        {[0.1, 0.25, 0.4, 0.6, 0.8].map(v => (
          <div key={v} className="w-3 h-3 rounded-sm" style={{ background: `rgba(95, 141, 140, ${v})` }} />
        ))}
        <span className="text-[9px]" style={{ color: 'var(--text-3)' }}>多</span>
      </div>
    </div>
  )
}

function KnowledgeBar({ topic, accuracy }: { topic: string; accuracy: number }) {
  const pct = Math.round(accuracy * 100)
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
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#EDEFF2' }}>
          <div
            className="h-full rounded-full progress-fill"
            style={{ width: `${pct}%`, background: 'var(--accent)' }}
          />
        </div>
      </div>
    </div>
  )
}

export function LearningScreen({ onStartPractice }: LearningScreenProps) {
  const [period, setPeriod] = useState<'week' | 'month'>('week')

  const weakTopics = userStats.knowledgeBreakdown.filter(k => k.accuracy < 0.75)

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* 标题 */}
        <div className="px-5 pt-14 pb-4">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>学习报告</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>你已学习 {userStats.streak} 天，保持！</p>
        </div>

        {/* 周期切换（分段控件） */}
        <div className="px-4 mb-5">
          <div className="rounded-2xl p-1 flex gap-1" style={{ background: '#EDEFF2' }}>
            {(['week', 'month'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className="flex-1 h-9 rounded-xl text-sm font-semibold transition-all duration-200 tap"
                style={{
                  background: period === p ? '#fff' : 'transparent',
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
            { label: '答题总数', value: period === 'week' ? userStats.weeklyQuestions : 1423, unit: '题', icon: <PencilIcon size={18} /> },
            { label: '正确率', value: Math.round(userStats.accuracy * 100), unit: '%', icon: <TargetIcon size={18} /> },
            { label: '学习时长', value: period === 'week' ? 204 : 842, unit: '分钟', icon: <ClockIcon size={18} /> },
            { label: '连续天数', value: userStats.streak, unit: '天', icon: <FlameIcon size={18} /> },
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

        {/* 学习日历 */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>学习日历</h3>
              <span
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold"
                style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
              >
                <CalendarIcon size={12} /> 连续 {userStats.streak} 天
              </span>
            </div>
            <CalendarHeatmap />
          </div>
        </div>

        {/* 知识掌握度 */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>知识掌握度</h3>
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>UT 重点分析</span>
            </div>
            <div className="space-y-4">
              {userStats.knowledgeBreakdown.map(k => (
                <KnowledgeBar key={k.topic} topic={k.topic} accuracy={k.accuracy} />
              ))}
            </div>
          </div>
        </div>

        {/* 学习建议 */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                <InfoIcon size={15} color="var(--accent)" />
              </div>
              <span className="text-xs font-bold tracking-wide" style={{ color: 'var(--accent)' }}>学习建议</span>
            </div>

            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-2)' }}>
              你最近在「<span className="font-semibold" style={{ color: 'var(--text-1)' }}>标准规范</span>」和「<span className="font-semibold" style={{ color: 'var(--text-1)' }}>仪器调节</span>」方向的正确率偏低（分别为 65% 和 76%），建议进行专项训练。
            </p>

            <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--text-3)' }}>
              推荐练习 GB/T 11345 相关条款题目，重点关注不同检测级别的扫查范围和验收准则差异。
            </p>

            <div className="flex gap-2">
              {weakTopics.slice(0, 2).map(topic => (
                <button
                  key={topic.topic}
                  onClick={() => onStartPractice(topic.category)}
                  className="px-3 py-2 gb-pill rounded-xl text-xs font-semibold"
                  style={{
                    background: 'rgba(95,141,140,0.14)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(95,141,140,0.35)',
                    boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.7), 0 2px 6px rgba(95,141,140,0.12)',
                  }}
                >
                  练习 {topic.topic}
                </button>
              ))}
              <button
                onClick={() => onStartPractice('综合')}
                className="ml-auto px-4 py-2 gb gb-primary rounded-xl text-xs font-semibold inline-flex items-center gap-1"
              >
                立即训练 <ChevronRightIcon size={12} color="#10B981" />
              </button>
            </div>
          </div>
        </div>

        {/* 本周目标 */}
        <div className="px-4">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>本周目标</h3>
              <span className="text-xs font-semibold" style={{ color: 'var(--ok)' }}>
                {Math.round((userStats.weeklyQuestions / 300) * 100)}% 完成
              </span>
            </div>

            <div className="space-y-3">
              {[
                { label: '答题数量', current: userStats.weeklyQuestions, target: 300 },
                { label: '练习时长', current: 204, target: 300, unit: 'min' },
                { label: '正确率', current: Math.round(userStats.accuracy * 100), target: 85, unit: '%' },
              ].map(goal => (
                <div key={goal.label}>
                  <div className="flex justify-between items-center mb-1.5 text-xs">
                    <span style={{ color: 'var(--text-2)' }}>{goal.label}</span>
                    <span style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {goal.current}{goal.unit || ''} / {goal.target}{goal.unit || ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#EDEFF2' }}>
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
