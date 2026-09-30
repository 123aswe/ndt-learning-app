# NDT-劳人 学习刷题 App · 前端文档（唯一完整版）

> **这是本项目唯一的前端文档。** 改前端、加功能，先读这一份，不要再去找别的 .md。
> 最后更新：2026-09-29（v4 · 通知中心 / 密码重置申请已接后端，管理后台支持指定考生多选发送）
> 配套：`.modular/rules.md`（开发规矩 / 命令 / 流程）、`.modular/backend.md`（数据模型登记，后端阶段用）

---

## 0. 怎么用这份文档（给 AI 的定位流程）

**改功能 / 修 bug 的标准动作：**

1. 在 **§12 修改定位表** 按关键词找到目标文件 → 只读那 1 个文件，**不要全量扫描项目**
2. 如果是页面样式 → 顺手看 **§11 设计令牌**（很多样式在 `index.css`，不在页面里）
3. 如果新增图标 → 先看 **§6 图标索引** 有没有现成的
4. 如果改数据结构 → 看 **§9 数据字段索引**，改 `src/types.ts`（页面数据一律走 `src/api/client.ts` 的接口）
5. 如果涉及登录 / 账号 / 昵称头像 / 验证码 → 看 **§14 API 依赖**，前端只调 `src/api/client.ts`，**不要直接写 fetch**
6. 如果改的是后端接口本身 → 去读 `.modular/backend.md`（Python 服务的地图）
7. 改完**必须** `npm run build` 通过才算完成，并回来更新本文档

**四条铁律：**

- ❌ 不要全量扫描项目 —— 本文档已给出精确文件，直接读目标文件
- ❌ 不要改页面顺序 / 功能入口 / 交互逻辑（除非需求就是改这些）
- ❌ 不要动 `.figma/`（构建依赖）
- ❌ 前端不要直连数据库、不要持有任何密钥；一切走后端接口

---

## 1. 项目概览

| 项 | 内容 |
| ---- | ---- |
| 应用形态 | 移动端优先单页应用（`.app-shell` 最大宽 430px 居中），无路由库 |
| 技术栈 | React 19 + TypeScript 5.7 + Vite 8 + Tailwind CSS v4（`@tailwindcss/vite`，**无 config 文件**） |
| 包管理 | ⚠️ **本机统一用 npm**（详见 §1.2） |
| 状态管理 | `App.tsx` 内 `view` 状态机 + `activeTab`；页面内局部 `useState`，无 Redux / Zustand |
| 数据来源 | **全部实时**：题库 / 练习 / 统计 / 报告 / 个人中心均来自后端接口（`src/api/client.ts`），v6 起已删除 Mock 数据源 |
| 后端 | Python FastAPI 服务在 `server/`（端口 8000），开发时由 Vite 把 `/api` 代理过去；详见 `.modular/backend.md` |
| 登录态 | `localStorage`：`ndt_token`（令牌）/ `ndt_identity`（admin\|user）/ `ndt_profile`（用户信息，含 nickname / avatar） |
| 入口链 | `index.html` → `src/main.tsx` → `src/App.tsx` + `src/index.css` |

### 1.1 常用命令

```bash
npm run dev       # 启动开发服务器（端口 8443）
npm run build     # 生产构建（含 TypeScript 校验）—— 交付前必须通过
npm run preview   # 预览构建产物
npm run format    # oxfmt 格式化
```

Windows 下也可直接双击根目录 `启动App.bat`（自动检查 Node、装依赖、起服务并打开浏览器）。

### 1.2 ⚠️ 包管理器注意（踩过坑，别再踩）

- `pnpm-lock.yaml` 是 pnpm 生成的，但本项目当前 `node_modules` 是 **npm** 装的 → **`pnpm build` 会直接失败**（依赖状态校验不过）。
- **不要用** `npx pnpm@9.15.11` —— npm registry 上无此版本，报 ETARGET。
- 结论：**一律用 `npm install` / `npm run build`**。只有当用 pnpm 重新装过 `node_modules` 后，pnpm 命令才可用。

---

## 2. 目录结构 · 文件职责 · 行数

```
NDT-劳人学习刷题App设计/
├── index.html                  Vite HTML 外壳（#root + 引入 main.tsx）
├── vite.config.ts              Vite 配置（React / Tailwind v4 / figma 插件 / @ 别名 → src）【勿删 .figma】
├── tsconfig.json               TS 配置（paths: @/* → ./src/*）
├── package.json                依赖与脚本
├── 启动App.bat                 Windows 一键启动
├── FRONTEND.md                 本文档（唯一前端文档）
├── .modular/                   开发规矩（rules.md）+ 后端地图（backend.md）
├── server/                     Python FastAPI 服务 + 可视化管理后台（详见 .modular/backend.md）
├── .figma/make/                【构建依赖，勿删】vite.config.ts 直接 import 其 site.json
└── src/                        （共约 7517 行；⚠️ 行数会随改动漂移，仅作量级参考）
    ├── main.tsx            12   入口：先 initTheme() 定主题（防首屏闪色）再挂载 App
    ├── App.tsx            342   视图状态机 + Tab 布局 + 占位页（ExamSetupStub / PlaceholderScreen）
    ├── index.css          682   全局设计令牌 + 卡片/按钮/动效/安全区工具类 + 深色模式（[data-theme='dark']）
    ├── theme.ts            62   外观模块：浅色/深色/跟随系统 → 写 html[data-theme]，监听系统主题变化
    ├── types.ts            84   领域类型定义（题库/统计等本地数据模型）
    ├── vite-env.d.ts        1   Vite 类型引用
    ├── api/
    │   └── client.ts      318   后端接口封装（唯一出口）：令牌存取 + fetch + 中文错误 + authApi / profileApi / securityApi / appApi / notificationApi / resetApi
    ├── hooks/
    │   ├── useProfile.ts   94   当前登录者资料 Hook：本地缓存秒显 + 后端拉取覆盖 + update()
    │   └── useNotifications.ts 151 通知 Hook：模块级 store + useSyncExternalStore + 真实接口（列表 / 未读数 / 删除 / 标记已读）
    ├── assets/
    │   └── brand-icon-graphics.png   品牌图标透明图形层（466×322）
    ├── data/
    │   ├── avatars.ts      64   12 个预设头像（emoji + 低饱和渐变底）+ 解析/判断工具
    │   ├── notifications.ts 50  通知类型（system 不可删 / notice 可删）+ 类型标签 + 时间格式化
    │   ├── appVersion.ts   35   前端版本号 APP_VERSION（唯一来源）+ compareVersion / hasUpdate
    │   └── legal.ts       191   《服务协议》与《隐私政策》正文（纯文字数据）
    ├── components/
    │   ├── Avatar.tsx      83   头像组件（预设 emoji / 上传图片 / 昵称首字 三级兜底）
    │   ├── BottomNav.tsx   76   底部 5 Tab 导航（悬浮胶囊玻璃）
    │   ├── BrandIcon.tsx   55   品牌 App 图标（SVG 混合方案）
    │   ├── PasswordResetSheet.tsx 193 「申请重置密码」底部弹层（账号 + 工作单位，登录页与设置页共用）
    │   ├── ProgressRing.tsx 70  环形进度（渐变 + 冷光）
    │   └── icons.tsx      232   极简线性图标库（39 个，含系统通知专用 ShieldIcon）
    └── screens/
        ├── OnboardingScreen.tsx      436   引导页（3 步）
        ├── LoginScreen.tsx           479   登录 / 注册（账号登录 + 注册申请 + 忘记密码申请入口，接真实接口）
        ├── LegalScreen.tsx            82   《服务协议》/《隐私政策》整屏页（根为唯一 .scroll-area，正文可上下滑动看全）
        ├── HomeScreen.tsx            353   首页（顶栏问候用真实昵称与头像；铃铛有未读红点）
        ├── QuestionBankScreen.tsx    262   题库分类
        ├── PracticeScreen.tsx        363   答题
        ├── PracticeResultScreen.tsx  149   练习结果
        ├── WrongQuestionsScreen.tsx  226   错题本
        ├── LearningScreen.tsx        253   学习报告
        ├── NotificationsScreen.tsx   242   通知中心（列表 / 展开看正文 / 删除，系统通知不可删）
        ├── SettingsScreen.tsx        778   设置（账号安全 / 外观 / 通知 / 清除缓存 / 检查更新 / 退出登录）
        └── ProfileScreen.tsx         436   个人中心（昵称/头像真实数据 + 编辑面板）
```

---

## 3. 页面地图 / 路由地图（App.tsx 视图状态机）

无路由库。`AppView` 联合类型驱动整屏切换：

```ts
type AppView =
  | { name: 'onboarding' } | { name: 'login' }
  | { name: 'legal'; docKey: 'terms' | 'privacy' }
  | { name: 'main'; tab: Tab }
  | { name: 'practice'; categoryId: string }
  | { name: 'practice-result'; correct; total; timeSeconds; categoryId }
  | { name: 'exam-setup' }
  | { name: 'exam'; session: ExamStartResult }
  | { name: 'exam-result'; result: ExamSubmitResult }
  | { name: 'exam-detail'; examId: string; from: 'records' | 'result'; isPractice?: boolean; result?: ExamSubmitResult }
  | { name: 'search' } | { name: 'notifications' }
  | { name: 'favorites' }
  | { name: 'video-detail'; materialId: number; from: 'materials' | 'favorites' | 'history' }
  | { name: 'watch-history'; from: 'profile' | 'materials' }
  | { name: 'achievements' } | { name: 'settings' }
```

| 视图 name | 页面组件 | 文件 | 说明 | 进入方式 | 离开方式 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `onboarding` | OnboardingScreen | src/screens/OnboardingScreen.tsx | 3 步：品牌介绍 / 选检测方向（可多选）/ 选学习目标 | App 初始视图 | `onComplete` → `login` |
| `login` | LoginScreen | src/screens/LoginScreen.tsx | 品牌头 + Slogan + 毛玻璃卡片；**账号登录 / 注册双 Tab**，已接真实后端（注册为「提交申请等审核」制） | 引导完成 | `onSuccess` → `main(home)`；`onOpenLegal(key)` → `legal` |
| `legal` | LegalScreen | src/screens/LegalScreen.tsx | 《服务协议》/《隐私政策》整屏页，正文来自 `src/data/legal.ts` | 登录页勾选框点「《服务协议》/《隐私政策》」 | `onBack` → `login` |
| `main` | 见 §4 Tab 地图 | src/screens/* | 登录后的主界面，底部 5 Tab 切换 | 登录成功 | — |
| `practice` | PracticeScreen | src/screens/PracticeScreen.tsx | 答题页；取该分类前 10 题；计时、判对错、显示解析、退出弹窗 | `onStartPractice(categoryId)` | `onExit` → `main(home)`；`onComplete` → `practice-result` |
| `practice-result` | PracticeResultScreen | src/screens/PracticeResultScreen.tsx | 正确率环 + 统计网格 + 经验值 + 操作按钮 | 答题完成 | `onRetry` / `onHome` / `onReviewWrong` |
| `exam-setup` | ExamSetupScreen | src/screens/ExamSetupScreen.tsx | **模拟考试设置**：四步选题 —— 题库（综合 + 内置方向 + 自定义题库，`bankApi.summary/sets`）→ 题型（全部/判断/选择…按库存动态生成）→ 题数（20/50/100 + 全部，超库存自动裁剪）→ 时长（15/30/60/90 分钟）；「开始考试」调 `examApi.start` 开卷 | 首页快捷入口「模拟考试」 | `onBack` → `main(home)`；`onStarted(session)` → `exam` |
| `exam` | ExamScreen | src/screens/ExamScreen.tsx | **考试答题页**：顶部**倒计时**（≤60s 红色闪烁，到 0 自动交卷）；选项只标记「我选的」可改答案、**不判分**（服务端判）；题目导航（已答=accent 填充 / 未答=灰，可跳题）；底部 上一题/交卷/下一题；未答完交卷需两次确认；交卷失败可重试（考试不丢） | `onStarted`（题目来自 `POST /api/exam/start`，**不带答案**） | `onExit` → `main(home)`；`onComplete(result)` → `exam-result` |
| `exam-result` | ExamResultScreen | src/screens/ExamResultScreen.tsx | **考试出分页**：得分环（百分制，≥60 及格）+ 统计网格（答对/答错/用时）+ 自动交卷提示 | 考试交卷成功 | `onReviewPaper` → `exam-detail`；`onRetry` → `exam-setup`；`onHome` → `main(home)` |
| `exam-detail` | ExamDetailScreen | src/screens/ExamDetailScreen.tsx | **试卷回看**：`examApi.detail(examId)` 拉整张试卷 —— 正确选项=绿 / 我选错=红 / 未答=灰，每题底部标注「正确答案 / 我的答案」；顶部成绩摘要卡。练习记录也可进入（`kind='practice'` 走 `practiceApi.sessionDetail`，标题「练习回看」、摘要卡显示正确率%、不显示限时） | `exam-result` 的「查看试卷解析」；成绩记录页点击任意一条 | `onBack` → 来源页（records → `score-records`，result → `exam-result`） |
| `search` | PlaceholderScreen | src/App.tsx | 占位「即将推出」 | 首页顶栏搜索按钮 | `onBack` → `main(home)` |
| `notifications` | NotificationsScreen | src/screens/NotificationsScreen.tsx | **通知中心**：管理员发来的通知列表（类型标签 / 未读红点），点卡片展开看正文并标记已读；普通通知可删除，**系统通知不可删除** | 首页顶栏铃铛 | `onBack` → `main(home)` |
| `achievements` | AchievementsScreen | src/screens/AchievementsScreen.tsx | **成就勋章**：`GET /api/user/achievements` 完整勋章墙（17 枚，分类 答题/坚持/考试/错题/资料）——等级卡（`ProgressRing` Lv 环 + XP 进度 + 解锁总进度）→ 分类筛选 chips（带各类已解锁数）→ 双列勋章卡（emoji 走 `AchievementIcon` 线性图标；未解锁显示进度条与「n / max 单位」；品级 铜章=中性 / 银章=主色 / 金章=绿；`recent_earned` 打 NEW 标） | 「我的」页成就预览「全部」/「成就勋章」菜单 | `onBack` → `main(profile)` |
| `score-records` | ScoreRecordsScreen | src/screens/ScoreRecordsScreen.tsx | **成绩记录**：`GET /api/user/practice/history` 按练习会话分组的历史成绩（方向/题数/答对/正确率/用时/时间，倒序），练习与考试成绩同列表；每条右侧垃圾桶两步确认删除（`practiceApi.deleteSession`），点击任意一条回看完整试卷（`onOpenDetail(sessionId, isExam)`） | 「我的」页「成绩记录」入口 | `onBack` → `main(profile)`；`onStartPractice(id)` → `practice`；`onOpenDetail` → `exam-detail`（带 `isPractice`） |
| `watch-history` | WatchHistoryScreen | src/screens/WatchHistoryScreen.tsx | **观看历史**：`GET /api/library/history` 我看过的视频（按最近观看倒序，同一视频只出现一次，带 `watched_at` / `my_view_count`）；行式条目 = 缩略图（封面→首帧→渐变三级兜底）+ 最近观看时间 + 看过几次；单条 ✕ 移除（`removeHistory`，乐观更新）、顶部「清空」两步确认（`clearHistory`，都是隐藏标记，不影响播放量；再看一次自动回到历史） | 「我的」页 / 教材/视频 Tab「观看历史」 | `onBack` → 来源页（`from`：materials → `main(materials)`，profile → `main(profile)`）；点条目 → `video-detail`（带 `historyFrom`） |
| `favorites` | FavoriteVideosScreen | src/screens/FavoriteVideosScreen.tsx | **我的收藏**：`GET /api/library/favorites` 收藏过的视频双列网格（`VideoCard` 带「已收藏」角标），空态引导 | 「我的」页「我的收藏」入口 | `onBack` → `main(profile)`；点卡片 → `video-detail` |
| `video-detail` | VideoDetailScreen | src/screens/VideoDetailScreen.tsx | **视频详情页（B 站式）**：应用内播放器（16:9，管理员封面作 poster）→ 标题 + 统计行（播放量/收藏数/评论数）→ 收藏按钮（实心=已收藏，可切换）→ 视频简介卡（不显示文件名/大小）→ **评论区（楼中楼两层）**：发表 1~200 字 / 点评论内容或「回复」按钮回复某人（输入框出现「回复 @xx」目标条，被回复人收站内通知）/ 回复嵌套展示在根评论下（`回复 @xx` 徽标）/ 删自己的评论（顶层连回复级联删，本地状态与服务端同步）。进页面 `POST /api/library/{id}/view` 记一次播放（每次打开 +1） | 教材/视频 Tab 点视频卡片；我的收藏/观看历史点卡片 | `onBack` → 来源页（`from`：materials → `main(materials)`，favorites → `favorites`，history → `watch-history`） |
| `settings` | SettingsScreen | src/screens/SettingsScreen.tsx | 设置页：账号（账号安全：改密码 / 改登录账号 + **忘记密码「点击申请」**）/ 外观（浅色·深色·跟随系统，均生效）/ 通知开关（本地存）/ 清除缓存 / 检查更新 / 退出登录 | 个人中心菜单「设置」 | `onBack` → `main(profile)`；`onLogout` → `login` |

**回调接口（页面间唯一通信方式，禁止跨页面直接 import）**

| 回调 | 签名 | 由谁提供 |
| ---- | ---- | ---- |
| `onComplete` | `(methods: NDTMethod[], goal: string) => void` | Onboarding |
| `onSuccess` | `() => void` | Login |
| `onOpenLegal` | `(docKey: 'terms' \| 'privacy') => void` | Login |
| `onNavigate` | `(screen: Screen) => void` | Home / Profile |
| `onStartPractice` | `(categoryId: string) => void` | Home / QuestionBank / Wrong / Learning |
| `onExit` | `() => void` | Practice |
| `onComplete`(practice) | `(correct, total, timeSeconds) => void` | Practice |
| `onRetry` / `onHome` / `onReviewWrong` | `() => void` | PracticeResult |

---

## 4. 底部 Tab 地图

由 `components/BottomNav.tsx` 渲染，`activeTab` 控制高亮；切换即 `main` 视图内换屏。

| Tab id | 标签 | 渲染组件 |
| ---- | ---- | ---- |
| `home` | 首页 | HomeScreen |
| `questions` | 题库 | QuestionBankScreen |
| `materials` | 教材/视频 | MaterialsScreen：`libraryApi.list()` 真实列表；**一级下划线 Tab「教材 & 资料 / 视频课程」+ 二级胶囊 Tag**（资料=分类 标准/教材/资料，视频=方向 UT/RT/MT…按实际数据生成）；资料=双列书封卡片，视频=双列瀑布流卡片（`VideoCard`：管理员封面优先、否则自动取视频首帧，底部 播放量/收藏数）；**点视频卡片 → `video-detail` 视图**；文档点开走应用内 DocViewer 浮层（**pdf=pdf.js 逐页 canvas 渲染**（手机竖屏可滚动；iframe 原生查看器在手机上滚不动已弃用）、docx=docx-preview、xlsx/xls/csv=SheetJS 表格+多 sheet 切换；旧格式给「新标签页打开」兜底；三个库动态 import 按需加载）；空态提示管理员后台上传；底部「观看历史」入口 → `watch-history` 视图（真实实现） |
| `learning` | 学习 | LearningScreen |
| `profile` | 我的 | ProfileScreen |

> 原 `wrong` Tab 已移除（v9）；错题集从「我的」页 / `onNavigate('wrong-questions')` 进入（`goMain('wrong')`），错题本页带**返回按钮**回到「我的」（v10）。

> `Screen` 类型里有 `'home' | 'question-bank' | 'wrong-questions' | 'learning' | 'profile'` 等，`handleNavigate` 把它们映射到对应 Tab。

---

## 5. 组件索引

| 组件 | 文件 | 用途 | 使用方 |
| ---- | ---- | ---- | ---- |
| `Avatar` | components/Avatar.tsx | 全站统一头像：预设 emoji（渐变底）→ 上传图片 → 昵称首字 三级兜底；`online` 可显示右下角状态点 | HomeScreen / ProfileScreen / VideoDetailScreen（评论区） |
| `VideoCard` | components/VideoCard.tsx | 视频卡片（双列瀑布流）：封面三级兜底（管理员指定封面 → 视频首帧 `<video #t=0.1>` → 渐变底图），毛玻璃播放键 / 方向徽标 / 时长角标；底部 播放量（formatCount 万·亿）+ 收藏数 | MaterialsScreen / FavoriteVideosScreen |
| `BottomNav` | components/BottomNav.tsx | 底部 5 Tab 悬浮胶囊玻璃导航；图标瓷片 + 激活浮起 | App.tsx |
| `BrandIcon` | components/BrandIcon.tsx | 品牌 App 图标（SVG 矢量米色渐变底 + 官方透明图形层嵌入） | OnboardingScreen / LoginScreen |
| `PasswordResetSheet` | components/PasswordResetSheet.tsx | 「申请重置密码」底部弹层：账号 + 工作单位 → 提交给管理员生成工单；含「已提交」结果态。**登录页与设置页共用**（`z-[80]`，高于设置页弹层 `z-[60]`） | LoginScreen / SettingsScreen |
| `ProgressRing` | components/ProgressRing.tsx | 环形进度（支持 `gradient` 参数、`children` 中心插槽、动画） | HomeScreen / PracticeResultScreen |
| `icons`（39 个） | components/icons.tsx | 极简线性图标库，stroke 1.6–1.8，圆头端点 | 各页面 |

**页面内的局部子组件**（不跨文件复用，改页面时一并看）：

| 子组件 | 所在页面 | 作用 |
| ---- | ---- | ---- |
| `BrandLogo` | Onboarding / Login | 品牌 Logo 容器（各页各写一份） |
| `CtaButton` / `StepDots` | Onboarding | 胶囊主按钮 / 步骤指示点 |
| `UtScene`~`VtScene`、`ComboScene`、`TechScene` | Onboarding | 步骤 1 的 6 方法小场景插画 + 顶部技师人物插画（内联 SVG） |
| `PasswordInput` / `EyeIcon` | Login | 带「显示-隐藏」眼睛按钮的密码框 / 眼睛图标（本地内联，不污染图标库） |
| `StatCard` / `WeeklyBar` | Home | 数据小卡 / 极简柱状图 |
| `Sheet` / `ResetApplyBlock` | Settings | 底部弹层容器（把手 / 圆角 / 滚动）/ 账号安全弹层底部的「忘记密码？点击申请」区块 |
| `CalendarHeatmap` / `KnowledgeBar` | Learning | 学习日历热力 / 知识掌握条 |
| `PlaceholderScreen` | App.tsx | 通用占位页（搜索；成就 / 观看历史已是真实实现） |

> **`ProfileScreen` 内的编辑面板**（头像 12 预设网格 + 本地上传 + 昵称输入 + 保存/取消）是页面内的**行内弹窗**，没有单独拆文件 —— 改它要读 `src/screens/ProfileScreen.tsx`（含 `handleFile` 图片裁剪压缩逻辑）。

> ✅ **已删除（2026-09-29 清理，勿再引用）**：`components/Button.tsx`（Button / IconButton）、`components/GlassCard.tsx`（GlassCard）、`ProgressRing.tsx` 的 `MiniRing`。
> 这三个此前已零引用（各页面按钮与卡片早已改为内联 JSX 直接挂 `.gb*` / `.card` 类）。**改页面样式请改对应 Screen 内联 JSX 或 `index.css`，不要再找这些组件。**

---

## 6. 图标索引（components/icons.tsx，共 41 个）

- 底部导航：`HomeIcon` `GridIcon` `WrongIcon` `ChartIcon` `UserIcon`
- 通用：`BellIcon` `ShieldIcon`（系统通知专用：盾牌+对勾） `SearchIcon` `ChevronRightIcon` `ChevronLeftIcon` `CheckIcon` `XIcon` `HeartIcon` `ClockIcon` `TargetIcon` `PencilIcon` `CameraIcon` `BookIcon` `AwardIcon` `GearIcon` `FlameIcon` `PercentIcon` `ZapIcon` `StarIcon` `ActivityIcon` `ShuffleIcon` `ClipboardIcon` `WrenchIcon` `FilterIcon` `RefreshIcon` `PlayIcon` `CalendarIcon` `ListIcon` `InfoIcon` `FlagIcon` `RulerIcon` `CheckCircleIcon`
- 视频互动（2026-09-30 新增）：`EyeIcon`（播放量） `MessageIcon`（评论）

> 新增图标**先查此文件**；不要给单个图标加渐变/发光/填充，保持线条一致。
> 已删除未用图标（2026-09-29）：`LayersIcon` `SendIcon` `XCircleIcon`。
> `CameraIcon`（2026-09-29 新增）：用于「我的」页编辑面板的「从相册上传图片」按钮。

---

## 7. 按钮与交互索引

| 按钮 / 交互 | 页面 | 行为 |
| ---- | ---- | ---- |
| 开始体验 / 下一步 / 开始学习 | Onboarding | 步骤推进；末步 `onComplete(方向, 目标)` |
| 跳过 | Onboarding | 直接 `onComplete(['UT'], 'learning')` |
| 检测方向卡片（6 张） | Onboarding | 多选切换，选中青绿边框 + 勾选 |
| 学习目标卡片（4 张） | Onboarding | 单选 |
| 模式切换（账号登录 / 注册） | Login | 切换表单字段；切到「注册」会自动拉一张图形验证码 |
| 登录提交 | Login | 校验「已勾选协议」+ 账号密码非空 → `POST /auth/password/login` → 存令牌 → `onSuccess` |
| 图形验证码（图片） | Login | 点击刷新：`GET /auth/captcha` → 把返回的 base64 SVG 塞进 `<img>` |
| 注册提交 | Login | 校验协议 / 账号规则 / 两次密码一致 / 单位非空 / 验证码非空 → `POST /auth/register` → 提示「等待管理员审核」并切回账号登录 |
| 隐私协议勾选 | Login | 切换 agreed 状态（未勾选时提交会被拦下并提示） |
| 《服务协议》/《隐私政策》 | Login | `onOpenLegal('terms' \| 'privacy')` → 打开 legal 视图 |
| 返回 / 我已阅读，返回 | Legal | `onBack` → 回到登录页 |
| 顶栏铃铛 / 搜索 | Home | `onNavigate('notifications' / 'search')` |
| 快捷入口 4 卡（继续学习/随机刷题/模拟考试/错题复习） | Home | `onNavigate`（分别 → practice / question-bank / exam-setup / wrong-questions） |
| 推荐训练卡 | Home | `onStartPractice(ts.category)` |
| 最近错题卡 / 查看全部 | Home | `onNavigate('wrong-questions')` |
| 成就卡 / 查看全部 | Home | `onNavigate('achievements')` |
| 底部 Tab（5 个：首页/题库/教材·视频/学习/我的） | BottomNav | `onChange(tab)` 切换 activeTab；「错题」入口在「我的」页（v9），「教材/视频」Tab 为 v10 新增 |
| 搜索输入框 | QuestionBank | 本地过滤训练集 |
| 分类 Tab（全部/UT/RT/MT/PT/ET/VT/综合） | QuestionBank | 本地过滤 |
| 筛选（面板：检测方法/难度/考试等级） | QuestionBank | 打开底部面板；重置 / 应用筛选（均仅关闭） |
| 检测方法卡 / 训练集卡 | QuestionBank | `onStartPractice(cat.id / ts.category)` |
| 清除搜索 | QuestionBank | 清空关键词 |
| 返回（退出） | Practice | 打开退出确认弹窗 |
| 收藏（心形） | Practice | 本地 `isFavorited` 切换 |
| 选项卡片 | Practice | 选中判对错 → 600ms 后显示解析 |
| 上一题 / 下一题 / 查看结果 | Practice | 翻页；做过的题会还原当时选的选项与判定；末题「查看结果」→ `onComplete(correct, total, time)` |
| 继续答题 / 保存并退出 | Practice 退出弹窗 | 关闭弹窗 / 交卷记入学习记录 + 保留进度退出（下次续做） |
| 再次练习 | PracticeResult | `onRetry` |
| 复习 N 道错题 | PracticeResult | `onReviewWrong`（仅错题数 > 0 时显示） |
| 返回首页 | PracticeResult | `onHome` |
| 筛选 Tab（全部/未掌握/已掌握） | Wrong | 本地过滤 |
| 错题卡头部 | Wrong | 展开 / 收起详情（历史 / 正确答案 / 解析） |
| 再练一次 / 标记已掌握 | Wrong 展开区 | `onStartPractice(q.category)` / 静态 |
| 开始练习（空态） | Wrong | `onStartPractice('UT')` |
| 周期切换（本周 / 本月） | Learning | 本地 `period` 切换 |
| 练习 X / 立即训练 | Learning | `onStartPractice(topic.category / '综合')` |
| **编辑（铅笔）** | Profile | 打开「编辑个人资料」底部面板（仅考生身份显示；管理员登录时隐藏）。打开时把当前昵称/头像填入草稿 |
| **头像预设格（12 个）** | Profile 编辑面板 | 选中该预设（青绿圈高亮），实时更新顶部预览 |
| **从相册上传图片** | Profile 编辑面板 | 触发隐藏 `<input type=file accept="image/*">` → `handleFile`：校验类型与 ≤5MB → canvas **居中裁剪成正方形** → 压到 256×256 JPEG(0.85) → 存成 data URL |
| **保存** | Profile 编辑面板 | 校验昵称非空且 ≤16 字 → `profileApi.update({nickname, avatar})` → `PUT /api/user/profile` → 更新本地缓存 + 关闭面板 + Toast「资料已保存」 |
| 取消 / 点遮罩 / 右上角 × | Profile 编辑面板 | 关闭面板、丢弃草稿（保存中禁止关闭） |
| 菜单 6 项 | Profile | `onNavigate(item.screen)` |
| 成就勋章查看全部 | Profile | `onNavigate('achievements')` |
| 模拟考试（题库/题型/题数/时长四步选择） | Home 快捷入口 → ExamSetupScreen | `onNavigate('exam-setup')`；开始考试 → `examApi.start` → `exam` |
| 题号网格 / 上一题 / 下一题 / 交卷 | ExamScreen | 跳题、翻页；交卷（未答完两次确认）→ `examApi.submit` → `exam-result` |
| 查看试卷解析 / 再考一次 / 返回首页 | ExamResultScreen | `exam-detail` / `exam-setup` / `main(home)` |
| 成绩记录条目（点击 / 垃圾桶） | ScoreRecords | `onOpenDetail(sessionId, isExam)` → `exam-detail`（练习与考试都可回看）；两步确认删除该条成绩 |
| 顶栏铃铛 + **未读红点** | Home | `onNavigate('notifications')`；有未读时右上角显示数量（>9 显示 `9+`），数据来自 `useNotifications()` |
| 账号安全 → **点击申请** | Settings | 账号安全弹层底部区块 → 打开 `PasswordResetSheet`（预填当前账号） |
| 忘记密码 / 忘记账号？点击提交重置申请 | Login | 同样打开 `PasswordResetSheet`（未登录也能提交，账号需自己填） |
| 提交申请 / 知道了 | PasswordResetSheet | 校验账号规则 + 工作单位非空 → 提交成功显示「管理员已收到你的重置申请」并提示留意通知中心 |
| 通知卡片（点击） | Notifications | 展开 / 收起正文，展开即标记已读 |
| 全部已读 | Notifications | 有未读时显示，一键标记全部已读 |
| 全部 / 未读 分段筛选 | Notifications | 本地过滤 |
| 删除（仅普通通知） | Notifications 展开区 | 删除该条通知；**系统通知不显示删除按钮**，只显示「系统通知 · 不可删除」 |

---

## 8. 图片 / 素材索引

| 素材 | 路径 | 说明 | 引用方 |
| ---- | ---- | ---- | ---- |
| 品牌图标图形层 | src/assets/brand-icon-graphics.png | 466×322 RGBA，官方图标资产包去白底后的透明图形层（蓝青波形 + 金色闪电 + 金色环 + 人物剪影） | components/BrandIcon.tsx（作为 SVG `<image>` 嵌入） |
| 品牌图标底 | 无文件（内联 SVG） | 矢量暖白→米色渐变底 + 柔光阴影，与页面米色背景融合 | components/BrandIcon.tsx |
| 引导页 6 方法插画 + 技师插画 | 无文件（内联 SVG） | OnboardingScreen 内 `UtScene`/`RtScene`/`MtScene`/`PtScene`/`EtScene`/`VtScene`/`ComboScene`/`TechScene` | OnboardingScreen.tsx |
| 密码框眼睛图标 | 无文件（内联 SVG） | LoginScreen 本地定义（`EyeIcon`），不放入 icons.tsx 以保持线性图标风格统一 | LoginScreen.tsx |

> 项目内**没有** emoji 图标、位图装饰、第三方图片 CDN（外部仅 Google Fonts 的 Inter，在 index.css 顶部 `@import`）。

---

## 9. 数据字段索引

数据模型定义在 `src/types.ts`，页面数据全部来自后端接口（见 §14），v6 起 Mock 数据文件已删除。

| 数据 | 类型 | 内容 | 使用页面 |
| ---- | ---- | ---- | ---- |
| `questions` | `Question[]` | 21 道真实 NDT 题（UT/RT/MT/PT），含 `options[{key,text}]` / `correct` / `explanation` / `category` / `level` / `difficulty` / `knowledgePoint` / `standard?` | Practice / Wrong（经 helper） |
| `categories` | `Category[]` | 7 个分类（UT/RT/MT/PT/ET/VT/综合），含 `questionCount` / `completedCount` / `icon` / `color` / `gradient` | QuestionBank |
| `trainingSets` | `TrainingSet[]` | 4 个训练集 | Home / QuestionBank |
| `achievements` | `Achievement[]` | 6 个成就（3 已获得），含 `earned` / `progress` / `maxProgress` / `icon`(emoji) | Home / Profile |
| `wrongRecords` | `WrongRecord[]` | 4 条错题记录，含 `wrongCount` / `history[{date,answer,correct}]` / `mastered` | Home / Wrong |
| `userStats` | 普通对象 | name / level / xp / maxXp / todayCorrect / todayTotal / streak / weeklyQuestions / totalQuestions / studyMinutes / accuracy / weeklyAccuracy / knowledgeBreakdown | Home / Learning / Profile |

**Helper 函数（均在用）**

| 函数 | 使用方 |
| ---- | ---- |
| `getQuestionById(id)` | Home / Wrong |
| `getQuestionsByCategory(category)` | Practice |

**视觉字段说明**：`Category.color` / `Category.gradient` / `Achievement.gradient` / `TrainingSet.gradient` 等旧高饱和视觉字段**仍在数据里但不再用于渲染**；新版统一走「低饱和主色 + 图标」规则（见 §10）。`achievements[].icon` 存的是 emoji，渲染时由 Home / Profile 内的 `achIconMap` 映射为线性图标。

**法律文本（src/data/legal.ts）**

| 导出 | 说明 |
| ---- | ---- |
| `LEGAL_DOCS.terms` | 《服务协议》全文：9 小节（协议接受与变更 / **账号开通与使用（注册申请+管理员审核）** / 服务内容 / 行为规范 / 知识产权 / 免责声明 / 终止 / 法律适用 / 联系方式） |
| `LEGAL_DOCS.privacy` | 《隐私政策》全文：8 小节（收集哪些信息 / 如何使用 / **图形验证码与第三方服务** / 存储与保护 / 你的权利 / 未成年人 / 政策更新 / 联系方式） |
| `LegalDoc` / `LegalSection` / `LegalKey` | 结构与类型；改文字只动 `legal.ts`，页面自动适配 |

> ⚠️ 登录方式变更（手机号验证码 → 注册审核 + 账号密码）时**必须同步这里**：协议里「账号开通方式」与隐私政策里「收集哪些信息」都写了具体字段（现为账号 / 密码 / 单位学校，**不收集手机号**）。

**预设头像（src/data/avatars.ts）**

| 导出 | 说明 |
| ---- | ---- |
| `AVATAR_PRESETS` | 12 个预设头像：`{ id, emoji, label, from, to }`，id 格式 `preset:1`~`preset:12` |
| `AVATAR_PRESET_COUNT` | 预设个数（=12），**须与后端 `server/profile_defaults.py` 一致** |
| `getAvatarPreset(value)` | 值 → 预设对象；不是预设（或序号越界）返回 `undefined` |
| `isUploadedAvatar(value)` | 是否是本地上传图片（`data:image/` 或 `http` 开头），这类值直接用 `<img>` 渲染 |
| `randomAvatarValue()` | 前端随机一个预设 id（仅兜底用；正式随机值由后端建号时生成） |

> ⚠️ **顺序即序号**：前端按下标取第 N 个预设，后端只存 `preset:N`。**只允许在数组末尾追加**，中间插入/调换顺序会让老账号头像全部错位（不会报错，只会显示错图案）。管理员后台 `server/static/dashboard.js` 顶部另有一份同样的列表，改动要一起改。

**通知数据（src/data/notifications.ts + src/hooks/useNotifications.ts）**

| 导出 | 说明 |
| ---- | ---- |
| `NotificationType` | `'system' \| 'notice'` —— 由**管理员**在后台发送时设置 |
| `NOTIFICATION_TYPE_LABEL` | 类型 → 中文标签（系统通知 / 普通通知），与后台下拉一致 |
| `isDeletable(type)` | `system` 返回 false（**系统通知考生不可删除**） |
| `formatNotificationTime(iso)` | 后端时间 `2026-09-29 16:20:00` → 列表显示 `今天 16:20` / `09-29 16:20` |
| `AppNotification` | `{ id, type, title, content, sender, created_at, read, deletable }`（`created_at` 已格式化，`deletable` 以后端为准） |
| `useNotifications()` | 通知 Hook（首页铃铛未读数 + 通知中心共用）：返回 `{ items, unread, loading, reload, remove, markRead, markAllRead }`。内部是**模块级 store + `useSyncExternalStore`**：两个页面共享同一份数据，改一处另一处立刻同步；挂载时自动拉一次 |
| `notificationApi`（client.ts） | 考生端接口封装：`list()` / `markRead(id)` / `markAllRead()` / `remove(id)` → `/api/user/notifications` |
| `resetApi`（client.ts） | 「忘记密码」申请：`apply(account, org)` → `POST /api/auth/password-reset`（公开，无需登录） |

> 通知由管理员在后台「通知管理」发送：可发给**全部启用考生**或**指定考生**（后台按账号搜索多选，同一个账号只会收到一条）；**系统通知不可删除**（用于密码重置结果、重要公告），普通通知考生可自行删除。
> 写操作用「乐观更新 + 失败回滚」，失败后自动重新向后端拉一次；未登录 / 后端未启动时按空列表处理，不打断页面。

**用户资料（昵称 / 头像）的真实来源**

| 数据 | 来源 | 说明 |
| ---- | ---- | ---- |
| 昵称 `nickname` / 头像 `avatar` | 后端 `user_accounts` 表（经 `useProfile()`） | 建号时后端随机生成；考生可在「我的」页改；管理员可在后台「考生账号」改。**历史老账号**在服务启动时由后端一次性补齐随机昵称/头像（不覆盖已改过的） |
| 其它（等级 / 经验 / 统计 / 成就） | 后端 `/api/user/stats/summary` 实时计算（经 `useHomeData()`） | XP = 累计答题数（每 200 题升 1 级）；正确率 / 连续天数 / 成就全部从 `answer_records` 实时算；「我的收藏 / 我的题单」暂无后端功能，副标题显示"敬请期待" |

---

## 10. UI 设计规范（必须遵守，优先级最高）

> 用户指定的视觉标准。任何新增页面/组件都必须符合，**禁止回退到旧深色玻璃风格**。

**整体风格**：专业、安静、高效的学习工具（苹果式克制美学），不是娱乐 App。无「AI 生成感」——不堆砌渐变、发光、玻璃拟态、装饰波形、粒子。

| # | 项 | 要求 |
| ---- | ---- | ---- |
| 1 | 背景与表面 | 页面背景统一 `#F3F4F6`；卡片纯白 `#FFFFFF`，辅助面 `#FAF9F6`；避免强烈对比与花哨装饰 |
| 2 | 文字 | 主 `#1B1E23` / 次 `#5F6670` / 弱 `#9AA1A9`；功能标签用低饱和辅助色 |
| 3 | 辅助色（1–2 种低饱和） | 主色（按钮/进度/选中）低饱和蓝绿 `#5F8D8C`；正确 `#6FA37C`；错误 `#C17B7B`。禁止霓虹色 |
| 4 | 布局 | 留白充足：页面左右 20px，卡片间距 ≥12px，卡片内边距 16–20px |
| 5 | 卡片与阴影 | 柔和圆角：卡片 16–20px / 按钮 12–14px / 胶囊 999px；阴影只允许 `0 1px 2px rgba(27,30,35,.04), 0 4px 16px rgba(27,30,35,.05)`；禁止厚重阴影、强立体感、发光 |
| 6 | 字体层级 | 标题粗无衬线（Inter 600/700 + PingFang SC），字距 `-0.01em`；正文 400/500；数字建议 `font-variant-numeric: tabular-nums` |
| 7 | 图标 | 极简线性，stroke 统一 1.6–1.8，圆头端点；来源 icons.tsx，禁止 emoji 图标、复杂插画 |
| 8 | 图表与统计 | 只保留关键数据：极简柱状图 / 环形进度 / 数字卡片；去掉网格线、装饰曲线、渐变填充、发光 |
| 9 | 交互与动效 | 状态用低饱和色区分且**不只靠颜色**；动效时长 ≤0.4s（淡入淡出 / 轻微位移）；禁止持续背景动画、弹跳、震荡 |

**页面级要求**

| 页面 | 关键要求 |
| ---- | ---- |
| 首页 | 顶部问候、中部进度卡片/今日目标/正确率、下方题库分类入口；卡片式、留白大 |
| 题库分类 | 顶部搜索框；分类卡片/标签列出题数、进度、完成状态 |
| 题目详情/答题 | 题干突出；选项卡片：未答浅灰边框、正确低饱和绿、错误低饱和红；底部提交/下一题 |
| 错题本 | 列表卡片：题目来源、错误次数、正确率、知识点标签 |
| 学习统计 | 刷题量、正确率、连续天数、章节掌握：极简柱状/环形/数字卡片 |
| 个人中心 | 头像区简洁，菜单列表清晰，卡片/列表呈现 |

---

## 11. 设计令牌（src/index.css）

改颜色/阴影/圆角/字体**只改这里**，不要在页面里散落硬编码。

| 令牌 | 值 | 用途 |
| ---- | ---- | ---- |
| `--bg` | `#F3F4F6` | 页面底色（实际由 body 暖米渐变透出） |
| `--surface` | `#FFFFFF` | 卡片表面 |
| `--surface-warm` | `#FAF9F6` | 浅米白辅助面 |
| `--text-1 / 2 / 3` | `#1B1E23 / #5F6670 / #9AA1A9` | 主 / 次 / 弱文字 |
| `--line` | `#E6E8EB` | 分隔线 |
| `--line-strong` | `#D6D9DD` | 强调分隔线（虚线边框等，与 `@theme` 的 `--color-line-strong` 同值） |
| `--accent` | `#5F8D8C` | 低饱和蓝绿主色 |
| `--accent-weak / --accent-border` | `rgba(95,141,140,.10/.30)` | 主色浅底 / 描边 |
| `--ok` | `#6FA37C` | 正确（低饱和绿） |
| `--err` | `#C17B7B` | 错误（低饱和红） |
| `--shadow-card` | `0 1px 2px rgba(27,30,35,.04), 0 4px 16px rgba(27,30,35,.05)` | 卡片阴影 |
| `--glass-bg / --glass-border / --glass-shadow` | 半透明白 + 高光边 | 磨砂玻璃表面 |

**语义面令牌（组件里只准用这些，不要写死 hex，否则深色模式会脏）**

| 令牌 | 浅色 | 深色 | 用途 |
| ---- | ---- | ---- | ---- |
| `--surface-raised` | `#FFFFFF` | `#1F252A` | 弹层 / 需要实体底的浮层 |
| `--surface-translucent` | `rgba(255,255,255,.72)` | `rgba(34,40,46,.78)` | 半透明卡片（登录 / 引导页） |
| `--field-bg` | `rgba(241,243,245,.85)` | `rgba(255,255,255,.06)` | 输入框 / 分段控件底 |
| `--track` | `#EDEFF2` | `#2B3137` | 进度条轨道 / 占位底 |
| `--hairline` | `#D9DCE0` | `#3A4149` | 弹层把手 / 开关未选中 |
| `--chip-bg` / `--chip-bg-soft` | `rgba(255,255,255,.78/.68)` | `rgba(255,255,255,.08/.06)` | 小圆钮 / 次级小面板底 |
| `--chip-border` | `rgba(255,255,255,.75)` | `rgba(255,255,255,.12)` | 玻璃描边 |
| `--inset-hi` | `rgba(255,255,255,.72)` | `rgba(255,255,255,.08)` | 玻璃内高光 |
| `--accent-fill` / `--on-accent` | `rgba(95,141,140,.90)` / `#FFF` | `#3F6E6C` / `#FFF` | 实心主色按钮底 + 其上文字 |

> SVG 的 `stroke`/`fill` 属性**不认 `var()`**。环形进度（ProgressRing）的轨道色改用 `style={{ color: 'var(--track)' }}` + `stroke="currentColor"` 传递，别改回 `stroke={trackColor}`。

**深色模式（2026-09-29 实现）**

- 引擎：`src/theme.ts` → 在 `<html>` 上写 `data-theme="light|dark"`；`main.tsx` 渲染前调 `initTheme()` 防闪色；选「跟随系统」时监听 `prefers-color-scheme`
- 配色：`index.css` 末尾 `[data-theme='dark']` 段一次性覆盖 **全部令牌** + `body` 背景/光影层 + `.card` / `.nav-liquid` / `.gb-*` 等带硬编码白色的组件类
- 登录页 / 引导页写着 Tailwind 的 `slate-*` / `bg-white/70` 类，深色下由该段里的**工具类重映射**规则统一改色，不逐个改 tsx
- 加新页面的规矩：颜色一律 `var(--token)`；确实要写 hex 时先看该 hex 是否已有令牌（没有就在 `:root` + `[data-theme='dark']` 各加一份）
- ⚠️ **凡是浅色段里写了硬编码白色的组件类，深色段必须补一份覆盖**：`.glass-panel`（首页快捷入口卡片）曾漏掉 → 深色下整片发白、文字看不清（2026-09-29 已修）；`.glass-glow::after` 的白色柔光在深色下也会泛白，已把 opacity 压到 0.12。改深色请回查这两条。

**关键工具类**：`.app-shell`（430px 外壳）、`.scroll-area`、`.card` / `.glass` / `.glass-panel`、`.gb` + `gb-primary/secondary/ghost/danger/success/glass/soft` + `gb-sm/lg/pill`（玻璃按钮系统）、`.answer-card`（答题选项）、`.nav-liquid`（底部胶囊导航）、`.anim-*`（淡入/滑入/缩放，≤0.4s）、`.safe-top` / `.safe-bottom`（刘海屏安全区）、`.flame-flicker` / `.dot-pulse` / `.progress-fill`。

**⚠️ 页面滚动结构约定（已经踩过坑，别改错）**

`.app-shell` = `overflow:hidden` + `min-height:100dvh`；`.scroll-area` = `height:100dvh` + `overflow-y:auto`（且全局隐藏了滚动条）。因此：

- ✅ **整屏页面的根元素必须是唯一一个 `.scroll-area`**（通常写成 `div.scroll-area.bg-page`），**顶栏与正文都放在它内部**随页面一起滚动。已符合：Home / QuestionBank / WrongQuestions / Learning / Profile / Legal
- ✅ 另一种同样正确的写法：根给**确定的高度** + 内层滚动区（Practice：根 `app-shell` + 行内 `height:100dvh; overflow:hidden`，内层 `flex-1 overflow-y-auto`）
- ❌ **禁止**：根用 `app-shell + min-h-screen + flex-col`（`min-height` 不是确定高度），再把 `.scroll-area` 当 `flex-1` 内层 —— 高度算不出剩余空间，内容会被 `.app-shell` 的 `overflow:hidden` 裁掉，表现就是**正文看不全、怎么划都滑不动**（LegalScreen 2026-09-29 修的正是这个问题）

> 注意：`--color-page: transparent` —— 页面容器透明，视觉底色来自 `body` 的暖米渐变 + `body::before` 多层丁达尔光束。

---

## 12. 修改定位表（按关键词找文件）

| 需求关键词 | 定位 |
| ---- | ---- |
| 颜色 / 背景 / 阴影 / 圆角 / 字体 / 按钮样式 / 动效 | `src/index.css`（令牌 + 工具类） |
| 深色模式配色 / 跟随系统 | `src/index.css` 末尾 `[data-theme='dark']` 段 + `src/theme.ts` |
| 设置页（账号安全 / 外观 / 通知 / 缓存 / 更新 / 退出） | `src/screens/SettingsScreen.tsx` |
| **「忘记密码 → 点击申请」入口 / 申请表单** | `src/screens/SettingsScreen.tsx`（底部区块）+ `src/components/PasswordResetSheet.tsx`（弹层本体，登录页共用） |
| **通知中心页面（列表 / 已读 / 删除）** | `src/screens/NotificationsScreen.tsx` + `src/hooks/useNotifications.ts` + `src/data/notifications.ts` |
| **通知的类型与是否可删除** | `src/data/notifications.ts`（`NotificationType` / `isDeletable`）⚠️ 后台发送侧在 `server/static/dashboard.js` 的通知管理模块，两边类型要一致 |
| **首页铃铛未读红点** | `src/screens/HomeScreen.tsx`（`useNotifications().unread`） |
| 版本号 / 检查更新比较规则 | `src/data/appVersion.ts`（前端）+ `server/data/version.json`（服务端） |
| 图标 | `src/components/icons.tsx` |
| 底部导航 | `src/components/BottomNav.tsx` |
| 品牌 Logo / App 图标 | `src/components/BrandIcon.tsx` + `src/assets/brand-icon-graphics.png` |
| 页面流转 / 视图切换 / 占位页 / 新增整屏页面 | `src/App.tsx` |
| 引导页（3 步 / 6 方法选择） | `src/screens/OnboardingScreen.tsx` |
| 登录 / 注册 / 验证码 | `src/screens/LoginScreen.tsx` |
| 首页布局 / 周趋势 / 成就位 / 连续打卡 | `src/screens/HomeScreen.tsx` |
| 题库分类 / 筛选面板 / 搜索 | `src/screens/QuestionBankScreen.tsx` |
| 答题判对错 / 解析 / 退出弹窗 / 计时 / **底部 上一题·下一题（回顾已答题还原当时所选项）** / **练习进度续做（保存到服务器，下次接着做）** | `src/screens/PracticeScreen.tsx` |
| 结果页正确率环 / 统计 / 重练 | `src/screens/PracticeResultScreen.tsx` |
| 错题本列表 / 展开详情 / 掌握标记 | `src/screens/WrongQuestionsScreen.tsx` |
| **教材/视频 Tab（Tab/Tag 筛选 / 书封卡 / 资料预览）** | `src/screens/MaterialsScreen.tsx` |
| **视频详情页（播放器 / 播放量 / 收藏 / 评论）** | `src/screens/VideoDetailScreen.tsx`（进页面记一次播放；评论 1~200 字即时发布） |
| **我的收藏（视频）** | `src/screens/FavoriteVideosScreen.tsx`（「我的」页菜单入口 → `favorites` 视图） |
| **视频卡片（封面兜底 / 时长 / 播放量收藏数）** | `src/components/VideoCard.tsx`（教材/视频页与我的收藏页共用；封面 = 管理员指定 → 视频首帧 → 渐变底图） |
| **播放量 / 文件大小 / 时长等展示格式化** | `src/data/format.ts`（formatCount 万·亿 / formatSize / formatDuration / formatMoment） |
| 学习日历热力 / 知识掌握条 / 周目标 | `src/screens/LearningScreen.tsx` |
| 个人中心 / 等级经验 / 成就预览 / 菜单 | `src/screens/ProfileScreen.tsx` |
| **昵称 / 头像的展示与编辑（含上传裁剪压缩）** | `src/screens/ProfileScreen.tsx` + `src/components/Avatar.tsx` + `src/hooks/useProfile.ts` |
| **预设头像的图案与配色 / 要增删头像** | `src/data/avatars.ts`（⚠️ 须同步后端 `server/profile_defaults.py` 的 `AVATAR_PRESET_COUNT` 与后台 `dashboard.js`；**只能末尾追加**） |
| **头像渲染规则（预设 / 上传图片 / 首字兜底）** | `src/components/Avatar.tsx` |
| 题库 / 统计等页面数据 | 后端接口（`src/api/client.ts`，见 §14） |
| 数据类型字段 / 新增领域类型 | `src/types.ts` |
| **接口调用 / 令牌存取 / 接口基址 / 错误文案** | `src/api/client.ts`（唯一出口，不要在各页面自己写 fetch） |
| 登录方式 / 注册表单 / 图形验证码 / 登录态 | `src/screens/LoginScreen.tsx` + `src/api/client.ts` |
| 注册账号规则（4-20 位字母/数字/下划线） | `src/screens/LoginScreen.tsx` 的 `ACCOUNT_PATTERN`（**须与后端 `registrations.py` / `user_accounts.py` 保持一致**） |
| 《服务协议》《隐私政策》**文字内容** | `src/data/legal.ts` |
| 协议页的排版样式 | `src/screens/LegalScreen.tsx` |
| 后端接口本身（注册审核 / 账号 CRUD / 鉴权） | `server/modules/*.py` → 详见 `.modular/backend.md` |
| 前端接口地址 / 代理目标 | `vite.config.ts` 的 `server.proxy`（环境变量 `API_TARGET` 可覆盖） |
| 新增一个整屏页面（完整步骤） | ① `.tsx` 放 `src/screens/` ② `types.ts` 的 `Screen` 加名字（若走 `onNavigate`）③ `App.tsx` 的 `AppView` 加分支 + 渲染 ④ 更新本文档 §3/§5/§7 |

---

## 13. 禁止 / 危险操作

| 项 | 说明 |
| ---- | ---- |
| 🚫 `.figma/` | `vite.config.ts` 直接 import 其 `site.json`，**删掉构建和开发服务器都会挂** |
| 🚫 `node_modules/`、`.git/` | 依赖与版本历史 |
| 🚫 `src/assets/brand-icon-graphics.png` | `BrandIcon.tsx` 引用中 |
| 🚫 `server/config.json` | **含腾讯云短信密钥**，已在 `.gitignore` 中，禁止提交、禁止写进前端代码 |
| ⚠️ `pnpm build` | 本机必失败，用 `npm run build` |
| ⚠️ 跨页面直接 import | 页面之间只通过 §3 的回调接口通信 |
| ⚠️ 在页面里硬编码颜色 | 一律走 §11 令牌 / 工具类 |
| ⚠️ 在页面里直接写 fetch | 一律走 `src/api/client.ts`（要带令牌、要统一错误、要能清登录态） |
| ⚠️ 交付报错代码 | 改完必须 `npm run build` 通过（必要时 `npx tsc --noEmit`） |

---

## 14. API 依赖（前端调用的后端接口）

封装位置：`src/api/client.ts`（**唯一出口**）。开发环境下 `/api` 由 `vite.config.ts` 代理到 `http://127.0.0.1:8000`。
完整接口清单、数据表、错误码见 `.modular/backend.md`。

| 前端方法 | 实际请求 | 用在哪 |
| ---- | ---- | ---- |
| `authApi.passwordLogin(account, password)` | `POST /api/auth/password/login` | 登录页「账号登录」提交（自动识别管理员/考生） |
| `authApi.captcha()` | `GET /api/auth/captcha` | 登录页「注册」拉取图形验证码（返回 base64 SVG） |
| `authApi.register(payload)` | `POST /api/auth/register` | 登录页「注册」提交申请（账号/密码/确认密码/单位学校/验证码） |
| `authApi.logout()` | `POST /api/auth/logout` | 退出登录（目前入口在管理后台，前端待接） |
| `profileApi.get()` | `GET /api/user/profile` | 取当前登录考生的资料（昵称/头像/账号/单位学校）；由 `useProfile()` 在进首页或「我的」时自动调用 |
| `profileApi.update({nickname, avatar})` | `PUT /api/user/profile` | 「我的」页「编辑个人资料」保存 |
| `notificationApi.list()` | `GET /api/user/notifications` | 通知中心列表 + 首页铃铛未读数（由 `useNotifications()` 调用，返回 `items/unread/total`） |
| `notificationApi.markRead(id)` | `POST /api/user/notifications/{id}/read` | 点卡片展开即标记已读 |
| `notificationApi.markAllRead()` | `POST /api/user/notifications/read-all` | 通知中心「全部已读」 |
| `notificationApi.remove(id)` | `DELETE /api/user/notifications/{id}` | 删除普通通知（**系统通知后端返回 403**，前端本来也不给按钮） |
| `resetApi.apply(account, org)` | `POST /api/auth/password-reset` | 「忘记密码 → 点击申请」提交（设置页 / 登录页共用 `PasswordResetSheet`）；同一账号重复提交会**覆盖**原来那条待处理申请 |
| `bankApi.summary()` | `GET /api/bank/summary` | 首页/题库页：各方向题量 + 我已做题量（`useHomeData` 调用） |
| `bankApi.search(q, limit)` | `GET /api/bank/search` | 题库页搜索框：题干/知识点模糊匹配（前端 300ms 防抖），返回题目预览列表 |
| `practiceApi.questions(category, mode, limit)` | `GET /api/practice/questions` | 答题页出题（`mode`: sequential/random/wrong；题目来自服务端 `questions` 表） |
| `practiceApi.submit(category, seconds, answers)` | `POST /api/practice/submit` | 答题页交卷：本轮每道题写入服务端 `answer_records`（按登录账号隔离保存） |
| `practiceApi.getProgress(category, opts)` | `GET /api/practice/progress` | 练习进度读取（续做）：答题页进入时恢复上次的题号与已答界面快照 |
| `practiceApi.saveProgress(payload)` | `POST /api/practice/progress` | 练习进度保存：答题/跳题后防抖写入服务端（下次进来接着做） |
| `practiceApi.deleteProgress(category, opts)` | `DELETE /api/practice/progress` | 练习进度删除：清除记录 / 交卷完成时调用，只删这一条 |
| `statsApi.summary()` | `GET /api/user/stats/summary` | 首页统计 + 「我的」页：今日答题/正确率/时长、连续打卡、近 7 天趋势、成就预览（前 6 枚）、总答题/总正确率/累计时长/XP 等级、`ach_earned`/`ach_total`（完整成就墙口径，「我的」页入口副标题用）（`useHomeData` 调用） |
| `statsApi.achievements()` | `GET /api/user/achievements` | 成就勋章页：完整勋章目录（分类/品级/进度/解锁状态）+ 等级概览 + `recent_earned` |
| `statsApi.report(period)` | `GET /api/user/stats/report` | 学习报告页：`period=week|month` 周期汇总（答题/正确率/时长）+ 近 35 天学习日历 `calendar` + 各方向掌握度 `breakdown` |
| `statsApi.wrongQuestions(limit)` | `GET /api/user/wrong-questions` | 首页「最近错题」预览（limit=3）+ 错题本页全量列表 |
| `statsApi.markMastered(id)` | `POST /api/user/wrong-questions/{id}/master` | 错题本「标记已掌握」（乐观更新，失败回滚） |
| `examApi.start(payload)` | `POST /api/exam/start` | 模拟考试开卷：按 方向/题库 + 题型 随机抽题，返回的题目**不带答案**（服务端判分） |
| `examApi.submit(examId, seconds, answers, auto)` | `POST /api/exam/submit` | 考试交卷（手动 / 到点自动 `auto=true` / 退出确认共用）：服务端判分并写成绩；**幂等**，重复提交返回已有结果 |
| `examApi.detail(examId)` | `GET /api/exam/records/{exam_id}` | 试卷回看：完整题目 + 正确答案 + 我的答案（未答 my_answer 为空、is_correct 为 null） |
| `practiceApi.history(limit)` | `GET /api/user/practice/history` | 成绩记录页：练习与考试成绩同列表（考试记录带 `is_exam/score/exam_title`） |
| `practiceApi.sessionDetail(sessionId)` | `GET /api/user/practice/history/{session_id}` | 单次成绩回看：练习从 answer_records 还原试卷；考试 session 自动走考试逻辑，返回结构与 examApi.detail 一致 |
| `practiceApi.deleteSession(sessionId)` | `DELETE /api/user/practice/history/{session_id}` | 删除一条成绩：删该会话 answer_records，考试连 exams/exam_answers 一起删（统计/XP/错题口径随之更新，不可恢复） |
| `libraryApi.list(category)` | `GET /api/library?category=` | 教材/视频页：标准规范/教材/辅导资料/视频课程同列表（后台上传后动态出现）；带 `has_cover`（有无管理员封面）/`view_count`（播放量）/`fav_count`（收藏数）/`favorited`（我是否已收藏） |
| `libraryApi.fileUrl(id)` | `GET /api/library/{id}/file?token=` | 资料文件地址：`<video>` / `window.open` 直接用（令牌在查询参数里）；服务端 FileResponse 支持视频拖动 |
| `libraryApi.coverUrl(id)` | `GET /api/library/{id}/cover?token=` | 管理员自定义封面图地址（`has_cover=false` 时 404，`VideoCard` 自动回落视频首帧） |
| `libraryApi.detail(id)` | `GET /api/library/{id}` | 视频详情页：单条资料 + 播放量/收藏数/`comment_count`/是否已收藏 |
| `libraryApi.favorites()` | `GET /api/library/favorites` | 我的收藏页：收藏过的视频，按收藏时间倒序 |
| `libraryApi.history(limit)` | `GET /api/library/history` | 观看历史页：我看过的视频（按最近观看倒序，同一视频只出现一次，带 `watched_at` / `my_view_count`） |
| `libraryApi.removeHistory(id)` | `DELETE /api/library/history/{id}` | 观看历史单条移除（隐藏标记，不影响播放量） |
| `libraryApi.clearHistory()` | `DELETE /api/library/history` | 观看历史一键清空（隐藏标记，不影响播放量） |
| `libraryApi.recordView(id)` | `POST /api/library/{id}/view` | 视频详情页进入时记一次播放（每次打开 +1，B 站式口径），返回最新播放量/收藏数 |
| `libraryApi.favorite(id) / unfavorite(id)` | `POST / DELETE /api/library/{id}/favorite` | 收藏 / 取消收藏，返回最新 `favorited` + `fav_count` |
| `libraryApi.comments(id)` | `GET /api/library/{id}/comments` | 视频详情页评论列表（昵称/头像/时间，`is_mine` 标记本人） |
| `libraryApi.addComment(id, content, parentId?)` | `POST /api/library/{id}/comments` | 发表评论 / 回复（1~200 字，即时可见）；`parentId` 传目标评论 id = 回复（后端归到根评论并给被回复人发通知），返回完整新评论 |
| `libraryApi.deleteComment(commentId)` | `DELETE /api/library/comments/{commentId}` | 删除自己的评论（别人的 403） |
| `getToken / saveSession / clearSession / getProfile / patchSavedProfile` | —（本地 localStorage） | 令牌与用户信息存取；`patchSavedProfile` 用于改完昵称头像后同步本地缓存；401 时 `apiRequest` 会自动 `clearSession()` |

**约定**
- 令牌放 `Authorization: Bearer <token>`；请求失败抛 `ApiError`（带 `status`），页面只用 `err.message` 展示
- 收到 401 会自动清本地登录态，页面可据此引导回登录页
- **注册不即时生效**：`register` 成功只代表申请已提交，需管理员在后台「注册申请」审核通过后才能登录（前端据此提示并切回账号登录）
- **`/api/user/profile` 只认考生令牌**：管理员令牌请求会 401。`useProfile()` 已按 `getIdentity() === 'user'` 判断，管理员登录时不会发这个请求；此时「我的」页的铅笔按钮也不显示
- **题库 / 练习 / 统计 / 题库页 / 学习报告 / 个人中心已全部接后端（v6）**：题目与答题记录都存服务端数据库，每个账号只看到自己的数据；**`src/data/mockData.ts` 已删除**（v6 起前端无任何 Mock 数据源）
- **首页数据统一走 `src/hooks/useHomeData.ts`**（bank 概览 + stats 概览 + 错题预览一次取齐），不要在页面里自己拼这三个接口

---

## 15. 变更历史

| 日期 | 变更 |
| ---- | ---- |
| 2026-09-30 | **v18 成就勋章 + 观看历史 + PDF 手机滚动修复 + 管理员视频评论闭环**：① **新页面 `AchievementsScreen`（成就勋章）**：`GET /api/user/achievements` 完整勋章墙 17 枚（分类 答题/坚持/考试/错题/资料，品级 铜银金，未解锁带进度条，`recent_earned` 打 NEW）+ 等级卡（Lv 环 + XP + 解锁总进度）+ 分类筛选 chips；新组件 `AchievementIcon`（emoji → 线性图标统一映射，Profile 同步改用）；首页/「我的」成就预览仍为前 6 枚不变，summary 新增 `ach_earned`/`ach_total` 完整口径。② **新页面 `WatchHistoryScreen`（观看历史）**：`GET /api/library/history` 我看过的视频（按最近观看倒序、同一视频去重，带 `watched_at`/`my_view_count`）；行式条目 + 单条 ✕ 移除 + 「清空」两步确认（均为隐藏标记，播放量不受影响；再看一次自动回到历史）；`App.tsx` 的 `watch-history`/`video-detail` 视图带 `from`/`historyFrom` 回源（从教材/视频页进入返回也回教材/视频页）。③ **`DocViewer` PDF 改 pdf.js 逐页 canvas 渲染**（`pdfjs-dist` 动态 import + worker `?url`；按容器宽度×dpr 自适应），修复手机竖屏 iframe 原生查看器滚不动。④ **`VideoDetailScreen` 简介卡不再显示文件名与文件大小**。⑤ **管理员视频评论闭环（后台）**：视频类资料「查看」改为宽版视频详情弹窗（播放器 + 简介 + 评论楼中楼，可删任意评论、以「管理员」身份回复，被回复考生收站内通知）；后端新增 `POST /api/admin/material-comments`（user_id=0 落库，考生端昵称「管理员」且不可删）。校验：隔离副本 API e2e 全过（成就 17 枚判据逐条核对 / 历史去重 / 单条移除与清空不影响播放量 / 老库迁移补列）、playwright UI 全流程 + 深浅双色截图验证，`tsc` + build 通过。后端配套见 `.modular/backend.md` §11 v1.18。 |
| 2026-09-30 | **v17 评论楼中楼 + 回复通知 + 文档预览层级修复**：① `VideoDetailScreen` 评论区改**楼中楼两层**：点评论内容或「回复」按钮 = 设为回复目标（输入框上方出现「回复 @xx」目标条、占位符与按钮文案随之变化），回复带 `回复 @xx` 徽标嵌套展示在根评论下；删自己的评论顶层连回复级联删，本地状态与服务端同步；评论数统计含回复。② `libraryApi.addComment(id, content, parentId?)` 支持 `parent_id`；`MaterialComment` 增 `parent_id/reply_to/reply_count/replies`。③ 回复他人时被回复人收「收到新回复」站内通知（通知中心 + 首页铃铛红点，type=notice 可删）。④ `DocViewer` 浮层 `z-50 → z-[60]`：文档预览时底部导航压到浮层下面，不再遮挡文档（此前与 BottomNav 同为 z-50，DOM 靠后的导航盖在预览上）。⑤ 后台评论弹窗对回复显示「回复 @xx」徽标，副标题标注回复数。校验：隔离副本 API e2e **17/17**（回复挂根/回复的回复归根/双方收通知/自回不发通知/级联删/越权 403/取消收藏库同步/管理员删顶层级联），UI 全流程截图验证，`tsc` + build 通过。后端配套见 `.modular/backend.md` §11 v1.17。 |
| 2026-09-30 | **教材/视频页按参考稿重排**：一级下划线 Tab（教材&资料 / 视频课程）+ 二级胶囊 Tag + 双列卡片网格（资料=书封卡、视频=首帧视频流卡），`MaterialsScreen` 布局重写，数据接口与播放/预览行为不变。 |
| 2026-09-30 | **v16 视频互动闭环（封面 / 播放量 / 收藏 / 评论）**：① **新页面 `VideoDetailScreen`（B 站式详情页）**：应用内 16:9 播放器（管理员封面作 poster）+ 标题与统计行（播放量/收藏数/评论数）+ 收藏按钮（可切换）+ 视频简介卡 + **评论区**（1~200 字即时发布、删自己的评论）；进入页面 `POST /api/library/{id}/view` 记一次播放（每次打开 +1，B 站式口径，ref 挡重复触发）。② **新组件 `VideoCard`**（双列瀑布流视频卡，教材/视频页与我的收藏页共用）：封面三级兜底 = 管理员指定封面 → 视频首帧（`<video preload="metadata" #t=0.1>`，顺带读真实时长）→ 渐变底图；底部 播放量 + 收藏数（`formatCount` 万/亿）。③ **新页面 `FavoriteVideosScreen`（我的收藏）**：「我的」页菜单「我的收藏」由占位改为真实入口，收藏过的视频网格 + 空态引导。④ `MaterialsScreen` 视频卡片改走详情页（移除应用内浮层播放器），新增 `onOpenVideo` prop；`App.tsx` 新增 `favorites` / `video-detail`（带 `from` 回源）两个视图；`types.ts` Screen 增两项。⑤ `icons.tsx` 39→41（`EyeIcon`/`MessageIcon`）；新增 `src/data/format.ts`（formatCount / formatSize / formatDuration / formatMoment）。后端配套见 `.modular/backend.md` §11 v1.16。校验：隔离副本 API e2e **29/29**（播放累计/收藏幂等/评论校验/越权 401/封面 404/非法封面 400/管理员删评论/删除资料级联清理），浏览器端到端全流程截图验证（列表→详情→发评论→我的收藏→后台列表统计/上传封面/评论管理），`tsc` + build 通过。 |
| 2026-09-30 | **退出弹窗合并为「保存并退出」**：原「保存进度并退出」「结束练习并记入记录」两按钮合并为一个 **保存并退出** —— 退出时已答题上传为学习记录（交卷）**且进度保留**，下次进来从上次的题号继续；`submitAnswers` 不再删除进度（进度只在「清除全部记录」时删除），进度保存 + 交卷在同一次退出中完成。 |
| 2026-09-30 | **答题页底部「上一题 / 下一题」+ 回看已答题所选项**：① 底部操作条改为 **上一题 / 下一题** 双按钮（首题「上一题」禁用、末题「下一题」变「查看结果」），未作答时按钮上方保留提示文案。② 抽出统一 `goTo(index)`：翻页 / 导航跳题都走它 —— **做过的题还原「当时选的选项 + 判定结果（含解析）」**，没做过的全新开始（以 `sessionStates` 为准，续做时从服务器恢复的作答同样生效）。③ 与练习进度联动：翻页即触发进度保存；「保存进度并退出」后重进从上一次的题号继续，前面的题点「上一题」即可回看当时选的答案。浏览器端到端（隔离副本 8123 + dev 8555，`playwright-core`）验证 13/13：底部双按钮存在 / 首题上一题禁用 / 上一题还原作答 / 退出保存后重进**精确续做（3 / 470）** / 续做后「上一题」还原前一道作答 —— 全部通过；服务端 `practice_progress` 行核对无误（`current_index=2`、`answers_json` 记录前两题）；`tsc` + build 通过。 |
| 2026-09-30 | **练习进度续做（保存到服务器，下次接着做）**：① 后端新增 `practice_progress` 表（按 `user_id + 范围` 唯一）+ `GET/POST/DELETE /api/practice/progress` 三个接口（保存/读取/删除我的练习进度，**只删自己的这一条**）。② `PracticeScreen` 加载题目后读取进度，若题目顺序快照一致则恢复上次的 `current_index` 与已答界面（`sessionStates`），答题/跳题后防抖保存进度到服务器；退出弹窗改为三按钮 —— **保存进度并退出**（不交卷，下次进来从这题继续）/ **结束练习并记入记录**（交卷 + 删除进度）/ 继续答题；交卷完成或清除记录时自动删除进度。③ `client.ts` 新增 `practiceApi.getProgress/saveProgress/deleteProgress`。隔离副本 e2e 验证：保存/读取/删除/用户隔离（A 不能读删 B 的进度）/ 无令牌 401 / 老库自动建表，全部通过；`tsc` + build 通过。后端配套见 `.modular/backend.md` §3.9。 |
| 2026-09-29 | **v14 题目疑问（纠错上报）+ 管理端纠错工单 + 内置题库进后台**：① **答题页每题加「题目疑问」**：顶栏新增旗帜按钮（导航按钮左侧），点开新组件 `src/components/QuestionReportSheet.tsx`（底部弹层）：预览题干 → **选择你认为的正确答案**（有选项的题=选项 chips 单选；简答/计算=文本框）→ **填写理由（必填）** → 提交 `POST /api/user/question-reports`（成功态 ✓ + 1.4s 自动关闭；同一题重复提交覆盖之前的 pending 工单）。② **错题集展开卡片加「疑问」按钮**（操作行，黄色旗帜，与再练/掌握/删除并列），复用同一弹层。③ **管理后台新增「纠错工单」Tab**（`panel-reports` + `dashboard.js` 模块七）：按 待处理/已处理/已忽略/全部 筛选；每行显示完整题目+现答案+选项、**考生建议答案、理由与上报人（昵称+账号）**；操作：**采纳**（直接把题库正确答案改为考生建议，二次确认）/ **编辑题目**（跳题库编辑弹窗，可改题干/选项/答案）/ 忽略 / 删除；Tab 带 pending 数红点。④ **题库管理修复 + 增强**：修复 `loadQuestionSets()` 按钮未绑定点击导致"页面一加载就弹编辑框、点按钮无效"的严重 Bug（v1.12 引入）；**内置一级题库（UT/RT/MT/PT，伪 id -1..-4）出现在题库列表**（带「内置」badge，无编辑/删除按钮），题目弹窗可查全部题目（含 470 题 UT），**每题新增「编辑」按钮**（PUT 接口，改题型/题干/选项/答案，保存后自动关闭该题待处理工单）；内置题库不可改名/删除。后端配套见 `.modular/backend.md` §11 v1.14。校验：隔离副本 e2e 43/43、playwright UI 终验全过（无弹窗残留/新建/内置题库编辑/工单 Tab），`tsc` + build 通过。 |
| 2026-09-29 | **v13 模拟考试全流程上线**：① **考试设置页** `ExamSetupScreen`（替换 App.tsx 占位 Stub）：四步选题 —— 题库（综合卷 + 内置方向 + 自定义题库，`bankApi.summary/sets` 实时题量）→ 题型（全部/判断/选择/计算/简答，按当前题库库存动态生成，空题型不显示）→ 题数（20/50/100，超库存裁剪、库存 <20 显示「全部 N 题」）→ 时长（15/30/60/90 分钟）。② **考试答题页** `ExamScreen`：顶部**倒计时**（≤300s 变 accent、≤60s 红色 + `examBlink` 闪烁，到 0 自动交卷）；选择答案**只记录不判分**、可随时改；**题目导航**（已答=accent 填充 / 未答=灰，自由跳题）；底部 上一题/交卷/下一题；未答完交卷两次确认；退出弹窗「交卷并退出」；交卷失败（断网）恢复状态可重试。③ **出分页** `ExamResultScreen`：得分环（百分制，≥80 优秀 / ≥60 及格）+ 统计网格 + 「时间到，系统已自动交卷」提示。④ **试卷回看页** `ExamDetailScreen`：整张试卷逐题 —— 正确选项=绿 / 我选错=红 / 未答=灰，每题底部「正确答案 / 我的答案」，顶部成绩摘要卡。⑤ **成绩记录页升级**：记录可点击回看（练习=答题记录、考试=试卷解析），考试记录带「模拟考试」徽标与得分列。⑥ 后端新增 `modules/exam.py`（`POST /api/exam/start` 题目不带答案、`POST /api/exam/submit` 服务端判分+幂等、`GET /api/exam/records/{id}`、`GET /api/exam/records`）与 `exams`/`exam_answers` 表；考试作答照常写 `answer_records`（session_id=exam_id），统计/XP/成绩记录自然汇入；`practice/history` LEFT JOIN exams 带出 `is_exam/score/exam_title`。隔离副本 e2e 21/21 全过（判分自洽/未答口径/幂等/越权隔离），`tsc` + build 通过。 |
| 2026-09-29 | **v12 管理后台题库管理 + 考生端动态题库**：① **管理后台新增「题库管理」Tab**（`dashboard.html` panel-questionsets + `dashboard.js` 模块六）：新建/编辑/删除题库（名称/级别/描述，重名 409）；「题目」弹窗按题型分组列出题目、可删单题；「+ 添加题目」表单（题型：选择题/判断题/计算题/简答题；判断题自动生成 正确/错误 选项，简答题无选项、答案=参考答案）；「导入」支持选 CSV 文件或粘贴文本（**与内置一级题库 CSV 同 8 列格式**，异常行跳过并提示）。② **考生端题库页改版**：原「推荐训练集」（概览推导的假列表）删除，替换为「题库」区 —— `GET /api/bank/sets` 动态获取管理员创建的题库（名称 + 级别 badge + 题数 + 各题型题量标签），点击弹 `SetPracticeSheet`（选题型：全部/判断/选择/计算/简答 → 开始练习；垃圾桶两步确认清除该题库记录）；**检测方法卡片（UT/RT/MT/PT）加「一级」标识**，内置题库不受影响。③ `PracticeScreen` 新增 `setId`/`title` props（顶栏显示题库名）；**简答题交互**：先作答 →「查看参考答案」→ 自评「答对了/答错了」记入记录；`qtypeLabel` 增简答题。④ 后端：`question_sets` 表 + `questions.set_id` 列 + `modules/question_sets.py` + `practice.py` 的 `set_id` 参数与 `short` 题型，见 `.modular/backend.md` §11 v1.12。校验：隔离副本 e2e 30/30、老库迁移零影响、`tsc` + build 通过。 |
| 2026-09-29 | **v11 随机刷题选方向+题型 / 错题复习直达 / 错题集可删除**：① **随机刷题**：首页「随机刷题」不再跳题库页，改为打开新组件 `src/components/RandomDrillSheet.tsx`（底部弹层：**题库方向**网格（综合 + 各方向，实时题量）+ **题目类型**（全部/判断题/选择题/计算题，题量为 0 的题型自动隐藏）→ `onStartPractice(category, {mode:'random', qtype})` 随机出题）。② **题库题型分类**：后端 `questions.qtype` 已有 judge/single，导入改为 `_normalize_qtype()` 兼容 `calc`（计算题，当前 CSV 为 0 题、接口已预留）；`/api/bank/summary` 新增 `qtype_counts`（方向×题型矩阵）。③ **错题复习直达**：首页「错题复习」有待复习错题时直接 `onStartPractice('综合', {mode:'wrong'})` 进「错题重练」（错题随机重做），没有则仍去错题集页。④ **错题集可删除**：错题卡片操作行新增垃圾桶「删除」（两步确认变红「确认删除」），走新接口 `DELETE /api/user/wrong-questions/{id}`（隐藏标记，不删答题记录，再答错会恢复），乐观移除+失败回滚。⑤ 配套：`PracticeScreen` 新增 `mode`/`qtype` props（顶栏显示「错题重练/随机刷题」前缀；**错题重练模式隐藏「清除全部记录」**——清除语义与之冲突）；`App.tsx` 练习/结果视图带 `mode/qtype`（「再练一次」保留原参数）；`PracticeEntry`/`practiceApi.questions` 扩展 `qtype`；`statsApi.deleteWrong` 新增。后端配套（qtype 筛选、wrong_dismissals 表、DELETE 接口）见 `.modular/backend.md` §11 v1.11。隔离副本 e2e 23/23 全过，老库迁移验证零影响，`tsc` + build 通过。 |
| 2026-09-29 | **v10 教材/视频 Tab + 错题返回 + 首页/我的瘦身**：① 底部导航恢复 5 Tab，新增**「教材/视频」Tab**（`types.ts` 的 `Tab` 增加 `'materials'`；新页面 `src/screens/MaterialsScreen.tsx`：电子教材 / 视频课程两大「敬请期待」占位卡 + **观看历史**入口，第二阶段接视频课程后看完自动记入观看历史）。② **错题本页加返回按钮**：标题行左侧返回箭头，`WrongQuestionsScreen` 新增 `onBack` prop（App.tsx 传 `goMain('profile')`，因错题集从「我的」页进入）。③ **首页删「成就」区**（原底部成就横排 + 「查看全部」，成就入口保留在「我的」页）；`HomeScreen` 同步清理 `achIconMap` 与 5 个不再使用的图标导入。④ **「我的」页菜单删「我的题单」**（`ProfileScreen` `menuItems` 移除该项 + 清理 `ListIcon` 导入）。后端无改动。校验：`npx tsc --noEmit` 无错误、`npm run build` 通过（46 modules）。 |
| 2026-09-29 | **v9 我的页改版 + 底部导航四 Tab**：①「我的」页删除顶部 4 个统计卡（总答题/正确率/连续天/成就数）；②成就预览卡下面新增三个功能入口：**错题集**（原底部「错题」Tab 功能移到这里，副标题=待复习数）、**成绩记录**（新页面 `ScoreRecordsScreen`，`GET /api/user/practice/history` 按练习会话分组的历史成绩：方向/题数/答对/正确率/用时/时间，将来模拟考试成绩也在这）、**观看历史**（占位空态，等教材/视频功能上线后自动记录）；③底部导航从 5 Tab 改 4 Tab（首页/题库/学习/我的），`BottomNav.tsx` 删掉错题项；错题页仍可通过「我的 → 错题集」进入（`goMain('wrong')` 保留）；④「我的错题」从下方菜单列表移除（避免与错题集入口重复）。隔离副本自测新接口 11 项全过（空态/汇总/倒序/账号隔离=管理员 401/未登录 401），`tsc` + build 通过。 |
| 2026-09-29 | **v7 章节练习 + 分块顺序练习 + 题目导航 + 清除记录**：① `QuestionBankScreen`：点击方向卡片/训练集不再直接进答题页，而是弹出「选择练习方式」底部面板 —— **顺序练习** Tab 列出整方向的分块（每组 20 题，显示每组 对/错/未做）；**按章节练习** Tab 列出知识点章节（题数+已做），章节 >20 题点击展开组列表；每组行尾垃圾桶两步确认**清除该组记录**（`practiceApi.reset`），清除后可重新做。② `PracticeScreen`：新增**题目导航面板**（顶栏网格按钮 → 底部弹层 20 格题号，点击跳题）；题号颜色 = 我最近一次作答结果（服务端 `my_state` 一直保留）：**对=绿 / 错=红 / 未做=浅灰**，本次会话答题后立即更新，跳回已答题还原作答界面；导航面板底部「清除本组记录，重新做」（两步确认，清后重拉题目）。答题会话改为 `sessionStates`（按题记忆，跳题不丢已答），交卷时一次提交。③ `App.tsx` 练习视图带 `topic/block`；`client.ts` 新增 `PracticeEntry/practiceApi.blocks/reset/bankApi.chapters`。后端配套见 `.modular/backend.md` §3.9。自测 25/25，`tsc` 无错误、构建通过。 |
| 2026-09-29 | **v6 题库页 / 学习报告 / 个人中心实时化**：① `QuestionBankScreen`：标题题量、检测方法卡片（题量 + 我的完成度）、训练集（由概览接口实时推导，含「全科综合刷题」）、搜索框（`bankApi.search` 300ms 防抖，结果点卡片进对应方向练习）全部实时；筛选面板只保留真实存在的「检测方法」过滤，假的难度/等级选项删除。② `LearningScreen`：新增 `statsApi.report(period)`，「本周/本月」切换真实拉取；汇总四卡（答题/正确率/时长/连续）、学习日历（近 35 天真实每日答题量，替换原随机生成）、知识掌握度（按方向）、学习建议（正确率最低两个方向动态生成）、周目标全部实时；无答题记录时有空状态引导。③ `ProfileScreen`：统计四卡、经验条（XP = 累计答题数，每 200 题升 1 级）、成就预览、菜单副标题（错题待复习数 / 累计分钟 / 成就进度）全部实时（走 `useHomeData`）；「我的收藏 / 我的题单」暂无后端，副标题改「敬请期待」。④ **`src/data/mockData.ts` 删除**——前端已无任何 Mock 数据源。后端配套（`/api/user/stats/report`、`/api/bank/search`、summary 补全）见 `.modular/backend.md`。自测 20/20，`tsc` 无错误、构建通过。 |
| 2026-09-29 | **v5 题库入库 + 首页/答题/错题全部接真实数据**：① 后端新增 `questions`（题库，启动时从 `server/data/question_bank.csv` 导入 1740 题，表空才导）与 `answer_records`（答题记录，按 `user_id` 隔离）两张表；新增 `modules/bank.py`（题库导入 + `GET /api/bank/summary`）与 `modules/practice.py`（`GET /api/practice/questions` 顺序/随机/错题出题、`POST /api/practice/submit` 交卷、`GET /api/user/stats/summary` 首页统计、`GET /api/user/wrong-questions` 错题本、`POST /api/user/wrong-questions/{id}/master` 标记掌握）。**考生端对题库只有读接口**，题库修改仅管理侧可做。CSV 选项里的 `﹑`(U+FE51) 与 `、`(U+3001) 两种分隔符都认，原书插图 `<img>` 导入时替换为「【图】」。② 前端：`client.ts` 新增 `bankApi/practiceApi/statsApi`；新增 `src/hooks/useHomeData.ts` 作为首页唯一数据出口；`HomeScreen` 全部改实时数据（今日进度环、连续打卡、学习数据卡、周趋势、推荐训练=真实题库各方向+我的完成度、最近错题、成就），快捷入口副标题也用实时数（继续学习直接带上次方向进答题页）；`PracticeScreen` 从服务端题库取 20 题、交卷把每题写入 `answer_records`（查看结果/中途退出都会保存，题库暂无解析字段时只显示答案）；`WrongQuestionsScreen` 接真实错题 + 「标记已掌握」写库（乐观更新）。③ 隔离副本端到端自测 41/41 通过（导入 1740、出题/交卷/统计/错题/隔离/越权全分支），`npx tsc --noEmit` 无错误、`npm run build` 通过。 |
| 2026-09-29 | **v4 通知与密码重置接后端（前端全部走真实接口）**：① `src/hooks/useNotifications.ts` 重写为**模块级 store + `useSyncExternalStore`**，读写真实接口：首页铃铛未读数与通知中心共享同一份数据，读 / 删一处立刻同步；挂载时自动刷新，写操作乐观更新 + 失败回滚（失败后重拉）。未登录 / 后端未启动时按空列表处理，页面不报错。② `src/data/notifications.ts` 删除 `DEMO_NOTIFICATIONS`（阶段一演示数据下线），新增 `formatNotificationTime()`（`2026-09-29 16:20:00` → `今天 16:20`）；`AppNotification` 增加 `deletable` 字段（以后端为准）。③ `NotificationsScreen` 接 Hook：新增加载态、顶栏「刷新」按钮，删除改为异步（失败提示「请稍后重试」）。④ `client.ts` 新增 `notificationApi`（列表/已读/全部已读/删除）与 `resetApi.apply()`；`PasswordResetSheet` 改为真实提交，成功后展示后端返回的文案（区分「新提交」与「已更新原有申请」），失败展示后端错误。⑤ 管理后台「通知管理」的接收对象从「手输账号」改为**可搜索多选**：输入账号/昵称/单位学校即搜（300ms 防抖 + 回车），点「添加」进入已选 chips，已添加的候选置灰不可重复添加（提交时后端再按账号去重一次）；「已发送记录」表头改为「类型/接收对象/标题/内容/发送人/发送时间/操作」。校验见下条。 |
| 2026-09-29 | **阶段一界面：深色模式修复 + 通知中心 + 密码重置申请（界面已完成，逻辑待阶段二接后端）**：① **修深色模式首屏发白**：首页快捷入口卡片用的 `.glass-panel` 在深色段里没有覆盖（浅色段是写死的白色渐变），深色下整片发白、文字看不清 → 补 `[data-theme='dark'] .glass-panel` 深灰玻璃；同时把 `.glass-glow::after` 的白色柔光在深色下 opacity 降到 0.12。② 新增**通知中心** `src/screens/NotificationsScreen.tsx`（替换原占位页）：全部/未读分段筛选、点卡片展开看正文并标记已读、一键全部已读；**系统通知无删除按钮**，普通通知可删除；首页顶栏铃铛加未读红点（>9 显示 `9+`）。通知数据统一走新增的 `src/hooks/useNotifications.ts` + `src/data/notifications.ts`（`NotificationType` = `system` 不可删 / `notice` 可删）。③ 设置页「账号安全」弹层底部新增「忘记密码 / 忘记登录账号？**点击申请**」区块，打开新增的共享组件 `src/components/PasswordResetSheet.tsx`（账号 + 工作单位 → 提交 → 显示「管理员已收到你的重置申请」并提示留意通知中心）；**登录页也加了同一入口**（忘记密码的人往往还没登录）。④ 管理后台新增两个 Tab：**密码重置**（工单列表 + 处理/拒绝/删除，处理时可选新密码或系统随机生成，并自动发一条含新密码的**系统通知**给考生）与**通知管理**（发给全部考生或指定账号、类型由管理员设置、已发送记录）；顶栏提示与 Tab 角标同时统计待审核注册与待处理工单；统计卡新增「待处理密码重置」。校验：`npx tsc --noEmit` 无错误、`npm run build` 通过（44 modules），产物 CSS 含 48 处深色选择器且含 `[data-theme=dark] .glass-panel` 规则，`dashboard.js` / `api.js` 语法检查通过。 |
| 2026-09-29 | **设置页重做 + 深色模式落地**：① 账号区只留「账号安全」（删掉原「账号与资料」「资料摘要」两行，摘要改为只读单行展示）——点开弹层内分「修改密码 / 修改登录账号」两个 Tab，改密码需原密码、成功后后端踢会话并回登录页，改账号需登录密码、成功后刷新本地缓存；两处都写明「忘记原密码 / 忘记账号 → 请联系管理员在后台处理」。② 通用区新增「检查更新」：比对 `src/data/appVersion.ts` 的 APP_VERSION 与 `GET /api/app/version`（服务端 `data/version.json`），有新版显示版本号 + 更新说明 +「前往更新」。③ 外观三种模式**全部生效**（原浅色/深色/跟随系统仅浅色可用）：新增 `src/theme.ts`（`ndt_theme` 持久化 + `prefers-color-scheme` 监听）、`main.tsx` 渲染前 `initTheme()`、`index.css` 末尾 `[data-theme='dark']` 段（覆盖全部令牌 + body 光影 + `.card`/`.nav-liquid`/`.gb-*` + 登录引导页 slate 工具类重映射）。④ 全站硬编码颜色清理：新增 11 个语义面令牌（`--surface-raised`/`--track`/`--chip-bg`/`--accent-fill`…），把 60 余处内联 hex / rgba 白全部换成令牌；`ProgressRing` 轨道改用 `style.color + stroke="currentColor"`（SVG 属性不吃 `var()`）。`client.ts` 新增 `securityApi`（改密码 / 改账号）与 `appApi.version()`；`icons.tsx` 36→38（`LogoutIcon`/`TrashIcon`）。校验：`npx tsc --noEmit` 无错误、`npm run build` 通过、产物 CSS 含 46 处深色选择器。 |
| 2026-09-29 | **新增设置页 `SettingsScreen`**：占位页改为完整实现，含 5 个功能——① 账号：展示身份/账号/单位/资料摘要，点击回「我的」页编辑；② 外观：浅色/深色/跟随系统三选（深色与跟随系统标「敬请期待」，仅浅色可用，选择存 `ndt_appearance`）；③ 通知：学习提醒/错题复习提醒开关，本地存 `ndt_notify_*`（推送后端未接入）；④ 清除缓存：统计并清除非登录态的 localStorage（保留 `ndt_token`/`ndt_identity`/`ndt_profile`），底部弹层确认 + Toast；⑤ 退出登录：底部弹层确认 → `POST /api/auth/logout`（失败不阻断）→ `clearSession()` → 回登录页。`icons.tsx` 新增 `LogoutIcon`/`TrashIcon`（36→38），`App.tsx` settings 分支改挂 `SettingsScreen` 并移除无用的 `GearIcon` 导入。 |
| 2026-09-29 | **修复编辑资料面板被底部导航遮挡**：`ProfileScreen` 编辑面板与 `BottomNav` 同为 `z-50`，导航在 DOM 靠后同层级时盖在面板上。编辑面板提升为 `z-[60]`、Toast 提升为 `z-[70]`。 |
| 2026-09-29 | **「我的」页头像与昵称（接真实后端）**：登录成功 → `main(home)` 的链路已通，本次让「我的」页展示**真实昵称与头像**并支持修改。新增 `src/hooks/useProfile.ts`（本地缓存秒显 + 后端拉取覆盖 + `update()`）、`src/components/Avatar.tsx`（预设 emoji / 上传图片 / 昵称首字 三级兜底）、`src/data/avatars.ts`（12 个预设头像 + 解析工具）。`ProfileScreen` 头像区改为真实数据 + 铅笔打开行内编辑面板（昵称输入、12 预设网格、本地上传经 canvas 居中裁剪压到 256×256），保存写 `PUT /api/user/profile` 并同步本地缓存；顶部补「账号 / 单位学校」信息行（无报考方向时显示「未设置报考方向」）。`HomeScreen` 顶栏问候改用同一份真实昵称与头像（原为硬编码「张」+ `userStats.name`）。`client.ts` 新增 `profileApi` 与 `patchSavedProfile`，`SessionProfile` 增加 `avatar`。`icons.tsx` 新增 `CameraIcon`（图标 35→36）。`index.css` 补 `--line-strong` 令牌。后端同步新增 `GET/PUT /api/user/profile`、`profile_defaults.py`（随机昵称/头像）与一次性历史账号补齐。校验：`npx tsc --noEmit` 无错误、`npm run build` 通过（37 modules）。 |
| 2026-09-29 | **修复《服务协议》/《隐私政策》页无法上下滑动**：`LegalScreen.tsx` 根元素原为 `app-shell + min-h-screen + flex-col`，滚动区缩在内层当 `flex-1`，高度算不出剩余空间、被 `.app-shell` 的 `overflow:hidden` 裁掉 → 正文看不全也滑不动。已改为与其它整屏页面一致的**唯一 `.scroll-area` 根容器**（顶栏 + 正文都放在内部随页滚动）。§11 新增「页面滚动结构约定」写明正确/错误写法。校验：`npx tsc --noEmit` 无错误、`npm run build` 通过（34 modules）。 |
| 2026-09-29 | **登录页改为「账号登录 + 注册」（注册审核制）**：手机号 + 短信验证码登录**下线**（去掉验证码 Tab、倒计时、`dev_code` 提示、微信/Apple 快捷登录）。新增「注册」Tab：账号 / 密码 / 确认密码 / 单位学校 + **图形验证码**（点击图片刷新），提交后提示等待管理员审核并切回账号登录。`src/api/client.ts` 移除短信接口（`sendCode`/`phoneLogin`/`smsMode`），新增 `captcha()` 与 `register()`，`SessionProfile` 的 `phone` 改为 `account` + `org`。`src/data/legal.ts` 同步改写：协议「账号开通方式」改为注册申请+审核，隐私政策「收集哪些信息」改为账号/密码/单位学校（**不收集手机号**），原「短信验证码与第三方服务」一节改为「图形验证码与第三方服务」。校验：`npx tsc --noEmit` 无错误、`npm run build` 通过（34 modules）。 |
| 2026-09-29 | **登录接真实后端 + 新增协议页**：新增 `src/api/client.ts`（接口唯一出口、令牌存取、中文错误）；`LoginScreen` 由 Mock（写死 123456 / admin123）改为调真实接口，支持本地调试模式直接显示验证码；`App.tsx` 新增 `legal` 视图；新增 `LegalScreen.tsx` + `data/legal.ts`（《服务协议》《隐私政策》全文，登录页勾选框可点开）；`vite.config.ts` 增加 `/api` → :8000 代理；新增 §14 API 依赖。校验：`npx tsc --noEmit` 无错误、`npm run build` 通过（34 modules）。 |
| 2026-09-29 | **文档合并 + 死代码清理**：前端文档合并为本文档一份（原 `.modular/frontend.md`、`architecture.md`、`ui-brief.md`、`AGENTS.md`、`CLAUDE.md` 已删除）。删除零引用死代码：`components/Button.tsx`、`components/GlassCard.tsx`、`ProgressRing.tsx` 的 `MiniRing`、icons 的 `LayersIcon`/`SendIcon`/`XCircleIcon`、`mockData.ts` 的 `getCategoryById`、`types.ts` 的 `AppState` 死簇。新增 §0 定位流程、§10 UI 设计规范、§13 禁止操作。 |
| 2026-09-29 | 通读全部源码整理生成 `FRONTEND.md`：补全视图状态机路由地图、Tab 地图、回调接口表、组件/图标/按钮/素材/数据字段索引、设计令牌表、修改定位表；登记 9 项可清理项（当时未删除）。 |
| 2026-09-29 | 引导页步骤 1 改插画叙事风（6 方法场景插画 + 技师插画，选中高亮）；登录页底部加注册说明小字；品牌图标改 SVG 混合方案。 |
| 2026-09-29 | 新增登录/注册页界面，App 流程改为 引导 → 登录 → 主界面；底部导航改液态玻璃胶囊；全局转暖米摄影感背景；主操作按钮统一 Material You 通透卡片。 |
| 2026-09-29 | 全 App 由深色玻璃拟态重构为苹果式浅色极简（删除旧 WaveformBg 装饰）。 |
