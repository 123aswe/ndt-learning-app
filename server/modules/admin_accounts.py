"""
管理员账号模块 —— 后台登录账号的增删查改。

接口（前缀 /api/admin/admins，全部需要管理员登录）：
  GET    ""        列表：支持关键词搜索、状态筛选、分页
  POST   ""        新增
  GET    "/{id}"   详情
  PUT    "/{id}"   修改（可同时改密码 / 状态 / 角色 / 姓名 / 备注）
  DELETE "/{id}"   删除

安全护栏（改本模块时务必保留）：
  1. 不能删除自己
  2. 不能删除 / 禁用最后一个「启用状态的超级管理员」
  3. 不能把最后一个超级管理员降级为普通管理员
  4. 用户名唯一
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin
from security import hash_password

router = APIRouter(prefix="/api/admin/admins", tags=["管理员账号"])

ROLES = ("super", "admin")


# ── 请求体 ──────────────────────────────────────────────────

class AdminCreateBody(BaseModel):
    username: str = Field(..., min_length=2, max_length=32, description="登录用户名")
    password: str = Field(..., min_length=6, max_length=128)
    real_name: str = Field("", max_length=32)
    role: str = Field("admin", description="super=超级管理员，admin=普通管理员")
    status: int = Field(1, ge=0, le=1, description="1 启用 / 0 禁用")
    remark: str = Field("", max_length=200)


class AdminUpdateBody(BaseModel):
    real_name: Optional[str] = Field(None, max_length=32)
    role: Optional[str] = None
    status: Optional[int] = Field(None, ge=0, le=1)
    remark: Optional[str] = Field(None, max_length=200)
    password: Optional[str] = Field(None, min_length=6, max_length=128, description="留空表示不改密码")


# ── 内部工具 ────────────────────────────────────────────────

def _public(row: dict) -> dict:
    row.pop("password_hash", None)
    return row


def _count_active_supers(conn, exclude_id: Optional[int] = None) -> int:
    sql = "SELECT COUNT(*) AS n FROM admin_accounts WHERE role = 'super' AND status = 1"
    params: list = []
    if exclude_id is not None:
        sql += " AND id <> ?"
        params.append(exclude_id)
    return conn.execute(sql, params).fetchone()["n"]


def _get_or_404(conn, admin_id: int) -> dict:
    row = conn.execute("SELECT * FROM admin_accounts WHERE id = ?", (admin_id,)).fetchone()
    data = row_to_dict(row)
    if not data:
        raise HTTPException(status_code=404, detail="管理员不存在")
    return data


# ── 查（列表 / 详情） ───────────────────────────────────────

@router.get("", summary="管理员列表")
def list_admins(
    q: str = Query("", description="按用户名 / 姓名 / 备注模糊搜索"),
    status: Optional[int] = Query(None, ge=0, le=1),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    admin: dict = Depends(get_current_admin),
):
    where, params = [], []
    if q.strip():
        where.append("(username LIKE ? OR real_name LIKE ? OR remark LIKE ?)")
        params += [f"%{q.strip()}%"] * 3
    if status is not None:
        where.append("status = ?")
        params.append(status)
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    with get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM admin_accounts{clause}", params
        ).fetchone()["n"]
        rows = conn.execute(
            f"SELECT * FROM admin_accounts{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_public(dict(r)) for r in rows],
    }


@router.get("/{admin_id}", summary="管理员详情")
def get_admin(admin_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        return _public(_get_or_404(conn, admin_id))


# ── 增 ──────────────────────────────────────────────────────

@router.post("", summary="新增管理员", status_code=201)
def create_admin(body: AdminCreateBody, admin: dict = Depends(get_current_admin)):
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail="角色只能是 super 或 admin")

    with get_conn() as conn:
        if conn.execute(
            "SELECT 1 FROM admin_accounts WHERE username = ?", (body.username.strip(),)
        ).fetchone():
            raise HTTPException(status_code=409, detail="该用户名已存在")

        cursor = conn.execute(
            """INSERT INTO admin_accounts
               (username, password_hash, real_name, role, status, remark, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (
                body.username.strip(),
                hash_password(body.password),
                body.real_name.strip(),
                body.role,
                body.status,
                body.remark.strip(),
                now_iso(),
            ),
        )
        return _public(_get_or_404(conn, cursor.lastrowid))


# ── 改 ──────────────────────────────────────────────────────

@router.put("/{admin_id}", summary="修改管理员")
def update_admin(admin_id: int, body: AdminUpdateBody, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        target = _get_or_404(conn, admin_id)

        fields: list[str] = []
        params: list = []

        if body.role is not None:
            if body.role not in ROLES:
                raise HTTPException(status_code=400, detail="角色只能是 super 或 admin")
            # 护栏：不能把最后一个启用的超管降级
            if target["role"] == "super" and body.role != "super" and target["status"] == 1:
                if _count_active_supers(conn, exclude_id=admin_id) == 0:
                    raise HTTPException(status_code=400, detail="至少要保留一个启用状态的超级管理员")
            fields.append("role = ?")
            params.append(body.role)

        if body.status is not None:
            # 护栏：不能禁用最后一个启用的超管；不能禁用自己
            if body.status == 0 and target["role"] == "super" and target["status"] == 1:
                if _count_active_supers(conn, exclude_id=admin_id) == 0:
                    raise HTTPException(status_code=400, detail="至少要保留一个启用状态的超级管理员")
            if body.status == 0 and admin_id == admin["id"]:
                raise HTTPException(status_code=400, detail="不能禁用当前登录的账号")
            fields.append("status = ?")
            params.append(body.status)

        if body.real_name is not None:
            fields.append("real_name = ?")
            params.append(body.real_name.strip())
        if body.remark is not None:
            fields.append("remark = ?")
            params.append(body.remark.strip())
        if body.password:
            fields.append("password_hash = ?")
            params.append(hash_password(body.password))

        if not fields:
            raise HTTPException(status_code=400, detail="没有需要修改的内容")

        params.append(admin_id)
        conn.execute(f"UPDATE admin_accounts SET {', '.join(fields)} WHERE id = ?", params)

        # 改了密码 / 被禁用 → 踢掉该账号已有会话，强制重新登录
        if body.password or body.status == 0 or body.role is not None:
            conn.execute(
                "DELETE FROM sessions WHERE subject_type = 'admin' AND subject_id = ?",
                (admin_id,),
            )

        return _public(_get_or_404(conn, admin_id))


# ── 删 ──────────────────────────────────────────────────────

@router.delete("/{admin_id}", summary="删除管理员")
def delete_admin(admin_id: int, admin: dict = Depends(get_current_admin)):
    if admin_id == admin["id"]:
        raise HTTPException(status_code=400, detail="不能删除当前登录的账号")

    with get_conn() as conn:
        target = _get_or_404(conn, admin_id)
        if target["role"] == "super" and target["status"] == 1:
            if _count_active_supers(conn, exclude_id=admin_id) == 0:
                raise HTTPException(status_code=400, detail="至少要保留一个启用状态的超级管理员")

        conn.execute("DELETE FROM admin_accounts WHERE id = ?", (admin_id,))
        conn.execute(
            "DELETE FROM sessions WHERE subject_type = 'admin' AND subject_id = ?", (admin_id,)
        )
    return {"ok": True, "message": f"已删除管理员 {target['username']}"}
