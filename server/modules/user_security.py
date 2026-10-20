"""
考生账号安全模块 —— 考生自助修改「自己的」登录密码与登录账号。

接口（前缀 /api/user，全部需要考生登录）：
  POST /password   修改我的登录密码（需验原密码；改完踢掉本人全部会话）
  POST /account    修改我的登录账号（需验登录密码；账号唯一）

说明：
  - 昵称 / 头像在 user_profile.py；管理员改考生账号在 user_accounts.py
  - 忘记原密码 / 无法登录时走管理员：后台「考生账号」里可重置密码、改账号
  - 账号规则 ACCOUNT_PATTERN 要与 registrations.py、user_accounts.py、前端提示保持一致

修改注意：
  - 改密码后必须 DELETE sessions（否则旧令牌还能继续用，等于没改）
  - 改账号只改登录名，不迁移数据（同一行记录，id 不变）
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_conn, row_to_dict
from deps import USER, get_current_user
from modules import realtime
from security import hash_password, verify_password

router = APIRouter(prefix="/api/user", tags=["考生账号安全"])

# 与 registrations.py / user_accounts.py 保持一致：4-20 位字母 / 数字 / 下划线
ACCOUNT_PATTERN = r"^[A-Za-z0-9_]{4,20}$"

PASSWORD_MIN_LEN = 6
PASSWORD_MAX_LEN = 128


# ── 请求体 ──────────────────────────────────────────────────

class ChangeMyPasswordBody(BaseModel):
    old_password: str = Field(..., min_length=1, max_length=PASSWORD_MAX_LEN, description="当前密码")
    new_password: str = Field(..., min_length=PASSWORD_MIN_LEN, max_length=PASSWORD_MAX_LEN, description="新密码")
    confirm_password: str = Field(..., min_length=1, max_length=PASSWORD_MAX_LEN, description="确认新密码")


class ChangeMyAccountBody(BaseModel):
    new_account: str = Field(..., pattern=ACCOUNT_PATTERN, description="新的登录账号：4-20 位字母 / 数字 / 下划线")
    password: str = Field(..., min_length=1, max_length=PASSWORD_MAX_LEN, description="当前登录密码（用于确认身份）")


# ── 改密码 ──────────────────────────────────────────────────

@router.post("/password", summary="修改我的登录密码")
def change_my_password(body: ChangeMyPasswordBody, user: dict = Depends(get_current_user)):
    """验原密码 → 写新密码 → 踢掉本人全部会话（需用新密码重新登录）。"""
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=400, detail="两次输入的新密码不一致")
    if body.new_password == body.old_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM user_accounts WHERE id = ?", (user["id"],)).fetchone()
        current = row_to_dict(row)
        if not current or not verify_password(body.old_password, current.get("password_hash")):
            raise HTTPException(status_code=400, detail="当前密码不正确")

        conn.execute(
            "UPDATE user_accounts SET password_hash = ? WHERE id = ?",
            (hash_password(body.new_password), user["id"]),
        )
        # 改完密码让该账号所有已登录会话立即失效
        conn.execute(
            "DELETE FROM sessions WHERE subject_type = ? AND subject_id = ?", (USER, user["id"])
        )

    # 实时踢下线：其它设备（另一部手机 / 另一个标签页）不用等下次请求就退回登录页
    realtime.kick_session(user["id"], "密码已修改，请用新密码重新登录")

    return {"ok": True, "message": "密码已修改，请用新密码重新登录"}


# ── 改登录账号 ──────────────────────────────────────────────

@router.post("/account", summary="修改我的登录账号")
def change_my_account(body: ChangeMyAccountBody, user: dict = Depends(get_current_user)):
    """验登录密码 → 校验新账号未被占用 → 更新登录名（会话保留，不用重新登录）。"""
    new_account = body.new_account.strip()
    if new_account == user["account"]:
        raise HTTPException(status_code=400, detail="新账号与当前账号相同")

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM user_accounts WHERE id = ?", (user["id"],)).fetchone()
        current = row_to_dict(row)
        if not current or not verify_password(body.password, current.get("password_hash")):
            raise HTTPException(status_code=400, detail="登录密码不正确")

        taken = conn.execute(
            "SELECT 1 FROM user_accounts WHERE account = ? AND id <> ?", (new_account, user["id"])
        ).fetchone()
        if taken:
            raise HTTPException(status_code=409, detail="该账号已被使用，请换一个")
        admin_taken = conn.execute(
            "SELECT 1 FROM admin_accounts WHERE username = ?", (new_account,)
        ).fetchone()
        if admin_taken:
            raise HTTPException(status_code=409, detail="该账号已被使用，请换一个")

        conn.execute("UPDATE user_accounts SET account = ? WHERE id = ?", (new_account, user["id"]))
        row = conn.execute("SELECT * FROM user_accounts WHERE id = ?", (user["id"],)).fetchone()

    data = row_to_dict(row)
    data.pop("password_hash", None)
    data["has_password"] = True
    return {"ok": True, "message": "登录账号已修改", "user": data}
