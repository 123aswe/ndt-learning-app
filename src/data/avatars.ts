/* ============================================================
   预设头像库 —— 与后端 server/profile_defaults.py 保持一致
   职责：
     1. 定义 12 个预设头像（emoji + 低饱和渐变底）
     2. 提供「值 → 预设」的解析与「是否本地上传图片」的判断
   值格式（存在 user_accounts.avatar 字段里）：
     "preset:1" ~ "preset:12"          预设头像，序号即本文件数组下标 + 1
     "data:image/...;base64,..."       本地上传（前端已压缩到 256×256）
     ""                                没设过，退化成「昵称首字」头像
   修改注意：
     - 新增 / 删除 / 调顺序时，后端 profile_defaults.AVATAR_PRESET_COUNT 要同步改，
       否则老账号的 preset:N 会解析不到（会退化成首字头像，不会报错）
     - 颜色用低饱和浅色，与 index.css 的令牌风格一致，不要用高饱和亮色
   ============================================================ */

export interface AvatarPreset {
  /** 存进数据库的值，格式 preset:<序号> */
  id: string
  /** 头像图案 */
  emoji: string
  /** 中文名，编辑面板的无障碍标签与提示用 */
  label: string
  /** 渐变起始色 */
  from: string
  /** 渐变结束色 */
  to: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'preset:1',  emoji: '🔬', label: '探头',   from: '#E6F1EF', to: '#C9E0DC' },
  { id: 'preset:2',  emoji: '📐', label: '量角尺', from: '#EDEBF6', to: '#D6D2EA' },
  { id: 'preset:3',  emoji: '🧭', label: '方向',   from: '#E9EFF6', to: '#CBDCEB' },
  { id: 'preset:4',  emoji: '🛠️', label: '工具',   from: '#F2EEE6', to: '#E2D8C3' },
  { id: 'preset:5',  emoji: '🔩', label: '螺栓',   from: '#EDEFF2', to: '#D5DAE0' },
  { id: 'preset:6',  emoji: '📊', label: '数据',   from: '#E8F0EC', to: '#CDE2D5' },
  { id: 'preset:7',  emoji: '🎯', label: '目标',   from: '#F6EDEC', to: '#EBD5D3' },
  { id: 'preset:8',  emoji: '⚡', label: '闪电',   from: '#F6F1E6', to: '#EBDFC2' },
  { id: 'preset:9',  emoji: '🧠', label: '思考',   from: '#F2EAF0', to: '#E3D2DE' },
  { id: 'preset:10', emoji: '🏆', label: '奖杯',   from: '#F5EFE4', to: '#E9DBBE' },
  { id: 'preset:11', emoji: '🌟', label: '星标',   from: '#F1F0E6', to: '#E0DFC4' },
  { id: 'preset:12', emoji: '🚀', label: '出发',   from: '#E9EEF5', to: '#CCD9E9' },
]

/** 预设头像个数（与后端 profile_defaults.AVATAR_PRESET_COUNT 一致） */
export const AVATAR_PRESET_COUNT = AVATAR_PRESETS.length

const PRESET_MAP = new Map(AVATAR_PRESETS.map((p) => [p.id, p]))

/** 解析预设头像；不是预设值（或序号越界）时返回 undefined */
export function getAvatarPreset(value: string | undefined): AvatarPreset | undefined {
  if (!value) return undefined
  return PRESET_MAP.get(value)
}

/** 是否是本地上传的图片（data URL 或 http 链接），这类值直接当 <img> 渲染 */
export function isUploadedAvatar(value: string | undefined): boolean {
  if (!value) return false
  return value.startsWith('data:image/') || value.startsWith('http')
}

/** 随机一个预设头像值（前端兜底用；正式随机值由后端建号时生成） */
export function randomAvatarValue(): string {
  return `preset:${Math.floor(Math.random() * AVATAR_PRESET_COUNT) + 1}`
}
