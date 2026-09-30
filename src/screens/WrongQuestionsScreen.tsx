import React, { useState, useEffect, useCallback } from 'react'
import { statsApi, type WrongQuestionItem } from '../api/client'
import { QuestionReportSheet } from '../components/QuestionReportSheet'
import { ChevronRightIcon, ChevronLeftIcon, CheckIcon, XIcon, RefreshIcon, CheckCircleIcon, TrashIcon, FlagIcon } from '../components/icons'

/* ============================================================
   错题本页（苹果式浅色）
   结构保持：标题（带返回）/ 统计行 / 筛选 Tab / 错题卡片（展开历史/答案/解析/操作）
   状态色：未掌握=低饱和红，已掌握=低饱和绿
   数据来源（实时，按登录账号隔离）：
     - GET /api/user/wrong-questions：我答错过的所有题（最近一次答对 = 已掌握）
     - POST /api/user/wrong-questions/{id}/master：标记已掌握（写库）
     - DELETE /api/user/wrong-questions/{id}：从错题集删除（隐藏标记，
       不删答题记录；这道题之后再次答错会重新出现）
   修改注意：不要把 Mock 错题数据加回来
   ============================================================ */

interface WrongQuestionsScreenProps {
  onStartPractice: (categoryId: string) => void
  /** 返回按钮：错题集从「我的」页进入，返回即回到「我的」 */
  onBack: () => void
}

type Filter = 'all' | 'unmastered' | 'mastered'

export function WrongQuestionsScreen({ onStartPractice, onBack }: WrongQuestionsScreenProps) {
  const [items, setItems] = useState<WrongQuestionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  /** 刚标记完已掌握的题：本地先更新状态（乐观），失败再回滚 */
  const [masteringId, setMasteringId] = useState<number | null>(null)
  /** 删除错题的两步确认：记录正在确认删除的题 id */
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  /** 正在删除中的题 id（防重复点击） */
  const [deletingId, setDeletingId] = useState<number | null>(null)
  /** 题目疑问（纠错上报）弹层对应的题 */
  const [reportQuestion, setReportQuestion] = useState<WrongQuestionItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const res = await statsApi.wrongQuestions(200)
      setItems(res.items)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '错题加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /** 标记已掌握：乐观更新 → 服务端写库 → 失败回滚并刷新 */
  async function handleMarkMastered(item: WrongQuestionItem) {
    if (masteringId !== null) return
    setMasteringId(item.id)
    const prev = items
    setItems(list => list.map(r => (r.id === item.id ? { ...r, mastered: true } : r)))
    try {
      await statsApi.markMastered(item.id)
    } catch {
      setItems(prev)
    } finally {
      setMasteringId(null)
    }
  }

  /** 从错题集删除（两步确认）：乐观移除 → 服务端写隐藏标记 → 失败回滚 */
  async function handleDeleteWrong(item: WrongQuestionItem) {
    if (deletingId !== null) return
    if (confirmDeleteId !== item.id) {
      setConfirmDeleteId(item.id)
      return
    }
    setDeletingId(item.id)
    const prev = items
    setItems(list => list.filter(r => r.id !== item.id))
    setConfirmDeleteId(null)
    try {
      await statsApi.deleteWrong(item.id)
    } catch {
      setItems(prev)
    } finally {
      setDeletingId(null)
    }
  }

  const filtered = items.filter(r => {
    if (filter === 'unmastered') return !r.mastered
    if (filter === 'mastered') return r.mastered
    return true
  })

  const totalWrong = items.length
  const unmastered = items.filter(r => !r.mastered).length
  const mastered = items.filter(r => r.mastered).length

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* 标题（带返回按钮：回到「我的」页） */}
        <div className="px-5 pt-14 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <button
              onClick={onBack}
              aria-label="返回"
              className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
            >
              <ChevronLeftIcon size={18} color="var(--text-2)" />
            </button>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>错题本</h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            {loading ? '正在加载…' : `${unmastered} 道未掌握，${mastered} 道已掌握`}
          </p>
        </div>

        {/* 统计行 */}
        <div className="px-4 mb-4 grid grid-cols-3 gap-3">
          {[
            { label: '全部错题', value: totalWrong, color: 'var(--accent)' },
            { label: '未掌握', value: unmastered, color: 'var(--err)' },
            { label: '已掌握', value: mastered, color: 'var(--ok)' },
          ].map(stat => (
            <div key={stat.label} className="card p-3 text-center">
              <div className="text-2xl font-bold" style={{ color: stat.color, fontVariantNumeric: 'tabular-nums' }}>{stat.value}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* 筛选 Tab */}
        <div className="px-4 mb-4">
          <div className="flex gap-2">
            {([
              { id: 'all', label: '全部' },
              { id: 'unmastered', label: '未掌握' },
              { id: 'mastered', label: '已掌握' },
            ] as Array<{ id: Filter; label: string }>).map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`px-4 h-8 rounded-full text-xs font-semibold transition-colors duration-200 gb-pill ${filter === f.id ? 'gb-soft' : ''}`}
                style={{
                  background: filter === f.id ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
                  color: filter === f.id ? '#fff' : 'var(--text-2)',
                  border: filter === f.id ? '1px solid var(--accent-border)' : '1px solid var(--chip-border)',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 错题列表 */}
        {loadError ? (
          <div className="flex flex-col items-center py-16 px-8 gap-3 text-center">
            <p className="text-sm" style={{ color: 'var(--err)' }}>{loadError}</p>
            <button onClick={load} className="mt-2 px-6 py-3 gb gb-primary gb-lg text-sm font-semibold">重试</button>
          </div>
        ) : filtered.length === 0 && !loading ? (
          <div className="flex flex-col items-center py-16 px-8 gap-4 text-center">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--ok-weak)' }}>
              <CheckCircleIcon size={32} color="var(--ok)" />
            </div>
            <div className="font-semibold" style={{ color: 'var(--text-1)' }}>太棒了，没有错题！</div>
            <div className="text-sm" style={{ color: 'var(--text-3)' }}>继续保持良好的答题习惯</div>
            <button
              onClick={() => onStartPractice('UT')}
              className="mt-4 px-6 py-3 gb gb-primary gb-lg text-sm font-semibold"
            >
              开始练习
            </button>
          </div>
        ) : (
          <div className="px-4 space-y-3">
            {filtered.map((record, idx) => {
              const isExpanded = expandedId === record.id
              const confirmingDelete = confirmDeleteId === record.id
              const correctOption = record.options.find(o => o.key === record.answer)

              return (
                <div key={record.id} className="card overflow-hidden anim-slide-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                  {/* 头部 */}
                  <button
                    className="w-full p-4 text-left tap"
                    onClick={() => setExpandedId(isExpanded ? null : record.id)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                        style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                      >
                        {record.method}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: record.mastered ? 'var(--ok-weak)' : 'var(--err-weak)',
                              color: record.mastered ? 'var(--ok)' : 'var(--err)',
                            }}
                          >
                            {record.mastered
                              ? <span className="inline-flex items-center gap-1"><CheckIcon size={10} strokeWidth={2.4} /> 已掌握</span>
                              : `错误 ${record.wrong_count} 次`}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{record.topic}</span>
                        </div>

                        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-2)' }}>{record.content}</p>
                      </div>

                      <div
                        className="mt-1 flex-shrink-0 transition-transform duration-200"
                        style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}
                      >
                        <ChevronRightIcon size={14} color="var(--text-3)" />
                      </div>
                    </div>
                  </button>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="px-4 pb-4 anim-slide-up" style={{ borderTop: '1px solid var(--line)' }}>
                      {/* 答题历史 */}
                      {record.history.length > 0 && (
                        <div className="mt-4 mb-4">
                          <p className="text-[10px] font-medium tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>答题历史</p>
                          <div className="flex flex-col gap-2">
                            {record.history.map((h, i) => (
                              <div key={i} className="flex items-center gap-3">
                                <span className="text-[10px] w-20" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{h.date}</span>
                                <span
                                  className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded"
                                  style={{
                                    background: h.correct ? 'var(--ok-weak)' : 'var(--err-weak)',
                                    color: h.correct ? 'var(--ok)' : 'var(--err)',
                                  }}
                                >
                                  {h.answer} {h.correct ? <CheckIcon size={9} strokeWidth={2.6} /> : <XIcon size={9} strokeWidth={2.6} />}
                                </span>
                                <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                  {i === 0 ? '最近一次' : `往前第 ${i} 次`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 正确答案 */}
                      <div className="mb-4">
                        <p className="text-[10px] font-medium tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>正确答案</p>
                        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: 'var(--ok-weak)', border: '1px solid var(--ok-border)' }}>
                          <span className="font-bold text-sm" style={{ color: 'var(--ok)' }}>{record.answer}.</span>
                          <span className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                            {correctOption?.text}
                          </span>
                        </div>
                      </div>

                      {/* 操作：再练一次 / 标记已掌握 / 删除（两步确认） */}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => onStartPractice(record.method)}
                          className="flex-1 h-9 gb-pill rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                          style={{
                            background: 'var(--accent-weak)',
                            color: 'var(--accent)',
                            border: '1px solid rgba(95,141,140,0.35)',
                            boxShadow: 'inset 1px 1px 0 var(--chip-border), 0 2px 6px rgba(95,141,140,0.12)',
                          }}
                        >
                          <RefreshIcon size={13} />
                          再练一次
                        </button>
                        {!record.mastered && (
                          <button
                            onClick={() => handleMarkMastered(record)}
                            className="flex-1 h-9 gb-pill rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                            style={{
                              background: 'rgba(111,163,124,0.14)',
                              color: 'var(--ok)',
                              border: '1px solid rgba(111,163,124,0.35)',
                              boxShadow: 'inset 1px 1px 0 var(--chip-border), 0 2px 6px rgba(111,163,124,0.12)',
                              opacity: masteringId === record.id ? 0.6 : 1,
                            }}
                          >
                            <CheckCircleIcon size={13} />
                            标记已掌握
                          </button>
                        )}
                        {/* 题目疑问：答案疑似有误 → 上报管理员 */}
                        <button
                          onClick={() => { setReportQuestion(record); setExpandedId(null) }}
                          aria-label="题目疑问"
                          className="h-9 gb-pill rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 flex-shrink-0"
                          style={{
                            minWidth: 44,
                            background: 'rgba(196,145,61,0.12)',
                            color: '#b07f2e',
                            border: '1px solid rgba(196,145,61,0.32)',
                          }}
                        >
                          <FlagIcon size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteWrong(record)}
                          disabled={deletingId === record.id}
                          aria-label="从错题集删除"
                          className="h-9 gb-pill rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 flex-shrink-0"
                          style={{
                            minWidth: confirmingDelete ? 0 : 44,
                            paddingLeft: confirmingDelete ? 10 : 0,
                            paddingRight: confirmingDelete ? 10 : 0,
                            background: confirmingDelete ? 'var(--err)' : 'rgba(180,80,80,0.10)',
                            color: confirmingDelete ? '#fff' : 'var(--err)',
                            border: `1px solid ${confirmingDelete ? 'var(--err)' : 'rgba(180,80,80,0.30)'}`,
                            opacity: deletingId === record.id ? 0.6 : 1,
                          }}
                        >
                          <TrashIcon size={13} />
                          {confirmingDelete && '确认删除'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── 题目疑问（纠错上报）弹层 ── */}
      {reportQuestion && (
        <QuestionReportSheet question={reportQuestion} onClose={() => setReportQuestion(null)} />
      )}
    </div>
  )
}
