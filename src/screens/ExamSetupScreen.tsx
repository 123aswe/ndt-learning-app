import React, { useEffect, useMemo, useState } from 'react'
import { bankApi, examApi, type BankSet, type BankSummary, type ExamStartResult } from '../api/client'
import { ChevronLeftIcon, ClipboardIcon, ClockIcon } from '../components/icons'

/* ============================================================
   模拟考试 · 考试设置页（苹果式浅色）
   流程：选题库（内置方向 / 自定义题库）→ 选题型（全部/判断/选择…）
        → 选题数（20/50/100，自动按库存裁剪）→ 选倒计时 → 开始考试
   数据来源：
     - GET /api/bank/summary + /api/bank/sets（题库与题型题量）
     - POST /api/exam/start（开卷，题目不带答案，服务端判分）
   ============================================================ */

interface ExamSetupScreenProps {
  onBack: () => void
  /** 开卷成功，携带整场考试信息进入答题页 */
  onStarted: (session: ExamStartResult) => void
}

/** 可选题库（内置方向 + 自定义题库统一成一种结构） */
interface BankOptionItem {
  key: string               // 'all' | 方向代码 | `set-${id}`
  label: string
  count: number
  /** 自定义题库 id（内置方向为 0） */
  setId: number
  /** 内置方向代码（自定义题库为 ''） */
  category: string
}

const COUNT_OPTIONS = [20, 50, 100]
const DURATION_OPTIONS = [15, 30, 60, 90]

const QTYPE_LABELS: Record<string, string> = {
  judge: '判断题',
  single: '选择题',
  calc: '计算题',
  short: '简答题',
}

export function ExamSetupScreen({ onBack, onStarted }: ExamSetupScreenProps) {
  const [summary, setSummary] = useState<BankSummary | null>(null)
  const [sets, setSets] = useState<BankSet[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  /* 选择状态 */
  const [bankKey, setBankKey] = useState('all')
  const [qtype, setQtype] = useState('')          // '' = 全部题型
  const [count, setCount] = useState(50)
  const [duration, setDuration] = useState(60)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    Promise.all([bankApi.summary(), bankApi.sets()])
      .then(([s, setsRes]) => {
        if (cancelled) return
        setSummary(s)
        setSets(setsRes.items)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '题库加载失败')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [reloadTick])

  /* ── 题库选项：全部方向 + 各内置方向（跳过 ZD）+ 自定义题库 ── */
  const bankOptions: BankOptionItem[] = useMemo(() => {
    if (!summary) return []
    const opts: BankOptionItem[] = [
      { key: 'all', label: '综合卷（全部方向）', count: summary.total, setId: 0, category: '综合' },
    ]
    for (const m of summary.methods) {
      if (m.method === 'ZD') continue // 自定义题库按题库单独列出
      if (m.count <= 0) continue
      opts.push({ key: m.method, label: `${m.method} · ${m.name}`, count: m.count, setId: 0, category: m.method })
    }
    for (const s of sets) {
      if (s.total <= 0) continue
      opts.push({ key: `set-${s.id}`, label: s.name, count: s.total, setId: s.id, category: '' })
    }
    return opts
  }, [summary, sets])

  const selectedBank = bankOptions.find(o => o.key === bankKey) ?? bankOptions[0]

  /* ── 题型选项：按当前题库的题型题量动态生成（空题型不显示） ── */
  const qtypeOptions = useMemo(() => {
    if (!summary || !selectedBank) return [{ code: '', label: '全部题型', count: 0 }]
    const counts: Record<string, number> = {}
    if (selectedBank.setId) {
      const s = sets.find(x => x.id === selectedBank.setId)
      Object.assign(counts, s?.qtype_counts ?? {})
    } else if (selectedBank.category && selectedBank.category !== '综合') {
      for (const q of summary.qtype_counts) {
        if (q.method === selectedBank.category) counts[q.qtype] = (counts[q.qtype] ?? 0) + q.count
      }
    } else {
      for (const q of summary.qtype_counts) counts[q.qtype] = (counts[q.qtype] ?? 0) + q.count
    }
    const opts = [{ code: '', label: '全部题型', count: selectedBank.count }]
    for (const [code, label] of Object.entries(QTYPE_LABELS)) {
      const n = counts[code] ?? 0
      if (n > 0) opts.push({ code, label, count: n })
    }
    return opts
  }, [summary, sets, selectedBank])

  /* 切换题库/题型后：题型失效回退、题数裁剪到库存 */
  useEffect(() => {
    if (qtype && !qtypeOptions.some(o => o.code === qtype)) setQtype('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankKey])

  const available = useMemo(() => {
    if (qtype) return qtypeOptions.find(o => o.code === qtype)?.count ?? 0
    return selectedBank?.count ?? 0
  }, [qtype, qtypeOptions, selectedBank])

  useEffect(() => {
    if (count > available) setCount(available)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available])

  const countChips = useMemo(() => {
    const chips = COUNT_OPTIONS.filter(n => n <= available)
    if (chips.length === 0 || available < 20) return available > 0 ? [available] : []
    return chips
  }, [available])

  const handleStart = () => {
    if (starting || !selectedBank || available <= 0) return
    setStarting(true)
    setStartError('')
    examApi
      .start({
        category: selectedBank.setId ? undefined : selectedBank.category,
        set_id: selectedBank.setId || undefined,
        qtype: qtype || undefined,
        count: Math.min(count, available),
        duration_minutes: duration,
      })
      .then(session => onStarted(session))
      .catch((err: unknown) => {
        setStartError(err instanceof Error ? err.message : '开卷失败，请重试')
        setStarting(false)
      })
  }

  /* ── 通用选择卡样式（选中=accent 填充） ── */
  const chipStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
    color: active ? 'var(--on-accent)' : 'var(--text-2)',
    border: `1px solid ${active ? 'var(--accent-border)' : 'var(--chip-border)'}`,
    boxShadow: 'inset 1px 1px 0 var(--inset-hi), inset -1px -1px 0 rgba(27,30,35,0.04), 0 2px 6px rgba(27,30,35,0.05)',
  })

  if (loading) {
    return (
      <div className="app-shell flex flex-col items-center justify-center bg-page" style={{ height: '100dvh' }}>
        <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        <p className="text-sm mt-4" style={{ color: 'var(--text-3)' }}>正在加载题库…</p>
      </div>
    )
  }

  return (
    <div className="app-shell flex flex-col bg-page min-h-screen">
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button onClick={onBack} aria-label="返回" className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center flex-shrink-0" style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}>
          <ChevronLeftIcon size={18} color="var(--text-2)" />
        </button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>模拟考试</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>选题库 → 题型 → 题数 → 倒计时，到点自动交卷</p>
        </div>
      </div>

      <div className="flex-1 px-4 space-y-5 overflow-y-auto" style={{ paddingBottom: 40 }}>
        {loadError && (
          <div className="px-1">
            <p className="text-xs" style={{ color: 'var(--err)' }}>{loadError}（请确认后端服务已启动）</p>
            <button onClick={() => setReloadTick(t => t + 1)} className="mt-1 text-xs font-semibold tap" style={{ color: 'var(--accent)' }}>重新加载</button>
          </div>
        )}

        {/* ── 第 1 步：选择题库 ── */}
        <section>
          <p className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <BookMark /> 第 1 步 · 选择题库
          </p>
          <div className="space-y-2">
            {bankOptions.map(o => {
              const active = o.key === selectedBank?.key
              return (
                <button
                  key={o.key}
                  onClick={() => setBankKey(o.key)}
                  className="w-full card px-4 py-3 flex items-center justify-between card-tap"
                  style={{
                    border: `1.5px solid ${active ? 'var(--accent-border)' : 'var(--line)'}`,
                    background: active ? 'var(--accent-weak)' : 'var(--surface-raised)',
                  }}
                >
                  <span className="text-sm font-semibold" style={{ color: active ? 'var(--accent)' : 'var(--text-1)' }}>{o.label}</span>
                  <span className="text-xs flex-shrink-0 ml-2" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{o.count} 题</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── 第 2 步：选择题型 ── */}
        <section>
          <p className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <BookMark /> 第 2 步 · 选择题型
          </p>
          <div className="flex gap-2 flex-wrap">
            {qtypeOptions.map(o => (
              <button key={o.code || 'all'} onClick={() => setQtype(o.code)} className="px-4 h-10 gb gb-pill rounded-xl text-sm font-medium" style={chipStyle(qtype === o.code)}>
                {o.label}
                {o.code && <span className="ml-1.5 text-[10px] opacity-70">{o.count}</span>}
              </button>
            ))}
          </div>
        </section>

        {/* ── 第 3 步：题目数量 ── */}
        <section>
          <p className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <BookMark /> 第 3 步 · 题目数量
          </p>
          {available <= 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>该范围暂无题目</p>
          ) : (
            <div className="flex gap-2">
              {countChips.map(n => (
                <button key={n} onClick={() => setCount(n)} className="flex-1 h-11 gb gb-pill rounded-xl text-sm font-semibold" style={chipStyle(count === Math.min(n, available))}>
                  {n >= available && available < 20 ? `全部 ${n} 题` : `${n} 题`}
                </button>
              ))}
              {countChips.every(n => n < available) && (
                <button onClick={() => setCount(available)} className="flex-1 h-11 gb gb-pill rounded-xl text-sm font-semibold" style={chipStyle(count === available)}>
                  全部 {available} 题
                </button>
              )}
            </div>
          )}
        </section>

        {/* ── 第 4 步：倒计时 ── */}
        <section>
          <p className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
            <BookMark /> 第 4 步 · 考试时长
          </p>
          <div className="flex gap-2 flex-wrap">
            {DURATION_OPTIONS.map(m => (
              <button key={m} onClick={() => setDuration(m)} className="px-4 h-10 gb gb-pill rounded-xl text-sm font-medium" style={chipStyle(duration === m)}>
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon size={13} />
                  {m} 分钟
                </span>
              </button>
            ))}
          </div>
          <p className="text-[10px] mt-2" style={{ color: 'var(--text-3)' }}>倒计时结束将自动交卷，考试中可以随时手动交卷</p>
        </section>

        {startError && <p className="text-xs text-center" style={{ color: 'var(--err)' }}>{startError}</p>}

        {/* ── 开始考试 ── */}
        <button
          onClick={handleStart}
          disabled={starting || available <= 0}
          className="w-full gb gb-primary gb-lg font-semibold text-base flex items-center justify-center gap-2"
          style={{ height: 52, opacity: starting || available <= 0 ? 0.6 : 1 }}
        >
          <ClipboardIcon size={17} color="var(--on-accent)" />
          {starting ? '正在出卷…' : `开始考试（${Math.min(count, available)} 题 · ${duration} 分钟）`}
        </button>
      </div>
    </div>
  )
}

/** 小圆点装饰（步骤标题前） */
function BookMark() {
  return <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--accent)' }} />
}
