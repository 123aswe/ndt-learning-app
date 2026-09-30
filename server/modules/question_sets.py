"""
自定义题库模块 —— 管理员在后台「题库管理」创建题库并放题，考生端动态获取。

接口：
  管理端（需管理员登录，admin_router）：
    GET    /api/admin/question-sets                    题库列表（含各题型题数）
    POST   /api/admin/question-sets                    新建题库 {name, level, description}
    PUT    /api/admin/question-sets/{id}               修改题库信息
    DELETE /api/admin/question-sets/{id}               删除题库（连同题目与其答题记录）
    GET    /api/admin/question-sets/{id}/questions     题目列表（可按题型筛选）
    POST   /api/admin/question-sets/{id}/questions     添加单题 {qtype, content, options_raw, answer, explanation}
    POST   /api/admin/question-sets/{id}/import        批量导入 CSV（格式与内置一级题库相同）
    DELETE /api/admin/question-sets/{id}/questions/{qid}  删除单题
  考生端（需考生登录，router）：
    GET    /api/bank/sets                              有题的题库列表（题库页数据源）

数据模型：
  - 题库信息存 question_sets 表；题目仍存 questions 表（set_id 指向题库）
  - 内置一级题库 set_id 为空、method 为 UT/RT/MT/PT；自定义题库题目 method='ZD'、grade=题库级别
  - 题型跨端一致常量见 bank.QTYPE_NAMES：judge 判断 / single 选择 / calc 计算 / short 简答
  - 简答题（short）没有选项，answer 存参考答案；练习时考生对照参考答案自评

修改注意：
  - 删除题库会连题目与相关答题记录一起删（统计/错题本随之少掉这部分），接口有明确提示
  - 导入的 CSV 与 data/question_bank.csv 同格式（8 列），解析复用 bank.py 的函数
"""

import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user
from modules.bank import METHOD_NAMES, QTYPE_NAMES, _clean_text, _normalize_qtype, _parse_options

admin_router = APIRouter(prefix="/api/admin/question-sets", tags=["题库管理"])
router = APIRouter(prefix="/api/bank", tags=["题库"])

# 自定义题库题目统一的方向代码（METHOD_NAMES['ZD'] = '自定义题库'）
SET_METHOD = "ZD"

# 判断题固定选项（与内置题库一致：正确/错误）
_JUDGE_OPTIONS = [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]

# ── 内置一级题库（在后台用负数伪 id 表示，题目 set_id 为 NULL、按 method 区分） ──
#    id 约定：UT=-1 / RT=-2 / MT=-3 / PT=-4（跨端一致：后台 dashboard.js 依赖该映射）
BUILTIN_SETS = [
    {"id": -1, "method": "UT"},
    {"id": -2, "method": "RT"},
    {"id": -3, "method": "MT"},
    {"id": -4, "method": "PT"},
]
BUILTIN_LEVEL = "一级"


def _builtin_by_id(set_id: int) -> dict | None:
    return next((b for b in BUILTIN_SETS if b["id"] == set_id), None)


def _builtin_by_method(method: str) -> dict | None:
    return next((b for b in BUILTIN_SETS if b["method"] == method), None)


# ── 内部工具 ────────────────────────────────────────────────

def _get_set(conn, set_id: int) -> dict:
    row = conn.execute("SELECT * FROM question_sets WHERE id = ?", (set_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="题库不存在")
    return row_to_dict(row)


def _qtype_counts(conn, set_id: int) -> dict[str, int]:
    where, params = _scope_where(set_id)
    rows = conn.execute(
        f"SELECT qtype, COUNT(*) AS n FROM questions WHERE {where} GROUP BY qtype", params
    ).fetchall()
    return {r["qtype"]: r["n"] for r in rows}


def _scope_where(set_id: int) -> tuple[str, list]:
    """题目查询范围：内置题库（负数 id）按 method 且 set_id IS NULL；自定义题库按 set_id。"""
    if set_id < 0:
        b = _builtin_by_id(set_id)
        if not b:
            raise HTTPException(status_code=404, detail="题库不存在")
        return "set_id IS NULL AND method = ?", [b["method"]]
    return "set_id = ?", [set_id]


def _set_public(conn, s: dict) -> dict:
    return {
        "id": s["id"],
        "name": s["name"],
        "level": s["level"],
        "description": s["description"],
        "total": conn.execute(
            "SELECT COUNT(*) AS n FROM questions WHERE set_id = ?", (s["id"],)
        ).fetchone()["n"],
        "qtype_counts": _qtype_counts(conn, s["id"]),
        "created_at": s["created_at"],
    }


def _builtin_public(conn, b: dict) -> dict:
    where, params = _scope_where(b["id"])
    total = conn.execute(f"SELECT COUNT(*) AS n FROM questions WHERE {where}", params).fetchone()["n"]
    counts = {
        r["qtype"]: r["n"]
        for r in conn.execute(
            f"SELECT qtype, COUNT(*) AS n FROM questions WHERE {where} GROUP BY qtype", params
        ).fetchall()
    }
    return {
        "id": b["id"],
        "name": f"{METHOD_NAMES.get(b['method'], b['method'])}（内置）",
        "method": b["method"],
        "level": BUILTIN_LEVEL,
        "description": "内置一级题库（CSV 导入）",
        "builtin": True,
        "total": total,
        "qtype_counts": counts,
        "created_at": "",
    }


# ── 管理端：题库 CRUD ───────────────────────────────────────

class SetBody(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    level: str = Field(default="", max_length=20)
    description: str = Field(default="", max_length=200)


@admin_router.get("", summary="题库列表（含内置一级题库与各题型题数）")
def list_sets(admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM question_sets ORDER BY id DESC"
        ).fetchall()
        custom = [_set_public(conn, row_to_dict(r)) for r in rows]
        builtins = [_builtin_public(conn, b) for b in BUILTIN_SETS]
    return {"items": builtins + custom}


@admin_router.post("", summary="新建题库")
def create_set(body: SetBody, admin: dict = Depends(get_current_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="题库名称不能为空")
    with get_conn() as conn:
        dup = conn.execute("SELECT id FROM question_sets WHERE name = ?", (name,)).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="已存在同名题库")
        cur = conn.execute(
            "INSERT INTO question_sets (name, level, description, created_at) VALUES (?,?,?,?)",
            (name, body.level.strip(), body.description.strip(), now_iso()),
        )
        set_id = cur.lastrowid
    return {"ok": True, "id": set_id, "message": f"题库「{name}」已创建"}


@admin_router.put("/{set_id}", summary="修改题库信息")
def update_set(set_id: int, body: SetBody, admin: dict = Depends(get_current_admin)):
    if set_id < 0:
        raise HTTPException(status_code=400, detail="内置题库不能编辑名称/级别")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="题库名称不能为空")
    with get_conn() as conn:
        _get_set(conn, set_id)
        dup = conn.execute(
            "SELECT id FROM question_sets WHERE name = ? AND id != ?", (name, set_id)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="已存在同名题库")
        conn.execute(
            "UPDATE question_sets SET name = ?, level = ?, description = ? WHERE id = ?",
            (name, body.level.strip(), body.description.strip(), set_id),
        )
    return {"ok": True, "message": "题库信息已更新"}


@admin_router.delete("/{set_id}", summary="删除题库（连同题目与相关答题记录；内置题库不可删）")
def delete_set(set_id: int, admin: dict = Depends(get_current_admin)):
    if set_id < 0:
        raise HTTPException(status_code=400, detail="内置题库不能删除，只能修改/删除里面的题目")
    with get_conn() as conn:
        s = _get_set(conn, set_id)
        conn.execute(
            """DELETE FROM answer_records WHERE question_id IN
               (SELECT id FROM questions WHERE set_id = ?)""",
            (set_id,),
        )
        conn.execute(
            """DELETE FROM wrong_dismissals WHERE question_id IN
               (SELECT id FROM questions WHERE set_id = ?)""",
            (set_id,),
        )
        deleted = conn.execute(
            "DELETE FROM questions WHERE set_id = ?", (set_id,)
        ).rowcount
        conn.execute("DELETE FROM question_sets WHERE id = ?", (set_id,))
    return {"ok": True, "removed_questions": deleted,
            "message": f"题库「{s['name']}」已删除（含 {deleted} 道题）"}


# ── 管理端：题目管理 ────────────────────────────────────────

@admin_router.get("/{set_id}/questions", summary="题库题目列表（内置/自定义通用，可按题型筛选）")
def list_questions(
    set_id: int,
    qtype: str = Query(default="", pattern="^(|judge|single|calc|short)$"),
    limit: int = Query(default=500, ge=1, le=2000),
    admin: dict = Depends(get_current_admin),
):
    with get_conn() as conn:
        where, params = _scope_where(set_id)
        sql = f"SELECT * FROM questions WHERE {where}"
        if qtype:
            sql += " AND qtype = ?"
            params.append(qtype)
        sql += " ORDER BY id LIMIT ?"
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()
    items = []
    for r in rows:
        d = row_to_dict(r)
        items.append({
            "id": d["id"],
            "qtype": d["qtype"],
            "qtype_label": QTYPE_NAMES.get(d["qtype"], d["qtype"]),
            "content": d["content"],
            "options": json.loads(d["options_json"]),
            "answer": d["answer"],
        })
    return {"items": items}


class QuestionBody(BaseModel):
    qtype: str = Field(pattern="^(judge|single|calc|short)$")
    content: str = Field(min_length=1, max_length=2000)
    options_raw: str = Field(default="", max_length=4000,
                             description="选项文本，A、xx；##B、xx；##…；判断题留空自动生成")
    answer: str = Field(min_length=1, max_length=1000)
    explanation: str = Field(default="", max_length=2000)


def _normalize_answer(qtype: str, answer: str, options: list) -> str:
    """按题型把人填的答案归一成存储格式；不合法时抛 400。"""
    answer = answer.strip()
    if qtype == "judge":
        a = answer.upper()
        if a in ("A", "对", "正确", "T", "Y", "YES"):
            return "A"
        if a in ("B", "错", "错误", "F", "N", "NO"):
            return "B"
        raise HTTPException(status_code=400, detail="判断题答案请填：正确 / 错误")
    if qtype == "single":
        a = answer.upper()
        keys = [o["key"] for o in options]
        if a not in keys:
            raise HTTPException(status_code=400, detail=f"答案必须是选项字母之一：{'/'.join(keys)}")
        return a
    return answer  # calc / short 原样存


def _build_question(qtype: str, options_raw: str, answer: str) -> tuple[str, list, str]:
    """添加/编辑题目共用的构造：返回 (qtype, options, answer)。"""
    if qtype == "judge":
        options = _JUDGE_OPTIONS
    elif qtype == "short":
        options = []
    else:
        options = _parse_options(options_raw)
        if qtype == "single" and len(options) < 2:
            raise HTTPException(status_code=400, detail="选择题至少需要 2 个选项（格式：A、选项；##B、选项）")
    return qtype, options, _normalize_answer(qtype, answer, options)


@admin_router.post("/{set_id}/questions", summary="添加单题（内置/自定义题库通用）")
def add_question(set_id: int, body: QuestionBody, admin: dict = Depends(get_current_admin)):
    content = _clean_text(body.content)
    if not content or not body.answer.strip():
        raise HTTPException(status_code=400, detail="题干和答案不能为空")
    qtype, options, answer = _build_question(body.qtype, body.options_raw, body.answer)

    with get_conn() as conn:
        if set_id < 0:
            b = _builtin_by_id(set_id)
            if not b:
                raise HTTPException(status_code=404, detail="题库不存在")
            method, grade, db_set_id = b["method"], BUILTIN_LEVEL, None
        else:
            s = _get_set(conn, set_id)
            method, grade, db_set_id = SET_METHOD, s["level"], set_id
        cur = conn.execute(
            """INSERT INTO questions
               (set_id, method, grade, topic1, topic2, qtype, content, options_json, answer, source_no, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (db_set_id, method, grade, "", "", qtype, content,
             json.dumps(options, ensure_ascii=False), answer, 0, now_iso()),
        )
    return {"ok": True, "id": cur.lastrowid, "message": "题目已添加"}


@admin_router.put("/{set_id}/questions/{question_id}", summary="编辑单题（内置/自定义题库通用，直接写库）")
def update_question(set_id: int, question_id: int, body: QuestionBody, admin: dict = Depends(get_current_admin)):
    content = _clean_text(body.content)
    if not content or not body.answer.strip():
        raise HTTPException(status_code=400, detail="题干和答案不能为空")
    qtype, options, answer = _build_question(body.qtype, body.options_raw, body.answer)

    with get_conn() as conn:
        where, params = _scope_where(set_id)
        row = conn.execute(
            f"SELECT id FROM questions WHERE id = ? AND {where}", [question_id, *params]
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="题目不存在或不属于该题库")
        conn.execute(
            """UPDATE questions
               SET qtype = ?, content = ?, options_json = ?, answer = ?
               WHERE id = ?""",
            (qtype, content, json.dumps(options, ensure_ascii=False), answer, question_id),
        )
        # 题目被修正后，之前针对它的待处理纠错工单一并关闭
        conn.execute(
            """UPDATE question_reports SET status = 'resolved', handled_by = ?, handled_at = ?
               WHERE question_id = ? AND status = 'pending'""",
            (admin["username"], now_iso(), question_id),
        )
    return {"ok": True, "message": "题目已更新"}


@admin_router.post("/{set_id}/import", summary="批量导入 CSV（与内置一级题库相同格式）")
def import_csv(set_id: int, body: dict, admin: dict = Depends(get_current_admin)):
    """body.csv = CSV 文本。格式：序号,项目,知识点一,知识点二,题目类型,题目内容,题目选项,题目答案
    与 data/question_bank.csv 完全一致；简答题选项列留空、答案列写参考答案。"""
    raw = (body or {}).get("csv", "")
    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(status_code=400, detail="请提供 CSV 内容")

    if set_id < 0:
        b = _builtin_by_id(set_id)
        if not b:
            raise HTTPException(status_code=404, detail="题库不存在")
        method, grade = b["method"], BUILTIN_LEVEL
    else:
        with get_conn() as conn:
            s = _get_set(conn, set_id)
        method, grade = SET_METHOD, s["level"]

    imported = skipped = 0
    errors: list[str] = []
    reader = csv.reader(io.StringIO(raw))
    header = next(reader, None)
    # 允许有/没有表头：首行不是 8 列就当数据行
    rows = list(reader)
    if header and len(header) >= 8 and ("题目" in "".join(header) or "类型" in "".join(header)):
        pass  # 表头行已跳过
    else:
        if header:
            rows = [header] + rows

    for i, row in enumerate(rows, start=2):
        if len(row) < 8:
            # 兼容简式：题型,题目,选项,答案
            if len(row) == 4:
                row = ["", "", "", "", row[0], row[1], row[2], row[3]]
            else:
                skipped += 1
                errors.append(f"第 {i} 行：列数不足")
                continue
        _no, _project, topic1, topic2, qtype_raw, content, options_raw, answer = row[:8]

        content_clean = _clean_text(content)
        if not content_clean:
            skipped += 1
            errors.append(f"第 {i} 行：题干为空")
            continue

        qtype = _normalize_qtype(qtype_raw)
        answer_clean = (answer or "").strip()
        if not answer_clean:
            skipped += 1
            errors.append(f"第 {i} 行：答案为空")
            continue

        if qtype == "judge":
            options = _JUDGE_OPTIONS
            a = answer_clean.upper()
            if a in ("A", "对", "正确", "T", "Y", "YES"):
                answer_clean = "A"
            elif a in ("B", "错", "错误", "F", "N", "NO"):
                answer_clean = "B"
            else:
                skipped += 1
                errors.append(f"第 {i} 行：判断题答案应为 正确/错误")
                continue
        elif qtype == "short":
            options = []
            if len(answer_clean) > 1000:
                answer_clean = answer_clean[:1000]
        else:
            options = _parse_options(options_raw)
            if qtype == "single" and len(options) < 2:
                skipped += 1
                errors.append(f"第 {i} 行：选择题选项不足 2 个")
                continue
            answer_clean = answer_clean.upper()

        with get_conn() as conn:
            conn.execute(
                """INSERT INTO questions
                   (set_id, method, grade, topic1, topic2, qtype, content, options_json, answer, source_no, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (set_id if set_id > 0 else None, method, grade, _clean_text(topic1), _clean_text(topic2),
                 qtype, content_clean, json.dumps(options, ensure_ascii=False),
                 answer_clean, 0, now_iso()),
            )
        imported += 1

    msg = f"导入完成：成功 {imported} 题，跳过 {skipped} 条异常行"
    return {"ok": True, "imported": imported, "skipped": skipped, "errors": errors[:20], "message": msg}


@admin_router.delete("/{set_id}/questions/{question_id}", summary="删除题库里的单题（内置/自定义通用）")
def delete_question(set_id: int, question_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        where, params = _scope_where(set_id)
        row = conn.execute(
            f"SELECT id FROM questions WHERE id = ? AND {where}", [question_id, *params]
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="题目不存在或不属于该题库")
        conn.execute("DELETE FROM answer_records WHERE question_id = ?", (question_id,))
        conn.execute("DELETE FROM wrong_dismissals WHERE question_id = ?", (question_id,))
        conn.execute("DELETE FROM question_reports WHERE question_id = ?", (question_id,))
        conn.execute("DELETE FROM questions WHERE id = ?", (question_id,))
    return {"ok": True, "message": "题目已删除"}


# ── 考生端：题库列表 ────────────────────────────────────────

@router.get("/sets", summary="自定义题库列表（题库页数据源，只返回有题的）")
def user_sets(user: dict = Depends(get_current_user)):
    """管理员在后台创建并放了题的题库才会出现；按创建时间倒序。"""
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM question_sets ORDER BY id DESC").fetchall()
        items = [_set_public(conn, row_to_dict(r)) for r in rows]
    return {"items": [s for s in items if s["total"] > 0]}
