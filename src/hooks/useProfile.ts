import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getIdentity,
  getProfile,
  patchSavedProfile,
  profileApi,
  type ProfileUpdatePayload,
  type SessionProfile,
} from '../api/client'

/* ============================================================
   当前登录者资料 Hook —— 昵称 / 头像 / 账号 / 单位学校
   策略：
     1. 先用 localStorage 缓存渲染（秒显，不闪空白、不白屏）
     2. 再向后端 /api/user/profile 拉一次最新值并刷新缓存
     3. 只有「考生」身份才有自己的资料；管理员登录时直接跳过请求
   用法：
     const { profile, canEdit, update, error } = useProfile()
     await update({ nickname: 'xxx', avatar: 'preset:3' })
   ============================================================ */

export interface UseProfileResult {
  profile: SessionProfile | null
  /** 正在从后端拉取（首次进入时短暂为 true） */
  loading: boolean
  /** 拉取失败的中文提示；失败时会继续用本地缓存显示 */
  error: string
  /** 是否可编辑自己的资料（考生身份才为 true） */
  canEdit: boolean
  refresh: () => Promise<void>
  update: (payload: ProfileUpdatePayload) => Promise<SessionProfile>
}

export function useProfile(): UseProfileResult {
  const [profile, setProfile] = useState<SessionProfile | null>(() => getProfile())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const aliveRef = useRef(true)

  /** 是否为可编辑自己资料的考生（管理员没有考生资料） */
  const canEdit = getIdentity() === 'user'

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (getIdentity() !== 'user') return
    setLoading(true)
    setError('')
    try {
      const data = await profileApi.get()
      if (!aliveRef.current) return
      setProfile(
        patchSavedProfile({
          account: data.account,
          nickname: data.nickname,
          avatar: data.avatar,
          org: data.org,
          real_name: data.real_name,
          method: data.method,
        }),
      )
    } catch (err) {
      if (!aliveRef.current) return
      setError(err instanceof Error ? err.message : '资料加载失败')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const update = useCallback(async (payload: ProfileUpdatePayload) => {
    const data = await profileApi.update(payload)
    const merged = patchSavedProfile({
      account: data.account,
      nickname: data.nickname,
      avatar: data.avatar,
      org: data.org,
      real_name: data.real_name,
      method: data.method,
    })
    if (aliveRef.current) setProfile(merged)
    return merged
  }, [])

  return { profile, loading, error, canEdit, update, refresh }
}
