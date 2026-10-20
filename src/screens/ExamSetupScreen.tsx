import React, { useEffect, useMemo, useState } from 'react'
import { bankApi, examApi, type BankSeries, type BankSet, type BankSummary, type ExamStartResult } from '../api/client'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClipboardIcon, ClockIcon } from '../components/icons'
import { QTYPE_LABELS } from '../data/qtypes'

/* ============================================================
   模拟考试 · 考试设置页（v1.77 层级选择版）
   流程：选方向（综合卷 / UT / RT / MT / PT 大卡片）
        → 选来源（内置方向题库 / 题库系列〔系列全部 或 具体题库〕/ 未入系列的其他题库）
        → 选题型 → 选题数 → 选倒计时 → 开始考试
   数据来源：
     - GET /api/bank/summary + /api/bank/sets + /api/bank/series
     - POST /api/exam/start（内置传 category；单题库传 set_id；系列全部传 set_ids）
   ============================================================ */

interface ExamSetupScreenProps {
  onBack: () => void
  /** 开卷成功，携带整场考试信息进入答题页 */
  onStarted: (session: ExamStartResult) => void
}

/** 出题范围：'builtin' = 内置方向题库；`set-${id}` = 单套题库；`series-${id}` = 系列全部 */
type ScopeKey = string

const COUNT_OPTIONS = [20, 50, 100]
const DURATION_OPTIONS = [15, 30, 60, 90]

/* 题型展示名统一从 src/data/qtypes.ts 取（与后端 bank.py QTYPE_NAMES 同一套代码） */

export function ExamSetupScreen({ onBack, onStarted }: ExamSetupScreenProps) {
  const [summary, setSummary] = useState<BankSummary | null>(null)
  const [sets, setSets] = useState<BankSet[]>([])
  const [series, setSeries] = useState<BankSeries[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  /* 选择状态：第 1 步方向 → 第 2 步来源（范围） */
  const [dir, setDir] = useState('综合')            // '综合' | UT / RT / MT / PT
  const [scope, setScope] = useState<ScopeKey>('builtin')
  const [expandedSeries, setExpandedSeries] = useState<number | null>(null)
  const [qtype, setQtype] = useState('')            // '' = 全部题型
  const [count, setCount] = useState(50)
  const [duration, setDuration] = useState(60)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    Promise.all([bankApi.summary(), bankApi.sets(), bankApi.series()])
      .then(([s, setsRes, seriesRes]) => {
        if (cancelled) return
        setSummary(s)
        setSets(setsRes.items)
        setSeries(seriesRes.items)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : '题库加载失败')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [reloadTick])

  /* ── 第 1 步方向选项：综合卷 + 各内置方向（跳过 ZD） ── */
  const dirOptions = useMemo(() => {
    if (!summary) return []
    const opts: { code: string; label: string; count: number }[] = [
      { code: '综合', label: '综合卷', count: summary.total },
    ]
    for (const m of summary.methods) {
      if (m.method === 'ZD') continue
      if (m.count <= 0) continue
      opts.push({ code: m.method, label: `${m.method} · ${m.name}`, count: m.count })
    }
    return opts
  }, [summary])

  /* 方向代码 → 中文名（系列 / 题库徽标用） */
  const methodName = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of summary?.methods ?? []) map[m.method] = m.name
    return (code: string) => map[code] ?? code
  }, [summary])

  /* 当前方向下可见的系列 / 散题库：
     综合 = 全部；具体方向 = 方向相符，或 系列/题库 未指定方向（'' 通用 / 综合） */
  const visibleSeries = useMemo(
    () => series.filter(s => dir === '综合' || !s.method || s.method === '综合' || s.method === dir),
    [series, dir],
  )
  const looseSets = useMemo(
    () => sets.filter(s => s.series_id === 0 && (dir === '综合' || !s.method || s.method === '综合' || s.method === dir)),
    [sets, dir],
  )
  const memberSets = useMemo(() => {
    const bySeries = new Map<number, BankSet[]>()
    for (const s of sets) {
      if (s.series_id === 0) continue
      const list = bySeries.get(s.series_id) ?? []
      list.push(s)
      bySeries.set(s.series_id, list)
    }
    return bySeries
  }, [sets])

  /* 切方向后范围失效回内置（防止残留被过滤掉的系列/题库） */
  useEffect(() => {
    setScope('builtin')
    setExpandedSeries(null)
  }, [dir])

  /* ── 当前范围的题量与题型分布 ── */
  const scopeInfo = useMemo(() => {
    if (!summary) return { count: 0, qtypeCounts: {} as Record<string, number> }
    if (scope === 'builtin') {
      const counts: Record<string, number> = {}
      for (const q of summary.qtype_counts) {
        if (dir === '综合' || q.method === dir) counts[q.qtype] = (counts[q.qtype] ?? 0) + q.count
      }
      const total = dir === '综合'
        ? summary.total
        : summary.methods.find(m => m.method === dir)?.count ?? 0
      return { count: total, qtypeCounts: counts }
    }
    if (scope.startsWith('set-')) {
      const s = sets.find(x => x.id === Number(scope.slice(4)))
      return { count: s?.total ?? 0, qtypeCounts: { ...(s?.qtype_counts ?? {}) } }
    }
    // series-：系列全部 = 成员题库合并
    const members = memberSets.get(Number(scope.slice(7))) ?? []
    const counts: Record<string, number> = {}
    for (const s of members) {
      for (const [code, n] of Object.entries(s.qtype_counts ?? {})) {
        counts[code] = (counts[code] ?? 0) + n
      }
    }
    const sr = series.find(x => x.id === Number(scope.slice(7)))
    return { count: sr?.total ?? members.reduce((a, s) => a + s.total, 0), qtypeCounts: counts }
  }, [summary, sets, series, memberSets, dir, scope])

  /* ── 题型选项：按当前范围的题型题量动态生成（空题型不显示） ── */
  const qtypeOptions = useMemo(() => {
    const opts = [{ code: '', label: '全部题型', count: scopeInfo.count }]
    for (const [code, label] of Object.entries(QTYPE_LABELS)) {
      const n = scopeInfo.qtypeCounts[code] ?? 0
      if (n > 0) opts.push({ code, label, count: n })
    }
    return opts
  }, [scopeInfo])

  /* 切换范围/方向后：题型失效回退、题数裁剪到库存 */
  useEffect(() => {
    if (qtype && !qtypeOptions.some(o => o.code === qtype)) setQtype('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, dir])

  const available = scopeInfo.count

  useEffect(() => {
    if (available <= 0) return
    if (count === 0) setCount(Math.min(50, available))          // 挂载期库存为 0 会把 count 钳成 0，加载后回弹默认值
    else if (count > available) setCount(available)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available])

  const countChips = useMemo(() => {
    const chips = COUNT_OPTIONS.filter(n => n <= available)
    if (chips.length === 0 || available < 20) return available > 0 ? [available] : []
    return chips
  }, [available])

  const handleStart = () => {
    if (starting || available <= 0) return
    setStarting(true)
    setStartError('')
    const payload: Parameters<typeof examApi.start>[0] = {
      qtype: qtype || undefined,
      count: Math.min(count, available),
      duration_minutes: duration,
    }
    if (scope === 'builtin') {
      payload.category = dir
    } else if (scope.startsWith('set-')) {
      payload.set_id = Number(scope.slice(4))
    } else {
      payload.set_ids = (memberSets.get(Number(scope.slice(7))) ?? []).map(s => s.id)
    }
    examApi
      .start(payload)
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
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>方向 → 来源 → 题型 → 题数，到点自动交卷</p>
        </div>
      </div>

      <div className="ui-stagger flex-1 px-4 space-y-5 overflow-y-auto" style={{ paddingBottom: 40 }}>
        {loadError && (
          <div className="px-1">
            <p className="text-xs" style={{ color: 'var(--err)' }}>{loadError}（请确认后端服务已启动）</p>
            <button onClick={() => setReloadTick(t => t + 1)} className="mt-1 text-xs font-semibold tap" style={{ color: 'var(--accent)' }}>重新加载</button>
          </div>
        )}

        {/* ── 第 1 步：考试方向（大卡片，综合卷通栏） ── */}
        <section>
          <StepTitle n={1} label="考试方向" />
          <div className="grid grid-cols-2 gap-2">
            {dirOptions.map(o => {
              const active = dir === o.code
              const featured = o.code === '综合'
              return (
                <button
                  key={o.code}
                  onClick={() => setDir(o.code)}
                  className={`card card-tap px-4 py-3 text-left ${featured ? 'col-span-2' : ''}`}
                  style={{
                    border: `1.5px solid ${active ? 'var(--accent-border)' : 'var(--line)'}`,
                    background: active ? 'var(--accent-weak)' : 'var(--surface-raised)',
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate" style={{ color: active ? 'var(--accent)' : 'var(--text-1)' }}>{o.label}</span>
                    <CheckDot on={active} />
                  </div>
                  <p className="text-xs mt-1" style={{ color: active ? 'var(--accent)' : 'var(--text-3)', opacity: active ? 0.8 : 1, fontVariantNumeric: 'tabular-nums' }}>
                    {o.count} 题
                  </p>
                </button>
              )
            })}
          </div>
        </section>

        {/* ── 第 2 步：题目来源（内置 / 题库系列〔可展开选具体题库〕/ 其他题库） ── */}
        <section>
          <StepTitle n={2} label="题目来源" />

          {/* 内置方向题库 */}
          <ScopeRow
            active={scope === 'builtin'}
            title={dir === '综合' ? '官方题库 · 全部方向' : `官方题库 · ${methodName(dir)}`}
            tag="内置"
            count={dir === '综合' ? summary?.total ?? 0 : summary?.methods.find(m => m.method === dir)?.count ?? 0}
            onClick={() => setScope('builtin')}
          />

          {/* 题库系列（手风琴：系列全部 / 具体题库） */}
          {visibleSeries.length > 0 && (
            <>
              <p className="text-[11px] font-medium mt-3 mb-1.5 px-1" style={{ color: 'var(--text-3)' }}>题库系列</p>
              <div className="space-y-2">
                {visibleSeries.map(sr => {
                  const expanded = expandedSeries === sr.id
                  const seriesActive = scope === `series-${sr.id}`
                  const members = memberSets.get(sr.id) ?? []
                  return (
                    <div
                      key={sr.id}
                      className="rounded-2xl overflow-hidden"
                      style={{
                        border: `1.5px solid ${seriesActive || expanded ? 'var(--accent-border)' : 'var(--line)'}`,
                        background: seriesActive ? 'var(--accent-weak)' : 'var(--surface-raised)',
                      }}
                    >
                      <button
                        onClick={() => setExpandedSeries(expanded ? null : sr.id)}
                        className="w-full px-4 py-3 flex items-center gap-3 card-tap text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: seriesActive ? 'var(--accent)' : 'var(--text-1)' }}>{sr.name}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                            {sr.bank_count} 套题库
                            {(sr.level || sr.method) && <> · {[sr.level, sr.method ? methodName(sr.method) : ''].filter(Boolean).join(' · ')}</>}
                          </p>
                        </div>
                        <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{sr.total} 题</span>
                        <span className="flex-shrink-0" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .2s', display: 'inline-flex' }}>
                          <ChevronRightIcon size={15} color="var(--text-3)" />
                        </span>
                      </button>
                      {expanded && (
                        <div className="px-3 pb-3 space-y-1.5">
                          <ScopeRow
                            compact
                            active={seriesActive}
                            title="系列全部"
                            count={sr.total}
                            onClick={() => setScope(`series-${sr.id}`)}
                          />
                          {members.map(ms => (
                            <ScopeRow
                              key={ms.id}
                              compact
                              active={scope === `set-${ms.id}`}
                              title={ms.name}
                              count={ms.total}
                              onClick={() => setScope(`set-${ms.id}`)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* 未入系列的其他题库 */}
          {looseSets.length > 0 && (
            <>
              <p className="text-[11px] font-medium mt-3 mb-1.5 px-1" style={{ color: 'var(--text-3)' }}>其他题库（未入系列）</p>
              <div className="space-y-2">
                {looseSets.map(s => (
                  <ScopeRow
                    key={s.id}
                    active={scope === `set-${s.id}`}
                    title={s.name}
                    count={s.total}
                    onClick={() => setScope(`set-${s.id}`)}
                  />
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── 第 3 步：选择题型 ── */}
        <section>
          <StepTitle n={3} label="选择题型" />
          <div className="flex gap-2 flex-wrap">
            {qtypeOptions.map(o => (
              <button key={o.code || 'all'} onClick={() => setQtype(o.code)} className="px-4 h-10 gb gb-pill rounded-xl text-sm font-medium" style={chipStyle(qtype === o.code)}>
                {o.label}
                {o.code && <span className="ml-1.5 text-[10px] opacity-70">{o.count}</span>}
              </button>
            ))}
          </div>
        </section>

        {/* ── 第 4 步：题目数量 ── */}
        <section>
          <StepTitle n={4} label="题目数量" />
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

        {/* ── 第 5 步：倒计时 ── */}
        <section>
          <StepTitle n={5} label="考试时长" />
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

/** 步骤标题（第 N 步 · xxx） */
function StepTitle({ n, label }: { n: number; label: string }) {
  return (
    <p className="text-xs font-semibold mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: 'var(--accent)' }} />
      第 {n} 步 · {label}
    </p>
  )
}

/** 范围选择行：左侧勾选圆点 + 标题（可带小标签）+ 右侧题量 */
function ScopeRow({ active, title, tag, count, onClick, compact }: {
  active: boolean
  title: string
  tag?: string
  count: number
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 card-tap text-left ${compact ? 'px-3 py-2.5 rounded-xl' : 'px-4 py-3 rounded-2xl'}`}
      style={{
        background: active ? 'var(--accent-weak)' : 'var(--surface-raised)',
        border: `1.5px solid ${active ? 'var(--accent-border)' : 'var(--line)'}`,
      }}
    >
      <CheckDot on={active} />
      <span className="text-sm font-semibold flex-1 min-w-0 truncate" style={{ color: active ? 'var(--accent)' : 'var(--text-1)' }}>
        {title}
        {tag && (
          <span
            className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md align-middle"
            style={{ background: active ? 'var(--accent-fill)' : 'var(--chip-bg-soft)', color: active ? 'var(--on-accent)' : 'var(--text-3)' }}
          >
            {tag}
          </span>
        )}
      </span>
      <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{count} 题</span>
    </button>
  )
}

/** 勾选圆点（选中 = accent 填充 + 对勾） */
function CheckDot({ on }: { on: boolean }) {
  return (
    <span
      className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
      style={{
        border: `1.5px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
        background: on ? 'var(--accent)' : 'transparent',
        transition: 'all .15s',
      }}
    >
      {on && <CheckIcon size={11} color="var(--on-accent)" />}
    </span>
  )
}
