import React, { useState, useCallback, useEffect } from 'react'
import { getQuestionsByCategory } from '../data/mockData'
import { ChevronLeftIcon, HeartIcon, ClockIcon, CheckIcon, XIcon, ChevronRightIcon } from '../components/icons'
import type { Question } from '../types'

/* ============================================================
   答题页（苹果式浅色）
   结构保持：顶栏 / 进度条 / 题目卡片 / 选项卡片 / 解析面板 / 底部操作 / 退出弹窗
   对错状态：正确=低饱和绿，错误=低饱和红，未答=浅灰边框
   ============================================================ */

interface PracticeScreenProps {
  categoryId: string
  onExit: () => void
  onComplete: (correct: number, total: number, timeSeconds: number) => void
}

type AnswerState = null | 'correct' | 'wrong'

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function PracticeScreen({ categoryId, onExit, onComplete }: PracticeScreenProps) {
  const practiceQuestions = getQuestionsByCategory(categoryId).slice(0, 10)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [answerState, setAnswerState] = useState<AnswerState>(null)
  const [showExplanation, setShowExplanation] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [showExitModal, setShowExitModal] = useState(false)
  const [isFavorited, setIsFavorited] = useState(false)
  const [questionVisible, setQuestionVisible] = useState(true)

  const currentQ = practiceQuestions[currentIndex]
  const total = practiceQuestions.length
  const progress = ((currentIndex) / total) * 100

  useEffect(() => {
    const timer = setInterval(() => setElapsedSeconds(s => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const handleSelect = useCallback((key: string) => {
    if (answerState !== null) return
    setSelected(key)

    const isCorrect = key === currentQ.correct
    setAnswerState(isCorrect ? 'correct' : 'wrong')

    if (isCorrect) setCorrectCount(c => c + 1)
    setAnswers(prev => ({ ...prev, [currentQ.id]: key }))

    setTimeout(() => setShowExplanation(true), 600)
  }, [answerState, currentQ])

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= total) {
      // correctCount 已在 handleSelect 计入全部（含最后一题），此处不再重复累加
      onComplete(correctCount, total, elapsedSeconds)
      return
    }

    setQuestionVisible(false)
    setTimeout(() => {
      setCurrentIndex(i => i + 1)
      setSelected(null)
      setAnswerState(null)
      setShowExplanation(false)
      setIsFavorited(false)
      setQuestionVisible(true)
    }, 200)
  }, [currentIndex, total, correctCount, answerState, elapsedSeconds, onComplete])

  if (!currentQ) return null

  const optionColors = {
    correct: { bg: 'var(--ok-weak)', border: 'var(--ok-border)', text: 'var(--ok)' },
    wrong:   { bg: 'var(--err-weak)', border: 'var(--err-border)', text: 'var(--err)' },
    reveal:  { bg: 'rgba(111,163,124,0.20)', border: 'var(--ok-border)', text: 'var(--ok)' },
    default: { bg: 'rgba(255,255,255,0.72)', border: 'rgba(255,255,255,0.85)', text: 'var(--text-1)' },
    dimmed:  { bg: 'rgba(248,249,250,0.75)', border: 'rgba(255,255,255,0.85)', text: 'var(--text-3)' },
  }

  function getOptionStyle(key: string) {
    if (!answerState) return optionColors.default
    if (key === currentQ.correct) return optionColors.correct
    if (key === selected && answerState === 'wrong') return optionColors.wrong
    return optionColors.dimmed
  }

  function getOptionIcon(key: string): React.ReactNode | null {
    if (!answerState) return null
    if (key === currentQ.correct) return <CheckIcon size={12} strokeWidth={2.4} />
    if (key === selected && answerState === 'wrong') return <XIcon size={12} strokeWidth={2.4} />
    return null
  }

  const diffColor = { easy: 'var(--ok)', medium: 'var(--accent)', hard: 'var(--err)' }[currentQ.difficulty]
  const diffLabel = { easy: '入门', medium: '中等', hard: '进阶' }[currentQ.difficulty]

  return (
    <div className="app-shell flex flex-col bg-page" style={{ height: '100dvh', overflow: 'hidden' }}>
      {/* ── 顶栏 ── */}
      <div className="flex items-center justify-between px-4 pt-12 pb-3">
        <button
          onClick={() => setShowExitModal(true)}
          className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.7)' }}
        >
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-2 py-0.5 rounded-md" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
            {categoryId}
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
            {currentIndex + 1} / {total}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFavorited(f => !f)}
            className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.7)' }}
          >
            <HeartIcon size={17} color={isFavorited ? 'var(--err)' : 'var(--text-2)'} strokeWidth={isFavorited ? 2 : 1.7} />
          </button>
          <div className="flex items-center gap-1 px-2.5 py-1.5 gb-sm text-xs gb-soft" style={{ background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(255,255,255,0.7)', color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', borderRadius: 12 }}>
            <ClockIcon size={13} />
            {formatTime(elapsedSeconds)}
          </div>
        </div>
      </div>

      {/* ── 进度条 ── */}
      <div className="px-4 mb-4">
        <div className="h-1 rounded-full overflow-hidden" style={{ background: '#EDEFF2' }}>
          <div
            className="h-full rounded-full progress-fill"
            style={{ width: `${progress}%`, background: 'var(--accent)' }}
          />
        </div>
      </div>

      {/* ── 可滚动内容 ── */}
      <div className="flex-1 overflow-y-auto px-4" style={{ overscrollBehavior: 'contain' }}>
        {/* 题目卡片 */}
        <div
          className={`card p-5 mb-4 transition-all duration-200 ${questionVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
        >
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
              {currentQ.knowledgePoint}
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-warm)', color: diffColor, border: '1px solid var(--line)' }}>
              {diffLabel}
            </span>
            {currentQ.standard && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-3)' }}>{currentQ.standard}</span>
            )}
          </div>

          <p
            className="text-base leading-relaxed font-medium"
            style={{ color: 'var(--text-1)', letterSpacing: '-0.005em' }}
          >
            {currentQ.text}
          </p>
        </div>

        {/* ── 选项 ── */}
        <div className="space-y-3 mb-4">
          {currentQ.options.map(opt => {
            const style = getOptionStyle(opt.key)
            const icon = getOptionIcon(opt.key)
            const isAnswered = answerState !== null

            return (
              <div
                key={opt.key}
                className={`answer-card relative rounded-2xl px-4 py-3.5 flex items-start gap-3 ${isAnswered ? 'answered' : ''}`}
                onClick={() => handleSelect(opt.key)}
                style={{ background: style.bg, border: `1.5px solid ${style.border}` }}
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style={{
                    background: isAnswered
                      ? opt.key === currentQ.correct
                        ? 'var(--ok-weak)'
                        : opt.key === selected && answerState === 'wrong'
                        ? 'var(--err-weak)'
                        : '#EDEFF2'
                      : '#EDEFF2',
                    color: style.text,
                  }}
                >
                  {icon || opt.key}
                </div>

                <p className="text-sm leading-relaxed flex-1" style={{ color: style.text }}>
                  {opt.text}
                </p>
              </div>
            )
          })}
        </div>

        {/* ── 解析面板 ── */}
        {showExplanation && (
          <div className="mb-4 anim-slide-up">
            <div
              className="card overflow-hidden"
              style={{ borderTop: `3px solid ${answerState === 'correct' ? 'var(--ok)' : 'var(--err)'}` }}
            >
              <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{
                    background: answerState === 'correct' ? 'var(--ok-weak)' : 'var(--err-weak)',
                    color: answerState === 'correct' ? 'var(--ok)' : 'var(--err)',
                  }}
                >
                  {answerState === 'correct' ? <CheckIcon size={15} strokeWidth={2.4} /> : <XIcon size={15} strokeWidth={2.4} />}
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: answerState === 'correct' ? 'var(--ok)' : 'var(--err)' }}>
                    {answerState === 'correct' ? '回答正确' : '回答错误'}
                  </div>
                  {answerState === 'wrong' && (
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>
                      正确答案：<span className="font-bold" style={{ color: 'var(--ok)' }}>{currentQ.correct}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="px-5 py-4">
                <p className="text-xs font-medium mb-2 tracking-wide" style={{ color: 'var(--text-3)' }}>解析</p>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>{currentQ.explanation}</p>

                <div className="flex items-center gap-4 mt-4 pt-4" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>知识点</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
                      {currentQ.knowledgePoint}
                    </span>
                  </div>
                  {currentQ.standard && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>标准</span>
                      <span className="text-[10px]" style={{ color: 'var(--text-2)' }}>{currentQ.standard}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="h-24" />
      </div>

      {/* ── 底部操作条 ── */}
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
        {answerState ? (
          <button
            onClick={handleNext}
            className="w-full h-[52px] rounded-full font-semibold text-base flex items-center justify-center gap-2 transition-transform duration-100 active:scale-[0.99]"
            style={{
              background: 'rgba(226, 232, 240, 0.85)',
              backdropFilter: 'blur(20px) saturate(150%)',
              WebkitBackdropFilter: 'blur(20px) saturate(150%)',
              border: '1px solid rgba(203, 213, 225, 0.55)',
              boxShadow:
                'inset 0 1px 2px rgba(148, 163, 184, 0.30), ' +
                'inset 0 -1px 0 rgba(255, 255, 255, 0.70), ' +
                '0 1px 3px rgba(148, 163, 184, 0.10)',
              color: '#10B981',
            }}
          >
            {currentIndex + 1 >= total ? '查看结果' : '下一题'}
            <ChevronRightIcon size={18} color="#10B981" />
          </button>
        ) : (
          <div
            className="h-[52px] gb gb-ghost gb-lg flex items-center justify-center gap-2.5"
            style={{ color: 'var(--text-3)' }}
          >
            <div className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: 'var(--accent)' }} />
            <div className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: 'var(--accent)' }} />
            <div className="w-1.5 h-1.5 rounded-full dot-pulse" style={{ background: 'var(--accent)' }} />
            <span className="text-sm ml-1">选择答案</span>
          </div>
        )}
      </div>

      {/* ── 退出弹窗 ── */}
      {showExitModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowExitModal(false)} />
          <div
            className="relative w-full max-w-[430px] rounded-t-3xl px-5 pt-5 pb-10 anim-sheet-in"
            style={{ background: '#fff', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)' }}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: '#D9DCE0' }} />
            </div>

            <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--text-1)' }}>结束本次练习？</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-2)' }}>当前进度将自动保存</p>

            <div className="card p-4 mb-6 grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xl font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{currentIndex}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>已完成</div>
              </div>
              <div>
                <div className="text-xl font-bold" style={{ color: 'var(--ok)', fontVariantNumeric: 'tabular-nums' }}>{correctCount}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>回答正确</div>
              </div>
              <div>
                <div className="text-xl font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{formatTime(elapsedSeconds)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>学习时长</div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowExitModal(false)}
                className="flex-1 h-12 gb gb-ghost rounded-2xl text-sm font-semibold"
              >
                继续答题
              </button>
              <button
                onClick={onExit}
                className="flex-1 h-12 gb gb-danger rounded-2xl text-sm font-semibold"
              >
                结束练习
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
