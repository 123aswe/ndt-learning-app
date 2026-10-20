import React, { useState } from 'react'
import { AiAnswerCard } from './AiAnswerCard'
import { useAiContent, useAiStatus } from '../hooks/useAiContent'
import { RichText } from './RichText'
import { BookIcon, ChevronRightIcon } from './icons'

/* ============================================================
   「题目原题讲解」折叠面板 —— 只用在**无选项的计算题**上（练习页答完后）

   内容来源（二选一）：
     1. 题库里配了解答过程（questions.explanation，可含插图标记 [[img:xxx]]）
        → 直接展示，属于「原题讲解」，不带 AI 免责提示
     2. 题库没配 → 让 AI 分步写出解答过程（server/modules/ai.py 的
        /api/ai/question-solution，SSE 流式），并在正文后面固定加一句免责提示

   为什么默认折叠：计算题的讲解里就写着答案，答完先折叠起来，
   考生想复盘时自己点开（需求：用户可以显示或者不显示）。

   修改注意：
     - 颜色一律用 var(--token)，深色模式自动适配
     - AI 面板复用 AiAnswerCard（未配置 / 思考中 / 逐字输出 / 出错 四态都在那边）
   ============================================================ */

interface QuestionSolutionPanelProps {
  questionId: number
  /** 标准答案（计算题的答案文本，可能带插图标记） */
  answer: string
  /** 题库里配置的解答过程（空 / 未传 = 走 AI 生成） */
  explanation?: string
  /** 外层间距由调用方决定 */
  className?: string
}

export function QuestionSolutionPanel({
  questionId,
  answer,
  explanation,
  className = '',
}: QuestionSolutionPanelProps) {
  const [open, setOpen] = useState(false)
  /** 题库里配了解答过程 = 用「原题讲解」；否则走 AI */
  const fromBank = Boolean((explanation || '').trim())

  // 折叠时不读缓存（省一次请求）；展开 / 切到新题时才会真正去读
  const ai = useAiContent('solution', questionId, !fromBank && open)
  const status = useAiStatus()

  const hasAnswer = Boolean((answer || '').trim())
  const aiHasText = ai.phase === 'streaming' || ai.phase === 'done'

  return (
    <section className={`card overflow-hidden ${className}`}>
      {/* ── 标题栏：点一下展开 / 收起 ── */}
      <button
        type="button"
        className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left card-tap"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
        >
          <BookIcon size={15} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-bold tracking-wide" style={{ color: 'var(--text-1)' }}>
            题目原题讲解
          </span>
          <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {open
              ? '点这里收起'
              : fromBank
                ? '解答过程 · 点击展开'
                : '暂无题库解答过程，可由 AI 生成'}
          </span>
        </span>
        <span
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.18s ease',
          }}
        >
          <ChevronRightIcon size={16} color="var(--text-3)" />
        </span>
      </button>

      {/* ── 展开区 ── */}
      {open && (
        <div className="px-4 pb-4 pt-3.5 anim-slide-up" style={{ borderTop: '1px solid var(--line)' }}>
          {/* 标准答案（答案藏在展开区里，不主动剧透） */}
          {hasAnswer && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold mb-1.5 tracking-wide" style={{ color: 'var(--text-3)' }}>
                标准答案
              </p>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-1)' }}>
                <RichText text={answer} />
              </p>
            </div>
          )}

          {fromBank ? (
            <div>
              <p className="text-[10px] font-semibold mb-1.5 tracking-wide" style={{ color: 'var(--text-3)' }}>
                解答过程
              </p>
              <div className="text-sm leading-relaxed" style={{ color: 'var(--text-2)' }}>
                <RichText text={explanation} />
              </div>
            </div>
          ) : (
            <div>
              <AiAnswerCard
                title="AI 解答过程"
                actionLabel="让 AI 写出解答过程"
                hint="AI 会按「已知 → 公式 → 代入计算 → 结论」分步算出这道题。"
                state={ai}
                onGenerate={ai.generate}
                configured={status?.configured ?? true}
                loadingHint="正在一步步推算，通常 5~15 秒…"
              />
              {/* 免责提示：跟在 AI 正文后面（需求明确要求「后面加一个提示」） */}
              {aiHasText && (
                <p
                  className="text-[10px] leading-relaxed mt-2 px-3 py-2 rounded-xl"
                  style={{
                    background: 'var(--surface-warm)',
                    border: '1px solid var(--line)',
                    color: 'var(--text-3)',
                  }}
                >
                  ⚠️ 以上解答过程由 AI 生成，仅供参考，<strong>不一定正确</strong>；请以教材、标准答案与检测标准为准。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
