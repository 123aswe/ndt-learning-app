import React from 'react'
import {
  ActivityIcon, AwardIcon, CalendarIcon, CheckCircleIcon, ClockIcon, FlagIcon,
  FlameIcon, HeartIcon, MessageIcon, PercentIcon, PlayIcon, RulerIcon, StarIcon,
  TargetIcon, WrongIcon, ZapIcon,
} from './icons'

/* ============================================================
   成就图标（emoji → 线性图标）
   后端 achievements.py / practice.py 的成就用 emoji 当 icon 字段（跨端中性），
   前端统一在这里映射成 icons.tsx 的线性图标（深色模式友好、描边风格统一）。
   新增勋章时：后端挑一个新 emoji → 这里补一条映射（缺映射会兜底成 StarIcon）。
   修改注意：颜色由调用方通过父容器 color 控制（图标用 currentColor）。
   ============================================================ */

const ACH_ICONS: Record<string, (size: number) => React.ReactNode> = {
  '🏁': s => <FlagIcon size={s} />,        // 破冰者
  '✦': s => <StarIcon size={s} />,         // 小试牛刀
  '⚡': s => <ZapIcon size={s} />,          // 百题斩
  '〜': s => <ActivityIcon size={s} />,    // 千题挑战
  '🔥': s => <FlameIcon size={s} />,       // 七日之约
  '📐': s => <RulerIcon size={s} />,       // 满分一日
  '🎯': s => <TargetIcon size={s} />,      // 神枪手
  '📅': s => <CalendarIcon size={s} />,    // 月度恒心
  '⏳': s => <ClockIcon size={s} />,        // 学海无涯
  '🎓': s => <AwardIcon size={s} />,       // 初试锋芒
  '🏅': s => <AwardIcon size={s} />,       // 一次通过
  '💯': s => <PercentIcon size={s} />,     // 满分答卷
  '🧹': s => <WrongIcon size={s} />,       // 知错能改
  '✨': s => <CheckCircleIcon size={s} />, // 错题清零
  '🔖': s => <HeartIcon size={s} />,       // 收藏家
  '📺': s => <PlayIcon size={s} />,        // 学习不止
  '💬': s => <MessageIcon size={s} />,     // 互动达人
}

export function AchievementIcon({ icon, size = 20 }: { icon: string; size?: number }) {
  const render = ACH_ICONS[icon]
  return <>{render ? render(size) : <StarIcon size={size} />}</>
}
