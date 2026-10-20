# 开发规矩（NDT-劳人刷题 App）

> 配合项目根 **`FRONTEND.md`** 使用 —— 那份是唯一的前端代码地图（AI 定位用）。
> 本文件只规定「怎么改、怎么验收」。

## 1. 技术栈

**前端**
- React 19 + TypeScript 5.7 + Vite 8 + Tailwind CSS v4（`@tailwindcss/vite` 插件，**无 config 文件**）
- 入口：`src/main.tsx` → `src/App.tsx`；全局样式 `src/index.css`（Tailwind v4 主题定制放这里）
- 无路由库，App 内用 `view` 状态机切换页面；底部 5 个 Tab 由 `activeTab` 控制
- 目录沿用 `src/screens/`（页面）+ `src/components/`（组件），按「一个 Screen = 一个模块」对应
- 接口调用统一走 `src/api/client.ts`，**禁止在页面里直接写 fetch**

**后端（server/）**
- Python 3.10+ / FastAPI + Uvicorn + SQLite（无 ORM，标准库 `sqlite3`）
- 业务按功能拆成 `server/modules/*.py`，一个功能一个文件，互相独立
- 前端开发时由 Vite 把 `/api` 代理到 `http://127.0.0.1:8000`
- 可视化管理后台由 Python 服务直接托管（`server/static/`，纯静态无需构建）

## 2. 常用命令（⚠️ 依赖用 pnpm · hoisted 布局；脚本命令 npm/pnpm 均可）

**前端**
```bash
pnpm install      # 装依赖（按 pnpm-lock.yaml，hoisted 扁平复制布局）
pnpm add <pkg>    # 加依赖
npm run dev       # 开发服务器（端口 8443）
npm run build     # 生产构建 —— 交付前必须通过
npx tsc --noEmit  # 类型检查（build 不做完整类型校验，改完 TS 建议跑一次）
npm run preview   # 预览构建产物
npm run format    # oxfmt 格式化
```

**后端**
```bash
# 一键：双击 server/启动服务.bat（自动建 venv / 装依赖 / 起服务 / 开后台）

# 手动
cd server
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy config.example.json config.json     # 填腾讯云凭证（不填则走本地调试模式）
.venv\Scripts\python main.py
```

- 管理后台：http://127.0.0.1:8000/admin/ ；接口文档：http://127.0.0.1:8000/docs
- Windows 双击根目录 `启动App.bat` 启动前端
- ⚠️ **依赖管理以 pnpm 为准**（`pnpm-lock.yaml` 是唯一锁文件）。v1.86 起 `nodeLinker: hoisted`
  固定在**根目录 `pnpm-workspace.yaml`** —— ⚠️ pnpm v10+ 已不从 `.npmrc` 读 `node-linker`，
  只写 `.npmrc` 会静默回退到 isolated symlink 布局，而本机会删 symlink → `node_modules` 残破
  （v1.86 就踩过：`pnpm add` 之后 react / vite 全部消失，只能删掉 `node_modules` 重装）。
  若发现根 `node_modules` 缺包但 `.pnpm` 里有：删 `node_modules` → `pnpm install` 重建
- ⚠️ pip 装依赖若镜像失败，加 `-i https://pypi.org/simple` 走官方源

## 3. 修改流程（两阶段，顺序不可颠倒）

```text
用户需求（一次性给完整需求）
  ↓
──── 阶段一：界面设计 ────
  读 FRONTEND.md §12 定位 → 设计全部界面（含基础点击/导航/Mock 数据）
  → 实时更新 FRONTEND.md §3/§5/§7 → 验证可运行可点击无报错
  ↓
── 等待用户确认 UI 后才进阶段二 ──
  ↓
──── 阶段二：逻辑代码 ────
  每个功能独立实现（增删查改各自独立）→ 实时更新 FRONTEND.md / backend.md
  → 验证 build 通过 → 文档收尾 → 说明变更
```

- **最小上下文**：只读 `FRONTEND.md` 指到的那 1 个文件，**禁止全量扫描项目**
- **模块独立可改**：页面之间只通过 `App.tsx` 的回调接口通信，禁止跨页面直接 import
- **改一个模块不能拖垮别的模块**
- **实时登记文档**：每加页面/按钮/图标/数据字段立刻记进 `FRONTEND.md`，不是最后补

## 4. 设计规范

详见 **`FRONTEND.md` §10「UI 设计规范」**（含 §11 设计令牌）。核心：苹果式浅色极简。

**禁止**：高饱和亮色、大面积渐变、3D、复杂插画、夸张动效、厚重阴影、游戏化过重界面。

## 5. 质量底线

- 交付前必须 `npm run build` 通过，且开发服务器可访问
- 禁止交付报错代码；验证失败必须修复到通过，或明确报告未通过项
- 中文备注：模块顶部说明职责与修改注意点
- 共享令牌改动只动 `index.css`；新增图标先查 `icons.tsx` 是否已有
- **改后端接口后，前端必须跑一次 `npx tsc --noEmit`**（`npm run build` 不做完整类型校验）
- **跨端一致的常量要同步改三处**：账号规则 `^[A-Za-z0-9_]{4,20}$` 与报考方向 `UT/RT/MT/PT/ET/VT/综合` 分别存在于
  `src/screens/LoginScreen.tsx`、`server/modules/registrations.py`、`server/modules/user_accounts.py`（方向另见 `src/types.ts` 的 `NDTMethod`）
- **改登录/注册方式时**：协议正文 `src/data/legal.ts` 里写了具体收集字段，必须同步更新，否则隐私政策与实际不符

## 6. 文档约定

| 文档 | 定位 |
| ---- | ---- |
| 项目根 `FRONTEND.md` | **唯一的前端代码地图**（页面/组件/按钮/图标/素材/数据字段/设计规范/令牌/修改定位表/API 依赖） |
| `.modular/backend.md` | **后端地图**（目录/Python 模块/API 路由/数据表/错误码/安全设计/短信对接/修改定位表） |
| `.modular/rules.md` | 本文件：开发规矩 / 命令 / 流程 |

> 不要新建平行的文档 —— 改前端往 `FRONTEND.md` 补，改后端往 `backend.md` 补，避免多头维护、互相打架。

## 7. 安全红线（后端）

- `server/config.json` 含腾讯云密钥，已在 `.gitignore` 中：**禁止提交、禁止写进前端代码、禁止打印到日志**
- 密码只存 PBKDF2 哈希；任何接口都不得返回 `password_hash`
- 所有 `/api/admin/**` 必须挂 `get_current_admin` 依赖
- 删除类操作前确认影响面；破坏性变更（删表、清数据）先问用户
