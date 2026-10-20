"""
注册申请模块 —— 考生自助注册 + 管理员审核。

完整流程：
  1. 考生在 App 登录页「注册」页填写：账号 / 密码 / 确认密码 / 单位或学校 / 图形验证码
      → POST /api/auth/register（公开接口）
  2. 提交后进入 registrations 表，状态 pending（待审核）——此时还不能登录
  3. 管理员在管理后台「注册申请」页审核：
       通过 → 在 user_accounts 建号（启用状态），考生即可用「账号 + 密码」登录
       拒绝 → 记录拒绝原因，考生仍无法登录

接口：
  公开
    POST   /api/auth/register                     提交注册申请
  管理员（均需管理员登录）
    GET    /api/admin/registrations               列表（关键词 / 状态 / 分页）
    GET    /api/admin/registrations/{id}          详情
    POST   /api/admin/registrations/{id}/approve  通过（自动建号）
    POST   /api/admin/registrations/{id}/reject   拒绝
    DELETE /api/admin/registrations/{id}          删除申请记录

修改注意：
  - 审核通过时才会写 user_accounts；通过后申请记录保留为 approved，便于追溯
  - 账号唯一性同时校验 user_accounts 与「待审核」的注册申请
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin
from modules import captcha as captcha_module
from modules import notifications
from profile_defaults import random_avatar, random_nickname
from security import hash_password

router = APIRouter(tags=["注册申请"])

# 登录账号规则：4-20 位字母 / 数字 / 下划线（与前端提示保持一致）
ACCOUNT_PATTERN = r"^[A-Za-z0-9_]{4,20}$"

STATUSES = ("pending", "approved", "rejected")


# ── 请求体 ──────────────────────────────────────────────────

class RegisterBody(BaseModel):
    account: str = Field(..., pattern=ACCOUNT_PATTERN, description="4-20 位字母 / 数字 / 下划线")
    password: str = Field(..., min_length=6, max_length=128)
    confirm_password: str = Field(..., min_length=6, max_length=128)
    org: str = Field(..., min_length=1, max_length=64, description="单位 / 学校")
    captcha_id: str = Field(..., min_length=1, max_length=64)
    captcha_code: str = Field(..., min_length=1, max_length=8)


class ApproveBody(BaseModel):
    password: Optional[str] = Field(
        None, min_length=6, max_length=128,
        description="留空则沿用考生注册时设置的密码；填写则用管理员指定的密码",
    )
    org: Optional[str] = Field(None, max_length=64, description="留空则沿用考生填写值")


class RejectBody(BaseModel):
    reason: str = Field("", max_length=200, description="拒绝原因，会记录在申请上")


# ── 内部工具 ────────────────────────────────────────────────

def _public(row: dict) -> dict:
    """对外返回申请记录：剔除密码哈希，给一个「是否设置了密码」的布尔值。"""
    row["has_password"] = bool(row.get("password_hash"))
    row.pop("password_hash", None)
    return row


def _get_or_404(conn, reg_id: int) -> dict:
    row = conn.execute("SELECT * FROM registrations WHERE id = ?", (reg_id,)).fetchone()
    data = row_to_dict(row)
    if not data:
        raise HTTPException(status_code=404, detail="注册申请不存在")
    return data


# ── 公开：提交注册申请 ──────────────────────────────────────

@router.post("/api/auth/register", summary="提交注册申请", status_code=201)
def register(body: RegisterBody):
    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="两次输入的密码不一致")

    # 先校验图形验证码（失败直接返回，不落库）
    try:
        captcha_module.verify(body.captcha_id, body.captcha_code)
    except captcha_module.CaptchaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    account = body.account.strip()
    with get_conn() as conn:
        if conn.execute("SELECT 1 FROM user_accounts WHERE account = ?", (account,)).fetchone():
            raise HTTPException(status_code=409, detail="该账号已被注册，请换一个")
        if conn.execute(
            "SELECT 1 FROM registrations WHERE account = ? AND status = 'pending'", (account,)
        ).fetchone():
            raise HTTPException(status_code=409, detail="该账号已提交注册申请，请等待管理员审核")

        cursor = conn.execute(
            """INSERT INTO registrations
               (account, password_hash, org, status, reject_reason, reviewed_by, reviewed_at, created_at)
               VALUES (?,?,?,'pending','','',NULL,?)""",
            (account, hash_password(body.password), body.org.strip(), now_iso()),
        )

    return {
        "ok": True,
        "message": "注册申请已提交，请等待管理员审核通过后再登录",
        "registration": {"id": cursor.lastrowid, "account": account, "status": "pending"},
    }


# ── 管理员：查（列表 / 详情） ───────────────────────────────

@router.get("/api/admin/registrations", summary="注册申请列表")
def list_registrations(
    q: str = Query("", description="按账号 / 单位学校模糊搜索"),
    status: str = Query("", description="pending / approved / rejected，留空为全部"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    admin: dict = Depends(get_current_admin),
):
    where, params = [], []
    if q.strip():
        where.append("(account LIKE ? OR org LIKE ?)")
        params += [f"%{q.strip()}%"] * 2
    if status.strip():
        if status.strip() not in STATUSES:
            raise HTTPException(status_code=400, detail="状态只能是 pending / approved / rejected")
        where.append("status = ?")
        params.append(status.strip())
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    with get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM registrations{clause}", params
        ).fetchone()["n"]
        rows = conn.execute(
            f"""SELECT * FROM registrations{clause}
                ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC
                LIMIT ? OFFSET ?""",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()
        pending = conn.execute(
            "SELECT COUNT(*) AS n FROM registrations WHERE status = 'pending'"
        ).fetchone()["n"]

    return {
        "total": total,
        "pending": pending,
        "page": page,
        "page_size": page_size,
        "items": [_public(dict(r)) for r in rows],
    }


@router.get("/api/admin/registrations/{reg_id}", summary="注册申请详情")
def get_registration(reg_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        return _public(_get_or_404(conn, reg_id))


# ── 管理员：审核 ────────────────────────────────────────────

@router.post("/api/admin/registrations/{reg_id}/approve", summary="通过注册申请（自动建号）")
def approve_registration(
    reg_id: int,
    body: ApproveBody = ApproveBody(),
    admin: dict = Depends(get_current_admin),
):
    with get_conn() as conn:
        reg = _get_or_404(conn, reg_id)
        if reg["status"] != "pending":
            raise HTTPException(status_code=400, detail="该申请已处理过，不能重复审核")
        if conn.execute(
            "SELECT 1 FROM user_accounts WHERE account = ?", (reg["account"],)
        ).fetchone():
            raise HTTPException(status_code=409, detail="该账号已存在，无法重复通过")

        password_hash = hash_password(body.password) if body.password else reg["password_hash"]
        org = (body.org or "").strip() or reg["org"]

        cursor = conn.execute(
            """INSERT INTO user_accounts
               (account, password_hash, org, nickname, avatar, real_name, method, status, remark, created_at)
               VALUES (?,?,?,?,?,'','',1,?,?)""",
            (
                reg["account"],
                password_hash,
                org,
                # 昵称 / 头像默认随机生成，考生登录后可在「我的」页自行修改
                random_nickname(),
                random_avatar(),
                f"注册申请通过（申请人单位/学校：{reg['org'] or '未填写'}）",
                now_iso(),
            ),
        )
        new_user_id = int(cursor.lastrowid)

        # 新考生自动收到一条「欢迎加入」系统通知（文案见 modules/notifications.py 的 WELCOME_*）
        notifications.send_welcome_notice(conn, user_id=new_user_id)

        conn.execute(
            """UPDATE registrations
               SET status = 'approved', reviewed_by = ?, reviewed_at = ?
               WHERE id = ?""",
            (admin["username"], now_iso(), reg_id),
        )

    return {"ok": True, "message": f"已通过「{reg['account']}」的注册申请，该考生现在可以登录"}


@router.post("/api/admin/registrations/{reg_id}/reject", summary="拒绝注册申请")
def reject_registration(reg_id: int, body: RejectBody, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        reg = _get_or_404(conn, reg_id)
        if reg["status"] != "pending":
            raise HTTPException(status_code=400, detail="该申请已处理过，不能重复审核")

        conn.execute(
            """UPDATE registrations
               SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ?
               WHERE id = ?""",
            (body.reason.strip(), admin["username"], now_iso(), reg_id),
        )

    return {"ok": True, "message": f"已拒绝「{reg['account']}」的注册申请"}


# ── 管理员：删 ──────────────────────────────────────────────

@router.delete("/api/admin/registrations/{reg_id}", summary="删除注册申请记录")
def delete_registration(reg_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        reg = _get_or_404(conn, reg_id)
        conn.execute("DELETE FROM registrations WHERE id = ?", (reg_id,))
    return {"ok": True, "message": f"已删除「{reg['account']}」的注册申请记录"}
