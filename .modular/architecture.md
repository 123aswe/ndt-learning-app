# 架构总览（NDT-劳人刷题 App）

## 应用形态
- 移动端优先的刷题应用（`app-shell` 最大宽 430px 居中），单页 React，无路由库
- App.tsx 用 `view` 状态机控制：`onboarding / main(tab) / practice / practice-result / exam-setup / search / notifications / achievements / settings`

## 目录结构
```
src/
  main.tsx            入口（挂载 App，引入 index.css）
  App.tsx             视图状态机 + Tab 布局 + 占位页（ExamSetupStub / PlaceholderScreen）
  index.css           全局设计令牌（颜色/阴影/圆角/动画）+ Tailwind v4 主题
  types.ts            领域类型（Question/Category/Achievement/TrainingSet/WrongRecord/...）
  data/mockData.ts    Mock 题库、分类、错题、用户统计
  components/
    BottomNav.tsx     底部 Tab 导航（5 个 Tab）
    Button.tsx        通用按钮 + IconButton
    GlassCard.tsx     卡片容器（GlassCard / GradientCard）
    ProgressRing.tsx  环形进度（ProgressRing / MiniRing）
    icons.tsx         极简线性图标库（stroke 统一，供各页面复用）
  screens/
    OnboardingScreen.tsx       引导（logo/选择方向/选择目标）
    HomeScreen.tsx             首页（进度卡片/快捷入口/趋势/训练/错题/成就）
    QuestionBankScreen.tsx     题库分类（搜索/分类 Tab/分类卡片/训练集/筛选面板）
    PracticeScreen.tsx         答题页（题目/选项/解析/退出弹窗）
    PracticeResultScreen.tsx   练习结果（正确率环/统计/操作）
    WrongQuestionsScreen.tsx   错题本（统计/筛选/错题卡片展开详情）
    LearningScreen.tsx         学习报告（汇总/日历热力/知识掌握/建议/目标）
    ProfileScreen.tsx          个人中心（头像/等级/统计/成就/菜单）
```

## 数据流
- 纯前端 Mock：`mockData.ts` 导出 questions / categories / trainingSets / achievements / wrongRecords / userStats
- 页面之间通过 props 回调通信（onNavigate / onStartPractice / onComplete）
- 无后端、无 API、无持久化（练习结果直接由 App 状态机承接）

## 设计令牌（集中在 index.css）
- 背景：`#F3F4F6`（浅灰蓝）/ 卡片：`#FFFFFF` / 浅米白辅助面：`#FAF9F6`
- 文字：主 `#1B1E23`（深炭黑）次 `#5F6670`（中灰）弱 `#9AA1A9`
- 主色：`#5F8D8C`（低饱和蓝绿）；正确：`#6FA37C`（低饱和绿）；错误：`#C17B7B`（低饱和红）
- 分隔：`#E6E8EB`；阴影：`0 1px 2px rgba(27,30,35,0.04), 0 4px 16px rgba(27,30,35,0.05)`

## 修改注意事项
- 共享令牌改动只动 `index.css`；新增图标先查 `icons.tsx` 是否已有
- 保持「结构不动、只改风格」：页面顺序、功能入口、交互逻辑一律不改
