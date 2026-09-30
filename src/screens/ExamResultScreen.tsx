import React, { useEffect, useState } from 'react'
import { ProgressRing } from '../components/ProgressRing'
import type { ExamSubmitResult } from '../api/client'
import { RefreshIcon, HomeIcon, ClipboardIcon, InfoIcon } from '../components/icons'

/* ============================================================
   模拟考试 · 出分页（苹果式浅色）
   结构：标题 / 得分环 / 统计网格（答对·答错·用时）/ 自动交卷提示 / 操作按钮
   ============================================================ */

interface ExamResultScreenProps {
  result: ExamSubmitResult
  /** 查看完整试卷（正确答案 + 我的答案） */
  onReviewPaper: () => void
  onHome: () => void
  /** 再考一次（回到考试设置页） */
  onRetry: () => void
}

function formatUsed(s: number) {
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分${s % 60 ? ` ${s % 60} 秒` : ''}`
}

export function ExamResultScreen({ result, onReviewPaper, onHome, onRetry }: ExamResultScreenProps) {
  const [ringProgress, setRingProgress] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setRingProgress(result.score), 300)
    return () => clearTimeout(t)
  }, [result.score])

  const passed = result.score >= 60
  const grade = result.score >= 80 ? { label: '优秀', color: 'var(--ok)' }
    : passed ? { label: '及格', color: 'var(--accent)' }
    : { label: '未通过', color: 'var(--err)' }

  return (
    <div className="app-shell flex flex-col bg-page min-h-screen">
      <div className="flex-1 flex flex-col items-center justify-start px-5 pt-14 pb-10 overflow-y-auto" style={{ paddingBottom: 100 }}>
        {/* 标题 */}
        <div className="text-center mb-8 anim-slide-down">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-3)' }}>{result.title} · 模拟考试</p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>考试结束</h1>
        </div>

        {/* 得分环 */}
        <div className="anim-scale-in d-100 mb-6 text-center">
          <ProgressRing
            progress={ringProgress}
            size={160}
            strokeWidth={10}
            color={grade.color === 'var(--ok)' ? '#6FA37C' : grade.color === 'var(--accent)' ? '#5F8D8C' : '#C17B7B'}
          >
            <div className="text-center">
              <div className="text-5xl font-black" style={{ color: grade.color, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                {result.score}
              </div>
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>得分</div>
            </div>
          </ProgressRing>

          <div className="flex justify-center mt-4">
            <span
              className="px-4 py-1.5 rounded-full text-sm font-semibold"
              style={{ background: 'var(--accent-weak)', color: grade.color, border: '1px solid var(--accent-border)' }}
            >
              {grade.label} · {passed ? '≥60 分' : '<60 分'}
            </span>
          </div>

          {result.auto_submitted && (
            <div className="flex items-center justify-center gap-1.5 mt-3 text-xs" style={{ color: 'var(--text-2)' }}>
              <InfoIcon size={13} />
              时间到，系统已自动交卷
            </div>
          )}
        </div>

        {/* 统计网格 */}
        <div className="w-full card p-5 mb-4 anim-slide-up d-200">
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: '答题总数', value: result.total, unit: '题', color: 'var(--accent)' },
              { label: '回答正确', value: result.correct, unit: '题', color: 'var(--ok)' },
              { label: '回答错误', value: result.wrong, unit: '题', color: 'var(--err)' },
              { label: '用时', value: formatUsed(result.time_used), unit: '', color: 'var(--text-1)' },
            ].map(stat => (
              <div key={stat.label} className="text-center py-2">
                <div className="text-3xl font-black mb-1" style={{ color: stat.color, fontVariantNumeric: 'tabular-nums' }}>
                  {`${stat.value}${stat.unit}`}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-3)' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 操作 */}
        <div className="w-full space-y-3 anim-slide-up d-300 mt-2">
          <button
            onClick={onReviewPaper}
            className="w-full h-[52px] gb gb-primary gb-lg font-semibold text-base flex items-center justify-center gap-2"
          >
            <ClipboardIcon size={17} color="var(--on-accent)" />
            查看试卷解析
          </button>

          <button onClick={onRetry} className="w-full h-12 gb gb-ghost font-semibold text-sm flex items-center justify-center gap-2">
            <RefreshIcon size={15} />
            再考一次
          </button>

          <button onClick={onHome} className="w-full h-12 gb gb-ghost font-semibold text-sm flex items-center justify-center gap-2">
            <HomeIcon size={16} />
            返回首页
          </button>
        </div>

        <p className="text-[10px] mt-6 text-center" style={{ color: 'var(--text-3)' }}>
          本次成绩已保存到「我的 → 成绩记录」，点击记录可回看整张试卷
        </p>
      </div>
    </div>
  )
}
