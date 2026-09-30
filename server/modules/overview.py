"""
概览模块 —— 管理后台首页的统计数字。

接口（前缀 /api/admin，需要管理员登录）：
  GET /api/admin/stats   各账号数量、今日新增、验证码发送情况、当前短信模式、待处理密码重置工单

修改注意：
  - 只做只读统计，不写数据；统计口径变化时同步更新管理后台 dashboard.js 里的展示文案
"""

from datetime import datetime

from fastapi import APIRouter, Depends

from config import sms_mode, sms_ready
from database import get_conn
from deps import get_current_admin

router = APIRouter(prefix="/api/admin", tags=["概览"])


@router.get("/stats", summary="后台概览统计")
def stats(admin: dict = Depends(get_current_admin)):
    today = datetime.now().strftime("%Y-%m-%d")
    with get_conn() as conn:
        def one(sql: str, params: tuple = ()) -> int:
            return conn.execute(sql, params).fetchone()["n"]

        admin_total = one("SELECT COUNT(*) AS n FROM admin_accounts")
        admin_active = one("SELECT COUNT(*) AS n FROM admin_accounts WHERE status = 1")
        user_total = one("SELECT COUNT(*) AS n FROM user_accounts")
        user_active = one("SELECT COUNT(*) AS n FROM user_accounts WHERE status = 1")
        user_today = one("SELECT COUNT(*) AS n FROM user_accounts WHERE created_at LIKE ?", (f"{today}%",))
        sms_today = one("SELECT COUNT(*) AS n FROM sms_codes WHERE created_at LIKE ?", (f"{today}%",))
        sessions_active = one("SELECT COUNT(*) AS n FROM sessions")
        reg_pending = one("SELECT COUNT(*) AS n FROM registrations WHERE status = 'pending'")
        reg_total = one("SELECT COUNT(*) AS n FROM registrations")
        reg_approved = one("SELECT COUNT(*) AS n FROM registrations WHERE status = 'approved'")
        reg_rejected = one("SELECT COUNT(*) AS n FROM registrations WHERE status = 'rejected'")
        reset_pending = one("SELECT COUNT(*) AS n FROM password_resets WHERE status = 'pending'")
        reset_total = one("SELECT COUNT(*) AS n FROM password_resets")
        reset_done = one("SELECT COUNT(*) AS n FROM password_resets WHERE status = 'done'")
        reset_rejected = one("SELECT COUNT(*) AS n FROM password_resets WHERE status = 'rejected'")

    return {
        "admin": {"total": admin_total, "active": admin_active},
        "user": {"total": user_total, "active": user_active, "today_new": user_today},
        "registration": {
            "pending": reg_pending,
            "total": reg_total,
            "approved": reg_approved,
            "rejected": reg_rejected,
        },
        "password_reset": {
            "pending": reset_pending,
            "total": reset_total,
            "done": reset_done,
            "rejected": reset_rejected,
        },
        "sms": {"today_sent": sms_today, "mode": sms_mode(), "ready": sms_ready()},
        "sessions": {"active": sessions_active},
        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
