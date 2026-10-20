/* ============================================================
   API 客户端 —— 前端唯一与 Python 服务通信的出口
   - 职责：统一基址、统一带令牌、统一错误文案、登录态存取
   - 修改注意：
     1. 其它页面不要自己写 fetch，一律走本文件的 apiRequest
        （唯一例外：src/api/realtime.ts 的 SSE 长连接，它需要流式读取，不能用 apiRequest）
     2. 开发环境下 /api 由 vite.config.ts 代理到 Python 服务（默认 127.0.0.1:8000）
     3. 登录与注册用「图形验证码」，不再使用手机短信验证码
     4. 登录态变化会广播 window 事件 'ndt:session-changed'
        （realtime.ts 靠它决定「登录后连实时通道 / 退出后断开」）
     5. 本地持久化三类东西，都在这一个文件里存取：登录态（token / identity / profile）、
        设备引导标记（ndt_onboarded）、上次停留的页面（ndt_last_view）。
        页面快照的序列化与还原在 App.tsx（本文件只管读写，不认页面结构）
   ============================================================ */

/** 接口基址：开发走 Vite 代理的 /api；生产可用 VITE_API_BASE 指定完整地址 */
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api'

/**
 * 管理后台地址 —— 登录页「管理员登录」入口用。
 *
 * 后台页面由 Python 服务托管在 `/admin/`，和接口同源，所以地址要分三种情况推导：
 *   - 配了 VITE_API_BASE 绝对地址 → 取它的源（去掉 /api 后缀）
 *   - 开发态：前端跑在 8443、后端跑在 8000，`/admin/` 在 Vite 上是 404，必须显式指向后端端口
 *   - 生产 / 公网（内网穿透）：与接口同源，相对路径最稳，跟着当前域名走
 */
export function adminConsoleUrl(): string {
  if (/^https?:\/\//i.test(API_BASE)) {
    return API_BASE.replace(/\/api\/?$/i, '') + '/admin/'
  }
  if (import.meta.env.DEV) return 'http://127.0.0.1:8000/admin/'
  return '/admin/'
}

/**
 * 官网地址 —— 设置页「通用 → 官网」入口用。
 *
 * 官网由 Python 服务托管在根路径 `/`（App 挂在 /app/ 子路径），推导规则同 adminConsoleUrl：
 *   - 生产 / 公网（内网穿透）：与当前页面同源，跟着域名走，隧道换了地址也不用改代码
 *   - 开发态：Vite 服务器上没有官网，指向本地后端 8000
 */
export function officialSiteUrl(): string {
  if (/^https?:\/\//i.test(API_BASE)) {
    return API_BASE.replace(/\/api\/?$/i, '') + '/'
  }
  if (import.meta.env.DEV) return 'http://127.0.0.1:8000/'
  return '/'
}

const TOKEN_KEY = 'ndt_token'
const IDENTITY_KEY = 'ndt_identity'
const PROFILE_KEY = 'ndt_profile'
/** 「这台设备用过 App」标记：置 1 后再也不显示引导页（清除缓存也不清它） */
const ONBOARDED_KEY = 'ndt_onboarded'
/** 「上次停留的页面」记忆：刷新 / 重开 App 回到同一页，不再一律回首页 */
const LAST_VIEW_KEY = 'ndt_last_view'

/** 登录态变化的广播事件名（saveSession / clearSession 各发一次） */
export const SESSION_CHANGED_EVENT = 'ndt:session-changed'

export type Identity = 'admin' | 'user'

export interface SessionProfile {
  /** 考生登录账号（自定义账号，4-20 位字母/数字/下划线） */
  account?: string
  nickname?: string
  /** 头像值：preset:N（预设）或 data:image/...（本地上传）；空 = 用昵称首字 */
  avatar?: string
  real_name?: string
  /** 单位 / 学校 */
  org?: string
  method?: string
  username?: string
  role?: string
  [key: string]: unknown
}

/* ── 登录态存取 ──────────────────────────────────────────── */

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function getIdentity(): Identity | null {
  const value = localStorage.getItem(IDENTITY_KEY)
  return value === 'admin' || value === 'user' ? value : null
}

export function getProfile(): SessionProfile | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null')
  } catch {
    return null
  }
}

export function saveSession(token: string, identity: Identity, profile: SessionProfile) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(IDENTITY_KEY, identity)
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  triggerSessionChanged()
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(IDENTITY_KEY)
  localStorage.removeItem(PROFILE_KEY)
  triggerSessionChanged()
}

/** 广播「登录态变了」：实时通道据此自动连上 / 断开（见 src/api/realtime.ts） */
function triggerSessionChanged() {
  window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT))
}

/** 只更新本地缓存的用户资料（改完昵称/头像后调用，保证刷新页面也显示最新值） */
export function patchSavedProfile(patch: Partial<SessionProfile>): SessionProfile {
  const merged = { ...(getProfile() || {}), ...patch }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(merged))
  return merged
}

/** 本地是否已登录（有令牌 + 身份）。真实有效性由服务端令牌决定（见 deps.py 的 15 天有效期） */
export function isLoggedIn(): boolean {
  return !!getToken() && getIdentity() !== null
}

/* ── 引导页标记（只在「没用过这台设备」时出现） ───────────── */

export function hasUsedApp(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return false // 隐私模式读不了 localStorage：按新用户处理，多看一眼引导页而已
  }
}

export function markAppUsed(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, '1')
  } catch {
    /* 写不了就忽略：只影响下次是否再显示引导页 */
  }
}

/* ── 页面记忆（刷新 / 重开 App 停在原页面） ─────────────────── */

/** 读上次停留的页面快照；没有或解析失败返回 null（调用方自己决定回哪一页） */
export function readRememberedView<T = unknown>(): T | null {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** 记下当前页面（切页 / 切 Tab 时调；快照结构由 App.tsx 决定） */
export function rememberView(snapshot: unknown): void {
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(snapshot))
  } catch {
    /* 写不了就忽略：只影响刷新后回到哪一页 */
  }
}

/** 忘记上次停留的页面（退出登录时调：下次登录从首页开始） */
export function forgetView(): void {
  try {
    localStorage.removeItem(LAST_VIEW_KEY)
  } catch {
    /* 忽略 */
  }
}

/* ── 请求封装 ────────────────────────────────────────────── */

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** 是否带上登录令牌，默认带 */
  auth?: boolean
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // 不做 HTTP 缓存：接口数据一律取最新的。
      // 不加的话手机浏览器会按启发式规则缓存小响应体，
      // 之后每次进页面就先用旧数据渲染再静默重发一次请求，看着像「没下拉也一直在刷新」。
      cache: 'no-store',
    })
  } catch {
    throw new ApiError('无法连接服务器，请确认后端服务已启动', 0)
  }

  let data: any = null
  try {
    data = await response.json()
  } catch {
    /* 无响应体，忽略 */
  }

  if (!response.ok) {
    let message = `请求失败（${response.status}）`
    if (data && typeof data.detail === 'string') message = data.detail
    else if (data && Array.isArray(data.detail) && data.detail.length) {
      message = data.detail.map((d: any) => d.msg || '参数不合法').join('；')
    } else if (data && typeof data.message === 'string') message = data.message

    // 令牌失效：清掉本地登录态，并广播「会话已失效」事件
    // （App.tsx 监听后自动退回登录页；典型场景：管理员重置密码后踢掉该考生全部会话）
    if (response.status === 401) {
      clearSession()
      window.dispatchEvent(new CustomEvent('ndt:session-expired'))
    }
    throw new ApiError(message, response.status)
  }

  return data as T
}

/* ── 认证相关接口 ────────────────────────────────────────── */

export interface PasswordLoginResult {
  token: string
  expires_at: string
  identity: Identity
  admin?: SessionProfile
  user?: SessionProfile
  /** 单端登录：该账号已在其他设备登录时不发令牌，conflict=true，需用户「同意 / 拒绝」后带 force 重登 */
  conflict?: boolean
  message?: string
}

export interface CaptchaResult {
  /** 本次验证码的 id，提交表单时要一起回传 */
  captcha_id: string
  /** data:image/svg+xml;base64,... 直接用于 <img src> */
  image: string
  ttl_seconds: number
}

export interface RegisterPayload {
  account: string
  password: string
  confirm_password: string
  org: string
  captcha_id: string
  captcha_code: string
}

export interface RegisterResult {
  ok: boolean
  message: string
  registration: { id: number; account: string; status: string }
}

export const authApi = {
  /** 生成一张图形验证码（注册用） */
  captcha: () => apiRequest<CaptchaResult>('/auth/captcha', { auth: false }),

  /** 提交注册申请（提交后需等待管理员审核通过才能登录） */
  register: (payload: RegisterPayload) =>
    apiRequest<RegisterResult>('/auth/register', { method: 'POST', auth: false, body: payload }),

  /** 账号 + 密码登录（管理员或考生，自动识别身份）。
   *  force=true 表示确认顶掉其他设备上的旧会话（仅在首次登录返回 conflict 后使用）。 */
  passwordLogin: (account: string, password: string, force = false) =>
    apiRequest<PasswordLoginResult>('/auth/password/login', {
      method: 'POST',
      auth: false,
      body: { account, password, force },
    }),

  /** 退出登录 */
  logout: () => apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
}

/* ── 考生个人资料接口 ────────────────────────────────────── */

export interface UserProfile {
  id: number
  account: string
  nickname: string
  avatar: string
  org: string
  real_name: string
  method: string
  status: number
  has_password?: boolean
  created_at?: string
  last_login_at?: string | null
  [key: string]: unknown
}

export interface ProfileUpdatePayload {
  nickname?: string
  /** 预设 "preset:N"、本地上传的 data URL，或空字符串（恢复首字头像） */
  avatar?: string
}

export const profileApi = {
  /** 取当前登录考生的资料 */
  get: () => apiRequest<UserProfile>('/user/profile'),

  /** 修改自己的昵称 / 头像（只能改自己的） */
  update: (payload: ProfileUpdatePayload) =>
    apiRequest<UserProfile>('/user/profile', { method: 'PUT', body: payload }),
}

/* ── 账号安全（自助改密码 / 改登录账号） ──────────────────── */

export interface ChangePasswordResult {
  ok: boolean
  message: string
}

export interface ChangeAccountResult {
  ok: boolean
  message: string
  user: UserProfile
}

export const securityApi = {
  /** 修改自己的登录密码（需原密码）；成功后后端会踢掉本人所有会话 */
  changePassword: (old_password: string, new_password: string, confirm_password: string) =>
    apiRequest<ChangePasswordResult>('/user/password', {
      method: 'POST',
      body: { old_password, new_password, confirm_password },
    }),

  /** 修改自己的登录账号（需登录密码）；成功后返回新账号 */
  changeAccount: (new_account: string, password: string) =>
    apiRequest<ChangeAccountResult>('/user/account', {
      method: 'POST',
      body: { new_account, password },
    }),
}

/* ── 通知中心（考生端） ──────────────────────────────────── */

export type ApiNotificationType = 'system' | 'notice'

export interface NotificationItem {
  id: number
  type: ApiNotificationType
  title: string
  content: string
  sender: string
  /** 后端时间字符串："2026-09-29 16:20:00" */
  created_at: string
  read: boolean
  /** 系统通知为 false（考生不可删除） */
  deletable: boolean
}

export interface NotificationListResult {
  items: NotificationItem[]
  unread: number
  total: number
}

export const notificationApi = {
  /** 我的通知列表（管理员发送的通知都在这里） */
  list: () => apiRequest<NotificationListResult>('/user/notifications'),

  /** 标记一条已读 */
  markRead: (id: number) =>
    apiRequest<{ ok: boolean }>(`/user/notifications/${id}/read`, { method: 'POST' }),

  /** 全部标记已读 */
  markAllRead: () =>
    apiRequest<{ ok: boolean; count: number }>('/user/notifications/read-all', { method: 'POST' }),

  /** 删除一条（系统通知后端会返回 403） */
  remove: (id: number) =>
    apiRequest<{ ok: boolean; message: string }>(`/user/notifications/${id}`, { method: 'DELETE' }),
}

/* ── 密码重置申请（考生端，无需登录） ────────────────────── */

export interface PasswordResetApplyResult {
  ok: boolean
  reset_id: number
  message: string
}

export const resetApi = {
  /** 提交「忘记密码」申请：账号 + 邮箱，管理员后台处理后把新密码发到通知中心 */
  apply: (account: string, email: string) =>
    apiRequest<PasswordResetApplyResult>('/auth/password-reset', {
      method: 'POST',
      auth: false,
      body: { account, email },
    }),
}

/* ── 版本更新 ────────────────────────────────────────────── */

export interface AppVersionInfo {
  latest_version: string
  published_at: string
  notes: string[]
  download_url: string
  force: boolean
}

export const appApi = {
  /** 检查更新：取服务端最新版本信息（无需登录） */
  version: () => apiRequest<AppVersionInfo>('/app/version', { auth: false }),
}

/* ── 题库（考生只读，题库内容保存在服务端数据库） ────────── */

export interface BankOption {
  key: string
  text: string
}

/** 题型代码（与 server/modules/bank.py QTYPE_NAMES 一致）
 *  judge 判断 / single 选择 / multi 多选 / calc 计算 / calcsel 计算选择 / short 简答 */
export type QuestionQtype = 'judge' | 'single' | 'multi' | 'calc' | 'calcsel' | 'short' | (string & {})

/** 一道题（来自服务端 questions 表） */
export interface BankQuestion {
  id: number
  method: string
  grade: string
  qtype: QuestionQtype
  topic: string
  sub_topic: string
  content: string
  options: BankOption[]
  answer: string
  /** 「题目原题讲解」的解答过程（管理员在题库里填写，可含插图标记 [[img:xxx]]）。
   *  为空 = 考生端让 AI 分步生成（并标注仅供参考）。考试开卷时不返回该字段。 */
  explanation?: string
  /** 我最近一次在这道题上的作答结果（对/错），一直保留到清除记录 */
  my_state?: QuestionMyState
}

export interface BankMethodSummary {
  method: string
  name: string
  count: number
  /** 我在这个方向已做过的题数（去重） */
  answered: number
}

/** 题型分布一行：某方向某题型的题量（随机刷题选择器据此显示/置灰） */
export interface QtypeCount {
  method: string
  qtype: string
  count: number
}

export interface BankSummary {
  total: number
  methods: BankMethodSummary[]
  /** 方向 × 题型 题量矩阵（v1.11 新增） */
  qtype_counts: QtypeCount[]
}

export interface BankSearchItem {
  id: number
  method: string
  qtype_label: string
  topic: string
  content: string
}

/** 管理员在后台创建的题库（考生端题库页列表） */
export interface BankSet {
  id: number
  name: string
  /** 级别：一级 / 二级 / 三级 / 自定义文本（可空） */
  level: string
  /** 方向/类型：'' 通用 / UT / RT / MT / PT / ET / VT / 综合（后台题库列表按此筛选；考生端暂未使用） */
  method?: string
  description: string
  /** 所属题库系列（0 = 散题库，考生端归到「其他题库」） */
  series_id: number
  series_name: string
  /** 管理员给这套题库上传过封面（没有则用图标水印） */
  has_cover: boolean
  /** 题库里的章节数（后台自己建的章节） */
  chapter_count: number
  total: number
  /** 题型 → 题量（judge/single/calc/short） */
  qtype_counts: Record<string, number>
  created_at: string
}

/** 题库系列（题库页最外一层分组，如「二级 UT 题库系列」） */
export interface BankSeries {
  id: number
  name: string
  level: string
  /** 方向：'' 通用 / UT / RT / MT / PT / ET / VT / 综合 */
  method: string
  description: string
  has_cover: boolean
  /** 系列下题库数 */
  bank_count: number
  /** 系列下题目总数 */
  total: number
  created_at: string
}

/** 某套题库里的章节（练习面板「按章节」用；tagged=false 表示按知识点自动分组的老题） */
export interface BankSetChapter {
  id: number
  chapter_id: number
  name: string
  description: string
  count: number
  answered: number
  tagged: boolean
}

/**
 * 题目插图地址 —— 题干 / 选项 / 答案解析里 `[[img:qimg_xxx.png]]` 标记取图用。
 *
 * 令牌走 ?token= 查询参数：浏览器加载 <img src> 时带不了 Authorization 头，
 * 与封面图同一口径（见 server/modules/question_images.py）。
 * 解析与渲染统一在 src/data/richText.ts + src/components/RichText.tsx。
 */
export function questionImageUrl(name: string): string {
  return `${API_BASE}/bank/question-images/${encodeURIComponent(name)}?token=${encodeURIComponent(getToken())}`
}

export const bankApi = {
  /** 题库概览：各方向题量 + 我已做题量（首页推荐训练 / 题库页用） */
  summary: () => apiRequest<BankSummary>('/bank/summary'),

  /** 管理员创建的题库列表（只返回有题的；题库页「题库」区数据源，可按系列筛选） */
  sets: (seriesId?: number) =>
    apiRequest<{ items: BankSet[] }>(
      seriesId ? `/bank/sets?series_id=${seriesId}` : '/bank/sets',
    ),

  /** 题库系列列表（只返回下面有题库的系列；题库页系列卡数据源） */
  series: () => apiRequest<{ items: BankSeries[] }>('/bank/series'),

  /** 题库系列封面地址（没设置封面时返回 404，前端回落图标水印） */
  seriesCoverUrl: (seriesId: number) =>
    `${API_BASE}/bank/series/${seriesId}/cover?token=${encodeURIComponent(getToken())}`,

  /** 题库封面地址（没设置封面时 404，前端回落图标水印） */
  setCoverUrl: (setId: number) =>
    `${API_BASE}/bank/sets/${setId}/cover?token=${encodeURIComponent(getToken())}`,

  /** 题目插图地址（题干 / 选项 / 答案解析里 [[img:xxx]] 标记靠它取图，渲染统一走 RichText） */
  questionImageUrl: (name: string) => questionImageUrl(name),

  /** 某套题库的章节（练习面板「按章节」数据源；qtype 可选题型过滤） */
  setChapters: (setId: number, qtype?: string) => {
    const p = new URLSearchParams()
    if (qtype) p.set('qtype', qtype)
    return apiRequest<{ items: BankSetChapter[] }>(
      `/bank/sets/${setId}/chapters${p.toString() ? '?' + p.toString() : ''}`,
    )
  },

  /** 搜索题目（题干 / 知识点模糊匹配，只读） */
  search: (q: string, limit = 30) =>
    apiRequest<{ total: number; items: BankSearchItem[] }>(
      `/bank/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),

  /** 章节列表（按知识点分组，「按章节练习」入口用；qtype 可选题型过滤） */
  chapters: (category: string, qtype?: string) => {
    const p = new URLSearchParams({ category })
    if (qtype) p.set('qtype', qtype)
    return apiRequest<{ items: BankChapter[] }>(`/bank/chapters?${p.toString()}`)
  },
}

/* ── 练习（出题 / 交卷） ─────────────────────────────────── */

export type PracticeMode = 'sequential' | 'random' | 'wrong'

/** 一次练习的入口参数：方向 + 可选章节 + 第几组（每组 20 题） */
export interface PracticeEntry {
  category: string
  /** 章节名（topic1），按章节练习时传 */
  topic?: string
  /** 第几组（0 起），顺序练习分块用 */
  block?: number
  /** 出题方式：sequential 顺序（默认）/ random 随机 / wrong 错题重练 */
  mode?: PracticeMode
  /** 题型筛选：judge 判断 / single 选择 / calc 计算 / short 简答（空 = 不限） */
  qtype?: string
  /** 管理员创建的题库 id（传了就忽略 category/topic） */
  setId?: number
}

/** 我在某道题上的最近作答状态（保留到清除记录为止） */
export type QuestionMyState = 'correct' | 'wrong' | null

/** 保存的练习进度（续做：题目顺序快照 + 当前题号 + 已答界面快照） */
export interface PracticeProgress {
  has_progress: boolean
  question_ids?: number[]
  answers?: Record<number, { selected: string; correct: boolean }>
  current_index?: number
  updated_at?: string
}

/** 保存进度的请求体（范围参数 + 题目快照 + 当前题号） */
export interface PracticeProgressPayload {
  category: string
  topic?: string
  qtype?: string
  set_id?: number
  mode?: PracticeMode
  question_ids: number[]
  answers: Record<number, { selected: string; correct: boolean }>
  current_index: number
}

export interface PracticeQuestionsResult {
  /** 范围（方向+章节）内题目总数 */
  total_in_scope: number
  block_index: number
  block_count: number
  questions: BankQuestion[]
}

export interface PracticeBlockStat {
  block: number
  count: number
  answered: number
  correct: number
  wrong: number
}

export interface PracticeBlocksResult {
  total: number
  block_size: number
  block_count: number
  blocks: PracticeBlockStat[]
}

export interface BankChapter {
  topic: string
  count: number
  answered: number
}

export interface PracticeAnswerPayload {
  question_id: number
  user_answer: string
  is_correct: boolean
}

export interface PracticeSubmitResult {
  saved: number
  correct: number
  total: number
}

/** 成绩记录：一次练习/交卷 = 一条（按 session 分组，按完成时间倒序） */
export interface PracticeSessionRecord {
  session_id: string
  finished_at: string
  category: string
  category_name: string
  total: number
  correct: number
  accuracy: number
  duration_seconds: number
  /** 模拟考试附加字段（练习记录为 false / null） */
  is_exam?: boolean
  score?: number | null
  exam_title?: string
}

export const practiceApi = {
  /** 取一组练习题（category 传方向代码，'综合' = 全部方向；topic=章节；block=第几组；
   *  qtype=judge|single|calc|short 按题型筛选；setId=自定义题库 id） */
  questions: (category: string, mode: PracticeMode = 'sequential', limit = 20, opts?: { topic?: string; block?: number; qtype?: string; setId?: number }) => {
    const p = new URLSearchParams({
      category,
      mode,
      limit: String(limit),
    })
    if (opts?.topic) p.set('topic', opts.topic)
    if (opts?.block != null) p.set('block', String(opts.block))
    if (opts?.qtype) p.set('qtype', opts.qtype)
    if (opts?.setId) p.set('set_id', String(opts.setId))
    return apiRequest<PracticeQuestionsResult>(`/practice/questions?${p.toString()}`)
  },

  /** 分块列表：每组未做/对/错（题库页「选择练习方式」面板用） */
  blocks: (category: string, topic?: string, limit = 20, setId?: number, qtype?: string) => {
    const p = new URLSearchParams({ category, limit: String(limit) })
    if (topic) p.set('topic', topic)
    if (setId) p.set('set_id', String(setId))
    if (qtype) p.set('qtype', qtype)
    return apiRequest<PracticeBlocksResult>(`/practice/blocks?${p.toString()}`)
  },

  /** 清除做题记录（重新做）：block 省略 = 清除整个范围（题库 / 方向 / 章节 / 题型） */
  reset: (category: string, topic?: string, setId?: number, qtype?: string) =>
    apiRequest<{ ok: boolean; cleared: number; message: string }>('/practice/reset', {
      method: 'POST',
      body: { category, topic: topic || '', set_id: setId || 0, qtype: qtype || '' },
    }),

  /** 交卷：保存本次练习的答题记录（按登录账号入库，换设备也在） */
  submit: (category: string, durationSeconds: number, answers: PracticeAnswerPayload[]) =>
    apiRequest<PracticeSubmitResult>('/practice/submit', {
      method: 'POST',
      body: { category, duration_seconds: durationSeconds, answers },
    }),

  /** 读取我的练习进度（续做；没有进度返回 has_progress=false） */
  getProgress: (category: string, opts?: { topic?: string; qtype?: string; setId?: number; mode?: PracticeMode }) => {
    const p = new URLSearchParams({ category, mode: opts?.mode || 'sequential' })
    if (opts?.topic) p.set('topic', opts.topic)
    if (opts?.qtype) p.set('qtype', opts.qtype)
    if (opts?.setId) p.set('set_id', String(opts.setId))
    return apiRequest<PracticeProgress>(`/practice/progress?${p.toString()}`)
  },

  /** 保存我的练习进度（每次答题/跳题后调用，服务器续做） */
  saveProgress: (payload: PracticeProgressPayload) =>
    apiRequest<{ ok: boolean; message: string }>('/practice/progress', {
      method: 'POST',
      body: payload,
    }),

  /** 删除我的练习进度（清除记录 / 交卷完成时调用，只删这一条） */
  deleteProgress: (category: string, opts?: { topic?: string; qtype?: string; setId?: number; mode?: PracticeMode }) => {
    const p = new URLSearchParams({ category, mode: opts?.mode || 'sequential' })
    if (opts?.topic) p.set('topic', opts.topic)
    if (opts?.qtype) p.set('qtype', opts.qtype)
    if (opts?.setId) p.set('set_id', String(opts.setId))
    return apiRequest<{ ok: boolean; deleted: number; message: string }>(`/practice/progress?${p.toString()}`, {
      method: 'DELETE',
    })
  },

  /** 成绩记录：按练习会话分组的历史成绩（「我的 → 成绩记录」页数据源） */
  history: (limit = 50) =>
    apiRequest<{ items: PracticeSessionRecord[] }>(`/user/practice/history?limit=${limit}`),

  /** 单次成绩回看：该次会话的完整试卷（考试/练习同一结构，见 SessionDetail） */
  sessionDetail: (sessionId: string) =>
    apiRequest<SessionDetail>(`/user/practice/history/${sessionId}`),

  /** 删除一条成绩记录（考试连 exams/exam_answers 一起删；统计/错题口径随之更新） */
  deleteSession: (sessionId: string) =>
    apiRequest<{ ok: boolean; deleted: number; message: string }>(`/user/practice/history/${sessionId}`, {
      method: 'DELETE',
    }),
}

/* ── 模拟考试（开卷 / 交卷 / 试卷回看） ──────────────────── */

/** 考试卷面题目：不带正确答案（服务端判分，防前端偷看） */
export interface ExamQuestion {
  id: number
  method: string
  grade: string
  qtype: QuestionQtype
  topic: string
  sub_topic: string
  content: string
  options: BankOption[]
}

/** 一次开卷的返回：题面 + 考试元信息 */
export interface ExamStartResult {
  exam_id: string
  title: string
  category: string
  category_name: string
  qtype: string
  duration_minutes: number
  total: number
  questions: ExamQuestion[]
}

export interface ExamAnswerPayload {
  question_id: number
  user_answer: string
}

/** 交卷结果（成绩 / 结果页数据源） */
export interface ExamSubmitResult {
  exam_id: string
  title: string
  category: string
  category_name: string
  qtype: string
  qtype_name: string
  duration_minutes: number
  total: number
  correct: number
  wrong: number
  score: number
  time_used: number
  auto_submitted: boolean
  status: string
  started_at: string
  finished_at: string
}

/** 试卷回看的一题：带正确答案 + 我的答案（未作答 my_answer 为空、is_correct 为 null） */
export interface ExamDetailItem extends BankQuestion {
  my_answer: string
  is_correct: boolean | null
}

/** 一次会话（考试或练习）的完整试卷回看数据：成绩摘要 + 逐题明细 */
export interface SessionDetail extends ExamSubmitResult {
  items: ExamDetailItem[]
}

export const examApi = {
  /** 开卷：随机抽题创建一场考试（category=方向/综合；set_id=自定义题库；set_ids=多题库合集（系列全部）；qtype 空为不限） */
  start: (payload: { category?: string; set_id?: number; set_ids?: number[]; qtype?: string; count: number; duration_minutes: number }) =>
    apiRequest<ExamStartResult>('/exam/start', { method: 'POST', body: payload }),

  /** 交卷：服务端判分；auto=true 表示倒计时到点自动交卷；幂等（重复提交返回已有结果） */
  submit: (examId: string, timeUsedSeconds: number, answers: ExamAnswerPayload[], auto = false) =>
    apiRequest<ExamSubmitResult>('/exam/submit', {
      method: 'POST',
      body: { exam_id: examId, time_used_seconds: timeUsedSeconds, auto, answers },
    }),

  /** 试卷回看：完整题目 + 正确答案 + 我的答案 */
  detail: (examId: string) => apiRequest<SessionDetail>(`/exam/records/${examId}`),
}

/* ── 资料库（标准规范 / 教材 / 辅导资料 / 视频课程，管理员后台上传） ── */

export interface MaterialItem {
  id: number
  title: string
  category: 'standard' | 'textbook' | 'material' | 'video' | string
  category_name: string
  method: string
  description: string
  /** pdf / video / doc —— 决定打开方式（新标签页预览 / 应用内播放器 / 下载） */
  kind: 'pdf' | 'video' | 'doc' | string
  /** 所属系列 id；0 = 未归系列的散资料（考生端归到「未归系列」分组） */
  series_id: number
  /** 所属系列名（散资料为空串） */
  series_name: string
  file_name: string
  file_size: number
  mime: string
  created_at: string
  /** 管理员是否上传了自定义封面；false = 考生端自动取视频首帧 */
  has_cover: boolean
  /** 播放量（每次打开 +1） */
  view_count: number
  /** 收藏数 */
  fav_count: number
  /** 我是否已收藏 */
  favorited: boolean
  /** 评论数（详情/管理端列表返回） */
  comment_count?: number
  /** 我的收藏列表里附带：收藏时间 */
  favorited_at?: string
  /** 观看历史列表里附带：我最近一次观看时间 */
  watched_at?: string
  /** 观看历史列表里附带：我看过几次 */
  my_view_count?: number
}

/** 资料系列（大类下面的分组，如「UT 培训视频合集」） */
export interface MaterialSeries {
  id: number
  title: string
  category: 'standard' | 'textbook' | 'material' | 'video' | string
  category_name: string
  method: string
  description: string
  /** 管理员是否设置了系列封面；false = 用图标水印占位 */
  has_cover: boolean
  created_by: string
  created_at: string
  /** 系列内的资料数 */
  item_count: number
}

/** 视频评论（详情页评论区 / 后台评论管理共用） */
export interface MaterialComment {
  id: number
  material_id: number
  user_id: number
  nickname: string
  /** 头像值：preset:N / data URL；空 = 昵称首字 */
  avatar: string
  content: string
  /** 楼中楼：0 = 顶层评论；>0 = 所属根评论 id（回复挂在根评论下） */
  parent_id: number
  /** 被回复人昵称（展示「回复 @xx」）；顶层评论为空 */
  reply_to: string
  created_at: string
  /** 是否本人发表（本人可删） */
  is_mine?: boolean
  /** 以下仅顶层评论（评论列表接口返回时带上） */
  reply_count?: number
  replies?: MaterialComment[]
}

export const libraryApi = {
  /** 资料列表（category 空 = 全部，按上传时间倒序），带播放量/收藏数/我是否收藏/所属系列 */
  list: (category = '') =>
    apiRequest<{ items: MaterialItem[] }>(`/library${category ? `?category=${encodeURIComponent(category)}` : ''}`),

  /** 只看某个系列内的资料（系列详情页数据源） */
  seriesItems: (seriesId: number) =>
    apiRequest<{ items: MaterialItem[] }>(`/library?series_id=${seriesId}`),

  /** 系列列表（大类页系列卡数据源，带每个系列的资料数） */
  series: (category = '') =>
    apiRequest<{ items: MaterialSeries[] }>(
      `/library/series${category ? `?category=${encodeURIComponent(category)}` : ''}`,
    ),

  /** 系列封面地址（没设置封面时该地址返回 404，前端回落图标水印） */
  seriesCoverUrl: (seriesId: number) =>
    `${API_BASE}/library/series/${seriesId}/cover?token=${encodeURIComponent(getToken())}`,

  /** 文件地址：给 <video src> / window.open 用 —— 令牌放在查询参数（标签带不了请求头） */
  fileUrl: (id: number) => `${API_BASE}/library/${id}/file?token=${encodeURIComponent(getToken())}`,

  /** PDF 切片信息：sliced=true 表示可以走「单页翻阅」（一次只取一页，首屏 ~300KB） */
  pages: (id: number) => apiRequest<{ sliced: boolean; count: number; sizes: number[] }>(`/library/${id}/pages`),

  /** 第 n 页（1 起）单页 PDF 的地址：交给 pdf.js 打开，只需一个请求
   *  （Office 资料也是这个地址：后端把转换出来的 PDF 当成分页源，前端不用区分） */
  pageUrl: (id: number, page: number) =>
    `${API_BASE}/library/${id}/page/${page}?token=${encodeURIComponent(getToken())}`,

  /** 文档预览准备状态。kind：
   *    pdf      → 走 pdf.js
   *    office   → 后端正在（或已经）把 doc/ppt/pptx 转成 PDF，看 state 轮询
   *    frontend → docx / xlsx / csv / txt，前端自己渲染
   *    other    → 只能「本地打开」
   *  office 类型**调用即触发后台转换**（幂等），轮询到 state=ready 后走翻页接口 */
  preview: (id: number) =>
    apiRequest<{ kind: 'pdf' | 'office' | 'frontend' | 'other'; state: string; pages: number; message: string }>(
      `/library/${id}/preview`,
    ),

  /** 预览用 PDF 整份地址（切片不可用时的兜底）：PDF 资料给原件，Office 资料给转换产物 */
  previewFileUrl: (id: number) =>
    `${API_BASE}/library/${id}/preview-file?token=${encodeURIComponent(getToken())}`,

  /** 管理员自定义封面地址（没有封面时该地址返回 404，前端回落为视频首帧） */
  coverUrl: (id: number) => `${API_BASE}/library/${id}/cover?token=${encodeURIComponent(getToken())}`,

  /** 资料详情（视频详情页数据源） */
  detail: (id: number) => apiRequest<MaterialItem>(`/library/${id}`),

  /** 我的收藏（视频，按收藏时间倒序） */
  favorites: () => apiRequest<{ items: MaterialItem[] }>('/library/favorites'),

  /** 观看历史（我看过的视频，按最近观看倒序，同一视频只保留最近一次） */
  history: (limit = 100) => apiRequest<{ items: MaterialItem[] }>(`/library/history?limit=${limit}`),

  /** 从观看历史移除某条（隐藏标记，不影响播放量） */
  removeHistory: (id: number) =>
    apiRequest<{ ok: boolean; removed: number; message: string }>(`/library/history/${id}`, { method: 'DELETE' }),

  /** 清空观看历史（隐藏标记，不影响播放量） */
  clearHistory: () =>
    apiRequest<{ ok: boolean; removed: number; message: string }>('/library/history', { method: 'DELETE' }),

  /** 记一次播放，返回最新播放量 / 收藏数 */
  recordView: (id: number) =>
    apiRequest<{ ok: boolean; view_count: number; fav_count: number }>(`/library/${id}/view`, { method: 'POST' }),

  /** 收藏 / 取消收藏，返回最新收藏数 */
  favorite: (id: number) =>
    apiRequest<{ ok: boolean; favorited: boolean; fav_count: number; message: string }>(
      `/library/${id}/favorite`,
      { method: 'POST' },
    ),
  unfavorite: (id: number) =>
    apiRequest<{ ok: boolean; favorited: boolean; fav_count: number; message: string }>(
      `/library/${id}/favorite`,
      { method: 'DELETE' },
    ),

  /** 评论列表（倒序） */
  comments: (id: number) => apiRequest<{ items: MaterialComment[]; total: number }>(`/library/${id}/comments`),

  /** 发表评论 / 回复（1~200 字，即时可见；parentId 传目标评论 id = 回复，对方会收到通知） */
  addComment: (id: number, content: string, parentId = 0) =>
    apiRequest<{ ok: boolean; item: MaterialComment }>(`/library/${id}/comments`, {
      method: 'POST',
      body: { content, parent_id: parentId },
    }),

  /** 删除自己的评论 */
  deleteComment: (commentId: number) =>
    apiRequest<{ ok: boolean }>(`/library/comments/${commentId}`, { method: 'DELETE' }),
}

/* ── 音乐（管理员在后台「音乐」页上传的曲目，考生端「音乐」Tab 播放） ──
   音频与封面由服务端托管：<audio src> / <img src> 带不了请求头，
   所以地址都走 ?token= 查询参数（与资料库同一口径，见 server/modules/music.py）。 */

export interface MusicTrackItem {
  id: number
  title: string
  artist: string
  album: string
  /** 所属专辑 id（0 = 未归专辑） */
  album_id: number
  /** 歌词：纯文本或 LRC 时间轴（[mm:ss.xx] 前缀），前端解析后逐行高亮 */
  lyric: string
  /** 歌词非空行数（后台列表展示用） */
  lyric_lines: number
  /** 时长（秒）；0 = 未读到，播放时以音频实际时长为准 */
  duration: number
  file_name: string
  file_size: number
  mime: string
  has_cover: boolean
  /** 播放量（所有考生累加） */
  play_count: number
  /** 收藏数 */
  fav_count: number
  /** 评论数 */
  comment_count: number
  /** 我是否已收藏（列表接口附带） */
  favorited?: boolean
  /** 收藏列表附带：收藏时间；历史列表附带：最近播放时间 */
  favorited_at?: string
  played_at?: string
  /** 历史列表附带：我听过几次 */
  my_play_count?: number
  sort_order: number
  uploaded_by: string
  created_at: string
}

export interface MusicCommentItem {
  id: number
  user_id: number
  nickname: string
  avatar: string
  content: string
  created_at: string
  /** 是否我发的（可删除） */
  mine: boolean
}

/** 音乐专辑（后台创建 → 考生端「专辑」Tab 展示） */
export interface MusicAlbumItem {
  id: number
  name: string
  description: string
  has_cover: boolean
  track_count: number
  sort_order: number
  uploaded_by: string
  created_at: string
  /** 该专辑的歌曲（考生端专辑列表接口附带；管理端列表不带） */
  tracks?: MusicTrackItem[]
}

export const musicApi = {
  /** 曲目列表（含歌词与各项计数），按后台排定的顺序 */
  list: () => apiRequest<{ items: MusicTrackItem[] }>('/music'),

  /** 专辑列表（含每张专辑的歌曲，音乐首页「专辑」Tab 数据源） */
  albums: () => apiRequest<{ items: MusicAlbumItem[] }>('/music/albums'),

  /** 专辑封面地址（没设置返回 404，前端回落首曲封面 / 内置插画） */
  albumCoverUrl: (id: number) =>
    `${API_BASE}/music/albums/${id}/cover?token=${encodeURIComponent(getToken())}`,

  /** 音频播放地址（<audio src>；支持 HTTP Range 拖动进度） */
  fileUrl: (id: number) => `${API_BASE}/music/${id}/file?token=${encodeURIComponent(getToken())}`,

  /** 封面地址（没设置封面返回 404，前端回落内置山水插画） */
  coverUrl: (id: number) => `${API_BASE}/music/${id}/cover?token=${encodeURIComponent(getToken())}`,

  /** 记一次播放（播放量 +1 并写入播放历史，失败不影响播放） */
  play: (id: number) => apiRequest<{ ok: boolean; play_count: number }>(`/music/${id}/play`, { method: 'POST' }),

  /** 收藏 / 取消收藏，返回 favorited 与最新收藏数 */
  favorite: (id: number) =>
    apiRequest<{ ok: boolean; favorited: boolean; fav_count: number; message: string }>(
      `/music/${id}/favorite`,
      { method: 'POST' },
    ),

  /** 我的音乐收藏（按收藏时间倒序） */
  favorites: () => apiRequest<{ items: MusicTrackItem[] }>('/music/favorites'),

  /** 我的播放历史（同一首只留最近一次，带最近播放时间与次数） */
  history: () => apiRequest<{ items: MusicTrackItem[] }>('/music/history'),

  /** 从播放历史移除某一首（隐藏标记，不影响播放量） */
  removeHistory: (id: number) =>
    apiRequest<{ ok: boolean; removed: number; message: string }>(`/music/history/${id}`, { method: 'DELETE' }),

  /** 清空播放历史（隐藏标记，不影响播放量） */
  clearHistory: () =>
    apiRequest<{ ok: boolean; removed: number; message: string }>('/music/history', { method: 'DELETE' }),

  /** 歌曲评论列表（按时间正序，mine=true 的可删） */
  comments: (id: number) => apiRequest<{ items: MusicCommentItem[] }>(`/music/${id}/comments`),

  /** 发表歌曲评论（1~300 字），返回最新评论数 */
  addComment: (id: number, content: string) =>
    apiRequest<{ ok: boolean; id: number; comment_count: number; message: string }>(
      `/music/${id}/comments`,
      { method: 'POST', body: { content } },
    ),

  /** 删除自己的歌曲评论，返回最新评论数 */
  deleteComment: (commentId: number) =>
    apiRequest<{ ok: boolean; comment_count: number; message: string }>(
      `/music/comments/${commentId}`,
      { method: 'DELETE' },
    ),
}

/* ── 学习统计（首页数据源，全部来自服务端实时计算） ──────── */

export interface WeeklyDayPoint {
  date: string
  label: string
  count: number
}

export interface AchievementItem {
  id: string
  title: string
  description: string
  /** emoji 图标（首页会换成线性图标渲染） */
  icon: string
  earned: boolean
  progress?: number
  max?: number
  /** 成就页返回：分类 id（answer/persist/exam/wrong/library） */
  category?: string
  /** 成就页返回：品级 bronze/silver/gold */
  tier?: 'bronze' | 'silver' | 'gold'
  tier_name?: string
  /** 进度单位（题 / 天 / 小时 / 分 / 个 / 条 / 次 / %） */
  unit?: string
}

/** 成就目录（「我的 → 成就勋章」页数据源，见 server/modules/achievements.py） */
export interface AchievementsPayload {
  items: AchievementItem[]
  categories: Array<{ id: string; name: string }>
  total: number
  earned_count: number
  /** 最近解锁的勋章 id（前端高亮） */
  recent_earned: string[]
  xp: number
  xp_in_level: number
  xp_level_max: number
  level: number
}

export interface UserStatsSummary {
  today_total: number
  today_correct: number
  today_accuracy: number
  today_duration_seconds: number
  daily_goal: number
  streak_days: number
  weekly: WeeklyDayPoint[]
  weekly_total: number
  total_answered: number
  total_correct: number
  /** 全量正确率（百分比整数，「我的」页统计用） */
  total_accuracy: number
  /** 累计学习时长（秒，按 session 去重） */
  total_duration_seconds: number
  /** XP 等级体系：每答 1 题 1 经验，每 200 经验升 1 级 */
  xp: number
  xp_in_level: number
  xp_level_max: number
  level: number
  wrong_pending: number
  /** 上次练习的方向（「继续学习」入口用）；从未练习时为 '' */
  last_method: string
  achievements: AchievementItem[]
  /** 完整成就墙解锁进度（「我的」页成就入口副标题用） */
  ach_earned?: number
  ach_total?: number
}

/** 学习报告页（学习报告页数据源，period = week | month） */
export interface CalendarDay {
  date: string
  count: number
}

export interface KnowledgeBreakdownItem {
  /** 方向代码（练习入口用） */
  category: string
  /** 方向中文名（展示用） */
  topic: string
  answered: number
  /** 百分比整数 0-100 */
  accuracy: number
}

export interface UserStatsReport {
  period: 'week' | 'month'
  period_days: number
  period_total: number
  period_correct: number
  period_accuracy: number
  period_duration_seconds: number
  streak_days: number
  total_answered: number
  calendar: CalendarDay[]
  breakdown: KnowledgeBreakdownItem[]
  xp: number
  xp_in_level: number
  xp_level_max: number
  level: number
}

/** 错题本的一条记录（题目信息 + 我的答题历史） */
export interface WrongQuestionItem extends BankQuestion {
  explanation: string
  wrong_count: number
  mastered: boolean
  last_wrong_at: string
  history: Array<{ date: string; answer: string; correct: boolean }>
}

export const statsApi = {
  /** 首页统计：今日/本周/连续打卡/成就（实时计算） */
  summary: () => apiRequest<UserStatsSummary>('/user/stats/summary'),

  /** 成就目录：全部勋章 + 我的解锁状态与进度（「我的 → 成就勋章」页数据源） */
  achievements: () => apiRequest<AchievementsPayload>('/user/achievements'),

  /** 学习报告：周期汇总 + 学习日历 + 方向掌握度 */
  report: (period: 'week' | 'month' = 'week') =>
    apiRequest<UserStatsReport>(`/user/stats/report?period=${period}`),

  /** 错题本列表 */
  wrongQuestions: (limit = 100) =>
    apiRequest<{ items: WrongQuestionItem[] }>(`/user/wrong-questions?limit=${limit}`),

  /** 标记某道错题已掌握 */
  markMastered: (questionId: number) =>
    apiRequest<{ ok: boolean; message: string }>(`/user/wrong-questions/${questionId}/master`, {
      method: 'POST',
    }),

  /** 把某道错题从错题集移除（隐藏标记，不删答题记录；再次答错会重新出现） */
  deleteWrong: (questionId: number) =>
    apiRequest<{ ok: boolean; message: string }>(`/user/wrong-questions/${questionId}`, {
      method: 'DELETE',
    }),
}

/* ── 题目纠错：考生上报「答案疑似有误」→ 管理员工单处理 ── */

export const reportApi = {
  /** 上报题目疑问：suggested_answer = 我认为的正确答案（选项字母/判断字母/简答文本），reason = 理由 */
  create: (questionId: number, suggestedAnswer: string, reason: string) =>
    apiRequest<{ ok: boolean; id: number; message: string }>('/user/question-reports', {
      method: 'POST',
      body: { question_id: questionId, suggested_answer: suggestedAnswer, reason },
    }),
}

/* ── AI 智能助手（题目 AI 解析 / 视频 AI 概括） ──────────────
   服务端见 server/modules/ai.py。两个接口都是 SSE 流式：
   生成要好几秒，一次性返回会让页面干等；流式能让考生看到文字逐字打出来。

   ⚠️ 这是本文件里唯一不走 apiRequest 的地方（另一个是 api/realtime.ts 的实时通道）——
      原因一样：要边收边渲染，apiRequest 的「等 JSON 全回来」用不了。
      所以流式帧解析在这里自己实现，与后端 _sse() 的帧格式严格对应。 */

export interface AiStatus {
  /** 服务端是否已配置 ai.api_key */
  configured: boolean
  chat_model: string
  vision_model: string
  /** 服务端能否用 ffmpeg 抽帧（不能则视频概括退化为「按标题简介概括」） */
  can_extract_frames: boolean
  video_frames: number
}

/** AI 缓存（只读；content 为空 = 还没生成过） */
export interface AiCache {
  content: string
  model: string
  created_at: string
}

/** 流式回调：meta（开始）/ delta（增量）/ error（出错，终止）/ done（结束） */
export interface AiStreamHandlers {
  onMeta?: (info: { cached: boolean; model: string; frames?: number }) => void
  onDelta: (text: string) => void
  onError?: (message: string) => void
  onDone?: (info: { cached: boolean }) => void
}

/**
 * 发起一次 AI 流式请求（POST + SSE）。
 * 返回「取消」函数：组件卸载 / 切题时调用，免得回复打到已经没人看的界面上。
 */
function streamAi(path: string, body: unknown, handlers: AiStreamHandlers): () => void {
  const controller = new AbortController()

  ;(async () => {
    let response: Response
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      })
    } catch {
      if (!controller.signal.aborted) handlers.onError?.('无法连接服务器，请确认后端服务已启动')
      return
    }

    if (!response.ok) {
      // 鉴权失败：与 apiRequest 同一套处理（清登录态 + 广播过期），APP 会自动退回登录页
      if (response.status === 401) {
        clearSession()
        window.dispatchEvent(new CustomEvent('ndt:session-expired'))
      }
      let message = `请求失败（${response.status}）`
      try {
        const data = await response.json()
        if (data && typeof data.detail === 'string') message = data.detail
      } catch {
        /* 无响应体，用兜底文案 */
      }
      handlers.onError?.(message)
      return
    }

    if (!response.body) {
      handlers.onError?.('当前环境不支持流式响应，请升级浏览器或微信后重试')
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // 一个 TCP 包可能只切到半帧，所以按 \n\n 切，最后一段留到下一轮
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          let event = 'message'
          const dataLines: string[] = []
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) continue
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }
          if (!dataLines.length) continue
          let payload: any
          try {
            payload = JSON.parse(dataLines.join('\n'))
          } catch {
            continue // 坏帧直接丢，不能打断整条流
          }
          if (event === 'meta') handlers.onMeta?.(payload)
          else if (event === 'delta') handlers.onDelta(payload.text || '')
          else if (event === 'error') {
            handlers.onError?.(payload.message || 'AI 生成失败')
            return
          } else if (event === 'done') handlers.onDone?.({ cached: !!payload.cached })
        }
      }
    } catch {
      if (!controller.signal.aborted) handlers.onError?.('网络中断，AI 回复可能不完整')
    }
  })()

  return () => controller.abort()
}

export const aiApi = {
  /** AI 助手状态（未配置时界面显示提示而不是让考生白点一下） */
  status: () => apiRequest<AiStatus>('/ai/status'),

  /** 只读缓存：进页面先看有没有生成过，有就直接展示，不再烧 token */
  cache: (kind: 'question' | 'solution' | 'video', targetId: number) =>
    apiRequest<AiCache>(`/ai/cache/${kind}/${targetId}`),

  /** 题目 AI 解析（流式）。refresh=true 表示丢弃旧解析重新生成 */
  explainQuestion: (questionId: number, refresh: boolean, handlers: AiStreamHandlers) =>
    streamAi('/ai/question-explain', { question_id: questionId, refresh }, handlers),

  /** 计算题 AI 解答过程（流式）：「题目原题讲解」里题库没配解答过程时的兜底 */
  solutionQuestion: (questionId: number, refresh: boolean, handlers: AiStreamHandlers) =>
    streamAi('/ai/question-solution', { question_id: questionId, refresh }, handlers),

  /** 视频 AI 概括（流式）。refresh=true 表示丢弃旧概括重新生成 */
  summarizeVideo: (materialId: number, refresh: boolean, handlers: AiStreamHandlers) =>
    streamAi('/ai/video-summary', { material_id: materialId, refresh }, handlers),
}
