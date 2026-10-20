"""
密码重置申请模块 —— 考生提交申请（工单）+ 管理员处理。

数据表：password_resets（一张表，考生提交与管理员处理共用一条工单）

接口：
  考生端（公开，无需登录 —— 忘记密码的人本来就登不进来）
    POST /api/auth/password-reset    body { account, email }
  管理端（前缀 /api/admin/password-resets，需要管理员登录）
    GET    ""                     工单列表（关键词 / 状态筛选 + 分页）
    GET    "/{id}"                工单详情
    POST   "/{id}/approve"        处理：重置登录密码 + 发系统通知（正文含新密码）
    POST   "/{id}/reject"         拒绝（记录原因，考生密码不变、不收到通知）
    DELETE "/{id}"                删除工单记录（不影响考生当前密码）

业务规则：
  - 同一账号重复提交 → 覆盖原来那条「待处理」工单（与考生端提示文案一致），不会堆积
  - 处理时账号不存在 / 已禁用 → 400；工单已处理过 → 400（不能重复处理）
  - 重置密码会踢掉该考生所有会话；新密码以「系统通知」发送（考生不可删除）
  - 提交接口不返回「账号是否存在」，避免被用来探测账号

修改注意：
  - 账号规则 ACCOUNT_PATTERN 要与 registrations.py / user_accounts.py / 前端保持一致
  - 发通知统一走 notifications.py 的 send_system_notice()，不要在本文件直接写 notifications 表
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin
from modules import realtime
from modules.notifications import send_system_notice
from security import hash_password, new_random_password

# 考生端：公开接口（前缀与注册等认证类接口保持一致）
router = APIRouter(prefix="/api/auth", tags=["密码重置（考生端）"])

# 管理端
admin_router = APIRouter(prefix="/api/admin/password-resets", tags=["密码重置（管理端）"])

# 与 registrations.py / user_accounts.py 保持一致：4-20 位字母 / 数字 / 下划线
ACCOUNT_PATTERN = r"^[A-Za-z0-9_]{4,20}$"

# 邮箱：常规格式即可（不做真实可达性校验，仅核对身份用）
EMAIL_PATTERN = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
EMAIL_MAX = 100
REASON_MAX = 200

STATUS_LABEL = {"pending": "待处理", "done": "已处理", "rejected": "已拒绝"}


# ── 请求体 ──────────────────────────────────────────────────

class ApplyBody(BaseModel):
    account: str = Field(..., pattern=ACCOUNT_PATTERN, description="需要重置的登录账号")
    email: str = Field(..., pattern=EMAIL_PATTERN, max_length=EMAIL_MAX, description="考生邮箱，供管理员核对身份")


class ApproveBody(BaseModel):
    new_password: str = Field("", max_length=128, description="留空则由系统随机生成 8 位")


class RejectBody(BaseModel):
    reason: str = Field("", max_length=REASON_MAX)


# ── 考生端：提交申请 ────────────────────────────────────────

@router.post("/password-reset", summary="提交密码重置申请（无需登录）")
def apply_password_reset(body: ApplyBody):
    account = body.account.strip()
    email = body.email.strip()

    with get_conn() as conn:
        # 账号存在时顺手记下 user_id，便于管理员核对与追溯（不存在也不报错，避免探测账号）
        row = conn.execute(
            "SELECT id FROM user_accounts WHERE account = ?", (account,)
        ).fetchone()
        user_id = row["id"] if row else None

        pending = conn.execute(
            "SELECT id FROM password_resets WHERE account = ? AND status = 'pending'",
            (account,),
        ).fetchone()

        if pending:
            # 覆盖上一条待处理工单（不重复堆积）
            conn.execute(
                "UPDATE password_resets SET email = ?, user_id = ?, created_at = ? WHERE id = ?",
                (email, user_id, now_iso(), pending["id"]),
            )
            reset_id = pending["id"]
            message = "你已有一条待处理的申请，已用最新信息更新，请等待管理员处理"
        else:
            cursor = conn.execute(
                """INSERT INTO password_resets (account, email, user_id, status, reject_reason, created_at)
                   VALUES (?,?,?,'pending','',?)""",
                (account, email, user_id, now_iso()),
            )
            reset_id = cursor.lastrowid
            message = "申请已提交，管理员处理后会通过通知中心把新密码发送给你"

    return {"ok": True, "reset_id": reset_id, "message": message}


# ── 管理端：列表 / 详情 ─────────────────────────────────────

def _get_or_404(conn, reset_id: int) -> dict:
    row = conn.execute("SELECT * FROM password_resets WHERE id = ?", (reset_id,)).fetchone()
    data = row_to_dict(row)
    if not data:
        raise HTTPException(status_code=404, detail="该重置申请不存在")
    return data


@admin_router.get("", summary="密码重置工单列表")
def list_resets(
    q: str = Query("", description="按申请账号 / 邮箱模糊搜索"),
    status: str = Query("", description="pending / done / rejected，留空为全部"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    admin: dict = Depends(get_current_admin),
):
    where, params = [], []
    if q.strip():
        where.append("(account LIKE ? OR email LIKE ?)")
        params += [f"%{q.strip()}%"] * 2
    if status.strip():
        if status.strip() not in STATUS_LABEL:
            raise HTTPException(status_code=400, detail=f"状态只能是：{'/'.join(STATUS_LABEL)}")
        where.append("status = ?")
        params.append(status.strip())
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    with get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM password_resets{clause}", params
        ).fetchone()["n"]
        pending = conn.execute(
            "SELECT COUNT(*) AS n FROM password_resets WHERE status = 'pending'"
        ).fetchone()["n"]
        rows = conn.execute(
            f"SELECT * FROM password_resets{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size],
        ).fetchall()

    return {
        "total": total,
        "pending": pending,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


@admin_router.get("/{reset_id}", summary="密码重置工单详情")
def get_reset(reset_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        return _get_or_404(conn, reset_id)


# ── 管理端：处理（重置密码 + 发系统通知） ───────────────────

@admin_router.post("/{reset_id}/approve", summary="处理申请：重置密码并发送新密码通知")
def approve_reset(reset_id: int, body: ApproveBody, admin: dict = Depends(get_current_admin)):
    new_password = body.new_password.strip()
    if new_password and len(new_password) < 6:
        raise HTTPException(status_code=400, detail="新密码至少 6 位")

    with get_conn() as conn:
        ticket = _get_or_404(conn, reset_id)
        if ticket["status"] != "pending":
            raise HTTPException(
                status_code=400,
                detail=f"该工单已是「{STATUS_LABEL.get(ticket['status'], ticket['status'])}」，不能重复处理",
            )

        row = conn.execute(
            "SELECT * FROM user_accounts WHERE account = ?", (ticket["account"],)
        ).fetchone()
        if not row:
            raise HTTPException(
                status_code=400,
                detail=f"考生账号 {ticket['account']} 不存在（可能已被删除或改名），无法重置密码",
            )
        if not row["status"]:
            raise HTTPException(
                status_code=400, detail=f"考生账号 {ticket['account']} 已被禁用，请先在「考生账号」里启用"
            )

        final_password = new_password or new_random_password(8)
        user_id = row["id"]

        conn.execute(
            "UPDATE user_accounts SET password_hash = ? WHERE id = ?",
            (hash_password(final_password), user_id),
        )
        # 改完密码让该考生所有已登录会话立即失效，并立刻把在线端赶回登录页
        # （他重新登录后会在通知中心看到下面这条「密码重置成功」系统通知）
        conn.execute(
            "DELETE FROM sessions WHERE subject_type = 'user' AND subject_id = ?", (user_id,)
        )
        realtime.kick_session(user_id, "密码已被管理员重置，请用新密码重新登录")

        # 以「系统通知」把新密码发给考生（不可删除）
        send_system_notice(
            conn,
            user_id=user_id,
            title="密码重置成功",
            content=(
                "你的登录密码已由管理员重置。\n"
                f"新密码：{final_password}\n\n"
                "请用新密码登录后，立即到「我的 → 设置 → 账号安全」修改为你自己的密码。"
            ),
        )

        conn.execute(
            """UPDATE password_resets
               SET status = 'done', user_id = ?, reviewed_by = ?, reviewed_at = ?, reject_reason = ''
               WHERE id = ?""",
            (user_id, admin["username"], now_iso(), reset_id),
        )

    return {
        "ok": True,
        "account": ticket["account"],
        "new_password": final_password,
        "message": f"已重置 {ticket['account']} 的登录密码，并通过系统通知发送给该考生",
    }


# ── 管理端：拒绝 / 删除 ─────────────────────────────────────

@admin_router.post("/{reset_id}/reject", summary="拒绝申请")
def reject_reset(reset_id: int, body: RejectBody, admin: dict = Depends(get_current_admin)):
    reason = body.reason.strip()
    with get_conn() as conn:
        ticket = _get_or_404(conn, reset_id)
        if ticket["status"] != "pending":
            raise HTTPException(
                status_code=400,
                detail=f"该工单已是「{STATUS_LABEL.get(ticket['status'], ticket['status'])}」，不能重复处理",
            )
        conn.execute(
            """UPDATE password_resets
               SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ?
               WHERE id = ?""",
            (reason, admin["username"], now_iso(), reset_id),
        )
    return {"ok": True, "message": f"已拒绝 {ticket['account']} 的重置申请"}


@admin_router.delete("/{reset_id}", summary="删除重置申请记录")
def delete_reset(reset_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        ticket = _get_or_404(conn, reset_id)
        conn.execute("DELETE FROM password_resets WHERE id = ?", (reset_id,))
    return {"ok": True, "message": f"已删除 {ticket['account']} 的重置申请记录（不影响其当前密码）"}
