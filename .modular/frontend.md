# Frontend（前端总地图）

> 开发中实时更新。改前端先读本文件定位，禁止全量扫描。

## 1. 前端概述
- 框架：React 19 + TypeScript + Vite 8 + Tailwind CSS v4
- 状态：App.tsx 内 `view` 状态机 + `activeTab`；页面内局部 useState
- 路由：无路由库；Tab 切换渲染对应 Screen
- 设计令牌：`src/index.css`（颜色/阴影/圆角/动画类）
- 图标：`src/components/icons.tsx`（极简线性图标，stroke 1.6-1.8）

## 2. 页面地图
| 页面 | 路径 | 说明 |
| ---- | ---- | ---- |
| 引导 Onboarding | src/screens/OnboardingScreen.tsx | 3 步：logo 介绍 / 选检测方向 / 选学习目标；本页专用配色：奶油米白 #F6F4EE 背景 + 薄荷青 #3BB4A2 品牌 + slate-900/500 文字（不改全局令牌） |
| 登录注册 Login | src/screens/LoginScreen.tsx | 品牌头 + Slogan + 毛玻璃卡片（验证码登录 / 账号登录双模式）+ 快捷登录 + 隐私勾选；演示账号 admin / admin123；成功回调 onSuccess 进主界面 |
| 首页 Home | src/screens/HomeScreen.tsx | 问候、今日进度环、快捷入口、统计卡、周趋势、推荐训练、最近错题、成就 |
| 题库分类 QuestionBank | src/screens/QuestionBankScreen.tsx | 搜索、分类 Tab、检测方法卡片、训练集列表、筛选面板 |
| 答题 Practice | src/screens/PracticeScreen.tsx | 题目卡片、选项卡片（对/错状态）、解析面板、退出弹窗 |
| 练习结果 PracticeResult | src/screens/PracticeResultScreen.tsx | 正确率环、统计网格、经验、操作按钮 |
| 错题本 WrongQuestions | src/screens/WrongQuestionsScreen.tsx | 统计行、筛选 Tab、错题卡片展开（历史/答案/解析） |
| 学习报告 Learning | src/screens/LearningScreen.tsx | 汇总数字卡、学习日历热力、知识掌握条、学习建议、周目标 |
| 个人中心 Profile | src/screens/ProfileScreen.tsx | 头像、等级、经验条、统计、成就预览、菜单列表 |
| 占位页（考试设置/搜索/通知/成就/设置） | src/App.tsx | ExamSetupStub / PlaceholderScreen |

## 3. 组件索引
| 组件 | 路径 | 用途 | 使用方 |
| ---- | ---- | ---- | ---- |
| BottomNav | src/components/BottomNav.tsx | 底部 5 Tab 导航 | App |
| Button / IconButton | src/components/Button.tsx | 通用按钮 | 各页面 |
| GlassCard / GradientCard | src/components/GlassCard.tsx | 卡片容器（现为浅色卡片） | Home/QuestionBank/Wrong/Learning/Profile |
| ProgressRing / MiniRing | src/components/ProgressRing.tsx | 环形进度 | Home/PracticeResult |
| icons（约 20 个线性图标） | src/components/icons.tsx | 图标复用 | 各页面 |
| ~~WaveformBg~~ | 已删除 | 旧装饰波形背景 | — |

## 4. 关键按钮索引
| 按钮 | 页面 | 行为 |
| ---- | ---- | ---- |
| 底部 Tab（首页/题库/错题/学习/我的） | App → BottomNav | 切换 activeTab |
| 开始练习/继续学习 | Home 快捷入口 | onNavigate / onStartPractice |
| 搜索 / 通知 | Home 顶栏 | onNavigate('search' / 'notifications') |
| 分类卡片 / 训练集 | QuestionBank | onStartPractice(category) |
| 选项卡片 | Practice | 选中判对错 → 显示解析 |
| 下一题 / 查看结果 | Practice | 推进 or onComplete |
| 再练/复习错题/返回首页 | PracticeResult | onRetry / onReviewWrong / onHome |
| 开始练习 | Onboarding | onComplete(方向, 目标) → 进入登录页 |
| 登录/注册提交 | Login | 校验后 onSuccess → 主界面 |
| 模式切换（验证码/账号） | Login | 切换表单字段 |
| 获取验证码 | Login | Mock 发送（演示码 123456）+ 60s 倒计时 |
| 微信 / Apple 快捷登录 | Login | Toast「暂未接入」 |

## 5. 图片/素材索引
无外部图片；图标全部为内联 SVG。微信 / Apple 品牌图标为 LoginScreen 内本地定义（不放入 icons.tsx，避免破坏线性图标风格统一）。

## 6. 数据字段索引（前端使用）
| 字段 | 类型 | 来源 | 使用页面 |
| ---- | ---- | ---- | ---- |
| userStats.* | object | mockData.ts | Home / Learning / Profile |
| categories[].gradient/color | string[] | mockData.ts | QuestionBank / Wrong（注意：新版已改为低饱和映射，见 backend.md） |
| trainingSets / achievements / wrongRecords | array | mockData.ts | Home / QuestionBank / Wrong / Profile |
| questions[].{text,options,correct,explanation} | array | mockData.ts | Practice / Wrong |

## 7. 修改定位表
| 需求关键词 | 定位 |
| ---- | ---- |
| 颜色/背景/阴影/圆角/字体 | index.css 令牌 + 各 Screen 内联样式 |
| 图标 | components/icons.tsx |
| 底部导航 | components/BottomNav.tsx |
| 首页布局 | screens/HomeScreen.tsx |
| 答题对错样式 | screens/PracticeScreen.tsx |
| 统计图表 | screens/LearningScreen.tsx / HomeScreen.tsx |

## 8. 变更历史
| 日期 | 变更 | 模块 |
| ---- | ---- | ---- |
| 2026-09-29 | 引导页 UI 重构（仅本页）：奶油米白 #F6F4EE 背景 + 薄荷青 #3BB4A2 品牌色 + slate 文字；步骤 0 改为垂直 3 张白底大圆角功能卡（青绿图标+标题+说明）、胶囊主按钮（同色弥散阴影）+ 跳过；步骤 1/2 白卡片、青绿选中态、底部胶囊 CTA 同风格统一；步骤逻辑与数据结构不变 | OnboardingScreen |
| 2026-09-29 | 新增登录注册页（阶段一界面）：slate-50 渐变浅灰底 + 毛玻璃卡片，薄荷绿发光 Logo，M3 输入框（获焦双色边框），青绿渐变主按钮（hover:opacity-90），微信/Apple 快捷登录，隐私协议勾选；双模式（验证码登录 / 账号登录），演示账号 admin / admin123 Mock 校验；App 流程改为 引导→登录→主界面 | LoginScreen / App.tsx |
| 2026-09-29 | 全 App 深色玻璃拟态 → 苹果式浅色极简重构（背景/文字/辅助色/卡片/图标/图表全面替换，删除 WaveformBg 装饰） | 全部前端 |
| 2026-09-29 | 底部导航栏改为透明液态玻璃（Liquid Glass）：半透明白 + backdrop blur + 玻璃高光边缘 + 克制的光泽漂移动画（index.css `.nav-liquid` / `.glass-nav` 升级） | BottomNav / index.css |
| 2026-09-29 | 磨砂玻璃质感升级：body 柔和渐变背景（左下低饱和绿→右上暖琥珀金）+ 六边形极淡纹理；卡片全面磨砂玻璃化（`.card`/`.glass*`/`.glass-panel`）；英雄卡内部柔光 `.glass-glow`；进度环渐变+冷光 `.ring-glow`；首页数据改三块凸起子面板（正确/正确率/学习时长带图标）；连续打卡火焰精细版+轻闪烁；导航激活图标轻浮起+微阴影 | 全部前端 / HomeScreen / index.css |
| 2026-09-29 | 导航栏完善为悬浮胶囊形玻璃导航舱：居中收窄胶囊（圆角34px）+ 磨砂半透明 + 内部辉光（`.nav-liquid::before` 冷白-淡绿径向光晕）+ 图标瓷片 subtle 3D 浮雕（内高光+微投影，激活轻浮起/主色）+ 标签深色高可读 | BottomNav / index.css |
| 2026-09-29 | 玻璃按钮系统升级（三层光影）：`.gb/.gb-pill` 基底（左上 inset 高光反光 + 右下 inset 内暗/外阴影厚度 + 上亮下暗渐变过渡 + 斜向反光纹路与磨砂噪点纹理 + 柔和圆角 13/15/18/999px + 按压下压）；变体底色半透明呼应背景（`gb-primary` 半透蓝绿/`gb-danger` 半透红/`gb-success` 半透绿/`gb-secondary`/`gb-ghost` 半透白）；Button.tsx 全套切换 gb 类；答题选项 `.answer-card` 加玻璃高光；各页内联按钮（答题页提交/退出弹窗、结果页三钮、题库 tab pills/筛选弹窗/清除搜索、错题本筛选与操作、学习页练习钮、Onboarding/考试设置选中卡、首页铃铛/搜索/连续徽章/头像）统一玻璃化 | index.css / Button.tsx / 全部 screens / App.tsx |
| 2026-09-29 | 全局背景改为暖米摄影感：body 暖米色渐变（`linear-gradient(160deg,#F8F3E8→#F4EFE3→#F0E9DB)` + 左下极淡绿/右上暖光晕）；移除六边形几何纹理，`body::before` 改为多层光影（3 条斜向丁达尔暖光光束 118°/98°/128° + 顶部天光漫射 + 4 个弥散柔光光斑 + 底部浅景深暗角），全部纯 CSS 渐变、极淡低饱和、无任何图形文字 | index.css |
| 2026-09-29 | 答题页"下一题/查看结果"按钮改为 iOS 式毛玻璃浮动卡片：淡灰近白背景 `rgba(241,245,249,0.80)` + `backdrop-filter blur(20px) saturate(160%)` 强模糊、细浅灰边框 `rgba(226,232,240,0.5)`、极淡阴影、文字与箭头改品牌青绿 `#21B192`（非白字）、保持 52px 圆角与按压微反馈；功能与页面其余不变 | PracticeScreen |
| 2026-09-29 | 主操作按钮统一 Material You 通透卡片（`gb-primary` 重定义）：米灰底 `rgba(226,232,240,0.85)` + blur(20px) 通透 + 细浅灰描边 + **内阴影下凹感**（inset 上沿暗 + 下沿亮边）+ 极淡外阴影 + 胶囊圆角 999px + 文字/图标品牌青绿 `#10B981`（原墨绿渐变白字全部移除）；覆盖按钮：下一题/查看结果（内联同步）、再次练习、应用筛选、开始考试、立即训练、开始练习、Onboarding CTA（Button 组件自动）；各主按钮硬编码白图标同步改 `#10B981`；修复 PracticeScreen 最后一题正确数重复计数导致正确率 >100% 的 off-by-one bug | index.css / Button.tsx / PracticeScreen / PracticeResultScreen / LearningScreen / App.tsx / QuestionBankScreen / WrongQuestionsScreen |
