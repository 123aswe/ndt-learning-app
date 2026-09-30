"""
考生个人资料模块 —— 考生查看 / 修改「自己的」昵称与头像。

接口（前缀 /api/user，全部需要考生登录）：
  GET  /profile   取当前登录考生的资料（昵称 / 头像 / 账号 / 单位学校 / 报考方向…）
  PUT  /profile   修改昵称 / 头像（只能改自己的；昵称留空表示不改）

说明：
  - 头像 avatar 是字符串：
      预设头像  → "preset:1" ~ "preset:N"（N 见 profile_defaults.AVATAR_PRESET_COUNT）
      本地上传  → "data:image/jpeg;base64,..."（前端已压缩到 256×256 再提交）
      空字符串  → 没设过头像，前端退化为「昵称首字」头像
  - 昵称/头像的随机默认值在 profile_defaults.py，建号时（注册审核通过 / 管理员手动开号）自动填
  - 管理员在后台「考生账号」里能看到并修改同样的字段，见 user_accounts.py

修改注意：
  - AVATAR_MAX_LEN 要能容纳压缩后的图片 data URL；调小会导致上传保存失败（422）
  - 这里只允许改「自己的」资料；要改别人的走 /api/admin/users/{id}
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_conn, row_to_dict
from deps import get_current_user

router = APIRouter(prefix="/api/user", tags=["考生资料"])

# 头像最大长度：够放压缩后的图片 data URL（约 200KB 图片 → 约 270KB base64）
AVATAR_MAX_LEN = 400_000

NICKNAME_MAX_LEN = 32


# ── 请求体 ──────────────────────────────────────────────────

class ProfileUpdateBody(BaseModel):
    nickname: Optional[str] = Field(None, max_length=NICKNAME_MAX_LEN, description="留空表示不修改")
    avatar: Optional[str] = Field(None, max_length=AVATAR_MAX_LEN, description="预设 id 或 data URL")


# ── 工具 ────────────────────────────────────────────────────

def _public(row: dict) -> dict:
    """对外返回：剔除密码哈希，另给「是否已设密码」。"""
    row["has_password"] = bool(row.get("password_hash"))
    row.pop("password_hash", None)
    return row


# ── 查 ──────────────────────────────────────────────────────

@router.get("/profile", summary="取我的资料")
def get_my_profile(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM user_accounts WHERE id = ?", (user["id"],)).fetchone()
    data = row_to_dict(row)
    if not data:
        raise HTTPException(status_code=404, detail="账号不存在，请重新登录")
    return _public(data)


# ── 改 ──────────────────────────────────────────────────────

@router.put("/profile", summary="修改我的昵称 / 头像")
def update_my_profile(body: ProfileUpdateBody, user: dict = Depends(get_current_user)):
    fields: list[str] = []
    params: list = []

    # 昵称：只接受非空值，避免误操作把昵称清空
    if body.nickname is not None:
        nickname = body.nickname.strip()
        if nickname:
            fields.append("nickname = ?")
            params.append(nickname)

    # 头像：允许传空字符串（表示恢复成默认的首字头像）
    if body.avatar is not None:
        fields.append("avatar = ?")
        params.append(body.avatar.strip())

    if not fields:
        raise HTTPException(status_code=400, detail="没有需要修改的内容")

    params.append(user["id"])
    with get_conn() as conn:
        conn.execute(f"UPDATE user_accounts SET {', '.join(fields)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM user_accounts WHERE id = ?", (user["id"],)).fetchone()

    return _public(row_to_dict(row))
