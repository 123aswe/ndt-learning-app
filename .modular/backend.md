# Backend（后端地图）

> **本项目有真实后端。** 改后端先读本文件定位，不要全量扫描 `server/`。
> 前端地图看项目根 `FRONTEND.md`；开发规矩与命令看 `.modular/rules.md`。
> 最后更新：2026-09-29（v1.14 · 题目纠错工单 + 内置一级题库进后台 CRUD + 修复题库管理按钮事件；v1.13 模拟考试；v1.12 管理后台「题库管理」；v1.11 随机刷题/错题删除）

---

## 0. 一句话架构

```
React 前端（Vite :8443）── /api 代理 ──▶ Python 服务（FastAPI :8000）──▶ SQLite（server/data/app.db）
                                              │
                                              └──▶ 腾讯云短信（可选，当前未启用；登录已改用图形验证码）
浏览器直接访问 ─────────────────────────▶ 可视化管理后台（/admin/，由同一个 Python 服务提供）
```

- 前端不直连数据库、不持有任何密钥，只通过 `/api` 调接口
- Python 服务同时提供：**接口**（`/api/**`）、**接口文档**（`/docs`）、**可视化管理后台**（`/admin/`）

### 核心业务流程：注册审核制

```
① 考生在 App 登录页「注册」Tab 填写         ② 管理员在后台「注册申请」Tab 审核
   账号 / 密码 / 确认密码 / 单位学校              待审列表（角标提示数量）
   + 图形验证码（点图片可刷新）                    ├─ 通过 → 自动在 user_accounts 建号
        │                                          │        （可选指定初始密码 / 修正单位）
        ▼                                          └─ 拒绝 → 记录拒绝原因
   POST /api/auth/register                              │
        │                                               ▼
        ▼                                        ③ 考生用「账号 + 密码」登录
   registrations 表 status=pending                 POST /api/auth/password/login
   （此时**还不能登录**）

图形验证码：GET /api/auth/captcha → 服务端生成 SVG（4 位、5 分钟一次性），前端 <img src> 直接显示
```

### 核心业务流程：考生资料（昵称 / 头像）

```
① 建号时（注册审核通过 / 管理员手动开号）
   昵称留空 → 随机生成（如「严谨的检测员」）      见 profile_defaults.random_nickname()
   头像留空 → 随机预设（preset:1 ~ preset:12）     见 profile_defaults.random_avatar()
        │
        ▼
② 考生在 App「我的」页点头像旁的铅笔
   GET  /api/user/profile   → 取自己的资料（先读本地缓存，再拉后端覆盖）
   PUT  /api/user/profile   → 改昵称 + 头像（预设挑选 / 本地上传压缩后的图片）
        │
        ▼
③ 数据落 user_accounts.nickname / avatar，换设备登录也在
   后台「考生账号」Tab 也能看到同一份数据并直接修改
```

> ⚠️ 手机号 + 短信验证码登录**已下线**。`sms.py` 保留（腾讯云对接代码与凭证配置都在），
> 但登录与注册都不再依赖它。**管理后台已移除「验证码调试」页**（2026-09-29），
> `/api/admin/sms-codes` 接口仍在，仅为将来重新启用短信时排查用。

---

## 1. 目录结构与文件职责

```
server/                        Python 服务根目录（约 4530 行）
├── main.py              124  服务入口：CORS / 注册路由 / 挂载静态后台 / 启动日志
├── config.py            104  配置：默认值 + config.json 覆盖；sms_ready()/sms_mode()
├── config.example.json       凭证模板（复制为 config.json 使用）
├── database.py          376  SQLite 连接 / 建表 / 平滑迁移 / 一次性数据补齐 / 初始超管
├── security.py           80  密码 PBKDF2 哈希 / 令牌 / 短信码 / 图形验证码字符生成 / 随机密码
├── deps.py              120  会话令牌存取 + FastAPI 依赖（当前管理员 / 当前考生）
├── profile_defaults.py   62  考生资料的随机默认值：随机昵称 + 随机预设头像 id
├── requirements.txt          依赖清单（fastapi / uvicorn / tencentcloud-sdk-python-sms）
├── 启动服务.bat              Windows 一键启动（建 venv / 装依赖 / 起服务 / 开后台）
├── modules/                  业务模块：一个功能一个文件，互相独立
│   ├── auth.py          194  登录鉴权：管理员登录 / 账号密码登录 / 改自己的密码
│   ├── captcha.py       126  图形验证码：SVG 生成 + 一次性校验（无第三方依赖）
│   ├── registrations.py 241  注册申请：公开提交 + 管理员审核（通过自动建号，含随机资料）
│   ├── user_profile.py   92  考生个人资料：考生查看 / 修改自己的昵称与头像
│   ├── user_security.py 118  考生账号安全：自助改登录密码 / 改登录账号
│   ├── notifications.py 412  通知：考生收通知 + 管理员发通知（批次记录 / 候选考生选择器）
│   ├── password_resets.py 254 密码重置工单：考生提交申请 + 管理员处理（重置密码并写系统通知）
│   ├── bank.py           214  题库：CSV 导入（表空才导）+ 概览 /api/bank/summary + 搜索 /api/bank/search（考生只读）
│   ├── practice.py       445  练习：出题 / 交卷（写 answer_record）/ 首页统计 / 学习报告 / XP 等级 / 错题本 / 标记掌握
│   ├── app_update.py     62  版本更新：GET /api/app/version（读 data/version.json，公开）
│   ├── admin_accounts.py 220 管理员账号增删查改 + 超管护栏
│   ├── user_accounts.py 242  考生账号增删查改（账号 / 单位学校 / 昵称 / 头像 / 密码重置）
│   ├── sms.py           248  短信验证码（腾讯云对接 + 本地降级）+ 后台查码接口
│   └── overview.py       63  后台概览统计（含注册申请、密码重置统计）
├── static/                   可视化管理后台（纯静态，无需构建）
│   ├── index.html        42  登录页
│   ├── dashboard.html   310  主界面（**五个 Tab**：管理员账号 / 注册申请 / 考生账号 / 密码重置 / 通知管理）
│   ├── api.js           112  公共脚本：令牌存取 + fetch 封装 + toast + esc
│   ├── login.js          53  登录页逻辑
│   ├── dashboard.js    1323  主界面逻辑（五个模块的增删查改 + 修改我的密码 + 头像渲染 + 指定考生多选发送）
│   └── style.css        282  样式（令牌与主项目一致，含 .ava 头像样式 / td.wrap 长文本换行）
└── data/app.db               SQLite 数据库（gitignore，首次启动自动生成）
    data/version.json         最新版本信息（检查更新用；改这里就能推新版本，不用改代码）
```

> 通知与密码重置**已全部接后端**（`modules/notifications.py`、`modules/password_resets.py`），
> 后台与 App 都走真实接口，不再有演示数组。新增两张业务表：`notifications`（按接收人一行，
> 同一批用 `batch_id` 分组）+ `notification_batches`（后台「已发送记录」），以及工单表 `password_resets`。
> 前端对应接入点：`src/hooks/useNotifications.ts`、`src/components/PasswordResetSheet.tsx`、`src/api/client.ts`。

---

## 2. 数据表（server/data/app.db）

| 表 | 用途 | 关键字段 |
| ---- | ---- | ---- |
| `admin_accounts` | 管理后台登录账号 | `id` / `username`(唯一) / `password_hash` / `real_name` / `role`(super\|admin) / `status`(1启用0禁用) / `remark` / `created_at` / `last_login_at` |
| `user_accounts` | 考生账号（**登录名=自定义账号 account**） | `id` / `account`(唯一) / `password_hash` / `org`(单位学校) / `nickname`(昵称) / **`avatar`(头像)** / `real_name` / `method`(报考方向) / `status` / `remark` / `created_at` / `last_login_at` |
| `registrations` | 注册申请（审核通过才建号） | `id` / `account` / `password_hash` / `org` / `status`(pending\|approved\|rejected) / `reject_reason` / `reviewed_by` / `reviewed_at` / `created_at` |
| `captchas` | 图形验证码 | `id`(token_urlsafe) / `code` / `used`(0\|1) / `expires_at` / `created_at` |
| `sms_codes` | 短信发送记录（历史遗留） | `id` / `phone` / `code` / `purpose` / `channel` / `send_status` / `used` / `fail_count` / `expires_at` / `created_at` |
| `sessions` | 登录令牌 | `token`(主键) / `subject_type`(admin\|user) / `subject_id` / `created_at` / `expires_at` |
| `notifications` | 通知（**每个接收考生一行**，App 通知中心读这张表） | `id` / `batch_id`(一次发送) / `user_id` / `type`(system\|notice) / `title` / `content` / `sender` / `read_at`(空=未读) / `deleted`(软删) / `created_at` |
| `notification_batches` | 通知批次（后台「已发送记录」） | `id`(**TEXT 主键** `nb`+16 位 hex) / `type` / `title` / `content` / `scope`(all\|one) / `target_desc` / `accounts`(逗号分隔快照) / `receiver_count` / `sender` / `hidden`(后台删记录=置1) / `created_at` |
| `password_resets` | 密码重置工单（考生提交 → 管理员处理） | `id` / `account` / `org`(工作单位) / `user_id` / `status`(pending\|done\|rejected) / `reject_reason` / `reviewed_by` / `reviewed_at` / `created_at` |
| `app_meta` | 系统元信息（key-value） | `key`(主键) / `value` —— 目前存一次性任务的执行标记（如 `profile_defaults_backfilled`） |
| `questions` | **题库**（启动时从 `data/question_bank.csv` 导入，表空才导；考生只读） | `id` / `set_id`(NULL=内置一级；非空=自定义题库) / `method`(UT\|RT\|MT\|PT\|ZD) / `grade`(级别) / `topic1` / `topic2` / `qtype`(single\|judge\|calc\|short) / `content` / `options_json` / `answer` / `source_no`(CSV 序号) / `created_at` |
| `question_sets` | 自定义题库（v1.12，管理后台创建） | `id` / `name`(唯一) / `level` / `description` / `created_at` |
| `answer_records` | **答题记录**（每个考生一份，统计/错题本/打卡的数据源） | `id` / `user_id` / `question_id` / `method` / `kind`(answer\|master) / `user_answer` / `is_correct` / `duration_seconds`(本 session 总时长，每行相同) / `session_id`(一次练习一个) / `answered_at` |
| `exams` | **模拟考试**（v1.13，一次开卷一行；`id` 同时是 answer_records.session_id） | `id`(**TEXT 主键** `ex`+16 位 hex) / `user_id` / `title` / `category` / `set_id` / `qtype` / `question_ids`(JSON 试卷快照) / `duration_minutes` / `total` / `correct` / `score`(百分制) / `status`(in_progress\|finished) / `time_used`(秒) / `auto_submitted` / `started_at` / `finished_at` |
| `exam_answers` | **考试作答明细**（v1.13，交卷时写入，试卷回看数据源） | `exam_id` + `question_id`(联合主键) / `user_answer` / `is_correct` —— 未作答的题没有行 |
| `wrong_dismissals` | **错题集删除标记**（v1.11；考生把错题「删除」= 加一行隐藏标记，不删答题记录） | `user_id` + `question_id`(联合主键) / `created_at` —— 这道题再次答错时标记自动清除（`practice.submit` 里删），会重新出现在错题集 |
| `practice_progress` | **练习进度**（续做：下次进来接着上次的题号做，不用重头开始） | `user_id` / `category` / `topic` / `qtype` / `set_id` / `mode` / `question_ids`(JSON 题目顺序快照) / `answers_json`(JSON 已答界面快照 {index:{selected,correct}}) / `current_index` / `updated_at` —— `UNIQUE(user_id, category, topic, qtype, set_id, mode)`；「清除记录」/ 交卷完成时删除，**只删自己的这一条** |
| `materials` | **资料库**（v1.15：标准/教材/资料/视频，元数据入库、文件字节存 `data/uploads/`） | `id` / `title` / `category`(standard\|textbook\|material\|video) / `method` / `description` / `kind`(pdf\|video\|doc) / `file_name`(原始名) / `stored_name`(磁盘随机名) / **`cover_name`**(v1.16 管理员自定义封面磁盘名，空=考生端自动取视频首帧) / `file_size` / `mime` / `uploaded_by` / `created_at` |
| `material_views` | **视频播放记录**（v1.16，播放量 = COUNT(*)，B 站式每次打开 +1；v1.18 加 `hidden` 列：观看历史里被考生移除的记录置 1，只影响列表展示不删行 → 播放量不变） | `id` / `material_id` / `user_id` / `hidden`(0=正常,1=已从观看历史移除) / `created_at` —— 索引 `(material_id, id)` |
| `material_favorites` | **视频收藏**（v1.16，一人一资料最多一条） | `material_id` + `user_id`(联合主键) / `created_at` —— 「我的收藏」按 `created_at` 倒序 |
| `material_comments` | **视频评论**（v1.16，v1.17 起支持楼中楼，考生即时发布，管理员可删） | `id` / `material_id` / `user_id` / `content`(1~200 字) / `parent_id`(0=顶层；>0=根评论 id，**两层结构，回复的回复也归根**) / `reply_to`(被回复人昵称快照，展示「回复 @xx」) / `created_at` —— 索引 `(material_id, id)`；**删除资料时三张表级联清空；删顶层评论（考生自己删 / 管理员删）连它的回复一起删** |

**索引**：`idx_sms_phone(phone, created_at)`、`idx_sessions_exp(expires_at)`、`idx_reg_status(status, created_at)`、`idx_reg_account(account)`、`idx_captcha_exp(expires_at)`、`idx_notif_user(user_id, id)`、`idx_notif_batch(batch_id)`、`idx_preset_status(status, id)`、`idx_preset_account(account)`、`idx_q_method(method)`、`idx_q_set(set_id)`、`idx_rec_user_time(user_id, answered_at)`、`idx_rec_user_q(user_id, question_id)`、`idx_rec_session(session_id)`、`idx_dismiss_user(user_id)`、`idx_progress_user(user_id, updated_at)`、`idx_exam_user(user_id, id)`、`idx_exam_ans_q(question_id)`、`idx_mat_category(category, id)`、`idx_mat_view(material_id, id)`、`idx_mat_fav_user(user_id, material_id)`、`idx_mat_cmt(material_id, id)`

> 新增字段：改 `database.py` 的 `SCHEMA` **并在 `_migrate()` 里补 ALTER TABLE**，老库才能平滑升级。
> **已有迁移**：`user_accounts.phone` 老库会自动 `RENAME COLUMN phone TO account`；`user_accounts.avatar` 会自动 `ADD COLUMN`。
> **一次性数据补齐**：`database.py` 的 `_backfill_profile_defaults()` 会给「随机昵称/头像」上线前建的老账号补上随机值（只处理 `avatar` 为空、或 `nickname` 为空/等于账号的行，**不覆盖考生自己改过的资料**），跑完在 `app_meta` 打标记，**只跑一次** —— 加新补齐任务请照这个模式写（用 `get_meta()` / `set_meta()` 打标记），否则每次启动都会覆盖用户数据。

### 2.1 跨端一致常量（改一处必须同步改另一边）

| 常量 | 后端 | 前端 | 说明 |
| ---- | ---- | ---- | ---- |
| 报考方向 | `user_accounts.METHODS` | `src/types.ts` 的 `NDTMethod` + 后台 `dashboard.html` 下拉 | `UT/RT/MT/PT/ET/VT/综合` |
| 账号规则 | `user_accounts.ACCOUNT_PATTERN`（`registrations.py`、`user_security.py` 各同样一份） | `LoginScreen.tsx` 的 `ACCOUNT_PATTERN` + `SettingsScreen.tsx` 改账号表单校验 | `^[A-Za-z0-9_]{4,20}$`（共 4 处，改一处要一起改） |
| **版本号** | `server/data/version.json` 的 `latest_version` | `src/data/appVersion.ts` 的 `APP_VERSION`（设置页页脚 /「我的」页脚都用它） | 发版时两处一起改；服务端更大 == 有新版本 |
| **预设头像** | `profile_defaults.AVATAR_PRESET_COUNT`（=12） | `src/data/avatars.ts` 的 `AVATAR_PRESETS`（图案/配色）+ `dashboard.js` 的 `AVATAR_PRESETS` | 值格式 `preset:<1..N>`，**顺序即序号**，前端按下标取 |
| **头像值格式** | `user_profile.AVATAR_MAX_LEN`（=400000） | `client.ts` 的 `UserProfile.avatar` | `preset:N` / `data:image/...`（上传，前端已压到 256×256）/ `''`（用昵称首字） |

> ⚠️ 预设头像的**顺序**被当作序号使用：调换数组顺序会让老账号的头像全部错位。只允许「末尾追加」。数量对不上不会报错，只会退化成昵称首字头像。

---

## 3. API 路由

基址：开发环境 `/api`（Vite 代理到 `http://127.0.0.1:8000`）。带 🔒 的需要令牌（`Authorization: Bearer <token>`）。

### 3.1 认证（modules/auth.py，前缀 `/api/auth`）

| 方法 | 路径 | 说明 | 主要错误 |
| ---- | ---- | ---- | ---- |
| POST | `/api/auth/admin/login` | 管理员登录（管理后台用） | 401 账号或密码错误；403 已禁用 |
| POST | `/api/auth/password/login` | 账号 + 密码登录（**自动识别管理员/考生**） | 401 账号或密码错误；403 已禁用 |
| POST | `/api/auth/change-password` 🔒 | 管理员**修改自己的密码**（需验旧密码） | 400 当前密码不正确 / 新旧密码相同 |
| GET | `/api/auth/me` 🔒 | 当前登录者（先按管理员解析，再按考生） | 401 |
| POST | `/api/auth/logout` 🔒 | 退出登录（吊销令牌） | — |
| GET | `/api/auth/sms-mode` | 短信模式（仅供后台顶部提示，登录已不用） | — |

### 3.2 图形验证码（modules/captcha.py，前缀 `/api/auth`）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/auth/captcha` | 生成一张验证码 → `{captcha_id, image(base64 SVG), ttl_seconds}` |

> 校验通过即作废（一次性）；忽略大小写；有效期 5 分钟（`config.captcha.ttl_seconds`）。

### 3.3 注册申请（modules/registrations.py）

| 方法 | 路径 | 说明 | 主要错误 |
| ---- | ---- | ---- | ---- |
| POST | `/api/auth/register` | **公开**：提交注册申请 | 400 两次密码不一致 / 图形验证码错误；409 账号已注册或已待审；422 参数不合法 |
| GET | `/api/admin/registrations` 🔒 | 列表（关键词 / 状态 / 分页，待审置顶）+ 返回 `pending` 数量 | 400 非法状态值 |
| GET | `/api/admin/registrations/{id}` 🔒 | 详情 | 404 |
| POST | `/api/admin/registrations/{id}/approve` 🔒 | 通过 → **自动建考生号**（可指定初始密码 / 修正单位） | 400 已处理过；409 账号已存在 |
| POST | `/api/admin/registrations/{id}/reject` 🔒 | 拒绝（记录原因） | 400 已处理过 |
| DELETE | `/api/admin/registrations/{id}` 🔒 | 删除申请记录（不影响已建账号） | 404 |

### 3.4 管理员账号（modules/admin_accounts.py，前缀 `/api/admin/admins`，均需管理员令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/admins?q=&status=&page=&page_size=` | 列表（搜索 + 状态筛选 + 分页） |
| POST | `/api/admin/admins` | 新增（用户名唯一，409） |
| GET | `/api/admin/admins/{id}` | 详情 |
| PUT | `/api/admin/admins/{id}` | 改姓名/角色/状态/备注/密码（传 `password` 即重置） |
| DELETE | `/api/admin/admins/{id}` | 删除 |

### 3.5 考生账号（modules/user_accounts.py，前缀 `/api/admin/users`，均需管理员令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/users?q=&status=&method=&page=&page_size=` | 列表（账号/昵称/姓名/单位学校/备注搜索 + 状态/方向筛选 + 分页） |
| POST | `/api/admin/users` | 新增（账号唯一，409） |
| GET | `/api/admin/users/{id}` | 详情 |
| PUT | `/api/admin/users/{id}` | 改账号/单位学校/昵称/**头像**/姓名/方向/状态/备注/**密码** |
| DELETE | `/api/admin/users/{id}` | 删除 |

> 报考方向取值：`UT/RT/MT/PT/ET/VT/综合`（与前端 `src/types.ts` 的 `NDTMethod` 一致）
> 账号规则：`^[A-Za-z0-9_]{4,20}$`（三个文件共用，改动需同步 `registrations.py` / `user_accounts.py` / 前端提示）
> 新建时 `nickname` / `avatar` 留空 → 随机生成（见 `profile_defaults.py`）；修改时 `nickname` 传空白视为不修改，`avatar` 传空串则表示清空头像。

### 3.6 考生个人资料（modules/user_profile.py，前缀 `/api/user`，均需**考生**令牌）

| 方法 | 路径 | 说明 | 主要错误 |
| ---- | ---- | ---- | ---- |
| GET | `/api/user/profile` 🔒 | 取当前登录考生的资料（昵称 / 头像 / 账号 / 单位学校 / 报考方向…） | 401 未登录；404 账号不存在 |
| PUT | `/api/user/profile` 🔒 | 改**自己的**昵称 / 头像（`nickname` 留空=不改；`avatar` 可传 `preset:N` / data URL / 空串清空） | 400 无可改内容；422 昵称超 32 字或头像超长 |

> 只能改自己的资料 —— 要改别人的走 `/api/admin/users/{id}`（需管理员令牌）。
> 考生令牌调本接口可用；**管理员令牌调本接口返回 401**（管理员没有考生资料）。
> 登录响应里的 `user` 对象已带 `nickname` / `avatar`，登录后前端无需额外请求即可显示。

### 3.7 考生账号安全（modules/user_security.py，前缀 `/api/user`，均需**考生**令牌）

| 方法 | 路径 | 说明 | 主要错误 |
| ---- | ---- | ---- | ---- |
| POST | `/api/user/password` 🔒 | 改**自己的**登录密码：`old_password` + `new_password`(≥6) + `confirm_password`；成功后**吊销本人全部会话**（需用新密码重新登录） | 400 原密码错误 / 两次不一致 / 新旧相同；401 未登录；422 字段不合法 |
| POST | `/api/user/account` 🔒 | 改**自己的**登录账号：`new_account`（4-20 位字母数字下划线）+ `password`（当前登录密码）；账号唯一（同时避开管理员用户名）；**会话保留**，不用重新登录 | 400 账号未变 / 密码错误；409 账号已被占用；422 账号格式不合法 |

> 前端入口：设置 →「账号安全」弹层（修改密码 / 修改登录账号 两个 Tab）。
> 忘记原密码、忘记账号、账号被禁用 → 走管理员：后台「考生账号」里可重置密码、改账号（见 3.5）。
> 与他人相关的边界：改密码/改账号都只作用在令牌所属的自己身上，接口不带任何目标 id，无法越权改别人。

### 3.8 版本更新（modules/app_update.py，前缀 `/api/app`，公开）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/app/version` | 返回 `{latest_version, published_at, notes[], download_url, force}`；数据来自 `server/data/version.json`，读不到就用模块内 `DEFAULT_VERSION` 兜底。**永远 200**，前端只负责比版本号 |

> 发版流程：改 `server/data/version.json` 的 `latest_version` + `notes` + `download_url` → 前端设置页「检查更新」即可看到提示（`download_url` 为空时提示联系管理员）。
> 版本号比较规则在**前端** `src/data/appVersion.ts`（`x.y.z` 逐段数值比较，只允许末尾追加新段）；后端不做判断。

### 3.9 题库与练习（modules/bank.py + modules/practice.py，均需**考生**令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/bank/summary` | 题库概览：`{total, methods:[{method, name, count, answered}], qtype_counts:[{method, qtype, count}]}`，answered = 我在该方向做过的题数（去重）；`qtype_counts` = 方向×题型矩阵（v1.11，随机刷题选择器据此显示题量/隐藏空题型） |
| GET | `/api/bank/search?q=&limit=` | 搜索题目（题干 / 知识点 LIKE 模糊匹配）：`{total, items:[{id, method, qtype_label, topic, content}]}`，题库页搜索框数据源 |
| GET | `/api/bank/chapters?category=` | 章节列表（topic1 分组）：`{items:[{topic, count, answered}]}`，只返回有题的章节、按题数降序；「按章节练习」入口数据源 |
| GET | `/api/practice/questions?category=&mode=&qtype=&topic=&block=&limit=` | 出题：`category` 传方向代码或 `综合`（全部）；`mode` = sequential(顺序)/random(随机)/wrong(错题重练)；**`qtype` = judge\|single\|calc 按题型筛选**（空=不限，v1.11 随机刷题/错题重练都用它）；**顺序模式默认不分块返回范围内全部题目**（按 id 升序，`block=-1`；`block=N`+`limit` 仍兼容旧分块调用）；`topic` 传知识点(topic1) 即按章节练习（整章一起练，random/wrong 忽略 topic/block）。返回含 `total_in_scope/block_index/block_count`，**每题附 `my_state`**（我最近一次对/错，null=未做，保留到清除记录为止，含 master 标记） |
| GET | `/api/practice/blocks?category=&topic=&limit=` | 分块列表：范围按 id 升序切成每组 limit 题，返回每组 `{block, count, answered, correct, wrong}`（基于我最近一次作答，清除后归零）。题库页选择面板用它聚合「全部题目」的对/错/未做统计 |
| POST | `/api/practice/reset` | 清除做题记录（重新做）：`{category, topic?}`，**block 省略/-1 = 清除整个范围**（方向或整章），`block=N` 只清第 N+1 组（兼容旧调用）；DELETE 我的 answer_records；空范围 404。**只删自己的记录** |
| POST | `/api/practice/submit` | 交卷：`{category, duration_seconds, answers:[{question_id, user_answer, is_correct}]}` → 每题一行写 `answer_records`（`kind='answer'`，同一卷共用一个 `session_id`）；含无效题目整批拒绝 400 |
| GET | `/api/practice/progress?category=&topic=&qtype=&set_id=&mode=` | 读取我的练习进度（续做）：有进度返回 `{has_progress, question_ids, answers, current_index, updated_at}`，没有则 `{has_progress: false}`。**只读自己的数据** |
| POST | `/api/practice/progress` | 保存/更新我的练习进度：`{category, topic, qtype, set_id, mode, question_ids, answers, current_index}` → upsert 到 `practice_progress`（唯一键 = user+范围）。答题/跳题后前端防抖调用 |
| DELETE | `/api/practice/progress?category=&topic=&qtype=&set_id=&mode=` | 删除我的练习进度（清除记录 / 交卷完成时调用）：`{deleted}` 表示删了几行。**只删自己的这一条**，不影响答题记录 |
| GET | `/api/user/stats/summary` | 首页统计 + 「我的」页（全部实时计算）：今日答题/正确/正确率、今日时长（按 session 去重求和）、`daily_goal=60`、连续打卡、近 7 天 `weekly`、总答题 `total_answered`、总正确数/率 `total_correct/total_accuracy`、累计时长 `total_duration_seconds`、XP 等级 `xp/xp_in_level/xp_level_max/level`（每答 1 题 1 经验，`XP_PER_LEVEL=200`）、待复习错题数、上次方向 `last_method`、`achievements[]`（6 个成就含进度）。**只算 `kind='answer'` 的记录** |
| GET | `/api/user/stats/report?period=week\|month` | 学习报告页：`period` 周期（7/30 天）汇总 `period_total/correct/accuracy/duration_seconds`、近 35 天学习日历 `calendar:[{date, count}]`、各方向掌握度 `breakdown:[{category, topic, answered, accuracy}]`（全量口径）、连续打卡、XP 等级。`period` 非法 422 |
| GET | `/api/user/practice/history?limit=` | 成绩记录（「我的 → 成绩记录」页数据源）：按 `session_id` 分组的历史练习，每次交卷一条 `{session_id, finished_at, category, category_name, total, correct, accuracy, duration_seconds, is_exam, score, exam_title}`，按完成时间倒序（最多 limit 默认 50）。**模拟考试成绩也在这**（v1.13：LEFT JOIN exams，考试记录 `is_exam=true` 且带 `score/exam_title`） |
| GET | `/api/user/practice/history/{session_id}` | 单次成绩回看（v1.14）：练习会话从 answer_records 按 id 顺序还原试卷（含正确答案/my_answer/is_correct）；session_id 是考试（`ex` 开头）自动复用考试回看逻辑。返回结构与 `/api/exam/records/{id}` 一致，前端同一套试卷回看组件 |
| DELETE | `/api/user/practice/history/{session_id}` | 删除一条成绩记录（v1.14）：删该会话全部 answer_records；考试连 exams + exam_answers 一起删。**统计/XP/错题口径随之更新，不可恢复**；只能删自己的（session 归属校验 + id 格式校验） |
| GET | `/api/user/wrong-questions?limit=` | 错题本：我答错过的每题一行（`wrong_count` 累计错误次数、`mastered`=最近一条记录答对、`history` 最近 3 次作答），最新活动的在前 |
| POST | `/api/user/wrong-questions/{question_id}/master` | 标记已掌握：写一条 `kind='master'`、`is_correct=1` 的记录（统计口径不含它，但「最近一条」判定含它） |
| DELETE | `/api/user/wrong-questions/{question_id}` | **从错题集删除**（v1.11）：写一条 `wrong_dismissals` 隐藏标记（不删答题记录、不影响统计）；错题列表 / 待复习数 / mode=wrong 出题三条口径都会排除它；这道题**再次答错会自动恢复**（`submit` 清掉标记）。题目不存在 404 |

> **权限边界**：考生端对 `questions` 表**只有读接口**，没有任何写入口；题库修改只走管理侧（重新导入 = 清空 `questions` 表后重启，或将来在后台加编辑）。
> **导入规则**：`bank.ensure_bank_imported()` 在启动时跑，`questions` 表非空直接跳过（幂等、绝不覆盖）；CSV 在 `server/data/question_bank.csv`。
> **CSV 解析坑**：选项分隔符 `；##`；选项键后既可能是顿号 `、` 也可能是小逗号 `﹑`(U+FE51)；原书插图 `<img src="jcpicture/...">` 导入时替换为「【图】」；`RT(Ⅰ)1` 这类尾巴归入 `RT`。
> **题型代码（v1.11）**：`bank.QTYPE_NAMES` = `judge 判断题 / single 选择题 / calc 计算题`，CSV「题目类型」列由 `_normalize_qtype()` 归一（不认识的一律按 single 兜底）。**当前 CSV 只有判断题 895 + 单选题 845，calc 为 0 题**（将来补计算题 CSV 行即自动导入，接口已支持）。前端同套代码见 `client.ts` / `RandomDrillSheet.tsx`，改要同步。

### 3.9.1 模拟考试（modules/exam.py，v1.13，均需**考生**令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/api/exam/start` | 开卷：`{category, set_id, qtype, count, duration_minutes}`（category=方向代码/综合；set_id=自定义题库；qtype 空=不限）→ 范围内 `ORDER BY RANDOM() LIMIT count` 抽题，写 `exams`（in_progress，`question_ids` 存试卷快照），返回 `{exam_id, title, total, duration_minutes, questions}`。**题目不带 answer 字段**（防前端偷看，判分在服务端）；空范围 404 |
| POST | `/api/exam/submit` | 交卷：`{exam_id, time_used_seconds, auto, answers:[{question_id, user_answer}]}` → **服务端逐题判分**（strip+upper 比对 `questions.answer`），写 `exam_answers` + `answer_records`（session_id=exam_id，照常进统计/XP/错题机制），更新 exams 为 finished（correct/score/time_used/auto_submitted）。**幂等**：已 finished 的重复提交直接返回已有结果（到点自动交卷在手动之后触发也安全）；未答的题不写行、按错算 |
| GET | `/api/exam/records/{exam_id}` | 试卷回看：`{...成绩摘要, items:[每题完整信息 + answer + my_answer + is_correct]}`，按出卷顺序返回；未答 `my_answer=''`、`is_correct=null`；题目已被删的跳过；只能看自己的（404 兜底） |
| GET | `/api/exam/records?limit=` | 我的考试成绩列表（finished，按 id 倒序）——备用接口，成绩记录页实际走 `/api/user/practice/history` |
| GET | `/api/admin/materials?category=&method=&q=` | 资料库列表（管理端，可按分类/方向/关键词筛选），**带 `view_count`/`fav_count`/`comment_count` 统计与 `has_cover`**。分类常量 `standard` 标准 / `textbook` 教材 / `material` 资料 / `video` 视频 |
| POST | `/api/admin/materials` | 上传资料（**multipart**：file + **cover 选填** + title/category/method/description），扩展名白名单，单文件上限 1GB / 封面 8MB（jpg\|jpeg\|png\|webp）；文件存 `data/uploads/`（随机名），元数据入 `materials` 表 |
| PUT | `/api/admin/materials/{id}` | 修改资料元数据（标题/分类/方向/描述，不换文件） |
| DELETE | `/api/admin/materials/{id}` | 删除资料：连 `data/uploads/` 里的文件、封面与 观看/收藏/评论 三表记录一起删，不可恢复 |
| GET | `/api/admin/materials/{id}/file` | 管理员预览/下载（`?download=1` 附件下载） |
| GET | `/api/admin/materials/{id}/cover` | 管理员预览封面图（未设置 404） |
| POST | `/api/admin/materials/{id}/cover` | 替换封面（multipart cover，老封面文件一起删）；`DELETE` 同路径 = 清除封面（考生端回落视频首帧） |
| GET | `/api/admin/material-comments?material_id=` | 某资料的评论列表（昵称/头像，`dashboard.js` 的「评论」弹窗用） |
| POST | `/api/admin/material-comments` | 管理员回复 / 发表评论（body：`material_id` + `content` + `parent_id?`）：`user_id=0` 落库（考生端昵称「管理员」、考生删不掉），回复挂根评论并给被回复考生发「管理员回复了你的评论」站内通知——后台「视频详情」弹窗用 |
| DELETE | `/api/admin/material-comments/{id}` | 管理员删除评论（违规内容；删顶层评论连回复级联删） |
| GET | `/api/library?category=` | 考生端资料列表（「教材 / 视频」页数据源，按上传时间倒序），**附带播放量/收藏数/`favorited`/`has_cover`**（子查询聚合，非 N+1） |
| GET | `/api/library/favorites` | **我的收藏**（按收藏时间倒序）——⚠️ 本路由必须声明在 `/{material_id}` **之前**，否则被当成 id 解析报 422 |
| GET | `/api/library/history` | **观看历史**（v1.18）：我看过的视频，按最近观看倒序、同一视频去重，条目带 `watched_at`（最近观看时间）/ `my_view_count`（我看过几次）；`hidden=1` 的记录不展示——⚠️ 同样必须声明在 `/{material_id}` 之前 |
| DELETE | `/api/library/history` / `/api/library/history/{id}` | 清空 / 单条移除观看历史：置 `material_views.hidden=1` 隐藏标记，**不删行 → 播放量不变**；考生再看一次新增记录会自动回到历史 |
| GET | `/api/library/{id}` | 资料详情（视频详情页数据源：+ `comment_count`） |
| GET | `/api/library/{id}/file` | 考生取文件：`FileResponse` 自带 **HTTP Range**（视频可拖动）；支持 `?token=` 查询参数鉴权（`<video>`/`<iframe>` 带不了请求头） |
| GET | `/api/library/{id}/cover` | 考生端取管理员封面（未设置 404，前端回落视频首帧） |
| POST | `/api/library/{id}/view` | 记一次播放：插一行 `material_views`，返回最新播放量/收藏数（**每次打开 +1**） |
| POST / DELETE | `/api/library/{id}/favorite` | 收藏 / 取消收藏（联合主键幂等），返回最新 `favorited` + `fav_count` |
| GET / POST | `/api/library/{id}/comments` | 评论列表（**楼中楼**：顶层倒序、每条带 `replies` 正序 + `reply_count`，`total` 含回复；`is_mine` 由考生令牌比对）/ 发表评论或回复（strip 后 1~200 字；带 `parent_id` = 回复，一律归到根评论，`reply_to` 存被回复人昵称快照，**被回复人收到「收到新回复」站内通知**——走 `notifications.py` 的 `create_batch`+`push_notification`，type=notice，自己回自己不发） |
| DELETE | `/api/library/comments/{comment_id}` | 删除自己的评论（别人的 403；**删顶层连回复级联删**；管理员走 `/api/admin/material-comments/{id}`） |

> **判分工具**：`_grade_answer()`（strip + upper 比对），新增题型无需改判分逻辑。
> **试卷快照**：`exams.question_ids` 在开卷那一刻定格，之后题库变动不影响已开的考试。

### 3.10 概览与调试

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/stats` 🔒 | 管理员/考生数量、今日新增、**注册申请统计（pending/total/approved/rejected）**、**密码重置统计（`password_reset`: pending/total/done/rejected）**、活跃会话 |
| GET | `/api/admin/sms-codes?limit=&phone=` 🔒 | 最近短信记录（历史遗留，登录已不用；**界面已移除**，仅接口保留） |
| GET | `/api/health` | 健康检查（含短信模式与数据库路径） |

### 3.11 通知（modules/notifications.py）

**考生端**（前缀 `/api/user/notifications`，需**考生**令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/user/notifications` | 我的通知：`{items[], unread, total}`，按 id 倒序最多 200 条；每条含 `type/title/content/sender/created_at/read/deletable` |
| POST | `/api/user/notifications/{id}/read` | 标记一条已读（`read_at` 用 `COALESCE` 只写第一次） |
| POST | `/api/user/notifications/read-all` | 全部标记已读，返回 `count` |
| DELETE | `/api/user/notifications/{id}` | 删除一条（软删 `deleted=1`）；**系统通知 → 403** |

**管理端**（前缀 `/api/admin/notifications`，需**管理员**令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/notifications/candidates?q=&limit=` | 候选接收考生（**只返回 `status=1` 的已注册考生**，字段仅 id/account/nickname/org/real_name/avatar）——「指定考生」选择器的数据源 |
| POST | `/api/admin/notifications` | 发送：`{scope:'all'\|'one', accounts[], type, title, content}`。`all` = 全部启用考生；`one` = `_dedupe_accounts()` **按账号去重**后逐个校验存在且启用（有非法账号整批拒绝 400）。返回 `{batch_id, count, message}` |
| GET | `/api/admin/notifications?page=&page_size=` | 已发送记录（按批次，隐藏 `hidden=1` 的不显示） |
| DELETE | `/api/admin/notifications/{batch_id}` | 删除后台发送记录（只置 `hidden=1`，**考生已收到的通知保留**） |

> **「一个账号只能发一次」的实现**：同一次发送里账号自动去重（后端 `_dedupe_accounts`，后台选择器也会把已添加的候选置灰），因此同一批里一个账号不会收到两条。
> 给其它模块写通知请用本模块的 `send_system_notice()` / `create_batch()` / `push_notification()`，**不要直接 INSERT `notifications` 表**（否则后台「已发送记录」里看不到）。

### 3.12 密码重置工单（modules/password_resets.py）

| 方法 | 路径 | 权限 | 说明 |
| ---- | ---- | ---- | ---- |
| POST | `/api/auth/password-reset` | **公开** | 考生提交 `{account, org}`。无需登录（忘记密码的人登不进来）；**同一账号重复提交会覆盖原来那条 `pending` 工单**，不堆积；不返回「账号是否存在」，避免探测账号 |
| GET | `/api/admin/password-resets?q=&status=&page=&page_size=` | 🔒 | 工单列表：`{items[], total, pending}`，`pending` 给 Tab 角标用 |
| GET | `/api/admin/password-resets/{id}` | 🔒 | 工单详情 |
| POST | `/api/admin/password-resets/{id}/approve` | 🔒 | 处理：`{new_password?}` 留空则由 `security.new_random_password(8)` 生成 → 更新 `password_hash` → **踢掉该考生全部会话** → 以**系统通知**把新密码发给考生（正文含新密码）→ 工单置 `done`。返回 `{account, new_password, message}` 供管理员转达 |
| POST | `/api/admin/password-resets/{id}/reject` | 🔒 | 拒绝 `{reason}`；考生密码不变、不收到通知 |
| DELETE | `/api/admin/password-resets/{id}` | 🔒 | 删除工单记录（不影响考生当前密码） |

> 出错边界：工单已是 `done`/`rejected` → 400「不能重复处理」；账号不存在 / 已禁用 → 400（不自动建号）；新密码 < 6 位 → 400。

---

## 4. Service 索引（内部函数，不对外暴露）

| 模块 | 函数 | 职责 |
| ---- | ---- | ---- |
| `security.py` | `hash_password` / `verify_password` | PBKDF2-HMAC-SHA256 + 随机盐；`compare_digest` 防时序攻击 |
| `security.py` | `new_token` / `new_sms_code` / `new_captcha_code` / `new_random_password` | 43 字符令牌 / 6 位数字码 / 4 位图形码（去易混字符 0O1I）/ 8 位随机密码（重置考生密码用） |
| `database.py` | `get_meta` / `set_meta` / `_backfill_profile_defaults` | 一次性任务的执行标记读写；给历史账号补随机昵称与头像（只跑一次） |
| `deps.py` | `create_session` / `revoke_session` / `resolve_session` / `bearer_token` | 令牌签发、吊销、校验（含过期清理）、从请求取令牌 |
| `deps.py` | `get_current_admin` / `get_current_user` | FastAPI 依赖；校验状态、剔除密码哈希、401/403 |
| `captcha.py` | `generate()` / `verify(id, code)` / `_build_svg(code)` | 生成并落库 → 返回 base64 SVG；校验一次性作废；换第三方验证码只改这两个函数 |
| `profile_defaults.py` | `random_nickname()` / `random_avatar()` | 建号时的随机资料：形容词×名词（120 种）随机昵称；`preset:<1..N>` 随机头像 |
| `user_profile.py` | `get_my_profile()` / `update_my_profile()` | 考生取/改自己的昵称与头像；只能改自己（走 `get_current_user` 的 `subject_id`） |
| `registrations.py` | `register()` / `approve_registration()` / `reject_registration()` | 提交申请（校验图形码 + 账号唯一）；通过时写 `user_accounts`；拒绝记原因 |
| `auth.py` | `password_login` / `change_password` | 先查管理员再查考生；改密码后删除本人全部会话 |
| `overview.py` | `stats()` | 只读统计，含注册申请与密码重置各自的计数 |
| `notifications.py` | `new_batch_id()` / `create_batch()` / `push_notification()` / `send_system_notice()` | 写通知的**唯一入口**：生成批次 id、写批次记录、给某个考生写一条通知、给单个考生发系统通知（密码重置用）。其它模块别直接 INSERT `notifications` |
| `notifications.py` | `_dedupe_accounts()` / `candidateHtml`（前端） | 按账号去重（保证「同一个号只发一次」）；后台选择器渲染候选 |
| `password_resets.py` | `apply_password_reset()` / `approve_reset()` / `reject_reset()` | 提交（同账号覆盖旧 pending 工单）/ 处理（重置密码 + 发系统通知 + 踢会话）/ 拒绝 |
| `sms.py` | `send_code` / `verify_code` / `_send_via_tencent` | 短信发送与校验；换服务商只改 `_send_via_tencent` |
| `admin_accounts.py` | `_count_active_supers` | 护栏用：统计启用状态的超管数 |
| `user_accounts.py` / `registrations.py` | `_public` | 剔除密码哈希、补充 `has_password` |

---

## 5. 功能独立性表（改一个不影响别的）

| 功能 | 涉及文件 | 独立可改？ | 说明 |
| ---- | ---- | ---- | ---- |
| 管理员账号 CRUD | `modules/admin_accounts.py` + 后台「管理员账号」Tab | ✅ | 只依赖 `database/deps/security` 公共层 |
| **注册申请与审核** | `modules/registrations.py` + 后台「注册申请」Tab | ✅ | 通过时才写 `user_accounts`，与考生 CRUD 无耦合 |
| **图形验证码** | `modules/captcha.py` | ✅ | 换第三方验证码只改 `generate()` / `verify()` |
| 考生账号 CRUD | `modules/user_accounts.py` + 后台「考生账号」Tab | ✅ | 与管理员模块无耦合 |
| **考生个人资料（昵称/头像）** | `modules/user_profile.py`（写）+ `profile_defaults.py`（默认值） | ✅ | 考生只能改自己；后台改同一批字段走 `user_accounts.py`，两边互不影响 |
| 预设头像图案 / 数量 | `src/data/avatars.ts` + `server/profile_defaults.py` + `dashboard.js` | ⚠️ | 三处共用一份「顺序即序号」的约定，改必须同步（只能末尾追加） |
| 改自己的密码 | `modules/auth.py` 的 `change_password` + 后台顶栏按钮 | ✅ | 只碰 `admin_accounts` + `sessions` |
| 登录鉴权 | `modules/auth.py` | ✅ | 不碰任何账号 CRUD |
| 短信验证码 | `modules/sms.py` | ✅ | 当前不在登录链路里；换服务商只改 `_send_via_tencent` |
| **通知中心（收发通知）** | `modules/notifications.py` + 后台「通知管理」Tab + 前端 `useNotifications` | ✅ | 只写 `notifications` / `notification_batches`；读 `user_accounts` 拿接收人 |
| **密码重置工单** | `modules/password_resets.py` + 后台「密码重置」Tab + `PasswordResetSheet` | ⚠️ | 处理时会调 `notifications.send_system_notice()` 发系统通知，并改 `user_accounts.password_hash`（唯一对外耦合点） |
| 概览统计 | `modules/overview.py` | ✅ | 只读，不影响任何写操作 |
| 前端登录 / 注册页 | `src/screens/LoginScreen.tsx` + `src/api/client.ts` | ✅ | 只依赖 `/api/auth/*` |
| 协议页面 | `src/screens/LegalScreen.tsx` + `src/data/legal.ts` | ✅ | 纯静态文字，与后端无关 |

---

## 6. 错误码约定

| HTTP | 语义 | 前端展示 |
| ---- | ---- | ---- |
| 400 | 参数/业务规则不满足（图形验证码错误、密码不一致、护栏拦截、重复审核） | 直接展示 `detail` |
| 401 | 未登录 / 令牌失效 / 账号密码错误 | 前端清登录态，跳登录页 |
| 403 | 已登录但被拒绝（账号被禁用） | 直接展示 `detail` |
| 404 | 资源不存在（申请/账号不存在） | 直接展示 `detail` |
| 409 | 唯一约束冲突（账号/用户名已存在，或已提交待审） | 直接展示 `detail` |
| 422 | Pydantic 参数校验失败 | 拼接字段提示 |

> 所有错误的可读文案都在 `detail` 字段，前端 `src/api/client.ts` 已统一转成中文提示。

---

## 7. 安全设计（改代码时不要破坏）

1. **密码**：只存 PBKDF2 哈希（20 万次迭代 + 16 字节随机盐），永不存明文、永不回传给前端
   - 例外：`registrations.password_hash` 是考生注册时设的密码哈希，审核通过时**直接搬过去**，管理员也可在通过时另指定
2. **令牌**：`secrets.token_urlsafe(32)`，存 `sessions` 表并带过期时间；改密码 / 禁用 / 改角色 → 该账号所有会话立即删除
3. **越权**：所有 `/api/admin/**` 挂 `get_current_admin`；考生数据靠 `subject_id` 隔离
4. **护栏**：不能删除/禁用自己；不能删除、禁用或降级「最后一个启用状态的超管」
5. **注册风控**：图形验证码一次性 + 5 分钟有效；账号唯一性同时校验 `user_accounts` 与「待审中」的申请；**未审核通过一律不能登录**
6. **密钥**：`server/config.json` 已 gitignore，绝不提交、绝不进前端代码

---

## 8. 短信：腾讯云对接与本地降级（当前不在登录链路）

| 模式 | 触发条件 | 行为 |
| ---- | ---- | ---- |
| `tencent` | `config.json` 的 `secret_id/secret_key/sdk_app_id/sign_name/template_id` **五项全非空** | 调腾讯云 SMS 真发 |
| `local` | 任一为空（当前默认） | 不调腾讯云；验证码打印到控制台 + 存库（后台调试页已移除，看服务端控制台或 `sms_codes` 表） |

**若将来要重新启用短信**（腾讯云侧要先做的事）：

1. 完成账号实名认证（个人认证首次开通赠 100 条，企业 200 条，3 个月有效）
2. 开通短信服务并 **0 元领取赠送套餐包**（无套餐包余额会报错 1031）
3. 创建**短信签名**并等审核通过（国内短信必须带 `【签名】`）
4. 创建**正文模板**并等审核通过，模板形如「您的验证码是 {1}，{2} 分钟内有效。」→ 参数顺序必须与 `sms.py` 里 `TemplateParamSet = [code, ttl_minutes]` 一致
5. 在访问管理里创建子账号密钥（建议只授短信权限）拿到 `SecretId` / `SecretKey`

---

## 9. 修改定位表

| 需求关键词 | 定位 |
| ---- | ---- |
| 端口 / 数据库路径 / 令牌有效期 / 验证码风控参数 / 允许的前端来源 | `server/config.json`（默认值见 `config.py`） |
| 图形验证码样式 / 位数 / 有效期 | `server/modules/captcha.py`（`_build_svg`）+ `config.captcha` |
| 注册字段 / 审核规则 / 通过时建号的默认值 | `server/modules/registrations.py` |
| 新增一张表 / 加字段 | `server/database.py`（`SCHEMA` + `_migrate()`） |
| **一次性数据补齐 / 老数据迁移脚本** | `server/database.py` 的 `_backfill_*()` + `get_meta/set_meta`（**必须打标记**，否则每次启动重跑） |
| 新增一个接口 | 加到对应 `server/modules/*.py` 的 APIRouter；新模块还要在 `main.py` include 进来 |
| 管理员账号逻辑 / 护栏 | `server/modules/admin_accounts.py` |
| 考生账号逻辑 / 单位学校字段 | `server/modules/user_accounts.py` |
| **考生改自己的昵称 / 头像** | `server/modules/user_profile.py` |
| **考生改自己的密码 / 登录账号** | `server/modules/user_security.py` |
| **App 通知中心 / 管理员发通知** | `server/modules/notifications.py` + 后台「通知管理」Tab（`dashboard.html` / `dashboard.js`）+ 前端 `src/hooks/useNotifications.ts` / `src/data/notifications.ts` |
| **通知类型（system 不可删 / notice 可删）** | `server/modules/notifications.py` 的 `TYPES` + 前端 `src/data/notifications.ts` 的 `NOTIFICATION_TYPE_LABEL` + 后台「通知管理」下拉，**三处要一起改** |
| **密码重置工单（考生申请 / 管理员处理）** | `server/modules/password_resets.py` + `src/components/PasswordResetSheet.tsx` + 后台「密码重置」Tab |
| 「已发送记录」列表 / 按批次删记录 | `notifications.py` 的 `list_batches()` / `delete_batch()`（删记录只置 `hidden=1`，考生端保留） |
| **检查更新 / 版本号** | `server/modules/app_update.py` + `server/data/version.json`（后端）+ `src/data/appVersion.ts` + `src/screens/SettingsScreen.tsx`（前端） |
| **题库导入 / 题库概览** | `server/modules/bank.py`（`ensure_bank_imported()` 表空才导；CSV 在 `server/data/question_bank.csv`；`METHOD_NAMES` 是方向→中文名唯一映射） |
| **资料库（上传/封面/统计）** | `server/modules/materials.py`（分类常量 `MATERIAL_CATEGORIES` 与后台 dashboard.js、前端 MaterialsScreen 三处同步）；文件在 `server/data/uploads/` |
| **视频播放量 / 收藏 / 评论** | `materials.py` 的 `material_views` / `material_favorites` / `material_comments` 表与 `/api/library/{id}/view|favorite|comments` 接口；管理端评论管理走 `/api/admin/material-comments` |
| **出题 / 交卷 / 首页统计 / 错题本** | `server/modules/practice.py`（`DAILY_GOAL=60` 与首页进度环一致；统计口径只算 `kind='answer'`；时长按 `session_id` 去重求和；「已掌握」=最近一条记录 `is_correct=1`，含 master 记录） |
| **随机的默认昵称 / 预设头像数量** | `server/profile_defaults.py` |
| **预设头像的图案与配色** | `src/data/avatars.ts`（前端）+ `dashboard.js` 顶部 `AVATAR_PRESETS`（后台）—— 两边顺序必须一致 |
| 登录方式 / 改自己的密码 | `server/modules/auth.py` |
| 验证码发送 / 换短信服务商 | `server/modules/sms.py`（只改 `_send_via_tencent`） |
| 后台页面样式 | `server/static/style.css` |
| 后台页面逻辑 / 表格列 / 弹窗 | `server/static/dashboard.js`、`dashboard.html` |
| 前端调接口的封装 | `src/api/client.ts` |
| 登录 / 注册页交互 | `src/screens/LoginScreen.tsx` |
| 协议正文 | `src/data/legal.ts` |

---

## 10. 启动与验证

```bash
# 方式一：双击
server/启动服务.bat

# 方式二：手动
cd server
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy config.example.json config.json
.venv\Scripts\python main.py
```

- 管理后台：http://127.0.0.1:8000/admin/ （首次 admin / admin123，登录后建议立即改密码）
- 接口文档：http://127.0.0.1:8000/docs
- 前端开发：项目根 `npm run dev`（:8443），`/api` 自动代理到 :8000

**验证记录（2026-09-30 练习进度续做）**：隔离副本端到端自测 **8/8 通过** —— 初始无进度 `has_progress=false`、POST 保存进度、GET 读回（question_ids/answers/current_index 一致）、DELETE 删除（deleted=1）、删除后无进度、删除不存在进度 `deleted=0`、**用户隔离（A 不能读/删 B 的进度，B 删除 deleted=0，A 进度仍在）**、无令牌 401。**老库平滑升级**：删掉 `practice_progress` 表后重启自动重建。前端 `tsc` 无错误、`npm run build` 通过。

**验证记录（2026-09-29 v1.7）**：章节练习 / 分块 / 做题状态 / 清除记录 隔离副本端到端自测 **25/25 通过** ——
UT 章节列表（4 章节、合计 470 题、字段齐全）、24 组分块（每组 20 题）、block=0/1 出题（id 升序、不重叠）、
章节过滤出题（topic 全匹配）、交卷后 `my_state` 对绿错红保留、blocks 统计（对15/错5）、章节 answered 更新、
**清除记录**（cleared=20、my_state 归零、blocks 归零）→ **重新做**（再交卷状态更新）、
账号隔离、清除越界组 404、未登录 401。

**验证记录（2026-09-29 v1.6）**：学习报告 + 题库搜索 + 统计补全隔离副本端到端自测 **20/20 通过** ——
report 空状态（calendar 35 天全 0）、period=month 30 天、非法 period 422、summary 新字段（total_correct/accuracy/duration + xp/level）、
搜索「检测」1262 题 / 不存在关键词空结果 / 未登录 401、交卷 30 题后 report 汇总（30 题 73%、日历当天 30、按方向掌握度、XP=30）、
summary 汇总一致、**账号隔离（B 账号 report/XP 全 0）**、未登录 401。
前端 `npx tsc --noEmit` 无错误、`npm run build` 通过；`src/data/mockData.ts` 已删除。

**验证记录（2026-09-29 v1.5）**：题库 + 练习 + 统计隔离副本端到端自测 **41/41 通过** ——
健康检查、管理员登录建号、题库导入 1740 题（MT 419 / PT 425 / RT 426 / UT 470）、
题库概览与已做题量、顺序出题（按 id 递增、方向过滤）、随机出题、综合方向、不存在方向空列表、
无令牌 401、交卷 20 条保存、空提交 400、无效题目 400、统计（今日 20/8、正确率 40%、
本周 20、时长 600s）、学习时长按 session 去重（600+300=900s 而非逐行相加）、待复习错题 12、
连续打卡、成就（破冰者已得 / 百题斩进度 20 / 全对成就需≥10 题）、
错题本 12 道 + 标记已掌握（master 后 mastered=true 且不计入统计题量）、错题重练出题排除已掌握、
**账号数据隔离（B 的统计/错题/已做题量全为 0）**、管理员令牌调考生接口 401。
前端 `npx tsc --noEmit` 无错误、`npm run build` 通过。真实库重启后自动建表并导入 1740 题，原有考生数据零影响。

**验证记录（2026-09-29 v1.3）**：账号安全 + 版本接口全链路自测 **29/29 通过** ——
`GET /api/app/version` 公开可取且字段齐全；改密码分支（原密码错 400 / 两次不一致 400 / 新旧相同 400 /
新密码过短 422 / 无令牌 401 / 管理员令牌调考生接口 401 / 正确修改 200 / **旧令牌立即失效 401** /
旧密码不能再登录 / 新密码可登录）；改账号分支（过短 422 / 含非法字符 422 / 与原账号相同 400 /
密码错误 400 / 占用管理员用户名 409 / 正确改名 200 且返回新账号 / 改名后旧账号不能登录、新账号可登录 /
**会话保留、昵称头像未丢**）；回归：图形验证码、后台考生列表均正常；
服务版本 1.2.0 → 1.3.0，后端已用系统 Python 3.10 重启后验证（先杀旧进程再起）。
前端 `npx tsc --noEmit` 无错误、`npm run build` 通过，产物 CSS 含 46 处 `[data-theme=dark]` 选择器。

**验证记录（2026-09-29 v1.2）**：昵称头像全链路自测 **42/42 通过** ——
老库自动补出 `avatar` 列、建号时昵称/头像留空自动随机（随机性抽样通过）、
考生登录响应带昵称与头像、`GET/PUT /api/user/profile` 取改、落库确认（直查 SQLite）、
重新登录拿到新值、上传 data URL 头像、清空头像回到首字、昵称传空白不被清掉、
空请求体 400、昵称超长 422、后台可取详情/可改/列表可见、
无令牌 401、管理员令牌调考生接口 401、考生令牌改他人 401、自测数据已清理。
**历史账号补齐实测**：启动时自动为 3 个老账号补随机昵称与头像（`123456`→「细致的检测员」、
`wdfd`→「冷静的波形」），其中管理员已改过昵称的 `syl1`（昵称 `11`）**未被覆盖**，只补了头像；
连续调用 `init_db()` 三次数据不再变化，`app_meta` 标记 `profile_defaults_backfilled=1` 生效。
前端 `npx tsc --noEmit` 无错误、`npm run build` 通过（37 modules）；
后台 6 个静态资源全部 200，`dashboard.html` 已含「头像 / 昵称」列、`style.css` 含 `.ava` 样式。

**验证记录（2026-09-29 v1.1）**：后端全链路自测 **53/53 通过** ——
图形验证码生成与校验、注册异常分支（验证码错误 / 两次密码不一致 / 账号过短 / 重复提交）、
注册提交、申请列表/详情/筛选/搜索、审核通过自动建号、审核拒绝、重复审核拦截、
考生登录、管理员改考生密码（旧会话被踢）、管理员改自己密码（旧令牌失效 + 新密码可登录）、
删除申请、无令牌/越权访问被拦、不能删除当前登录管理员。
前端 `npx tsc --noEmit` 无错误、`npm run build` 通过（34 modules）；
后台 6 个静态资源全部 200；图形验证码输出为合法 SVG（4 字符 + 干扰线）。

---

## 11. 变更历史

| 日期 | 变更 |
| ---- | ---- |
| 2026-09-30 | **v1.18 成就勋章 + 观看历史 + 管理员视频评论闭环**：① 新增 `modules/achievements.py`：`GET /api/user/achievements` 完整成就目录（17 枚，分类 答题/坚持/考试/错题/资料 + 品级 铜银金 + 进度/解锁状态 + `recent_earned`），全部实时算自现有表（判据口径与 practice/materials 一致：时长按 session 去重、已掌握=最近一条答对、待复习排除 wrong_dismissals）；`build_achievements(conn, uid)` 供复用——**practice.py 的 stats_summary 改为调用它取前 6 枚做首页预览**（目录顺序前 6 枚即原预览，行为不变），并新增 `ach_earned`/`ach_total` 完整口径字段。⚠️ 循环 import 约束：achievements.py 不得 import practice（practice 依赖它）， streak/时长判据为故意重复实现。② `database.py`：`material_views` 加 `hidden` 列（建表 + `_migrate()` patches 双写，老库启动自动补列）。③ `materials.py` 考生端新增 `GET /api/library/history`（我看过的视频，按最近观看倒序、同一视频去重，带 `watched_at`/`my_view_count`；hidden=1 的不展示）与 `DELETE /api/library/history`、`DELETE /api/library/history/{id}`（清空/移除 = 置隐藏标记，**不删行 → 播放量不变**；再看一次新增记录自动回到历史）。⚠️ `/history` 同样必须声明在 `/{material_id}` 之前。④ 管理端评论新增 `POST /api/admin/material-comments`（管理员回复/发评论：`user_id=0` 落库，`_comment_public` 判 user_id=0 → 昵称「管理员」，考生删不掉；回复挂根评论 + 被回复考生收「管理员回复了你的评论」站内通知）。⑤ `main.py` 挂载 achievements.router。前端配套见 `FRONTEND.md` §15 v18（AchievementsScreen / WatchHistoryScreen / 后台视频详情弹窗）。校验：隔离副本 API e2e 全过（成就 17 枚判据逐条核对、历史去重/单条移除/清空且播放量不变/重复移除 404/再看自动恢复、管理员评论发回删级联、老库删列重建迁移），playwright UI 全流程 + 深浅双色截图，`tsc` + build 通过；真实 8000 热重载已生效、真实库迁移完成（原 11 条观看记录未动）。 |
| 2026-09-30 | **v1.17 评论楼中楼 + 回复通知**：① `database.py`：`material_comments` 加 `parent_id`(INTEGER 0=顶层) 与 `reply_to`(TEXT 昵称快照) 两列（建表语句与 `_migrate()` patches 双写，老库启动自动补列）。② `materials.py`：`GET /{id}/comments` 改楼中楼结构（顶层倒序 + `replies` 正序 + `reply_count`，`total` 含全部行；根评论被删后的孤儿回复不单独展示）；`POST /{id}/comments` 支持 `parent_id`——回复一律挂根评论（两层），`reply_to` 快照被回复人昵称，**回复他人时给对方发「收到新回复」站内通知**（走 `notifications.py` 的 `create_batch`+`push_notification`，type=notice 可删，自己回自己不发）；考生删自己评论 / 管理员删评论**顶层连回复级联删**。③ 前端配套见 `FRONTEND.md` §15 v17（VideoDetailScreen 楼中楼、DocViewer z-[60] 修复导航遮挡）。校验：隔离副本 API e2e **17/17**（回复挂根/回复的回复归根/双方收通知/自回不发/级联删/越权 403/取消收藏库同步/管理员删顶层级联/回复不存在 404），UI 全流程截图验证，`tsc` + build 通过；真实 8000 后端热重载、迁移已生效。 |
| 2026-09-30 | **v1.16 视频互动闭环（封面 / 播放量 / 收藏 / 评论）**：① `database.py`：`materials` 加 `cover_name` 列（`_migrate()` 老库自动补）；新增 `material_views`（播放记录，播放量=COUNT(*)，**每次打开 +1**）/ `material_favorites`（收藏，material_id+user_id 联合主键幂等）/ `material_comments`（评论）三表 + 3 索引（纯新增，启动即建）。② `modules/materials.py` 扩展：管理端列表带 `view_count/fav_count/comment_count/has_cover` 统计（子查询聚合）；上传支持可选 `cover`（jpg/jpeg/png/webp ≤8MB）；`GET/POST/DELETE /{id}/cover` 预览/替换/清除封面（换/清都删老文件）；删除资料**级联清**三张互动表与磁盘文件；新增独立前缀 `admin_comment_router`（`GET/DELETE /api/admin/material-comments`，管理端评论管理）。③ 考生端：`GET /{id}` 详情、`GET /{id}/cover` 封面图、`POST /{id}/view` 记播放、`POST/DELETE /{id}/favorite` 收藏切换、`GET/POST /{id}/comments` 评论列表/发表（1~200 字，即时可见）、`DELETE /comments/{id}` 删自己的（403 越权）、`GET /favorites` 我的收藏。⚠️ **`/favorites` 必须声明在 `/{material_id}` 之前**，否则被当成 id 解析报 422。④ 后台 `dashboard.js/html/style.css`：资料表加 封面缩略图 / 播放量 / 收藏数 / 评论 列；上传弹窗加「封面图（选填）」；编辑弹窗可换封面或勾选「清除封面」；新增「评论」弹窗（列表 + 删除违规评论）。前端配套见 `FRONTEND.md` §15 v16（VideoDetailScreen / VideoCard / FavoriteVideosScreen）。校验：隔离副本 API e2e **29/29**（播放累计/收藏幂等/越权 401/封面 404/非法封面 400/级联清理），UI 全流程截图验证，`tsc` + build 通过。 |
| 2026-09-29 | **v1.14 题目纠错工单 + 内置一级题库进后台 + 修题库管理 Bug**：① **⚠️ 修复 v1.12 严重 Bug**：`dashboard.js` 的 `loadQuestionSets()` 把 `data-act` 按钮动作**直接调用**而不是 `addEventListener` 绑定——每次列表加载都会自动打开编辑弹窗/触发删除确认框，而用户点按钮反而无效（后台新建题库"不正常"的根因）。② **内置一级题库进后台**：`question_sets.py` 定义 `BUILTIN_SETS`（**伪 id 约定：UT=-1 / RT=-2 / MT=-3 / PT=-4，跨端一致**），`GET /api/admin/question-sets` 返回内置+自定义（内置带 `builtin:true`）；题目查/增/删/改用 `_scope_where()` 统一（内置= `set_id IS NULL AND method=?`）；内置题库**不可改名/删除（400）**，题目可增删查改 + CSV 导入。③ 新增 **PUT `/api/admin/question-sets/{id}/questions/{qid}`**（编辑单题：题型/题干/选项/答案，`_build_question()`+`_normalize_answer()` 校验；**编辑会自动关闭该题的 pending 纠错工单**）。④ 新增 `modules/question_reports.py` + `question_reports` 表（纯新增）：考生 `POST /api/user/question-reports`（question_id+suggested_answer+reason，**同考生同题 pending 覆盖**）；管理端 `GET ?status=pending|resolved|dismissed|all`（JOIN 题目全文+考生账号，`question.set_id` 字段直接给编辑接口用的题库 id）、`POST /{id}/handle`（apply=**采纳：直接改 questions.answer**（judge/single 校验答案合法）+ 关单；dismiss=忽略）、`DELETE /{id}`。隔离副本 e2e 43/43 全过；playwright UI 终验（无弹窗残留/新建题库/内置题库 470 题可查可改/工单 Tab）。 |
| 2026-09-29 | **v1.13 模拟考试（开卷 / 服务端判分 / 试卷回看）**：① `database.py` 新增 `exams`（一次开卷一行，**id 是 TEXT `ex`+hex，同时作为 answer_records.session_id**，含 question_ids 试卷快照 / duration_minutes / score / auto_submitted 等）与 `exam_answers`（作答明细，exam_id+question_id 联合主键）两表 + 2 个索引（纯新增，老库启动即建）。② 新增 `modules/exam.py`：`POST /api/exam/start`（按 方向/自定义题库 + qtype 随机抽题，**返回题目不带 answer 防偷看**，试卷快照定格）、`POST /api/exam/submit`（**服务端判分** `_grade_answer()` strip+upper 比对；写 exam_answers + answer_records（照常进统计/XP/错题机制）+ exams 置 finished（score 百分制）；**幂等**——重复提交/到点自动交卷后手动提交返回已有结果）、`GET /api/exam/records/{id}`（试卷回看：完整题目 + 正确答案 + my_answer + is_correct，未答 my_answer=''、is_correct=null）、`GET /api/exam/records`（成绩列表，备用）。③ `practice.py` 的 `/api/user/practice/history` LEFT JOIN exams 带出 `is_exam/score/exam_title`（考试成绩自然汇入成绩记录页）。④ `main.py` 注册 exam router。隔离副本 e2e 21/21 全过（判分自洽/未答口径/幂等/越权 401）。前端配套见 `FRONTEND.md` §15 v13。 |
| 2026-09-29 | **v1.12 自定义题库（管理后台题库管理 + 考生端动态获取）**：① `database.py` 新增 `question_sets` 表（id/name/level/description）与 `questions.set_id` 列（**NULL = 内置一级题库**；老库由 `_migrate()` 自动补列）。⚠️ **修复迁移顺序**：`init_db()` 改为先 `_migrate()` 再 `executescript(SCHEMA)`，否则老库建 `idx_q_set` 索引时 set_id 列还不存在会报错。② 新增 `modules/question_sets.py`：管理端 `GET/POST/PUT/DELETE /api/admin/question-sets`（重名 409；删除题库连题目与答题记录一起删）、`GET/POST /{id}/questions`（单题添加：判断题自动生成 正确/错误 选项、选择题 ≥2 选项、简答题无选项答案=参考答案）、`POST /{id}/import`（CSV 批量导入，**与内置一级题库同 8 列格式**，兼容 4 列简式，异常行跳过并返回 errors）、`DELETE /{id}/questions/{qid}`；考生端 `GET /api/bank/sets`（只返回有题的题库）。③ 自定义题库题目 `method='ZD'`（`METHOD_NAMES['ZD']='自定义题库'`）、`grade=题库级别`；`practice.py` 出题/blocks/reset 新增 `set_id` 参数（qtype 筛选扩到 `short`）。④ **题型扩到四种**：`QTYPE_NAMES` = judge/single/calc/**short 简答题**（`_normalize_qtype` 认「简答/问答」）。后台 `dashboard.html/js` 新增「题库管理」Tab（题库表格 + 新建/编辑/删除 + 题目管理弹窗按题型分组可删单题 + 添加题目表单 + CSV 粘贴/文件导入）。隔离副本 e2e 30/30 全过；老库迁移验证：仅新增 question_sets 表、1740 题行数不变。 |
| 2026-09-29 | **v1.11 随机刷题选题型 + 错题集可删除**：① `bank.py`：`_normalize_qtype()`（CSV 题目类型归一：判断题→judge、含「计算」→calc、其余→single）+ `QTYPE_NAMES` 常量；`/api/bank/summary` 新增 `qtype_counts`（方向×题型矩阵，前端随机刷题选择器用）。② `practice.py`：`GET /api/practice/questions` 新增 `qtype` 参数（judge\|single\|calc，三种 mode 都支持筛选）；新增 `DELETE /api/user/wrong-questions/{id}`（错题集删除）；`_wrong_question_ids()`、错题本列表、待复习数三条口径都排除已删除的题；`submit()` 交卷时清掉本次答题涉及题目的删除标记（再答错会重新出现在错题集）。③ `database.py` 新增 `wrong_dismissals` 表（user_id+question_id 联合主键，纯新增，老库启动即建，实测原数据零影响）。**当前 CSV 只有判断题 895 + 单选题 845，计算题为 0 题（接口已预留）**。隔离副本 e2e 23/23 全过（qtype 筛选/删除错题/待复习数口径/再答错恢复/401）。前端配套见 `FRONTEND.md` §15 v11。 |
| 2026-09-29 | **v1.7 章节练习 + 分块顺序练习 + 做题导航 + 清除记录**：`practice.py` 的 `get_questions` 新增 `topic`（topic1 章节过滤）与 `block`（顺序按 id 升序分块，block=N 取第 N+1 组）参数，每题返回 `my_state`（我最近一次对/错，保留到清除）；新增 `GET /api/practice/blocks`（每组 未做/对/错 统计）与 `POST /api/practice/reset`（删除该组我的答题记录，可重新做）；`bank.py` 新增 `GET /api/bank/chapters`（topic1 分组章节列表）。内部抽出 `_scope_where/_scope_ids/_last_state_map` 三个工具。配套前端：题库页点击题库先弹「选择练习方式」面板（顺序练习分块列表 / 按章节练习，每组显示对错未做、垃圾桶两步确认清除）；答题页顶栏新增题目导航（网格题号跳题，对绿错红持久化，可清除本组记录重做）。自测 25/25。 |
| 2026-09-29 | **v1.6 题库页 / 学习报告 / 个人中心实时化（服务 1.5.0 → 1.6.0）**：`practice.py` 新增 `GET /api/user/stats/report?period=week|month`（周期汇总 + 近 35 天学习日历 + 各方向掌握度，学习报告页数据源）；`stats/summary` 补全量字段（`total_correct/total_accuracy/total_duration_seconds`）与 XP 等级（`xp/xp_in_level/xp_level_max/level`，每答 1 题 1 经验、每 200 题升 1 级，纯实时推导不入库）；`bank.py` 新增 `GET /api/bank/search`（题干/知识点 LIKE 搜索，考生只读）。配套前端：`QuestionBankScreen`（概览/方法卡/训练集推导/搜索防抖全实时，假"难度/等级"筛选删除）、`LearningScreen`（周期切换真实拉取、日历/掌握度/学习建议全实时）、`ProfileScreen`（统计/成就/经验/菜单副标题全实时）；`src/data/mockData.ts` 删除，前端无 Mock。自测 20/20（见验证记录）。 |
| 2026-09-29 | **v1.5 题库入库 + 练习/统计/错题（服务 1.4.0 → 1.5.0）**：`database.py` 新增 `questions`（题库）与 `answer_records`（答题记录，按 user_id 隔离）两表 + 4 个索引（纯新增，老库启动即建）；新增 `modules/bank.py`（启动时从 `data/question_bank.csv` 导入 1740 题，**表空才导**幂等；`GET /api/bank/summary` 概览含我的已做题量）与 `modules/practice.py`（`GET /api/practice/questions` 顺序/随机/错题出题、`POST /api/practice/submit` 交卷写 `answer_records`、`GET /api/user/stats/summary` 首页统计（今日/连续打卡/近 7 天/成就，实时计算）、`GET /api/user/wrong-questions` 错题本、`POST /api/user/wrong-questions/{id}/master` 标记掌握）；`main.py` 注册 3 个 router 并在 lifespan 里调 `ensure_bank_imported()`。**考生端对题库只读**，修改仅管理侧。CSV 坑：选项键的 `﹑`(U+FE51) 分隔符（40 行 PT 用了它）、插图 `<img>` → 「【图】」。 |
| 2026-09-29 | **v1.4 通知中心 + 密码重置工单（本版把阶段一界面接上真实后端）**：新增 `modules/notifications.py`（考生端 `GET /api/user/notifications`、`{id}/read`、`read-all`、`DELETE {id}`（系统通知 403）；管理端 `GET /candidates` 候选考生搜索、`POST /api/admin/notifications`（`scope=all` 全部启用考生 / `scope=one` + `accounts[]`，**按账号去重**后逐个校验）、`GET` 已发送记录（按批次）、`DELETE {batch_id}` 只置 `hidden`）+ 新增 `modules/password_resets.py`（公开 `POST /api/auth/password-reset`，**同账号重复提交覆盖旧 pending 工单**、不泄露账号是否存在；管理端列表/详情/`approve`（重置密码 + 踢会话 + 发含新密码的系统通知）/`reject`/`DELETE`）。`database.py` 新增 3 张表（`notifications` / `notification_batches` / `password_resets`）与 4 个索引（纯新增，老库启动即建，实测原数据零影响）；`security.py` 新增 `new_random_password()`；`overview.py` 的 `/api/admin/stats` 增加 `password_reset` 统计；`main.py` 注册 4 个 router，服务版本 1.3.0 → 1.4.0。后台 `dashboard.js` 删除全部 `DEMO_*` 演示数据改为真实接口，「指定考生」从手输账号改为**可搜索多选**（300ms 防抖，已添加的候选置灰），「已发送记录」表头改为 类型/接收对象/标题/内容/发送人/发送时间/操作。端到端自测 46 项全通过（隔离副本 + 全新库）。 |
| 2026-09-29 | **v1.3 账号安全 + 版本更新**：新增 `modules/user_security.py`（`POST /api/user/password` 改自己的密码并吊销本人会话、`POST /api/user/account` 改自己的登录账号并做唯一性校验，含避开管理员用户名）；新增 `modules/app_update.py` + `data/version.json`（`GET /api/app/version` 公开接口，供前端「检查更新」比对）；`main.py` 注册两个新路由，服务版本 1.2.0 → 1.3.0。前端配套见 `FRONTEND.md` §15（设置页重做 + 深色模式）。 |
| 2026-09-29 | **v1.2 考生个人资料（昵称/头像）**：`user_accounts` 新增 `avatar` 列（老库自动 `ADD COLUMN` 迁移）；新增 `profile_defaults.py`（随机昵称 120 种组合 + 随机预设头像）；新增 `modules/user_profile.py`（`GET/PUT /api/user/profile`，考生只能改自己）；建号（注册审核通过 / 管理员手动开号）昵称头像留空时**改为随机生成**（原先昵称兜底用账号）；新增 `app_meta` 表与 `get_meta/set_meta`，并用 `_backfill_profile_defaults()` **一次性**给历史老账号补随机昵称与头像（不覆盖已改过的资料，打标记防重跑）；后台「考生账号」表格新增「头像 / 昵称」列、编辑弹窗新增头像下拉与当前头像预览；`style.css` 新增 `.ava` 头像样式；`init_db()` 返回值改为汇总式说明；服务版本 1.1.0 → 1.2.0。 |
| 2026-09-29 | **管理后台精简**：移除「验证码调试」Tab（HTML 面板 + JS 模块一并删除，`dashboard.html` 211→181 行、`dashboard.js` 827→779 行）。后台现为三个 Tab：管理员账号 / 注册申请 / 考生账号。后端 `sms.py` 与 `/api/admin/sms-codes` 接口保留待复用。 |
| 2026-09-29 | **v1.1 注册审核制**：手机号短信验证码登录**下线**（`sms.py` 保留待用），改为 App 端「注册 → 管理员审核 → 建号 → 账号密码登录」。新增 `modules/captcha.py`（纯 SVG 图形验证码，无第三方依赖）、`modules/registrations.py`（申请提交 + 审核通过自动建号）；`user_accounts` 的 `phone` 改名为 `account` 并新增 `org`（单位/学校）；新增 `POST /api/auth/change-password`（管理员改自己密码）；后台新增「注册申请」Tab + 顶栏「修改我的密码」入口；`overview` 增加注册申请统计。数据库新增 `registrations`、`captchas` 表并做老库平滑迁移。 |
| 2026-09-29 | **后端从 0 到 1**：FastAPI + SQLite 服务；管理员/考生账号增删查改；短信验证码（腾讯云对接 + 未配凭证自动降级本地调试）；可视化管理后台；前端登录页由 Mock 改为真实接口；新增《服务协议》《隐私政策》页面。 |
| 2026-09-30 | **v1.15 资料库（标准/教材/资料/视频）**：① `database.py` 新增 `materials` 表（元数据入库：标题/分类/方向/kind(pdf\|video\|doc)/原始文件名/磁盘随机名/大小/mime/上传人；**文件字节存 `data/uploads/`**，不塞 SQLite）+ 索引。② 新增 `modules/materials.py`：管理端上传（multipart，扩展名白名单 pdf/doc/docx/ppt/pptx/xls/xlsx/txt/mp4/webm/mov/m4v/mp3/m4a，上限 1GB）/列表筛选/改元数据/删除（连文件一起删）/预览下载；考生端 `GET /api/library` + `/api/library/{id}/file`（FileResponse 自带 Range 拖动；`bearer_token` 本就支持 `?token=`，视频标签直接可用）。③ 后台新增「资料库」Tab（上传/搜索筛选/查看/编辑/删除；上传走独立 multipart fetch，api() 只发 JSON）。④ 分类常量跨端三处同步：`materials.MATERIAL_CATEGORIES` ↔ `dashboard.js MATERIAL_CATEGORIES` ↔ `MaterialsScreen.tsx CATEGORY_TABS`。前端 `MaterialsScreen` 从占位改真实列表（分类筛选、文档新标签页打开、视频应用内播放器浮层）。隔离副本 e2e 8 步全过（上传/列表筛选/取文件双鉴权/编辑/非法类型 400/越权/删除连文件），tsc+build 通过。