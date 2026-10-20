import React, { useCallback, useRef, useState } from 'react'
import type { AiContentState } from '../hooks/useAiContent'
import { Markdown } from './Markdown'
import { CheckIcon, RefreshIcon, SparklesIcon } from './icons'

/* ============================================================
   AI 回答卡片 —— 「题目 AI 解析」「视频 AI 概括」共用的外框

   把四种状态（未开始 / 思考中 / 逐字输出 / 已完成 / 出错）的呈现集中在这里，
   调用方只负责传状态 + 点按钮，两处用法视觉完全一致：
     - QuestionBank 练习页：<AiExplainPanel questionId={…} />
     - 视频详情页：        <AiVideoSummary materialId={…} />

   修改注意：
     - 正文一律走 <Markdown/> 渲染（AI 返回的是 Markdown）
     - 颜色只用 var(--token)，深色模式自动适配
   ============================================================ */

interface AiAnswerCardProps {
  /** 卡片标题，如「AI 解析」「视频概括」 */
  title: string
  /** 未生成时主按钮的文案 */
  actionLabel: string
  /** 未生成时按钮下方的一句说明 */
  hint: string
  /** 标题左侧的图标（默认星光） */
  icon?: React.ReactNode
  /** 状态机（来自 useAiContent） */
  state: AiContentState
  /** 点按钮 → 生成 / 重新生成 */
  onGenerate: (refresh?: boolean) => void
  /** 服务端是否已配置 AI（false 时不给按钮，直接说明原因） */
  configured: boolean
  /** 附加提示行（如「未取到画面，仅按标题与简介概括」） */
  notice?: React.ReactNode
  /** 生成过程中的补充说明（如视频抽帧要多等几秒） */
  loadingHint?: string
}

export function AiAnswerCard({
  title,
  actionLabel,
  hint,
  icon,
  state,
  onGenerate,
  configured,
  notice,
  loadingHint,
}: AiAnswerCardProps) {
  const { phase, text, error, cached, model, frames } = state
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // 老内核 / 非安全上下文没有 clipboard API：退化成临时 textarea + execCommand
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* 复制不了就算了，不打扰考生 */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
  }, [text])

  const busy = phase === 'loading' || phase === 'streaming'
  const hasText = text.trim().length > 0

  return (
    <section className="ai-card anim-fade-in">
      {/* ── 头部：徽章 + 标题 + 模型/重新生成 ── */}
      <div className="flex items-center gap-2.5 relative">
        <div className="ai-badge">{icon ?? <SparklesIcon size={16} />}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold tracking-wide" style={{ color: 'var(--text-1)' }}>
              {title}
            </h3>
            {model && (phase === 'done' || busy) && (
              <span className="ai-chip">{model}</span>
            )}
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            由智谱 GLM 生成 · 仅供参考
          </p>
        </div>
        {phase === 'done' && hasText && (
          <button className="ai-ghost" onClick={() => onGenerate(true)} aria-label="重新生成">
            <RefreshIcon size={11} />
            重新生成
          </button>
        )}
      </div>

      {/* ── 附加提示 ── */}
      {notice && (
        <div className="mt-2.5 relative">
          <span className="ai-chip" style={{ display: 'inline-block' }}>{notice}</span>
        </div>
      )}

      {/* ── 正文区 ── */}
      <div className="mt-3 relative">
        {/* 未开始 */}
        {phase === 'idle' && (
          <div>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-2)' }}>
              {hint}
            </p>
            {configured ? (
              <button className="ai-action" onClick={() => onGenerate(false)}>
                <SparklesIcon size={15} />
                {actionLabel}
              </button>
            ) : (
              <div className="ai-error">
                <span style={{ flexShrink: 0 }}>⚠️</span>
                <span>AI 服务暂未配置，请联系管理员在服务端填写 ai.api_key 后使用。</span>
              </div>
            )}
          </div>
        )}

        {/* 思考中（还没有第一段文本） */}
        {busy && !hasText && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                AI 正在思考
              </span>
              <span className="ai-thinking-dot w-1 h-1 rounded-full" style={{ background: 'var(--accent)' }} />
              <span className="ai-thinking-dot w-1 h-1 rounded-full" style={{ background: 'var(--accent)' }} />
              <span className="ai-thinking-dot w-1 h-1 rounded-full" style={{ background: 'var(--accent)' }} />
            </div>
            <div className="space-y-2">
              <div className="ai-skeleton-line" style={{ width: '92%' }} />
              <div className="ai-skeleton-line" style={{ width: '78%' }} />
              <div className="ai-skeleton-line" style={{ width: '85%' }} />
              <div className="ai-skeleton-line" style={{ width: '60%' }} />
            </div>
            {loadingHint && (
              <p className="text-[10px] mt-3" style={{ color: 'var(--text-3)' }}>
                {loadingHint}
              </p>
            )}
          </div>
        )}

        {/* 逐字输出 / 已完成 */}
        {hasText && (
          <div>
            <div className={phase === 'streaming' ? 'ai-streaming' : ''}>
              <Markdown text={text} className="text-xs" />
            </div>

            {/* 视频概括：抽帧张数（流式期间也能看到，确认「真的看了画面」） */}
            {frames != null && frames > 0 && (busy || phase === 'done') && (
              <p className="text-[10px] mt-3" style={{ color: 'var(--text-3)' }}>
                已分析 {frames} 张关键画面
              </p>
            )}

            {/* 完成后的操作条 */}
            {phase === 'done' && (
              <div className="flex items-center justify-between mt-3.5 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
                <span className="ai-cached">
                  {cached ? '来自缓存 · 未重复调用模型' : '刚刚生成'}
                </span>
                <button className="ai-ghost" onClick={copy}>
                  {copied ? <CheckIcon size={11} /> : null}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 出错 */}
        {phase === 'error' && (
          <div className="mt-3">
            <div className="ai-error">
              <span style={{ flexShrink: 0 }}>⚠️</span>
              <span>{error || 'AI 生成失败，请稍后再试'}</span>
            </div>
            {configured && (
              <button className="ai-action" style={{ marginTop: 10 }} onClick={() => onGenerate(false)}>
                <RefreshIcon size={14} />
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
