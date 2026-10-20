import { RefreshIcon, XIcon } from './icons'
import type { AppVersionInfo } from '../api/client'

/* ============================================================
   新版本提示
   - 普通版本（force = false）→ 底部浮动提示条：可关闭，点「稍后」同一版本不再打扰
   - 强制更新（force = true）→ 全屏遮罩弹层：没有关闭入口，必须点「立即更新」
   - 「立即更新」：填了 download_url 就打开下载页（打包版 App），否则刷新页面（网页版）

   数据来源：hooks/useAppUpdate.ts（进 App 查一次 + 实时通道推来的 update 事件）

   修改注意：
   - 颜色一律用语义令牌，深色模式才自适应；图标用 currentColor（外层 span 设 color）
   - 本组件只负责「长什么样」，由 App.tsx 决定什么时候挂
     （答题 / 考试 / 成绩页不渲染它，避免打断考生）
   ============================================================ */

interface UpdateBannerProps {
  info: AppVersionInfo
  onDismiss: () => void
  onUpdate: () => void
}

/** 更新说明文案：后台没填就退化成一句通用说明 */
function notesText(info: AppVersionInfo): string {
  const notes = (info.notes || []).filter(Boolean)
  return notes.length ? notes.join('；') : '修复已知问题并优化使用体验。'
}

export function UpdateBanner({ info, onDismiss, onUpdate }: UpdateBannerProps) {
  if (info.force) return <ForceUpdateSheet info={info} onUpdate={onUpdate} />
  return <UpdateTipBar info={info} onDismiss={onDismiss} onUpdate={onUpdate} />
}

/* ── 普通版本：底部提示条 ────────────────────────────────── */

function UpdateTipBar({ info, onDismiss, onUpdate }: UpdateBannerProps) {
  return (
    <div
      className="absolute left-4 right-4 z-50 anim-slide-up"
      // 抬到底部导航上方：BottomNav 是 fixed bottom-0 z-50（胶囊高约 64px + mb-5 的 20px），
      // 提示条同为 z-50 但 DOM 靠后，定位再抬高 96px 就不会互相压住
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
    >
      <div
        className="card p-3 flex items-start gap-3"
        style={{
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: 'var(--accent-border)',
          background: 'var(--surface)',
        }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
        >
          <RefreshIcon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>
              发现新版本 {info.latest_version}
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
            >
              可更新
            </span>
          </div>
          <p
            className="text-[11px] mt-0.5"
            style={{
              color: 'var(--text-2)',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {notesText(info)}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={onUpdate}
              className="gb gb-primary gb-sm tap text-[11px] font-semibold"
              style={{ padding: '5px 14px' }}
            >
              立即更新
            </button>
            <button onClick={onDismiss} className="text-[11px] tap" style={{ color: 'var(--text-3)' }}>
              稍后
            </button>
          </div>
        </div>

        <button onClick={onDismiss} className="flex-shrink-0 p-1 tap" aria-label="关闭">
          <XIcon size={13} color="var(--text-3)" />
        </button>
      </div>
    </div>
  )
}

/* ── 强制更新：不可关闭的弹层 ────────────────────────────── */

function ForceUpdateSheet({ info, onUpdate }: { info: AppVersionInfo; onUpdate: () => void }) {
  const notes = (info.notes || []).filter(Boolean)

  return (
    <div
      className="absolute inset-0 z-[60] flex items-end justify-center anim-fade-in"
      style={{ background: 'rgba(18, 20, 24, 0.45)', backdropFilter: 'blur(3px)' }}
    >
      <div
        className="w-full p-5 anim-sheet-in"
        style={{
          background: 'var(--surface)',
          borderRadius: '22px 22px 0 0',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 22px)',
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--accent-weak)', color: 'var(--accent)' }}
          >
            <RefreshIcon size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold" style={{ color: 'var(--text-1)' }}>
              发现新版本 {info.latest_version}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-2)' }}>
              本次更新为必需更新，完成后才能继续使用
            </p>
          </div>
        </div>

        <div
          className="mt-4 p-3.5 rounded-2xl"
          style={{ background: 'var(--chip-bg)', border: '1px solid var(--chip-border)' }}
        >
          <p className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
            更新内容
          </p>
          {notes.length ? (
            <ul className="flex flex-col gap-1">
              {notes.map((note, index) => (
                <li key={index} className="text-xs flex gap-1.5" style={{ color: 'var(--text-1)' }}>
                  <span style={{ color: 'var(--accent)' }}>·</span>
                  <span className="min-w-0">{note}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-1)' }}>
              修复已知问题并优化使用体验。
            </p>
          )}
        </div>

        <button
          onClick={onUpdate}
          className="gb gb-primary w-full tap mt-5 text-sm font-semibold"
          style={{ padding: '13px 0' }}
        >
          {info.download_url ? '前往下载新版本' : '立即更新'}
        </button>
        <p className="text-[10px] text-center mt-2" style={{ color: 'var(--text-3)' }}>
          {info.download_url
            ? '将打开下载页面，安装后即可继续使用'
            : '将刷新页面加载最新版本，你的练习记录不会丢失'}
        </p>
      </div>
    </div>
  )
}
