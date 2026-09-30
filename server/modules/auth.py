"""
登录鉴权模块 —— 管理员登录 / 考生账号密码登录 / 修改密码。

接口（前缀 /api/auth）：
  POST /admin/login          管理员账号密码登录（管理后台用）
  POST /password/login       账号 + 密码登录（自动识别管理员或考生）
  POST /change-password      管理员修改「自己的」密码（需验旧密码）
  GET  /me                   取当前登录者信息
  POST /logout               退出登录
  GET  /sms-mode             当前短信模式（历史遗留，管理后台顶部提示用）

说明：
  - 考生自助注册在 registrations.py（注册申请 → 管理员审核通过后才建号）
  - 考生登录名是自定义账号 account（不再是手机号）；手机号验证码登录已下线
  - 管理员账号的增删改查在 admin_accounts.py，考生账号在 user_accounts.py
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from config import sms_mode, sms_ready
from database import get_conn, now_iso, row_to_dict
from deps import (
    ADMIN,
    USER,
    bearer_token,
    create_session,
    get_current_admin,
    get_current_user,
    revoke_session,
)
from security import hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["认证"])


# ── 请求体 ──────────────────────────────────────────────────

class AdminLoginBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class PasswordLoginBody(BaseModel):
    account: str = Field(..., min_length=1, max_length=64, description="管理员用户名 或 考生账号")
    password: str = Field(..., min_length=1, max_length=128)


class ChangePasswordBody(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=6, max_length=128)


# ── 工具 ────────────────────────────────────────────────────

def _public_admin(row: dict) -> dict:
    row.pop("password_hash", None)
    return row


def _public_user(row: dict) -> dict:
    """对外返回的考生信息：剔除密码哈希，另外给出「是否已设密码」的布尔值。"""
    row["has_password"] = bool(row.get("password_hash"))
    row.pop("password_hash", None)
    return row


def _touch_login(table: str, subject_id: int) -> None:
    with get_conn() as conn:
        conn.execute(f"UPDATE {table} SET last_login_at = ? WHERE id = ?", (now_iso(), subject_id))


# ── 管理员登录 ──────────────────────────────────────────────

@router.post("/admin/login", summary="管理员登录")
def admin_login(body: AdminLoginBody):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM admin_accounts WHERE username = ?", (body.username.strip(),)
        ).fetchone()
    admin = row_to_dict(row)

    # 统一提示，不暴露「用户名不存在」还是「密码错误」
    if not admin or not verify_password(body.password, admin.get("password_hash")):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if not admin["status"]:
        raise HTTPException(status_code=403, detail="该账号已被禁用，请联系超级管理员")

    session = create_session(ADMIN, admin["id"])
    _touch_login("admin_accounts", admin["id"])
    return {"token": session["token"], "expires_at": session["expires_at"], "admin": _public_admin(admin)}


# ── 账号密码登录（自动识别身份） ────────────────────────────

@router.post("/password/login", summary="账号密码登录（管理员或考生）")
def password_login(body: PasswordLoginBody):
    account = body.account.strip()

    # 1) 先按管理员用户名查
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM admin_accounts WHERE username = ?", (account,)).fetchone()
    admin = row_to_dict(row)
    if admin and verify_password(body.password, admin.get("password_hash")):
        if not admin["status"]:
            raise HTTPException(status_code=403, detail="该账号已被禁用")
        session = create_session(ADMIN, admin["id"])
        _touch_login("admin_accounts", admin["id"])
        return {
            "token": session["token"],
            "expires_at": session["expires_at"],
            "identity": "admin",
            "admin": _public_admin(admin),
        }

    # 2) 再按考生账号查（考生必须由管理员审核通过注册申请后才有账号）
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM user_accounts WHERE account = ?", (account,)).fetchone()
    user = row_to_dict(row)
    if user and verify_password(body.password, user.get("password_hash")):
        if not user["status"]:
            raise HTTPException(status_code=403, detail="该账号已被禁用，请联系管理员")
        session = create_session(USER, user["id"])
        _touch_login("user_accounts", user["id"])
        return {
            "token": session["token"],
            "expires_at": session["expires_at"],
            "identity": "user",
            "user": _public_user(user),
        }

    raise HTTPException(status_code=401, detail="账号或密码错误")


# ── 修改密码 ────────────────────────────────────────────────

@router.post("/change-password", summary="管理员修改自己的密码")
def change_password(body: ChangePasswordBody, admin: dict = Depends(get_current_admin)):
    """校验旧密码 → 更新新密码 → 踢掉本人全部会话（需用新密码重新登录）。"""
    if body.old_password == body.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM admin_accounts WHERE id = ?", (admin["id"],)).fetchone()
        current = row_to_dict(row)
        if not current or not verify_password(body.old_password, current.get("password_hash")):
            raise HTTPException(status_code=400, detail="当前密码不正确")

        conn.execute(
            "UPDATE admin_accounts SET password_hash = ? WHERE id = ?",
            (hash_password(body.new_password), admin["id"]),
        )
        # 改完密码让该账号所有已登录会话立即失效
        conn.execute(
            "DELETE FROM sessions WHERE subject_type = 'admin' AND subject_id = ?", (admin["id"],)
        )

    return {"ok": True, "message": "密码已修改，请用新密码重新登录"}


# ── 当前登录者 / 退出 / 短信模式 ────────────────────────────

@router.get("/me", summary="当前登录者")
def me(request: Request):
    """先按管理员解析，失败再按考生解析；都不行则 401。"""
    try:
        return {"identity": "admin", "admin": get_current_admin(request)}
    except HTTPException:
        pass
    return {"identity": "user", "user": get_current_user(request)}


@router.post("/logout", summary="退出登录")
def logout(request: Request):
    revoke_session(bearer_token(request))
    return {"ok": True, "message": "已退出登录"}


@router.get("/sms-mode", summary="当前短信模式")
def get_sms_mode():
    """历史遗留：腾讯云短信已不参与登录/注册，这里仅保留给管理后台顶部提示用。"""
    from config import config as _cfg

    return {
        "mode": sms_mode(),
        "ready": sms_ready(),
        "code_ttl_seconds": int(_cfg["sms"]["code_ttl_seconds"]),
        "resend_interval_seconds": int(_cfg["sms"]["resend_interval_seconds"]),
        "tip": (
            "腾讯云短信已配置"
            if sms_mode() == "tencent"
            else "当前未配置腾讯云短信凭证；登录与注册均已改用图形验证码，不再依赖短信"
        ),
    }
