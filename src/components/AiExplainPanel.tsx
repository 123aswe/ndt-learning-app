import React from 'react'
import { AiAnswerCard } from './AiAnswerCard'
import { useAiContent, useAiStatus } from '../hooks/useAiContent'

/* ============================================================
   题目 AI 解析面板 —— 练习页答完题后，在「解析」区域下方出现

   数据来自 server/modules/ai.py 的 /api/ai/question-explain（SSE 流式）。
   本组件只做两件事：拿 hook 的状态 + 交给通用卡片渲染，样式在 AiAnswerCard 里。

   用法：<AiExplainPanel questionId={currentQ.id} />（放在判定结果卡片内部）
   ============================================================ */

interface AiExplainPanelProps {
  questionId: number
}

export function AiExplainPanel({ questionId }: AiExplainPanelProps) {
  const ai = useAiContent('question', questionId)
  const status = useAiStatus()

  return (
    <AiAnswerCard
      title="AI 智能解析"
      actionLabel="AI 解析这道题"
      hint="让 AI 讲清楚这道题的考点、每个选项为什么对错，以及容易踩的坑。"
      state={ai}
      onGenerate={ai.generate}
      configured={status?.configured ?? true}
      loadingHint="正在组织讲解思路，通常 3~10 秒…"
    />
  )
}
