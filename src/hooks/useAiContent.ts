import { useCallback, useEffect, useRef, useState } from 'react'
import { aiApi, type AiStatus } from '../api/client'

/* ============================================================
   AI 内容钩子 —— 「题目 AI 解析」「视频 AI 概括」共用的状态机

   它负责三件事，界面组件只管画：
     1. 进页面先读服务端缓存（GET /api/ai/cache/…）——已生成过就直接显示，不再烧 token
     2. 点按钮时发起 SSE 流式生成，把增量文本累积成完整文本
     3. 切题 / 卸载时取消在途请求，避免回复打到已经没人看的界面上

   状态机：idle →（点按钮）loading →（首帧文本到达）streaming → done
                                                 ↘ error

   修改注意：
     - 文本累积用 ref（accRef），不要用 setText(prev => prev + x) 之外的方式，
       因为流式回调是外部异步触发的，闭包里的 text 会过期
     - useAiStatus() 的结果在模块级缓存，全 App 只会请求一次 /api/ai/status
   ============================================================ */

export type AiPhase = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

export interface AiContentState {
  phase: AiPhase
  /** 已生成的全文（流式过程中不断变长） */
  text: string
  error: string
  /** 本次内容是否直接来自缓存（没有重新调用模型） */
  cached: boolean
  /** 生成用的模型名 */
  model: string
  /** 视频概括：实际抽取到的关键帧数量（null = 还没开始 / 题目解析不适用） */
  frames: number | null
}

const INITIAL: AiContentState = {
  phase: 'idle',
  text: '',
  error: '',
  cached: false,
  model: '',
  frames: null,
}

export function useAiContent(kind: 'question' | 'solution' | 'video', targetId: number, autoLoadCache = true) {
  const [state, setState] = useState<AiContentState>(INITIAL)
  const cancelRef = useRef<(() => void) | null>(null)
  const accRef = useRef('')

  const stop = useCallback(() => {
    cancelRef.current?.()
    cancelRef.current = null
  }, [])

  /** 发起生成（refresh=true 丢弃旧结果重新生成） */
  const generate = useCallback(
    (refresh = false) => {
      stop()
      accRef.current = ''
      setState({ ...INITIAL, phase: 'loading' })

      const handlers = {
        onMeta: (info: { cached: boolean; model: string; frames?: number }) =>
          setState(s => ({
            ...s,
            cached: info.cached,
            model: info.model || s.model,
            frames: info.frames ?? s.frames,
          })),
        onDelta: (piece: string) => {
          accRef.current += piece
          const full = accRef.current
          setState(s => ({ ...s, phase: 'streaming', text: full }))
        },
        onError: (message: string) => setState(s => ({ ...s, phase: 'error', error: message })),
        onDone: (info: { cached: boolean }) =>
          setState(s => ({ ...s, phase: 'done', cached: info.cached })),
      }

      cancelRef.current =
        kind === 'question'
          ? aiApi.explainQuestion(targetId, refresh, handlers)
          : kind === 'solution'
          ? aiApi.solutionQuestion(targetId, refresh, handlers)
          : aiApi.summarizeVideo(targetId, refresh, handlers)
    },
    [kind, targetId, stop],
  )

  /* 换题 / 换视频：停掉旧流、复位，并尝试读一次缓存 */
  useEffect(() => {
    stop()
    accRef.current = ''
    setState(INITIAL)
    if (!autoLoadCache) return

    let cancelled = false
    aiApi
      .cache(kind, targetId)
      .then(res => {
        if (cancelled || !res.content) return
        accRef.current = res.content
        setState({
          phase: 'done',
          text: res.content,
          error: '',
          cached: true,
          model: res.model,
          frames: null,
        })
      })
      .catch(() => {
        /* 没缓存 / 请求失败都保持 idle，让考生自己点按钮 */
      })
    return () => {
      cancelled = true
    }
  }, [kind, targetId, autoLoadCache, stop])

  /* 卸载时收摊 */
  useEffect(() => () => stop(), [stop])

  return { ...state, generate, stop }
}

/* ── AI 服务状态（模块级缓存，全 App 只请求一次） ── */

let _statusPromise: Promise<AiStatus> | null = null

export function loadAiStatus(): Promise<AiStatus> {
  if (!_statusPromise) {
    _statusPromise = aiApi.status().catch(() => {
      _statusPromise = null // 失败不留假结果，下次进页面还能重试
      return {
        configured: false,
        chat_model: '',
        vision_model: '',
        can_extract_frames: false,
        video_frames: 0,
      } as AiStatus
    })
  }
  return _statusPromise
}

/** 读 AI 服务状态（供界面显示「未配置」提示与抽帧能力） */
export function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    let alive = true
    loadAiStatus().then(s => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [])
  return status
}
