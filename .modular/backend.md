# Backend（后端地图）

> **本项目有真实后端。** 改后端先读本文件定位，不要全量扫描 `server/`。
> 前端地图看项目根 `FRONTEND.md`；开发规矩与命令看 `.modular/rules.md`。
> 最后更新：2026-10-13（**v1.84 · 计算题「题目原题讲解」（解答过程）**：`questions` 表新增 `explanation` 列（后台题目「解析 / 解答过程」字段，此前**只收不存**，现已真正落库；`_question_public` 下发、考试开卷时随 `answer` 一起 pop 掉防偷看）；新增 `ai_question_solution` 缓存表 + `POST /api/ai/question-solution`（SSE，题库没配解答过程的计算题由 AI 分步算出），`GET /api/ai/cache/{kind}/{id}` 的 `kind` 增加 `solution`；练习/考试的作答提交 `user_answer` 长度上限 16 / 8 → 200（计算题考生手写答案）；后台题目弹窗「解析」字段支持插图（`＋ 解答过程插图`）。2026-10-11（**v1.82 · AI 智能助手（题目 AI 解析 / 视频 AI 概括）**：新增 `server/modules/ai.py`，智谱 GLM 流式对接；新增 `ai_question_explain` / `ai_video_summary` 缓存表（按题目 / 视频全局共享）；`config.json` 新增 `ai` 段（api_key/base_url/chat_model/vision_model/timeout_seconds/video_frames）；后端用系统 ffmpeg 抽关键帧并**拼成宫格图**（`glm-4v-flash` 单次最多 5 张图，拼图规避上限）；v1.79 · 小程序端自动获取服务器地址：新增**公开**接口 `GET /api/access-info`（无需登录，返回与后台「网络访问」卡片同源的本机/局域网/公网三条地址），小程序端据此自动探测并跟随后台地址变化；`overview.tunnel_addresses()` 抽为唯一公网地址解析点，供 `/api/admin/tunnel` 与 `/api/access-info` 共用，见 §3.16；2026-10-11 · 管理后台登录页左上角加「← 返回」按钮（static/index.html + style.css + login.js）；2026-10-09 · **v1.75 · 题库导入模板扩充为「全面版」**（`题库导入模板.csv` 加 6 行 `#` 字段说明 + 13 行六题型示例；`import_csv` 支持静默忽略 `#` 说明行，见 §3.9）；2026-10-09 · **v1.74 题库加方向/类型字段** + 后台按方向筛选；2026-10-04 · **v1.65 · 网络访问：局域网直连开关 + 公网隧道后台一键启停**（modules/network.py + main.py lan_guard 守卫 + 后台「网络访问」卡片，见 §3.16）；2026-10-04 · **v1.62 接口响应统一禁缓存**（no-store 中间件）；2026-10-01 · **v1.31 题型扩到六种** + 通用导入模板；2026-09-30 · **内网穿透换回 Cloudflare 快速隧道**（tools/tunnel.py 重写，地址每次重启变，/api/admin/tunnel 契约不变）；v1.17 · 通知两边联动删除 + 新用户欢迎通知；v1.16 · 官网入口 + 公网地址上屏 + 后台 Logo；v1.15 · 公网访问：main.py 托管前端 dist + SPA 回退；v1.14 题目纠错工单 + 内置题库进后台；v1.13 模拟考试；v1.12 管理后台「题库管理」；v1.11 随机刷题/错题删除）

---

## 0. 一句话架构

```
React 前端（Vite :8443）── /api 代理 ──▶ Python 服务（FastAPI :8000）──▶ SQLite（server/data/app.db）
                                              │
                                              ├──▶ 腾讯云短信（可选，当前未启用；登录已改用图形验证码）
                                              └──▶ 托管前端构建产物 dist/（根路径 /，生产/公网访问时用）
浏览器直接访问 ─────────────────────────▶ 可视化管理后台（/admin/，由同一个 Python 服务提供）

公网用户 ── HTTPS ──▶ Cloudflare 边缘 + cloudflared ──▶ 上面的 :8000（不碰前端代码，见项目根「公网访问说明.md」）
```

- 前端不直连数据库、不持有任何密钥，只通过 `/api` 调接口
- Python 服务同时提供：**考生端 App**（`/`，托管 `dist/`）、**接口**（`/api/**`）、**接口文档**（`/docs`）、**可视化管理后台**（`/admin/`）
- 前端接口基址是相对路径 `/api` → **App / 后台 / 接口必须同源**，所以内网穿透只暴露 8000 这一个端口即可

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
server/                        Python 服务根目录（约 7100 行）
├── main.py              327  服务入口：CORS / 注册路由 / 挂载静态后台 / **托管官网（根路径）+ App（/app/ 子路径）+ SPA 回退** / lifespan（建库·绑事件循环·起版本监听协程）
├── config.py            140  配置：默认值 + config.json 覆盖；realtime 段（实时通道开关）；sms_ready()/sms_mode()；**v1.83 新增 `ai_ready()`/`ai_conf()` —— 取 `config.json` 的 `ai` 段（api_key/base_url/chat_model/vision_model/timeout_seconds/video_frames）**，用于 `modules/ai.py`
├── config.example.json       凭证模板（复制为 config.json 使用）
├── database.py          614  SQLite 连接 / 建表 / 平滑迁移 / 一次性数据补齐 / 初始超管
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
│   ├── user_security.py 111  考生账号安全：自助改登录密码 / 改登录账号
│   ├── realtime.py      214  **实时通道（SSE）**：通知/评论回复/版本更新/踢会话 写库即推送；`publish()/kick_session()/publish_all()`
│   ├── notifications.py      通知：考生收通知 + 管理员发通知（批次记录 / 候选考生选择器）；`push_notification` 是**实时推送唯一落点**，`send_welcome_notice` 给新考生发欢迎通知；删除批次 = 后台记录 + 考生端通知一起删（推 `notification-removed`）
│   ├── password_resets.py 259 密码重置工单：考生提交申请 + 管理员处理（重置密码并写系统通知）
│   ├── bank.py           214  题库：CSV 导入（表空才导）+ 概览 /api/bank/summary + 搜索 /api/bank/search（考生只读）
│   ├── tabular.py       344  **导入兼容层**：上传文件 → 标准 8 列 CSV。真实类型嗅探（不看扩展名：xlsx/xls/text）、
│   │                             多编码解码（UTF-8 BOM/UTF-16/UTF-8/GB18030/Big5）、表头列名映射、无依赖 xlsx 解析。
│   │                             入口 `normalize_table_input(bytes)` / `normalize_text_input(str)`；**加新表头写法只改 `_ALIASES`**
│   ├── question_images.py    **题目插图**：题干/选项/答案解析里内嵌图片（标记 `[[img:qimg_xxx.png]]`）的上传与取图；
│   │                             管理端 POST /api/admin/question-images + 两端取图 GET（考生端令牌走 ?token=）
│   ├── materials.py    1345  资料库：标准/教材/资料/视频 + 系列（大类→系列→资料）+ 封面 + 播放量/收藏/评论 + Office 转 PDF 预览
│   ├── music.py         760  **音乐**（v1.50）：管理员上传曲目（音频 + 封面 + 歌手 + 专辑 + 歌词）+ **专辑管理** → 考生端「音乐」Tab 播放、「专辑」Tab 看专辑；
│   │                             管理端 GET/POST `/api/admin/music` + PUT/DELETE `/{id}` + `/order` + 封面三件套 + 试听 `/{id}/file`；
│   │                             **专辑**：GET/POST `/api/admin/music/albums` + PUT/DELETE `/albums/{id}` + 封面三件套（删专辑不删歌）；
│   │                             考生端 GET `/api/music` + `/{id}/file`（?token= + HTTP Range 拖动）+ `/{id}/cover` + POST `/{id}/play` + **GET `/api/music/albums`**
│   ├── practice.py       445  练习：出题 / 交卷（写 answer_record）/ 首页统计 / 学习报告 / XP 等级 / 错题本 / 标记掌握
│   ├── app_update.py    177  版本更新：公开查版本 + **管理端发布新版本（写 version.json 并实时推送）** + 盯文件变更
│   ├── admin_accounts.py 220 管理员账号增删查改 + 超管护栏
│   ├── user_accounts.py 255  考生账号增删查改（账号 / 单位学校 / 昵称 / 头像 / 密码重置）；改密/禁用/删号时**实时踢会话**
│   ├── sms.py           248  短信验证码（腾讯云对接 + 本地降级）+ 后台查码接口
│   ├── overview.py      116  后台概览统计（含注册申请、密码重置统计）+ 公网地址 /api/admin/tunnel；**tunnel_addresses() = 「公网地址.txt」唯一解析点**（v1.79 起也被 network 的 /api/access-info 调用）
│   ├── network.py       390  网络访问（v1.65）：局域网开关（写回 config.json lan_access.enabled）+ 本机 IP 探测 + lan_allowed 守卫判定（main.py lan_guard 调用）+ 公网隧道子进程一键启停（pid 文件 server/data/tunnel.pid，taskkill /T 杀树）；**v1.79 新增公开接口 public_router → GET /api/access-info**（小程序端自动获取本机/局域网/公网三条地址）
│   ├── themes.py        339  **主题商店（v1.82）**：管理员上传「预览图 + 背景图 + 主色/辅色/字色」皮肤包 → 考生端「我的 → 主题商店」自选一键应用（只覆盖 CSS 变量 + 一个全屏固定背景层，**不碰任何尺寸/布局**，故不会变形）；
│   │                             管理端 `/api/admin/themes`（列表 / 新建 / 改 / 删 / `/order` / 预览图·背景图各一套取·传·删，文件名前缀 `theme_preview_` / `theme_bg_`，上限 8MB / 15MB）；
│   │                             考生端 `/api/themes`（列表 + 取图）**故意不加登录依赖** —— 登录/注册页也要应用主题；色值只收 `#RRGGBB`，`text_tone` = dark|light 决定皮肤明暗基调
│   └── ai.py            560  **AI 智能助手（v1.83，v1.84 加计算题解答过程）**：智谱 GLM 流式对接；`POST /api/ai/question-explain` 题目 AI 解析（流式 SSE）、**`POST /api/ai/question-solution` 计算题解答过程（流式 SSE，v1.84）**、`POST /api/ai/video-summary` 视频 AI 概括（流式 SSE，ffmpeg 抽帧 + `tile` 拼宫格图），`GET /api/ai/status`、`GET /api/ai/cache/{kind}/{id}`（kind = question \| solution \| video）；结果写入 `ai_question_explain` / **`ai_question_solution`** / `ai_video_summary` 缓存表（全局共享）。
├── static/                   可视化管理后台（纯静态，无需构建）
│   ├── index.html        45  登录页（含「← 返回」按钮：location.href='/app/' 直接回考生端登录/注册屏）
│   ├── dashboard.html   746  主界面（**十一个 Tab** + 顶部：公网地址横幅 + **网络访问卡片**（局域网开关 + 公网一键启停，v1.65））
│   ├── api.js           112  公共脚本：令牌存取 + fetch 封装 + toast + esc
│   ├── login.js          63  登录页逻辑（含返回按钮 #back-btn）
│   ├── dashboard.js    4646  主界面逻辑（十一个模块的增删查改 + 修改我的密码 + 头像渲染 + 指定考生多选发送 + 版本发布 + 网络访问 loadNetwork/bindNetwork + 主题商店 bindThemeModule/loadThemes）
│   └── style.css        472  样式（令牌与主项目一致，含 .net-* 网络访问卡片与 .switch 开关样式；登录页 .back-row）
└── data/app.db               SQLite 数据库（gitignore，首次启动自动生成）
    data/version.json         最新版本信息（检查更新 + **发布版本**用；后台「版本发布」Tab 或直接改这个文件都能推新版本）
```

```
项目根（公网访问基础设施，玩法见「公网访问说明.md」）
├── official-site/              官网模块（苹果式单页，2026-09-30 新增）
│   ├── index.html          官网入口页（内联 CSS/JS，根路径 / 由 main.py 托管）
│   └── assets/             官网静态资源（截图/favicon，由 /site-assets/* 托管）
├── 启动公网访问.bat            一键：查构建产物 → 起后端 → 建 Cloudflare 快速隧道 → 打印公网地址
├── miniprogram/                微信小程序端（v1.79，web-view 套壳现有 H5，UI 一行没改；玩法见「小程序-操作说明.md」）
│   ├── project.config.json / app.json / app.wxss / sitemap.json
│   ├── app.js                  入口：地址探测/读写（resolveAppUrl / learnAddresses / hintAppUrl）+ 网络状态 + 版本更新
│   ├── config/env.js           ★ 探测种子（local/lan/tunnel/cloud）+ baseOf/normalizeAppUrl/probeSeeds
│   └── pages/index/            唯一页面：web-view 渲染 /app/ + 失败兜底（自动探测、改地址、快捷切换）
└── tools/
    ├── cloudflared.exe       Cloudflare 快速隧道客户端（52MB，gitignore，缺失时自动下载）
    ├── tunnel.py              拉起 cloudflared + 解析公网地址 + 实测 + 写「公网地址.txt」
    ├── tunnel_sakurafrp.py.bak  SakuraFrp 版脚本备份（想切回固定地址隧道时可用）
    └── 下载cloudflared.bat    单独重新下载隧道程序
```

> **路由布局（2026-09-30 起）**：`/` = 官网入口页（official-site/index.html）；
> `/app`、`/app/`、`/app/*` = 考生端 App（dist/，SPA 回退到 App 入口，目录穿越防护保留）；
> `/site-assets/*` = 官网静态资源；`/admin`、`/api/*`、`/assets/*`（dist 构建产物）、`/docs` 保持不变。
> App 构建产物内资源引用为绝对路径 `/assets/*`，从 /app/ 打开时仍命中同源 `/assets`，**无需重建前端**。
> 未知路径统一回落官网首页（`site_fallback`，须注册在所有具体路由之后）。

> **新增面板的固定三步**（后台已有十一个 Tab，照这个加不会再漏）：
> ① `dashboard.html` 加 `<button class="tab" data-panel="x">` + `<section id="panel-x" class="hidden">`；
> ② `dashboard.js` 的 `bindTabs()` 面板数组加 `'x'`；
> ③ 写 `bindXModule()` 并在启动处调用（`innerHTML` 重渲染出来的按钮一定要重新 `addEventListener`）。

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
| `sessions` | 登录令牌 | `token`(主键) / `subject_type`(admin\|user) / `subject_id` / `created_at` / `expires_at`（默认 15 天，**有效期内每次请求自动续期**，见 §7.2；只存哈希前的随机串，无 `last_used` 列） |
| `notifications` | 通知（**每个接收考生一行**，App 通知中心读这张表） | `id` / `batch_id`(一次发送) / `user_id` / `type`(system\|notice) / `title` / `content` / `sender` / `read_at`(空=未读) / `deleted`(软删) / `created_at` |
| `notification_batches` | 通知批次（后台「已发送记录」） | `id`(**TEXT 主键** `nb`+16 位 hex) / `type` / `title` / `content` / `scope`(all\|one) / `target_desc` / `accounts`(逗号分隔快照) / `receiver_count` / `sender` / `hidden`(后台删通知=置1，同时该批次通知也置 deleted=1) / `created_at` |
| `password_resets` | 密码重置工单（考生提交 → 管理员处理） | `id` / `account` / `org`(工作单位) / `user_id` / `status`(pending\|done\|rejected) / `reject_reason` / `reviewed_by` / `reviewed_at` / `created_at` |
| `app_meta` | 系统元信息（key-value） | `key`(主键) / `value` —— 目前存一次性任务的执行标记（如 `profile_defaults_backfilled`） |
| `questions` | **题库**（启动时从 `data/question_bank.csv` 导入，表空才导；考生只读） | `id` / `set_id`(NULL=内置一级；非空=自定义题库) / `chapter_id`(v1.30，NULL=未归章节) / `method`(UT\|RT\|MT\|PT\|ZD) / `grade`(级别) / `topic1` / `topic2` / `qtype`(judge\|single\|multi\|calc\|calcsel\|short，v1.31 六种) / `content` / `options_json` / `answer` / **`explanation`(v1.84，「题目原题讲解」的解答过程，后台可填文字+插图，空=考生端走 AI 生成)** / `source_no`(CSV 序号) / `created_at` |
| `question_sets` | 自定义题库（v1.12，管理后台创建；v1.30 加系列/封面/排序，v1.74 加方向） | `id` / `name`(唯一) / `level` / **`method`**(v1.74 方向/类型：`''` 通用 / UT / RT / MT / PT / ET / VT / 综合，后台题库列表按此筛选) / `description` / **`series_id`**(v1.30 所属题库系列 id，NULL=散题库) / **`cover_name`**(v1.30 封面磁盘名，空=考生端图标水印) / **`sort_order`**(v1.30 管理端排定的顺序，越大越靠前；0=未排过按 id 倒序兜底) / `created_at` |
| `answer_records` | **答题记录**（每个考生一份，统计/错题本/打卡的数据源） | `id` / `user_id` / `question_id` / `method` / `kind`(answer\|master) / `user_answer` / `is_correct` / `duration_seconds`(本 session 总时长，每行相同) / `session_id`(一次练习一个) / `answered_at` |
| `exams` | **模拟考试**（v1.13，一次开卷一行；`id` 同时是 answer_records.session_id） | `id`(**TEXT 主键** `ex`+16 位 hex) / `user_id` / `title` / `category` / `set_id` / `qtype` / `question_ids`(JSON 试卷快照) / `duration_minutes` / `total` / `correct` / `score`(百分制) / `status`(in_progress\|finished) / `time_used`(秒) / `auto_submitted` / `started_at` / `finished_at` |
| `exam_answers` | **考试作答明细**（v1.13，交卷时写入，试卷回看数据源） | `exam_id` + `question_id`(联合主键) / `user_answer` / `is_correct` —— 未作答的题没有行 |
| `wrong_dismissals` | **错题集删除标记**（v1.11；考生把错题「删除」= 加一行隐藏标记，不删答题记录） | `user_id` + `question_id`(联合主键) / `created_at` —— 这道题再次答错时标记自动清除（`practice.submit` 里删），会重新出现在错题集 |
| `practice_progress` | **练习进度**（续做：下次进来接着上次的题号做，不用重头开始） | `user_id` / `category` / `topic` / `qtype` / `set_id` / `mode` / `question_ids`(JSON 题目顺序快照) / `answers_json`(JSON 已答界面快照 {index:{selected,correct}}) / `current_index` / `updated_at` —— `UNIQUE(user_id, category, topic, qtype, set_id, mode)`；「清除记录」/ 交卷完成时删除，**只删自己的这一条** |
| `materials` | **资料库**（v1.15：标准/教材/资料/视频，元数据入库、文件字节存 `data/uploads/`） | `id` / `title` / `category`(standard\|textbook\|material\|video) / `method` / `description` / `kind`(pdf\|video\|doc) / **`series_id`**(v1.25 所属系列 id，NULL=散资料，考生端归「其他」) / `file_name`(原始名) / `stored_name`(磁盘随机名) / **`cover_name`**(v1.16 管理员自定义封面磁盘名，空=考生端自动取视频首帧) / `file_size` / `mime` / `uploaded_by` / **`sort_order`**(v1.28 管理端排定的顺序，越大越靠前；0=未排过按 id 倒序兜底) / `created_at` |
| `material_series` | **资料系列**（v1.25：大类下面再分一层系列，如「UT 培训视频合集」；1:N 关联 `materials.series_id`，不建外键——删系列由代码把 series_id 置 NULL） | `id` / `title` / `category`(同 materials.category 口径) / `method` / `description` / `cover_name`(系列封面磁盘名，空=考生端图标水印) / `created_by` / **`sort_order`**(v1.28 同 materials 口径) / `created_at` |
| `material_views` | **视频播放记录**（v1.16，播放量 = COUNT(*)，B 站式每次打开 +1；v1.18 加 `hidden` 列：观看历史里被考生移除的记录置 1，只影响列表展示不删行 → 播放量不变） | `id` / `material_id` / `user_id` / `hidden`(0=正常,1=已从观看历史移除) / `created_at` —— 索引 `(material_id, id)` |
| `material_favorites` | **视频收藏**（v1.16，一人一资料最多一条） | `material_id` + `user_id`(联合主键) / `created_at` —— 「我的收藏」按 `created_at` 倒序 |
| `material_comments` | **视频评论**（v1.16，v1.17 起支持楼中楼，考生即时发布，管理员可删） | `id` / `material_id` / `user_id` / `content`(1~200 字) / `parent_id`(0=顶层；>0=根评论 id，**两层结构，回复的回复也归根**) / `reply_to`(被回复人昵称快照，展示「回复 @xx」) / `created_at` —— 索引 `(material_id, id)`；**删除资料时三张表级联清空；删顶层评论（考生自己删 / 管理员删）连它的回复一起删** |
| `music_tracks` | **音乐**（v1.44：后台上传的曲目，考生端「音乐」Tab 播放；音频与封面字节存 `data/uploads/`，元数据入库） | `id` / `title`(歌名) / `artist` / `album` / **`album_id`**(所属专辑 id，NULL=未归专辑) / **`lyric`**(纯文本或 LRC 时间轴，原样存；考生端能解析 `[mm:ss.xx]` 就逐行高亮，否则整段滚动) / `duration`(秒，0=未知，上传时前端 `<audio>` 读出) / `file_name`(原始名) / `stored_name`(音频磁盘随机名 `music_*`) / `mime` / `file_size` / **`cover_name`**(封面磁盘名 `cover_*`，空=考生端内置山水插画) / `play_count`(播放量) / **`sort_order`**(同资料库口径：越大越靠前) / `uploaded_by` / `created_at` —— 索引 `(sort_order DESC, id DESC)`；**删除曲目连音频 + 封面文件一起删** |
| `music_albums` | **音乐专辑**（v1.50：后台创建，歌曲通过 `music_tracks.album_id` 归入；删专辑不删歌） | `id` / `name`(专辑名) / `description` / `cover_name`(封面磁盘名，空=考生端用专辑内首曲封面) / `sort_order`(越大越靠前) / `uploaded_by` / `created_at` —— 索引 `(sort_order DESC, id DESC)` |
| `themes` | **主题商店**（v1.82：一套「背景图 + 配色」皮肤包，管理员上传 → 考生端自选应用） | `id` / `name`(主题名) / `primary_color` / `secondary_color`(均为 `#RRGGBB`，空=沿用默认) / **`text_tone`**(`dark`=深色字 / `light`=浅色字，决定皮肤明暗基调) / `preview_name`(预览图磁盘名 `theme_preview_*`) / `background_name`(背景图磁盘名 `theme_bg_*`) / `sort_order`(越大越靠前) / `created_by` / `created_at` —— 索引 `(sort_order DESC, id DESC)`；**删除主题连预览图 + 背景图文件一起删** |
| `ai_question_explain` | **题目 AI 解析缓存**（v1.83：**一道题全局只生成一次，所有考生共用**；`refresh=true` 覆盖旧内容） | `question_id`(主键，= questions.id) / `content`(生成的 Markdown 解析) / `model`(实际使用模型) / `created_at` —— 无 user_id，故意全局共享以省 token |
| `ai_question_solution` | **计算题 AI 解答过程缓存**（v1.84：题库里 `explanation` 为空的**无选项计算题**才用，一道题全局只生成一次；`refresh=true` 覆盖旧内容） | `question_id`(主键，= questions.id) / `content`(生成的 Markdown 解答过程) / `model` / `created_at` —— 无 user_id，故意全局共享以省 token |
| `ai_video_summary` | **视频 AI 概括缓存**（v1.83：**一个视频全局只生成一次，所有考生共用**；`refresh=true` 覆盖旧内容） | `material_id`(主键，= materials.id) / `content`(生成的 Markdown 摘要) / `model` / `created_at` —— 无 user_id，同样全局共享 |

**索引**：`idx_sms_phone(phone, created_at)`、`idx_sessions_exp(expires_at)`、`idx_reg_status(status, created_at)`、`idx_reg_account(account)`、`idx_captcha_exp(expires_at)`、`idx_notif_user(user_id, id)`、`idx_notif_batch(batch_id)`、`idx_preset_status(status, id)`、`idx_preset_account(account)`、`idx_q_method(method)`、`idx_q_set(set_id)`、`idx_rec_user_time(user_id, answered_at)`、`idx_rec_user_q(user_id, question_id)`、`idx_rec_session(session_id)`、`idx_dismiss_user(user_id)`、`idx_progress_user(user_id, updated_at)`、`idx_exam_user(user_id, id)`、`idx_exam_ans_q(question_id)`、`idx_mat_category(category, id)`、`idx_mat_view(material_id, id)`、`idx_mat_fav_user(user_id, material_id)`、`idx_mat_cmt(material_id, id)`、`idx_theme_order(sort_order DESC, id DESC)`

> 新增字段：改 `database.py` 的 `SCHEMA` **并在 `_migrate()` 里补 ALTER TABLE**，老库才能平滑升级。
> **已有迁移**：`user_accounts.phone` 老库会自动 `RENAME COLUMN phone TO account`；`user_accounts.avatar` 会自动 `ADD COLUMN`。
> **一次性数据补齐**：`database.py` 的 `_backfill_profile_defaults()` 会给「随机昵称/头像」上线前建的老账号补上随机值（只处理 `avatar` 为空、或 `nickname` 为空/等于账号的行，**不覆盖考生自己改过的资料**），跑完在 `app_meta` 打标记，**只跑一次** —— 加新补齐任务请照这个模式写（用 `get_meta()` / `set_meta()` 打标记），否则每次启动都会覆盖用户数据。
> 现有补齐任务：`_backfill_profile_defaults()`（历史账号补随机昵称/头像，标记 `profile_defaults_backfilled`）、`_backfill_notify_hidden_batches()`（清「后台已删除、考生端还留着」的历史通知，标记 `notify_hidden_batches_cleaned`）；两者都在 `init_db()` 里调用，处理条数会出现在启动横幅的「已清掉 N 条…」里。

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

> 令牌有效期：默认 **360 小时（15 天）+ 有效期内自动续期**（见 §7.2）。所以考生「不退出登录就一直登录着」，只有 15 天完全没访问过才会 401 要求重新登录；前端据此直接进主界面、401 时退回登录页（见 `FRONTEND.md` §3.1）。

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

### 3.8 版本更新与发布（modules/app_update.py）

**公开**（前缀 `/api/app`）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/app/version` | 返回 `{latest_version, published_at, notes[], download_url, force}`；数据来自 `server/data/version.json`，读不到就用模块内 `DEFAULT_VERSION` 兜底。**永远 200**，前端只负责比版本号 |

**管理端**（前缀 `/api/admin/app`，需**管理员**令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/app/version` | 当前线上版本 + `online_users`（此刻挂着事件流的考生数）+ `realtime_enabled`，后台「版本发布」页三张卡片的数据源 |
| POST | `/api/admin/app/version` | 发布：`{latest_version（必须 x.y.z）, notes[], download_url, force}` → 写 `data/version.json` → **`publish_all('update', …)` 立刻推给所有在线考生**。版本号允许改小（前端只在「服务端 > 本地」时提示） |

**发布后考生端会怎样**（前端 `src/hooks/useAppUpdate.ts` + `src/components/UpdateBanner.tsx`）：

- 在线考生**秒收到** update 事件 → `force=false` 弹底部可关闭提示条（点「稍后」同一版本不再打扰）；`force=true` 弹**不可关闭**的更新弹层
- **答题 / 考试 / 成绩页一律不打断**（`UpdateBanner` 只挂在主 Tab 布局），交卷回到主界面再提示
- 「立即更新」：`download_url` 有值 → 打开下载页（打包版 App）；为空 → `location.reload()`（网页版，Vite 产物带内容哈希，刷新即新版）

**新版本推送是双保险**：

| 通道 | 覆盖场景 |
| ---- | ---- |
| 发布接口直接 `publish_all()` | 走后台「版本发布」Tab 发布 → 即时送达 |
| `watch_version_file()` 协程（每 10 秒比对 `mtime+size`） | **直接改 version.json / git 拉代码 / 改完重启** 等不走接口的发布方式 |

> ⚠️ **发版必须两处一起改**：`server/data/version.json` 的 `latest_version` **和** 前端 `src/data/appVersion.ts` 的 `APP_VERSION`，
> 然后 `npm run build` 重新部署。只改服务端版本号 → 考生点「立即更新」刷新后拿到的还是旧代码，
> 会陷入「提示更新 → 刷新 → 还是旧版」的循环（前端没变，永远认为自己是旧的）。
> 版本号比较规则在**前端**（`x.y.z` 逐段数值比较，只允许末尾追加新段）；后端不做判断。
> 本模块只负责「告知有新版本 + 怎么拿新版」，**不做热更新**。

### 3.9 题库与练习（modules/bank.py + modules/practice.py，均需**考生**令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/bank/summary` | 题库概览：`{total, methods:[{method, name, count, answered}], qtype_counts:[{method, qtype, count}]}`，answered = 我在该方向做过的题数（去重）；`qtype_counts` = 方向×题型矩阵（v1.11，随机刷题选择器据此显示题量/隐藏空题型） |
| GET | `/api/bank/search?q=&limit=` | 搜索题目（题干 / 知识点 LIKE 模糊匹配）：`{total, items:[{id, method, qtype_label, topic, content}]}`，题库页搜索框数据源 |
| GET | `/api/bank/chapters?category=` | 章节列表（topic1 分组）：`{items:[{topic, count, answered}]}`，只返回有题的章节、按题数降序；「按章节练习」入口数据源 |
| GET | `/api/practice/questions?category=&mode=&qtype=&topic=&block=&limit=` | 出题：`category` 传方向代码或 `综合`（全部）；`mode` = sequential(顺序)/random(随机)/wrong(错题重练)；**`qtype` = judge\|single\|multi\|calc\|calcsel\|short 按题型筛选**（空=不限，v1.11 随机刷题/错题重练都用它，v1.31 扩到六种）；**顺序模式默认不分块返回范围内全部题目**（按 id 升序，`block=-1`；`block=N`+`limit` 仍兼容旧分块调用）；`topic` 传知识点(topic1) 即按章节练习（整章一起练，random/wrong 忽略 topic/block）。返回含 `total_in_scope/block_index/block_count`，**每题附 `my_state`**（我最近一次对/错，null=未做，保留到清除记录为止，含 master 标记） |
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
> **后台导入兼容层（`modules/tabular.py`，2026-10-01）**：`POST /api/admin/question-sets/{id}/import` 两种入参 —— `body.csv`（粘贴的文本）或 `body.file_b64`+`filename`（**原始字节，推荐**）。
> 文件一律先过 `normalize_table_input()`：① **按文件头判断真实类型**（xlsx 的 `PK` / xls 的 OLE2 / 其余按文本），所以「把 .xlsx 改成 .csv 再上传」也能认；② 文本编码自动嗅探（UTF-8 BOM → UTF-16 → UTF-8 严格 → GB18030 → Big5），**GBK 导出的 CSV 不再乱码**；③ 首行能认出表头（`章节→知识点一`、`题型→题目类型`、`题目→题目内容`、`选项A~E→题目选项` 合并成 `A、x；##B、y`、`答案→题目答案`）就按列名搬成标准 8 列，**认不出则原样扔给按位置解析的老逻辑**（老格式行为不变）。xlsx 解析只用标准库（zipfile + xml.etree），**没有引入新依赖**。
> **六种题型都能导入（v1.31）**：`判断题 / 选择题(单选) / 多选题 / 计算题 / 计算选择题 / 简答题`，由「题目类型」列决定。`_normalize_qtype()` 认「多选/多项」→ `multi`、「计算选择」→ `calcsel`（**先判组合词再判「计算」**，否则「计算选择题」会被截成 calc），认不出的一律 single 兜底。多选答案**入库时就归一**成排序字母串（`C、A` → `AC`，见 `bank.normalize_multi_answer`），所以判分与书写顺序无关。
> **导入的三类反馈（v1.31）**：返回 `{imported, skipped, imported_by_type, errors[≤50], warnings[≤50], note, message}` —— `errors`=跳过的行（行号+原因+怎么改，例如「第 8 行：多选题答案「A、E」不在选项内（可选：A/B/C；多个答案连着写，如 AC）」）、`warnings`=已导入但需复查（多选只有 1 个正确项；某行**列数多于 8** 说明题干里写了英文逗号被拆开）、`imported_by_type`=各题型各导入了多少题。后台「导入结果」小结窗按这三类分区展示。
> **导入模板（v1.31 起，v1.75 扩充为「全面版」）**：项目根 `题库导入模板.csv`，`GET /api/admin/question-sets/import-template` 原样下发这份文件（后台导入弹窗「⬇ 下载导入模板」按钮），**单一维护点**，别在别处再存一份。v1.75 起：UTF-8 BOM + CRLF；首行标准 8 列表头 → 紧接 **6 行 `#` 开头的字段/写法说明行**（序号/项目/知识点/题型/选项写法/答案写法/图片占位/文件格式）→ **13 行示例**（六种题型逐类覆盖：判断题正误两例、选择题 3/4/5 选项各一例、多选两例、计算题「无选项自评」与「带选项」各一例、计算选择题、简答题两例 + 一例 `[图片]` 占位图题）。
> **`#` 说明行会被导入静默忽略（v1.75）**：`question_sets.import_csv` 行循环开头 `if (row[0] or "").lstrip().startswith("#"): continue`，这样模板既能自带文档、直接导入也不会报「列数不足」。判定只看**首格**（序号列），真实题目数据不会以 `#` 开头，不影响老格式文件。
> **题型代码（v1.11 起，v1.31 扩到六种）**：`bank.QTYPE_NAMES` = `judge 判断题 / single 选择题 / multi 多选题 / calc 计算题 / calcsel 计算选择题 / short 简答题`；`bank.QTYPE_FILTER`（可空）与 `QTYPE_ONLY`（必填）是所有接口 `pattern` 的唯一来源，`QTYPE_CODES` 是全部题型元组。**内置 CSV 目前只有判断题 895 + 单选题 845**，其余题型靠管理员在后台导入。前端同套代码见 `src/data/qtypes.ts`（唯一来源）/ `RandomDrillSheet.tsx` / `ExamSetupScreen.tsx` / 后台 `QS_QTYPES`，改要同步。

### 3.9.1 模拟考试（modules/exam.py，v1.13，均需**考生**令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/api/exam/start` | 开卷：`{category, set_id, set_ids, qtype, count, duration_minutes}`（category=方向代码/综合；set_id=自定义题库；**v1.77 set_ids=多题库合集**〔题库系列「系列全部」，全部同系列时 title=系列名，混搭=自选题库合集〕；qtype 空=不限）→ 范围内 `ORDER BY RANDOM() LIMIT count` 抽题，写 `exams`（in_progress，`question_ids` 存试卷快照），返回 `{exam_id, title, total, duration_minutes, questions}`。**题目不带 answer 字段**（防前端偷看，判分在服务端）；空范围 404 |
| POST | `/api/exam/submit` | 交卷：`{exam_id, time_used_seconds, auto, answers:[{question_id, user_answer}]}` → **服务端逐题判分**（strip+upper 比对 `questions.answer`），写 `exam_answers` + `answer_records`（session_id=exam_id，照常进统计/XP/错题机制），更新 exams 为 finished（correct/score/time_used/auto_submitted）。**幂等**：已 finished 的重复提交直接返回已有结果（到点自动交卷在手动之后触发也安全）；未答的题不写行、按错算 |
| GET | `/api/exam/records/{exam_id}` | 试卷回看：`{...成绩摘要, items:[每题完整信息 + answer + my_answer + is_correct]}`，按出卷顺序返回；未答 `my_answer=''`、`is_correct=null`；题目已被删的跳过；只能看自己的（404 兜底） |
| GET | `/api/exam/records?limit=` | 我的考试成绩列表（finished，按 id 倒序）——备用接口，成绩记录页实际走 `/api/user/practice/history` |
| GET | `/api/admin/materials?category=&method=&q=` | 资料库列表（管理端，可按分类/方向/关键词筛选），**带 `view_count`/`fav_count`/`comment_count` 统计与 `has_cover`**。分类常量 `standard` 标准 / `textbook` 教材 / `material` 资料 / `video` 视频。v1.25 加 `&series_id=N`（只看某系列）与 `&loose=1`（只看未归系列散资料），行带 `series_id`/`series_name`。**v1.28 起按 `sort_order DESC, id DESC` 排序**（行带 `sort_order`） |
| POST | `/api/admin/materials/order` | **批量调整资料顺序**（v1.28，后台「上移 / 下移」）：body=`{ids:[...]}` = 后台当前可见列表的完整顺序；`_apply_manual_order()` 让这批 id 在全表顺序里的**槽位不动、只按新顺序填内容**（筛选出的部分列表里换位不会打乱别的资料），并把全表 `sort_order` 压实成 1..N。⚠️ 路由必须声明在 `/{material_id}` 之前 |
| GET/POST | `/api/admin/materials/series` | **系列列表 / 新建**（v1.25：列表可 `?category=` 筛选，带 `item_count` 资料数；新建 body=`{title, category, method?, description?}`）。⚠️ 路由必须声明在 `/{material_id}` 之前，否则 'series' 被当成 id 解析报 422。**v1.28 起按 `sort_order DESC, id DESC` 排序**（去掉按 category 分组，手动顺序全表生效） |
| POST | `/api/admin/materials/series/order` | **批量调整系列顺序**（v1.28，同资料 `/order` 口径：body `{ids:[...]}`；考生端大类页系列卡顺序跟着变） |
| PUT/DELETE | `/api/admin/materials/series/{id}` | **改系列 / 删系列**（v1.25：改名称/大类/方向/简介；**删系列不删资料**——系列内资料 `series_id` 置 NULL 退回「未归系列」，返回 `moved` 数量） |
| GET/POST/DELETE | `/api/admin/materials/series/{id}/cover` | 系列封面 取 / 设（multipart `cover`）/ 清（v1.25，逻辑同资料封面：换/清都删老文件） |
| POST | `/api/admin/materials` | 上传资料（**multipart**：file + **cover 选填** + title/category/method/description + **series_id 选填**（v1.25，0 或不存在的系列视为散资料，不报错——上传的文件不丢）），扩展名白名单，单文件上限 1GB / 封面 8MB（jpg\|jpeg\|png\|webp）；文件存 `data/uploads/`（随机名），元数据入 `materials` 表 |
| PUT | `/api/admin/materials/{id}` | 修改资料元数据（标题/分类/方向/描述/**所属系列**（v1.25 `series_id`，0=移出系列），不换文件） |
| DELETE | `/api/admin/materials/{id}` | 删除资料：连 `data/uploads/` 里的文件、封面与 观看/收藏/评论 三表记录一起删，不可恢复 |
| GET | `/api/admin/materials/{id}/file` | 管理员预览/下载（`?download=1` 附件下载） |
| GET | `/api/admin/materials/{id}/cover` | 管理员预览封面图（未设置 404） |
| POST | `/api/admin/materials/{id}/cover` | 替换封面（multipart cover，老封面文件一起删）；`DELETE` 同路径 = 清除封面（考生端回落视频首帧） |
| GET | `/api/admin/material-comments?material_id=` | 某资料的评论列表（昵称/头像，`dashboard.js` 的「评论」弹窗用） |
| POST | `/api/admin/material-comments` | 管理员回复 / 发表评论（body：`material_id` + `content` + `parent_id?`）：`user_id=0` 落库（考生端昵称「管理员」、考生删不掉），回复挂根评论并给被回复考生发「管理员回复了你的评论」站内通知——后台「视频详情」弹窗用 |
| DELETE | `/api/admin/material-comments/{id}` | 管理员删除评论（违规内容；删顶层评论连回复级联删） |
| GET | `/api/library?category=&series_id=` | 考生端资料列表（「教材 / 视频」页数据源，按上传时间倒序），**附带播放量/收藏数/`favorited`/`has_cover`/`series_id`/`series_name`**（子查询聚合，非 N+1）；v1.25 加 `&series_id=N` 只看某系列内资料 |
| GET | `/api/library/series` | **系列列表**（v1.25，考生端大类页系列卡数据源）：可 `?category=` 筛选，每条带 `item_count` 资料数 / `has_cover`——⚠️ 本路由必须声明在 `/{material_id}` **之前**（管理端同理） |
| GET | `/api/library/series/{id}/cover` | 系列封面图（v1.25；未设置 404，前端回落图标水印） |
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

### 3.9b 音乐（modules/music.py，v1.50）

**管理端**（前缀 `/api/admin/music`，🔒 管理员令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/music` | 曲目列表（按 `sort_order DESC, id DESC`）：行带 `lyric`（全文）/ `lyric_lines`（非空行数）/ `has_cover` / `play_count` / `duration` / `file_size` |
| POST | `/api/admin/music/order` | **批量调整顺序**（后台「上移 / 下移」，body `{ids:[...]}` = 当前可见完整顺序；复用 `upload_utils.apply_manual_order`，语义同资料/题库）。⚠️ 必须声明在 `/{track_id}` 之前 |
| POST | `/api/admin/music` | 上传曲目（**multipart**：`file` 音频 + `cover` 选填 + `title`/`artist`/`album`/`lyric`/`duration`）：音频白名单 mp3\|m4a\|aac\|wav\|flac\|ogg\|oga\|opus\|weba，单文件 ≤200MB；封面同全站口径（jpg\|jpeg\|png\|webp ≤8MB）；存 `data/uploads/`（`music_*` / `cover_*`），元数据入 `music_tracks` |
| PUT | `/api/admin/music/{id}` | 修改曲目信息（歌名 / 歌手 / 专辑 / **歌词** / 时长，**不换音频**）；歌词上限 20000 字 |
| DELETE | `/api/admin/music/{id}` | 删除曲目：**连磁盘上的音频与封面文件一起删**，不可恢复；**级联清** `music_favorites` / `music_comments` / `music_plays` 里的引用 |
| GET | `/api/admin/music/{id}/file` | 管理员试听 / 下载（`?download=1` 附件） |
| GET/POST/DELETE | `/api/admin/music/{id}/cover` | 封面 取（未设置 404）/ 设（multipart `cover`，老封面一起删）/ 清（考生端回落内置山水插画） |
| — | `/api/admin/music/albums…` | **专辑（v1.50）**：`GET /albums`（列表带歌曲数）/ `POST /albums`（multipart name+description+cover?）/ `PUT`\|`DELETE /albums/{id}`（**删专辑不删歌** → 歌曲 `album_id` 置 NULL 退回未归专辑）/ 封面三件套 `/albums/{id}/cover`；上传 / 编辑歌曲新增 `album_id`（选中专辑时专辑名同步写入 `album` 文本，改名同步更新归属歌曲） |

**考生端**（前缀 `/api/music`，🔒 考生令牌；音频与封面走 `?token=`）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/music` | 曲目列表（含歌词全文 + `play_count`/`fav_count`/`comment_count` 计数 + `favorited` 我是否收藏），音乐页首页 / 搜索 / 播放列表 / 歌单的数据源 |
| GET | `/api/music/albums` | **专辑列表**（v1.50，含每张专辑的歌曲 + `favorited`），音乐首页「专辑」Tab 数据源；`/api/music/albums/{id}/cover` 取专辑封面（未设置 404 → 前端回落首曲封面 / 内置插画） |
| GET | `/api/music/favorites` | 我的音乐收藏（按收藏时间倒序，带 `favorited_at`）。⚠️ 固定路径，与 `/{track_id}/xxx` 段数不同不冲突 |
| GET | `/api/music/history` | 我的播放历史（同一首只留最近一次：`played_at` + `my_play_count`；`hidden=1` 的不展示） |
| DELETE | `/api/music/history` | 清空播放历史（`music_plays.hidden=1`，**不删播放量**） |
| DELETE | `/api/music/history/{track_id}` | 从历史移除某一首（隐藏标记，同资料库口径） |
| POST | `/api/music/{id}/favorite` | 收藏 / 取消收藏（toggle），返回 `favorited` + 最新 `fav_count` |
| GET | `/api/music/{id}/comments` | 歌曲评论列表（LEFT JOIN 账号取昵称/头像快照，`mine` 标记可删） |
| POST | `/api/music/{id}/comments` | 发表评论（1~300 字，body `{content}`），返回最新 `comment_count` |
| DELETE | `/api/music/comments/{cid}` | 删除**自己的**评论（别人的 403），返回最新 `comment_count` |
| GET | `/api/music/{id}/file` | 音频流：`FileResponse` 自带 **HTTP Range**（`<audio>` 拖动进度不会整段重下），支持 `?token=` |
| GET | `/api/music/{id}/cover` | 封面图（未设置 404 → 前端回落内置插画） |
| POST | `/api/music/{id}/play` | 记一次播放（`play_count + 1` **并 INSERT `music_plays`** → 我的观看历史出现音乐条目） |

> **音乐三表（v1.45）**：`music_plays`（播放历史，hidden 隐藏标记）/ `music_favorites`（收藏，PK(track_id,user_id)）/ `music_comments`（评论）。
> ⚠️ `_track_public_with_fav` / 列表循环里的 `conn.execute` **必须写在 `with get_conn()` 块内**（踩过 closed database 500）。

> 时长由**后台在上传时用浏览器 `<audio>` 读出**后随表单提交（后端不依赖 ffprobe / mutagen）；
> 读不到传 0，考生端以音频实际加载到的时长为准（`onLoadedMetadata`）。

> **判分工具（v1.31）**：`_grade_answer(qtype, my_answer, correct)` → 转发 `bank.answers_match()`：**多选（multi）按字母集合比对**（`CA` 与 `AC` 都算对），其余 strip + upper。练习页在前端判分、走 `src/data/qtypes.ts` 的同名 `answersMatch()`，**两边口径必须一致**。多选作答写库前归一（`exam.py` 存 `AC`），试卷回看的选项高亮不受书写顺序影响。纠错工单「采纳」也按题型校验建议答案（`question_reports.py`：判断 A/B、选择/计算选择必须在选项内、多选归一 + 校验、计算/简答原样写回不改大小写）。
> **试卷快照**：`exams.question_ids` 在开卷那一刻定格，之后题库变动不影响已开的考试。

### 3.9c 主题商店（modules/themes.py，v1.82）

> 一套主题 = **完整皮肤包**（背景图 + 配色），管理员在后台上传，考生在「我的 → 主题商店」里自己挑一个应用。
> 应用方式是**纯前端换 CSS 变量 + 叠一个全屏固定背景层**（只改颜色/表面/玻璃，**一行尺寸都没动** → 界面不会变形）。
> 主题列表接口**故意不挂登录依赖**：登录页/注册页也要能应用主题（此时还没有令牌）。

**管理端**（前缀 `/api/admin/themes`，🔒 管理员令牌）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/themes` | 主题列表（按 `sort_order DESC, id DESC`）：行带 `has_preview` / `has_background` / `sort_order` / `created_by` / `created_at` |
| POST | `/api/admin/themes/order` | **批量调整顺序**（后台「上移 / 下移」，body `{ids:[...]}` = 当前可见完整顺序；复用 `upload_utils.apply_manual_order`）。⚠️ 必须声明在 `/{theme_id}` 之前 |
| POST | `/api/admin/themes` | 新建主题（**multipart**：`name` 必填 + `primary_color` / `secondary_color` / `text_tone` + `preview?` / `background?`）：色值只收 `#RRGGBB`（`_clean_color`，非法 400）、`text_tone` ∈ `dark\|light`；预览图 ≤8MB（jpg\|jpeg\|png\|webp），背景图 ≤15MB；存 `data/uploads/`（`theme_preview_*` / `theme_bg_*`），元数据入 `themes` |
| PUT | `/api/admin/themes/{id}` | 修改主题信息（名称 / 主色 / 辅色 / 字色；**不换图**） |
| DELETE | `/api/admin/themes/{id}` | 删除主题：**连预览图与背景图文件一起删**，不可恢复（考生端若正用着这套皮肤，下次进主题商店会检测到已失效并自动恢复默认） |
| GET/POST/DELETE | `/api/admin/themes/{id}/preview` | 预览图 取（未设置 404）/ 设（multipart `preview`，老图一起删）/ 清 |
| GET/POST/DELETE | `/api/admin/themes/{id}/background` | 背景图 取（未设置 404）/ 设（multipart `background`，老图一起删）/ 清 |

**考生端**（前缀 `/api/themes`，**公开，无令牌**）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/themes` | 主题列表（给「主题商店」页与启动时校验本机皮肤用）：`id` / `name` / `primary_color` / `secondary_color` / `text_tone` / `has_preview` / `has_background` / `sort_order` |
| GET | `/api/themes/{id}/preview` | 预览图（未设置 404 → 前端回落主辅色渐变块） |
| GET | `/api/themes/{id}/background` | 背景图（未设置 404 → 前端只上配色不上背景） |

> ⚠️ `/order` 必须写在 `/{theme_id}` **之前**，否则被当成 id 解析报 422（同资料库/音乐/题库口径）。
> ⚠️ 考生端路由**不能**加 `get_current_user` 依赖 —— 登录页就是要在没令牌的时候把主题铺上去。
> 前端对应实现：`src/themeStore.ts`（变量派生 + `applySkin` + 固定背景层 `#ndt-skin-bg`）、`src/screens/ThemeStoreScreen.tsx`、`src/theme.ts`（`data-skin` 让 `data-theme` 跟随皮肤明暗）。选择结果只存 **`localStorage: ndt_skin`**，不落库、不上传服务器。

### 3.10 概览与调试

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/stats` 🔒 | 管理员/考生数量、今日新增、**注册申请统计（pending/total/approved/rejected）**、**密码重置统计（`password_reset`: pending/total/done/rejected）**、活跃会话 |
| GET | `/api/admin/tunnel` 🔒 | 当前公网隧道地址（v1.16）：读项目根「公网地址.txt」（`tools/tunnel.py` 每次启动隧道覆写；2026-09-30 起隧道换回 Cloudflare 快速隧道，地址**每次重启会变**），返回 `{available, app_url, admin_url, docs_url, local_url, generated_at}`；文件缺失/没地址时 `available:false` 优雅降级。管理后台顶部横幅展示 + 复制用，**不负责建隧道**（标签名被 tunnel.py 的 `announce()` 依赖，改一边要改两边）。**v1.79 起解析逻辑收敛到 `overview.tunnel_addresses()`**，本接口只是它的薄封装 |
| GET | `/api/access-info` | **（v1.79，公开，无需登录）** 当前可用访问地址，供**微信小程序端**自动挑选可用后端：`{ok, port, server_time, local:{base_url, app_url}, lan:{enabled, ip, base_url, app_url}, public:{available, app_url, generated_at}}`。局域网部分 = `network._lan_payload()` 同源数据，公网部分 = `overview.tunnel_addresses()` —— **与后台「网络访问」卡片完全一致，后台显示什么小程序就跟随什么**。安全边界靠 `lan_guard` 中间件兜底（开关关时非本机请求一律 403），不额外暴露数据 |
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
| DELETE | `/api/admin/notifications/{batch_id}` | 删除通知（v1.17 起**两边一起删**）：批次 `hidden=1`（后台不再显示）+ 该批次全部 `notifications.deleted=1`（考生端消失）+ 推 `notification` 移除事件；返回 `{removed}`。⚠️ 考生端读列表时**还会再校验一次批次是否 hidden**（双保险，见 `my_notifications`） |

> **「一个账号只能发一次」的实现**：同一次发送里账号自动去重（后端 `_dedupe_accounts`，后台选择器也会把已添加的候选置灰），因此同一批里一个账号不会收到两条。
> **管理员删除 = 两边一起删**（v1.17）：`delete_batch()` 除了把批次 `hidden=1`，还会把该批次所有考生通知置 `deleted=1`，并按考生分组推 `notification-removed` 事件，在线考生的列表立刻少掉这几条。
> **双保险（v1.17.1）**：考生端 `my_notifications()` 与 `_get_my_notification()` 除判断 `deleted=0`，还要求「所属批次 `hidden=0`」（`NOT EXISTS` 子查询，批次不存在的孤儿行仍照常显示）——所以只要批次被管理员删过，考生端一定看不到，不怕两份数据不同步。**改版前**（只隐藏批次、不动考生通知）留下的残留由 `database.py` 的 `_backfill_notify_hidden_batches()` 一次性清掉（`app_meta` 标记 `notify_hidden_batches_cleaned`，启动日志会打印清理条数）。
> **新用户自动收欢迎通知**（v1.17）：`send_welcome_notice(conn, user_id=…)`（文案常量 `WELCOME_TITLE` / `WELCOME_CONTENT`），
> 触发点是「账号刚创建」——注册申请审核通过（`registrations.approve_registration`）与后台手动新增考生（`user_accounts.create_user`）。
> 给其它模块写通知请用本模块的 `send_system_notice()` / `send_welcome_notice()` / `create_batch()` / `push_notification()`，**不要直接 INSERT `notifications` 表**（否则后台「已发送记录」里看不到）。
> **通知「秒达」也接在这一处**：`push_notification()` 写完库就调 `realtime.publish(user_id, 'notification', …)`，
> 所以管理员群发、视频评论回复、密码重置结果全都是即时的。绕过它直接 INSERT 的代码，考生端只能等兜底轮询才发现（见 §3.13）。

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

### 3.13 实时通道 SSE（modules/realtime.py）

把「考生端每 30 秒轮询一次」换成**服务端主动推送**：通知 / 评论回复 / 版本更新 / 被踢下线，写库后立刻送到，延迟从最坏 30 秒降到毫秒级。轮询不删除，退化为兜底，见 §3.14。

| 方法 | 路径 | 权限 | 说明 |
| ---- | ---- | ---- | ---- |
| GET | `/api/user/stream` | 考生令牌 | SSE 长连接（`text/event-stream`）。**前端不要用 `EventSource`**，用 `fetch` + `ReadableStream` 读（要带 `Authorization` 头、要看状态码）；也兼容 `?token=`（会进访问日志，尽量别用）。`config.realtime.enabled=false` 时返回 503，前端据此直接走轮询 |

**事件类型**（SSE 帧：`event: 名字` + `data: JSON`）

| event | data | 前端行为 |
| ---- | ---- | ---- |
| `ready` | `{server_time, user_id}` | 握手，前端不需要处理 |
| `notification` | 与 `GET /api/user/notifications` 的单条**结构完全一致** | 直接插到列表最前 + 弹新通知横幅（不再请求接口） |
| `notification-removed` | `{ids: number[]}` | 管理员删掉的通知 → **静默**从通知列表移除（不弹提示），未读数同步下降 |
| `update` | `version.json` 全部内容 | 交给 `useAppUpdate` 决定是否弹更新提示 |
| `kick` | `{reason}` | 清登录态 → 回登录页，并把 `reason` 显示成提示条 |
| `: ping` | —（注释帧） | 心跳，15 秒一次，浏览器不派发事件 |

**给其它模块用的推送工具**（写完数据库再调，别自己拼 HTTP）

| 函数 | 用途 |
| ---- | ---- |
| `publish(user_id, event, data)` | 推给某考生的全部在线连接（多标签页 / 手机+电脑都收得到） |
| `publish_many(user_ids, …)` / `publish_all(…)` | 推给一批 / 所有在线考生（发新版本用） |
| `kick_session(user_id, reason)` | 通知某考生「登录已失效」（改密码 / 重置密码 / 封号 / 删号） |
| `online_user_count()` | 当前在线考生数（后台版本发布页、启动日志用） |

**推送接线点**（想知道「哪些操作会秒达」看这张表）

| 业务动作 | 接线位置 | 事件 |
| ---- | ---- | ---- |
| 管理员发通知 / 视频评论回复 / 管理员回复评论 / 密码重置成功通知 / **新用户欢迎通知** | `notifications.push_notification()` —— **全站唯一落点**，所有发通知路径都汇到这里 | `notification` |
| 管理员删除某次通知 | `notifications.delete_batch()` | `notification-removed` |
| 考生自助改密码 | `user_security.change_my_password()` | `kick` |
| 管理员改考生密码 / 清密码 / 禁用 / 删号 | `user_accounts.update_user()` / `delete_user()` | `kick` |
| 管理员处理密码重置工单 | `password_resets.approve_reset()` | `kick` + `notification`（含新密码） |
| 后台发布新版本 / 直接改 version.json | `app_update.publish_version()` / `watch_version_file()` | `update` |

> ⚠️ **新增发通知的业务时不要自己 INSERT `notifications` 表**：那样不会走 `push_notification()`，考生端就收不到即时推送（能收到，但要等兜底轮询）。用 `create_batch()` + `push_notification()`。

**部署与限制（改这块前必读）**

1. **只支持单进程**：广播中心是「进程内内存队列 + 事件循环」，`main.py` 用 uvicorn 默认单进程刚好够用。将来若改成 `--workers N`，必须换成 Redis Pub/Sub，否则跨进程收不到推送。
2. **跨线程投递**：FastAPI 的同步路由（`def`）跑在线程池，流式响应跑在事件循环，所以 `publish()` 内部用 `loop.call_soon_threadsafe` 送进队列（主循环在 lifespan 里由 `bind_loop()` 记录）。**不要**在同步路由里直接 `queue.put_nowait`。
3. **推送是「尽力而为」**：考生不在线、队列满（客户端读得慢）就丢帧，**不影响数据**——内容以数据库为准，上线后前端拉一次列表补齐。所以推送漏了只是少了即时感，不会丢通知。
4. **反向代理必须关缓冲**：Nginx / 反代后面要对该路径 `proxy_buffering off;` 并放宽读超时，否则推送被缓冲住，看起来「还是有延迟」。
5. **关掉它的办法**：`config.json` 的 `realtime.enabled=false`（或删掉该段用默认值 `true`）→ 后端返回 503，前端自动退回 30 秒轮询，功能不受影响。

### 3.14 实时通道的前端降级逻辑（改前必读）

| 场景 | 前端表现 |
| ---- | ---- |
| 实时通道 `online` | 通知秒达；轮询放长到 **120 秒**，只用来补「连接抖动期间丢掉的事件」 |
| 通道没连上 / 后端返回 503 / 一直连接失败 | 退回 **30 秒轮询**（原体验），通知、踢会话兜底都在轮询里 |
| 收到 `kick` 或任意请求返回 401 | 清本地登录态 → 广播 `ndt:session-expired` → App 退回登录页（**两条路互补**：实时通道没连上时靠 401 兜底，最坏 30 秒） |
| 页面切回前台 / 网络恢复 | 立刻重连（跳过退避计时器） |

> 前端对应文件：`src/api/realtime.ts`（连接与解析）、`src/hooks/useRealtime.ts`（生命周期）、
> `src/hooks/useNotifications.ts`（收通知 + 轮询降级）、`src/hooks/useAppUpdate.ts`（版本提示）。

### 3.15 题目插图（modules/question_images.py，管理端需管理员令牌 / 考生端需考生令牌）

动机：有些题光靠文字说不清 —— 识图题、表面粗糙度符号、公式截图。**做法是不动数据库结构**：
题目文本仍是纯文本，图片以内嵌标记 `[[img:qimg_xxxxxxxxxxxxxxxx.png]]` 写在文字里，由渲染端换成 `<img>`
（考生端 `src/components/RichText.tsx`，后台 `dashboard.js` 的 `richTextHtml()`）；
一张图可被多道题共用；CSV 导入导出天然兼容（标记就是普通文本）。

| 接口 | 说明 |
| ---- | ---- |
| `POST /api/admin/question-images` | multipart `file` 上传 → `{ok, name, markup, url, message}`；`markup` 就是粘进题干/选项的那串标记 |
| `GET /api/admin/question-images/{name}` | 后台取图（题列表 / 编辑弹窗预览） |
| `GET /api/bank/question-images/{name}` | 考生端取图；**令牌走 `?token=`**（浏览器加载 `<img src>` 带不了 `Authorization` 头），与封面图同一口径 |

- 存盘与校验全在 `modules/upload_utils.py`：格式 `jpg/jpeg/png/webp/gif/bmp`、上限 **5MB**、命名 `qimg_<16位十六进制>.<ext>`；
  `is_question_image_name()` 是**唯一**的文件名判据（防目录穿越），取图前必过它，不合法直接 404。
- ⚠️ **删题目不删图片**（同一张图可能被多道题引用），需要清理时单独处理。
- ⚠️ 适配层 `bank._clean_text()` 会把**原书遗留的 `<img src="jcpicture/xxx.jpg">`** 换成「【图】」占位（那批图从未随 CSV 进来），
  与本文这套标记无关，别混为一谈。
- 前端渲染规则（v1.34 **固定插图区**：md/lg 一段文字里的所有图片收进**固定高度的滚动区** `.rt-img-area`
  —— md 200 / lg 260 高，区内每张图**固定占位**等比缩放（md 160 / lg 220 高，不裁剪都看得到），右侧滚动条**常驻不隐藏**；
  sm 摘要保持行内小图 120px 不套区。点击看大图 / 摘要用 `stripRichText`）见 `FRONTEND.md` §5 组件索引与 §12 修改定位表；
  后台同口径：`dashboard.js richTextHtml()`（非 sm 把连续 `<img>` 包进 `.rt-img-area`）+ `style.css .rt-img-area` —— 改一边同步另一边。
- **后台插入交互（v1.33）**：编辑/添加题目弹窗的「插图」区，选项不再插到光标处，而是**先点 A / B / C… 选选项，图插到那个选项末尾**
  （选项还没有就点「＋ 字母」新建一个，顺带把分隔符统一成 `；##`）；判断题/简答题的选项由系统自动生成，只提示去用「题干插图」。
  实现都在 `dashboard.js`：`parseOptions()`（与 `bank._parse_options` 同口径按 `##` 切段认 `、/﹑`）、`insertImageIntoOption()`
  （纯函数：命中选项→插段尾或替换选项里的 `[图片]` 占位；未命中→追加新选项）、`renderOptPicker()`（按钮组随选项内容与题型刷新）。
  题干插图保持「光标在哪插哪 + 替换 `[图片]` 占位」不变。

### 3.16 网络访问（modules/network.py，v1.65，管理端需管理员令牌）

后台「网络访问」卡片（公网地址横幅下方的 `#net-card`）对应的接口：**局域网直连开关 + 公网隧道一键启停**。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/api/admin/network` | 局域网 `{enabled, ip, port, base_url, site_url, app_url, admin_url}` + 公网 `{running, pid, started_at, log_tail}` |
| POST | `/api/admin/network/lan` | body `{enabled: bool}`：开关局域网访问；**写回 config.json 的 `lan_access.enabled`**（重启保持），内存态即时生效 |
| POST | `/api/admin/network/public` | body `{action: "start" \| "stop"}`：后台拉起 / 杀掉 `tools/tunnel.py` 子进程 |
| GET | `/api/access-info` | **（v1.79，公开无需登录）** 小程序端自动获取当前可用地址：`{ok, port, server_time, local{base_url,app_url}, lan{enabled,ip,base_url,app_url}, public{available,app_url,generated_at}}`。见下方「小程序自动跟随」 |

- **小程序自动跟随（v1.79）**：微信小程序端（`miniprogram/`，web-view 套壳现有 H5）**不写死后端地址** ——
  启动时按「手填地址 → 上次连通的 → `config/env.js` 种子 → 上次学到过的」顺序逐个探 `/api/health`，
  谁返回 200 就用谁；连通后立即 GET `/api/access-info` 把「本机/局域网/公网」三条地址存进本机缓存，下次优先用。
  → **后台「网络访问」卡片上显示的地址一变（换了局域网 IP、隧道重启换了域名），小程序下次打开就自动跟上**，
  不用改代码也不用重发版。接口与卡片同源（lan 部分来自本模块 `_lan_payload` 的同一套 `lan_ip()/_lan_state`，
  public 部分来自 `overview.tunnel_addresses()`）。
- ⚠️ `/api/access-info` **故意不要管理员令牌**（小程序端没有管理员身份；它本来就知道自己要连哪台机器）。
  安全边界是 `lan_guard`：局域网开关关时，非本机请求连这个方法都到不了（403）；公网隧道从 127.0.0.1 连入，不受影响。
  **改守卫逻辑时必须保住这条等价性**（见 §7 红线）。

- **监听与守卫**：`config.server.host` 固定 `0.0.0.0`（三处：config.py DEFAULTS / config.json / config.example.json），
  「谁能访问」由 `main.py` 的 `lan_guard` 中间件控制 —— 调 `network.lan_allowed(client.host)`：
  开关开 → 全放行；开关关（默认）→ 仅本机（127.0.0.1 / ::1 / 本机网卡地址，60 秒缓存）放行，其余 **403**。
  **cloudflared 从本机 127.0.0.1 连入，公网隧道不受开关影响**；开关关 = 行为与旧版只监听 127.0.0.1 完全一致。
- **本机 IP 探测**：`lan_ip()` 用 UDP connect（只查路由不发包）取默认出口网卡地址，离线回退私网段地址；`_local_ips()` 用 `getaddrinfo(gethostname())` 收集本机全部地址（is_local_client 判定用，60 秒 TTL 缓存）。
- **隧道子进程**：start = `Popen([sys.executable, tools/tunnel.py, port])` + drain 线程读输出（防管道写满卡死）+ 写 pid 文件 `server/data/tunnel.pid`；
  stop = `taskkill /F /T /PID`（**杀整棵进程树** tunnel.py→cloudflared，只 terminate 会留孤儿）+ 删 pid 文件；
  状态 = 句柄活着，或后端因 reload 重启后靠 pid 文件 + `tasklist` 检测恢复 running。
  公网地址仍由 tunnel.py 写「公网地址.txt」→ 前端轮询既有 `/api/admin/tunnel` 读取（本模块不重复解析）。
- ⚠️ 手动跑「启动公网访问.bat」起来的隧道，后台「停止」杀不到（没 pid 文件）—— 卡片会显示运行中（检测到 pid 文件）或未启动，两种启动方式别混用。
- ⚠️ uvicorn 的 reload 只盯 `.py`：开关写 config.json **不会**触发服务重启（这正是想要的）。

### 3.17 AI 智能助手（modules/ai.py，v1.83）

前缀 `/api/ai`，均需**考生**令牌。SSE 流式响应头 `Content-Type: text/event-stream; charset=utf-8`。

| 方法 | 路径 | 说明 | 主要错误 |
| ---- | ---- | ---- | ---- |
| GET | `/api/ai/status` | 取 AI 状态：`configured`（是否配了 key）、`chat_model`、`vision_model`、`can_extract_frames`（系统是否可用 ffmpeg）、`video_frames` | 401 |
| GET | `/api/ai/cache/{kind}/{id}` | 只读缓存：`kind=question\|solution\|video`；`content` 为空表示未生成过（**缓存全局共享，不区分考生**） | 401 |
| POST | `/api/ai/question-explain` | 题目 AI 解析 SSE：`{question_id, refresh}`；先回 `meta` 帧（cached/model），随后 `delta` 增量，最后 `done` | 400 题目不存在；401；500 key 无效/网络错误（以 `event: error` 帧返回） |
| POST | `/api/ai/question-solution` | **计算题解答过程 SSE（v1.84）**：`{question_id, refresh}`，提示词走「已知 → 公式 → 代入计算 → 结论」（**不是**逐选项点评）；同样 `meta`/`delta`/`done` | 400 题目不存在；401；500 同上 |
| POST | `/api/ai/video-summary` | 视频 AI 概括 SSE：`{material_id, refresh}`；后端用 ffmpeg 抽 `video_frames` 张关键帧送 GLM；同样 `meta`/`delta`/`done` | 400 资料不存在/非视频；401；500 同上 |

- **v1.84 计算题「题目原题讲解」的数据流**：考生端 `questions.explanation` 非空 → 直接用题库内容（**不调 AI**，也不显示免责提示）；为空 → 调 `/api/ai/question-solution` 分步生成，前端在 AI 正文后面固定加一句「AI 生成、不一定正确」。缓存落 `ai_question_solution`。**后台侧**：题目弹窗「解析 / 解答过程」字段此前 `QuestionBody.explanation` 收了但不落库，v1.84 起真正写进 `questions.explanation`（`add_question` / `update_question` 都带上了），并支持 `＋ 解答过程插图` 把图插进这段文字。

- **缓存语义**：`ai_question_explain` 按 `question_id`、`ai_video_summary` 按 `material_id` 各存一行，**全局共享**（不按考生隔离）—— 同一道题 / 同一个视频只调一次模型，所有考生复用；第二次命中缓存直接以 `meta {cached:true}` + 一段 `delta` 回放旧内容。`refresh=true` 会删除旧缓存重新生成。
- **视频概况的图片上限（v1.83 实测踩坑）**：智谱 `glm-4v-flash` 单次请求最多只接受 **5 张图**，超过直接 `400 / 错误码 1210「输入图片数量超过限制」`（`glm-4v` 更高但需付费）。因此 `_summary_stream` 在帧数 ≥2 时先用 `_contact_sheet()` 把关键帧拼成**一张宫格图**再送（一次只算 1 张），拼图失败才退回逐张发送（最多 `_VISION_MAX_IMAGES = 5` 张）。
- **错误处理**：生成失败不会爆 500 掉整个 HTTP 连接，而是继续发 `event: error` 帧给考生端，前端显示人话提示。
- **环境依赖**：视频概括依赖系统 `ffmpeg`（含 `ffprobe`），抽帧失败时退化为「按标题+简介概括」；智谱 `api_key` 为空或被服务端拒绝时 `configured=false`，前端 AI 按钮显示未配置。
- **配置项**：`server/config.json` 的 `ai` 段（模板见 `config.example.json`）：`api_key` / `base_url` / `chat_model` / `vision_model` / `timeout_seconds` / `video_frames`。

---

## 4. Service 索引（内部函数，不对外暴露）

| 模块 | 函数 | 职责 |
| ---- | ---- | ---- |
| `security.py` | `hash_password` / `verify_password` | PBKDF2-HMAC-SHA256 + 随机盐；`compare_digest` 防时序攻击 |
| `security.py` | `new_token` / `new_sms_code` / `new_captcha_code` / `new_random_password` | 43 字符令牌 / 6 位数字码 / 4 位图形码（去易混字符 0O1I）/ 8 位随机密码（重置考生密码用） |
| `database.py` | `get_meta` / `set_meta` / `_backfill_profile_defaults` / `_backfill_notify_hidden_batches` | 一次性任务的执行标记读写；给历史账号补随机昵称与头像、清掉「后台已删除、考生端仍留着」的历史通知（各自只跑一次） |
| `deps.py` | `create_session` / `revoke_session` / `resolve_session` / `bearer_token` | 令牌签发、吊销、校验（含过期清理）、从请求取令牌 |
| `deps.py` | `get_current_admin` / `get_current_user` | FastAPI 依赖；校验状态、剔除密码哈希、401/403 |
| `captcha.py` | `generate()` / `verify(id, code)` / `_build_svg(code)` | 生成并落库 → 返回 base64 SVG；校验一次性作废；换第三方验证码只改这两个函数 |
| `profile_defaults.py` | `random_nickname()` / `random_avatar()` | 建号时的随机资料：形容词×名词（120 种）随机昵称；`preset:<1..N>` 随机头像 |
| `user_profile.py` | `get_my_profile()` / `update_my_profile()` | 考生取/改自己的昵称与头像；只能改自己（走 `get_current_user` 的 `subject_id`） |
| `registrations.py` | `register()` / `approve_registration()` / `reject_registration()` | 提交申请（校验图形码 + 账号唯一）；通过时写 `user_accounts`；拒绝记原因 |
| `auth.py` | `password_login` / `change_password` | 先查管理员再查考生；改密码后删除本人全部会话 |
| `overview.py` | `stats()` | 只读统计，含注册申请与密码重置各自的计数 |
| `ai.py` | `_call_chat(messages, model)` | 统一调用智谱兼容接口，失败时按状态码映射成人话；支持文本/图文消息 |
| `ai.py` | `_extract_frames(path, count)` | ffmpeg 抽关键帧 → base64，用于视频概括；失败返回空列表 |
| `ai.py` | `_build_explain_messages(q) / _build_summary_messages(m, frames)` | 构造送 GLM 的 prompt（system + 题目/视频上下文），所有格式约束写在这里 |
| `ai.py` | `ai_cache(kind, target_id)` | 只读缓存（`kind=question\|video` → 对应缓存表一行；无则返回 `{content:''}`），不触发生成 |
| `ai.py` | `_contact_sheet(frames, cols=0)` | 把抽到的多帧拼成一张宫格图（`ffmpeg tile`），默认取接近正方形的列数（6 帧→3×2）；返回 `(data_url, cols, rows)`，失败返回 None |
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
| **AI 智能助手（题目解析 / 视频概括）** | `server/modules/ai.py` + `config.json ai 段` + `src/components/Ai*.tsx` + `src/api/client.ts aiApi` | ✅ | 只新增缓存表，不改动题目/资料/答题记录表；失败全部收敛到 error SSE 帧，不影响其它功能 |
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
   - **有效期 = `config.security.token_ttl_hours`（默认 360 小时 = 15 天）+ 滑动续期**：`deps.resolve_session()` 校验通过后调 `_renew_session()`，把有效期续到「现在 + TTL」，效果 = **15 天不访问才失效**（不是登录满 15 天被踢）。按天节流（剩余有效期 > TTL−24h 不写库），所以不会每个请求都 `UPDATE`。前端 App 每次打开都会请求接口，等于「用着就一直登录着」；`config.py` / `config.example.json` / `config.json` 三处默认值一致，改小即收紧（如 24 = 一天不登录重登）
3. **越权**：所有 `/api/admin/**` 挂 `get_current_admin`；考生数据靠 `subject_id` 隔离
4. **护栏**：不能删除/禁用自己；不能删除、禁用或降级「最后一个启用状态的超管」
5. **注册风控**：图形验证码一次性 + 5 分钟有效；账号唯一性同时校验 `user_accounts` 与「待审中」的申请；**未审核通过一律不能登录**
6. **密钥**：`server/config.json` 已 gitignore，绝不提交、绝不进前端代码
7. **局域网守卫（v1.65）**：服务监听 `0.0.0.0`，但 `lan_guard` 中间件默认（`lan_access.enabled=false`）只放行本机来源、其余 403 —— **改动守卫逻辑时必须保持「开关关 = 行为与只监听 127.0.0.1 一致」这一等价性**；cloudflared 走 127.0.0.1 回环，公网隧道不受影响；不要在守卫之外给静态挂载 / 路由开旁路

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
| 「已发送记录」列表 / 按批次删记录 | `notifications.py` 的 `list_batches()` / `delete_batch()`（删除 = 后台记录 + 考生端通知一起移除；考生端读列表还会再校验批次 hidden，见 `my_notifications`） |
| **检查更新 / 版本号** | `server/modules/app_update.py` + `server/data/version.json`（后端）+ `src/data/appVersion.ts` + `src/screens/SettingsScreen.tsx`（前端） |
| **发布新版本 / 强制更新** | 后台「版本发布」Tab（`dashboard.html`/`dashboard.js` 的 `bindVersionModule`）+ `POST /api/admin/app/version`；发版**两处必须一起改**：`version.json` 的 `latest_version` 与 `src/data/appVersion.ts` 的 `APP_VERSION` |
| **通知/版本/踢会话的实时推送（延迟）** | `server/modules/realtime.py`（`publish()` / `kick_session()` / `publish_all()`）+ 接线点见 §3.13；前端 `src/api/realtime.ts` + `src/hooks/useRealtime.ts`；关掉用 `config.json` 的 `realtime.enabled=false` |
| **通知什么时候弹横幅 / 轮询间隔** | 前端 `src/hooks/useNotifications.ts`（实时事件 → 秒达 + 弹横幅；通道不可用时退回 30 秒轮询） |
| **题库导入 / 题库概览** | `server/modules/bank.py`（`ensure_bank_imported()` 表空才导；CSV 在 `server/data/question_bank.csv`；`METHOD_NAMES` 是方向→中文名唯一映射） |
| **资料库（上传/封面/统计）** | `server/modules/materials.py`（分类常量 `MATERIAL_CATEGORIES` 与后台 dashboard.js、前端 MaterialsScreen 三处同步）；文件在 `server/data/uploads/` |
| **视频播放量 / 收藏 / 评论** | `materials.py` 的 `material_views` / `material_favorites` / `material_comments` 表与 `/api/library/{id}/view|favorite|comments` 接口；管理端评论管理走 `/api/admin/material-comments` |
| **音乐（上传 / 播放 / 歌词 / 封面）** | `server/modules/music.py`（音频与封面存 `server/data/uploads/`，元数据存 `music_tracks` 表；格式白名单 `AUDIO_EXTENSIONS`、上限 `MAX_AUDIO_MB=200` / `MAX_LYRIC_CHARS=20000`；后台页 `dashboard.html#panel-music` + `dashboard.js` 的 `bindMusicModule()`；考生端 `src/screens/MusicScreen.tsx` + `client.ts musicApi`） |
| **主题商店（背景图 + 配色皮肤，v1.82）** | `server/modules/themes.py`（管理端 `/api/admin/themes` CRUD + `/order` + 预览图/背景图三件套；考生端 `/api/themes` **公开无鉴权**）+ `database.py` 的 `themes` 表 + 后台页 `dashboard.html#panel-themes` / `dashboard.js` 的 `bindThemeModule()`；前端 `src/themeStore.ts`（唯一运行时）+ `src/screens/ThemeStoreScreen.tsx` + `src/theme.ts`（`data-skin`）；皮肤只存 `localStorage: ndt_skin`。**改配色派生规则只改 `themeStore.ts` 的 `buildVars()`** |
| **出题 / 交卷 / 首页统计 / 错题本** | `server/modules/practice.py`（`DAILY_GOAL=60` 与首页进度环一致；统计口径只算 `kind='answer'`；时长按 `session_id` 去重求和；「已掌握」=最近一条记录 `is_correct=1`，含 master 记录） |
| **随机的默认昵称 / 预设头像数量** | `server/profile_defaults.py` |
| **预设头像的图案与配色** | `src/data/avatars.ts`（前端）+ `dashboard.js` 顶部 `AVATAR_PRESETS`（后台）—— 两边顺序必须一致 |
| 登录方式 / 改自己的密码 | `server/modules/auth.py` |
| 验证码发送 / 换短信服务商 | `server/modules/sms.py`（只改 `_send_via_tencent`） |
| **局域网访问开关 / 守卫 403 / 本机 IP 探测** | `server/modules/network.py`（`lan_allowed` / `lan_ip` / `_local_ips`）+ `main.py` 的 `lan_guard` 中间件 + 后台「网络访问」卡片（`dashboard.js` 的 `loadNetwork/bindNetwork`）；开关状态存 `config.json` 的 `lan_access.enabled` |
| **公网隧道一键启停 / 隧道 pid** | `server/modules/network.py`（`start_tunnel` / `stop_tunnel` / `tunnel_status`，pid 文件 `server/data/tunnel.pid`）；公网地址仍读「公网地址.txt」（`/api/admin/tunnel`，见 `modules/overview.py`） |
| **小程序端地址自动跟随** | 后端：`modules/network.py` 的 `public_router` → `GET /api/access-info`（公开）+ `overview.tunnel_addresses()`（唯一解析点）；小程序：`miniprogram/app.js` 的 `resolveAppUrl` / `learnAddresses` / `hintAppUrl` / `shareServer`，探测种子在 `miniprogram/config/env.js`（lan/tunnel/cloud 默认留空靠自动探测） |
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
| 2026-10-11 | **v1.83 AI 智能助手（题目 AI 解析 / 视频 AI 概括，后端新增 `modules/ai.py`）**：需求「小程序在每个题目加一个 AI 解析的功能，还有视频有 AI 概括的功能，格式显示好看流畅，调用智谱 AI」。① **配置**：`server/config.py` 新增 `ai` 段默认（`base_url=https://open.bigmodel.cn/api/paas/v4`、`chat_model=glm-4-flash`、`vision_model=glm-4v-flash`、`timeout_seconds=120`、`video_frames=6`）与 `ai_ready()` / `ai_conf()`；`config.example.json` / `config.json` 同步新增 `ai` 段，`api_key` 由用户填入，**密钥只落后端**。② **数据库**：`database.py` 新增 `ai_question_explain`（**`question_id` 主键**）与 `ai_video_summary`（**`material_id` 主键**）两缓存表，各含 `content` / `model` / `created_at`；**故意不带 user_id —— 一道题 / 一个视频全局只生成一次，所有考生共用，省 token**；无旧表改动。③ **新模块** `server/modules/ai.py`：依赖 `get_current_user`（考生令牌隔离）；`GET /api/ai/status` 公开后端能力；`GET /api/ai/cache/{kind}/{id}` 读缓存；`POST /api/ai/question-explain` 与 `POST /api/ai/video-summary` 均返回 SSE（`meta`/`delta`/`error`/`done` 四帧）。`_build_explain_messages()` 把题目 method/topic1/topic2/qtype/content/options_json/answer 组装成带格式约束的 prompt；`_build_summary_messages()` 把视频 title/method/description + ffmpeg 抽取的关键帧 base64 一起送 GLM；`_call_chat()` 统一走 OpenAI 兼容格式，按 HTTP 状态码/响应体映射成人话错误。④ **抽帧 / 拼图 / 缓存**：`_extract_frames()` 调用系统 `ffmpeg` 按「每段中点」均匀抽取 `config.ai.video_frames` 张 JPG（`scale=480:-2`），失败返回空列表 → 视频概括退化为仅按标题+简介生成；⚠️ **实测踩坑**：智谱 `glm-4v-flash` 单次最多接受 **5 张图**（超过报 `400 / 1210「输入图片数量超过限制」`），故新增 `_contact_sheet()` 用 `ffmpeg tile` 把多帧拼成**一张宫格图**（6 帧 → 3×2、带 6px 黑边），一次只送 1 张，拼图失败才退回逐张（≤ `_VISION_MAX_IMAGES=5`）；提示词里说明「从左到右、从上到下 = 时间顺序」；缓存命中直接回放旧内容，`refresh=true` 删旧重建。⑤ **`main.py` 注册 `ai.router`**。⑥ **前端配套**：见 `FRONTEND.md` §15 v1.83。⑦ **验证**：`ast.parse` / 启动加载通过；真实库重启自动建表；**真机真实智谱端到端验证通过**（`verify_real.py`，临时会话测完即删、缓存行测完即清）—— `/api/ai/status` 返回 `configured=true`；题目解析 155 个 delta 帧、首字 0.9s / 全程 8.0s，输出「正确选项依据 / 逐项分析 / 易错点」结构化 Markdown；第二次请求命中缓存（`meta.cached=true` + 1 个 delta）；视频概括先抽 6 帧 → 拼 3×2 宫格图（93KB）→ `glm-4v-flash` 正确识别出「CS-2 试块、PXUT300N 探伤仪、探头放置、灵敏度调节、波形判读」，263 个 delta 帧 / 首字 7.9s；`npx tsc --noEmit` 0 错误 + `npm run build` 通过。临时 mock 服务、测试会话与测试缓存已清理。⚠️ 第一版密钥 `9de70250…` 曾被智谱判 401 无效，用户已换新密钥 `839cc9ef005c4389ae3b9bb8c134e35b.dvqSUhyVQSVZ0ey4` 写入 `server/config.json`。 |
| 2026-10-11 | **v1.82 主题商店（管理员上传皮肤包 → 考生自选应用，后端新增 `modules/themes.py`）**：用户需求「『我的』界面加主题商店、管理员页面可上传生成主题、应用到登录/注册界面以及登录成功后所有界面、且不能变形」。① `database.py`：新表 `themes`（name / primary_color / secondary_color / text_tone(dark\|light) / preview_name / background_name / sort_order / created_by / created_at）+ 索引 `idx_theme_order(sort_order DESC, id DESC)`（纯新增表，`CREATE TABLE IF NOT EXISTS` 对老库同样生效，无需补列）。② 新模块 `server/modules/themes.py`（339 行）：`admin_router`（prefix `/api/admin/themes`）= 列表 / **`POST /order`（⚠️ 必须声明在 `/{theme_id}` 之前）** / 新建（multipart：name + 主辅色 + 字色 + preview? + background?）/ 改信息 / 删（**连预览图与背景图文件一起删**）/ 预览图·背景图各一套「取·传·删」三件套；`router`（prefix `/api/themes`）= 列表 + 取预览图 + 取背景图，**故意不挂 `get_current_user` 依赖**（登录/注册页没有令牌也要能应用主题）。③ 校验：色值 `^#[0-9A-Fa-f]{6}$`（`_clean_color`，非法 400）、`text_tone` ∈ `dark\|light`（`_clean_tone`）、预览图 ≤8MB（`MAX_PREVIEW_MB`，前缀 `theme_preview_`）、背景图 ≤15MB（`MAX_BACKGROUND_MB`，前缀 `theme_bg_`），图片落盘复用 `upload_utils.save_cover` / `unlink_quiet`，排序复用 `apply_manual_order` / `next_sort_order`。④ `main.py`：import `themes`、注册 `themes.router` + `themes.admin_router`，`description` 补「主题商店」。⑤ **「不变形」的落地方式 = 只覆盖 CSS 变量 + 叠一个全屏固定背景层，一行尺寸都没动**：前端新增 `src/themeStore.ts`（`buildVars()` 按 `text_tone` 派生深浅两套语义面令牌、由主色派生 `--accent*` / `--color-emerald-*` / `--color-teal-500` / `--emerald-600-text`；`applySkin()` 清变量→写变量→置 `html[data-skin]`→`renderLayer()`→存 localStorage→`setThemeMode(getThemeMode())`）、`src/screens/ThemeStoreScreen.tsx`（当前皮肤卡 + 恢复默认 + 主题列表）、`src/theme.ts`（`paint()` 优先读 `data-skin`，让 `data-theme` 跟随皮肤明暗基调）、`src/index.css` 的 `#ndt-skin-bg`（`position:fixed; inset:0; z-index:-1; background-size:cover` → 背景图是**裁剪铺满而非拉伸**）；选择结果只存 `localStorage: ndt_skin`，**不落库、不上传服务器**。⑥ 后台 `dashboard.html/js`：新增**「主题商店」Tab**（十一个 Tab）：说明 + 刷新/上传工具栏 + 表格（序号 / 预览 / 主题名 / 主色 / 辅色 / 字色 / 背景图 / 创建时间 / 排序 ↑↓ / 操作）+ 空态；新建 / 编辑弹窗、预览图与背景图上传弹窗、删除确认，全部复用既有 `openModal()` / `field()` / `multipartRequest()` / `moveCell()` 模式。校验：`npx tsc --noEmit` **0 错误** + `npm run build` 通过（11.32s）；后端接口端到端全过（管理端 CRUD / 改图 / 排序 / 未登录 **401**、非法色值 **400**、不存在的主题 **404**、考生端三条公开接口 **200**）；Playwright + 真实 Chrome 截图验证 —— **默认登录页零变化**、两种字色（深色字/浅色字）主题在登录页与主界面均正确生效、主题商店页正常、主界面无明显变形；**测试数据全部清理**（`themes` 行数回到 0、`theme_*` 文件已删、`NAVTEST-*` 临时会话已删）。前端配套见 `FRONTEND.md` §15 v1.82。 |
| 2026-10-11 | **v1.79 小程序端自动获取服务器地址（后端新增公开接口 `/api/access-info`）**：用户要求「小程序地址根据管理员页面的地址实时更新」。① `modules/overview.py`：把 `/api/admin/tunnel` 的解析逻辑抽成 **`tunnel_addresses()`**（「公网地址.txt」**唯一**解析点），原路由改成薄封装 —— 避免出现第三份正则（写方 `tools/tunnel.py` 的 `announce()`、解析方 `overview`）。② `modules/network.py` 新增 `public_router`（prefix `/api`）→ **`GET /api/access-info`**：返回 `{ok, port, server_time, local{base_url, app_url}, lan{enabled, ip, base_url, app_url}, public{available, app_url, generated_at}}`；lan 与 `_lan_payload()` 同源（同一个 `lan_ip()`/`_lan_state`），public 来自 `overview.tunnel_addresses()` → **与后台「网络访问」卡片完全一致**。③ `main.py` 注册 `app.include_router(network.public_router)`。④ **公开性说明**：不加管理员依赖（小程序端没有管理员身份，且它本来就知道要连哪台机器）；安全边界仍是 `lan_guard` —— 局域网开关关时非本机请求 403、公网隧道从 127.0.0.1 连入不受影响；暴露内容与后台卡片一致，不多给任何数据。⑤ **小程序端同步改造**（新目录 `miniprogram/`）：`config/env.js` 的 `ENVS` 降级为「探测种子」（lan/tunnel/cloud 默认留空），新增 `baseOf()`（App 地址 → 站点根，接口都挂在根上而不是 `/app/` 下）与 `probeSeeds()`；`app.js` 新增 `resolveAppUrl(opts)`（顺序 = 手填 > 上次连通 > 种子 > 学到过的，串行探 `/api/health` 返 200 即采用）、`learnAddresses()`（拉 access-info 存入 `ndt_discovered_urls`）、`hintAppUrl()`（分享链接带进来的地址只进候选列表、不污染手填地址）、`shareServer()`；`pages/index/*` 改为异步探测后再渲染，兜底页新增「自动探测服务器」+「点一下切换」快捷地址，分享链接带 `?server=` 参数。**原有前端 src/ 与后台 static/ 零改动**。校验：`py_compile` + `node --check` 全过；直接调用 `network.access_info()` / `overview.tunnel_addresses()` 验证（局域网 IP 实测 `10.250.157.230`，隧道地址四项解析命中）；运行中的 8000 服务经 uvicorn reload **已自动加载**新接口（`curl /api/access-info` → 200）；Node 桩跑通小程序地址解析链路 **5 个场景**（DevTools 命中 127.0.0.1 并学到 3 条地址 / 真机首次无缓存 → 兜底页 / 手填一次即用 / 隧道地址变更后用学到的地址自动跟随 / 全部不通 → 兜底页），并验证 `hintAppUrl` 不污染手填地址。 |
| 2026-10-11 | **管理后台登录页返回按钮最终定为「← 返回」**（初版「返回上一级」→「返回登录注册界面」→ 用户定稿「返回」；行为不变：固定 `location.href='/app/'` 直接回考生端登录/注册屏，不走浏览器历史）。同日：考生端 `src/index.css` Tailwind 改**平铺引入** + 调色板 hex 覆写 + **渐变覆写**（`.bg-gradient-to-r { --tw-gradient-position: to right }` —— Tailwind v4 编译出 `to right in oklab`，模拟器老内核不识别 → 登录/注册主按钮背景失效、白字隐形；详见 FRONTEND.md §11）。后端逻辑零改动。 |
| 2026-10-09 | **v1.75 题库导入模板扩充为「全面版」+ 导入支持 `#` 说明行**：用户需求「导入题库的模板更新一下、尽量全面一点」。① **模板重写**（项目根 `题库导入模板.csv`，仍是唯一维护点）：UTF-8 BOM + CRLF；首行标准 8 列表头；紧接 **6 行 `#` 开头的说明行**（字段含义 / 选项写法 `A、x；##B、y` / 答案写法（判断题正误、单选单字母、多选连写 `AC`、计算简答写过程）/ `[图片]` 占位图题 / 文件格式说明（UTF-8 BOM、可另存 xlsx 或 GBK CSV、含英文逗号用双引号括格）/ 示例区提示）；再跟 **13 行示例**，六种题型逐类覆盖：判断题正误各一、选择题 3/4/5 选项各一、多选两例、计算题「无选项自评」+「带选项」各一、计算选择题一例、简答题两例 + 一例带 `[图片]` 占位的图题。② **导入静默忽略说明行**（`modules/question_sets.py` 的 `import_csv`）：行循环开头加 `if row and (row[0] or "").lstrip().startswith("#"): continue` —— 只看**首格**（序号列），真实题目不会以 `#` 开头，老格式文件行为不变；这样模板自带文档、直接导入也不再逐行报「列数不足」。③ 后台导入弹窗（`dashboard.js`）说明文字同步补全：列含义、六种题型、选项/答案写法、`[图片]` 占位、`#` 说明行会被忽略；按钮文案改「下载导入模板（含完整字段说明 + 六种题型示例）」。校验：`py_compile` + `node --check` 通过；隔离副本（真实库拷贝 + `DB_PATH` 指向副本）用 `normalize_table_input()` 解析新模板（识别 UTF-8 BOM + 8 列表头全对应）后调 `import_csv(-1, ...)` → **imported 13 / skipped 0 / errors 空 / warnings 空**，`imported_by_type = {judge:2, single:3, multi:2, calc:2, calcsel:1, short:3}`，13 行逐条核对题型/选项数/答案/章节全对，6 行 `#` 说明全部静默跳过；真实库未动。 |
| 2026-10-09 | **v1.74 题库（`question_sets`）加「方向/类型」字段 + 后台题库列表按方向筛选**：用户需求「题库/题库系列新建时能选类型（RT / UT / 综合…），题库列表上方能按这个筛出哪些是 RT、哪些是 UT」。题库系列（`question_set_series.method`）v1.30 起本就有方向，本次只补**题库**这一层。① `database.py`：`question_sets` 加 `method TEXT NOT NULL DEFAULT ''`（建表 + `_migrate()` patches 双写，老库启动自动补列，既有题库全 `''`=通用，行为不变）。② `modules/question_sets.py`：`SetBody` 加 `method`（≤8 字），新增 `_clean_method()` 校验（取值必须属 `QS_METHODS`，与题库系列同源，非法 400）；`create_set` / `update_set` 写入 `method`（PUT 摘要与文档同步为「名称/级别/方向/描述/所属系列」）；`_set_public` 输出 `method`；`_builtin_public` 也回 `method`（内置 UT/RT/MT/PT 天生带方向）。③ `GET /api/admin/question-sets` 新增 `?method=` 筛选：**自定义题库走 SQL `AND method = ?`；内置题库（无 series_id、set_id 为 NULL）不受系列/散题库筛选影响的老逻辑不变，但按方向筛时保留 `method` 相符的内置题库**（如筛 UT 会同时列出内置「超声检测（内置）」+ 自建 UT 题库），不填 `method` 时内置照旧全列。④ 后台 `dashboard.html/js`：题库工具条新增**「方向」下拉（`#qs-method`，全部方向 / UT / RT / MT / PT / ET / VT / 综合）**，`change` 即重新拉列表（`loadQuestionSets` 带 `method` 参数）；题库表加**「方向」列**（空=通用）；「新建 / 编辑题库」弹窗加**「方向」下拉**（复用 `QS_METHODS`，与系列弹窗同口径），提交带 `method`。⑤ 考生端**零行为改动**（front 只给 `BankSet` 类型补了可选 `method?` 字段，散题库仍只在「全部」Tab 平铺）；前端配套见 `FRONTEND.md` §15 v1.74。校验：隔离副本（真实库拷贝 + `database.DB_PATH` 指向副本）跑 `init_db()` → `question_sets` 含 `method` 列、8 套既有题库全 `''`；直接调 `list_sets(method=...)`：全部 12 条、UT 命中 2（内置超声 + 自建）、RT 命中 2、综合 1、MT 1（仅内置），筛选与覆盖逻辑全对；`py_compile` 通过；in-process `app.openapi()` 确认 GET 参数含 `method`、`SetBody` 含 `method`。真实库已由重启迁移（只加列，不动数据）。 |
| 2026-10-09 | **v1.73 音乐动效系统升级 —— 纯前端版本，后端零改动**：新增的 Web Audio 真实频谱分析走浏览器侧（`AnalyserNode` 直接连 `<audio>` 元素，音频文件仍走原有 `GET /api/music/file` 的 `FileResponse`，其 HTTP Range 支持早已具备），动效设置存前端 `localStorage: ndt_music_fx[:账号]`，不新增/不修改任何 API、数据表与后台页面。此后端无版本号递增。 |
| 2026-10-04 | **v1.65 网络访问（局域网直连开关 + 公网隧道后台一键启停），现有功能零改动**：用户反馈公网隧道慢，要在保留公网的前提下给同一 WiFi 的设备提供快的直连入口。① 新模块 `server/modules/network.py`（337 行）：`GET /api/admin/network`（局域网开关/IP/三条地址 + 隧道状态）、`POST /network/lan`（开关，**写回 config.json `lan_access.enabled` 持久化**，内存态即时生效）、`POST /network/public`（`start`/`stop` 隧道子进程）。② **监听改 0.0.0.0 + 守卫换安全**：`config.py` DEFAULTS / `config.json` / `config.example.json` 的 `server.host` 127.0.0.1 → 0.0.0.0 并新增 `lan_access.enabled`（默认 false）；`main.py` 新增 `lan_guard` 中间件（注册在 `no_store_for_api` 之后 = 先执行）：`network.lan_allowed(client.host)` 不过 → 403。**开关关（默认）= 行为与旧版只监听 127.0.0.1 完全一致**；cloudflared 从 127.0.0.1 回环连入，公网隧道不受开关影响。本机 IP 判定 = 127.0.0.1/::1 + `getaddrinfo(gethostname())` 全部本机地址（60 秒 TTL 缓存，覆盖「本机用局域网 IP 打开自己」）；`lan_ip()` 用 UDP connect 223.5.5.5 只查路由不发包。③ **隧道子进程**：start = Popen 拉起 `tools/tunnel.py <port>`（drain 线程防管道写满）+ pid 文件 `server/data/tunnel.pid`；stop = `taskkill /F /T` 杀整棵树（tunnel.py→cloudflared）+ 清 pid；后端因 reload 重启后靠 pid 文件 + tasklist 恢复 running 状态。公网地址链路不变（tunnel.py 写「公网地址.txt」→ `/api/admin/tunnel` 读），前端启动后轮询至 `available`。④ 后台 `dashboard.html`（701 行）：公网横幅下新增「网络访问」卡片（`#net-card`）：局域网 toggle 开关 + 官网/App/后台三条地址 + 复制；公网一键启动（启动中每 3 秒轮询，90 秒超时）/停止按钮，运行中显示公网地址、停止后显示「最近一次地址（已失效）」。`dashboard.js`（4420 行）`loadNetwork/bindNetwork/pollPublicUrl/copyNetText`；`style.css`（470 行）`.net-*` 与 `.switch` 开关样式（全用主题变量）。⑤ `main.py` 注册 `network.router`；lifespan 打印加局域网开关状态与地址（host=0.0.0.0 时打印 127.0.0.1 才能点开）。⚠️ 手动 bat 起的隧道后台停不掉（无 pid）；⚠️ 改守卫必须保持「开关关 = 只监听 127.0.0.1」等价性（见 §7）。校验：`py_compile` + `node --check` + JS/HTML 元素 id 交叉匹配（13 个 net-* 全命中）通过；隔离副本（复制 server/+tools/ 到 _net_test，8010 端口，测试后已清理大部分）真实子进程 e2e **25/26** —— 守卫纯函数 5 断言（本机/网卡地址放行、外部 203.0.113.77 拒绝）、登录→GET network→开（config 持久化 true + 其余键保留 + 内存生效）→关（恢复 false + 外部重新被拒）、隧道 start（pid 写入 + running）→ 15 秒日志「隧道已连接，正在校验公网地址」→ stop（running=false + pid 清理）全过；唯一 FAIL 是测试脚本跨进程检查内存态的方法假象（服务进程开关切换已由 config.json 与后续接口行为闭环验证）。开发期间发现并修复 `_local_ips()` 返回值 bug（元组未取 `[1]`，首请求必 403）。真实 8000 服务 uvicorn reload 已自动加载新代码（0.0.0.0 监听生效），正式环境未动数据。 |
| 2026-10-04 | **v1.62 接口响应统一禁缓存（`Cache-Control: no-store`）**：用户反馈「上下滑动动不动就刷新」。根因之一是 `/api` 响应体小、又没有 `Cache-Control`，手机浏览器（尤其微信内置浏览器）会按**启发式缓存**自行决定缓存时长，之后每次进入同一页先用旧数据渲染、再静默重发一次请求重新验证，表现就是「没下拉页面却一直在刷新」。① `main.py` 新增 `@app.middleware("http") no_store_for_api`：所有 `request.url.path` 以 `/api` 开头的响应统一补 `Cache-Control: no-store`（此前只有 `/admin` 静态资源设了 `no-cache`，接口响应一直是裸的）。⚠️ **中间件注册必须在 `include_router` 之前**才覆盖全部路由。② 前端配套：`src/api/client.ts` 的 `apiRequest` 的 `fetch` 加 `cache: 'no-store'`；`PullToRefresh.tsx` 顶部判定收紧为「触点须落在滚动容器内 + `scrollTop <= 0`」双条件（详见 `FRONTEND.md` §15 v1.62）。⚠️ 本批后端改动**必须重启服务**生效（先 `taskkill` 全部 `python.exe` 再启动；`uvicorn --reload` 有只打印 `Reloading` 不真重启 worker 的坑）。校验：`ast.parse` 语法通过 + `npx tsc --noEmit` 0 错误 + `npm run build`（15.82s）通过。 |
| 2026-10-04 | **v1.50 音乐专辑（后台创建 → 歌曲归入 → 考生端「专辑」Tab）+ 播放中隐藏底部导航**：① `database.py`：新表 `music_albums`（name/description/cover_name/sort_order/uploaded_by/created_at）+ `music_tracks` 补列 `album_id INTEGER`（NULL = 未归专辑；走 `_migrate()`，老库自动补列，既有歌曲全为 NULL）+ 索引 `idx_music_album(album_id, sort_order DESC)`、`idx_music_albums(sort_order DESC, id DESC)`。② `modules/music.py` 新增管理端专辑 CRUD：`GET /api/admin/music/albums`（带歌曲数）/ `POST /api/admin/music/albums`（multipart name+description+cover?）/ `PUT|DELETE /api/admin/music/albums/{id}` / 封面三件套 `/albums/{id}/cover`；**删专辑不删歌**（歌曲 `album_id` 置 NULL 退回「未归专辑」）。③ 上传 / 编辑歌曲新增 `album_id` 参数：`_norm_album_id()` 校验（0/空/负数 = 未归专辑，不存在 → 400），选中专辑时把专辑名**同步写入 `album` 文本字段**（专辑改名时也 UPDATE 归属歌曲的 album，保证列表 / 搜索口径一致）。④ 考生端新增 `GET /api/music/albums`（专辑列表 + 每张专辑的歌曲，含 `favorited`）与 `GET /api/music/albums/{id}/cover` —— ⚠️ 固定路径段与 `/{track_id}/xxx` 段数不同，不冲突。⑤ 后台 `dashboard.html/js`：音乐面板新增「专辑」卡片（新建 / 改名 / 换封面 / 删除，`albumCache` + `albumSelectOptions()`），上传 / 编辑歌曲弹窗「专辑」文本框 → 「所属专辑」下拉。⑥ 前端 `MusicScreen` 的底部导航显隐改由**播放状态**驱动（`onOverlayChange(playing)`）。校验：副本服务（8011，复制 server/ 到 .tmp-srv，测试后清除）HTTP e2e 全过 —— 管理员登录 → 专辑列表空 → 新建 → 列表含歌曲数 → 把首曲 `album_id` 归入 → 专辑 `track_count=1` → 考生端 `/api/music/albums` 返回该专辑 + 歌曲 → 改名后歌曲 `album` 同步 → 删专辑后考生端无专辑、**歌曲仍在且 `album_id=0`**；真实库未动。`npx tsc --noEmit` 0 错误 + `npm run build`（12.63s）通过。 |
| 2026-10-04 | **v1.44 音乐（后台上传曲目 → 考生端真实在线播放）**：① `database.py`：新表 `music_tracks`（title/artist/album/lyric/duration/file_name/stored_name/mime/file_size/cover_name/play_count/sort_order/uploaded_by/created_at）+ 索引 `idx_music_order(sort_order DESC, id DESC)`（纯新增表，`CREATE TABLE IF NOT EXISTS` 对老库同样生效，无需 `_migrate()` 补列）。② 新模块 `modules/music.py`：管理端 `/api/admin/music` 列表 / 上传（multipart，音频白名单 `mp3·m4a·aac·wav·flac·ogg·oga·opus·weba`，≤200MB；封面复用 `upload_utils.save_cover`）/ PUT `/api/admin/music/{id}`（改歌名·歌手·专辑·**歌词**·时长，歌词上限 20000 字）/ DELETE（**连音频 + 封面文件一起删**）/ 试听 `/{id}/file` / 封面三件套 / `POST /order`（复用 `apply_manual_order`，越大越靠前）。考生端 `/api/music` 列表（含歌词）+ `/{id}/file`（**HTTP Range**，`<audio>` 可拖动进度，支持 `?token=`）+ `/{id}/cover`（未设置 404 → 前端回落内置山水插画）+ `POST /{id}/play`（播放量 +1）。③ **时长由后台在上传时用浏览器 `<audio>` 读出**后随表单提交（后端不依赖 ffprobe/mutagen，读不到传 0，考生端以音频实际时长为准）。④ 歌词原样存（纯文本或 LRC 时间轴），考生端能解析 `[mm:ss.xx]` 就逐行高亮 + 自动滚动，解析不到就整段滚动展示。⑤ `main.py` 注册 `music.router` / `music.admin_router`。⑥ 后台 `dashboard.html/js`：新增「音乐」Tab（上传弹窗：音频 + 封面 + 歌名 + 歌手 + 专辑 + 歌词；列表：封面缩略图 / 时长 / 大小 / 歌词行数 / 播放量 / 排序 ↑↓ / 试听·编辑·换封面·删除，统一 `table-fixed` 内部滚动）。前端配套见 `FRONTEND.md` §15 v1.44。校验：真实服务（8000，热重载已生效）HTTP e2e 全过 —— 管理员登录 → 上传（wav + LRC 歌词）→ 列表字段正确 → 封面未设 **404** / 上传后 **200 image/png** → 音频 Range `-r 0-99` **206 / 100 字节** → PUT 改信息 → 考生令牌（临时 session）列表/音频 206/封面 200/`POST /play` 返回 `play_count:1` → 无令牌 **401** → 删除曲目（文件一并清掉）。**测试数据已按返回 id 清理**（曲目删除、临时 session 删除、uploads 无 `music_*` 残留），真实库其余数据未动；`npx tsc --noEmit` + `npm run build`（11.18s）通过。 |
| 2026-10-01 | **v1.34 固定插图区（图片统一大小 + 滚动条常驻）**：一段文字（题干/选项/答案解析）里的所有图片收进**固定高度的滚动区**。考生端 `RichText.tsx`（`AREA_HEIGHT` md 200 / lg 260；区内每张图 `IMG_HEIGHT` md 160 / lg 220 **固定占位等比缩放**，不裁剪都看得到；连续图片含中间纯空白归成一组；`sm` 摘要保持行内小图 120px 不套区）+ `src/index.css .rt-img-area`（全站藏滚动条，这里显式 `overflow-y: scroll` + webkit 滚动条样式**常驻**）。后台同口径 `dashboard.js richTextHtml()`（非 sm 把连续 `<img>` 包进 `<div class="rt-img-area">`，`sm` 保持行内小图；图片间纯空白并进图区）+ `style.css .rt-img-area`（`.rt-img-area-lg` 260、区内 `.rt-img` 覆盖 160/220、`.rt-img-dead` 同高占位）—— **改一边必须同步另一边**。校验：`tsc --noEmit` + `npm run build` 通过，dist 含新样式与逻辑。 |
| 2026-10-01 | **v1.32 题目插图（题干 / 选项 / 答案解析里能放图）**：① 新模块 `modules/question_images.py`：`POST /api/admin/question-images`（multipart 上传，返回 `{name, markup = "[[img:文件名]]", url}`）+ `GET /api/admin/question-images/{name}`（后台预览）+ `GET /api/bank/question-images/{name}`（考生端，令牌走 `?token=`）。② `modules/upload_utils.py` 扩展：`QUESTION_IMAGE_EXTENSIONS`（jpg/jpeg/png/webp/gif/bmp，比封面宽松，公式截图常带透明通道）、`MAX_QUESTION_IMAGE_MB = 5`、`is_question_image_name()`（**唯一**文件名判据：只认 `qimg_` + 16 位十六进制 + 允许扩展名，拦目录穿越）、`save_question_image()`、`question_image_response()`；顺手把 `cover_response` 的重复逻辑抽成 `stored_file_response(stored_name, missing_detail)`（封面与插图共用，取图 404 文案可定制）。③ `main.py` 注册 `question_images.router` / `.admin_router`。④ **零数据库改动、零迁移、零老数据影响** —— 图片只是文本里的标记，`content` / `options_json` / `answer` 字段结构完全没变，判分逻辑（只比字母）也不受影响；一张图可被多道题共用。⑤ 适配说明：`bank._clean_text()` 仍把原书遗留的 `<img src="jcpicture/xxx.jpg">` 换成「【图】」（那批图片资源从未随 CSV 进来，内置题库里有 19 处），与本次这套标记是两回事。⑥ 后台导入弹窗补提示：**图片没法直接放进 CSV**，导入后用题目列表「编辑」→「＋ 题干插图 / ＋ 选项插图」补图。校验：`py_compile` + `node --check` 通过；本机 in-process 起服务做 HTTP e2e 全过（登录 → 未登录上传 **401** → 管理员上传 **200** 返回 `markup` 格式正确 → 取图带/不带令牌 **200 / 401** → 非法文件名与 `..%2F` 目录穿越 **404** → `.txt`/`.exe` 扩展名与 6MB 超限 **400**）；上传的测试图片已按返回文件名删除，未留垃圾。前端配套见 `FRONTEND.md` §15 v1.32。 |
| 2026-10-01 | **v1.31 题型扩到六种（新增多选 multi / 计算选择 calcsel）+ 通用导入模板 + 导入错误报告适配**：① **题型体系**：`bank.QTYPE_NAMES` 加 `multi 多选题` / `calcsel 计算选择题`，新增 `QTYPE_CODES`（全部题型元组）、`QTYPE_FILTER`（可空，各接口 Query pattern 唯一来源）、`QTYPE_ONLY`（必填，后台增改题目）；`_normalize_qtype()` 改为**先判组合词**（多选/多项 → multi；同时含「计算」和「选择」→ calcsel）再判「判断/计算/简答」，认不出仍是 single 兜底。② **判分**：新增 `bank.normalize_multi_answer()`（只留字母、去重、升序拼串：`C、A` → `AC`）与 `bank.answers_match(qtype, my, correct)`（**multi 走字母集合比对**，其余 strip + upper）；`exam._grade_answer(qtype, ...)` 转发它，交卷时多选作答**先归一再写库**（`exam_answers`/`answer_records` 存 `AC`）；`practice.py` 的 `QTYPE_FILTER` 改为从 bank 导入（删掉本地重复定义），`SubmitAnswer.user_answer` max_length 8→16。③ **导入（`question_sets.import_csv`）**：**删除「多选一律跳过」逻辑**，六种题型各自校验并入库（多选 ≥2 选项 + 答案字母必须在选项内 + 归一；选择/计算选择答案必须是选项字母，答案写了多个字母时提示「是不是该选多选题」；判断题认 正确/错误/A/B；计算题答案原样存不转大写）；返回新增 `imported_by_type`（各题型数量）与 `warnings`（**不阻断导入的复查提醒**：多选只有 1 个正确项、**某行列数多于 8 列**=题干里英文逗号被拆开）；`errors` 文案改为「行号 + 原因 + 可选值/怎么改」。④ **手工添加/编辑**：`_normalize_answer()` 支持 multi（归一 + 校验字母在选项内）/ calcsel（同单选），`_build_question()` 对 `CHOICE_QTYPES`（single/multi/calcsel）统一要求 ≥2 选项。⑤ **模板**：新增 `GET /api/admin/question-sets/import-template`（管理员令牌，`?token=` 也认），直接下发**项目根 `题库导入模板.csv`**（UTF-8 BOM + CRLF，六种题型各一例）——单一维护点。⑥ **纠错工单**：`question_reports.handle_report` 采纳时按题型校验/归一建议答案（多选 `C、A`→`AC`；计算/简答原样写回不改大小写），`_report_item` 的 `question` 加 `qtype_label`（后台工单行显示题型标签）。校验：隔离副本（%TEMP% 全新建空库）导入 e2e 全过 —— 六题型各 1 题入库 + 4 类错误行被跳过（多选答案越界/选择答案越界/题干为空/答案为空）+ 1 条复查提醒（多选单正确项）、列数错位提醒、表头别名映射（章节/题型/题目/选项A~C/答案）、`_normalize_qtype` 10 组、判分 7 组、非法手工添加 4 类全部 400。前端配套见 `FRONTEND.md` §15 v31。 |
| 2026-10-01 | **v1.30 题库三层结构（题库系列 → 题库 → 章节，系列/题库都可设封面）**：① `database.py`：新表 `question_set_series`（name UNIQUE/level/method/description/cover_name/sort_order/created_by/created_at）与 `question_chapters`（set_id/name/description/sort_order/created_at）；`question_sets` 加 `series_id`/`cover_name`/`sort_order`，`questions` 加 `chapter_id`（建表 + `_migrate()` patches 双写，老库自动补列；索引 `idx_q_chapter`/`idx_qset_series`/`idx_chapter_set`）。② 新模块 `modules/question_series.py`：管理端 `/api/admin/question-series` 系列 CRUD（同名 409）+ 封面三件套（前缀 `qseries`）+ `POST /order`；考生端 `GET /api/bank/series`（**只返回有题库的系列**，带 bank_count/total 子查询）、`GET /api/bank/series/{id}/cover`；**删系列不删题库**（`question_sets.series_id` 置 NULL 退回「其他题库」）。③ `modules/question_sets.py`：`SetBody` 加 `series_id`（0/负数=散题库，不存在的系列 404）；列表支持 `series_id`/`loose`/`level`/`q` 筛选并按 `sort_order DESC, id DESC` 排序（**series_id/loose 筛选时不掺内置题库**）；`_set_public` 输出 `series_id/series_name/has_cover/sort_order/chapter_count`；题库封面三件套（前缀 `qset`，考生端 `GET /api/bank/sets/{id}/cover`）+ `POST /order`；**章节 CRUD**（`/{set_id}/chapters`，同名 409、内置题库 400；改名同步 `questions.topic1`；**删章节题目保留**——`chapter_id=NULL, topic1=''` 退回「未归章节」）+ `POST /{set_id}/chapters/order`（**章节按自然顺序升序展示**：sort_order 升序 = 列表从上到下，与题库/系列的从大到小相反，新建章节追加在最后）；`QuestionBody`/`import_csv` 支持 `chapter_id`（章节名冗余写进 topic1，考生端按章练习沿用老口径）；考生端 `GET /api/bank/sets?series_id=`、`GET /api/bank/sets/{id}/chapters`（显式章节在前 + 老数据按 topic1 自动分组 `tagged:false` 跟后，已做数只认 chapter_id）。④ `modules/practice.py`：`_scope_where` 在 `set_id` 分支也支持 `topic`（`AND topic1 = ?`）→ 自定义题库能按章节练。⑤ 新模块 `modules/upload_utils.py`：封面（`COVER_EXTENSIONS`/`MAX_COVER_MB=8`/`save_cover`/`cover_response`/`unlink_quiet`）与手动排序（`apply_manual_order` 槽位算法）抽出来给资料库和题库共用（materials.py 已改为复用）。⚠️ `/order`、`/series` 等静态路由必须声明在 `/{id}` 之前；⚠️ `get_conn()` 出 with 块就关连接，**列表组装（`_chapter_public` 等）必须在 with 块内完成**。⑥ 后台 dashboard「题库管理」重构为「题库系列」+「题库」两卡（实时序号/排序列/封面列/所属系列筛选/章节管理弹窗：新建/编辑/删除/↑↓排序/导入 CSV）。校验：`py_compile` + `node --check` 通过；隔离副本（真实库拷贝到 %TEMP%，8139）API e2e **51/51**、playwright 双端界面 **47/47**；测试数据已清理、真实库只做启动迁移。前端配套见 `FRONTEND.md` §15 v30。 |
| 2026-10-01 | **v1.28 资料库排序（考生端正 / 倒序 + 后台序号与上移下移）**：① `database.py`：`materials` / `material_series` 加 `sort_order INTEGER NOT NULL DEFAULT 0`（建表 + `_migrate()` patches 双写，老库启动自动补列；全 0 = 按 id 倒序兜底，**老行为完全不变**）。② `materials.py`：新上传 / 新建系列取 `COALESCE(MAX(sort_order),0)+1`（**新内容仍排最前**）；四条列表（`/api/library`、`/api/library/series`、`/api/admin/materials`、`/api/admin/materials/series`）统一 `ORDER BY sort_order DESC, id DESC`，行带 `sort_order`；新增管理端 `POST /api/admin/materials/order` 与 `POST /api/admin/materials/series/order`（body `{ids:[...]}` = 后台当前可见的完整顺序；`_apply_manual_order()`：这批 id 在全表顺序里的**槽位不动、只把内容按新顺序填回去** → 筛选出来的部分列表里上下移动不会打乱别的资料的相对位置，同时把全表压实成 1..N）。⚠️ 两条 order 路由必须声明在 `/{material_id}` 前；`/api/admin/materials/series` 列表去掉按 category 分组（否则手动顺序看不出来）。③ 考生端「顺序 / 倒序」只是前端把同一份结果反转，**不需要排序参数**。④ 后台 dashboard：资料/系列表首列 `ID` → **序号**（按当前筛选结果实时编号），新增「排序」列（↑/↓，首尾各禁用一半，点击 = 可见列表相邻换位 → POST order → 刷新）；工具条加「方向」筛选（`mats-method`）。前端配套见 `FRONTEND.md` §15 v28。校验：隔离副本（8137）API e2e **26/26**（老行为不变 / 整体换序 / 相邻互换 / **筛选内排序不打乱其它资料** / 新上传排最前 / 系列排序 / 5 种筛选 / 恢复现场与清理），playwright 后台 UI **18/18** + 考生端 **12/12**；`tsc --noEmit` + `npm run build` 通过；真实库已迁移（12 条旧资料 sort_order 全 0，顺序不变）。 |
| 2026-09-30 | **v1.27 Office 文档转 PDF 在线预览（doc/ppt/pptx 复用单页翻阅）**：动机——考生端 DocViewer 对 doc/ppt/pptx 没有前端渲染方案，点开只见「该格式暂不支持」。① 新增 `modules/office_convert_worker.py`：COM 子进程（comtypes，**venv 需 `pip install comtypes`**，本机已装 1.4.17）调本机 MS Office 把文档另存为 PDF（PPT `SaveAs(dst,32)` / Word `SaveAs2(dst,17)` / Excel `ExportAsFixedFormat(0,dst)`）；**单实例防护**：CreateObject 可能附加到用户正开着的 Office 实例，故先记「打开前文档数」，>0 只关自己打开的那份、绝不 Quit；独立子进程便于超时强杀（900s）与故障隔离。② 新增 `modules/office_view.py`：单 worker 串行队列（Office COM 单实例不能并发），状态机 queued/converting/ready/failed 只放内存、**成品只认磁盘** `uploads/<stored_name>.view.pdf`（中间文件 `.view.tmp.pdf` 转完改名，半成品不会被当成品）；转换成功即调 `pdf_slice.build_slices(root, view_name, force=True)`（force 跳过 2MB 体积门槛）；`request()/status()/warm_up()/remove()/pending_count()`。③ `materials.py`：新增考生端 `GET /{id}/preview`（kind=pdf/office/frontend/other；office **调用即触发转换**，幂等）与 `GET /{id}/preview-file`（整份兜底）；`/pages`、`/page/{n}` 改走 `_preview_pdf_name()`（pdf=原件、office=转换产物，**前端翻页接口完全不用区分**）；上传 Office 文档自动入队；删除资料调 `office_view.remove()` 清产物+切片；管理端 `POST /convert-existing`（批量补转，failed 重试）+ `GET /office-status`。④ `main.py` 启动调 `materials.ensure_office_converted()` 后台补转历史文档（只排队不阻塞启动）。⑤ `pdf_slice.build_slices` 加 `force` 参数。实测：43MB/253 页 ppt 冷转换 67s → 4.4MB PDF → 253 个切片（每页 200~500KB）；HTTP e2e 8 项全过；playwright 考生端打开即翻页、跳末页正常（v1.26 的 PDF 链路无回归）。⚠️ 依赖：本机须装 MS Office 且后端跑在有桌面会话的用户下；没装 Office 时转换全部 failed，前端「本地打开」兜底，不影响其它功能。 |
| 2026-09-30 | **v1.26 PDF 按页切片（考生端单页翻阅，首屏 49.46MB → 726KB）**：动机——非线性化扫描件 PDF 走 HTTP Range 也会被 pdf.js 拉满整份（实测 49.5MB/148 页文件打开首屏下载 49.46MB=100% 覆盖，pypdf 重写/pikepdf 线性化都救不回来），遂改「上传时按页切片」。① 新增 `modules/pdf_slice.py`：`build_slices()` 用 pikepdf 把每页拆成独立单页 PDF 存 `uploads/<stored_name>.pages/slices/<n>.pdf`，页数/每页大小写 `pages.json`（**manifest 最后写 = 成品开关**，半残目录 is_sliced 判 False 前端自动回落整份预览）；148 页实测 2.15s、单页 41KB~526KB、合计 49.6MB；≤2MB 不切、>3000 页不切、加密/损坏静默跳过（**绝不抛异常**，上传永远成功）；`read_manifest/is_sliced/page_size/slice_page_path/remove_slices` 配套。⚠️ **本机环境红线**：WorkBuddy 沙箱把 `shutil.rmtree` 拦截成回收站操作（失败即抛，`ignore_errors=True` 也拦不住），且 workspace 内新建目录会被锁住 **rename 报 WinError 5**——所以切片流程**只写入+覆盖，零删除零改名**；删除相关全部吞异常（删不掉就残留，无害）。② `materials.py`：上传 PDF 落盘后调 `build_slices`（返回体加 `sliced/pages`）；删除资料调 `remove_slices`；考生端新增 `GET /api/library/{id}/pages`（切片信息）与 `GET /api/library/{id}/page/{n}`（单页切片，`Cache-Control: private, max-age=86400`，页码越界/未切片 404）；管理端新增 `POST /api/admin/materials/slice-existing`（批量补切片，可反复调用，已切的跳过）。③ 后台资料库 Tab 加「补 PDF 切片」按钮。④ 前端 `DocViewer.tsx` 重写 PDF 分支：先查 `/pages`，`sliced=true` 走**单页翻阅模式**（一次只开一页 pdf.js 文档、画完即弃、内存只有当前页；上一页/下一页 + 页码输入跳转 + 进度条 + 左右滑动 + 方向键翻页 + 相邻 ±2 页 fetch 预热）；`sliced=false` 回落原整份预览（老逻辑不动）。pdfjs-dist 6.3.289 的 `render()` 参数是 `canvas` 不是 `canvasContext`。校验：隔离副本（端口 8137 + 反代 8460）接口 6 项全过（正常/越界 404/非 PDF sliced=false）；playwright 真实环境（8000）实测——首屏 **1.48s / 726KB**（4 请求：pages 信息 + 第 1/2/3 页），翻页增量 500~700KB，跳末页 148 增量 1.15MB，末页按钮置灰进度条满格；`tsc --noEmit` + `npm run build` 通过。真实库切片已执行（id=10，148 页）。 |
| 2026-09-30 | **v1.25 资料系列（大类 → 系列 → 资料 三层）**：① `database.py`：新表 `material_series`（title/category/method/description/cover_name/created_by）+ `materials.series_id` 列（`_migrate()` patches 自动补列，老资料全 NULL=散资料）+ 索引 `idx_mat_series`/`idx_series_cat`。② `materials.py`：管理端新增 `/api/admin/materials/series` 系列增删查改 + 封面三件套（GET/POST/DELETE `{id}/cover`）+ 列表 `?series_id=`/`?loose=1` 筛选 + 上传/编辑支持 `series_id`（**0 或不存在的系列视为散资料不报错**，上传的文件不丢）；**删系列不删资料**（`UPDATE materials SET series_id=NULL` 退回未归系列，返回 `moved` 数量）；考生端新增 `GET /api/library/series`（带 `item_count`）、`GET /api/library?series_id=`、`GET /api/library/series/{id}/cover`；`_stats_select` 子查询附带 `series_name`（无 N+1）。⚠️ **`/series` 路由必须声明在 `/{material_id}` 之前**（考生端与管理端同）。③ 后台 dashboard：资料库 Tab 拆「资料系列」卡（新建/编辑/封面/删除，删前 confirm 提示资料会退回「其他」）+「资料列表」卡（新增「所属系列」筛选下拉（含「未归系列」项）与徽标列）；上传/编辑弹窗加「所属系列」级联下拉（`openModal` 新增 `onMount` 回调支持，切大类刷新系列选项）。④ 考生端配套见 `FRONTEND.md` §15 v25（三层布局 + SeriesDetailScreen + App.tsx `series-detail` 视图与页面记忆）。校验：隔离副本迁移（老库自动补列、既有资料 series_id 全 NULL）、真实服务 HTTP e2e 全过（建系列→传资料归入→按系列筛选→改归属→**删系列资料保留**→考生端三接口+无封面 404）、playwright 双端全流程（后台建系列/上传归入/筛选/徽标列 + 考生端系列卡/系列详情/返回链路）截图验证；测试数据已清理。 |
| 2026-09-30 | **内网穿透从 Cloudflare 快速隧道换成 SakuraFrp（樱花），其余功能一律不动**：① `tools/tunnel.py` 重写为 SakuraFrp 客户端（原来是正则抓 `*.trycloudflare.com`）：读 `tools/sakurafrp.json` → 缺配置时跑**首次配置向导**（注册/实名/建隧道指引 + 逐项输入）→ 拉起 `frpc -f <访问密钥>:<隧道ID> --disable_log_color -n` → 识别 `start proxy success` 判连通，401/长度错等给出人话结论 → **实测** `/api/health` 自动定 https/http 并回写配置 → 写「公网地址.txt」。② 新增 `tools/sakurafrp.json`（含访问密钥 → 已 gitignore）、`tools/下载frpc.bat`；`启动公网访问.bat` 步骤调整为「前端产物 → venv → frpc → 后端 → 隧道」（下载 frpc 需要 venv 里的 Python）。③ 后端与前端**零改动**：`/api/admin/tunnel` 契约不变（`announce()` 沿用原来那套标签），前端全部走相对路径。④ 顺手修掉两个坑：连接成功后开守护线程继续排空 frpc 管道（不排会写满缓冲区把隧道卡死）；Python 输出在 GBK 控制台（bat 里 chcp 936）下若因 PYTHONUTF8 按 UTF-8 输出会中文乱码，改为跟随 `GetConsoleOutputCP()`。⑤ 旧文件 `tools/cloudflared.exe`（52MB）与 `tools/下载cloudflared.bat` 已移入回收站。校验：`--download` 真实下载 CDN 最新版并跑通 `frpc -v`；隔离副本跑通「向导 → 配置落盘 → frpc 报 401 → 中文诊断」全链路；`announce()` 产物用 overview.py 原解析逻辑交叉验证四项地址/生成时间全部命中；bat 在 GBK+CRLF 下运行无乱码。 |
| 2026-09-30 | **通知删除的双保险 + 历史残留清理（v1.17.1）**：问题现象「管理员把通知删光了，考生端系统通知还在」——根因是**改版前**（v1.17 之前）的删除只把 `notification_batches.hidden` 置 1、不动考生通知，那些批次早已从后台列表消失（hidden=1 不再显示）无法再删一次，考生端的系统通知又不可自删（403），于是长期滞留。修复三处：① 考生端 `my_notifications()` 与 `_get_my_notification()` 增加 `NOT EXISTS (… batches.hidden = 1)` 条件（精确绑定 hidden 标志，孤儿批次行仍显示；标记已读/删除历史残留一律 404）；② `database.py` 新增一次性补齐 `_backfill_notify_hidden_batches()`（`app_meta` 标记 `notify_hidden_batches_cleaned`）把「批次已隐藏但通知未标删」的残留置 `deleted=1`；③ 文档与建表注释同步正确的删除语义。真实库执行结果：**清掉 7 条残留**（6 条系统通知 + 1 条普通通知），启动横幅已打印。校验：隔离副本（端口 8127、全新库）e2e **23/23** —— 新建考生收欢迎通知、发通知后考生端 2 条、手工造残留（hidden=1 + deleted=0）→ 列表不显示且未读回到 1、残留「标记已读」404、批次恢复 hidden=0 后又可见（证明精确绑定）、真实删除接口 removed=1 + 考生端只剩欢迎通知 + 后台列表消失、补齐函数清掉残留且第二次调用返回 0。⚠️ 期间改动数据库文件时热重载曾把 worker 卡死（监听端口还在但不再响应），已结束残留进程重启服务，8000 与隧道均已恢复。 |
| 2026-09-30 | **通知两边联动删除 + 新用户欢迎通知（v1.17）**：① **后台删通知 = 考生端也删**：`notifications.delete_batch()` 除批次 `hidden=1` 外，把该批次所有 `notifications.deleted=1`，并按考生分组推新事件 `notification-removed`（`{ids}`），在线考生列表**静默**少掉这几条、未读数同步下降；返回体加 `removed` 计数，后台确认弹窗文案改为「考生端对应通知也会一起删除」。② **新考生自动收「欢迎加入 NDT-劳人」系统通知**：新工具 `send_welcome_notice()`（文案常量 `WELCOME_TITLE`/`WELCOME_CONTENT`，type=system 考生不可删，同时在后台留一条发送记录），接线到「账号刚创建」的两个入口 —— 注册审核通过 `registrations.approve_registration()` 与后台手动新增考生 `user_accounts.create_user()`；考生此刻通常不在线，首次登录拉列表即可见。③ `realtime.py` 新增 `EVENT_NOTIFICATION_REMOVED`，前端 `realtime.ts` / `useNotifications.ts` 接住该事件。校验：隔离副本（端口 8126、全新库）e2e **29/29** —— 后台新增考生与新注册审核两条路径都收到欢迎通知、考生端收到管理员通知后删批次 → 考生端只剩欢迎通知且未读回到 1、**SSE 实测收到 `notification-removed` 且 ids 正确**、批次 hidden=1 / 通知 deleted=1、删不存在批次 404、考生令牌访问管理端 401、考生删系统通知 403。真实库与真实 8000 服务未动（reload 已自动加载新代码）。 |
| 2026-09-30 | **官网入口 + 公网地址上屏 + 后台 Logo（配合前端 v23）**：① `overview.py` 新增 **`GET /api/admin/tunnel`** —— 解析项目根「公网地址.txt」（`tools/tunnel.py` 启动隧道时覆写，地址每次重启都变），返回考生端/后台/接口文档/本机四个地址 + 生成时间；文件缺失时 `available:false`。② 管理后台 `dashboard.html/js`：顶栏加 **Logo 图（`/site-assets/logo.jpg`，即官网同款）+ 「官网」按钮（`window.open('/')`）**；顶部新增公网地址横幅（地址链接 + 复制 + 刷新，未启动隧道时提示怎么启动），登录页文字「NDT」方块换成 logo 图片，两个页面 favicon 均指向 logo。校验：隔离副本（端口 8125 + 副本项目根放公网地址文件/官网目录）e2e **22/22** —— 401 拦截、地址四项解析正确、文件缺失降级、页面含 Logo/官网按钮/横幅/mode-alert 未丢、logo.jpg 200、根路径仍是官网。真实 8000 服务 reload 已自动加载新接口，`dist` 与后台静态页即改即生效。 |
| 2026-09-30 | **令牌 15 天 + 滑动续期（配合前端 v22 启动路由）**：`config.security.token_ttl_hours` 24 → **360（15 天）**（`config.py` DEFAULTS / `config.example.json` / `config.json` 三处同步），`deps.py` 新增 `_renew_session()` —— `resolve_session()` 校验通过后按天节流把有效期续到「现在 + TTL」（剩余 > TTL−24h 不写库，避免每个请求都 `UPDATE sessions`）。语义从「登录满 24 小时就要重登」变成「**15 天没访问过才要重登**」，不退出登录就一直保持登录态；过期令牌仍旧 `resolve_session()` 删除 + 401。⚠️ 改 TTL 后需重启服务（`config` 是启动时读的）。校验：隔离副本（全新库 + 副本端口）e2e **11/11** —— 登录签发 ≈15 天、DB 与返回一致、有效令牌可访问、剩 2 天时访问被续到 15 天、剩 359h 不重复写库（节流生效）、过期令牌 401 且会话行被删、无令牌 / 乱令牌 401、考生接口带失效令牌 401。真实库与真实 8000 服务未动。 |
| 2026-09-30 | **实时通道（SSE）上线**：新增 `modules/realtime.py`（进程内广播 + `/api/user/stream` 事件流），通知 / 评论回复 / 版本更新 / 踢会话改为写库即推送，延迟从最坏 30 秒降到毫秒级（实测通知 0.26s、版本 0.02s、踢会话 0.30s）；轮询保留为兜底（实时在线时放长到 120 秒，不可用时回到 30 秒）。接线点在 `push_notification()`（唯一落点）、`user_security` / `user_accounts` / `password_resets` 的踢会话处。`config.py` 新增 `realtime` 段（`enabled` / `heartbeat_seconds`）。 |
| 2026-09-30 | **版本发布闭环**：`app_update.py` 从「只读版本」升级为可发布 —— 新增 `GET/POST /api/admin/app/version`（写 `version.json` + 实时推送）与 `watch_version_file()` 协程（每 10 秒盯文件变更，覆盖直接改文件 / git 部署）。后台新增第九个 Tab「版本发布」。前端新增 `useAppUpdate` + `UpdateBanner`（普通版本弹可关闭提示条、`force=true` 弹不可关闭弹层；答题考试中不打扰）。 |
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
| 2026-09-30 | **内网穿透从 SakuraFrp 换回 Cloudflare 快速隧道（TryCloudflare），前后端业务零改动**：① `tools/tunnel.py` 重写为 cloudflared 客户端（`cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate`，正则抓日志里的 `*.trycloudflare.com` 作为公网地址；探测改成一个全新 opener + 8 次 × 3s 重试，避免隧道刚起时 DNS/边缘未就绪导致的误报「未通过」）。② `tools/cloudflared.exe` 重新下载（v2026.9.3，52MB，gitignore）；新增 `tools/下载cloudflared.bat`；`启动公网访问.bat` 步骤回到「前端产物 → venv → cloudflared → 后端 → 隧道」。③ `tools/tunnel_sakurafrp.py.bak` 保留 SakuraFrp 版脚本以便切回；SakuraFrp 的 frpc.exe / sakurafrp.json / 下载frpc.bat 已移入回收站。④ 后端 `overview.py` 的 `/api/admin/tunnel` 契约与标签文案**完全不变**（仍读「公网地址.txt」），前端零改动。校验：实测公网 `https://<随机>.trycloudflare.com` 的 `/api/health`、`/app/`、`/admin/`、`/docs` 全部 200；`announce()` 产物用 overview.py 原解析逻辑交叉验证四项地址/生成时间全部命中；tunnel.py 语法编译通过。 |
