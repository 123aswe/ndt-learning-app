import React, { useEffect, useState } from 'react'
import { bankApi, practiceApi, type BankSet, type BankSetChapter } from '../api/client'
import { ChevronRightIcon, PlayIcon, TrashIcon, LayersIcon } from './icons'
import { QTYPE_LABELS, QTYPE_ORDER } from '../data/qtypes'

/* ============================================================
   题库练习面板（底部弹层，z-[60] 盖过底部导航 z-50）
   管理员后台创建的题库：先选题型（全部/判断/选择/计算/简答，实时题数，空题型隐藏）
   → 开始练习；垃圾桶 = 清除该题库我的做题记录（两步确认）

   v30 新增「按章节」Tab：
     - 章节来自 GET /api/bank/sets/{id}/chapters（后台「章节管理」建的章节，
       外加按 CSV「知识点一」自动分组的老题）
     - 每章可以单独练（topic 传章节名 + setId，服务端按 set_id + topic1 出题）
     - 每章也能单独清记录（只删这一章范围内我自己的）
     - 一个章节都没有时（题都没归章）隐藏这个 Tab，回到「整套题库顺序练」

   v34 新增 showChapters 开关：
     - 题库系列里的题库（BankSeriesScreen）传 false → 只留「选择题型 → 开始练习」，
       不显示章节 Tab、也不拉章节接口，界面更短、上手更快
     - 题库页「其他题库」的散题库不传（默认 true）→ 保持原来的「全部题目 / 按章节练习」
   ============================================================ */

interface SetPracticeSheetProps {
  set: BankSet
  onClose: () => void
  /** topic 传了 = 按该章节练习 */
  onStart: (opts: { qtype?: string; topic?: string }) => void
  /**
   * false = 不提供「按章节练习」（题库系列里的题库：选题型直接开始练习）。
   * 默认 true = 保留「全部题目 / 按章节练习」两个 Tab。
   */
  showChapters?: boolean
}

export function SetPracticeSheet({ set, onClose, onStart, showChapters = true }: SetPracticeSheetProps) {
  /** 'all' = 整套题库顺序练；'chapter' = 按章节挑一章练 */
  const [tab, setTab] = useState<'all' | 'chapter'>('all')
  /* 选中题型：'' = 全部（两个 Tab 共用） */
  const [qtype, setQtype] = useState('')
  /* 该题库整体做题统计（借 blocks 接口聚合，set_id 维度） */
  const [seqStat, setSeqStat] = useState<{ total: number; answered: number; correct: number; wrong: number } | null>(null)
  /* 章节列表（含每章题数与已做数） */
  const [chapters, setChapters] = useState<BankSetChapter[] | null>(null)
  /* 两步确认：'' / 'all' / 'ch-<章节名>' */
  const [confirmKey, setConfirmKey] = useState('')
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')

  /* 整套统计：题型变了要重算 */
  useEffect(() => {
    let cancelled = false
    practiceApi
      .blocks('综合', undefined, 20, set.id, qtype || undefined)
      .then(res => {
        if (cancelled) return
        const agg = res.blocks.reduce(
          (s, b) => ({ total: s.total + b.count, answered: s.answered + b.answered, correct: s.correct + b.correct, wrong: s.wrong + b.wrong }),
          { total: 0, answered: 0, correct: 0, wrong: 0 },
        )
        setSeqStat(agg)
      })
      .catch(() => {
        if (!cancelled) setSeqStat({ total: 0, answered: 0, correct: 0, wrong: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [set.id, qtype])

  /* 章节：题型变了按同口径重拉（题目数、已做数都跟着题型走）；showChapters=false 时压根不拉 */
  useEffect(() => {
    if (!showChapters) {
      setChapters([])
      return
    }
    let cancelled = false
    bankApi
      .setChapters(set.id, qtype || undefined)
      .then(res => {
        if (!cancelled) setChapters(res.items)
      })
      .catch(() => {
        if (!cancelled) setChapters([])
      })
    return () => {
      cancelled = true
    }
  }, [set.id, qtype, showChapters])

  const hasChapters = showChapters && (chapters ?? []).some(c => c.count > 0)
  /** 关掉章节时永远停在「整套题库」那一屏 */
  const activeTab = showChapters ? tab : 'all'

  /** 清除记录：先点一下变「确认」，再点才真删（避免误触）；scope 见 practiceApi.reset 参数 */
  const handleClear = (key: string, topic?: string) => {
    if (clearing) return
    if (confirmKey !== key) {
      setConfirmKey(key)
      return
    }
    setClearing(true)
    setConfirmKey('')
    practiceApi
      .reset('综合', topic, set.id, qtype || undefined)
      .then(() => {
        setError('')
        // 清完重拉统计与章节（做的标记全部归零）
        practiceApi
          .blocks('综合', undefined, 20, set.id, qtype || undefined)
          .then(res => {
            const agg = res.blocks.reduce(
              (s, b) => ({ total: s.total + b.count, answered: s.answered + b.answered, correct: s.correct + b.correct, wrong: s.wrong + b.wrong }),
              { total: 0, answered: 0, correct: 0, wrong: 0 },
            )
            setSeqStat(agg)
          })
          .catch(() => setSeqStat({ total: 0, answered: 0, correct: 0, wrong: 0 }))
        bankApi
          .setChapters(set.id, qtype || undefined)
          .then(res => setChapters(res.items))
          .catch(() => setChapters([]))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '清除失败'))
      .finally(() => setClearing(false))
  }

  /* 有题的题型选项（全部 + 各题型） */
  const qtypeOptions = [
    { code: '', label: '全部', count: set.total },
    ...QTYPE_ORDER
      .map(code => ({ code, label: QTYPE_LABELS[code], count: set.qtype_counts?.[code] ?? 0 }))
      .filter(o => o.count > 0),
  ]
  const picked = qtypeOptions.find(o => o.code === qtype)
  const pickedCount = picked ? picked.count : set.total

  /** 清除按钮（两步确认，样式与题库页一致） */
  const ClearButton = ({ k, topic, disabled }: { k: string; topic?: string; disabled?: boolean }) => {
    const confirming = confirmKey === k
    return (
      <button
        onClick={() => handleClear(k, topic)}
        disabled={clearing || disabled}
        aria-label="清除做题记录"
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 tap"
        style={{
          background: confirming ? 'var(--err-weak)' : 'transparent',
          border: confirming ? '1px solid var(--err-border)' : '1px solid var(--line)',
          color: confirming ? 'var(--err)' : 'var(--text-3)',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {confirming ? <span className="text-[10px] font-bold">确认</span> : <TrashIcon size={14} />}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] rounded-t-3xl anim-sheet-in flex flex-col"
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)', maxHeight: '82vh' }}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
        </div>

        <div className="px-5 pt-2 pb-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-bold text-lg truncate" style={{ color: 'var(--text-1)' }}>{set.name}</h3>
              {set.level && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                  style={{ background: 'var(--surface-warm)', color: 'var(--accent)', border: '1px solid var(--line)' }}
                >
                  {set.level}
                </span>
              )}
            </div>
            <button onClick={onClose} className="text-xs tap flex-shrink-0" style={{ color: 'var(--text-3)' }}>关闭</button>
          </div>

          {/* Tab：整套题库 / 按章节（没有章节时不显示，界面更干净） */}
          {hasChapters && (
            <div className="rounded-2xl p-1 flex gap-1 mb-3" style={{ background: 'var(--track)' }}>
              {([['all', '全部题目'], ['chapter', '按章节练习']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setTab(k); setConfirmKey('') }}
                  className="flex-1 h-9 rounded-xl text-sm font-semibold transition-all duration-200 tap"
                  style={{
                    background: tab === k ? 'var(--surface-raised)' : 'transparent',
                    color: tab === k ? 'var(--text-1)' : 'var(--text-3)',
                    boxShadow: tab === k ? 'var(--shadow-card)' : 'none',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>选择题目类型</p>
          <div className="flex flex-wrap gap-2">
            {qtypeOptions.map(o => {
              const active = qtype === o.code
              return (
                <button
                  key={o.code || 'all'}
                  onClick={() => { setQtype(o.code); setConfirmKey('') }}
                  className={`px-3 h-8 rounded-full text-xs font-semibold transition-colors duration-200 gb-pill ${active ? 'gb-soft' : ''}`}
                  style={{
                    background: active ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
                    color: active ? '#fff' : 'var(--text-2)',
                    border: active ? '1px solid var(--accent-border)' : '1px solid var(--chip-border)',
                  }}
                >
                  {o.label} · {o.count}
                </button>
              )
            })}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 pb-8" style={{ overscrollBehavior: 'contain' }}>
          {error && <p className="text-xs mb-3" style={{ color: 'var(--err)' }}>{error}</p>}

          {activeTab === 'all' && (
            seqStat === null ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
            ) : (
              <div className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)' }}>
                <button
                  onClick={() => onStart({ qtype: qtype || undefined })}
                  disabled={pickedCount === 0}
                  className="flex-1 flex items-center gap-3 text-left min-w-0 tap"
                  style={{ opacity: pickedCount === 0 ? 0.5 : 1 }}
                >
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
                  >
                    <PlayIcon size={15} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                      开始练习 · {pickedCount} 题
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                      {seqStat.answered > 0
                        ? <span>上次已做 {seqStat.answered} 题（对 {seqStat.correct} / 错 {seqStat.wrong}）</span>
                        : '顺序练习，做过标记会一直保留'}
                    </div>
                  </div>
                  <ChevronRightIcon size={15} color="var(--text-3)" />
                </button>
                <ClearButton k="all" disabled={seqStat.answered === 0} />
              </div>
            )
          )}

          {activeTab === 'chapter' && (
            chapters === null ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
            ) : chapters.filter(c => c.count > 0).length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>
                {qtype ? '该题型下这些章节还没有题目' : '这套题库还没有章节'}
              </p>
            ) : (
              <div className="space-y-2">
                {chapters.filter(c => c.count > 0).map(ch => (
                  <div
                    key={`${ch.chapter_id}-${ch.name}`}
                    className="flex items-center gap-2 rounded-xl px-3 py-3"
                    style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)' }}
                  >
                    <button
                      onClick={() => onStart({ topic: ch.name, qtype: qtype || undefined })}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <span
                        className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                        style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
                      >
                        {ch.count} 题
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{ch.name}</span>
                        {!ch.tagged && (
                          <span className="text-[9.5px]" style={{ color: 'var(--text-3)' }}>按知识点自动分组</span>
                        )}
                      </span>
                      {ch.answered > 0 && (
                        <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                          已做 {ch.answered}
                        </span>
                      )}
                      <ChevronRightIcon size={15} color="var(--text-3)" className="flex-shrink-0" />
                    </button>
                    <ClearButton k={`ch-${ch.name}`} topic={ch.name} disabled={ch.answered === 0} />
                  </div>
                ))}
              </div>
            )
          )}

          {confirmKey && (
            <p className="text-[10px] mt-3" style={{ color: 'var(--err)' }}>
              再点一次垃圾桶确认清除（只删我在这套题库的记录，不可恢复）
            </p>
          )}
          {showChapters && !hasChapters && activeTab === 'all' && (
            <p className="text-[10px] mt-3 flex items-center gap-1" style={{ color: 'var(--text-3)' }}>
              <LayersIcon size={11} /> 这套题库还没有章节，可在管理后台的「章节管理」里建
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
