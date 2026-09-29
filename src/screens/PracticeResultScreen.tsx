import React, { useEffect, useState } from 'react'
import { ProgressRing } from '../components/ProgressRing'
import { ZapIcon, ChevronRightIcon, RefreshIcon, HomeIcon } from '../components/icons'

/* ============================================================
   练习结果页（苹果式浅色）
   结构保持：标题 / 正确率环 / 统计网格 / 经验卡 / 操作按钮
   ============================================================ */

interface PracticeResultScreenProps {
  correct: number
  total: number
  timeSeconds: number
  categoryId: string
  onRetry: () => void
  onHome: () => void
  onReviewWrong: () => void
}

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m} 分 ${sec} 秒` : `${sec} 秒`
}

export function PracticeResultScreen({
  correct,
  total,
  timeSeconds,
  categoryId,
  onRetry,
  onHome,
  onReviewWrong,
}: PracticeResultScreenProps) {
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0
  const wrongCount = total - correct
  const [ringProgress, setRingProgress] = useState(0)
  const [countVisible, setCountVisible] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setRingProgress(accuracy), 300)
    const t2 = setTimeout(() => setCountVisible(true), 600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [accuracy])

  const grade = accuracy >= 75 ? { label: '优秀', color: 'var(--ok)' }
    : accuracy >= 60 ? { label: '良好', color: 'var(--accent)' }
    : { label: '需加强', color: 'var(--err)' }

  return (
    <div className="app-shell flex flex-col bg-page min-h-screen">
      <div className="flex-1 flex flex-col items-center justify-start px-5 pt-14 pb-10 overflow-y-auto" style={{ paddingBottom: 100 }}>
        {/* 标题 */}
        <div className="text-center mb-8 anim-slide-down">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-3)' }}>{categoryId} 练习完成</p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>练习结果</h1>
        </div>

        {/* 正确率环 */}
        <div className="anim-scale-in d-100 mb-8 text-center">
          <ProgressRing
            progress={ringProgress}
            size={160}
            strokeWidth={10}
            color={grade.color === 'var(--ok)' ? '#6FA37C' : grade.color === 'var(--accent)' ? '#5F8D8C' : '#C17B7B'}
          >
            <div className="text-center">
              <div className="text-5xl font-black" style={{ color: grade.color, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {accuracy}
              </div>
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>%</div>
            </div>
          </ProgressRing>

          <div className="flex justify-center mt-4">
            <span
              className="px-4 py-1.5 rounded-full text-sm font-semibold"
              style={{ background: 'var(--accent-weak)', color: grade.color, border: '1px solid var(--accent-border)' }}
            >
              {grade.label}
            </span>
          </div>
        </div>

        {/* 统计网格 */}
        <div className="w-full card p-5 mb-4 anim-slide-up d-200">
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: '答题总数', value: total, unit: '题', color: 'var(--accent)' },
              { label: '回答正确', value: correct, unit: '题', color: 'var(--ok)' },
              { label: '回答错误', value: wrongCount, unit: '题', color: 'var(--err)' },
              { label: '用时', value: formatTime(timeSeconds), unit: '', color: 'var(--text-1)' },
            ].map(stat => (
              <div key={stat.label} className="text-center py-2">
                <div className="text-3xl font-black mb-1" style={{ color: stat.color, fontVariantNumeric: 'tabular-nums' }}>
                  {countVisible ? `${stat.value}${stat.unit}` : '—'}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 经验卡 */}
        <div className="w-full card px-5 py-4 mb-4 anim-slide-up d-300 flex items-center gap-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
            <ZapIcon size={18} color="var(--accent)" />
          </div>
          <div>
            <div className="font-bold" style={{ color: 'var(--text-1)' }}>
              +{Math.round(correct * 3 + (accuracy >= 80 ? 10 : 0))} XP 经验值
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {accuracy >= 80 ? '高分加成 +10 XP · ' : ''}继续努力！
            </div>
          </div>
        </div>

        {/* 操作 */}
        <div className="w-full space-y-3 anim-slide-up d-400 mt-2">
          <button
            onClick={onRetry}
            className="w-full h-[52px] gb gb-primary gb-lg font-semibold text-base flex items-center justify-center gap-2"
          >
            <RefreshIcon size={17} color="#10B981" />
            再次练习
          </button>

          {wrongCount > 0 && (
            <button
              onClick={onReviewWrong}
              className="w-full h-12 gb gb-danger font-semibold text-sm"
            >
              复习 {wrongCount} 道错题
            </button>
          )}

          <button
            onClick={onHome}
            className="w-full h-12 gb gb-ghost font-semibold text-sm flex items-center justify-center gap-2"
          >
            <HomeIcon size={16} />
            返回首页
          </button>
        </div>
      </div>
    </div>
  )
}
