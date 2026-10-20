"""
服务入口 —— 启动方式：

    python main.py
    # 或
    uvicorn main:app --host 127.0.0.1 --port 8000 --reload

配套：
  - 接口文档：http://127.0.0.1:8000/docs
  - 可视化管理后台：http://127.0.0.1:8000/admin/
  - 首次启动会自动建库并创建默认超级管理员 admin / admin123（请尽快改密码）

修改注意：
  - 新增业务模块 → 在下面「注册路由」处 include 进来，一个模块一行
  - 端口 / 数据库路径 / 允许的前端来源都在 config.json 里改，不要写死在本文件
"""

from contextlib import asynccontextmanager

import asyncio

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from config import BASE_DIR, DB_PATH, config, sms_mode
from database import init_db
from modules import (
    achievements,
    admin_accounts,
    ai,
    app_update,
    auth,
    bank,
    captcha,
    exam,
    materials,
    music,
    network,
    notifications,
    overview,
    password_resets,
    practice,
    question_images,
    question_reports,
    question_series,
    question_sets,
    realtime,
    registrations,
    sms,
    themes,
    user_accounts,
    user_profile,
    user_security,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """启动时建表 + 首次创建默认超管 + 首次导入题库，并把关键信息打到控制台。"""
    banner = init_db()
    bank_banner = bank.ensure_bank_imported()
    banner = f"{banner}；{bank_banner}"
    # 资料库里 doc/ppt/pptx 要在考生端在线翻阅，需先转成 PDF（modules/office_view.py）。
    # 这里只是把没转过的排进后台队列，真正的转换在后台线程里跑，不阻塞启动。
    office_pending = materials.ensure_office_converted()
    # 实时通道：记下当前事件循环，之后线程池里的同步路由才能把事件投递进来
    realtime.bind_loop()
    # 版本发布监听：每 10 秒看一眼 version.json，变了就推给所有在线考生
    update_watcher = asyncio.create_task(app_update.watch_version_file())
    mode = sms_mode()
    host, port = config["server"]["host"], config["server"]["port"]
    # 监听 0.0.0.0 时控制台打印用 127.0.0.1 才能点开；局域网地址看「网络访问」卡片
    display_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    print("=" * 62)
    print("  NDT-劳人刷题 App · Python 服务已启动")
    print(f"  {banner}")
    print(f"  数据库：{DB_PATH}")
    print(f"  短信模式：{'腾讯云真发' if mode == 'tencent' else '本地调试（未配置腾讯云凭证）'}")
    if mode != "tencent":
        print("  ⚠️  本地调试模式：短信不参与登录/注册（已改用图形验证码），腾讯云凭证未配置")
    print(f"  实时通道：{'已启用（SSE，通知/评论回复/版本更新秒达）' if realtime.enabled() else '已关闭（前端退回 30 秒轮询）'}")
    if office_pending:
        print(f"  资料预览：{office_pending} 份 Office 文档正在后台转 PDF（转好考生端即可在线翻阅）")
    if network.lan_enabled():
        lan_ip = network.lan_ip()
        if lan_ip:
            print(f"  局域网访问：已开启 → http://{lan_ip}:{port}/app/")
        else:
            print("  局域网访问：已开启（未探测到局域网 IP）")
    else:
        print("  局域网访问：已关闭（管理后台「网络访问」卡片可开启）")
    print(f"  管理后台：http://{display_host}:{port}/admin/")
    print(f"  接口文档：http://{display_host}:{port}/docs")
    print("=" * 62)
    yield
    update_watcher.cancel()


app = FastAPI(
    title="NDT-劳人刷题 App 服务",
    description="注册申请与审核 / 登录认证 / 图形验证码 / 考生个人资料与账号安全 / 管理员与考生账号管理（增删查改）/ 通知中心 / 密码重置工单 / 版本更新 / 题库与练习统计 / 资料库 / 音乐 / 主题商店",
    version="1.5.0",
    lifespan=lifespan,
)

# ── 跨域：允许在 config.frontend_origins 里列出的前端地址调用 ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=config["frontend_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store_for_api(request: Request, call_next):
    """接口响应一律禁缓存。

    为什么必须显式加：SQLite 查询的响应体很小、又没有任何 Cache-Control，
    手机浏览器（尤其微信内置浏览器）会按「启发式缓存」自行决定缓存时长，
    之后每次打开同一页就先用旧数据渲染、再重发一次请求重新验证——
    表现就是「没下拉，页面却一直在刷新」。

    加 no-store 后：每次页面读取都是真实请求，配合前端「只有页面在顶部时
    下拉才刷新」的策略，普通上下滑动不会再引发任何请求。
    """
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.middleware("http")
async def lan_guard(request: Request, call_next):
    """局域网访问守卫：开关关闭时只放行本机来源，其余一律 403。

    为什么需要：服务监听 0.0.0.0（局域网直连的前提），「谁能访问」改由这里控制。
    开关默认关闭 → 行为与旧版「只监听 127.0.0.1」完全一致，现有用法零影响。
    公网隧道不受影响：cloudflared 从本机 127.0.0.1 连入，is_local_client 判为本机。
    开关入口在管理后台「网络访问」卡片（modules/network.py，状态持久化 config.json）。
    """
    client = request.client
    if not network.lan_allowed(client.host if client else None):
        return JSONResponse(
            {"detail": "局域网访问未开启：请在管理后台「网络访问」中开启，或从本机访问"},
            status_code=403,
        )
    return await call_next(request)

# ── 注册路由（一个业务模块一行） ────────────────────────────
app.include_router(auth.router)
app.include_router(captcha.router)
app.include_router(registrations.router)
app.include_router(password_resets.router)       # 考生端：提交重置申请（公开）
app.include_router(user_profile.router)
app.include_router(user_security.router)
app.include_router(realtime.router)              # 考生端：实时事件流（SSE，通知/版本/踢会话秒达）
app.include_router(notifications.router)         # 考生端：通知中心
app.include_router(admin_accounts.router)
app.include_router(user_accounts.router)
app.include_router(notifications.admin_router)   # 管理端：发送通知 / 已发送记录
app.include_router(password_resets.admin_router)  # 管理端：密码重置工单
app.include_router(app_update.router)
app.include_router(app_update.admin_router)      # 管理端：发布新版本（写 version.json + 实时推送）
app.include_router(overview.router)
app.include_router(network.router)               # 管理端：网络访问（局域网开关 + 公网隧道一键启停）
app.include_router(network.public_router)        # 小程序端：当前可用访问地址（公开，自动跟随后台卡片）
app.include_router(sms.router)
app.include_router(bank.router)                   # 题库概览（考生只读）
app.include_router(bank.admin_router)             # 管理端：内置题库恢复官方基线
app.include_router(question_sets.router)          # 自定义题库（考生端读列表）
app.include_router(question_sets.admin_router)    # 管理端：题库管理（增删查改 + 导入）
app.include_router(question_series.router)        # 题库系列（考生端：题库页系列卡）
app.include_router(question_series.admin_router)  # 管理端：题库系列（分组 + 封面 + 排序）
app.include_router(question_images.router)        # 题目插图（考生端取图，?token= 传令牌）
app.include_router(question_images.admin_router)  # 管理端：题目插图上传 / 预览
app.include_router(question_reports.router)       # 考生端：题目纠错上报
app.include_router(question_reports.admin_router)  # 管理端：纠错工单处理
app.include_router(practice.router)               # 练习出题 / 交卷
app.include_router(practice.user_router)          # 学习统计 / 错题本
app.include_router(achievements.router)           # 成就勋章（目录 / 解锁进度）
app.include_router(exam.router)                   # 模拟考试（开卷 / 交卷 / 试卷回看）
app.include_router(materials.router)              # 资料库（考生端：标准/教材/资料/视频列表与文件）
app.include_router(materials.admin_router)        # 管理端：资料库上传 / 增删查改 / 封面
app.include_router(materials.admin_comment_router)  # 管理端：视频评论管理
app.include_router(music.router)                  # 音乐（考生端：列表 / 音频流 / 封面 / 播放量）
app.include_router(music.admin_router)            # 管理端：音乐上传 / 增删查改 / 封面 / 排序
app.include_router(themes.router)                 # 主题商店（考生端：列表 / 预览图 / 背景图，公开）
app.include_router(themes.admin_router)           # 管理端：主题上传 / 增删查改 / 排序
app.include_router(ai.router)                     # AI 智能助手（题目 AI 解析 / 视频 AI 概括，SSE 流式）


# ── 官网（项目根目录 official-site/，苹果式单页，静态资源走 /site-assets/） ──
# 为什么官网与 App 分路径：官网是根路径入口（对外展示），App 挂到 /app/ 子路径，
# /admin、/api、/assets 保持不变。官网的图片/css 引用 site-assets/*，避免与 App 的 /assets 冲突。
SITE_DIR = BASE_DIR.parent / "official-site"
SITE_INDEX = SITE_DIR / "index.html"
SITE_ASSETS = SITE_DIR / "assets"


# ── 可视化管理后台（纯静态页面，放在 server/static/） ──
STATIC_DIR = BASE_DIR / "static"
if STATIC_DIR.exists():
    # 管理后台页面/脚本不缓存：后台功能更新频繁，浏览器缓存旧 JS 会导致「新功能看不到」
    class NoCacheStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            resp = await super().get_response(path, scope)
            resp.headers["Cache-Control"] = "no-cache"
            return resp

    app.mount("/admin", NoCacheStaticFiles(directory=str(STATIC_DIR), html=True), name="admin")


# ── 官网静态资源（official-site/assets/）──
# 与 App 的 /assets（dist 构建产物）是两套，路径错开互不干扰。
# 官网图片文件名不带哈希，但内容稳定，允许浏览器短缓存即可（入口页本身走 no-cache）。
if SITE_ASSETS.exists():
    app.mount("/site-assets", StaticFiles(directory=str(SITE_ASSETS)), name="site-assets")


# ── 考生端 App 构建产物（项目根目录 dist/，由 npm run build 生成） ──
# 为什么要后端来托管：前端接口走相对路径 /api，App / 管理后台 / 接口三者必须同源。
# 由本服务一并托管后，内网穿透只需暴露这一个端口（不用开两条隧道，也不会有跨域问题）。
APP_DIST_DIR = BASE_DIR.parent / "dist"
APP_INDEX = APP_DIST_DIR / "index.html"


def _app_built() -> bool:
    """前端是否已经 npm run build 出产物。没有就退回「只跑接口 + 管理后台」。"""
    return APP_INDEX.exists()


class NoCacheFileResponse(FileResponse):
    """入口页禁用缓存：否则重新构建后浏览器还在跑旧的 JS。"""

    def __init__(self, path, **kwargs):
        headers = dict(kwargs.pop("headers", None) or {})
        headers.setdefault("Cache-Control", "no-cache, no-store, must-revalidate")
        super().__init__(path, headers=headers, **kwargs)


class ImmutableStaticFiles(StaticFiles):
    """构建产物长缓存：文件名带内容哈希（index-3sXVbQGy.js），内容变了文件名就变，
    所以可以放心让浏览器和 CDN 长期缓存。

    ⚠️ 入口 index.html 走 NoCacheFileResponse，不会锁住旧的资源引用。
    为什么要管这个：加 CDN（腾讯云 EdgeOne 等）后，带缓存头才能命中边缘缓存，
    回源跨境的那段慢链路才不会被每个访客重复走一遍。"""

    async def get_response(self, path: str, scope):
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


if _app_built():
    _app_assets = APP_DIST_DIR / "assets"
    if _app_assets.exists():
        app.mount("/assets", ImmutableStaticFiles(directory=str(_app_assets)), name="app-assets")


@app.get("/", include_in_schema=False)
def index():
    """根路径：官网入口页（official-site/index.html）；
    官网不存在时退回考生端 App；再退回管理后台。"""
    if SITE_INDEX.exists():
        return NoCacheFileResponse(SITE_INDEX)
    if _app_built():
        return NoCacheFileResponse(APP_INDEX)
    return RedirectResponse(url="/admin/")


@app.get("/api/health", tags=["系统"], summary="健康检查")
def health():
    return {
        "ok": True,
        "sms_mode": sms_mode(),
        "database": str(DB_PATH),
    }


# ── 考生端 App：挂在 /app/ 子路径（官网在根路径） ──────────────
# App 构建产物（dist/index.html）内资源引用的是绝对路径 /assets/*（Vite base='/'），
# 从 /app/ 打开时浏览器仍会请求同源的 /assets/*，由上方已挂载的 /assets 命中，无需重建前端。
# ⚠️ 必须注册在所有具体路由之后：FastAPI 按注册顺序匹配，先注册的 /api、/admin、/site-assets 优先。
if _app_built():

    @app.get("/app", include_in_schema=False)
    @app.get("/app/", include_in_schema=False)
    def app_index():
        """考生端 App 入口：/app 与 /app/ 均返回 App 首页。"""
        return NoCacheFileResponse(APP_INDEX)

    @app.get("/app/{full_path:path}", include_in_schema=False)
    def app_fallback(full_path: str):
        """App 子路径回退：/app/xxx 命中 dist 内真实文件就返回文件，否则回 App 入口。
        带目录穿越防护（root in candidate.parents），挡住 ../../config.json 这类请求。"""
        candidate = (APP_DIST_DIR / full_path).resolve()
        root = APP_DIST_DIR.resolve()
        if root in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return NoCacheFileResponse(APP_INDEX)


# ── 官网单页兜底（未知路径一律回官网首页） ──────────────────────
# ⚠️ 必须注册在所有具体路由之后。官网是单页应用，没有 History 路由。
@app.get("/{full_path:path}", include_in_schema=False)
def site_fallback(full_path: str):
    """未知路径（除 /api、/admin、/app、/site-assets 已提前匹配的）统一回官网首页。"""
    if full_path.startswith(("api/", "admin")):
        raise HTTPException(status_code=404, detail="Not Found")
    if SITE_INDEX.exists():
        return NoCacheFileResponse(SITE_INDEX)
    raise HTTPException(status_code=404, detail="Not Found")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config["server"]["host"],
        port=int(config["server"]["port"]),
        reload=True,
    )
