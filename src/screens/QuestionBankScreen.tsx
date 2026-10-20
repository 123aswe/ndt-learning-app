import React, { useEffect, useRef, useState } from 'react'
import {
  bankApi, practiceApi,
  type BankChapter, type BankSearchItem, type BankSeries, type BankSet, type BankSummary,
} from '../api/client'
import { SearchIcon, FilterIcon, ChevronRightIcon, TrashIcon, PlayIcon, LayersIcon, ListIcon } from '../components/icons'
import { SetPracticeSheet } from '../components/SetPracticeSheet'
import { stripRichText } from '../data/richText'
import { QTYPE_LABELS, QTYPE_ORDER } from '../data/qtypes'
import { useStagger } from '../hooks/useStagger'
import type { NDTMethod } from '../types'

/* ============================================================
   题库分类页（苹果式浅色）
   结构（v30 三层：题库系列 → 题库 → 章节）：
     标题 / 搜索框 / 分类 Tab
       → 检测方法卡（内置一级题库，点开「选择练习方式」，可顺序或按章节）
       → 题库系列卡（后台建的分组，点进「题库系列详情页」看这个系列下的题库）
       → 其他题库（没归系列的散题库，直接平铺）
   数据全部实时：
   - 概览与各方向题量、我的完成度 → GET /api/bank/summary
   - 题库系列 → GET /api/bank/series；题库 → GET /api/bank/sets（都只返回有题/有库的）
   - 搜索 → GET /api/bank/search（300ms 防抖）
   - 点题库 → 练习面板（整套题库 / 按章节，见 components/SetPracticeSheet.tsx）
   分类 Tab 口径（v30 起）：
     - 内置方向卡：按方向题量（老行为不变）
     - 题库系列：按系列的「方向」字段过滤；「通用」系列在所有 Tab 下都显示
     - 散题库（未归系列）只在「全部」Tab 下显示（它们没有方向归属）
   修改注意：
     - 题型标签统一从 src/data/qtypes.ts 取（与 server/modules/bank.py QTYPE_NAMES 同步）
   ============================================================ */

interface QuestionBankScreenProps {
  onStartPractice: (categoryId: string, opts?: { topic?: string; setId?: number; qtype?: string; setTitle?: string }) => void
  /** 点题库系列卡 → 进「题库系列详情页」（由 App.tsx 切视图） */
  onOpenBankSeries: (series: BankSeries) => void
  /** v1.76 从这个题库进的练习，退出 / 交卷回题库页时自动重新展开它的练习面板（值 = 题库 id） */
  restoreSetId?: number | null
  /** 消费完通知 App 清空（否则以后每次切回题库 Tab 都会自动弹面板） */
  onRestoreConsumed?: () => void
}

/** 由方向代码推导的训练集名（方向中文名来自接口） */
const ALL_CATS: Array<NDTMethod | '全部' | 'ET' | 'VT' | '综合'> = [
  '全部', 'UT', 'RT', 'MT', 'PT', 'ET', 'VT', '综合',
]

/* ── 题库系列卡（横向条：封面缩略 + 名称 + 简介 + 题库数/题数），点进系列详情页 ── */
function BankSeriesCard({ series, onOpen }: { series: BankSeries; onOpen: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false)
  const useCover = series.has_cover && !coverFailed
  return (
    <button onClick={onOpen} className="card w-full px-3 py-3 flex items-center gap-3.5 card-tap text-left">
      <div
        className="w-16 h-16 rounded-2xl flex-shrink-0 relative overflow-hidden flex items-center justify-center"
        style={{
          background: 'linear-gradient(150deg, var(--accent-weak), var(--surface-warm))',
          border: '1px solid var(--accent-border)',
        }}
      >
        {useCover ? (
          <img
            src={bankApi.seriesCoverUrl(series.id)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span style={{ color: 'var(--accent)', opacity: 0.3 }}><LayersIcon size={26} /></span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <LayersIcon size={12} color="var(--accent)" />
          <span className="text-[9.5px] font-bold tracking-wide" style={{ color: 'var(--accent)' }}>
            {series.method ? `${series.method} 题库系列` : '题库系列'}
          </span>
        </div>
        <p className="text-[13.5px] font-bold mt-1 line-clamp-1" style={{ color: 'var(--text-1)' }}>{series.name}</p>
        <p className="text-[10.5px] mt-0.5 line-clamp-1" style={{ color: 'var(--text-3)' }}>
          {series.description || `${series.bank_count} 套题库`}
        </p>
        <p className="text-[10px] mt-1 font-semibold" style={{ color: 'var(--text-2)' }}>
          共 {series.bank_count} 套题库 · {series.total} 题
        </p>
      </div>

      <ChevronRightIcon size={16} color="var(--text-3)" />
    </button>
  )
}

/* ── 题库卡（散题库 / 系列详情页共用）：封面缩略 + 名称 + 级别 + 题数/题型分布 ── */
export function BankSetCard({ set, onOpen }: { set: BankSet; onOpen: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false)
  const useCover = set.has_cover && !coverFailed
  const dist = QTYPE_ORDER
    .map(q => ({ label: QTYPE_LABELS[q], n: set.qtype_counts?.[q] ?? 0 }))
    .filter(x => x.n > 0)
  return (
    <button onClick={onOpen} className="w-full card p-4 text-left card-tap">
      <div className="flex items-start gap-4">
        <div
          className="w-12 h-12 rounded-2xl flex-shrink-0 relative overflow-hidden flex items-center justify-center"
          style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
        >
          {useCover ? (
            <img
              src={bankApi.setCoverUrl(set.id)}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <ListIcon size={20} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{set.name}</span>
            {set.level && (
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{ background: 'var(--surface-warm)', color: 'var(--accent)', border: '1px solid var(--line)' }}
              >
                {set.level}
              </span>
            )}
          </div>
          {set.description && (
            <p className="text-xs mb-2 line-clamp-1" style={{ color: 'var(--text-3)' }}>{set.description}</p>
          )}

          <div className="flex items-center gap-2 flex-wrap text-[10px]" style={{ color: 'var(--text-3)' }}>
            <span className="font-semibold">共 {set.total} 题</span>
            {set.chapter_count > 0 && <span>· {set.chapter_count} 个章节</span>}
            {dist.map(d => (
              <span
                key={d.label}
                className="px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--chip-bg-soft)', border: '1px solid var(--chip-border)' }}
              >
                {d.label} {d.n}
              </span>
            ))}
          </div>
        </div>

        <ChevronRightIcon size={16} className="mt-2 flex-shrink-0" color="var(--text-3)" />
      </div>
    </button>
  )
}

export function QuestionBankScreen({ onStartPractice, onOpenBankSeries, restoreSetId, onRestoreConsumed }: QuestionBankScreenProps) {
  const [activeCategory, setActiveCategory] = useState<(typeof ALL_CATS)[number]>('全部')
  const [searchText, setSearchText] = useState('')
  const [showFilter, setShowFilter] = useState(false)

  /* ── 题库概览（实时） ── */
  const [bank, setBank] = useState<BankSummary | null>(null)
  const [sets, setSets] = useState<BankSet[] | null>(null)
  const [series, setSeries] = useState<BankSeries[]>([])
  const [bankError, setBankError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)
  /* 整屏进场动效：切分类 / 重载题库数据时，分区再错峰播一次（不重挂载 → 搜索框不丢焦点） */
  const staggerRef = useStagger<HTMLDivElement>(`${activeCategory}-${reloadTick}`)

  /* ── 搜索（防抖） ── */
  const [searchResults, setSearchResults] = useState<BankSearchItem[] | null>(null)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<number | null>(null)

  /* ── 「选择练习方式」面板 ── */
  const [pickerCategory, setPickerCategory] = useState<string | null>(null)
  /* ── 自定义题库练习面板 ── */
  const [pickerSet, setPickerSet] = useState<BankSet | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([bankApi.summary(), bankApi.sets(), bankApi.series()])
      .then(([summary, setsRes, seriesRes]) => {
        if (cancelled) return
        setBank(summary)
        setSets(setsRes.items)
        setSeries(seriesRes.items)
        setBankError('')
      })
      .catch((err: unknown) => {
        if (!cancelled) setBankError(err instanceof Error ? err.message : '题库加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadTick])

  /* v1.76 从本页进的练习，退出 / 交卷后回到题库页：等数据拉回来，自动重新展开那套题库的练习面板
     （考生接着选别的章节，不用重新找一遍）；消费完通知 App 清空标记 */
  useEffect(() => {
    if (restoreSetId == null || !sets) return
    const hit = sets.find(s => s.id === restoreSetId)
    if (hit) setPickerSet(hit)
    onRestoreConsumed?.()
  }, [restoreSetId, sets, onRestoreConsumed])

  useEffect(() => {
    const kw = searchText.trim()
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    if (!kw) {
      setSearchResults(null)
      setSearchTotal(0)
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimer.current = window.setTimeout(() => {
      let cancelled = false
      bankApi
        .search(kw)
        .then(res => {
          if (!cancelled) {
            setSearchResults(res.items)
            setSearchTotal(res.total)
            setSearching(false)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResults([])
            setSearchTotal(0)
            setSearching(false)
          }
        })
      return () => {
        cancelled = true
      }
    }, 300)
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current)
    }
  }, [searchText])

  const methodByName = new Map((bank?.methods ?? []).map(m => [m.method, m]))

  /* 方向 × 题型 题量矩阵 → 「选择练习方式」面板题型筛选 chips 的数据源 */
  const qtypeCountsByMethod = new Map<string, Record<string, number>>()
  for (const qc of bank?.qtype_counts ?? []) {
    const m = qtypeCountsByMethod.get(qc.method) ?? {}
    m[qc.qtype] = qc.count
    qtypeCountsByMethod.set(qc.method, m)
  }

  /* 检测方法卡片：只展示真实存在题目的方向（内置一级题库） */
  const methodCards = (bank?.methods ?? []).filter(m => m.count > 0 && m.method !== 'ZD')

  /* 题库系列：按分类 Tab 的「方向」过滤（通用系列在所有 Tab 下都显示） */
  const filteredSeries = series.filter(s => {
    if (activeCategory !== '全部' && s.method && s.method !== activeCategory) return false
    const kw = searchText.trim()
    return !kw || s.name.includes(kw) || (s.description || '').includes(kw)
  })

  /* 其他题库 = 没归入任何系列的散题库；只在「全部」Tab 下平铺 */
  const looseSets = (sets ?? [])
    .filter(s => !s.series_id)
    .filter(s => {
      const kw = searchText.trim()
      return !kw || s.name.includes(kw)
    })
  const showLoose = activeCategory === '全部'

  const isSearchMode = !!searchText.trim()

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" ref={staggerRef} style={{ paddingBottom: 110 }}>
        {/* 标题 */}
        <div className="px-5 pt-14 pb-4">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>题库</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>
            {loading ? '题库加载中…' : `${(bank?.total ?? 0).toLocaleString()} 道专业 NDT 题目`}
          </p>
        </div>
        {bankError && (
          <div className="px-5 pb-3">
            <p className="text-xs" style={{ color: 'var(--err)' }}>{bankError}（请确认后端服务已启动）</p>
            <button
              onClick={() => setReloadTick(t => t + 1)}
              className="mt-1 text-xs font-semibold tap"
              style={{ color: 'var(--accent)' }}
            >
              重新加载
            </button>
          </div>
        )}

        {/* 搜索框 */}
        <div className="px-4 mb-4">
          <div className="relative flex items-center">
            <SearchIcon size={16} className="absolute left-4 z-10 flex-shrink-0" color="var(--text-3)" />
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="搜索题目、知识点、标准…"
              className="w-full rounded-2xl pl-10 pr-12 h-11 text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
            />
            <button
              onClick={() => setShowFilter(true)}
              className="absolute right-2.5 flex items-center gap-1 px-2.5 py-1.5 rounded-lg tap"
              style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
            >
              <FilterIcon size={13} />
              <span className="text-[10px] font-semibold">筛选</span>
            </button>
          </div>
        </div>

        {/* 分类 Tab */}
        <div className="px-4 mb-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {ALL_CATS.map(cat => {
              const isActive = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`flex-shrink-0 px-4 h-8 rounded-full text-xs font-semibold transition-colors duration-200 gb-pill ${isActive ? 'gb-soft' : ''}`}
                  style={{
                    background: isActive ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
                    color: isActive ? '#fff' : 'var(--text-2)',
                    border: isActive ? '1px solid var(--accent-border)' : '1px solid var(--chip-border)',
                  }}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        </div>

        {/* 搜索结果（实时接口） */}
        {isSearchMode && (
          <div className="px-4">
            <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-1)' }}>
              {searching ? '搜索中…' : `"${searchText.trim()}" 相关 · ${searchTotal} 题`}
            </h3>
            {searchResults && searchResults.length === 0 && !searching ? (
              <div className="flex flex-col items-center py-16 gap-4">
                <SearchIcon size={40} color="var(--text-3)" />
                <div className="font-medium" style={{ color: 'var(--text-2)' }}>没有找到相关题目</div>
                <div className="text-sm" style={{ color: 'var(--text-3)' }}>换个关键词试试</div>
                <button
                  onClick={() => setSearchText('')}
                  className="mt-2 px-5 py-2.5 gb gb-pill gb-soft rounded-xl text-sm font-medium"
                  style={{ color: 'var(--accent)' }}
                >
                  清除搜索
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {(searchResults ?? []).map(item => (
                  <button
                    key={item.id}
                    onClick={() => onStartPractice(item.method)}
                    className="w-full card p-4 text-left card-tap"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                      >
                        {item.method}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                        {item.qtype_label}{item.topic ? ` · ${item.topic}` : ''}
                      </span>
                    </div>
                    <p className="text-sm line-clamp-2 leading-relaxed" style={{ color: 'var(--text-1)' }}>
                      {stripRichText(item.content)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 检测方法卡片（非搜索模式才显示） */}
        {!isSearchMode && activeCategory === '全部' && (
          <div className="px-4 mb-5">
            <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-1)' }}>检测方法</h3>
            <div className="grid grid-cols-2 gap-3">
              {methodCards.map(cat => {
                const pct = cat.count ? Math.round((cat.answered / cat.count) * 100) : 0
                return (
                  <button
                    key={cat.method}
                    onClick={() => setPickerCategory(cat.method)}
                    className="card p-4 text-left card-tap"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg font-bold" style={{ color: 'var(--accent)' }}>{cat.method}</span>
                        <span
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: 'var(--surface-warm)', color: 'var(--text-2)', border: '1px solid var(--line)' }}
                        >
                          一级
                        </span>
                      </div>
                      {pct > 0 && (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>{pct}%</span>
                      )}
                    </div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-1)' }}>{cat.name}</div>
                    <div className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{cat.count} 题</div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                      <div
                        className="h-full rounded-full progress-fill"
                        style={{ width: `${pct}%`, background: 'var(--accent)' }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ① 题库系列（管理员在后台建的分组，点进系列详情页） */}
        {!isSearchMode && filteredSeries.length > 0 && (
          <div className="px-4 mb-6">
            <div className="flex items-center justify-between px-0.5 mb-3">
              <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--text-3)' }}>
                题库系列
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{filteredSeries.length} 个系列</span>
            </div>
            <div className="space-y-3">
              {filteredSeries.map(s => (
                <BankSeriesCard key={s.id} series={s} onOpen={() => onOpenBankSeries(s)} />
              ))}
            </div>
          </div>
        )}

        {/* ② 其他题库：没归入系列的散题库（选了具体方向 Tab 时不显示，它们没有方向归属） */}
        {!isSearchMode && showLoose && (
          <div className="px-4">
            <div className="flex items-center justify-between px-0.5 mb-3">
              <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--text-3)' }}>
                {filteredSeries.length > 0 ? '其他题库' : '题库'}
              </span>
              {filteredSeries.length > 0 && (
                <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{looseSets.length} 套</span>
              )}
            </div>

            {loading ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>题库加载中…</p>
            ) : looseSets.length === 0 ? (
              <div className="flex flex-col items-center py-12 gap-3">
                <SearchIcon size={36} color="var(--text-3)" />
                <div className="font-medium text-sm" style={{ color: 'var(--text-2)' }}>暂无其他题库</div>
                <div className="text-xs text-center px-6" style={{ color: 'var(--text-3)' }}>
                  管理员可在管理后台「题库管理」新建题库、建章节并导入 CSV
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {looseSets.map(ts => (
                  <BankSetCard key={ts.id} set={ts} onOpen={() => setPickerSet(ts)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 选择练习方式面板 ── */}
      {pickerCategory && (
        <PracticePickerSheet
          category={pickerCategory}
          categoryName={methodCards.find(m => m.method === pickerCategory)?.name
            || (pickerCategory === '综合' ? '全部方向' : pickerCategory)}
          qtypeCounts={qtypeCountsByMethod.get(pickerCategory) ?? {}}
          onClose={() => setPickerCategory(null)}
          onStart={(opts) => {
            setPickerCategory(null)
            onStartPractice(pickerCategory, opts)
          }}
        />
      )}

      {/* ── 自定义题库练习面板（整套题库 / 按章节） ── */}
      {pickerSet && (
        <SetPracticeSheet
          set={pickerSet}
          onClose={() => setPickerSet(null)}
          onStart={(opts) => {
            const target = pickerSet
            setPickerSet(null)
            onStartPractice('综合', {
              setId: target.id,
              topic: opts.topic,
              qtype: opts.qtype,
              // 练习顶栏标题：按章节练时带上章节名，考生一眼知道在练哪一章
              setTitle: opts.topic ? `${target.name} · ${opts.topic}` : target.name,
            })
          }}
        />
      )}

      {/* 筛选面板（检测方法为真实数据过滤；题库暂无难度/等级字段，不放假选项） */}
      {showFilter && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowFilter(false)} />
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] rounded-t-3xl anim-sheet-in"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)' }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
            </div>
            <div className="px-5 pb-8">
              <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-1)' }}>筛选</h3>

              <div>
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>检测方法</p>
                <div className="flex flex-wrap gap-2">
                  {(['全部', 'UT', 'RT', 'MT', 'PT', '综合'] as const).map(opt => {
                    const active = activeCategory === opt
                    return (
                      <button
                        key={opt}
                        onClick={() => setActiveCategory(opt)}
                        className="px-3 h-8 gb-pill rounded-full text-xs font-medium"
                        style={{
                          background: active ? 'var(--accent-fill)' : 'var(--chip-bg-soft)',
                          color: active ? '#fff' : 'var(--text-2)',
                          border: active ? '1px solid var(--accent-border)' : '1px solid var(--chip-border)',
                          boxShadow: 'inset 1px 1px 0 var(--inset-hi), inset -1px -1px 0 rgba(27,30,35,0.04), 0 2px 6px rgba(27,30,35,0.05)',
                        }}
                      >
                        {opt}
                      </button>
                    )
                  })}
                </div>
                <div className="text-[10px] mt-2" style={{ color: 'var(--text-3)' }}>
                  当前筛选：{activeCategory}
                  {methodByName.get(activeCategory) ? ` · ${methodByName.get(activeCategory)!.count} 题` : ''}
                </div>
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => {
                    setActiveCategory('全部')
                    setShowFilter(false)
                  }}
                  className="flex-1 h-12 gb gb-ghost rounded-2xl text-sm font-semibold"
                >
                  重置
                </button>
                <button
                  onClick={() => setShowFilter(false)}
                  className="flex-1 h-12 gb gb-primary rounded-2xl text-sm font-semibold"
                >
                  应用筛选
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   选择练习方式面板（底部弹层，z-[60] 盖过底部导航 z-50）
   两个 Tab（共用题型筛选 chips：全部/判断/选择/计算/简答）：
   - 顺序练习：整个方向（可再按题型）一次练完（不做分组），显示 对/错/未做
   - 按章节练习：按知识点一章一章练（每章全部题目，可再按题型）
   行尾垃圾桶 = 清除该范围做题记录（两步确认，含题型范围），清除后可重新做
   ============================================================ */

interface PracticePickerSheetProps {
  category: string
  categoryName: string
  /** 该方向各题型题量（judge/single/calc/short → count），题型筛选 chips 数据源 */
  qtypeCounts: Record<string, number>
  onClose: () => void
  onStart: (opts: { topic?: string; qtype?: string }) => void
}

function PracticePickerSheet({ category, categoryName, qtypeCounts, onClose, onStart }: PracticePickerSheetProps) {
  const [tab, setTab] = useState<'seq' | 'chapter'>('seq')
  /* 题型筛选：'' = 全部题型（顺序/章节两个 Tab 共用） */
  const [qtype, setQtype] = useState('')

  /* 顺序练习：整范围统计（借 blocks 接口聚合） */
  const [seqStat, setSeqStat] = useState<{ total: number; answered: number; correct: number; wrong: number } | null>(null)
  /* 章节列表 */
  const [chapters, setChapters] = useState<BankChapter[] | null>(null)
  /* 两步清除确认的 key：seq / ch-<topic> */
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState('')

  /* 题型筛选变化时重新拉统计与章节（blocks/chapters 都带 qtype） */
  useEffect(() => {
    let cancelled = false
    practiceApi
      .blocks(category, undefined, 20, undefined, qtype || undefined)
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
    bankApi
      .chapters(category, qtype || undefined)
      .then(res => {
        if (!cancelled) setChapters(res.items)
      })
      .catch(() => {
        if (!cancelled) setChapters([])
      })
    return () => {
      cancelled = true
    }
  }, [category, qtype])

  const handleClear = (key: string, topic?: string) => {
    if (clearing) return
    if (confirmKey !== key) {
      setConfirmKey(key)
      return
    }
    setClearing(true)
    practiceApi
      .reset(category, topic, undefined, qtype || undefined)
      .then(() => {
        setConfirmKey(null)
        setError('')
        // 清完重拉当前题型范围的统计与章节
        practiceApi
          .blocks(category, undefined, 20, undefined, qtype || undefined)
          .then(res => {
            const agg = res.blocks.reduce(
              (s, b) => ({ total: s.total + b.count, answered: s.answered + b.answered, correct: s.correct + b.correct, wrong: s.wrong + b.wrong }),
              { total: 0, answered: 0, correct: 0, wrong: 0 },
            )
            setSeqStat(agg)
          })
          .catch(() => setSeqStat({ total: 0, answered: 0, correct: 0, wrong: 0 }))
        bankApi
          .chapters(category, qtype || undefined)
          .then(res => setChapters(res.items))
          .catch(() => setChapters([]))
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '清除失败'))
      .finally(() => setClearing(false))
  }

  /* 题型筛选选项（全部 + 有题的题型，题数来自首页 summary 矩阵） */
  const qtypeTotal = Object.values(qtypeCounts).reduce((s, n) => s + n, 0)
  const qtypeOptions = [
    { code: '', label: '全部', count: qtypeTotal },
    ...Object.entries(QTYPE_LABELS)
      .map(([code, label]) => ({ code, label, count: qtypeCounts[code] ?? 0 }))
      .filter(o => o.count > 0),
  ]
  const pickedQtype = qtypeOptions.find(o => o.code === qtype)

  /** 清除按钮（两步确认） */
  const ClearButton = ({ k, topic }: { k: string; topic?: string }) => {
    const confirming = confirmKey === k
    return (
      <button
        onClick={() => handleClear(k, topic)}
        disabled={clearing}
        aria-label="清除做题记录"
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 tap"
        style={{
          background: confirming ? 'var(--err-weak)' : 'transparent',
          border: confirming ? '1px solid var(--err-border)' : '1px solid var(--line)',
          color: confirming ? 'var(--err)' : 'var(--text-3)',
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
            <h3 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>
              {category} · {categoryName}
            </h3>
            <button
              onClick={onClose}
              className="text-xs tap"
              style={{ color: 'var(--text-3)' }}
            >
              关闭
            </button>
          </div>

          {/* Tab：顺序练习 / 按章节练习 */}
          <div className="rounded-2xl p-1 flex gap-1" style={{ background: 'var(--track)' }}>
            {([['seq', '顺序练习'], ['chapter', '按章节练习']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setTab(k)
                  setConfirmKey(null)
                }}
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
          {/* 题型筛选 chips：全部 / 判断 / 选择 / 计算 / 简答（两个 Tab 共用） */}
          {qtypeOptions.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {qtypeOptions.map(o => {
                const active = qtype === o.code
                return (
                  <button
                    key={o.code || 'all'}
                    onClick={() => {
                      setQtype(o.code)
                      setConfirmKey(null)
                    }}
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
          )}
          <p className="text-[10px] mt-2" style={{ color: 'var(--text-3)' }}>
            做过标记一直保留（对绿 / 错红）· 点垃圾桶清除记录后可重新做
          </p>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-5 pb-8" style={{ overscrollBehavior: 'contain' }}>
          {error && (
            <p className="text-xs mb-3" style={{ color: 'var(--err)' }}>{error}</p>
          )}

          {tab === 'seq' && (
            seqStat === null ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
            ) : seqStat.total === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>
                {qtype ? '该题型暂无题目' : '该方向暂无题目'}
              </p>
            ) : (
              <div className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)' }}>
                <button
                  onClick={() => onStart({ qtype: qtype || undefined })}
                  className="flex-1 flex items-center gap-3 text-left min-w-0"
                >
                  <span
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
                  >
                    <PlayIcon size={15} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                      {qtype && pickedQtype ? `${pickedQtype.label} · ${seqStat.total} 题` : `全部题目 · ${seqStat.total} 题`}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] font-semibold">
                      {seqStat.answered === 0 ? (
                        <span style={{ color: 'var(--text-3)' }}>还没做过，开始吧</span>
                      ) : (
                        <>
                          <span style={{ color: 'var(--ok)' }}>对 {seqStat.correct}</span>
                          <span style={{ color: 'var(--err)' }}>错 {seqStat.wrong}</span>
                          {seqStat.answered < seqStat.total && (
                            <span style={{ color: 'var(--text-3)' }}>未做 {seqStat.total - seqStat.answered}</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <ChevronRightIcon size={15} color="var(--text-3)" />
                </button>
                <ClearButton k="seq" />
              </div>
            )
          )}

          {tab === 'chapter' && (
            chapters === null ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
            ) : chapters.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>
                {qtype ? '该题型暂无章节' : '该方向暂无章节'}
              </p>
            ) : (
              <div className="space-y-2">
                {chapters.map(ch => (
                  <div key={ch.topic} className="flex items-center gap-2 rounded-xl px-3 py-3" style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)' }}>
                    <button
                      onClick={() => onStart({ topic: ch.topic, qtype: qtype || undefined })}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <span
                        className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0"
                        style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
                      >
                        {ch.count} 题
                      </span>
                      <span className="flex-1 text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>
                        {ch.topic}
                      </span>
                      {ch.answered > 0 && (
                        <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                          已做 {ch.answered}
                        </span>
                      )}
                      <ChevronRightIcon size={15} color="var(--text-3)" className="flex-shrink-0" />
                    </button>
                    <ClearButton k={`ch-${ch.topic}`} topic={ch.topic} />
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
