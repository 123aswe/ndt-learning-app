import React, { useState } from 'react'
import { categories, trainingSets } from '../data/mockData'
import { SearchIcon, FilterIcon, ChevronRightIcon } from '../components/icons'
import type { NDTMethod } from '../types'

/* ============================================================
   题库分类页（苹果式浅色）
   结构保持：标题 / 搜索框 / 分类 Tab / 检测方法卡片 / 训练集列表 / 筛选面板
   ============================================================ */

interface QuestionBankScreenProps {
  onStartPractice: (categoryId: string) => void
}

const difficultyLabel = { easy: '入门', medium: '中等', hard: '进阶' }
const difficultyColor = { easy: 'var(--ok)', medium: 'var(--accent)', hard: 'var(--err)' }

export function QuestionBankScreen({ onStartPractice }: QuestionBankScreenProps) {
  const [activeCategory, setActiveCategory] = useState<NDTMethod | '全部'>('全部')
  const [searchText, setSearchText] = useState('')
  const [showFilter, setShowFilter] = useState(false)

  const allCats: Array<NDTMethod | '全部'> = ['全部', 'UT', 'RT', 'MT', 'PT', 'ET', 'VT', '综合']

  const filteredSets = trainingSets.filter(ts => {
    const catMatch = activeCategory === '全部' || ts.category === activeCategory
    const searchMatch = !searchText || ts.title.includes(searchText) || ts.description.includes(searchText)
    return catMatch && searchMatch
  })

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* 标题 */}
        <div className="px-5 pt-14 pb-4">
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-1)', letterSpacing: '-0.015em' }}>题库</h1>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>1,462 道专业 NDT 题目</p>
        </div>

        {/* 搜索框 */}
        <div className="px-4 mb-4">
          <div className="relative flex items-center">
            <SearchIcon size={16} className="absolute left-4 z-10 flex-shrink-0" color="var(--text-3)" />
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="搜索题目、知识点、标准…"
              className="w-full rounded-2xl pl-10 pr-12 h-11 text-sm outline-none"
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
            />
            <button
              onClick={() => setShowFilter(true)}
              className="absolute right-2.5 flex items-center gap-1 px-2.5 py-1.5 rounded-lg tap"
              style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
            >
              <FilterIcon size={13} />
              <span className="text-[10px] font-semibold">筛选</span>
            </button>
          </div>
        </div>

        {/* 分类 Tab */}
        <div className="px-4 mb-5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {allCats.map(cat => {
              const isActive = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat as NDTMethod | '全部')}
                  className={`flex-shrink-0 px-4 h-8 rounded-full text-xs font-semibold transition-colors duration-200 gb-pill ${isActive ? 'gb-soft' : ''}`}
                  style={{
                    background: isActive ? 'rgba(95,141,140,0.90)' : 'rgba(255,255,255,0.68)',
                    color: isActive ? '#fff' : 'var(--text-2)',
                    border: isActive ? '1px solid rgba(95,141,140,0.6)' : '1px solid rgba(255,255,255,0.75)',
                  }}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        </div>

        {/* 检测方法卡片 */}
        {activeCategory === '全部' && !searchText && (
          <div className="px-4 mb-5">
            <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-1)' }}>检测方法</h3>
            <div className="grid grid-cols-2 gap-3">
              {categories.map(cat => {
                const pct = Math.round((cat.completedCount / cat.questionCount) * 100)
                return (
                  <button
                    key={cat.id}
                    onClick={() => onStartPractice(cat.id)}
                    className="card p-4 text-left card-tap"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-lg font-bold" style={{ color: 'var(--accent)' }}>{cat.name}</span>
                      {pct > 0 && (
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>{pct}%</span>
                      )}
                    </div>
                    <div className="text-xs font-medium mb-0.5" style={{ color: 'var(--text-1)' }}>{cat.fullName}</div>
                    <div className="text-[10px] mb-3" style={{ color: 'var(--text-3)' }}>{cat.questionCount} 题</div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: '#EDEFF2' }}>
                      <div
                        className="h-full rounded-full progress-fill"
                        style={{ width: `${pct}%`, background: 'var(--accent)' }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* 训练集列表 */}
        <div className="px-4">
          {activeCategory !== '全部' || searchText ? (
            <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-1)' }}>
              {searchText ? `"${searchText}" 相关` : `${activeCategory} 训练集`}
            </h3>
          ) : (
            <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-1)' }}>推荐训练集</h3>
          )}

          {filteredSets.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-4">
              <SearchIcon size={40} color="var(--text-3)" />
              <div className="font-medium" style={{ color: 'var(--text-2)' }}>没有找到相关题目</div>
              <div className="text-sm" style={{ color: 'var(--text-3)' }}>换个关键词试试</div>
              <button
                onClick={() => setSearchText('')}
                className="mt-2 px-5 py-2.5 gb gb-pill gb-soft rounded-xl text-sm font-medium"
                style={{ color: 'var(--accent)' }}
              >
                清除搜索
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSets.map(ts => {
                const pct = Math.round((ts.completedCount / ts.questionCount) * 100)
                return (
                  <button
                    key={ts.id}
                    onClick={() => onStartPractice(ts.category)}
                    className="w-full card p-4 text-left card-tap"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0"
                        style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                      >
                        {ts.category}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{ts.title}</span>
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ml-2"
                            style={{ background: 'var(--surface-warm)', color: difficultyColor[ts.difficulty], border: '1px solid var(--line)' }}
                          >
                            {difficultyLabel[ts.difficulty]}
                          </span>
                        </div>
                        <p className="text-xs mb-3 line-clamp-1" style={{ color: 'var(--text-3)' }}>{ts.description}</p>

                        <div className="flex items-center gap-4 text-[10px] mb-2" style={{ color: 'var(--text-3)' }}>
                          <span>{ts.questionCount} 题</span>
                          <span>约 {ts.estimatedMinutes} 分钟</span>
                          {ts.completedCount > 0 && <span>已完成 {ts.completedCount}</span>}
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: '#EDEFF2' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.6s ease' }}
                            />
                          </div>
                          <span className="text-[10px]" style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                        </div>
                      </div>

                      <ChevronRightIcon size={16} className="mt-2 flex-shrink-0" color="var(--text-3)" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 筛选面板（浅色底部面板） */}
      {showFilter && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowFilter(false)} />
          <div
            className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] rounded-t-3xl anim-sheet-in"
            style={{ background: '#fff', border: '1px solid var(--line)', boxShadow: '0 -4px 24px rgba(27,30,35,0.08)' }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: '#D9DCE0' }} />
            </div>
            <div className="px-5 pb-8">
              <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-1)' }}>筛选</h3>

              <div className="space-y-5">
                {[
                  { label: '检测方法', opts: ['全部', 'UT', 'RT', 'MT', 'PT'] },
                  { label: '难度', opts: ['全部', '入门', '中等', '进阶'] },
                  { label: '考试等级', opts: ['全部', '一级', '二级'] },
                ].map(section => (
                  <div key={section.label}>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>{section.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {section.opts.map(opt => (
                        <button
                          key={opt}
                          className="px-3 h-8 gb-pill rounded-full text-xs font-medium"
                          style={{
                            background: opt === '全部' ? 'rgba(95,141,140,0.90)' : 'rgba(248,249,251,0.9)',
                            color: opt === '全部' ? '#fff' : 'var(--text-2)',
                            border: opt === '全部' ? '1px solid rgba(95,141,140,0.6)' : '1px solid rgba(255,255,255,0.75)',
                            boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.5), inset -1px -1px 0 rgba(27,30,35,0.04), 0 2px 6px rgba(27,30,35,0.05)',
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setShowFilter(false)}
                  className="flex-1 h-12 gb gb-ghost rounded-2xl text-sm font-semibold"
                >
                  重置
                </button>
                <button
                  onClick={() => setShowFilter(false)}
                  className="flex-1 h-12 gb gb-primary rounded-2xl text-sm font-semibold"
                >
                  应用筛选
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
