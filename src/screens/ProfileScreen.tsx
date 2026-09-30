import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AVATAR_PRESETS } from '../data/avatars'
import { Avatar } from '../components/Avatar'
import { useProfile } from '../hooks/useProfile'
import { useHomeData } from '../hooks/useHomeData'
import { APP_VERSION } from '../data/appVersion'
import { ApiError } from '../api/client'
import {
  PencilIcon, ChevronRightIcon, BookIcon, WrongIcon, ChartIcon,
  AwardIcon, GearIcon, CameraIcon, XIcon, PlayIcon,
} from '../components/icons'
import { AchievementIcon } from '../components/AchievementIcon'
import type { Screen } from '../types'

/* ============================================================
   个人中心页（苹果式浅色）
   结构保持：头像区 / 经验条 / 成就预览 / 错题·成绩·观看 三入口 / 菜单列表 / 版本信息
   - 头像与昵称来自后端（useProfile：本地缓存秒显 + 后端拉取覆盖）
   - 经验等级 / 成就 / 副标题来自 useHomeData（/api/user/stats/summary 实时计算）
   - 点头像旁的铅笔 → 打开编辑面板，可改昵称、选预设头像、上传本地图片
   - 昵称 / 头像存 user_accounts 表，换设备登录也在
   修改注意：
     - 头像取值格式与预设列表见 src/data/avatars.ts（不要在本页写死颜色）
    - 错题集 / 成绩记录 / 观看历史 三入口在成就卡下面（底部导航不再有「错题」Tab）
    - 成就预览只显示 summary 里的前 6 枚（完整勋章墙见 AchievementsScreen）；
      总数/已解锁数用 summary 的 ach_total / ach_earned（完整口径）
    - 成就图标统一走 components/AchievementIcon（emoji → 线性图标），别在本页再写映射表
   ============================================================ */

interface ProfileScreenProps {
  onNavigate: (screen: Screen) => void
}

/** 昵称长度限制（后端最大 32，界面收得更紧一些保证展示不折行） */
const NICKNAME_MAX = 16
/** 上传图片的压缩边长与体积上限 */
const AVATAR_PIXELS = 256
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024

const menuItems = (subs: {
  totalMinutes: number
  achEarned: number
  achTotal: number
}) => [
  { icon: <BookIcon size={18} />, label: '我的收藏', sub: '收藏的视频', screen: 'favorites' as Screen },
  { icon: <ChartIcon size={18} />, label: '学习记录', sub: `累计 ${subs.totalMinutes} 分钟`, screen: 'learning' as Screen },
  { icon: <AwardIcon size={18} />, label: '成就勋章', sub: `${subs.achEarned} / ${subs.achTotal} 已获得`, screen: 'achievements' as Screen },
  { icon: <GearIcon size={18} />, label: '设置', sub: '账号、外观、通知', screen: 'settings' as Screen },
]

/** 成就卡下面的三个功能入口：错题集 / 成绩记录 / 观看历史（原底部「错题」Tab 移到这里） */
const quickEntries = (wrongPending: number) => [
  { icon: <WrongIcon size={18} />, label: '错题集', sub: `${wrongPending} 道待复习`, screen: 'wrong-questions' as Screen },
  { icon: <ChartIcon size={18} />, label: '成绩记录', sub: '练习与考试成绩', screen: 'score-records' as Screen },
  { icon: <PlayIcon size={18} />, label: '观看历史', sub: '看过的视频都在这里', screen: 'watch-history' as Screen },
]

export function ProfileScreen({ onNavigate }: ProfileScreenProps) {
  const { profile, canEdit, update, error: loadError } = useProfile()
  const { stats } = useHomeData()

  const achievements = stats?.achievements ?? []
  const earnedAchs = achievements.filter(a => a.earned)
  /** 成就总数/已解锁数用完整成就墙的口径（summary 里的 achievements 只是前 6 枚预览） */
  const achTotal = stats?.ach_total ?? achievements.length
  const totalMinutes = Math.round((stats?.total_duration_seconds ?? 0) / 60)
  const xpPct = stats?.xp_level_max
    ? Math.round((stats.xp_in_level / stats.xp_level_max) * 100)
    : 0

  /* 展示值：优先后端/缓存的资料，取不到时退回账号名 */
  const displayName = profile?.nickname || profile?.account || 'NDT 考生'
  const displayAvatar = profile?.avatar || ''
  const account = profile?.account || ''
  const org = profile?.org || ''
  const method = profile?.method || ''

  /* ── 编辑面板状态 ── */
  const [editorOpen, setEditorOpen] = useState(false)
  const [draftNickname, setDraftNickname] = useState('')
  const [draftAvatar, setDraftAvatar] = useState('')
  const [editorError, setEditorError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const toastTimer = useRef<number | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2400)
  }, [])

  const openEditor = () => {
    setDraftNickname(displayName)
    setDraftAvatar(displayAvatar)
    setEditorError('')
    setEditorOpen(true)
  }

  const closeEditor = () => {
    if (saving) return
    setEditorOpen(false)
    setEditorError('')
  }

  /* 选本地图片 → 居中裁剪成正方形 → 压到 256×256 → 转 data URL */
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选同一张
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setEditorError('请选择图片文件')
      return
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setEditorError('图片不能超过 5MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = AVATAR_PIXELS
        canvas.height = AVATAR_PIXELS
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          setEditorError('图片处理失败，请换一张')
          return
        }
        // 居中裁剪为正方形，避免上传后变形
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS)
        setDraftAvatar(canvas.toDataURL('image/jpeg', 0.85))
        setEditorError('')
      }
      img.onerror = () => setEditorError('图片解析失败，请换一张')
      img.src = String(reader.result)
    }
    reader.onerror = () => setEditorError('图片读取失败，请重试')
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (saving) return
    const nickname = draftNickname.trim()
    if (!nickname) {
      setEditorError('昵称不能为空')
      return
    }
    if (nickname.length > NICKNAME_MAX) {
      setEditorError(`昵称不超过 ${NICKNAME_MAX} 个字`)
      return
    }
    setEditorError('')
    setSaving(true)
    try {
      await update({ nickname, avatar: draftAvatar })
      if (!aliveRef.current) return
      setEditorOpen(false)
      showToast('资料已保存')
    } catch (err) {
      if (!aliveRef.current) return
      setEditorError(err instanceof ApiError ? err.message : '保存失败，请稍后重试')
    } finally {
      if (aliveRef.current) setSaving(false)
    }
  }

  return (
    <div className="scroll-area bg-page">
      <div style={{ paddingBottom: 110 }}>
        {/* 头像区 */}
        <div className="px-5 pt-14 pb-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4 min-w-0">
              <Avatar value={displayAvatar} name={displayName} size={64} online />

              <div className="min-w-0">
                <h2 className="font-bold text-xl truncate" style={{ color: 'var(--text-1)', letterSpacing: '-0.01em' }}>
                  {displayName}
                </h2>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: 'var(--accent-weak)', color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                  >
                    NDT Lv.{stats?.level ?? 1}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {method ? `${method} 专项` : '未设置报考方向'}
                  </span>
                </div>
                {(account || org) && (
                  <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--text-3)' }}>
                    {account && <span>账号 {account}</span>}
                    {account && org && <span> · </span>}
                    {org && <span>{org}</span>}
                  </div>
                )}
              </div>
            </div>

            {canEdit && (
              <button
                onClick={openEditor}
                aria-label="修改昵称与头像"
                className="w-9 h-9 rounded-xl flex items-center justify-center tap flex-shrink-0"
                style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}
              >
                <PencilIcon size={16} color="var(--text-2)" />
              </button>
            )}
          </div>

          {/* 资料拉取失败：只提示，不挡住本地缓存的内容 */}
          {loadError && (
            <p className="text-[11px] mt-3" style={{ color: 'var(--err)' }}>{loadError}</p>
          )}

          {/* 经验条 */}
          <div className="mt-5">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs" style={{ color: 'var(--text-3)' }}>经验值</span>
              <span className="text-xs" style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {stats?.xp_in_level ?? 0} / {stats?.xp_level_max ?? 200} XP
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
              <div className="h-full rounded-full progress-fill" style={{ width: `${xpPct}%`, background: 'var(--accent)' }} />
            </div>
            <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>
              再答 {stats ? stats.xp_level_max - stats.xp_in_level : 200} 题升至 Lv.{(stats?.level ?? 1) + 1}
            </div>
          </div>
        </div>

        {/* 成就预览 */}
        <div className="px-4 mb-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>最近成就</h3>
              <button onClick={() => onNavigate('achievements')} className="text-xs tap" style={{ color: 'var(--text-3)' }}>
                全部 {achTotal} 个 <ChevronRightIcon size={12} />
              </button>
            </div>
            <div className="flex gap-3">
              {earnedAchs.map(ach => (
                <div key={ach.id} className="flex flex-col items-center gap-1.5 flex-1">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{ background: 'var(--accent-weak)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }}
                  >
                    <AchievementIcon icon={ach.icon} size={20} />
                  </div>
                  <span className="text-[9px] text-center leading-tight" style={{ color: 'var(--text-2)' }}>{ach.title}</span>
                </div>
              ))}
              {achievements.filter(a => !a.earned).slice(0, 2).map(ach => (
                <div key={ach.id} className="flex flex-col items-center gap-1.5 flex-1">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center opacity-50"
                    style={{ background: 'var(--track)', border: '1px solid var(--line)', color: 'var(--text-3)' }}
                  >
                    <AchievementIcon icon={ach.icon} size={20} />
                  </div>
                  <span className="text-[9px] text-center leading-tight" style={{ color: 'var(--text-3)' }}>{ach.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 错题集 / 成绩记录 / 观看历史（原底部「错题」Tab 功能移到这里） */}
        <div className="px-4 space-y-2 mb-5">
          {quickEntries(stats?.wrong_pending ?? 0).map(item => (
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

        {/* 菜单列表 */}
        <div className="px-4 space-y-2">
          {menuItems({
            totalMinutes,
            achEarned: stats?.ach_earned ?? earnedAchs.length,
            achTotal,
          }).map(item => (
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
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>NDT-劳人 v{APP_VERSION}</p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)', opacity: 0.7 }}>无损检测学习与考试训练平台</p>
        </div>
      </div>

      {/* ── 编辑资料面板 ── */}
      {editorOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={closeEditor} />
          <div
            className="relative w-full max-w-[430px] rounded-t-3xl px-5 pt-5 pb-10 anim-sheet-in"
            style={{
              background: 'var(--surface-raised)',
              border: '1px solid var(--line)',
              boxShadow: '0 -4px 24px rgba(27,30,35,0.08)',
              maxHeight: '88vh',
              overflowY: 'auto',
            }}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--hairline)' }} />
            </div>

            <div className="flex items-start justify-between mb-1">
              <h3 className="font-bold text-lg" style={{ color: 'var(--text-1)' }}>编辑个人资料</h3>
              <button
                onClick={closeEditor}
                aria-label="关闭"
                className="w-8 h-8 rounded-full flex items-center justify-center tap"
                style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)' }}
              >
                <XIcon size={15} color="var(--text-2)" />
              </button>
            </div>
            <p className="text-xs mb-5" style={{ color: 'var(--text-3)' }}>昵称与头像会保存到你的账号，换设备登录也在</p>

            {/* 预览 */}
            <div className="flex flex-col items-center mb-5">
              <Avatar value={draftAvatar} name={draftNickname} size={78} />
            </div>

            {/* 昵称 */}
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>昵称</label>
            <input
              className="w-full h-12 px-4 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-warm)', border: '1px solid var(--line)', color: 'var(--text-1)' }}
              type="text"
              maxLength={NICKNAME_MAX}
              placeholder="给自己起个名字"
              value={draftNickname}
              onChange={e => setDraftNickname(e.target.value)}
            />
            <div className="text-[10px] mt-1.5 mb-5" style={{ color: 'var(--text-3)' }}>
              最多 {NICKNAME_MAX} 个字 · 当前 {draftNickname.trim().length} 个
            </div>

            {/* 头像：预设 */}
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-2)' }}>选择头像</label>
            <div className="grid grid-cols-6 gap-2.5 mb-4">
              {AVATAR_PRESETS.map(preset => {
                const active = draftAvatar === preset.id
                return (
                  <button
                    key={preset.id}
                    onClick={() => setDraftAvatar(preset.id)}
                    title={preset.label}
                    aria-label={`头像：${preset.label}`}
                    className="flex items-center justify-center rounded-full tap"
                    style={{
                      padding: 2,
                      border: active ? '2px solid var(--accent)' : '2px solid transparent',
                      background: active ? 'var(--accent-weak)' : 'transparent',
                    }}
                  >
                    <Avatar value={preset.id} size={40} />
                  </button>
                )
              })}
            </div>

            {/* 头像：本地上传 */}
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-medium tap mb-1"
              style={{ background: 'var(--surface-warm)', border: '1px dashed var(--line-strong)', color: 'var(--text-2)' }}
            >
              <CameraIcon size={16} color="var(--text-2)" />
              从相册上传图片
            </button>
            <div className="text-[10px] mb-5" style={{ color: 'var(--text-3)' }}>
              支持 jpg / png，会自动裁剪成方形并压缩
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

            {editorError && (
              <p className="text-xs mb-3" style={{ color: 'var(--err)' }}>{editorError}</p>
            )}

            <div className="flex gap-3 mt-2">
              <button onClick={closeEditor} className="flex-1 h-12 gb gb-ghost rounded-2xl text-sm font-semibold">
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 h-12 gb gb-primary rounded-2xl text-sm font-semibold"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 z-[70] anim-slide-up">
          <div
            className="px-4 py-2.5 rounded-2xl text-sm font-medium"
            style={{ background: 'rgba(27,30,35,0.86)', color: '#fff', boxShadow: '0 8px 24px rgba(27,30,35,0.22)' }}
          >
            {toast}
          </div>
        </div>
      )}
    </div>
  )
}
