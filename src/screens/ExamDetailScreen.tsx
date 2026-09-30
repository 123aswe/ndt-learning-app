import React, { useEffect, useState } from 'react'
import { examApi, practiceApi, type SessionDetail } from '../api/client'
import { ChevronLeftIcon, CheckIcon, XIcon } from '../components/icons'

/* ============================================================
   试卷回看页（苹果式浅色）—— 考试与练习共用
   数据：考试 GET /api/exam/records/{exam_id}
        练习 GET /api/user/practice/history/{session_id}
   - 顶部成绩摘要卡（考试=得分 / 练习=正确率；答对·答错 / 用时）
   - 每题：正确选项 = 绿色，我选错的选项 = 红色，未作答 = 灰色
   - 题卡底部标注「正确答案 / 我的答案（未作答）」
   修改注意：颜色一律用语义令牌，不要写死 hex（深色模式）
   ============================================================ */

interface ExamDetailScreenProps {
  examId: string
  /** kind=exam 查考试接口（默认）；kind=practice 查练习会话接口（练习无限时、标题不同） */
  kind?: 'exam' | 'practice'
  onBack: () => void
}

function formatUsed(s: number) {
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分${s % 60 ? ` ${s % 60} 秒` : ''}`
}

function qtypeLabel(q: SessionDetail['items'][number]): string {
  if (q.qtype === 'judge') return '判断题'
  if (q.qtype === 'calc') return '计算题'
  if (q.qtype === 'short') return '简答题'
  return '选择题'
}

export function ExamDetailScreen({ examId, kind = 'exam', onBack }: ExamDetailScreenProps) {
  const isPractice = kind === 'practice'
  const [data, setData] = useState<SessionDetail | null>(null)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    const req = isPractice ? practiceApi.sessionDetail(examId) : examApi.detail(examId)
    req
      .then(res => { if (!cancelled) setData(res) })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '试卷加载失败')
      })
    return () => { cancelled = true }
  }, [examId, isPractice, reloadTick])

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 60 }}>
        {/* 顶栏 */}
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="返回"
            className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
          >
            <ChevronLeftIcon size={18} color="var(--text-2)" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
              {isPractice ? '练习回看' : '试卷回看'}
            </h1>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{data?.title ?? (isPractice ? '练习记录' : '模拟考试')}</p>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-3">
            <p className="text-xs" style={{ color: 'var(--err)' }}>{error}</p>
            <button onClick={() => setReloadTick(t => t + 1)} className="mt-1 text-xs font-semibold tap" style={{ color: 'var(--accent)' }}>
              重新加载
            </button>
          </div>
        )}

        {!data && !error && (
          <p className="text-sm py-16 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
        )}

        {data && (
          <>
            {/* 成绩摘要卡 */}
            <div className="px-4 mb-4">
              <div className="card p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-baseline gap-1">
                      <span
                        className="text-4xl font-black"
                        style={{
                          color: data.score >= 60 ? 'var(--ok)' : 'var(--err)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {data.score}
                      </span>
                      <span className="text-sm" style={{ color: 'var(--text-3)' }}>{isPractice ? '% 正确率' : '分'}</span>
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                      {data.finished_at ? data.finished_at.slice(0, 16) : ''}{data.auto_submitted ? ' · 自动交卷' : ''}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-sm font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{data.total}</div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>题数</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: 'var(--ok)', fontVariantNumeric: 'tabular-nums' }}>{data.correct}</div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>答对</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: 'var(--err)', fontVariantNumeric: 'tabular-nums' }}>{data.wrong}</div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>答错</div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-3)' }}>
                  <span>用时 {formatUsed(data.time_used)}</span>
                  {!isPractice && <span>限时 {data.duration_minutes} 分钟</span>}
                </div>
              </div>
            </div>

            {/* 题目列表 */}
            <div className="px-4 space-y-3">
              {data.items.map((q, i) => {
                const isShort = q.qtype === 'short' || !q.options || q.options.length === 0
                const answered = q.my_answer !== ''
                return (
                  <div key={q.id} className="card p-4">
                    {/* 题头 */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}>
                        第 {i + 1} 题
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--surface-warm)', color: 'var(--text-2)', border: '1px solid var(--line)' }}>
                        {qtypeLabel(q)}
                      </span>
                      {answered ? (
                        q.is_correct ? (
                          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--ok)' }}>
                            <CheckIcon size={11} strokeWidth={2.4} /> 答对
                          </span>
                        ) : (
                          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--err)' }}>
                            <XIcon size={11} strokeWidth={2.4} /> 答错
                          </span>
                        )
                      ) : (
                        <span className="ml-auto text-[10px] font-bold" style={{ color: 'var(--text-3)' }}>未作答</span>
                      )}
                    </div>

                    {/* 题干 */}
                    <p className="text-sm leading-relaxed font-medium mb-3" style={{ color: 'var(--text-1)' }}>
                      {q.content}
                    </p>

                    {/* 选项：正确=绿，我选错=红，其余=灰 */}
                    {isShort ? (
                      <div className="rounded-xl px-4 py-3 mb-3" style={{ background: 'var(--ok-weak)', border: '1px solid var(--ok-border)' }}>
                        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ok)' }}>参考答案</p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-1)' }}>{q.answer}</p>
                      </div>
                    ) : (
                      <div className="space-y-2 mb-3">
                        {q.options.map(opt => {
                          const isCorrect = opt.key === q.answer
                          const isMyWrong = answered && !q.is_correct && opt.key === q.my_answer
                          return (
                            <div
                              key={opt.key}
                              className="rounded-xl px-3.5 py-2.5 flex items-start gap-2.5"
                              style={{
                                background: isCorrect ? 'var(--ok-weak)' : isMyWrong ? 'var(--err-weak)' : 'var(--chip-bg-soft)',
                                border: `1.5px solid ${isCorrect ? 'var(--ok-border)' : isMyWrong ? 'var(--err-border)' : 'var(--chip-border)'}`,
                              }}
                            >
                              <div
                                className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                                style={{
                                  background: isCorrect ? 'var(--ok-weak)' : isMyWrong ? 'var(--err-weak)' : 'var(--track)',
                                  color: isCorrect ? 'var(--ok)' : isMyWrong ? 'var(--err)' : 'var(--text-3)',
                                }}
                              >
                                {isCorrect ? <CheckIcon size={11} strokeWidth={2.6} /> : isMyWrong ? <XIcon size={11} strokeWidth={2.6} /> : opt.key}
                              </div>
                              <p
                                className="text-sm leading-relaxed flex-1"
                                style={{ color: isCorrect ? 'var(--ok)' : isMyWrong ? 'var(--err)' : 'var(--text-2)' }}
                              >
                                {opt.text}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 答案标注 */}
                    <div className="flex items-center gap-4 pt-2 flex-wrap" style={{ borderTop: '1px solid var(--line)' }}>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        正确答案：<span className="font-bold" style={{ color: 'var(--ok)' }}>{q.answer}</span>
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        我的答案：
                        <span className="font-bold" style={{ color: answered ? (q.is_correct ? 'var(--ok)' : 'var(--err)') : 'var(--text-3)' }}>
                          {answered ? q.my_answer : '未作答'}
                        </span>
                      </span>
                      {q.topic && (
                        <span className="text-[10px] ml-auto" style={{ color: 'var(--text-3)' }}>{q.topic}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
