/* ============================================================
   新版本检测 Hook —— 「有新版本该不该提示」的唯一出口

   两个来源（任一先到就提示，不会重复打扰）：
     ① 进入 App 时主动查一次 GET /api/app/version
     ② 实时通道推来的 update 事件（管理员刚在后台发布 → 在线考生秒收到）

   提示强度由服务端 version.json 的 force 决定（后台「版本发布」页可勾）：
     force = false  普通版本：弹可关闭的顶部提示条；考生点「稍后」后同一版本不再打扰
     force = true   强制更新：弹不可关闭的更新弹层，每次进入都提示

   「已忽略的版本号」记在 localStorage（ndt_update_dismissed），所以：
     - 点过「稍后」的版本不会反复弹；出现了更新的版本号会自动重新提示
     - 考生清了缓存会再提示一次，可以接受

   修改注意：
     - 版本比较规则在 src/data/appVersion.ts（服务端版本 > 本地 APP_VERSION 才算有新版本）
     - 发版必须同时改 src/data/appVersion.ts 的 APP_VERSION 并重新构建，
       否则考生刷新后拿到的还是旧代码，会陷入「提示更新 → 刷新 → 还是旧版」的循环
     - 「答题/考试时不打扰」不在这里做，由 App.tsx 决定挂在哪个视图（见组件 UpdateBanner）
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { appApi, type AppVersionInfo } from '../api/client'
import { hasUpdate } from '../data/appVersion'
import { REALTIME_EVENT } from '../api/realtime'

/** 已忽略（点过「稍后」）的版本号 */
const DISMISS_KEY = 'ndt_update_dismissed'

function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) || ''
  } catch {
    return ''
  }
}

export interface UseAppUpdateResult {
  /** 需要提示的新版本；null = 当前无需提示（已是最新 / 已忽略 / 查不到服务端版本） */
  update: AppVersionInfo | null
  /** 关闭提示（强制更新时前端不显示关闭入口，这里也会拦一道） */
  dismiss: () => void
  /** 立即更新：有下载地址先打开下载页（打包版 App），否则刷新页面（网页版） */
  applyUpdate: () => void
}

export function useAppUpdate(): UseAppUpdateResult {
  const [info, setInfo] = useState<AppVersionInfo | null>(null)
  const [dismissed, setDismissed] = useState<string>(readDismissed)

  /** 收到服务端版本信息：只有比本地新才记下来（否则忽略，避免无意义的提示） */
  const consider = useCallback((next: AppVersionInfo | null | undefined) => {
    if (!next || !next.latest_version) return
    if (!hasUpdate(next.latest_version)) return
    setInfo(next)
  }, [])

  // ① 进 App 查一次（没登录也能查：这个接口是公开的）
  useEffect(() => {
    let alive = true
    appApi
      .version()
      .then((v) => {
        if (alive) consider(v)
      })
      .catch(() => {
        /* 服务未启动 / 网络异常：静默忽略，不打扰考生 */
      })
    return () => {
      alive = false
    }
  }, [consider])

  // ② 实时通道推来的新版本（管理员刚发布）
  useEffect(() => {
    const handler = (event: Event) => {
      consider((event as CustomEvent<AppVersionInfo>).detail)
    }
    window.addEventListener(REALTIME_EVENT.UPDATE, handler)
    return () => window.removeEventListener(REALTIME_EVENT.UPDATE, handler)
  }, [consider])

  // 强制更新忽略不掉；普通版本被点过「稍后」后同一版本号不再提示
  const update = info && (info.force || info.latest_version !== dismissed) ? info : null

  const dismiss = useCallback(() => {
    if (!info || info.force) return
    try {
      localStorage.setItem(DISMISS_KEY, info.latest_version)
    } catch {
      /* 隐私模式下写不了 localStorage：退化为「本次会话不再提示」 */
    }
    setDismissed(info.latest_version)
  }, [info])

  const applyUpdate = useCallback(() => {
    const url = (info?.download_url || '').trim()
    if (url) {
      // 打包版 App：跳到安装包 / 下载页（网页版一般留空，走下面的刷新）
      window.open(url, '_blank', 'noopener')
      return
    }
    // 网页版：刷新即拿新版。Vite 构建产物文件名带内容哈希，不会命中旧缓存
    window.location.reload()
  }, [info])

  return { update, dismiss, applyUpdate }
}
