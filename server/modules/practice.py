"""
练习与学习统计模块 —— 考生刷题的出题、交卷、统计、错题本。

接口（全部需要考生登录，数据按 user_id 严格隔离）：
  GET  /api/practice/questions?category=UT&mode=sequential|random|wrong&qtype=&topic=&limit=2000
       取一组题目；顺序练习默认返回范围内全部题目（按 id 升序），topic 传知识点即按章节
       练习（整章一起练）；qtype 传 judge|single|multi|calc|calcsel|short 按题型筛选（空 = 不限）；
       每题附 my_state（我最近一次对/错，保留到清除记录为止）
  GET  /api/practice/blocks?category=&topic=&qtype=&limit=20
       分块列表：每组未做/对/错数量（题库页「选择练习方式」面板用）
  POST /api/practice/reset  {category, topic, qtype}
       清除该范围（方向 / 章节）内我的全部答题记录，可重新作答
  POST /api/practice/submit
       交卷：把本次练习的每道题写入 answer_records（一次练习 = 一个 session_id）
  GET  /api/user/stats/summary
       首页统计：今日答题/正确率/时长、连续打卡、近 7 天趋势、总题量、待复习错题数、成就、XP 等级
  GET  /api/user/stats/report?period=week|month
       学习报告页：周期汇总（答题/正确率/时长）+ 近 35 天学习日历 + 各方向掌握度
  GET  /api/user/practice/history
       成绩记录：按练习会话分组的历史成绩（「我的 → 成绩记录」页数据源）
  GET  /api/user/practice/history/{session_id}
       单次成绩回看：该次会话的完整试卷（练习查 answer_records；
       若 session_id 是考试，则等价于考试试卷回看）
  DELETE /api/user/practice/history/{session_id}
       删除一条成绩记录：删该次会话的 answer_records；考试连 exams/exam_answers 一起删
       （注意：会同步影响统计/XP/错题口径，因为统计全部实时算自 answer_records）
  GET  /api/user/wrong-questions
       错题本列表（最新做错的在前，已掌握 = 最近一次答对）
  POST /api/user/wrong-questions/{question_id}/master
       标记已掌握（写一条 kind='master' 的记录，最近一次变成"答对"即视为已掌握）
  DELETE /api/user/wrong-questions/{question_id}
       把某道题从我的错题集移除（写 wrong_dismissals 隐藏标记，不删答题记录；
       这道题之后再次答错会自动恢复显示）

数据模型：
  - 所有统计都从 answer_records 实时计算，不存冗余汇总表 → 改判据立即生效
  - 「已掌握」的判据：该题最近一条记录 is_correct=1（正常答对或手动标记）
  - 统计口径：只算 kind='answer' 的正常答题记录，kind='master' 不计入题量与正确率
  - 学习时长按 session_id 去重求和（一次练习的时长只算一次），不是把每行加起来

修改注意：
  - 出题接口会把正确答案一并返回（当前答题页是本地即时判分），将来做"考试模式"
    需要服务端判分时，在这里加一个不给 answer 的分支即可
"""

import json
import math
import re
import secrets
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_user
from modules.achievements import build_achievements
from modules.bank import METHOD_NAMES, QTYPE_FILTER, _question_public
from modules.exam import _exam_summary, _get_own_exam

router = APIRouter(prefix="/api/practice", tags=["练习"])
user_router = APIRouter(prefix="/api/user", tags=["学习统计"])

DAILY_GOAL = 60  # 首页进度环的每日目标题数（与前端展示一致）


# ── 请求体 ──────────────────────────────────────────────────

class SubmitAnswer(BaseModel):
    question_id: int
    # 多选题的答案是字母串（如 'ACD'）；计算题/简答题是考生手写的答案文本，所以留到 200 字
    user_answer: str = Field(default="", max_length=200)
    is_correct: bool


class SubmitBody(BaseModel):
    category: str = Field(default="", max_length=8)
    duration_seconds: int = Field(default=0, ge=0, le=24 * 3600)
    answers: list[SubmitAnswer] = Field(default_factory=list, max_length=2000)


# ── 内部工具 ────────────────────────────────────────────────

def _parse_date(s: str) -> date | None:
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").date()
    except (ValueError, TypeError):
        return None


def _compute_streak(days: set[date], today: date) -> int:
    """连续打卡天数：从今天（今天没做则从昨天）往回数连续有答题记录的天数。"""
    if not days:
        return 0
    cursor = today if today in days else today - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _wrong_question_ids(conn, user_id: int, category: str = "") -> list[int]:
    """最近一次做错的题 id 列表（最近一次答对即视为已掌握，不再返回）。
    考生从错题集删除的题（wrong_dismissals）一并排除——待复习数/错题重练口径一致。"""
    sql = """
      SELECT question_id FROM answer_records r
      WHERE r.user_id = ? AND r.id = (
            SELECT MAX(id) FROM answer_records
            WHERE user_id = r.user_id AND question_id = r.question_id)
        AND r.is_correct = 0
        AND r.question_id NOT IN (
            SELECT question_id FROM wrong_dismissals WHERE user_id = ?)
    """
    params: list = [user_id, user_id]
    if category and category != "综合":
        sql += " AND r.method = ?"
        params.append(category)
    return [r["question_id"] for r in conn.execute(sql, params).fetchall()]


# 题型筛选参数的共用正则（空=不限）：从 bank.QTYPE_FILTER 导入，本文件各处 pattern 直接引用


def _scope_where(category: str, topic: str = "", set_id: int = 0, qtype: str = "") -> tuple[str, list]:
    """出题范围 SQL 片段。

    - set_id > 0：管理员创建的自定义题库；此时 topic 表示**该题库里的章节**（topic1 精确匹配），
      不传 topic = 整套题库顺序练（方向/级别忽略）
    - 否则：按方向（综合=全部）+ 可选章节（topic1 精确匹配）
    两种情况都可再按题型（qtype）过滤。
    """
    if set_id:
        where, params = "WHERE set_id = ?", [set_id]
        if topic:
            where += " AND topic1 = ?"
            params.append(topic)
    else:
        where = ""
        params: list = []
        if category and category != "综合":
            where += "WHERE method = ?"
            params.append(category)
        if topic:
            where += " AND topic1 = ?" if where else "WHERE topic1 = ?"
            params.append(topic)
    if qtype:
        where += " AND qtype = ?" if where else "WHERE qtype = ?"
        params.append(qtype)
    return where, params


def _scope_ids(conn, category: str, topic: str = "", set_id: int = 0, qtype: str = "") -> list[int]:
    """范围内全部题目 id（按 id 升序，顺序练习/分块/清除记录都用它）。"""
    where, params = _scope_where(category, topic, set_id, qtype)
    return [r["id"] for r in conn.execute(f"SELECT id FROM questions {where} ORDER BY id", params).fetchall()]


def _last_state_map(conn, user_id: int, ids: list[int]) -> dict[int, bool]:
    """每道题我最近一次的作答结果 {question_id: 是否正确}（含 master 标记）。
    做题导航「对绿错红一直保留」与分块进度统计都基于它；清除记录后即为空。"""
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    return {
        r["question_id"]: bool(r["is_correct"])
        for r in conn.execute(
            f"""SELECT question_id, is_correct FROM answer_records r
                WHERE r.user_id = ? AND r.question_id IN ({marks})
                  AND r.id = (SELECT MAX(id) FROM answer_records
                              WHERE user_id = r.user_id AND question_id = r.question_id)""",
            (user_id, *ids),
        ).fetchall()
    }


# 等级体系：每答 1 题得 1 经验，每 200 经验升 1 级（纯实时推导，不入库）
XP_PER_LEVEL = 200


def _xp_of(total_answered: int) -> dict:
    level = total_answered // XP_PER_LEVEL + 1
    return {
        "xp": total_answered,
        "xp_in_level": total_answered % XP_PER_LEVEL,
        "xp_level_max": XP_PER_LEVEL,
        "level": level,
    }


def _session_duration_sql(where: str, params: list) -> str:
    """学习时长 SQL：按 session_id 去重取 MAX(duration_seconds) 求和（一次练习只算一次）。"""
    return f"""SELECT SUM(d) AS s FROM (
                 SELECT MAX(duration_seconds) AS d FROM answer_records
                 WHERE user_id = ? AND kind = 'answer' {where}
                 GROUP BY session_id)"""


# ── 出题 ────────────────────────────────────────────────────

@router.get("/questions", summary="取一组练习题（顺序全量 / 随机 / 错题重练，含章节/题型/题库过滤）")
def get_questions(
    category: str = Query(default="综合", max_length=8),
    mode: str = Query(default="sequential", pattern="^(sequential|random|wrong)$"),
    qtype: str = Query(default="", pattern=QTYPE_FILTER),
    topic: str = Query(default="", max_length=50),
    set_id: int = Query(default=0, ge=0),
    block: int = Query(default=-1, ge=-1, le=10000),
    limit: int = Query(default=20, ge=1, le=2000),
    user: dict = Depends(get_current_user),
):
    """顺序练习默认返回范围内**全部题目**（按 id 升序，block=-1 不分块）；
    block=N 时取第 N+1 组（每组 limit 题，兼容旧分块调用）。
    topic 传知识点（topic1）即为「按章节练习」（整章一起练）。
    qtype 传 judge|single|multi|calc|calcsel|short 按题型筛选（空 = 不限）。
    set_id 传自定义题库 id（管理员后台创建的题库）；传了 set_id 时 topic 表示**该题库里的章节**
    （topic1 精确匹配），不传 topic 就是整套题库；内置题库伪 id 见 question_sets.BUILTIN_SETS。
    每题附 my_state（我最近一次对/错，一直保留到清除记录为止）；
    mode=random/wrong 时忽略 topic/block。"""
    with get_conn() as conn:
        where, params = _scope_where(category, topic if mode == "sequential" else "", set_id)
        if qtype:
            where += " AND qtype = ?" if where else "WHERE qtype = ?"
            params.append(qtype)

        total_in_scope = conn.execute(
            f"SELECT COUNT(*) AS n FROM questions {where}", params
        ).fetchone()["n"]

        if mode == "wrong":
            ids = _wrong_question_ids(conn, user["id"], category)
            if set_id:  # 错题重练限定在某套自定义题库内
                sids = {r["id"] for r in conn.execute("SELECT id FROM questions WHERE set_id = ?", (set_id,))}
                ids = [i for i in ids if i in sids]
            if not ids:
                return {"total_in_scope": total_in_scope, "block_index": 0,
                        "block_count": 0, "questions": []}
            marks = ",".join("?" * len(ids))
            wsql = f"SELECT * FROM questions WHERE id IN ({marks})"
            wparams: list = [*ids]
            if qtype:  # 错题重练也支持题型筛选（在错题范围内过滤）
                wsql += " AND qtype = ?"
                wparams.append(qtype)
            rows = conn.execute(wsql, wparams).fetchall()
            rows = sorted((row_to_dict(r) for r in rows), key=lambda _: secrets.randbits(32))
            rows = rows[:limit]
        elif mode == "sequential":
            if block >= 0:
                rows = [
                    row_to_dict(r)
                    for r in conn.execute(
                        f"""SELECT * FROM questions {where} ORDER BY id LIMIT ? OFFSET ?""",
                        (*params, limit, block * limit),
                    ).fetchall()
                ]
            else:
                # 不分块：顺序返回范围内全部题目
                rows = [
                    row_to_dict(r)
                    for r in conn.execute(
                        f"SELECT * FROM questions {where} ORDER BY id", params
                    ).fetchall()
                ]
        else:  # random
            rows = [
                row_to_dict(r)
                for r in conn.execute(
                    f"SELECT * FROM questions {where} ORDER BY RANDOM() LIMIT ?", (*params, limit)
                ).fetchall()
            ]

        states = _last_state_map(conn, user["id"], [r["id"] for r in rows if r])
        block_count = math.ceil(total_in_scope / limit) if (mode == "sequential" and block >= 0 and total_in_scope) else 1

    questions = []
    for r in rows:
        if not r:
            continue
        state = states.get(r["id"])
        questions.append({
            **_question_public(r),
            "my_state": None if state is None else ("correct" if state else "wrong"),
        })

    return {
        "total_in_scope": total_in_scope,
        "block_index": block if (mode == "sequential" and block >= 0) else 0,
        "block_count": block_count if mode == "sequential" else 1,
        "questions": questions,
    }


# ── 练习进度（续做：保存/读取/删除，按用户严格隔离） ──────────

class ProgressBody(BaseModel):
    category: str = Field(default="综合", max_length=8)
    topic: str = Field(default="", max_length=50)
    qtype: str = Field(default="", pattern=QTYPE_FILTER)
    set_id: int = Field(default=0, ge=0)
    mode: str = Field(default="sequential", pattern="^(sequential|random|wrong)$")
    question_ids: list[int] = Field(default_factory=list, max_length=2000)
    answers: dict[int, dict] = Field(default_factory=dict)  # {index: {selected, correct}}
    current_index: int = Field(default=0, ge=0, le=100000)


@router.get("/progress", summary="读取我的练习进度（续做）")
def get_practice_progress(
    category: str = Query(default="综合", max_length=8),
    topic: str = Query(default="", max_length=50),
    qtype: str = Query(default="", pattern=QTYPE_FILTER),
    set_id: int = Query(default=0, ge=0),
    mode: str = Query(default="sequential", pattern="^(sequential|random|wrong)$"),
    user: dict = Depends(get_current_user),
):
    """返回我在该练习范围保存的进度（题目顺序快照 + 当前题号 + 已答界面快照）。
    只在有进度时返回，没有则返回 {has_progress: False}。只读自己的数据。"""
    with get_conn() as conn:
        row = conn.execute(
            """SELECT question_ids, answers_json, current_index, updated_at
               FROM practice_progress
               WHERE user_id = ? AND category = ? AND topic = ? AND qtype = ?
                 AND set_id = ? AND mode = ?""",
            (user["id"], category, topic, qtype, set_id, mode),
        ).fetchone()
    if not row:
        return {"has_progress": False}
    try:
        qids = json.loads(row["question_ids"] or "[]")
        answers = json.loads(row["answers_json"] or "{}")
    except (ValueError, TypeError):
        qids, answers = [], {}
    return {
        "has_progress": True,
        "question_ids": [int(x) for x in qids],
        "answers": {int(k): v for k, v in (answers or {}).items()},
        "current_index": row["current_index"] or 0,
        "updated_at": row["updated_at"],
    }


@router.post("/progress", summary="保存我的练习进度（续做）")
def save_practice_progress(body: ProgressBody, user: dict = Depends(get_current_user)):
    """保存/更新我在该练习范围的进度。只写自己的数据。
    清除记录、交卷完成时应调用 DELETE /api/practice/progress 删除这一条。"""
    if not body.question_ids:
        raise HTTPException(status_code=400, detail="没有题目快照，无法保存进度")
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO practice_progress
               (user_id, category, topic, qtype, set_id, mode,
                question_ids, answers_json, current_index, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id, category, topic, qtype, set_id, mode)
               DO UPDATE SET question_ids = excluded.question_ids,
                              answers_json = excluded.answers_json,
                              current_index = excluded.current_index,
                              updated_at = excluded.updated_at""",
            (
                user["id"], body.category, body.topic, body.qtype, body.set_id, body.mode,
                json.dumps(body.question_ids, ensure_ascii=False),
                json.dumps(body.answers, ensure_ascii=False),
                body.current_index,
                now_iso(),
            ),
        )
    return {"ok": True, "message": "进度已保存"}


@router.delete("/progress", summary="删除我的练习进度")
def delete_practice_progress(
    category: str = Query(default="综合", max_length=8),
    topic: str = Query(default="", max_length=50),
    qtype: str = Query(default="", pattern=QTYPE_FILTER),
    set_id: int = Query(default=0, ge=0),
    mode: str = Query(default="sequential", pattern="^(sequential|random|wrong)$"),
    user: dict = Depends(get_current_user),
):
    """删除我在该练习范围保存的进度（清除记录 / 交卷完成时调用）。
    只删自己的这一条，不影响答题记录与其他数据。"""
    with get_conn() as conn:
        cur = conn.execute(
            """DELETE FROM practice_progress
               WHERE user_id = ? AND category = ? AND topic = ? AND qtype = ?
                 AND set_id = ? AND mode = ?""",
            (user["id"], category, topic, qtype, set_id, mode),
        )
    return {"ok": True, "deleted": cur.rowcount, "message": "进度已删除"}


# ── 分块进度 / 清除记录 ─────────────────────────────────────

@router.get("/blocks", summary="顺序分块列表（每组做题状态，题库页选择器用）")
def practice_blocks(
    category: str = Query(default="综合", max_length=8),
    topic: str = Query(default="", max_length=50),
    set_id: int = Query(default=0, ge=0),
    qtype: str = Query(default="", pattern=QTYPE_FILTER),
    limit: int = Query(default=20, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """把范围（自定义题库 / 方向 + 可选章节 + 可选题型）按 id 升序切成每组 limit 题，
    返回每组的未做 / 对 / 错数量（基于我最近一次作答，清除后归零）。"""
    with get_conn() as conn:
        ids = _scope_ids(conn, category, topic, set_id, qtype)
        states = _last_state_map(conn, user["id"], ids)

    block_count = math.ceil(len(ids) / limit) if ids else 0
    blocks = []
    for i in range(block_count):
        chunk = ids[i * limit:(i + 1) * limit]
        correct = sum(1 for q in chunk if states.get(q) is True)
        wrong = sum(1 for q in chunk if states.get(q) is False)
        blocks.append({
            "block": i,
            "count": len(chunk),
            "answered": correct + wrong,
            "correct": correct,
            "wrong": wrong,
        })
    return {"total": len(ids), "block_size": limit, "block_count": block_count, "blocks": blocks}


class ResetBody(BaseModel):
    category: str = Field(default="综合", max_length=8)
    topic: str = Field(default="", max_length=50)
    set_id: int = Field(default=0, ge=0)
    qtype: str = Field(default="", pattern=QTYPE_FILTER)
    block: int = Field(default=-1, ge=-1, le=10000)
    limit: int = Field(default=20, ge=1, le=100)


@router.post("/reset", summary="清除做题记录（重新做）")
def reset_block(body: ResetBody, user: dict = Depends(get_current_user)):
    """删除我在该范围（自定义题库 / 方向 + 可选章节 + 可选题型）内题目的全部答题记录；
    block=-1（默认）= 清除整个范围，block=N 只清第 N+1 组（兼容旧调用）。
    做题导航颜色与统计随之归零，可重新作答。只删自己的记录。"""
    with get_conn() as conn:
        ids = _scope_ids(conn, body.category, body.topic, body.set_id, body.qtype)
        if body.block >= 0:
            chunk = ids[body.block * body.limit:(body.block + 1) * body.limit]
        else:
            chunk = ids
        if not chunk:
            raise HTTPException(status_code=404, detail="该范围内没有题目")
        marks = ",".join("?" * len(chunk))
        cur = conn.execute(
            f"DELETE FROM answer_records WHERE user_id = ? AND question_id IN ({marks})",
            (user["id"], *chunk),
        )
        cleared = cur.rowcount
    return {"ok": True, "cleared": cleared, "message": "记录已清除，可重新作答"}


# ── 交卷 ────────────────────────────────────────────────────

@router.post("/submit", summary="提交本次练习的答题记录")
def submit(body: SubmitBody, user: dict = Depends(get_current_user)):
    if not body.answers:
        raise HTTPException(status_code=400, detail="没有可保存的答题记录")

    ids = [a.question_id for a in body.answers]
    with get_conn() as conn:
        marks = ",".join("?" * len(ids))
        known = {
            r["id"]: r["method"]
            for r in conn.execute(
                f"SELECT id, method FROM questions WHERE id IN ({marks})", ids
            ).fetchall()
        }
        missing = [qid for qid in ids if qid not in known]
        if missing:
            raise HTTPException(status_code=400, detail="存在无效的题目，提交被拒绝")

        session_id = "ps" + secrets.token_hex(8)
        saved = correct = 0
        for a in body.answers:
            conn.execute(
                """INSERT INTO answer_records
                   (user_id, question_id, method, kind, user_answer, is_correct,
                    duration_seconds, session_id, answered_at)
                   VALUES (?,?,?,'answer',?,?,?,?,?)""",
                (
                    user["id"],
                    a.question_id,
                    known[a.question_id],
                    a.user_answer.strip().upper(),
                    1 if a.is_correct else 0,
                    body.duration_seconds,
                    session_id,
                    now_iso(),
                ),
            )
            saved += 1
            correct += 1 if a.is_correct else 0

        # 重新答过的题解除「从错题集删除」标记：之后若再答错会重新出现在错题集
        conn.execute(
            f"DELETE FROM wrong_dismissals WHERE user_id = ? AND question_id IN ({marks})",
            (user["id"], *ids),
        )

    return {"saved": saved, "correct": correct, "total": len(ids)}


# ── 成绩记录（练习/考试会话历史） ───────────────────────────

@user_router.get("/practice/history", summary="成绩记录（按练习会话分组的历史成绩）")
def practice_history(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    """我的每次练习（一次交卷 = 一个 session）一行：方向、题数、对/正确率、用时、时间。
    按完成时间倒序；将来模拟考试上线后，考试成绩也写 answer_records（session 维度），
    会自然出现在这份记录里。只返回我自己的记录。"""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT r.session_id,
                      MAX(r.answered_at) AS finished_at,
                      r.method,
                      COUNT(*) AS total,
                      SUM(r.is_correct) AS correct,
                      MAX(r.duration_seconds) AS duration_seconds,
                      e.id IS NOT NULL AS is_exam,
                      e.score AS exam_score,
                      e.title AS exam_title
               FROM answer_records r
               LEFT JOIN exams e ON e.id = r.session_id
               WHERE r.user_id = ? AND r.kind = 'answer'
               GROUP BY r.session_id
               ORDER BY MAX(r.id) DESC
               LIMIT ?""",
            (user["id"], limit),
        ).fetchall()

    items = [
        {
            "session_id": r["session_id"],
            "finished_at": r["finished_at"],
            "category": r["method"],
            "category_name": METHOD_NAMES.get(r["method"], r["method"]),
            "total": r["total"],
            "correct": r["correct"] or 0,
            "accuracy": round((r["correct"] or 0) / r["total"] * 100) if r["total"] else 0,
            "duration_seconds": r["duration_seconds"] or 0,
            # 模拟考试附加信息（练习记录为 False/null）
            "is_exam": bool(r["is_exam"]),
            "score": r["exam_score"],
            "exam_title": r["exam_title"] or "",
        }
        for r in rows
    ]
    return {"items": items}


_SESSION_ID_RE = re.compile(r"^(ps|ex)[0-9a-f]{16}$")


def _get_own_session(conn, session_id: str, user_id: int) -> dict:
    """校验 session_id 归属：返回该次会话的汇总（题数/对数/用时/时间/是否考试）。
    只认 answer_records 里真实存在的自己的会话。"""
    if not _SESSION_ID_RE.match(session_id or ""):
        raise HTTPException(status_code=404, detail="记录不存在或已删除")
    row = conn.execute(
        """SELECT COUNT(*) AS total,
                  SUM(is_correct) AS correct,
                  MAX(duration_seconds) AS duration_seconds,
                  MIN(answered_at) AS started_at,
                  MAX(answered_at) AS finished_at,
                  e.id IS NOT NULL AS is_exam
           FROM answer_records r
           LEFT JOIN exams e ON e.id = r.session_id
           WHERE r.user_id = ? AND r.session_id = ? AND r.kind = 'answer'""",
        (user_id, session_id),
    ).fetchone()
    if not row or not row["total"]:
        raise HTTPException(status_code=404, detail="记录不存在或已删除")
    return dict(row)


@user_router.get("/practice/history/{session_id}", summary="单次成绩回看（练习/考试试卷，含我的答案与对错）")
def practice_session_detail(session_id: str, user: dict = Depends(get_current_user)):
    """成绩记录点进某一条 → 该次会话的完整试卷。
    - 练习会话：从 answer_records 还原（按答题顺序），每题带正确答案/我的答案/对错
    - 考试会话（session_id 即 exams.id）：直接复用考试试卷回看逻辑
    返回结构与 GET /api/exam/records/{exam_id} 一致，前端同一套试卷回看组件渲染。"""
    with get_conn() as conn:
        session = _get_own_session(conn, session_id, user["id"])

        if session["is_exam"]:
            exam = _get_own_exam(conn, session_id, user["id"])
            rows = conn.execute(
                """SELECT q.*, ea.user_answer AS my_answer, ea.is_correct AS my_correct
                   FROM exam_answers ea JOIN questions q ON q.id = ea.question_id
                   WHERE ea.exam_id = ? ORDER BY ea.rowid""",
                (session_id,),
            ).fetchall()
            items = [
                {**_question_public(row_to_dict(r)), "my_answer": r["my_answer"] or "",
                 "is_correct": None if r["my_correct"] is None else bool(r["my_correct"])}
                for r in rows
            ]
            return {**_exam_summary(exam), "items": items}

        # 练习会话：按答题记录顺序还原试卷
        rows = conn.execute(
            """SELECT q.*, r.user_answer AS my_answer, r.is_correct AS my_correct
               FROM answer_records r JOIN questions q ON q.id = r.question_id
               WHERE r.user_id = ? AND r.session_id = ? AND r.kind = 'answer'
               ORDER BY r.id""",
            (user["id"], session_id),
        ).fetchall()

    total = session["total"]
    correct = session["correct"] or 0
    category = rows[0]["method"] if rows else ""
    category_name = METHOD_NAMES.get(category, category) if category else ""
    items = [
        {**_question_public(row_to_dict(r)), "my_answer": r["my_answer"] or "",
         "is_correct": None if r["my_correct"] is None else bool(r["my_correct"])}
        for r in rows
    ]
    return {
        "exam_id": session_id,
        "title": f"{category_name}练习" if category_name else "练习记录",
        "category": category,
        "category_name": category_name,
        "qtype": "",
        "qtype_name": "全部题型",
        "duration_minutes": 0,          # 练习无限时
        "total": total,
        "correct": correct,
        "wrong": max(total - correct, 0),
        "score": round(correct / total * 100) if total else 0,  # 练习以正确率当"得分"
        "time_used": session["duration_seconds"] or 0,
        "auto_submitted": False,
        "status": "finished",
        "started_at": session["started_at"] or "",
        "finished_at": session["finished_at"] or "",
        "items": items,
    }


@user_router.delete("/practice/history/{session_id}", summary="删除一条成绩记录")
def delete_practice_session(session_id: str, user: dict = Depends(get_current_user)):
    """删除我的一次练习/考试成绩：
    - 删该会话全部 answer_records（统计/XP/错题口径随之更新，删了不可恢复）
    - 若是考试（exams.id = session_id），连 exams 与 exam_answers 一起删
    只能删自己的记录。"""
    with get_conn() as conn:
        _get_own_session(conn, session_id, user["id"])
        deleted = conn.execute(
            "DELETE FROM answer_records WHERE user_id = ? AND session_id = ? AND kind = 'answer'",
            (user["id"], session_id),
        ).rowcount
        if _SESSION_ID_RE.match(session_id) and session_id.startswith("ex"):
            conn.execute("DELETE FROM exam_answers WHERE exam_id = ?", (session_id,))
            conn.execute("DELETE FROM exams WHERE id = ? AND user_id = ?", (session_id, user["id"]))
    return {"ok": True, "deleted": deleted, "message": "成绩记录已删除"}


# ── 首页统计 ────────────────────────────────────────────────

@user_router.get("/stats/summary", summary="我的学习统计（首页数据源）")
def stats_summary(user: dict = Depends(get_current_user)):
    today = date.today()
    today_str = today.strftime("%Y-%m-%d")

    with get_conn() as conn:
        uid = user["id"]

        today_rows = conn.execute(
            """SELECT COUNT(*) AS total,
                      SUM(is_correct) AS correct,
                      COUNT(DISTINCT session_id) AS sessions
               FROM answer_records
               WHERE user_id = ? AND kind = 'answer' AND answered_at LIKE ?""",
            (uid, today_str + "%"),
        ).fetchone()
        today_total = today_rows["total"] or 0
        today_correct = today_rows["correct"] or 0

        # 今日学习时长：按 session 去重求和（一次练习的时长只算一次）
        today_duration = conn.execute(
            """SELECT SUM(d) AS s FROM (
                 SELECT MAX(duration_seconds) AS d FROM answer_records
                 WHERE user_id = ? AND kind = 'answer' AND answered_at LIKE ?
                 GROUP BY session_id)""",
            (uid, today_str + "%"),
        ).fetchone()["s"] or 0

        # 近 7 天答题量（含今天）
        week_start = (today - timedelta(days=6)).strftime("%Y-%m-%d")
        weekly_rows = conn.execute(
            """SELECT substr(answered_at, 1, 10) AS d, COUNT(*) AS n
               FROM answer_records
               WHERE user_id = ? AND kind = 'answer' AND substr(answered_at, 1, 10) >= ?
               GROUP BY d""",
            (uid, week_start),
        ).fetchall()
        by_day = {r["d"]: r["n"] for r in weekly_rows}
        weekday_labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        weekly = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            weekly.append(
                {
                    "date": d.strftime("%Y-%m-%d"),
                    "label": "今天" if i == 0 else weekday_labels[d.weekday()],
                    "count": by_day.get(d.strftime("%Y-%m-%d"), 0),
                }
            )

        total_answered = conn.execute(
            "SELECT COUNT(*) AS n FROM answer_records WHERE user_id = ? AND kind = 'answer'",
            (uid,),
        ).fetchone()["n"]
        total_correct = conn.execute(
            "SELECT SUM(is_correct) AS n FROM answer_records WHERE user_id = ? AND kind = 'answer'",
            (uid,),
        ).fetchone()["n"] or 0

        # 累计学习时长（「我的 → 学习记录」副标题用）
        total_duration = conn.execute(
            _session_duration_sql("", [uid]), [uid]
        ).fetchone()["s"] or 0

        # 连续打卡：有答题记录的自然日集合
        days = {
            d
            for d in (
                _parse_date(r["d"] + " 00:00:00")
                for r in conn.execute(
                    """SELECT DISTINCT substr(answered_at, 1, 10) AS d
                       FROM answer_records WHERE user_id = ? AND kind = 'answer'""",
                    (uid,),
                ).fetchall()
            )
            if d
        }
        streak = _compute_streak(days, today)

        # 上次练习的方向（「继续学习」入口用）
        last = conn.execute(
            """SELECT method FROM answer_records
               WHERE user_id = ? AND kind = 'answer' ORDER BY id DESC LIMIT 1""",
            (uid,),
        ).fetchone()
        last_method = last["method"] if last else ""

        wrong_pending = len(_wrong_question_ids(conn, uid))

        # 成就目录统一在 achievements.py 维护；首页/「我的」只取前 6 枚做「最近成就」预览，
        # 完整勋章墙在「我的 → 成就勋章」页（/api/user/achievements）
        all_achievements = build_achievements(conn, uid)

    achievements = all_achievements[:6]

    return {
        "today_total": today_total,
        "today_correct": today_correct,
        "today_accuracy": round(today_correct / today_total * 100) if today_total else 0,
        "today_duration_seconds": today_duration,
        "daily_goal": DAILY_GOAL,
        "streak_days": streak,
        "weekly": weekly,
        "weekly_total": sum(w["count"] for w in weekly),
        "total_answered": total_answered,
        "total_correct": total_correct,
        "total_accuracy": round(total_correct / total_answered * 100) if total_answered else 0,
        "total_duration_seconds": total_duration,
        **_xp_of(total_answered),
        "wrong_pending": wrong_pending,
        "last_method": last_method,
        "achievements": achievements,
        # 完整成就墙的解锁进度（「我的」页入口副标题用；achievements 只是前 6 枚预览）
        "ach_earned": sum(1 for a in all_achievements if a["earned"]),
        "ach_total": len(all_achievements),
    }


# ── 学习报告（学习报告页数据源） ────────────────────────────

@user_router.get("/stats/report", summary="学习报告（周期汇总 + 学习日历 + 方向掌握度）")
def stats_report(
    period: str = Query(default="week", pattern="^(week|month)$"),
    user: dict = Depends(get_current_user),
):
    """period=week → 近 7 天；period=month → 近 30 天。
    学习日历固定返回近 35 天的每日答题量；知识掌握度按方向全量统计。"""
    today = date.today()
    period_days = 7 if period == "week" else 30
    start = (today - timedelta(days=period_days - 1)).strftime("%Y-%m-%d")

    with get_conn() as conn:
        uid = user["id"]

        row = conn.execute(
            """SELECT COUNT(*) AS total, SUM(is_correct) AS correct
               FROM answer_records
               WHERE user_id = ? AND kind = 'answer' AND substr(answered_at, 1, 10) >= ?""",
            (uid, start),
        ).fetchone()
        period_total = row["total"] or 0
        period_correct = row["correct"] or 0

        period_duration = conn.execute(
            _session_duration_sql("AND substr(answered_at, 1, 10) >= ?", [uid, start]),
            [uid, start],
        ).fetchone()["s"] or 0

        # 学习日历：近 140 天（20 周）每日答题量，足够前端按月翻页浏览
        CAL_DAYS = 140
        cal_start = (today - timedelta(days=CAL_DAYS - 1)).strftime("%Y-%m-%d")
        by_day = {
            r["d"]: r["n"]
            for r in conn.execute(
                """SELECT substr(answered_at, 1, 10) AS d, COUNT(*) AS n
                   FROM answer_records
                   WHERE user_id = ? AND kind = 'answer' AND substr(answered_at, 1, 10) >= ?
                   GROUP BY d""",
                (uid, cal_start),
            ).fetchall()
        }
        calendar = [
            {"date": (today - timedelta(days=CAL_DAYS - 1 - i)).strftime("%Y-%m-%d"),
             "count": by_day.get((today - timedelta(days=CAL_DAYS - 1 - i)).strftime("%Y-%m-%d"), 0)}
            for i in range(CAL_DAYS)
        ]

        # 知识掌握度：按方向统计（全量，不限周期）
        breakdown = [
            {
                "category": r["method"],
                "topic": METHOD_NAMES.get(r["method"], r["method"]),
                "answered": r["n"],
                "accuracy": round((r["c"] or 0) / r["n"] * 100),
            }
            for r in conn.execute(
                """SELECT method, COUNT(*) AS n, SUM(is_correct) AS c
                   FROM answer_records
                   WHERE user_id = ? AND kind = 'answer'
                   GROUP BY method ORDER BY n DESC""",
                (uid,),
            ).fetchall()
        ]

        # 连续打卡（全量）
        days = {
            d
            for d in (
                _parse_date(r["d"] + " 00:00:00")
                for r in conn.execute(
                    """SELECT DISTINCT substr(answered_at, 1, 10) AS d
                       FROM answer_records WHERE user_id = ? AND kind = 'answer'""",
                    (uid,),
                ).fetchall()
            )
            if d
        }
        total_answered = conn.execute(
            "SELECT COUNT(*) AS n FROM answer_records WHERE user_id = ? AND kind = 'answer'",
            (uid,),
        ).fetchone()["n"]

    return {
        "period": period,
        "period_days": period_days,
        "period_total": period_total,
        "period_correct": period_correct,
        "period_accuracy": round(period_correct / period_total * 100) if period_total else 0,
        "period_duration_seconds": period_duration,
        "streak_days": _compute_streak(days, today),
        "total_answered": total_answered,
        "calendar": calendar,
        "breakdown": breakdown,
        **_xp_of(total_answered),
    }


# ── 错题本 ──────────────────────────────────────────────────

@user_router.get("/wrong-questions", summary="我的错题本（最新做错的在前）")
def wrong_questions(
    limit: int = Query(default=100, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    """每道做错的题一行：wrong_count 累计错误次数，mastered = 最近一次已答对。
    history 是该题最近 3 次答题记录（从新到旧）。"""
    with get_conn() as conn:
        uid = user["id"]
        wrong_ids = [
            r["question_id"]
            for r in conn.execute(
                """SELECT question_id FROM answer_records
                   WHERE user_id = ? AND kind = 'answer' AND is_correct = 0
                     AND question_id NOT IN (
                         SELECT question_id FROM wrong_dismissals WHERE user_id = ?)
                   GROUP BY question_id""",
                (uid, uid),
            ).fetchall()
        ]
        if not wrong_ids:
            return {"items": []}

        marks = ",".join("?" * len(wrong_ids))
        agg = {
            r["question_id"]: r
            for r in conn.execute(
                f"""SELECT question_id,
                           SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS wrong_count,
                           MAX(id) AS last_id
                    FROM answer_records
                    WHERE user_id = ? AND kind = 'answer' AND question_id IN ({marks})
                    GROUP BY question_id""",
                (uid, *wrong_ids),
            ).fetchall()
        }
        # 最近一条记录（含 master 标记）决定是否「已掌握」：
        # 手动标记已掌握会写一条 kind='master'、is_correct=1 的记录，也要算进最新状态
        last_map = {
            r["question_id"]: r
            for r in conn.execute(
                f"""SELECT question_id, is_correct, answered_at FROM answer_records r
                    WHERE r.user_id = ? AND r.question_id IN ({marks})
                      AND r.id = (SELECT MAX(id) FROM answer_records
                                  WHERE user_id = r.user_id AND question_id = r.question_id)""",
                (uid, *wrong_ids),
            ).fetchall()
        }
        history_map: dict[int, list] = {}
        for r in conn.execute(
            f"""SELECT question_id, user_answer, is_correct, answered_at
                FROM answer_records
                WHERE user_id = ? AND kind = 'answer' AND question_id IN ({marks})
                ORDER BY id DESC""",
            (uid, *wrong_ids),
        ).fetchall():
            history_map.setdefault(r["question_id"], []).append(
                {
                    "date": r["answered_at"][:10],
                    "answer": r["user_answer"],
                    "correct": bool(r["is_correct"]),
                }
            )

        items = []
        for qid in sorted(wrong_ids, key=lambda x: agg[x]["last_id"], reverse=True)[:limit]:
            qrow = row_to_dict(conn.execute("SELECT * FROM questions WHERE id = ?", (qid,)).fetchone())
            if not qrow:
                continue
            a = agg[qid]
            last_any = last_map.get(qid)
            history = (history_map.get(qid) or [])[:3]
            last_answer = history[0] if history else None
            items.append(
                {
                    **_question_public(qrow),
                    "explanation": "",  # CSV 题库暂无解析字段
                    "wrong_count": a["wrong_count"],
                    "mastered": bool(last_any and last_any["is_correct"]),
                    "last_wrong_at": last_answer["date"] if last_answer else "",
                    "history": history,
                }
            )

    return {"items": items}


@user_router.post("/wrong-questions/{question_id}/master", summary="标记错题已掌握")
def mark_mastered(question_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        q = conn.execute("SELECT id, method FROM questions WHERE id = ?", (question_id,)).fetchone()
        if not q:
            raise HTTPException(status_code=404, detail="题目不存在")
        conn.execute(
            """INSERT INTO answer_records
               (user_id, question_id, method, kind, user_answer, is_correct,
                duration_seconds, session_id, answered_at)
               VALUES (?,?,?,'master','--',1,0,'',?)""",
            (user["id"], question_id, q["method"], now_iso()),
        )
    return {"ok": True, "message": "已标记为掌握"}


@user_router.delete("/wrong-questions/{question_id}", summary="把错题从错题集移除")
def dismiss_wrong_question(question_id: int, user: dict = Depends(get_current_user)):
    """「删除错题」= 写一条隐藏标记（wrong_dismissals），不删答题记录、不影响统计。
    这道题之后再次答错会自动清掉标记，重新出现在错题集里。只操作自己的数据。"""
    with get_conn() as conn:
        q = conn.execute("SELECT id FROM questions WHERE id = ?", (question_id,)).fetchone()
        if not q:
            raise HTTPException(status_code=404, detail="题目不存在")
        conn.execute(
            """INSERT INTO wrong_dismissals (user_id, question_id, created_at)
               VALUES (?,?,?)
               ON CONFLICT(user_id, question_id) DO NOTHING""",
            (user["id"], question_id, now_iso()),
        )
    return {"ok": True, "message": "已从错题集移除"}
