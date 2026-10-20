"""
考生账号模块 —— 刷题用户账号的增删查改。

接口（前缀 /api/admin/users，全部需要管理员登录）：
  GET    ""        列表：支持关键词搜索、状态 / 报考方向筛选、分页
  POST   ""        新增（账号唯一）
  GET    "/{id}"   详情
  PUT    "/{id}"   修改（可同时改密码 / 状态 / 单位学校 / 昵称 / 头像 / 方向 / 备注）
  DELETE "/{id}"   删除

说明：
  - 考生登录名是自定义账号 account（4-20 位字母/数字/下划线），不是手机号
  - 考生通常通过「注册申请 → 审核通过」自动建号（见 registrations.py）；
    本模块用于管理员手动开号与后续维护
  - 密码一般都有（注册时必须填）；重置密码 = 传 password 字段即可
  - 昵称 nickname 与头像 avatar 留空时随机生成（见 profile_defaults.py）；
    考生本人改这两项走 /api/user/profile（user_profile.py）

修改注意：
  - 报考方向 method 的取值见 METHODS，前端选择项要与之一致
  - 账号规则 ACCOUNT_PATTERN 要与 registrations.py、前端提示保持一致
  - 头像 avatar 的取值格式（preset:N / data URL）见 user_profile.py 与前端 src/data/avatars.ts
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin
from modules import realtime
from modules import notifications
from profile_defaults import random_avatar, random_nickname
from security import hash_password

router = APIRouter(prefix="/api/admin/users", tags=["考生账号"])

# 报考方向（与前端 src/types.ts 的 NDTMethod 保持一致）
METHODS = ("UT", "RT", "MT", "PT", "ET", "VT", "综合")

# 登录账号规则：4-20 位字母 / 数字 / 下划线
ACCOUNT_PATTERN = r"^[A-Za-z0-9_]{4,20}$"

# 头像最大长度：够放压缩后的图片 data URL（预设 id 远小于此）
AVATAR_MAX_LEN = 400_000


# ── 请求体 ──────────────────────────────────────────────────

class UserCreateBody(BaseModel):
    account: str = Field(..., pattern=ACCOUNT_PATTERN, description="4-20 位字母 / 数字 / 下划线，作为登录名")
    password: str = Field("", max_length=128, description="可留空；留空表示该考生只能用其他方式登录")
    org: str = Field("", max_length=64, description="单位 / 学校")
    nickname: str = Field("", max_length=32, description="留空则随机生成")
    avatar: str = Field("", max_length=AVATAR_MAX_LEN, description="留空则随机生成（preset:N）")
    real_name: str = Field("", max_length=32)
    method: str = Field("", description="报考方向，可留空")
    status: int = Field(1, ge=0, le=1)
    remark: str = Field("", max_length=200)


class UserUpdateBody(BaseModel):
    nickname: Optional[str] = Field(None, max_length=32, description="留空表示不修改")
    avatar: Optional[str] = Field(None, max_length=AVATAR_MAX_LEN, description="预设 preset:N 或 data URL；传空串则清空")
    real_name: Optional[str] = Field(None, max_length=32)
    org: Optional[str] = Field(None, max_length=64)
    method: Optional[str] = None
    status: Optional[int] = Field(None, ge=0, le=1)
    remark: Optional[str] = Field(None, max_length=200)
    password: Optional[str] = Field(None, max_length=128, description="传值则重置密码；传空字符串则清空密码")
    account: Optional[str] = Field(None, pattern=ACCOUNT_PATTERN, description="一般不用改；改了会同时成为新登录名")


# ── 内部工具 ────────────────────────────────────────────────

def _public(row: dict) -> dict:
    """对外返回：不含密码哈希，另给「是否已设密码」。"""
    row["has_password"] = bool(row.get("password_hash"))
    row.pop("password_hash", None)
    return row


def _get_or_404(conn, user_id: int) -> dict:
    row = conn.execute("SELECT * FROM user_accounts WHERE id = ?", (user_id,)).fetchone()
    data = row_to_dict(row)
    if not data:
        raise HTTPException(status_code=404, detail="考生账号不存在")
    return data


# ── 查（列表 / 详情） ───────────────────────────────────────

@router.get("", summary="考生列表")
def list_users(
    q: str = Query("", description="按账号 / 昵称 / 姓名 / 单位学校 / 备注模糊搜索"),
    status: Optional[int] = Query(None, ge=0, le=1),
    method: str = Query("", description="报考方向筛选"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    admin: dict = Depends(get_current_admin),
):
    where, params = [], []
    if q.strip():
        where.append(
            "(account LIKE ? OR nickname LIKE ? OR real_name LIKE ? OR org LIKE ? OR remark LIKE ?)"
        )
        params += [f"%{q.strip()}%"] * 5
    if status is not None:
        where.append("status = ?")
        params.append(status)
    if method.strip():
        where.append("method = ?")
        params.append(method.strip())
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    with get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM user_accounts{clause}", params
        ).fetchone()["n"]
        rows = conn.execute(
            f"SELECT * FROM user_accounts{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()
        # 在线状态：该考生当前还有未过期的登录会话（单端登录下即「正有一台设备在线」）
        active_ids = {
            r["subject_id"]
            for r in conn.execute(
                "SELECT DISTINCT subject_id FROM sessions "
                "WHERE subject_type = 'user' AND expires_at > ?",
                (now_iso(),),
            ).fetchall()
        }

    items = []
    for r in rows:
        d = _public(dict(r))
        d["online"] = d["id"] in active_ids
        items.append(d)

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": items,
    }


@router.get("/{user_id}", summary="考生详情")
def get_user(user_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        return _public(_get_or_404(conn, user_id))


# ── 增 ──────────────────────────────────────────────────────

@router.post("", summary="新增考生", status_code=201)
def create_user(body: UserCreateBody, admin: dict = Depends(get_current_admin)):
    if body.method and body.method not in METHODS:
        raise HTTPException(status_code=400, detail=f"报考方向只能是：{'/'.join(METHODS)}")

    with get_conn() as conn:
        if conn.execute(
            "SELECT 1 FROM user_accounts WHERE account = ?", (body.account.strip(),)
        ).fetchone():
            raise HTTPException(status_code=409, detail="该账号已存在")

        cursor = conn.execute(
            """INSERT INTO user_accounts
               (account, password_hash, org, nickname, avatar, real_name, method, status, remark, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                body.account.strip(),
                hash_password(body.password) if body.password else None,
                body.org.strip(),
                # 昵称 / 头像留空时随机生成，避免列表里一片空白（考生可自己在 App 里改）
                body.nickname.strip() or random_nickname(),
                body.avatar.strip() or random_avatar(),
                body.real_name.strip(),
                body.method.strip(),
                body.status,
                body.remark.strip(),
                now_iso(),
            ),
        )
        # 新考生自动收到「欢迎加入」系统通知（与注册审核通过同一条文案，见 modules/notifications.py）
        notifications.send_welcome_notice(conn, user_id=int(cursor.lastrowid))
        return _public(_get_or_404(conn, cursor.lastrowid))


# ── 改 ──────────────────────────────────────────────────────

@router.put("/{user_id}", summary="修改考生")
def update_user(user_id: int, body: UserUpdateBody, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        _get_or_404(conn, user_id)

        fields: list[str] = []
        params: list = []

        if body.account is not None:
            if conn.execute(
                "SELECT 1 FROM user_accounts WHERE account = ? AND id <> ?",
                (body.account.strip(), user_id),
            ).fetchone():
                raise HTTPException(status_code=409, detail="该账号已被其他考生使用")
            fields.append("account = ?")
            params.append(body.account.strip())
        if body.nickname is not None and body.nickname.strip():
            fields.append("nickname = ?")
            params.append(body.nickname.strip())
        if body.avatar is not None:
            fields.append("avatar = ?")
            params.append(body.avatar.strip())
        if body.real_name is not None:
            fields.append("real_name = ?")
            params.append(body.real_name.strip())
        if body.org is not None:
            fields.append("org = ?")
            params.append(body.org.strip())
        if body.method is not None:
            if body.method and body.method not in METHODS:
                raise HTTPException(status_code=400, detail=f"报考方向只能是：{'/'.join(METHODS)}")
            fields.append("method = ?")
            params.append(body.method.strip())
        if body.status is not None:
            fields.append("status = ?")
            params.append(body.status)
        if body.remark is not None:
            fields.append("remark = ?")
            params.append(body.remark.strip())
        if body.password is not None:
            fields.append("password_hash = ?")
            params.append(hash_password(body.password) if body.password else None)

        if not fields:
            raise HTTPException(status_code=400, detail="没有需要修改的内容")

        params.append(user_id)
        conn.execute(f"UPDATE user_accounts SET {', '.join(fields)} WHERE id = ?", params)

        # 改了密码 / 被禁用 → 踢掉已有会话，并立刻把在线端赶回登录页（不用等下次请求 401）
        kick_reason = ""
        if body.password is not None:
            kick_reason = (
                "管理员重置了你的密码，请用新密码重新登录"
                if body.password
                else "登录密码已被管理员清除，请联系管理员"
            )
        if body.status == 0:
            kick_reason = "账号已被管理员禁用，请联系管理员"
        if kick_reason:
            conn.execute(
                "DELETE FROM sessions WHERE subject_type = 'user' AND subject_id = ?", (user_id,)
            )
            realtime.kick_session(user_id, kick_reason)

        return _public(_get_or_404(conn, user_id))


# ── 删 ──────────────────────────────────────────────────────

@router.delete("/{user_id}", summary="删除考生")
def delete_user(user_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        target = _get_or_404(conn, user_id)
        conn.execute("DELETE FROM user_accounts WHERE id = ?", (user_id,))
        conn.execute(
            "DELETE FROM sessions WHERE subject_type = 'user' AND subject_id = ?", (user_id,)
        )
    # 事务提交后再推：账号确实没了，才把在线端赶回登录页
    realtime.kick_session(user_id, "账号已被管理员删除")
    return {"ok": True, "message": f"已删除考生 {target['account']}"}
