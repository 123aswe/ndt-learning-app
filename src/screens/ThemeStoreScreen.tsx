import React, { useCallback, useEffect, useState } from 'react'
import {
  applySkin, fetchThemes, getSkin, previewUrl, subscribeSkin,
  type SkinSnapshot, type ThemeItem,
} from '../themeStore'
import { CheckIcon, ChevronLeftIcon, PaletteIcon } from '../components/icons'

/* ============================================================
   主题商店（我的 → 主题商店）
   - 数据源：GET /api/themes（公开接口，不需要登录）
   - 一个主题 = 背景图 + 主色 + 辅色 + 字色，选中后立即应用：
       登录 / 注册页与登录后的主界面一起生效（皮肤存在本机，见 src/themeStore.ts）
   - 界面本身只改颜色、不碰尺寸：背景图 cover 铺满（裁剪不拉伸），配色走 CSS 变量覆盖
   - 「恢复默认外观」= 清掉皮肤，回到设置页里选的浅色 / 深色
   修改注意：
     - 本页是整页视图，根元素必须是唯一一个 .scroll-area（滚动结构约定，见 FRONTEND.md §11）
     - 颜色一律 var(--token)：本页自己也跟着皮肤变色，正好当预览
   ============================================================ */

interface ThemeStoreScreenProps {
  onBack: () => void
}

/** 预览缩略图：有预览图用图，否则用主色 / 辅色调出的渐变兜底（都是 object-cover，不变形） */
function ThemeThumb({ theme }: { theme: ThemeItem }) {
  const [failed, setFailed] = useState(false)
  const useImage = theme.has_preview && !failed
  const p = theme.primary_color || '#5F8D8C'
  const s = theme.secondary_color || p

  return (
    <div
      className="relative flex-shrink-0 overflow-hidden rounded-xl"
      style={{
        width: 84,
        height: 58,
        border: '1px solid var(--line)',
        background: `linear-gradient(150deg, ${p}, ${s})`,
      }}
    >
      {useImage && (
        <img
          src={previewUrl(theme)}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}

function toneLabel(tone: string): string {
  return tone === 'light' ? '浅色字' : '深色字'
}

export function ThemeStoreScreen({ onBack }: ThemeStoreScreenProps) {
  const [themes, setThemes] = useState<ThemeItem[] | null>(null)
  const [skin, setSkin] = useState<SkinSnapshot | null>(() => getSkin())
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  /* 皮肤变化（含别处恢复默认）→ 刷新本页「使用中」标记 */
  useEffect(() => subscribeSkin(() => setSkin(getSkin())), [])

  const load = useCallback(async () => {
    setError('')
    try {
      const items = await fetchThemes()
      setThemes(items)
      /* 本机选的主题已被管理员删掉 → 顺手恢复默认外观，别让页面停在主题色上 */
      const applied = getSkin()
      if (applied && !items.some((t) => t.id === applied.id)) applySkin(null)
    } catch (err) {
      setThemes([])
      setError(err instanceof Error ? err.message : '主题列表加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const pick = (theme: ThemeItem) => {
    applySkin(theme)
    setToast(`已应用主题「${theme.name}」`)
  }

  const reset = () => {
    applySkin(null)
    setToast('已恢复默认外观')
  }

  const loading = themes === null

  return (
    <div className="scroll-area bg-page">
      <div className="ui-stagger" style={{ paddingBottom: 56 }}>
        {/* 顶栏 */}
        <div className="flex items-center gap-3 px-5 pt-12 pb-3">
          <button
            onClick={onBack}
            aria-label="返回"
            className="tap flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)', color: 'var(--text-2)' }}
          >
            <ChevronLeftIcon size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>主题商店</h1>
            <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>
              背景与配色皮肤 · 登录页和主界面一起生效
            </p>
          </div>
        </div>

        {/* 当前使用 */}
        <div className="px-4">
          <div className="card flex items-center gap-3.5 p-4">
            <div
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
            >
              <PaletteIcon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                {skin ? skin.name : '默认外观'}
              </div>
              <div className="mt-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>
                {skin
                  ? `${toneLabel(skin.text_tone)} · 已覆盖设置页的深浅色`
                  : '跟随设置页的浅色 / 深色 / 跟随系统'}
              </div>
            </div>
            {skin && (
              <button
                onClick={reset}
                className="gb gb-ghost tap h-9 flex-shrink-0 rounded-xl px-3.5 text-xs font-semibold"
              >
                恢复默认
              </button>
            )}
          </div>
        </div>

        {/* 主题列表 */}
        <div className="mt-4 px-4">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
              可选主题
            </span>
            {!loading && themes.length > 0 && (
              <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>共 {themes.length} 套</span>
            )}
          </div>

          {loading && (
            <div className="card p-5 text-center text-xs" style={{ color: 'var(--text-3)' }}>
              正在加载主题…
            </div>
          )}

          {!loading && error && (
            <div className="card p-5 text-center">
              <p className="text-xs" style={{ color: 'var(--err)' }}>{error}</p>
              <button
                onClick={() => void load()}
                className="gb gb-ghost tap mt-3 h-9 rounded-xl px-4 text-xs font-semibold"
              >
                重新加载
              </button>
            </div>
          )}

          {!loading && !error && themes.length === 0 && (
            <div className="card p-6 text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>暂时还没有可选主题</p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
                管理员可在管理后台「主题商店」上传背景图与配色
              </p>
            </div>
          )}

          {!loading && themes.length > 0 && (
            <div className="space-y-2">
              {themes.map((theme) => {
                const active = skin?.id === theme.id
                return (
                  <button
                    key={theme.id}
                    onClick={() => pick(theme)}
                    aria-pressed={active}
                    className="card card-tap flex w-full items-center gap-3.5 p-3.5 text-left"
                    style={active ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 2px var(--accent-weak)' } : undefined}
                  >
                    <ThemeThumb theme={theme} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
                        {theme.name}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {/* 主色 / 辅色小圆点 */}
                        <span className="flex items-center gap-1">
                          <span
                            className="inline-block h-3.5 w-3.5 rounded-full"
                            style={{
                              background: theme.primary_color || '#5F8D8C',
                              border: '1px solid var(--line)',
                            }}
                          />
                          <span
                            className="inline-block h-3.5 w-3.5 rounded-full"
                            style={{
                              background: theme.secondary_color || theme.primary_color || '#5F8D8C',
                              border: '1px solid var(--line)',
                            }}
                          />
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>
                          {toneLabel(theme.text_tone)} · {theme.has_background ? '含背景图' : '配色背景'}
                        </span>
                      </div>
                    </div>
                    {active ? (
                      <span
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                        style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
                      >
                        <CheckIcon size={15} strokeWidth={2.4} />
                      </span>
                    ) : (
                      <span
                        className="gb gb-ghost flex h-8 flex-shrink-0 items-center rounded-xl px-3 text-xs font-semibold"
                      >
                        应用
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          <p className="mt-4 px-1 text-[10px] leading-relaxed" style={{ color: 'var(--text-3)' }}>
            主题只改变背景与配色，不会改动界面尺寸；选择会保存在本机，换设备重新挑一次即可。
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="anim-slide-up fixed left-1/2 top-20 z-[70] -translate-x-1/2">
          <div
            className="rounded-2xl px-4 py-2.5 text-sm font-medium"
            style={{ background: 'rgba(27,30,35,0.86)', color: '#fff', boxShadow: '0 8px 24px rgba(27,30,35,0.22)' }}
          >
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
