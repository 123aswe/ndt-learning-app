"""
通知模块 —— 管理员发通知 + 考生收通知。

数据表（本模块私有，其它模块不要直接写它）：
  notifications          每个接收考生一行（考生端「通知中心」读这张表）
  notification_batches   一次发送 = 一条批次记录（后台「已发送记录」读这张表）

接口：
  考生端（前缀 /api/user/notifications，需要考生登录）
    GET    ""                 我的通知列表（items + unread，按时间倒序，最多 200 条）
    POST   "/{id}/read"       标记一条已读
    POST   "/read-all"        全部标记已读
    DELETE "/{id}"            删除一条（系统通知不可删 → 403）

  管理端（前缀 /api/admin/notifications，需要管理员登录）
    GET    "/candidates"      候选接收考生（已注册且启用；支持关键词搜索，供「指定考生」选择器用）
    POST   ""                 发送通知
    GET    ""                 已发送记录（按批次聚合、分页）
    DELETE "/{batch_id}"      删除通知（后台记录隐藏 + 考生端对应通知一并移除，并实时通知在线考生）

给其它模块用的写通知工具（密码重置、新用户欢迎等场景，别自己去 INSERT）：
    new_batch_id() / create_batch() / push_notification() / send_system_notice() / send_welcome_notice()

修改注意：
  - 通知类型只有两种：system（考生不可删除）/ notice（考生可删除），
    前端 src/data/notifications.ts 与后台 dashboard.html 的下拉要与此保持一致
  - 「一个账号只能发一次」= 同一次发送里账号自动去重（见 send_notification 的 _dedupe_accounts）
  - 考生端删除是软删（deleted = 1），批次里的 receiver_count 不会因此变化
  - **管理员删除是「真删」语义**：批次 hidden = 1（后台不再显示）+ 该批次所有考生通知 deleted = 1，
    并推 EVENT_NOTIFICATION_REMOVED 让在线考生立刻消失（见 delete_batch）；
    考生端读列表时还会再校验一次批次是否 hidden（双保险，见 my_notifications）——
    改版前留下的「后台删了、考生端还在」的残留由 database.py 的
    _backfill_notify_hidden_batches() 一次性清理
  - **实时推送接在 push_notification 里**（见 modules/realtime.py）：所有通知路径都汇到这一处，
    所以「秒达」是全局生效的。新增发通知的业务时不要另写 INSERT，否则考生端收不到即时推送。
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user
from modules import realtime

router = APIRouter(prefix="/api/user/notifications", tags=["通知（考生端）"])
admin_router = APIRouter(prefix="/api/admin/notifications", tags=["通知（管理端）"])

# 通知类型（前端 src/data/notifications.ts 的 NOTIFICATION_TYPE_LABEL 要同步）
TYPES = ("system", "notice")
TYPE_LABEL = {"system": "系统通知", "notice": "普通通知"}

TITLE_MAX = 40
CONTENT_MAX = 1000

# ── 新用户欢迎通知（自动推送，改文案就改这两行） ─────────────
# 触发点：注册申请审核通过建号（modules/registrations.py）、管理员在后台手动新增考生（modules/user_accounts.py）
WELCOME_TITLE = "欢迎加入 NDT-劳人"

WELCOME_CONTENT = (
    "欢迎加入 NDT-劳人！从今天起，这里陪你一起把 NDT 一级考下来。\n"
    "\n"
    "你可以从这里开始：\n"
    "· 题库刷题 —— UT / RT / MT / PT 等方向 1740 道题，支持按方向、章节、题型练习\n"
    "· 模拟考试 —— 按真实考试节奏抽题，到点自动交卷，成绩随时回看\n"
    "· 资料库与视频课程 —— 标准规范、教材在线预览，课程视频随时看\n"
    "· 错题本与成就 —— 答错的题自动收进错题本，坚持打卡还能解锁成就勋章\n"
    "\n"
    "先去「题库」做上 20 道题找找感觉吧，每天一点点，考试更有底。祝你早日拿证！"
)

# 考生端一次最多返回多少条（超出请让管理员清理旧通知）
LIST_LIMIT = 200

# 「指定考生」选择器一次最多返回多少个候选
CANDIDATE_LIMIT_MAX = 100


# ── 请求体 ──────────────────────────────────────────────────

class SendNotifyBody(BaseModel):
    scope: str = Field("all", description="all = 全部启用考生；one = 指定考生")
    accounts: list[str] = Field(default_factory=list, description="指定考生的账号列表（重复会自动去掉）")
    type: str = Field("notice", description="system = 系统通知（考生不可删）/ notice = 普通通知")
    title: str = Field(..., max_length=TITLE_MAX)
    content: str = Field(..., max_length=CONTENT_MAX)


# ── 写通知的内部工具（其它模块也可调用） ────────────────────

def new_batch_id() -> str:
    """生成一个批次 id：nb + 16 位十六进制。"""
    return "nb" + secrets.token_hex(8)


def create_batch(
    conn,
    *,
    scope: str,
    type_: str,
    title: str,
    content: str,
    sender: str,
    target_desc: str,
    accounts: list[str],
) -> str:
    """写一条批次记录，返回 batch_id。accounts 为最终接收账号（已去重）。"""
    batch_id = new_batch_id()
    conn.execute(
        """INSERT INTO notification_batches
           (id, type, title, content, scope, target_desc, accounts, receiver_count, sender, hidden, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,0,?)""",
        (
            batch_id,
            type_,
            title,
            content,
            scope,
            target_desc,
            ",".join(accounts),
            len(accounts),
            sender,
            now_iso(),
        ),
    )
    return batch_id


def push_notification(
    conn,
    *,
    user_id: int,
    type_: str,
    title: str,
    content: str,
    sender: str,
    batch_id: str,
) -> None:
    """给某个考生写一条通知，并立刻推给他的在线连接（这是通知「秒达」的唯一落点）。

    所有发通知的路径（管理员群发 / 视频评论回复 / 密码重置结果）最终都走这里，
    所以只要这一处接了实时推送，全站通知就都是即时的。

    推送是「尽力而为」：考生不在线直接丢弃，他上线后前端会拉一次列表补齐；
    通知 id 用 lastrowid 回填，前端据此判断是不是「没见过的新通知」。
    """
    created_at = now_iso()
    cursor = conn.execute(
        """INSERT INTO notifications
           (batch_id, user_id, type, title, content, sender, read_at, deleted, created_at)
           VALUES (?,?,?,?,?,?,NULL,0,?)""",
        (batch_id, user_id, type_, title, content, sender, created_at),
    )
    # 字段结构与考生端 GET /api/user/notifications 的单条完全一致，
    # 前端收到后不用再请求一次就能直接渲染（见 src/api/realtime.ts）
    realtime.publish(
        user_id,
        realtime.EVENT_NOTIFICATION,
        {
            "id": cursor.lastrowid,
            "type": type_,
            "title": title,
            "content": content,
            "sender": sender or "系统",
            "created_at": created_at,
            "read": False,
            "deletable": type_ != "system",
        },
    )


def send_system_notice(conn, *, user_id: int, title: str, content: str, sender: str = "系统") -> str:
    """给单个考生发一条系统通知（不可删除），并在后台留下一条发送记录。

    用于密码重置等系统场景（调用方需已持有数据库连接，事务一起提交）；返回 batch_id。
    """
    account_row = conn.execute(
        "SELECT account FROM user_accounts WHERE id = ?", (user_id,)
    ).fetchone()
    account = account_row["account"] if account_row else str(user_id)
    batch_id = create_batch(
        conn,
        scope="one",
        type_="system",
        title=title,
        content=content,
        sender=sender,
        target_desc=f"账号 {account}",
        accounts=[account],
    )
    push_notification(
        conn,
        user_id=user_id,
        type_="system",
        title=title,
        content=content,
        sender=sender,
        batch_id=batch_id,
    )
    return batch_id


def send_welcome_notice(conn, *, user_id: int) -> str:
    """给新考生发「欢迎加入」系统通知（不可删除），并在后台留一条发送记录。

    调用时机 = 账号刚创建出来（注册审核通过 / 后台手动新增考生）。
    考生此刻通常不在线，实时推送会被静默丢弃，等他首次登录拉列表时就能看到。
    返回 batch_id。
    """
    return send_system_notice(
        conn,
        user_id=user_id,
        title=WELCOME_TITLE,
        content=WELCOME_CONTENT,
        sender="系统",
    )


# ── 考生端 ──────────────────────────────────────────────────

def _my_item(row) -> dict:
    """考生端单条通知的对外结构。"""
    return {
        "id": row["id"],
        "type": row["type"],
        "title": row["title"],
        "content": row["content"],
        "sender": row["sender"] or "系统",
        "created_at": row["created_at"],
        "read": bool(row["read_at"]),
        # 前端据此决定要不要显示删除按钮（同时也以后端校验为准）
        "deletable": row["type"] != "system",
    }


@router.get("", summary="我的通知（考生端通知中心）")
def my_notifications(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        # 除了看 deleted，还要求「所属批次没被管理员删掉」——
        # 双保险：即使历史数据里漏标了 deleted（改版前的残留），考生端也不会再显示，
        # 因为「管理员删掉了」就等于这条通知不该存在（见 delete_batch）。
        rows = conn.execute(
            """SELECT n.id, n.type, n.title, n.content, n.sender, n.read_at, n.created_at
               FROM notifications n
               WHERE n.user_id = ? AND n.deleted = 0
                 AND NOT EXISTS (
                       SELECT 1 FROM notification_batches b
                       WHERE b.id = n.batch_id AND b.hidden = 1
                     )
               ORDER BY n.id DESC LIMIT ?""",
            (user["id"], LIST_LIMIT),
        ).fetchall()
    items = [_my_item(r) for r in rows]
    return {
        "items": items,
        "unread": sum(1 for i in items if not i["read"]),
        "total": len(items),
    }


def _get_my_notification(conn, user_id: int, notification_id: int) -> dict:
    """取一条「考生自己还看得见」的通知；不存在 / 已删 / 所属批次被管理员删掉 → 404。"""
    row = conn.execute(
        """SELECT n.* FROM notifications n
           WHERE n.id = ? AND n.user_id = ? AND n.deleted = 0
             AND NOT EXISTS (
                   SELECT 1 FROM notification_batches b
                   WHERE b.id = n.batch_id AND b.hidden = 1
                 )""",
        (notification_id, user_id),
    ).fetchone()
    data = row_to_dict(row)
    if not data:
        raise HTTPException(status_code=404, detail="通知不存在或已删除")
    return data


@router.post("/{notification_id}/read", summary="标记一条通知为已读")
def mark_read(notification_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        _get_my_notification(conn, user["id"], notification_id)
        # 已读时间只在第一次写入，不覆盖
        conn.execute(
            "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ?",
            (now_iso(), notification_id),
        )
    return {"ok": True}


@router.post("/read-all", summary="全部标记为已读")
def mark_all_read(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        cursor = conn.execute(
            """UPDATE notifications SET read_at = ?
               WHERE user_id = ? AND deleted = 0 AND read_at IS NULL""",
            (now_iso(), user["id"]),
        )
        count = cursor.rowcount or 0
    return {"ok": True, "count": count, "message": "已全部标记为已读"}


@router.delete("/{notification_id}", summary="删除一条通知（系统通知不可删）")
def delete_notification(notification_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        target = _get_my_notification(conn, user["id"], notification_id)
        if target["type"] == "system":
            raise HTTPException(status_code=403, detail="系统通知不可删除")
        conn.execute("UPDATE notifications SET deleted = 1 WHERE id = ?", (notification_id,))
    return {"ok": True, "message": "通知已删除"}


# ── 管理端：候选接收考生（「指定考生」选择器） ──────────────

@admin_router.get("/candidates", summary="候选接收考生（指定考生选择器用）")
def candidates(
    q: str = Query("", description="按账号 / 昵称 / 姓名 / 单位学校模糊搜索"),
    limit: int = Query(20, ge=1, le=CANDIDATE_LIMIT_MAX),
    admin: dict = Depends(get_current_admin),
):
    """只返回「已注册且启用」的考生，供后台选择接收对象。

    返回字段刻意保持最小（id / 账号 / 昵称 / 单位），避免误用于批量删除等操作。
    """
    where = ["status = 1"]
    params: list = []
    if q.strip():
        where.append("(account LIKE ? OR nickname LIKE ? OR real_name LIKE ? OR org LIKE ?)")
        params += [f"%{q.strip()}%"] * 4
    clause = " WHERE " + " AND ".join(where)

    with get_conn() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS n FROM user_accounts{clause}", params).fetchone()["n"]
        rows = conn.execute(
            f"""SELECT id, account, nickname, org, real_name, avatar
                FROM user_accounts{clause}
                ORDER BY account ASC LIMIT ?""",
            params + [limit],
        ).fetchall()
    return {"total": total, "items": [dict(r) for r in rows], "limit": limit}


# ── 管理端：发送通知 ────────────────────────────────────────

def _dedupe_accounts(accounts: list[str]) -> list[str]:
    """去掉空值并去重（保留输入顺序）—— 保证「同一个账号只发一次」。"""
    seen: set[str] = set()
    result: list[str] = []
    for raw in accounts:
        key = (raw or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


@admin_router.post("", summary="发送通知", status_code=201)
def send_notification(body: SendNotifyBody, admin: dict = Depends(get_current_admin)):
    scope = (body.scope or "all").strip()
    if scope not in ("all", "one"):
        raise HTTPException(status_code=400, detail="接收对象只能是「全部考生」或「指定考生」")

    notify_type = (body.type or "notice").strip()
    if notify_type not in TYPES:
        raise HTTPException(status_code=400, detail=f"通知类型只能是：{'/'.join(TYPES)}")

    title = body.title.strip()
    content = body.content.strip()
    if not title:
        raise HTTPException(status_code=400, detail="请填写通知标题")
    if not content:
        raise HTTPException(status_code=400, detail="请填写通知内容")

    with get_conn() as conn:
        if scope == "all":
            rows = conn.execute(
                "SELECT id, account FROM user_accounts WHERE status = 1 ORDER BY id ASC"
            ).fetchall()
            if not rows:
                raise HTTPException(status_code=400, detail="当前没有启用的考生账号，无法发送")
            targets = [(r["id"], r["account"]) for r in rows]
            target_desc = "全部启用考生"
        else:
            accounts = _dedupe_accounts(body.accounts)
            if not accounts:
                raise HTTPException(status_code=400, detail="请至少选择一个接收考生")

            targets = []
            invalid: list[str] = []
            for account in accounts:
                row = conn.execute(
                    "SELECT id, account, status FROM user_accounts WHERE account = ?", (account,)
                ).fetchone()
                if not row:
                    invalid.append(f"{account}（账号不存在）")
                elif not row["status"]:
                    invalid.append(f"{account}（账号已禁用）")
                else:
                    targets.append((row["id"], row["account"]))
            if invalid:
                raise HTTPException(status_code=400, detail="以下账号无法接收通知：" + "、".join(invalid))

            target_desc = (
                "、".join(a for _, a in targets)
                if len(targets) <= 8
                else f"{len(targets)} 个指定考生"
            )

        accounts_snapshot = [a for _, a in targets]
        batch_id = create_batch(
            conn,
            scope=scope,
            type_=notify_type,
            title=title,
            content=content,
            sender=admin["username"],
            target_desc=target_desc,
            accounts=accounts_snapshot,
        )
        for user_id, _account in targets:
            push_notification(
                conn,
                user_id=user_id,
                type_=notify_type,
                title=title,
                content=content,
                sender=admin["username"],
                batch_id=batch_id,
            )

    message = (
        f"已发送给全部考生（{len(targets)} 人）"
        if scope == "all"
        else f"已发送给 {len(targets)} 位考生"
    )
    return {
        "ok": True,
        "batch_id": batch_id,
        "count": len(targets),
        "message": message,
        "type_label": TYPE_LABEL[notify_type],
    }


# ── 管理端：已发送记录 ──────────────────────────────────────

def _batch_item(row) -> dict:
    data = dict(row)
    data.pop("hidden", None)
    data["type_label"] = TYPE_LABEL.get(data["type"], data["type"])
    data["accounts"] = [a for a in (data["accounts"] or "").split(",") if a]
    return data


@admin_router.get("", summary="已发送记录（按批次）")
def list_batches(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    admin: dict = Depends(get_current_admin),
):
    with get_conn() as conn:
        total = conn.execute(
            "SELECT COUNT(*) AS n FROM notification_batches WHERE hidden = 0"
        ).fetchone()["n"]
        rows = conn.execute(
            """SELECT * FROM notification_batches
               WHERE hidden = 0
               ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?""",
            (page_size, (page - 1) * page_size),
        ).fetchall()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_batch_item(r) for r in rows],
    }


@admin_router.delete("/{batch_id}", summary="删除通知（后台记录 + 考生端一起移除）")
def delete_batch(batch_id: str, admin: dict = Depends(get_current_admin)):
    """删除一次发送的通知：后台记录隐藏，考生端也一并消失（在线考生实时消失）。

    早先的语义是「只隐藏后台记录、考生端保留」，现在改成两边一起删 ——
    管理员在后台删掉一条通知，就是想让它别出现在考生那里。
    """
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM notification_batches WHERE id = ?", (batch_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="发送记录不存在")

        # 先取出这一次发送给谁发了哪些条（要按考生分组推送「移除」事件）
        rows = conn.execute(
            """SELECT id, user_id FROM notifications
               WHERE batch_id = ? AND deleted = 0""",
            (batch_id,),
        ).fetchall()
        by_user: dict[int, list[int]] = {}
        for r in rows:
            by_user.setdefault(r["user_id"], []).append(r["id"])

        conn.execute("UPDATE notification_batches SET hidden = 1 WHERE id = ?", (batch_id,))
        conn.execute("UPDATE notifications SET deleted = 1 WHERE batch_id = ?", (batch_id,))

    # 事务外推送：在线的考生立刻从列表里去掉这几条（不在线的下次拉列表也不会再拿到）
    for user_id, ids in by_user.items():
        realtime.publish(user_id, realtime.EVENT_NOTIFICATION_REMOVED, {"ids": ids})

    removed = len(rows)
    message = (
        f"已删除该通知，考生端的 {removed} 条对应通知也已移除"
        if removed
        else "已删除该发送记录"
    )
    return {"ok": True, "removed": removed, "message": message}
