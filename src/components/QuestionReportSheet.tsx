import { useState } from 'react'
import { reportApi, type BankQuestion } from '../api/client'
import { stripRichText } from '../data/richText'
import { FlagIcon, XIcon } from './icons'

/* ============================================================
   题目疑问弹层（考生认为答案有误 → 上报给管理员）
   - 选择你认为的正确答案（有选项的题：点选项；简答题：文本框填写）
   - 填写理由（必填）
   - 提交 → POST /api/user/question-reports → 管理后台「纠错工单」
   同一题重复提交会覆盖之前的待处理工单（后端处理）
   ============================================================ */

interface QuestionReportSheetProps {
  question: BankQuestion
  onClose: () => void
}

export function QuestionReportSheet({ question, onClose }: QuestionReportSheetProps) {
  const hasOptions = question.options.length > 0
  /* 我建议的正确答案：选择题/判断题=选项字母；简答题=文本；计算题可文本可留空 */
  const [suggested, setSuggested] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const canSubmit = reason.trim().length > 0 && (hasOptions ? suggested !== '' : true) && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    try {
      await reportApi.create(question.id, suggested, reason.trim())
      setDone(true)
      setTimeout(onClose, 1400)
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后再试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] rounded-t-3xl anim-sheet-in flex flex-col"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)', maxHeight: '86vh' }}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
        </div>

        <div className="px-5 pt-2 pb-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <FlagIcon size={17} color="var(--warn, #c4913d)" />
              题目疑问
            </h3>
            <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center tap" style={{ background: 'var(--track)', color: 'var(--text-3)' }} aria-label="关闭">
              <XIcon size={13} />
            </button>
          </div>

          {done ? (
            <div className="py-10 flex flex-col items-center gap-2">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl" style={{ background: 'var(--ok-weak, rgba(111,163,124,0.14))', color: 'var(--ok)' }}>✓</div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>已提交给管理员</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>感谢反馈，处理结果会体现在题库中</p>
            </div>
          ) : (
            <>
              {/* 题干预览 */}
              <div className="rounded-xl px-3 py-3 mb-4" style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)' }}>
                <p className="text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--text-2)' }}>{stripRichText(question.content)}</p>
              </div>

              {/* 我认为的正确答案 */}
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>
                {hasOptions ? '你认为的正确答案是' : '你认为的正确答案（选填）'}
              </p>
              {hasOptions ? (
                <div className="flex flex-wrap gap-2 mb-4">
                  {question.options.map(o => {
                    const active = suggested === o.key
                    return (
                      <button
                        key={o.key}
                        onClick={() => setSuggested(o.key)}
                        className={`px-3 h-8 rounded-full text-xs font-semibold gb-pill transition-colors duration-200 ${active ? 'gb-soft' : ''}`}
                        style={{
                          background: active ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
                          color: active ? '#fff' : 'var(--text-2)',
                          border: active ? '1px solid var(--accent-border)' : '1px solid var(--chip-border)',
                        }}
                      >
                        {o.key}、{(() => { const t = stripRichText(o.text); return t.length > 8 ? `${t.slice(0, 8)}…` : t })()}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <textarea
                  value={suggested}
                  onChange={e => setSuggested(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="写出你认为正确的答案"
                  className="w-full rounded-xl px-3 py-2 text-sm mb-4 outline-none resize-none"
                  style={{ background: 'var(--field-bg)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
                />
              )}

              {/* 理由 */}
              <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>说明理由 <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(必填)</span></p>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="例如：根据教材第 X 章，正确答案应该是…"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
                style={{ background: 'var(--field-bg)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
              />

              {error && <p className="text-xs mt-2" style={{ color: 'var(--err)' }}>{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full h-12 rounded-2xl text-sm font-bold mt-4 tap gb-pill"
                style={{
                  background: canSubmit ? 'var(--accent-fill)' : 'var(--track)',
                  color: canSubmit ? '#fff' : 'var(--text-3)',
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                {submitting ? '提交中…' : '提交给管理员'}
              </button>
              <p className="text-[10px] mt-2 text-center" style={{ color: 'var(--text-3)' }}>
                提交后管理员会在后台收到工单，核实后直接修正题库
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
