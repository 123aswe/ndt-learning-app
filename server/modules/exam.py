"""
模拟考试模块 —— 开卷（随机抽题）/ 交卷（服务端判分）/ 考试成绩与试卷回看。

接口（全部需要考生登录，数据按 user_id 严格隔离）：
  POST /api/exam/start
       开卷：按 方向/自定义题库 + 题型筛选 随机抽题，创建一场考试（exams 表 in_progress）。
       返回的题目**不带正确答案**（防止前端偷看），判分完全在服务端。
  POST /api/exam/submit
       交卷：服务端逐题判分，写 exam_answers + answer_records（session_id = exam_id），
       更新 exams 行为 finished（含得分/用时/是否自动交卷）。幂等：重复提交返回已有结果。
  GET  /api/exam/records/{exam_id}
       试卷回看：考试信息 + 每道题（含正确答案、我的答案、对错）。

数据流设计：
  - exams.id 同时作为 answer_records.session_id → 考试答题照常进统计/XP，
    并自然出现在 GET /api/user/practice/history（该接口已 LEFT JOIN exams 带出 is_exam/score）
  - 试卷快照存在 exams.question_ids：开卷那一刻的题目集合固定，之后题库变动不影响本场考试
  - 未作答的题不写 exam_answers / answer_records（与练习口径一致），判分按错算

修改注意：
  - 改判分逻辑只需要动 _grade_answer()（它转发到 bank.answers_match，与练习页前端同口径）；
    多选（multi）按字母集合比对，顺序无关
  - 新增题型只要在 bank.QTYPE_NAMES 里登记就能被本模块的出题筛选识别，判分自动走新口径
"""

import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_user
from modules.bank import (
    MULTI_QTYPES,
    METHOD_NAMES,
    QTYPE_FILTER,
    QTYPE_NAMES,
    _question_public,
    answers_match,
    normalize_multi_answer,
)

router = APIRouter(prefix="/api/exam", tags=["模拟考试"])


# ── 请求体 ──────────────────────────────────────────────────

class StartBody(BaseModel):
    category: str = Field(default="综合", max_length=8)      # 方向代码 / 综合
    set_id: int = Field(default=0, ge=0)                     # 自定义题库 id（0 = 内置）
    set_ids: list[int] = Field(default_factory=list, max_length=100)  # 多题库合集（v1.77 系列全部）
    qtype: str = Field(default="", pattern=QTYPE_FILTER)
    count: int = Field(default=50, ge=1, le=200)             # 抽题数量（超过库存取库存）
    duration_minutes: int = Field(default=60, ge=1, le=300)  # 考试时长


class SubmitAnswer(BaseModel):
    question_id: int
    # 选择/判断题是选项字母（<=8 个选项）；计算题是考生手写的答案文本，所以留到 200 字
    user_answer: str = Field(default="", max_length=200)


class SubmitBody(BaseModel):
    exam_id: str = Field(max_length=40)
    time_used_seconds: int = Field(default=0, ge=0, le=24 * 3600)
    auto: bool = False                                       # True = 倒计时到点自动交卷
    answers: list[SubmitAnswer] = Field(default_factory=list, max_length=200)


# ── 内部工具 ────────────────────────────────────────────────

def _grade_answer(qtype: str, my_answer: str, correct: str) -> bool:
    """判分：走 bank.answers_match 的统口径（多选按字母集合比，其余 strip + upper）。

    口径与练习页前端完全一致（前端 src/data/qtypes.ts 的 answersMatch），改判分逻辑只需动这里。
    """
    return answers_match(qtype, my_answer, correct)


def _get_own_exam(conn, exam_id: str, user_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM exams WHERE id = ? AND user_id = ?", (exam_id, user_id)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="考试不存在或已删除")
    return row_to_dict(row)


def _exam_summary(exam: dict) -> dict:
    """exams 行 → 对外的成绩摘要（回看/结果页共用）。"""
    total = exam["total"] or 0
    correct = exam["correct"] or 0
    return {
        "exam_id": exam["id"],
        "title": exam["title"],
        "category": exam["category"],
        "category_name": METHOD_NAMES.get(exam["category"], exam["category"]) if exam["category"] else "",
        "qtype": exam["qtype"],
        "qtype_name": QTYPE_NAMES.get(exam["qtype"], "全部题型") if exam["qtype"] else "全部题型",
        "duration_minutes": exam["duration_minutes"],
        "total": total,
        "correct": correct,
        "wrong": max(total - correct, 0),
        "score": exam["score"] or 0,
        "time_used": exam["time_used"] or 0,
        "auto_submitted": bool(exam["auto_submitted"]),
        "status": exam["status"],
        "started_at": exam["started_at"],
        "finished_at": exam["finished_at"] or "",
    }


# ── 开卷 ────────────────────────────────────────────────────

@router.post("/start", summary="开卷：随机抽题创建一场模拟考试")
def start_exam(body: StartBody, user: dict = Depends(get_current_user)):
    """按范围（自定义题库 / 方向 + 题型）随机抽 count 题；
    返回的题目不带正确答案，交卷时由服务端判分。"""
    with get_conn() as conn:
        # ── 出题范围 ──
        title = ""
        if body.set_ids:
            # v1.77 多题库合集（题库系列「系列全部」）：
            #   全部题库同属一个系列 → 试卷名用系列名；单个散题库 → 题库名；混搭 → 自选题库合集
            ids = sorted({i for i in body.set_ids if i > 0})
            if not ids:
                raise HTTPException(status_code=400, detail="题库范围不合法")
            ph = ",".join("?" * len(ids))
            sets_rows = conn.execute(
                f"SELECT id, name, series_id FROM question_sets WHERE id IN ({ph})", ids
            ).fetchall()
            if len(sets_rows) != len(ids):
                raise HTTPException(status_code=404, detail="题库不存在")
            where, params = f"WHERE set_id IN ({ph})", list(ids)
            sids = {r["series_id"] for r in sets_rows}
            if len(sids) == 1:
                sid = next(iter(sids))
                if sid:
                    srow = conn.execute("SELECT name FROM question_set_series WHERE id = ?", (sid,)).fetchone()
                    title = srow["name"] if srow else "题库系列合集"
                elif len(sets_rows) == 1:
                    title = sets_rows[0]["name"]
                else:
                    title = "自选题库合集"
            else:
                title = "自选题库合集"
            category = ""
        elif body.set_id:
            s = conn.execute("SELECT id, name FROM question_sets WHERE id = ?", (body.set_id,)).fetchone()
            if not s:
                raise HTTPException(status_code=404, detail="题库不存在")
            where, params = "WHERE set_id = ?", [body.set_id]
            title = s["name"]
            category = ""
        else:
            where, params = "", []
            if body.category and body.category != "综合":
                where = "WHERE method = ?"
                params.append(body.category)
            category = body.category
            title = METHOD_NAMES.get(body.category, "全部方向") if body.category != "综合" else "综合卷"

        if body.qtype:
            where += " AND qtype = ?" if where else "WHERE qtype = ?"
            params.append(body.qtype)
            title += f" · {QTYPE_NAMES.get(body.qtype, body.qtype)}"

        rows = conn.execute(
            f"SELECT * FROM questions {where} ORDER BY RANDOM() LIMIT ?",
            (*params, body.count),
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="该范围内没有题目，换一个范围试试")

        question_ids = [r["id"] for r in rows]
        exam_id = "ex" + secrets.token_hex(8)
        conn.execute(
            """INSERT INTO exams
               (id, user_id, title, category, set_id, qtype, question_ids,
                duration_minutes, total, started_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                exam_id, user["id"], title, category, body.set_id, body.qtype,
                json.dumps(question_ids), body.duration_minutes, len(question_ids), now_iso(),
            ),
        )

        # 题目公开格式但**不带 answer / explanation**（考试模式防偷看：
        # 解答过程里往往就写着答案）
        questions = []
        for r in rows:
            pub = _question_public(row_to_dict(r))
            pub.pop("answer", None)
            pub.pop("explanation", None)
            questions.append(pub)

    return {
        "exam_id": exam_id,
        "title": title,
        "category": category,
        "category_name": METHOD_NAMES.get(category, category) if category else "",
        "qtype": body.qtype,
        "duration_minutes": body.duration_minutes,
        "total": len(questions),
        "questions": questions,
    }


# ── 交卷 ────────────────────────────────────────────────────

@router.post("/submit", summary="交卷：服务端判分并保存成绩")
def submit_exam(body: SubmitBody, user: dict = Depends(get_current_user)):
    """逐题比对正确答案（strip + upper），写 exam_answers 与 answer_records，
    更新 exams 为 finished。到点自动交卷（auto=True）与手动交卷同一入口；
    幂等：已交卷的考试重复提交直接返回已保存的结果。"""
    with get_conn() as conn:
        exam = _get_own_exam(conn, body.exam_id, user["id"])

        # 幂等：到点自动交卷可能在手动交卷后才触发，直接返回已有结果
        if exam["status"] == "finished":
            return _exam_summary(exam)

        qids = json.loads(exam["question_ids"] or "[]")
        valid = set(qids)
        answers = [a for a in body.answers if a.question_id in valid]

        correct = 0
        if answers:
            marks = ",".join("?" * len(answers))
            qmap = {
                r["id"]: row_to_dict(r)
                for r in conn.execute(
                    f"SELECT id, method, qtype, answer FROM questions WHERE id IN ({marks})",
                    [a.question_id for a in answers],
                ).fetchall()
            }
            for a in answers:
                q = qmap.get(a.question_id)
                if not q:
                    continue  # 题目已被管理员删除：跳过不计
                is_correct = _grade_answer(q["qtype"], a.user_answer, q["answer"])
                # 多选存归一化后的字母串（'CA' → 'AC'），回看时高亮不会因顺序漏判
                saved = (
                    normalize_multi_answer(a.user_answer)
                    if q["qtype"] in MULTI_QTYPES
                    else a.user_answer.strip().upper()
                )
                correct += 1 if is_correct else 0
                conn.execute(
                    """INSERT INTO exam_answers (exam_id, question_id, user_answer, is_correct)
                       VALUES (?,?,?,?)
                       ON CONFLICT(exam_id, question_id)
                       DO UPDATE SET user_answer = excluded.user_answer,
                                     is_correct = excluded.is_correct""",
                    (exam["id"], a.question_id, saved, 1 if is_correct else 0),
                )
                conn.execute(
                    """INSERT INTO answer_records
                       (user_id, question_id, method, kind, user_answer, is_correct,
                        duration_seconds, session_id, answered_at)
                       VALUES (?,?,?,'answer',?,?,?,?,?)""",
                    (
                        user["id"], a.question_id, q["method"],
                        saved, 1 if is_correct else 0,
                        body.time_used_seconds, exam["id"], now_iso(),
                    ),
                )
            # 重新答过的题解除「从错题集删除」标记（与练习口径一致）
            conn.execute(
                f"DELETE FROM wrong_dismissals WHERE user_id = ? AND question_id IN ({marks})",
                (user["id"], *[a.question_id for a in answers]),
            )

        total = exam["total"] or 0
        score = round(correct / total * 100) if total else 0
        conn.execute(
            """UPDATE exams SET correct = ?, score = ?, status = 'finished',
                   time_used = ?, auto_submitted = ?, finished_at = ?
               WHERE id = ?""",
            (correct, score, body.time_used_seconds, 1 if body.auto else 0, now_iso(), exam["id"]),
        )

        exam.update({"correct": correct, "score": score, "time_used": body.time_used_seconds,
                     "auto_submitted": 1 if body.auto else 0, "status": "finished",
                     "finished_at": now_iso()})
        return _exam_summary(exam)


# ── 试卷回看 ────────────────────────────────────────────────

@router.get("/records/{exam_id}", summary="试卷回看：完整题目 + 正确答案 + 我的答案")
def exam_detail(exam_id: str, user: dict = Depends(get_current_user)):
    """一场考试的完整试卷：每题带正确答案、我的答案（未作答 my_answer 为空、
    is_correct 为 null）、对错。只能看自己的考试。"""
    with get_conn() as conn:
        exam = _get_own_exam(conn, exam_id, user["id"])
        qids = json.loads(exam["question_ids"] or "[]")
        my = {
            r["question_id"]: bool(r["is_correct"])
            for r in conn.execute(
                "SELECT question_id, is_correct FROM exam_answers WHERE exam_id = ?", (exam_id,)
            ).fetchall()
        }
        items = []
        if qids:
            marks = ",".join("?" * len(qids))
            qrows = {
                r["id"]: row_to_dict(r)
                for r in conn.execute(
                    f"SELECT * FROM questions WHERE id IN ({marks})", qids
                ).fetchall()
            }
            for qid in qids:  # 按出卷顺序返回
                q = qrows.get(qid)
                if not q:
                    continue  # 题目已被删除：跳过
                items.append({**_question_public(q), "my_answer": "", "is_correct": my.get(qid)})
        # 我的答案从 exam_answers 补齐（保留未答过的 null）
        answered = {
            r["question_id"]: r["user_answer"]
            for r in conn.execute(
                "SELECT question_id, user_answer FROM exam_answers WHERE exam_id = ?", (exam_id,)
            ).fetchall()
        }
        for item in items:
            if item["id"] in answered:
                item["my_answer"] = answered[item["id"]]
                item["is_correct"] = my.get(item["id"])

    return {**_exam_summary(exam), "items": items}


# ── 考试成绩列表（成绩记录页「模拟考试」数据源，可选接口） ──

@router.get("/records", summary="我的考试成绩列表（按交卷时间倒序）")
def exam_records(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM exams WHERE user_id = ? AND status = 'finished'
               ORDER BY id DESC LIMIT ?""",
            (user["id"], limit),
        ).fetchall()
    return {"items": [_exam_summary(row_to_dict(r)) for r in rows]}
