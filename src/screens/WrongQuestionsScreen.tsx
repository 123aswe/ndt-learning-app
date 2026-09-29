import React, { useState } from 'react'
import { wrongRecords, getQuestionById } from '../data/mockData'
import { ChevronRightIcon, CheckIcon, XIcon, RefreshIcon, CheckCircleIcon } from '../components/icons'
import type { WrongRecord } from '../types'

/* ============================================================
   错题本页（苹果式浅色）
   结构保持：标题 / 统计行 / 筛选 Tab / 错题卡片（展开历史/答案/解析/操作）
   状态色：未掌握=低饱和红，已掌握=低饱和绿
   ============================================================ */

interface WrongQuestionsScreenProps {
  onStartPractice: (categoryId: string) => void
}

type Filter = 'all' | 'unmastered' | 'mastered'

export function WrongQuestionsScreen({ onStartPractice }: WrongQuestionsScreenProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = wrongRecords.filter(r => {
    if (filter === 'unmastered') return !r.mastered
    if (filter === 'mastered') return r.mastered
    return true
  })

  const totalWrong = wrongRecords.length
  const unmastered = wrongRecords.filter(r => !r.mastered).length
  const mastered = wrongRecords.filter(r => r.mastered).length

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* 标题 */}
        <div className="px-5 pt-14 pb-4">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>错题本</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>{unmastered} 道未掌握，{mastered} 道已掌握</p>
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
                  background: filter === f.id ? 'rgba(95,141,140,0.90)' : 'rgba(255,255,255,0.68)',
                  color: filter === f.id ? '#fff' : 'var(--text-2)',
                  border: filter === f.id ? '1px solid rgba(95,141,140,0.6)' : '1px solid rgba(255,255,255,0.75)',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 错题列表 */}
        {filtered.length === 0 ? (
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
              const q = getQuestionById(record.questionId)
              if (!q) return null
              const isExpanded = expandedId === record.questionId

              return (
                <div key={record.questionId} className="card overflow-hidden anim-slide-up" style={{ animationDelay: `${idx * 0.05}s` }}>
                  {/* 头部 */}
                  <button
                    className="w-full p-4 text-left tap"
                    onClick={() => setExpandedId(isExpanded ? null : record.questionId)}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                        style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                      >
                        {q.category}
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
                              : `错误 ${record.wrongCount} 次`}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{q.knowledgePoint}</span>
                        </div>

                        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--text-2)' }}>{q.text}</p>
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
                                {i === 0 ? '第一次' : i === 1 ? '第二次' : '第三次'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 正确答案 */}
                      <div className="mb-4">
                        <p className="text-[10px] font-medium tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>正确答案</p>
                        <div className="rounded-xl px-3 py-2.5 flex items-start gap-2" style={{ background: 'var(--ok-weak)', border: '1px solid var(--ok-border)' }}>
                          <span className="font-bold text-sm" style={{ color: 'var(--ok)' }}>{q.correct}.</span>
                          <span className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                            {q.options.find(o => o.key === q.correct)?.text}
                          </span>
                        </div>
                      </div>

                      {/* 解析 */}
                      <div className="mb-4">
                        <p className="text-[10px] font-medium tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>解析</p>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>{q.explanation}</p>
                      </div>

                      {/* 操作 */}
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => onStartPractice(q.category)}
                          className="flex-1 h-9 gb-pill rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                          style={{
                            background: 'rgba(95,141,140,0.14)',
                            color: 'var(--accent)',
                            border: '1px solid rgba(95,141,140,0.35)',
                            boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.7), 0 2px 6px rgba(95,141,140,0.12)',
                          }}
                        >
                          <RefreshIcon size={13} />
                          再练一次
                        </button>
                        <button
                          className="flex-1 h-9 gb-pill rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                          style={{
                            background: 'rgba(111,163,124,0.14)',
                            color: 'var(--ok)',
                            border: '1px solid rgba(111,163,124,0.35)',
                            boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.7), 0 2px 6px rgba(111,163,124,0.12)',
                          }}
                        >
                          <CheckCircleIcon size={13} />
                          标记已掌握
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
    </div>
  )
}
