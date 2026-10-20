import React, { useState } from 'react'
import { AiExplainPanel } from './AiExplainPanel'
import { SparklesIcon } from './icons'

/* ============================================================
   AI 解析「懒加载」入口 —— 用在「一屏很多道题」的列表页
   （试卷回看 ExamDetailScreen、错题本 WrongQuestionsScreen）

   为什么单独做一个：这些页面一屏十几道题，如果每道题都直接挂 <AiExplainPanel/>，
   一进页面就会并发打十几个「读缓存」请求。这里改成：先只显示一个小按钮，
   考生点了才真正挂载面板（那时才会发请求）。练习页是一屏一题，用不到这个。
   ============================================================ */

interface AiExplainToggleProps {
  questionId: number
  /** 外层间距（列表页各自的行距不同，交给调用方） */
  className?: string
}

export function AiExplainToggle({ questionId, className = '' }: AiExplainToggleProps) {
  const [open, setOpen] = useState(false)

  if (open) {
    return (
      <div className={className}>
        <AiExplainPanel questionId={questionId} />
      </div>
    )
  }

  return (
    <div className={className}>
      <button
        className="ai-ghost"
        style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }}
        onClick={() => setOpen(true)}
      >
        <SparklesIcon size={12} />
        AI 解析这道题
      </button>
    </div>
  )
}
