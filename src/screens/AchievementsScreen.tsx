import React, { useEffect, useMemo, useState } from 'react'
import { statsApi, type AchievementItem, type AchievementsPayload } from '../api/client'
import { AchievementIcon } from '../components/AchievementIcon'
import { ProgressRing } from '../components/ProgressRing'
import { AwardIcon, CheckIcon, ChevronLeftIcon, StarIcon } from '../components/icons'

/* ============================================================
   成就勋章（我的 → 成就勋章）
   数据源：GET /api/user/achievements（server/modules/achievements.py 实时计算）
   结构：顶栏 → 等级卡（等级环 + XP 进度 + 解锁总进度）→ 分类筛选 chips → 勋章墙
   判据全部来自现有数据（答题记录 / 连续打卡 / 模考成绩 / 错题本 / 资料库互动），
   不落库；删答题记录会同步回退解锁状态。
   修改注意：
     - 根元素必须是唯一一个 .scroll-area（本工程滚动结构约定，见 FRONTEND.md §11）
     - 颜色一律 var(--token)；图标走 AchievementIcon（emoji → 线性图标）
     - 品级配色：铜 = 中性灰、银 = 主色、金 = 绿（全部复用现有令牌，不新增 hex）
   ============================================================ */

interface AchievementsScreenProps {
  onBack: () => void
}

/** 品级 → 徽章配色（全部复用主题令牌） */
const TIER_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  bronze: { bg: 'var(--track)', border: 'var(--line-strong)', color: 'var(--text-2)' },
  silver: { bg: 'var(--accent-weak)', border: 'var(--accent-border)', color: 'var(--accent)' },
  gold: { bg: 'var(--ok-weak)', border: 'var(--ok-border)', color: 'var(--ok)' },
}

/** 未解锁徽章统一用灰底 */
const LOCKED_STYLE = { bg: 'var(--track)', border: 'var(--line)', color: 'var(--text-3)' }

function progressText(a: AchievementItem): string {
  const unit = a.unit || ''
  return `${a.progress ?? 0} / ${a.max ?? 1} ${unit}`.trim()
}

export function AchievementsScreen({ onBack }: AchievementsScreenProps) {
  const [data, setData] = useState<AchievementsPayload | null>(null)
  const [error, setError] = useState('')
  const [cat, setCat] = useState('all')

  useEffect(() => {
    let cancelled = false
    statsApi
      .achievements()
      .then(res => {
        if (!cancelled) setData(res)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '成就加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const items = data?.items ?? []
  const shown = useMemo(() => (cat === 'all' ? items : items.filter(a => a.category === cat)), [items, cat])

  const earnedPct = data?.total ? Math.round((data.earned_count / data.total) * 100) : 0
  const levelPct = data?.xp_level_max ? Math.round((data.xp_in_level / data.xp_level_max) * 100) : 0

  /* 分类 chips：全部 + 后端给的分类（带各类已解锁数） */
  const chips = useMemo(() => {
    const cats = data?.categories ?? []
    return [
      { id: 'all', name: '全部', earned: data?.earned_count ?? 0, total: data?.total ?? 0 },
      ...cats.map(c => {
        const list = items.filter(a => a.category === c.id)
        return { id: c.id, name: c.name, earned: list.filter(a => a.earned).length, total: list.length }
      }),
    ]
  }, [data, items])

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" style={{ paddingBottom: 56 }}>
        {/* 顶栏 */}
        <div className="px-5 pt-12 pb-3 flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="返回"
            className="w-9 h-9 rounded-full flex items-center justify-center tap"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-2)' }}
          >
            <ChevronLeftIcon size={17} />
          </button>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>成就勋章</h1>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              {data === null ? '加载中…' : `已解锁 ${data.earned_count} / ${data.total}`}
            </p>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-3">
            <div className="card p-4">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
            </div>
          </div>
        )}

        {/* 等级卡：等级环 + XP + 解锁总进度 */}
        <div className="px-4 mt-1">
          <div className="card p-5 flex items-center gap-5">
            <ProgressRing progress={levelPct} size={84} strokeWidth={7}>
              <div className="flex flex-col items-center">
                <span className="text-xl font-bold leading-none" style={{ color: 'var(--text-1)' }}>
                  Lv.{data?.level ?? 1}
                </span>
                <span className="text-[9px] mt-1" style={{ color: 'var(--text-3)' }}>等级</span>
              </div>
            </ProgressRing>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span style={{ color: 'var(--accent)' }}><AwardIcon size={15} /></span>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                  共 {data?.total ?? 0} 枚勋章
                </span>
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                再答 {data ? data.xp_level_max - data.xp_in_level : 200} 题升至 Lv.{(data?.level ?? 1) + 1}
              </p>

              {/* 解锁总进度 */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] mb-1.5" style={{ color: 'var(--text-3)' }}>
                  <span>解锁进度</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{earnedPct}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                  <div className="h-full rounded-full" style={{ width: `${earnedPct}%`, background: 'var(--accent-fill)' }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 分类筛选 */}
        <div className="px-4 mt-4 flex gap-2 overflow-x-auto pb-1">
          {chips.map(c => {
            const active = c.id === cat
            return (
              <button
                key={c.id}
                onClick={() => setCat(c.id)}
                className="text-[11px] font-medium px-3 py-1.5 rounded-full whitespace-nowrap tap flex-shrink-0"
                style={{
                  background: active ? 'var(--accent-fill)' : 'var(--chip-bg)',
                  color: active ? 'var(--on-accent)' : 'var(--text-2)',
                  border: `1px solid ${active ? 'transparent' : 'var(--chip-border)'}`,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {c.name} {c.earned}/{c.total}
              </button>
            )
          })}
        </div>

        {/* 勋章墙 */}
        <div className="px-4 mt-3 grid grid-cols-2 gap-3">
          {data === null && !error && (
            <p className="col-span-2 text-sm py-14 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
          )}
          {shown.map(a => {
            const style = a.earned ? TIER_STYLE[a.tier ?? 'bronze'] : LOCKED_STYLE
            const isNew = (data?.recent_earned ?? []).includes(a.id)
            const pct = a.max ? Math.round(((a.progress ?? 0) / a.max) * 100) : 0
            return (
              <div
                key={a.id}
                className="card p-4 flex flex-col"
                style={{ opacity: a.earned ? 1 : 0.82 }}
              >
                <div className="flex items-start justify-between">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
                    style={{ background: style.bg, border: `1px solid ${style.border}`, color: style.color }}
                  >
                    <AchievementIcon icon={a.icon} size={20} />
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: 'var(--surface-warm)', color: 'var(--text-3)', border: '1px solid var(--line)' }}
                    >
                      {a.tier_name}
                    </span>
                    {a.earned && isNew && (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'var(--ok-weak)', color: 'var(--ok)', border: '1px solid var(--ok-border)' }}
                      >
                        NEW
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 flex items-center gap-1.5">
                  <h3 className="text-xs font-bold" style={{ color: a.earned ? 'var(--text-1)' : 'var(--text-2)' }}>
                    {a.title}
                  </h3>
                  {a.earned && (
                    <span style={{ color: 'var(--ok)' }}><CheckIcon size={11} /></span>
                  )}
                </div>
                <p className="text-[10px] mt-1 leading-relaxed flex-1" style={{ color: 'var(--text-3)' }}>
                  {a.description}
                </p>

                {/* 未解锁显示进度条 */}
                {!a.earned && (
                  <div className="mt-2.5">
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--accent)' }} />
                    </div>
                    <p className="text-[9px] mt-1" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                      {progressText(a)}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
          {data !== null && shown.length === 0 && (
            <div className="col-span-2 flex flex-col items-center gap-3 py-14 text-center">
              <span style={{ color: 'var(--accent)', opacity: 0.6 }}><StarIcon size={24} /></span>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>这个分类下暂无勋章</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
