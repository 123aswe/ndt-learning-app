import React, { useEffect, useMemo, useState } from 'react'
import { bankApi, type BankSeries, type BankSet } from '../api/client'
import { ChevronLeftIcon, ChevronRightIcon, LayersIcon, ListIcon, SortIcon } from '../components/icons'
import { SetPracticeSheet } from '../components/SetPracticeSheet'
import { QTYPE_LABELS, QTYPE_ORDER } from '../data/qtypes'
import { loadLibOrder, saveLibOrder } from '../data/libraryOrder'

/* ============================================================
   题库系列详情页（考生端「题库」→ 点系列卡进入）
   展示一个题库系列里的全部题库（管理员在后台「题库管理」里归入的）
   数据：GET /api/bank/series/{id} 由列表页带进来 + GET /api/bank/sets?series_id=N 取题库
   点题库卡 → 练习面板（**只选题型直接开始练习**，不按章节；传 showChapters={false} 给
   components/SetPracticeSheet.tsx；题库页「其他题库」的散题库仍是「全部题目 / 按章节练习」）
   「顺序 / 倒序」：与「教材 / 视频」共用同一份本机偏好（src/data/libraryOrder.ts），
   就地反转题库顺序，服务端排定的顺序不变
   修改注意：
     - 颜色一律用 var(--token)，不要写死 hex（深色模式）
     - 封面用 bankApi.seriesCoverUrl（404 回落图标水印）
   ============================================================ */

interface BankSeriesScreenProps {
  series: BankSeries
  /** 返回题库页 */
  onBack: () => void
  /** 开始练习（这里只按题型练，不传 topic） */
  onStartPractice: (categoryId: string, opts?: { topic?: string; setId?: number; qtype?: string; setTitle?: string }) => void
}

/** 题库卡：封面缩略图 + 名称 + 级别 + 题数/题型分布 */
function BankCard({ set, onOpen }: { set: BankSet; onOpen: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false)
  const useCover = set.has_cover && !coverFailed
  const dist = QTYPE_ORDER
    .map(q => ({ label: QTYPE_LABELS[q], n: set.qtype_counts?.[q] ?? 0 }))
    .filter(x => x.n > 0)
  return (
    <button onClick={onOpen} className="card w-full p-3 flex items-start gap-3.5 card-tap text-left">
      <div
        className="w-14 h-14 rounded-2xl flex-shrink-0 relative overflow-hidden flex items-center justify-center"
        style={{
          background: 'linear-gradient(150deg, var(--accent-weak), var(--surface-warm))',
          border: '1px solid var(--accent-border)',
        }}
      >
        {useCover ? (
          <img
            src={bankApi.setCoverUrl(set.id)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setCoverFailed(true)}
          />
        ) : (
          <span style={{ color: 'var(--accent)', opacity: 0.35 }}><ListIcon size={24} /></span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{set.name}</span>
          {set.level && (
            <span
              className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--surface-warm)', color: 'var(--accent)', border: '1px solid var(--line)' }}
            >
              {set.level}
            </span>
          )}
        </div>
        {set.description && (
          <p className="text-[10.5px] mt-1 line-clamp-1" style={{ color: 'var(--text-3)' }}>{set.description}</p>
        )}
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[10px]" style={{ color: 'var(--text-3)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-2)' }}>共 {set.total} 题</span>
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

      <ChevronRightIcon size={16} className="mt-1 flex-shrink-0" color="var(--text-3)" />
    </button>
  )
}

export function BankSeriesScreen({ series, onBack, onStartPractice }: BankSeriesScreenProps) {
  const [sets, setSets] = useState<BankSet[] | null>(null)
  const [error, setError] = useState('')
  const [coverFailed, setCoverFailed] = useState(false)
  const [pickerSet, setPickerSet] = useState<BankSet | null>(null)
  /** 排序方向：与「教材 / 视频」共用本机偏好（退出重进仍保留） */
  const [order, setOrder] = useState<'desc' | 'asc'>(() => loadLibOrder())

  useEffect(() => {
    saveLibOrder(order)
  }, [order])

  useEffect(() => {
    let cancelled = false
    setSets(null)
    setError('')
    bankApi
      .sets(series.id)
      .then(res => {
        if (!cancelled) setSets(res.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '系列题库加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [series.id])

  const all = useMemo(() => sets ?? [], [sets])
  /** 「倒序」= 把服务端顺序整体反过来 */
  const ordered = useMemo(() => (order === 'asc' ? [...all].reverse() : all), [all, order])

  const useCover = series.has_cover && !coverFailed

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" style={{ paddingBottom: 110 }}>
        {/* 顶栏：返回 */}
        <div className="px-4 pt-12 pb-2 flex items-center gap-2">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full flex items-center justify-center tap flex-shrink-0"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--line)' }}
            aria-label="返回"
          >
            <ChevronLeftIcon size={17} color="var(--text-1)" />
          </button>
          <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--text-3)' }}>
            {series.level ? `${series.level} · ` : ''}题库系列
          </span>
        </div>

        {/* 系列头部：封面 + 名称 + 简介 + 概览 */}
        <div className="px-5 pt-1">
          <div
            className="w-full rounded-3xl relative overflow-hidden"
            style={{
              height: 148,
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
              <div className="absolute inset-0 flex items-center justify-center">
                <span style={{ color: 'var(--accent)', opacity: 0.2 }}><LayersIcon size={56} /></span>
              </div>
            )}
            <span
              className="absolute top-3 left-3 text-[9.5px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: 'var(--surface-raised)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-border)',
              }}
            >
              {series.method ? `${series.method} 方向` : '通用方向'}
            </span>
          </div>

          <h1 className="text-xl font-bold mt-3.5" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>
            {series.name}
          </h1>
          {series.description && (
            <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {series.description}
            </p>
          )}

          <div className="flex items-center gap-4 mt-3">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--text-2)' }}>
              共 {series.bank_count} 套题库 · {series.total} 题
            </span>
            {/* 顺序 / 倒序：只有一套题库时不给这个按钮 */}
            {all.length > 1 && (
              <>
                <span className="flex-1" />
                <button
                  onClick={() => setOrder(o => (o === 'desc' ? 'asc' : 'desc'))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold tap"
                  style={{
                    background: order === 'asc' ? 'var(--accent-weak)' : 'var(--surface-raised)',
                    color: order === 'asc' ? 'var(--accent)' : 'var(--text-2)',
                    border: `1px solid ${order === 'asc' ? 'var(--accent-border)' : 'var(--line)'}`,
                  }}
                  title="切换顺序 / 倒序"
                  aria-label={`当前${order === 'desc' ? '顺序' : '倒序'}，点击切换`}
                >
                  <SortIcon size={12} />
                  {order === 'desc' ? '顺序' : '倒序'}
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="px-5 pt-4">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}</p>
            </div>
          </div>
        )}

        {/* 题库列表 */}
        <div className="px-5 mt-5">
          {sets === null && !error ? (
            <p className="text-sm py-16 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
          ) : all.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 px-4 text-center">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}><ListIcon size={26} /></span>
              </div>
              <div className="font-medium text-sm" style={{ color: 'var(--text-2)' }}>这个系列还没有题库</div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>管理员在后台把题库归入这个系列后就会显示</div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {ordered.map(s => (
                <BankCard key={s.id} set={s} onOpen={() => setPickerSet(s)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 练习面板：题库系列里的题库只选题型直接开练（不提供按章节，界面更短） */}
      {pickerSet && (
        <SetPracticeSheet
          set={pickerSet}
          showChapters={false}
          onClose={() => setPickerSet(null)}
          onStart={(opts) => {
            const target = pickerSet
            setPickerSet(null)
            onStartPractice('综合', {
              setId: target.id,
              qtype: opts.qtype,
              setTitle: target.name,
            })
          }}
        />
      )}
    </div>
  )
}
