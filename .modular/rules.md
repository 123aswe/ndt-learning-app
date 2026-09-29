# 项目开发规则（NDT-劳人刷题 App）

## 技术栈
- React 19 + TypeScript + Vite 8 + Tailwind CSS v4（`@tailwindcss/vite` 插件，无 config 文件）
- 包管理器：pnpm（lockfile 由 pnpm 生成；本机 Node 20 时用 `npx pnpm@9.15.11`）
- 入口：`src/main.tsx` → `src/App.tsx`；全局样式 `src/index.css`（Tailwind v4 主题定制放这里）
- 无路由库，App 内用 `view` 状态机切换页面；底部 5 个 Tab 由 `activeTab` 控制

## 常用命令
- 开发：`pnpm dev`（端口 8443）
- 构建：`pnpm build`（`vite build`，含 TypeScript 编译校验）
- 预览：`pnpm preview`
- 格式化：`pnpm format`

## 设计规范（用户指定，优先级最高）
详见 `.modular/ui-brief.md`：苹果式浅色极简（纯白/浅米白/浅灰蓝背景、深炭黑主文字、低饱和蓝绿主色、留白充足、轻阴影、柔和圆角、极简线性图标、极简图表）。
**禁止**：高饱和亮色、大面积渐变、3D、复杂插画、夸张动效、厚重阴影、游戏化过重界面。

## 模块与最小上下文
- 所有 UI 组件在 `src/components/`，页面在 `src/screens/`，Mock 数据在 `src/data/mockData.ts`
- 改前端先读 `.modular/frontend.md` 定位，改数据/类型先读 `.modular/backend.md`，禁止全量扫描
- 改一个页面/组件不影响其他模块；共享设计令牌集中在 `index.css` 与 `src/components/icons.tsx`

## 质量底线
- 交付前必须 `pnpm build` 通过且开发服务器可访问
- 中文备注：模块顶部说明职责与修改注意点
