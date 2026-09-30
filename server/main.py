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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from config import BASE_DIR, DB_PATH, config, sms_mode
from database import init_db
from modules import (
    achievements,
    admin_accounts,
    app_update,
    auth,
    bank,
    captcha,
    exam,
    materials,
    notifications,
    overview,
    password_resets,
    practice,
    question_reports,
    question_sets,
    registrations,
    sms,
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
    mode = sms_mode()
    host, port = config["server"]["host"], config["server"]["port"]
    print("=" * 62)
    print("  NDT-劳人刷题 App · Python 服务已启动")
    print(f"  {banner}")
    print(f"  数据库：{DB_PATH}")
    print(f"  短信模式：{'腾讯云真发' if mode == 'tencent' else '本地调试（未配置腾讯云凭证）'}")
    if mode != "tencent":
        print("  ⚠️  本地调试模式：短信不参与登录/注册（已改用图形验证码），腾讯云凭证未配置")
    print(f"  管理后台：http://{host}:{port}/admin/")
    print(f"  接口文档：http://{host}:{port}/docs")
    print("=" * 62)
    yield


app = FastAPI(
    title="NDT-劳人刷题 App 服务",
    description="注册申请与审核 / 登录认证 / 图形验证码 / 考生个人资料与账号安全 / 管理员与考生账号管理（增删查改）/ 通知中心 / 密码重置工单 / 版本更新 / 题库与练习统计",
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

# ── 注册路由（一个业务模块一行） ────────────────────────────
app.include_router(auth.router)
app.include_router(captcha.router)
app.include_router(registrations.router)
app.include_router(password_resets.router)       # 考生端：提交重置申请（公开）
app.include_router(user_profile.router)
app.include_router(user_security.router)
app.include_router(notifications.router)         # 考生端：通知中心
app.include_router(admin_accounts.router)
app.include_router(user_accounts.router)
app.include_router(notifications.admin_router)   # 管理端：发送通知 / 已发送记录
app.include_router(password_resets.admin_router)  # 管理端：密码重置工单
app.include_router(app_update.router)
app.include_router(overview.router)
app.include_router(sms.router)
app.include_router(bank.router)                   # 题库概览（考生只读）
app.include_router(question_sets.router)          # 自定义题库（考生端读列表）
app.include_router(question_sets.admin_router)    # 管理端：题库管理（增删查改 + 导入）
app.include_router(question_reports.router)       # 考生端：题目纠错上报
app.include_router(question_reports.admin_router)  # 管理端：纠错工单处理
app.include_router(practice.router)               # 练习出题 / 交卷
app.include_router(practice.user_router)          # 学习统计 / 错题本
app.include_router(achievements.router)           # 成就勋章（目录 / 解锁进度）
app.include_router(exam.router)                   # 模拟考试（开卷 / 交卷 / 试卷回看）
app.include_router(materials.router)              # 资料库（考生端：标准/教材/资料/视频列表与文件）
app.include_router(materials.admin_router)        # 管理端：资料库上传 / 增删查改 / 封面
app.include_router(materials.admin_comment_router)  # 管理端：视频评论管理


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


@app.get("/", include_in_schema=False)
def index():
    """根路径直接跳转到管理后台。"""
    return RedirectResponse(url="/admin/")


@app.get("/api/health", tags=["系统"], summary="健康检查")
def health():
    return {
        "ok": True,
        "sms_mode": sms_mode(),
        "database": str(DB_PATH),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=config["server"]["host"],
        port=int(config["server"]["port"]),
        reload=True,
    )
