import React from 'react'
import { AiAnswerCard } from './AiAnswerCard'
import { SummaryIcon } from './icons'
import { useAiContent, useAiStatus } from '../hooks/useAiContent'

/* ============================================================
   视频 AI 概括面板 —— 视频详情页「简介」下方

   数据来自 server/modules/ai.py 的 /api/ai/video-summary（SSE 流式）：
   服务端用 ffmpeg 从视频里均匀抽 6 张关键画面交给视觉模型看图说话，
   加上标题/简介一起概括；所以生成比题目解析慢一些（抽帧要几秒）。

   服务端没装 ffmpeg 时退化成「只按标题与简介概括」，
   此时 frames = 0，下面会挂一条提示，考试端不会一脸疑惑为什么概括很泛。

   用法：<AiVideoSummary materialId={materialId} />（放在简介卡片之后）
   ============================================================ */

interface AiVideoSummaryProps {
  materialId: number
}

export function AiVideoSummary({ materialId }: AiVideoSummaryProps) {
  const ai = useAiContent('video', materialId)
  const status = useAiStatus()

  // 抽帧完成但一张都没取到 → 本次概括质量会打折扣，如实告诉考生
  const notice = ai.phase !== 'idle' && ai.frames === 0 ? '未取到画面，仅按标题与简介概括' : undefined

  return (
    <AiAnswerCard
      title="视频 AI 概括"
      actionLabel="AI 概括这个视频"
      hint="AI 会抽取视频里的关键画面，概括出讲了什么、讲解脉络和关键知识点，方便你先抓重点再精看。"
      icon={<SummaryIcon size={16} />}
      state={ai}
      onGenerate={ai.generate}
      configured={status?.configured ?? true}
      notice={notice}
      loadingHint={
        status && !status.can_extract_frames
          ? '服务端未安装 ffmpeg，将只根据标题与简介概括…'
          : '正在从视频中抽取关键画面，通常 10~30 秒，请稍候…'
      }
    />
  )
}
