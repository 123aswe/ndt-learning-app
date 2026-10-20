"""
鉴权依赖层 —— 会话令牌的存取 + FastAPI 的「当前登录者」依赖。

职责：
  1. create_session / revoke_session / resolve_session：令牌的增删查
     （令牌有效期 = config.security.token_ttl_hours，默认 15 天；有效期内每次请求自动续期）
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

# 续期节流间隔：剩余有效期少于「总时长 − 24 小时」时才写库续期 → 每个令牌每天最多写一次
_RENEW_INTERVAL = timedelta(hours=24)


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


def _renew_session(session: dict) -> None:
    """把快过期的令牌续到「现在 + TTL」——按天节流；解析失败直接跳过，不影响正常鉴权。"""
    ttl_hours = int(config["security"]["token_ttl_hours"])
    try:
        expires_at = datetime.strptime(session["expires_at"], "%Y-%m-%d %H:%M:%S")
    except (KeyError, ValueError, TypeError):
        return
    now = datetime.now()
    ttl = timedelta(hours=ttl_hours)
    if expires_at - now > ttl - _RENEW_INTERVAL:
        return  # 离过期还早，这次不写库
    new_expires = (now + ttl).strftime("%Y-%m-%d %H:%M:%S")
    with get_conn() as conn:
        conn.execute("UPDATE sessions SET expires_at = ? WHERE token = ?", (new_expires, session["token"]))
    session["expires_at"] = new_expires


def resolve_session(token: str) -> dict | None:
    """令牌 → {subject_type, subject_id}；无效或过期返回 None。

    滑动有效期：只要在有效期内发过任意一次请求（App 每次打开都会请求接口），
    就把有效期续到「现在 + token_ttl_hours」——所以是「15 天不登录才要重新登录」，
    而不是登录满 15 天后被强制踢出去。续期按天节流，不会每个请求都写库。
    """
    if not token:
        return None
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE token = ?", (token,)).fetchone()
    data = row_to_dict(row)
    if not data or is_expired(data["expires_at"]):
        if data:
            revoke_session(token)
        return None
    _renew_session(data)
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
