import React, { useEffect, useState } from 'react'
import { practiceApi, type PracticeSessionRecord } from '../api/client'
import { ChevronLeftIcon, ChartIcon, TrashIcon } from '../components/icons'

/* ============================================================
   成绩记录页（苹果式浅色）
   数据全部实时：GET /api/user/practice/history（按练习会话分组，
   一次交卷 = 一条；模拟考试成绩也在同一列表，带「模拟考试」徽标）
   - 每条：方向徽标 / 题数 / 对错 / 正确率或得分 / 用时 / 完成时间
   - 点击任意一条 → 回看本次完整试卷（练习为答题记录，考试为试卷解析）
   - 每条右侧垃圾桶：点一下变「确认」，再点删除该条成绩（两步防误删）
   - 只显示当前登录账号自己的记录
   修改注意：
     - 页面滚动结构必须是唯一 .scroll-area bg-page 根容器（FRONTEND.md §11）
     - 颜色一律用 var(--token)，不要写死 hex（深色模式）
   ============================================================ */

interface ScoreRecordsScreenProps {
  onBack: () => void
  onStartPractice: (categoryId: string) => void
  /** 点击一条记录 → 回看该次会话的完整题目与答案（isExam 决定查考试/练习接口） */
  onOpenDetail: (sessionId: string, isExam: boolean) => void
}

function formatDuration(s: number): string {
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  return `${m} 分${s % 60 ? ` ${s % 60} 秒` : ''}`
}

function formatTime(iso: string): string {
  // answered_at 形如 2026-09-29 20:31:05
  return iso.slice(5, 16) // MM-DD HH:MM
}

export function ScoreRecordsScreen({ onBack, onStartPractice, onOpenDetail }: ScoreRecordsScreenProps) {
  const [items, setItems] = useState<PracticeSessionRecord[] | null>(null)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  /** 正在等待二次确认删除的记录 session_id（点垃圾桶一次 → 变「确认」，再点才删） */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    practiceApi
      .history()
      .then(res => {
        if (!cancelled) setItems(res.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '成绩加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [reloadTick])

  const handleDelete = (sessionId: string) => {
    if (deletingId) return
    setDeletingId(sessionId)
    practiceApi
      .deleteSession(sessionId)
      .then(() => {
        setItems(list => (list ? list.filter(r => r.session_id !== sessionId) : list))
        setConfirmingId(null)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '删除失败')
        setReloadTick(t => t + 1)
      })
      .finally(() => setDeletingId(null))
  }

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" style={{ paddingBottom: 110 }}>
        {/* 顶栏 */}
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="返回"
            className="w-9 h-9 gb gb-ghost gb-sm flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
          >
            <ChevronLeftIcon size={18} color="var(--text-2)" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>成绩记录</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              每次练习的成绩都会保存在你的账号里
            </p>
          </div>
        </div>

        {error && (
          <div className="px-5 pb-3">
            <p className="text-xs" style={{ color: 'var(--err)' }}>{error}（请确认后端服务已启动）</p>
            <button
              onClick={() => setReloadTick(t => t + 1)}
              className="mt-1 text-xs font-semibold tap"
              style={{ color: 'var(--accent)' }}
            >
              重新加载
            </button>
          </div>
        )}

        {/* 列表 */}
        {items === null && !error ? (
          <p className="text-sm py-16 text-center" style={{ color: 'var(--text-3)' }}>加载中…</p>
        ) : items && items.length === 0 ? (
          <div className="flex flex-col items-center py-20 gap-4 px-8 text-center">
            <div className="w-16 h-16 rounded-3xl flex items-center justify-center" style={{ background: 'var(--accent-weak)' }}>
              <span style={{ color: 'var(--accent)' }}><ChartIcon size={28} /></span>
            </div>
            <div className="font-medium" style={{ color: 'var(--text-2)' }}>还没有成绩记录</div>
            <div className="text-sm" style={{ color: 'var(--text-3)' }}>
              去题库练一组题，成绩就会出现在这里
            </div>
            <button
              onClick={() => onStartPractice('UT')}
              className="mt-2 px-6 py-2.5 gb gb-primary gb-pill text-sm font-semibold"
            >
              去练习
            </button>
          </div>
        ) : (
          <div className="px-4 space-y-3">
            {(items ?? []).map(rec => {
              const isExam = Boolean(rec.is_exam)
              return (
                <div
                  key={rec.session_id}
                  className="card p-4 card-tap cursor-pointer"
                  onClick={() => onOpenDetail(rec.session_id, isExam)}
                >
                  <div className="flex items-center justify-between mb-3 gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {isExam && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: 'var(--accent-fill)', color: 'var(--on-accent)' }}
                        >
                          模拟考试
                        </span>
                      )}
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                      >
                        {rec.category}
                      </span>
                      <span className="text-xs truncate" style={{ color: 'var(--text-2)' }}>
                        {isExam ? (rec.exam_title || '模拟考试') : rec.category_name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px]" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTime(rec.finished_at)}
                      </span>
                      {/* 删除：点一下变「确认」，再点才真的删（两步防误删） */}
                      {confirmingId === rec.session_id ? (
                        <button
                          aria-label="确认删除"
                          disabled={deletingId === rec.session_id}
                          onClick={e => {
                            e.stopPropagation()
                            handleDelete(rec.session_id)
                          }}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-full tap"
                          style={{ background: 'var(--err-weak)', color: 'var(--err)', border: '1px solid var(--err-border)' }}
                        >
                          {deletingId === rec.session_id ? '删除中…' : '确认删除'}
                        </button>
                      ) : (
                        <button
                          aria-label="删除这条成绩记录"
                          onClick={e => {
                            e.stopPropagation()
                            setConfirmingId(rec.session_id)
                          }}
                          className="w-6 h-6 rounded-full flex items-center justify-center tap"
                          style={{ color: 'var(--text-3)' }}
                        >
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-sm font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{rec.total}</div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>题数</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: 'var(--ok)', fontVariantNumeric: 'tabular-nums' }}>{rec.correct}</div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>答对</div>
                    </div>
                    <div>
                      <div
                        className="text-sm font-bold"
                        style={{
                          color: rec.accuracy >= 80 ? 'var(--ok)' : rec.accuracy >= 60 ? 'var(--accent)' : 'var(--err)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {isExam && rec.score != null ? rec.score : `${rec.accuracy}%`}
                      </div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>{isExam && rec.score != null ? '得分' : '正确率'}</div>
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                        {Math.round(rec.duration_seconds / 60) || (rec.duration_seconds ? 1 : 0)}
                      </div>
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-3)' }}>分钟</div>
                    </div>
                  </div>

                  {/* 正确率条 */}
                  <div className="h-1 rounded-full overflow-hidden mt-3" style={{ background: 'var(--track)' }}>
                    <div
                      className="h-full rounded-full progress-fill"
                      style={{
                        width: `${rec.accuracy}%`,
                        background: rec.accuracy >= 60 ? 'var(--accent)' : 'var(--err)',
                      }}
                    />
                  </div>
                </div>
              )
            })}
            {items && items.length > 0 && (
              <p className="text-[10px] text-center pt-2" style={{ color: 'var(--text-3)' }}>
                最多显示最近 50 次记录 · 点击可回看完整试卷 · 点垃圾桶可删除
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
