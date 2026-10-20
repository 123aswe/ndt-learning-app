import React from 'react'
import type { Tab } from '../types'
import { HomeIcon, GridIcon, MusicIcon, UserIcon, BookIcon } from './icons'

interface BottomNavProps {
  activeTab: Tab
  onChange: (tab: Tab) => void
}

/* 底部导航：悬浮胶囊形磨砂玻璃导航舱（Liquid Glass Capsule）
   - 图标置于小瓷片内，subtle 3D 效果：内高光 + 微投影，激活时轻浮起
   - 标签文字保持深色高可读性（浅色玻璃上白字不可读）
   修改注意：胶囊样式在 index.css `.nav-liquid`，微交互在下方 tabItem
   - 「错题」入口已移到「我的」页（错题集 / 成绩记录 / 观看历史）
   - 「学习」入口已移到「我的 → 学习记录」（Tab 位换成「音乐」播放页），
     learning 仍保留在 Tab 类型里（状态机 / 页面记忆 / 我的页跳转用）
   - 「教材/视频」Tab：第二阶段接视频课程与电子教材，看完自动记入观看历史 */
const tabs: Array<{ id: Tab; label: string; icon: (active: boolean) => React.ReactNode }> = [
  { id: 'home', label: '首页', icon: (a) => <HomeIcon size={21} color={a ? 'var(--accent)' : undefined} strokeWidth={a ? 2 : 1.7} /> },
  { id: 'questions', label: '题库', icon: (a) => <GridIcon size={21} color={a ? 'var(--accent)' : undefined} strokeWidth={a ? 2 : 1.7} /> },
  { id: 'materials', label: '教材/视频', icon: (a) => <BookIcon size={21} color={a ? 'var(--accent)' : undefined} strokeWidth={a ? 2 : 1.7} /> },
  { id: 'music', label: '音乐', icon: (a) => <MusicIcon size={21} color={a ? 'var(--accent)' : undefined} strokeWidth={a ? 2 : 1.7} /> },
  { id: 'profile', label: '我的', icon: (a) => <UserIcon size={21} color={a ? 'var(--accent)' : undefined} strokeWidth={a ? 2 : 1.7} /> },
]

export function BottomNav({ activeTab, onChange }: BottomNavProps) {
  return (
    <div
      className="safe-bottom fixed bottom-0 left-1/2 -translate-x-1/2 z-50"
      style={{ width: '100%', maxWidth: 430 }}
    >
      {/* 悬浮胶囊：居中、收窄、略抬离底部 */}
      <div className="nav-liquid overflow-hidden mx-auto mb-5" style={{ width: 'calc(100% - 72px)' }}>
        {/* 玻璃光泽高光层 */}
        <div className="nav-liquid-shine" />
        <div className="relative flex items-center justify-around py-2 px-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onChange(tab.id)}
                className="flex flex-col items-center gap-1 flex-1 py-1 select-none"
                style={{ minWidth: 52 }}
              >
                {/* 图标瓷片：subtle 3D 浮雕，激活时轻浮起 + 主色 */}
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 40,
                    height: 36,
                    borderRadius: 14,
                    background: isActive ? 'var(--accent-weak)' : 'rgba(255,255,255,0.52)',
                    border: isActive ? '1px solid var(--accent-border)' : '1px solid var(--chip-border)',
                    boxShadow: isActive
                      ? 'inset 0 1px 0 var(--inset-hi), 0 3px 9px rgba(95,141,140,0.28)'
                      : 'inset 0 1px 0 var(--inset-hi), 0 1px 3px rgba(27,30,35,0.07)',
                    transform: isActive ? 'translateY(-1.5px)' : 'translateY(0)',
                    transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1), box-shadow 0.22s ease, background 0.2s ease',
                  }}
                >
                  {tab.icon(isActive)}
                </div>
                <span
                  className="text-[9.5px] font-semibold tracking-wide"
                  style={{
                    color: isActive ? 'var(--accent)' : 'var(--text-2)',
                    transition: 'color 0.2s ease',
                  }}
                >
                  {tab.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
