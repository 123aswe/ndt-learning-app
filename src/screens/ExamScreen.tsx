import React, { useState, useCallback, useEffect, useRef } from 'react'
import { examApi, type ExamQuestion, type ExamStartResult, type ExamSubmitResult } from '../api/client'
import {
  ChevronLeftIcon, ChevronRightIcon, ClockIcon, GridIcon,
} from '../components/icons'

/* ============================================================
   模拟考试 · 答题页（苹果式浅色）
   与练习页的区别：
   - 顶部是**倒计时**（到 0 自动交卷），不是正计时
   - 选择答案**只记录不判分**（可以改答案），正确与否交卷后由服务端判
   - 导航颜色：已答=accent 填充 / 未答=浅灰（没有对错颜色）
   - 交卷：底部「交卷」按钮 / 导航面板 / 倒计时到点，三条路径同一接口
   ============================================================ */

interface ExamScreenProps {
  session: ExamStartResult
  onExit: () => void
  /** 交卷成功（含到点自动交卷），带结果进入出分页 */
  onComplete: (result: ExamSubmitResult) => void
}

function formatCountdown(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function qtypeLabel(q: ExamQuestion): string {
  if (q.qtype === 'judge') return '判断题'
  if (q.qtype === 'calc') return '计算题'
  if (q.qtype === 'short') return '简答题'
  return '选择题'
}

export function ExamScreen({ session, onExit, onComplete }: ExamScreenProps) {
  const questions = session.questions
  const total = questions.length

  const [currentIndex, setCurrentIndex] = useState(0)
  /** index → 选项字母（考试中可随时改答案） */
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [showNavigator, setShowNavigator] = useState(false)
  const [showExitModal, setShowExitModal] = useState(false)
  const [questionVisible, setQuestionVisible] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  /** 未答完时交卷需两次确认 */
  const [confirmSubmit, setConfirmSubmit] = useState(false)

  /** 倒计时：秒；到 0 自动交卷 */
  const [remaining, setRemaining] = useState(session.duration_minutes * 60)
  /** 交卷只执行一次（手动 / 自动 / 退出三条路径共用） */
  const submittedRef = useRef(false)
  const remainingRef = useRef(remaining)
  remainingRef.current = remaining

  const currentQ = questions[currentIndex]
  const progress = total > 0 ? ((currentIndex + 1) / total) * 100 : 0
  const answeredCount = Object.keys(answers).length

  /* ── 倒计时 ── */
  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining(s => {
        if (s <= 1) {
          clearInterval(timer)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const doSubmit = useCallback((auto: boolean) => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    setSubmitError('')
    const timeUsed = session.duration_minutes * 60 - remainingRef.current
    const payload = Object.entries(answers).map(([idx, key]) => ({
      question_id: questions[Number(idx)].id,
      user_answer: key,
    }))
    examApi
      .submit(session.exam_id, Math.max(timeUsed, 0), payload, auto)
      .then(result => onComplete(result))
      .catch((err: unknown) => {
        // 交卷失败（断网/服务未启动）：恢复状态允许重试；到点自动交卷失败也走这里
        submittedRef.current = false
        setSubmitting(false)
        setSubmitError(err instanceof Error ? err.message : '交卷失败，请重试')
      })
  }, [answers, questions, session, onComplete])

  /* 到点自动交卷 */
  useEffect(() => {
    if (remaining === 0) doSubmit(true)
  }, [remaining, doSubmit])

  /* ── 答题（可改答案，不判分） ── */
  const handleSelect = useCallback((key: string) => {
    setAnswers(prev => ({ ...prev, [currentIndex]: key }))
  }, [currentIndex])

  const switchTo = useCallback((index: number) => {
    if (index < 0 || index >= total || index === currentIndex) return
    setQuestionVisible(false)
    setTimeout(() => {
      setCurrentIndex(index)
      setQuestionVisible(true)
    }, 160)
  }, [currentIndex, total])

  const jumpTo = useCallback((index: number) => {
    if (index === currentIndex) { setShowNavigator(false); return }
    switchTo(index)
    setShowNavigator(false)
  }, [currentIndex, switchTo])

  /* ── 交卷（带未答确认） ── */
  const handleSubmitClick = useCallback(() => {
    if (submitting) return
    const unanswered = total - answeredCount
    if (unanswered > 0 && !confirmSubmit) {
      setConfirmSubmit(true)
      return
    }
    doSubmit(false)
  }, [submitting, total, answeredCount, confirmSubmit, doSubmit])

  const urgent = remaining <= 60
  const warning = remaining <= 300

  if (!currentQ) {
    return (
      <div className="app-shell flex flex-col items-center justify-center bg-page" style={{ height: '100dvh' }}>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>试卷为空</p>
        <button onClick={onExit} className="mt-4 px-6 py-3 gb gb-primary gb-lg text-sm font-semibold">返回</button>
      </div>
    )
  }

  return (
    <div className="app-shell flex flex-col bg-page" style={{ height: '100dvh', overflow: 'hidden' }}>
      {/* ── 顶栏 ── */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3">
        <button
          onClick={() => setShowExitModal(true)}
          aria-label="退出"
          className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
          style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
        >
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>

        <div className="flex flex-col items-center">
          <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
            {session.title}
          </span>
          <div
            className="flex items-center gap-1.5 text-sm font-bold mt-0.5"
            style={{
              color: urgent ? 'var(--err)' : warning ? 'var(--accent)' : 'var(--text-1)',
              fontVariantNumeric: 'tabular-nums',
              ...(urgent ? { animation: 'examBlink 1s step-end infinite' } : {}),
            }}
          >
            <ClockIcon size={14} />
            {submitting ? '正在交卷…' : formatCountdown(remaining)}
          </div>
        </div>

        <button
          onClick={() => { setConfirmSubmit(false); setShowNavigator(true) }}
          aria-label="题目导航"
          className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
          style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
        >
          <GridIcon size={16} color="var(--text-2)" />
        </button>
      </div>

      {/* ── 进度条 ── */}
      <div className="px-4 mb-4">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
          <div className="h-full rounded-full progress-fill" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
        </div>
      </div>

      {/* ── 可滚动内容 ── */}
      <div className="flex-1 overflow-y-auto px-4" style={{ overscrollBehavior: 'contain' }}>
        {submitError && (
          <div className="card px-4 py-3 mb-3" style={{ borderTop: '3px solid var(--err)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--err)' }}>⚠️ {submitError}</p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>考试时间已暂停扣减，请重新点击「交卷」</p>
          </div>
        )}

        {/* 题目卡片 */}
        <div className={`card p-5 mb-4 transition-all duration-200 ${questionVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
              {qtypeLabel(currentQ)}
            </span>
            {currentQ.topic && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-warm)', color: 'var(--text-2)', border: '1px solid var(--line)' }}>
                {currentQ.topic}
              </span>
            )}
          </div>
          <p className="text-base leading-relaxed font-medium" style={{ color: 'var(--text-1)', letterSpacing: '-0.005em' }}>
            {currentQ.content}
          </p>
        </div>

        {/* 选项卡片：考试中只标记「我选的」，不显示对错 */}
        <div className="space-y-3 mb-4">
          {(currentQ.options ?? []).map(opt => {
            const picked = answers[currentIndex] === opt.key
            return (
              <div
                key={opt.key}
                className="answer-card relative rounded-2xl px-4 py-3.5 flex items-start gap-3"
                onClick={() => handleSelect(opt.key)}
                style={{
                  background: picked ? 'var(--accent-weak)' : 'var(--chip-bg-soft)',
                  border: `1.5px solid ${picked ? 'var(--accent-border)' : 'var(--inset-hi)'}`,
                }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{
                    background: picked ? 'var(--accent-fill)' : 'var(--track)',
                    color: picked ? 'var(--on-accent)' : 'var(--text-2)',
                  }}
                >
                  {opt.key}
                </div>
                <p className="text-sm leading-relaxed flex-1" style={{ color: picked ? 'var(--accent)' : 'var(--text-1)' }}>
                  {opt.text}
                </p>
              </div>
            )
          })}
        </div>

        <div className="h-24" />
      </div>

      {/* ── 底部操作条：上一题 / 交卷 / 下一题 ── */}
      <div
        className="px-4 pt-3 pb-8"
        style={{
          background: 'linear-gradient(180deg, transparent 0%, #F3F4F6 40%)',
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
        }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => switchTo(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="w-14 h-[52px] gb gb-ghost gb-lg flex items-center justify-center"
            style={{ opacity: currentIndex === 0 ? 0.4 : 1 }}
          >
            <ChevronLeftIcon size={20} color="var(--text-2)" />
          </button>

          <button
            onClick={handleSubmitClick}
            disabled={submitting}
            className="flex-1 h-[52px] rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-transform duration-100 active:scale-[0.99] gb gb-danger"
            style={{ opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? '正在交卷…' : confirmSubmit ? `还有 ${total - answeredCount} 题未答，再点确认交卷` : '交卷'}
          </button>

          <button
            onClick={() => switchTo(currentIndex + 1)}
            disabled={currentIndex + 1 >= total}
            className="w-14 h-[52px] gb gb-ghost gb-lg flex items-center justify-center"
            style={{ opacity: currentIndex + 1 >= total ? 0.4 : 1 }}
          >
            <ChevronRightIcon size={20} color="var(--text-2)" />
          </button>
        </div>
      </div>

      {/* ── 题目导航面板 ── */}
      {showNavigator && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowNavigator(false)} />
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] rounded-t-3xl anim-sheet-in"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)' }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
            </div>
            <div className="px-5 pb-8" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>题目导航</h3>
                <span className="text-xs" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                  已答 {answeredCount} / {total}
                </span>
              </div>

              <div className="grid grid-cols-5 gap-2.5 mb-5">
                {questions.map((q, i) => {
                  const answered = i in answers
                  const isCurrent = i === currentIndex
                  return (
                    <button
                      key={q.id}
                      onClick={() => jumpTo(i)}
                      className="aspect-square rounded-xl text-sm font-bold flex items-center justify-center transition-colors duration-150 tap"
                      style={{
                        background: answered ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
                        color: answered ? 'var(--on-accent)' : 'var(--text-2)',
                        border: isCurrent
                          ? '2px solid var(--accent)'
                          : `1px solid ${answered ? 'var(--accent-border)' : 'var(--chip-border)'}`,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {i + 1}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center gap-4 mb-5 text-[10px]" style={{ color: 'var(--text-3)' }}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ background: 'var(--accent-fill)' }} /> 已答
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ background: 'var(--chip-bg-soft)', border: '1px solid var(--chip-border)' }} /> 未答
                </span>
              </div>

              <button
                onClick={() => { setConfirmSubmit(false); handleSubmitClick() }}
                disabled={submitting}
                className="w-full h-12 rounded-2xl text-sm font-semibold gb gb-danger"
                style={{ opacity: submitting ? 0.6 : 1 }}
              >
                {confirmSubmit ? `还有 ${total - answeredCount} 题未答，再点确认交卷` : '交卷'}
              </button>
              <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                倒计时结束将自动交卷，未答的题按错误计
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── 退出弹窗 ── */}
      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowExitModal(false)} />
          <div
            className="relative w-full max-w-[430px] rounded-t-3xl px-5 pt-5 pb-10 anim-sheet-in"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)' }}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
            </div>

            <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--text-1)' }}>结束本次考试？</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>
              退出会立即交卷并出分（已答 {answeredCount} / {total} 题），成绩会计入成绩记录
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowExitModal(false)}
                className="flex-1 h-12 gb gb-ghost rounded-2xl text-sm font-semibold"
              >
                继续考试
              </button>
              <button
                onClick={() => doSubmit(false)}
                disabled={submitting}
                className="flex-1 h-12 gb gb-danger rounded-2xl text-sm font-semibold"
                style={{ opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? '正在交卷…' : '交卷并退出'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
