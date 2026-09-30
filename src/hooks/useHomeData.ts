import { useCallback, useEffect, useState } from 'react'
import {
  bankApi,
  statsApi,
  type BankSummary,
  type UserStatsSummary,
  type WrongQuestionItem,
} from '../api/client'

/* ============================================================
   首页数据钩子 —— 首页所有内容的唯一数据出口
   - 题库概览（/api/bank/summary）：各方向题量 + 我已做题量
   - 学习统计（/api/user/stats/summary）：今日/本周/连续打卡/成就
   - 最近错题（/api/user/wrong-questions）：取 3 条做预览
   - 全部来自服务端实时计算，不再使用本地 Mock 数据
   修改注意：其它页面要用同样的数据，直接复用本钩子，不要自己再 fetch
   ============================================================ */

export interface HomeData {
  loading: boolean
  /** 请求失败时的提示（如后端未启动），为空串表示正常 */
  error: string
  bank: BankSummary | null
  stats: UserStatsSummary | null
  wrongPreview: WrongQuestionItem[]
  /** 手动刷新（练习结束回到首页时可用） */
  refresh: () => void
}

export function useHomeData(): HomeData {
  const [bank, setBank] = useState<BankSummary | null>(null)
  const [stats, setStats] = useState<UserStatsSummary | null>(null)
  const [wrongPreview, setWrongPreview] = useState<WrongQuestionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const refresh = useCallback(() => setReloadTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        // 三个接口相互独立，一个失败不影响其它数据展示
        const [bankRes, statsRes, wrongRes] = await Promise.allSettled([
          bankApi.summary(),
          statsApi.summary(),
          statsApi.wrongQuestions(3),
        ])
        if (cancelled) return

        if (bankRes.status === 'fulfilled') setBank(bankRes.value)
        if (statsRes.status === 'fulfilled') setStats(statsRes.value)
        if (wrongRes.status === 'fulfilled') {
          setWrongPreview(wrongRes.value.items.slice(0, 3))
        }

        const failed = [bankRes, statsRes].find(r => r.status === 'rejected')
        if (failed && failed.status === 'rejected') {
          setError(failed.reason instanceof Error ? failed.reason.message : '数据加载失败')
        }
        setLoading(false)
      } catch {
        if (!cancelled) {
          setError('数据加载失败')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [reloadTick])

  return { loading, error, bank, stats, wrongPreview, refresh }
}
