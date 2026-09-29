import React from 'react'
import { userStats, achievements } from '../data/mockData'
import {
  PencilIcon, ChevronRightIcon, BookIcon, WrongIcon, ListIcon, ChartIcon,
  AwardIcon, GearIcon, ActivityIcon, FlameIcon, ZapIcon, StarIcon, FlagIcon, RulerIcon,
} from '../components/icons'
import type { Screen } from '../types'

/* ============================================================
   个人中心页（苹果式浅色）
   结构保持：头像区 / 经验条 / 统计 / 成就预览 / 菜单列表 / 版本信息
   菜单图标统一为极简线性图标（数据里是 emoji，渲染时映射）
   ============================================================ */

interface ProfileScreenProps {
  onNavigate: (screen: Screen) => void
}

const achIconMap: Record<string, React.ReactNode> = {
  '🏁': <FlagIcon size={20} />,
  '🔥': <FlameIcon size={20} />,
  '〜': <ActivityIcon size={20} />,
  '⚡': <ZapIcon size={20} />,
  '✦': <StarIcon size={20} />,
  '📐': <RulerIcon size={20} />,
}

const menuItems = [
  { icon: <BookIcon size={18} />, label: '我的收藏', sub: '24 道题目', screen: 'question-bank' as Screen },
  { icon: <WrongIcon size={18} />, label: '我的错题', sub: '4 道待复习', screen: 'wrong-questions' as Screen },
  { icon: <ListIcon size={18} />, label: '我的题单', sub: '3 个自定义题单', screen: 'question-bank' as Screen },
  { icon: <ChartIcon size={18} />, label: '学习记录', sub: '累计 842 分钟', screen: 'learning' as Screen },
  { icon: <AwardIcon size={18} />, label: '成就勋章', sub: `${achievements.filter(a => a.earned).length} / ${achievements.length} 已获得`, screen: 'achievements' as Screen },
  { icon: <GearIcon size={18} />, label: '设置', sub: '账号、外观、通知', screen: 'settings' as Screen },
]

export function ProfileScreen({ onNavigate }: ProfileScreenProps) {
  const xpPct = Math.round((userStats.xp / userStats.maxXp) * 100)
  const earnedAchs = achievements.filter(a => a.earned)

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* 头像区 */}
        <div className="px-5 pt-14 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
                  style={{
                    background: 'rgba(95,141,140,0.16)',
                    color: 'var(--accent)',
                    border: '1px solid rgba(255,255,255,0.9)',
                    boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.85), inset -1px -1px 0 rgba(95,141,140,0.12), 0 4px 12px rgba(95,141,140,0.20)',
                  }}
                >
                  张
                </div>
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full"
                  style={{ background: 'var(--ok)', border: '2px solid var(--bg)' }}
                />
              </div>

              <div>
                <h2 className="font-bold text-xl" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
                  {userStats.name}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                  >
                    NDT Lv.{userStats.level}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>UT 专项</span>
                </div>
              </div>
            </div>

            <button className="w-9 h-9 rounded-xl flex items-center justify-center tap" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <PencilIcon size={16} color="var(--text-2)" />
            </button>
          </div>

          {/* 经验条 */}
          <div className="mt-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>经验值</span>
              <span className="text-xs" style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {userStats.xp} / {userStats.maxXp} XP
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#EDEFF2' }}>
              <div className="h-full rounded-full progress-fill" style={{ width: `${xpPct}%`, background: 'var(--accent)' }} />
            </div>
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>{userStats.maxXp - userStats.xp} XP 升至 Lv.{userStats.level + 1}</div>
          </div>
        </div>

        {/* 统计 */}
        <div className="px-4 mb-5 grid grid-cols-4 gap-2">
          {[
            { label: '总答题', value: userStats.totalQuestions },
            { label: '正确率', value: `${Math.round(userStats.accuracy * 100)}%` },
            { label: '连续天', value: userStats.streak },
            { label: '成就数', value: earnedAchs.length },
          ].map(s => (
            <div key={s.label} className="card p-3 text-center">
              <div className="text-base font-bold" style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
              <div className="text-[9px] mt-1" style={{ color: 'var(--text-3)' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* 成就预览 */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>最近成就</h3>
              <button onClick={() => onNavigate('achievements')} className="text-xs tap" style={{ color: 'var(--text-3)' }}>
                全部 {achievements.length} 个 <ChevronRightIcon size={12} />
              </button>
            </div>
            <div className="flex gap-3">
              {earnedAchs.map(ach => (
                <div key={ach.id} className="flex flex-col items-center gap-1.5 flex-1">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{ background: 'var(--accent-weak)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
                  >
                    {achIconMap[ach.icon] || <StarIcon size={20} />}
                  </div>
                  <span className="text-[9px] text-center leading-tight" style={{ color: 'var(--text-2)' }}>{ach.title}</span>
                </div>
              ))}
              {achievements.filter(a => !a.earned).slice(0, 2).map(ach => (
                <div key={ach.id} className="flex flex-col items-center gap-1.5 flex-1">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center opacity-50"
                    style={{ background: '#EDEFF2', border: '1px solid var(--line)', color: 'var(--text-3)' }}
                  >
                    {achIconMap[ach.icon] || <StarIcon size={20} />}
                  </div>
                  <span className="text-[9px] text-center leading-tight" style={{ color: 'var(--text-3)' }}>{ach.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 菜单列表 */}
        <div className="px-4 space-y-2">
          {menuItems.map(item => (
            <button
              key={item.label}
              onClick={() => onNavigate(item.screen)}
              className="w-full card px-4 py-3.5 flex items-center gap-4 card-tap"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-weak)' }}>
                <span style={{ color: 'var(--accent)' }}>{item.icon}</span>
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{item.label}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{item.sub}</div>
              </div>
              <ChevronRightIcon size={15} color="var(--text-3)" />
            </button>
          ))}
        </div>

        {/* 版本信息 */}
        <div className="text-center mt-8">
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>NDT-劳人 v1.0.0</p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)', opacity: 0.7 }}>无损检测学习与考试训练平台</p>
        </div>
      </div>
    </div>
  )
}
