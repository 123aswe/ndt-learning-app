import React, { useMemo, useState } from 'react'
import { useHomeData } from '../hooks/useHomeData'
import { ShuffleIcon, XIcon } from './icons'
import { QTYPE_LABELS, QTYPE_ORDER } from '../data/qtypes'

/* ============================================================
   随机刷题选择面板（底部弹层）
   结构：方向选择（综合 + 各题库方向，带实时题量）/ 题型选择（全部/判断/选择/计算）
   - 题量来自 useHomeData → GET /api/bank/summary 的 methods + qtype_counts
   - 题量为 0 的组合「开始」按钮置灰（如当前题库暂无计算题）
   - 点「开始随机刷题」→ onStart({ category, qtype }) → 随机出 20 题进入答题页
   修改注意：颜色一律用 index.css 令牌；题型代码与后端 QTYPE_NAMES 保持一致
   ============================================================ */

interface RandomDrillSheetProps {
  onClose: () => void
  onStart: (opts: { category: string; qtype: string }) => void
}

/** 题型代码 → 展示名：统一从 src/data/qtypes.ts 取（与后端 bank.py 的 QTYPE_NAMES 同一套代码） */
const QTYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  ...QTYPE_ORDER.map(code => ({ value: code as string, label: QTYPE_LABELS[code] })),
]

export function RandomDrillSheet({ onClose, onStart }: RandomDrillSheetProps) {
  const { bank } = useHomeData()
  const [category, setCategory] = useState('综合')
  const [qtype, setQtype] = useState('')

  /** 方向 × 题型 → 题量（qtype_counts 查不到 = 0） */
  const countMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const row of bank?.qtype_counts ?? []) {
      m[`${row.method}|${row.qtype}`] = row.count
    }
    return m
  }, [bank])

  /** 该方向可用的题型列表（含「全部」，题量为 0 的题型不出现在选项里） */
  const qtypeOptions = useMemo(() => {
    const total = category === '综合' ? (bank?.total ?? 0) : (bank?.methods.find(m => m.method === category)?.count ?? 0)
    const opts = [{ value: '', label: '全部', count: total }]
    for (const q of QTYPE_OPTIONS.slice(1)) {
      const count = category === '综合'
        ? Object.entries(countMap).reduce((s, [k, n]) => (k.endsWith(`|${q.value}`) ? s + n : s), 0)
        : (countMap[`${category}|${q.value}`] ?? 0)
      if (count > 0) opts.push({ value: q.value, label: q.label, count })
    }
    return opts
  }, [category, bank, countMap])

  /** 当前组合题量为 0 时（如该方向只有一种题型），自动切到可用题型 */
  const activeQtype = qtypeOptions.some(q => q.value === qtype) ? qtype : ''
  const selectedCount = qtypeOptions.find(q => q.value === activeQtype)?.count ?? 0

  const methods = (bank?.methods ?? []).filter(m => m.count > 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative w-full max-w-[430px] rounded-t-3xl px-5 pt-5 pb-10 anim-sheet-in"
        style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--line)',
          boxShadow: '0 -4px 24px rgba(27,30,35,0.08)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <div className="flex justify-center mb-4">
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
        </div>

        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>随机刷题</h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center tap"
            style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)' }}
          >
            <XIcon size={15} color="var(--text-2)" />
          </button>
        </div>
        <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>选一个方向和题型，从题库里随机抽题</p>

        {/* 方向选择 */}
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>题库方向</label>
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {/* 综合 = 全部方向 */}
          <button
            onClick={() => setCategory('综合')}
            className="rounded-2xl px-2 py-3 text-center tap"
            style={{
              background: category === '综合' ? 'var(--accent-weak)' : 'var(--chip-bg-soft)',
              border: category === '综合' ? '1.5px solid var(--accent-border)' : '1px solid var(--chip-border)',
            }}
          >
            <div className="text-sm font-bold" style={{ color: category === '综合' ? 'var(--accent)' : 'var(--text-1)' }}>综合</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
              {bank?.total ?? 0} 题
            </div>
          </button>
          {methods.map(m => {
            const active = category === m.method
            return (
              <button
                key={m.method}
                onClick={() => setCategory(m.method)}
                className="rounded-2xl px-2 py-3 text-center tap"
                style={{
                  background: active ? 'var(--accent-weak)' : 'var(--chip-bg-soft)',
                  border: active ? '1.5px solid var(--accent-border)' : '1px solid var(--chip-border)',
                }}
              >
                <div className="text-sm font-bold" style={{ color: active ? 'var(--accent)' : 'var(--text-1)' }}>{m.method}</div>
                <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--text-3)' }}>{m.name} {m.count} 题</div>
              </button>
            )
          })}
        </div>

        {/* 题型选择（题量为 0 的题型不显示） */}
        <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>题目类型</label>
        <div className="grid grid-cols-4 gap-2.5 mb-6">
          {qtypeOptions.map(q => {
            const active = activeQtype === q.value
            return (
              <button
                key={q.value || 'all'}
                onClick={() => setQtype(q.value)}
                className="rounded-xl py-2.5 text-center tap"
                style={{
                  background: active ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
                  border: active ? '1px solid var(--accent-border)' : '1px solid var(--chip-border)',
                }}
              >
                <div className="text-xs font-semibold" style={{ color: active ? '#fff' : 'var(--text-2)' }}>{q.label}</div>
                <div
                  className="text-[10px] mt-0.5"
                  style={{ color: active ? 'rgba(255,255,255,0.85)' : 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {q.count} 题
                </div>
              </button>
            )
          })}
        </div>

        {/* 开始按钮 */}
        <button
          onClick={() => onStart({ category, qtype: activeQtype })}
          disabled={selectedCount === 0}
          className="w-full h-12 gb gb-primary rounded-2xl text-sm font-semibold flex items-center justify-center gap-2"
          style={{ opacity: selectedCount === 0 ? 0.5 : 1 }}
        >
          <ShuffleIcon size={16} />
          {selectedCount > 0 ? `开始随机刷题（${selectedCount} 题）` : '该组合暂无题目'}
        </button>
      </div>
    </div>
  )
}
