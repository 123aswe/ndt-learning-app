"""
鉴权依赖层 —— 会话令牌的存取 + FastAPI 的「当前登录者」依赖。

职责：
  1. create_session / revoke_session / resolve_session：令牌的增删查
  2. get_current_admin：要求管理员登录的接口挂这个依赖
  3. get_current_user：要求考生登录的接口挂这个依赖
  4. require_super_admin：仅超级管理员可用的接口挂这个依赖

用法（在其它模块里）：
    @router.get("/xxx")
    def xxx(admin: dict = Depends(get_current_admin)):
        ...
"""

from datetime import datetime, timedelta

from fastapi import Depends, HTTPException, Request

from config import config
from database import get_conn, is_expired, now_iso, row_to_dict
from security import new_token

ADMIN = "admin"
USER = "user"


# ── 会话令牌 ────────────────────────────────────────────────

def create_session(subject_type: str, subject_id: int) -> dict:
    """为某个主体（管理员 / 考生）签发令牌。"""
    ttl_hours = int(config["security"]["token_ttl_hours"])
    token = new_token()
    expires_at = (datetime.now() + timedelta(hours=ttl_hours)).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO sessions (token, subject_type, subject_id, created_at, expires_at) VALUES (?,?,?,?,?)",
            (token, subject_type, subject_id, now_iso(), expires_at),
        )
    return {"token": token, "expires_at": expires_at}


def revoke_session(token: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def resolve_session(token: str) -> dict | None:
    """令牌 → {subject_type, subject_id}；无效或过期返回 None。"""
    if not token:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
    data = row_to_dict(row)
    if not data or is_expired(data["expires_at"]):
        if data:
            revoke_session(token)
        return None
    return data


def bearer_token(request: Request) -> str:
    """从请求里取出令牌：优先 Authorization: Bearer xxx，兼容 X-Token 头与 ?token= 参数。"""
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.headers.get("X-Token", "") or request.query_params.get("token", "")


# ── FastAPI 依赖 ────────────────────────────────────────────

def _unauthorized(message: str) -> HTTPException:
    return HTTPException(status_code=401, detail=message)


def get_current_admin(request: Request) -> dict:
    """要求管理员登录。返回管理员行（已剔除密码哈希）。"""
    session = resolve_session(bearer_token(request))
    if not session or session["subject_type"] != ADMIN:
        raise _unauthorized("请先登录管理后台")
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM admin_accounts WHERE id = ?", (session["subject_id"],)
        ).fetchone()
    admin = row_to_dict(row)
    if not admin:
        revoke_session(session["token"])
        raise _unauthorized("账号已不存在，请重新登录")
    if not admin["status"]:
        raise HTTPException(status_code=403, detail="该管理员账号已被禁用")
    admin.pop("password_hash", None)
    admin["token"] = session["token"]
    return admin


def get_current_user(request: Request) -> dict:
    """要求考生登录。返回考生行（已剔除密码哈希）。"""
    session = resolve_session(bearer_token(request))
    if not session or session["subject_type"] != USER:
        raise _unauthorized("请先登录")
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM user_accounts WHERE id = ?", (session["subject_id"],)
        ).fetchone()
    user = row_to_dict(row)
    if not user:
        revoke_session(session["token"])
        raise _unauthorized("账号已不存在，请重新登录")
    if not user["status"]:
        raise HTTPException(status_code=403, detail="该账号已被禁用，请联系管理员")
    user.pop("password_hash", None)
    user["token"] = session["token"]
    return user


def require_super_admin(admin: dict = Depends(get_current_admin)) -> dict:
    """仅超级管理员可用的危险操作挂这个依赖。"""
    if admin.get("role") != "super":
        raise HTTPException(status_code=403, detail="该操作仅超级管理员可执行")
    return admin
