"""
题目纠错工单模块 —— 考生觉得某题答案有误 → 上报「认为的正确答案 + 理由」→ 管理员处理。

接口：
  考生端（需考生登录，router）：
    POST /api/user/question-reports        上报 {question_id, suggested_answer, reason}
                                           同一考生同一题的 pending 工单会被覆盖（防刷屏）
  管理端（需管理员登录，admin_router）：
    GET    /api/admin/question-reports                工单列表（?status=pending|resolved|dismissed，默认 pending）
    POST   /api/admin/question-reports/{id}/handle    处理 {action: "apply" | "dismiss"}
                                                       apply = 采纳：把题目正确答案改为考生建议的答案
                                                       dismiss = 忽略（不改题）
    DELETE /api/admin/question-reports/{id}           删除工单记录

数据模型：question_reports 表（见 database.py）；
  工单列表 JOIN questions（完整题干/选项/现答案）与 user_accounts（上报人账号/昵称）。

修改注意：
  - 「采纳」只改 questions.answer；如需改选项/题干，管理员用「题库管理」的编辑题目功能
  - 编辑题目（question_sets.update_question）会自动关闭该题的 pending 工单
"""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user

admin_router = APIRouter(prefix="/api/admin/question-reports", tags=["题目纠错"])
router = APIRouter(prefix="/api/user/question-reports", tags=["题目纠错"])

REPORT_STATUSES = ("pending", "resolved", "dismissed")


# ── 考生端：上报 ────────────────────────────────────────────

class ReportBody(BaseModel):
    question_id: int
    suggested_answer: str = Field(default="", max_length=1000)
    reason: str = Field(min_length=1, max_length=1000)


@router.post("", summary="上报题目疑问（答案疑似有误）")
def create_report(body: ReportBody, user: dict = Depends(get_current_user)):
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="请填写你的理由")
    with get_conn() as conn:
        q = conn.execute("SELECT id, qtype FROM questions WHERE id = ?", (body.question_id,)).fetchone()
        if not q:
            raise HTTPException(status_code=404, detail="题目不存在")
        # 同一考生同一题已有待处理工单 → 覆盖（允许修改建议答案/理由）
        dup = conn.execute(
            """SELECT id FROM question_reports
               WHERE question_id = ? AND user_id = ? AND status = 'pending'""",
            (body.question_id, user["id"]),
        ).fetchone()
        suggested = body.suggested_answer.strip()
        if dup:
            conn.execute(
                """UPDATE question_reports SET suggested_answer = ?, reason = ?, created_at = ?
                   WHERE id = ?""",
                (suggested, reason, now_iso(), dup["id"]),
            )
            return {"ok": True, "id": dup["id"], "message": "已更新你之前提交的疑问，管理员会尽快处理"}
        cur = conn.execute(
            """INSERT INTO question_reports
               (question_id, user_id, suggested_answer, reason, status, created_at)
               VALUES (?,?,?,?, 'pending', ?)""",
            (body.question_id, user["id"], suggested, reason, now_iso()),
        )
    return {"ok": True, "id": cur.lastrowid, "message": "已提交给管理员，感谢反馈"}


# ── 管理端：工单列表与处理 ──────────────────────────────────

def _report_item(conn, r) -> dict:
    d = row_to_dict(r)
    q = row_to_dict(conn.execute(
        "SELECT id, set_id, method, qtype, content, options_json, answer FROM questions WHERE id = ?",
        (d["question_id"],),
    ).fetchone() or {})
    from modules.question_sets import BUILTIN_SETS  # 局部导入避免循环依赖

    pseudo = next((b["id"] for b in BUILTIN_SETS if b["method"] == q.get("method")), None)
    options = []
    try:
        options = json.loads(q.get("options_json") or "[]")
    except Exception:
        options = []
    u = row_to_dict(conn.execute(
        "SELECT account, nickname FROM user_accounts WHERE id = ?", (d["user_id"],)
    ).fetchone() or {})
    return {
        "id": d["id"],
        "status": d["status"],
        "suggested_answer": d["suggested_answer"],
        "reason": d["reason"],
        "created_at": d["created_at"],
        "handled_by": d["handled_by"],
        "handled_at": d["handled_at"],
        "question": {
            "id": q.get("id", 0),
            "qtype": q.get("qtype", ""),
            "content": q.get("content", ""),
            "options": options,
            "answer": q.get("answer", ""),
            "method": q.get("method", ""),
            # 编辑题目接口用的题库 id：内置题库 = 负数伪 id，自定义 = set_id
            "set_id": q.get("set_id") if q.get("set_id") is not None else (pseudo if pseudo else 0),
        },
        "user": {"account": u.get("account", ""), "nickname": u.get("nickname", "")},
    }


@admin_router.get("", summary="纠错工单列表")
def list_reports(
    status: str = Query(default="pending", pattern="^(|pending|resolved|dismissed|all)$"),
    limit: int = Query(default=200, ge=1, le=1000),
    admin: dict = Depends(get_current_admin),
):
    sql = """SELECT r.* FROM question_reports r"""
    params: list = []
    if status and status != "all":
        sql += " WHERE r.status = ?"
        params.append(status)
    sql += " ORDER BY r.id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        return {"items": [_report_item(conn, r) for r in rows]}


class HandleBody(BaseModel):
    action: str = Field(pattern="^(apply|dismiss)$")


@admin_router.post("/{report_id}/handle", summary="处理工单（apply=采纳改答案 / dismiss=忽略）")
def handle_report(report_id: int, body: HandleBody, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        rep = conn.execute("SELECT * FROM question_reports WHERE id = ?", (report_id,)).fetchone()
        if not rep:
            raise HTTPException(status_code=404, detail="工单不存在")
        if rep["status"] != "pending":
            raise HTTPException(status_code=400, detail="该工单已处理过")

        if body.action == "apply":
            q = conn.execute(
                "SELECT id, qtype, options_json FROM questions WHERE id = ?", (rep["question_id"],)
            ).fetchone()
            if not q:
                raise HTTPException(status_code=404, detail="题目已被删除，无法采纳")
            suggested = rep["suggested_answer"].strip().upper()
            options = json.loads(q["options_json"])
            if q["qtype"] == "judge":
                if suggested not in ("A", "B"):
                    raise HTTPException(status_code=400, detail="判断题答案只能是 正确(A) / 错误(B)")
            elif q["qtype"] == "single":
                keys = [o.get("key") for o in options]
                if suggested not in keys:
                    raise HTTPException(status_code=400, detail=f"答案必须是选项字母之一：{'/'.join(keys)}")
            # calc / short 采纳原样写回
            conn.execute(
                "UPDATE questions SET answer = ? WHERE id = ?",
                (suggested if q["qtype"] in ("judge", "single") else rep["suggested_answer"].strip(), q["id"]),
            )
            conn.execute(
                """UPDATE question_reports SET status = 'resolved', handled_by = ?, handled_at = ?
                   WHERE id = ?""",
                (admin["username"], now_iso(), report_id),
            )
            return {"ok": True, "message": "已采纳：题目正确答案已更新，工单关闭"}

        conn.execute(
            """UPDATE question_reports SET status = 'dismissed', handled_by = ?, handled_at = ?
               WHERE id = ?""",
            (admin["username"], now_iso(), report_id),
        )
    return {"ok": True, "message": "已忽略该工单"}


@admin_router.delete("/{report_id}", summary="删除工单记录（不影响题目）")
def delete_report(report_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        row = conn.execute("SELECT id FROM question_reports WHERE id = ?", (report_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="工单不存在")
        conn.execute("DELETE FROM question_reports WHERE id = ?", (report_id,))
    return {"ok": True, "message": "工单记录已删除"}
