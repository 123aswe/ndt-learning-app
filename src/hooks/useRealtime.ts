/* ============================================================
   实时通道生命周期 Hook
   - useRealtime()      在 App 顶层挂一次：开始维持长连接（退出登录自动断开）
   - useRealtimeState() 需要「实时是否可用」的组件用，例如通知 Hook 据此决定轮询节奏

   修改注意：
     连接本身是模块级单例（src/api/realtime.ts），这里只负责挂载与卸载，
     不要在多个页面各调一次 useRealtime()，也不会因此多开连接，但没必要重复挂。
   ============================================================ */

import { useEffect, useSyncExternalStore } from 'react'
import { getRealtimeState, REALTIME_EVENT, startRealtime, stopRealtime, type RealtimeState } from '../api/realtime'

const stateListeners = new Set<() => void>()

window.addEventListener(REALTIME_EVENT.STATE, () => {
  stateListeners.forEach((listener) => listener())
})

function subscribeState(listener: () => void) {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}

/** 挂载即建立实时通道，卸载即断开（App 顶层用一次） */
export function useRealtime() {
  useEffect(() => {
    startRealtime()
    return () => stopRealtime()
  }, [])
}

/** 当前实时通道状态：'online' = 推送可用，其它值表示前端正在走轮询兜底 */
export function useRealtimeState(): RealtimeState {
  return useSyncExternalStore(subscribeState, getRealtimeState, getRealtimeState)
}
