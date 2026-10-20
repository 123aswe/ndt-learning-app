"""
概览模块 —— 管理后台首页的统计数字 + 公网访问信息。

接口（前缀 /api/admin，需要管理员登录）：
  GET /api/admin/stats   各账号数量、今日新增、验证码发送情况、当前短信模式、待处理密码重置工单
  GET /api/admin/tunnel  当前公网隧道地址（读项目根「公网地址.txt」，由 tools/tunnel.py 在启动隧道时写入）

修改注意：
  - 只做只读统计，不写数据；统计口径变化时同步更新管理后台 dashboard.js 里的展示文案
  - tunnel 接口只解析 tools/tunnel.py 的 announce() 写出的「公网地址.txt」，不负责建隧道；
    改那边的标签文案（考生端 App / 管理后台 / 接口文档 / 本机地址 / 生成时间）要同步改 tunnel_addresses()
  - tunnel_addresses() 是**唯一**的公网地址解析点：/api/admin/tunnel（后台展示）与
    /api/access-info（小程序自动获取，modules/network.py）都调它，别再各写一份正则
"""

import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends

from config import sms_mode, sms_ready
from database import get_conn
from deps import get_current_admin

router = APIRouter(prefix="/api/admin", tags=["概览"])

# 项目根 = server/ 的上一级；「公网地址.txt」由 tools/tunnel.py 每次启动隧道时覆写
TUNNEL_ADDR_FILE = Path(__file__).resolve().parent.parent.parent / "公网地址.txt"


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


def tunnel_addresses() -> dict:
    """读启动公网访问时写入的「公网地址.txt」，解析出各入口地址。

    两处共用（所以抽成独立函数，别各写一份正则）：
      - GET /api/admin/tunnel（管理后台展示 / 复制）
      - GET /api/access-info（小程序端自动获取当前可用地址，见 modules/network.py）

    Cloudflare 快速隧道的地址每次重启都会变，以最近一次生成的为准；
    文件不存在或还没写出地址时 available=False。
    """
    info = {
        "available": False,
        "app_url": "",
        "admin_url": "",
        "docs_url": "",
        "local_url": "",
        "generated_at": "",
    }
    try:
        text = TUNNEL_ADDR_FILE.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return info

    def grab(label: str) -> str:
        m = re.search(rf"{label}\s*[：:]\s*(\S+)", text)
        return m.group(1) if m else ""

    info["app_url"] = grab(r"考生端\s*App")
    info["admin_url"] = grab(r"管理后台")
    info["docs_url"] = grab(r"接口文档")
    info["local_url"] = grab(r"本机地址")
    m = re.search(r"生成时间\s*[：:]\s*(.+)", text)
    info["generated_at"] = m.group(1).strip() if m else ""
    info["available"] = bool(info["app_url"])
    return info


@router.get("/tunnel", summary="当前公网隧道地址")
def tunnel(admin: dict = Depends(get_current_admin)):
    """当前公网隧道地址，供管理后台展示 / 复制（解析逻辑见 tunnel_addresses）。"""
    return tunnel_addresses()
