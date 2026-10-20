"""
自定义题库模块 —— 管理员在后台「题库管理」创建题库并放题，考生端动态获取。

层级（v30）：题库系列（modules/question_series.py）→ 题库（本模块）→ 章节 → 题目

接口：
  管理端（需管理员登录，admin_router）：
    GET    /api/admin/question-sets                    题库列表（含各题型题数；可按 series_id / loose / method / level / q 筛选）
    POST   /api/admin/question-sets                    新建题库 {name, level, method, description, series_id}
    PUT    /api/admin/question-sets/{id}               修改题库信息（含所属系列）
    DELETE /api/admin/question-sets/{id}               删除题库（连同章节、题目与其答题记录）
    POST   /api/admin/question-sets/order              批量调整题库顺序（body.ids = 后台当前可见的完整顺序）
    GET/POST/DELETE /api/admin/question-sets/{id}/cover   题库封面 取 / 设 / 清除
    GET    /api/admin/question-sets/{id}/chapters      章节列表（带题数；内置题库按知识点分组只读）
    POST   /api/admin/question-sets/{id}/chapters      新建章节 {name, description}
    PUT    /api/admin/question-sets/{id}/chapters/{cid}   改章节（改名同步已导入题目的知识点）
    DELETE /api/admin/question-sets/{id}/chapters/{cid}   删章节（**题目保留**，退回「未归章节」）
    POST   /api/admin/question-sets/{id}/chapters/order   批量调整章节顺序
    GET    /api/admin/question-sets/{id}/questions     题目列表（可按题型筛选、按 q 关键词搜索题干/选项/答案；带章节归属与固定序号 seq）
    POST   /api/admin/question-sets/{id}/questions     添加单题 {qtype, content, options_raw, answer, explanation, chapter_id?}
    POST   /api/admin/question-sets/{id}/import        批量导入题目（CSV / Excel，body.chapter_id 指定章节时整批归到该章）
    DELETE /api/admin/question-sets/{id}/questions/{qid}  删除单题
  考生端（需考生登录，router）：
    GET    /api/bank/sets                              有题的题库列表（题库页数据源，可按 series_id 筛选，带封面）
    GET    /api/bank/sets/{id}/cover                   题库封面图（无封面 404，前端回落图标水印）
    GET    /api/bank/sets/{id}/chapters                某套题库的章节（练习面板「按章节」数据源）

数据模型：
  - 题库信息存 question_sets 表（series_id 归属题库系列，cover_name 存封面磁盘名）
  - 章节存 question_chapters 表；题目 questions.chapter_id 指向章节，同时把章节名冗余进 topic1
    （topic1 是考生端「按章节练习 / 章节统计」的老口径，所以导入/改名/删章节都要同步它）
  - 内置一级题库 set_id 为空、method 为 UT/RT/MT/PT；自定义题库题目 method='ZD'、grade=题库级别
  - 题型跨端一致常量见 bank.QTYPE_NAMES：judge 判断 / single 选择 / multi 多选 /
    calc 计算 / calcsel 计算选择 / short 简答
  - 简答题（short）没有选项，answer 存参考答案；练习时考生对照参考答案自评
  - 多选（multi）答案是排序后的字母串（如 'ACD'，见 bank.normalize_multi_answer），
    判分按字母集合比对（顺序无关）；计算选择题（calcsel）判分口径同单选

修改注意：
  - 删除题库会连章节、题目与相关答题记录一起删（统计/错题本随之少掉这部分），接口有明确提示
  - 导入的 CSV 走 modules/tabular.py 兼容层：真实类型/编码/列名都能自动识别（见该文件），
    识别后再复用 bank.py 的解析函数
  - ⚠️ /order 与 /{set_id}/chapters/order 这类静态路径必须声明在 /{set_id} 之前，否则被当 id 解析报 422
  - 封面 / 排序走 modules/upload_utils.py（与资料库同一套实现，别在这里另写一份）
"""

import base64
import csv
import io
import json
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user
from modules.bank import (
    CHOICE_QTYPES,
    METHOD_NAMES,
    QTYPE_CODES,
    QTYPE_FILTER,
    QTYPE_NAMES,
    QTYPE_ONLY,
    _clean_text,
    _normalize_qtype,
    _parse_options,
    normalize_multi_answer,
)
from modules.question_series import QS_METHODS  # noqa: F401  (题库/系列方向口径同源)
from modules.tabular import normalize_table_input, normalize_text_input
from modules.upload_utils import apply_manual_order, cover_response, save_cover, unlink_quiet

admin_router = APIRouter(prefix="/api/admin/question-sets", tags=["题库管理"])
router = APIRouter(prefix="/api/bank", tags=["题库"])

# 导入文件上限（base64 后的 JSON 体约 1.34 倍，10MB 够放几万道题）
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

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
    series_id = s.get("series_id")
    series_name = ""
    if series_id:
        row = conn.execute(
            "SELECT name FROM question_set_series WHERE id = ?", (int(series_id),)
        ).fetchone()
        series_name = row["name"] if row else ""
    return {
        "id": s["id"],
        "name": s["name"],
        "level": s["level"],
        # 方向/类型（'' 通用 / UT / RT / MT / PT / ET / VT / 综合）；后台题库列表按此筛选
        "method": s.get("method") or "",
        "description": s["description"],
        # 所属题库系列（0 = 散题库，考生端归到「其他题库」）
        "series_id": int(series_id) if series_id else 0,
        "series_name": series_name,
        "has_cover": bool((s.get("cover_name") or "").strip()),
        # 管理端「上移 / 下移」排定的顺序（越大越靠前；0 = 从没排过，按 id 倒序兜底）
        "sort_order": int(s.get("sort_order") or 0),
        "total": conn.execute(
            "SELECT COUNT(*) AS n FROM questions WHERE set_id = ?", (s["id"],)
        ).fetchone()["n"],
        "qtype_counts": _qtype_counts(conn, s["id"]),
        "chapter_count": conn.execute(
            "SELECT COUNT(*) AS n FROM question_chapters WHERE set_id = ?", (s["id"],)
        ).fetchone()["n"],
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
        # 内置题库的方向天生就是 UT/RT/MT/PT，纳入题库列表的方向筛选
        "method": b["method"],
        "level": BUILTIN_LEVEL,
        "description": "内置一级题库（CSV 导入）",
        "builtin": True,
        "series_id": 0,
        "series_name": "",
        "has_cover": False,
        "sort_order": 0,
        "total": total,
        "qtype_counts": counts,
        "chapter_count": 0,
        "created_at": "",
    }


# ── 章节（题库下面的「章」，CSV 按章导入；题目通过 chapter_id + topic1 双重归属） ──

def _get_chapter(conn, set_id: int, chapter_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM question_chapters WHERE id = ? AND set_id = ?", (chapter_id, set_id)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="章节不存在或不属于该题库")
    return row_to_dict(row)


def _chapter_public(conn, c: dict, user_id: int = 0) -> dict:
    """章节对外字段：题数（可按我做的题数算完成度）。user_id=0 = 管理端，不算已做。"""
    count = conn.execute(
        "SELECT COUNT(*) AS n FROM questions WHERE chapter_id = ?", (c["id"],)
    ).fetchone()["n"]
    answered = 0
    if user_id:
        answered = conn.execute(
            """SELECT COUNT(DISTINCT a.question_id) AS n
                 FROM answer_records a JOIN questions q ON q.id = a.question_id
                WHERE q.chapter_id = ? AND a.user_id = ?""",
            (c["id"], user_id),
        ).fetchone()["n"]
    return {
        "id": c["id"],
        "set_id": c["set_id"],
        "name": c["name"],
        "description": c["description"] or "",
        "sort_order": int(c.get("sort_order") or 0),
        "count": int(count or 0),
        "answered": int(answered or 0),
        "created_at": c["created_at"],
    }


# ── 管理端：题库 CRUD ───────────────────────────────────────

class SetBody(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    level: str = Field(default="", max_length=20)
    # 方向/类型：'' 通用 / UT / RT / MT / PT / ET / VT / 综合（与题库系列同口径 QS_METHODS）
    method: str = Field(default="", max_length=8)
    description: str = Field(default="", max_length=200)
    series_id: int = Field(default=0, ge=0, description="所属题库系列 id；0 = 散题库")


def _clean_method(method: str) -> str:
    """校验方向取值（与题库系列 QS_METHODS 同源）；'' = 通用。"""
    m = (method or "").strip()
    if m not in QS_METHODS:
        raise HTTPException(status_code=400, detail="方向取值不合法")
    return m


def _resolve_series_id(conn, series_id: int) -> int | None:
    """校验题库系列存在（0 / 负数一律当「不归任何系列」）。"""
    if not series_id or series_id < 0:
        return None
    row = conn.execute("SELECT id FROM question_set_series WHERE id = ?", (series_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="题库系列不存在或已删除")
    return int(series_id)


@admin_router.get("", summary="题库列表（含内置一级题库与各题型题数，可按系列/方向/级别/关键词筛选）")
def list_sets(
    series_id: int = Query(default=0, ge=0, description="只看某个系列下的题库"),
    loose: int = Query(default=0, ge=0, le=1, description="1 = 只看未归系列的散题库"),
    method: str = Query(default="", max_length=8, description="只看某个方向的题库（UT/RT/…/综合）"),
    level: str = Query(default="", max_length=20),
    q: str = Query(default="", max_length=50),
    include_builtin: int = Query(default=1, ge=0, le=1, description="0 = 不返回内置一级题库"),
    admin: dict = Depends(get_current_admin),
):
    sql = "SELECT * FROM question_sets WHERE 1=1"
    params: list = []
    if series_id:
        sql += " AND series_id = ?"
        params.append(series_id)
    elif loose:
        sql += " AND (series_id IS NULL OR series_id = 0)"
    if method:
        # 内置题库（set_id 为 NULL）没有 method 列，这里只筛自定义题库；内置在下面按方向单独过滤
        sql += " AND method = ?"
        params.append(method)
    if level:
        sql += " AND level = ?"
        params.append(level)
    if q.strip():
        sql += " AND (name LIKE ? OR description LIKE ?)"
        kw = f"%{q.strip()}%"
        params.extend([kw, kw])
    sql += " ORDER BY sort_order DESC, id DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
        custom = [_set_public(conn, row_to_dict(r)) for r in rows]
        # 内置题库没有「所属系列」的概念：一旦按系列 / 只看散题库筛选，就不能再往里塞内置题库
        # （但方向筛选例外 —— 内置题库天生带方向，按方向筛时保留相符的内置题库）
        show_builtin = bool(include_builtin) and not series_id and not loose
        builtins = [_builtin_public(conn, b) for b in BUILTIN_SETS] if show_builtin else []
        if method:
            builtins = [b for b in builtins if b["method"] == method]
    return {"items": builtins + custom}


@admin_router.post("", summary="新建题库")
def create_set(body: SetBody, admin: dict = Depends(get_current_admin)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="题库名称不能为空")
    method = _clean_method(body.method)
    with get_conn() as conn:
        dup = conn.execute("SELECT id FROM question_sets WHERE name = ?", (name,)).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="已存在同名题库")
        sid = _resolve_series_id(conn, body.series_id)
        cur = conn.execute(
            """INSERT INTO question_sets (name, level, method, description, series_id, cover_name, sort_order, created_at)
               VALUES (?,?,?,?,?,'',(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM question_sets),?)""",
            (name, body.level.strip(), method, body.description.strip(), sid, now_iso()),
        )
        set_id = cur.lastrowid
    return {"ok": True, "id": set_id, "message": f"题库「{name}」已创建"}


@admin_router.put("/{set_id}", summary="修改题库信息（名称/级别/方向/描述/所属系列）")
def update_set(set_id: int, body: SetBody, admin: dict = Depends(get_current_admin)):
    if set_id < 0:
        raise HTTPException(status_code=400, detail="内置题库不能编辑名称/级别")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="题库名称不能为空")
    method = _clean_method(body.method)
    with get_conn() as conn:
        _get_set(conn, set_id)
        dup = conn.execute(
            "SELECT id FROM question_sets WHERE name = ? AND id != ?", (name, set_id)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="已存在同名题库")
        sid = _resolve_series_id(conn, body.series_id)
        conn.execute(
            "UPDATE question_sets SET name = ?, level = ?, method = ?, description = ?, series_id = ? WHERE id = ?",
            (name, body.level.strip(), method, body.description.strip(), sid, set_id),
        )
    return {"ok": True, "message": "题库信息已更新"}


@admin_router.delete("/{set_id}", summary="删除题库（连同章节、题目与相关答题记录；内置题库不可删）")
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
        conn.execute(
            """UPDATE question_reports SET status = 'resolved', handled_by = ?, handled_at = ?
               WHERE status = 'pending' AND question_id IN
               (SELECT id FROM questions WHERE set_id = ?)""",
            (admin["username"], now_iso(), set_id),
        )
        deleted = conn.execute(
            "DELETE FROM questions WHERE set_id = ?", (set_id,)
        ).rowcount
        chapters = conn.execute(
            "DELETE FROM question_chapters WHERE set_id = ?", (set_id,)
        ).rowcount
        conn.execute("DELETE FROM question_sets WHERE id = ?", (set_id,))
    unlink_quiet(s.get("cover_name") or "")   # 题库封面文件一并删
    return {"ok": True, "removed_questions": deleted, "removed_chapters": chapters,
            "message": f"题库「{s['name']}」已删除（含 {chapters} 个章节、{deleted} 道题）"}


# ── 管理端：题库封面 + 排序 ─────────────────────────────────

def _custom_set_or_400(conn, set_id: int) -> dict:
    if set_id < 0:
        raise HTTPException(status_code=400, detail="内置题库没有封面（考生端用系统图标）")
    return _get_set(conn, set_id)


@admin_router.get("/{set_id}/cover", summary="取题库封面（管理员预览）")
def admin_get_set_cover(set_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        s = _custom_set_or_400(conn, set_id)
    return cover_response(s.get("cover_name") or "")


@admin_router.post("/{set_id}/cover", summary="设置 / 替换题库封面（老封面一并删除）")
async def admin_set_set_cover(
    set_id: int,
    cover: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await save_cover(cover, prefix="qset")
    with get_conn() as conn:
        s = _custom_set_or_400(conn, set_id)
        old = (s.get("cover_name") or "").strip()
        conn.execute("UPDATE question_sets SET cover_name = ? WHERE id = ?", (new_name, set_id))
    unlink_quiet(old)
    return {"ok": True, "message": f"题库「{s['name']}」封面已更新"}


@admin_router.delete("/{set_id}/cover", summary="清除题库封面")
def admin_clear_set_cover(set_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        s = _custom_set_or_400(conn, set_id)
        old = (s.get("cover_name") or "").strip()
        conn.execute("UPDATE question_sets SET cover_name = '' WHERE id = ?", (set_id,))
    unlink_quiet(old)
    return {"ok": True, "message": f"题库「{s['name']}」已恢复默认封面"}


class OrderBody(BaseModel):
    """后台「上移 / 下移」提交的完整可见顺序（只带本次列表里显示出来的 id）。"""

    ids: list[int] = Field(default_factory=list, max_length=2000)


@admin_router.post("/order", summary="批量调整题库顺序（后台「上移 / 下移」）")
def admin_order_sets(body: OrderBody, admin: dict = Depends(get_current_admin)):
    """注意：本路由必须声明在 /{set_id} 之前，否则 'order' 会被当成 id 解析报 422。
    传进来的内置题库伪 id（负数）库里不存在，apply_manual_order 会自动忽略。"""
    with get_conn() as conn:
        n = apply_manual_order(conn, "question_sets", body.ids)
    return {"ok": True, "updated": n, "message": f"已调整 {n} 套题库的顺序"}


# ── 管理端：章节管理（题库下面自己建章节，CSV 按章节导入） ──

class ChapterBody(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    description: str = Field(default="", max_length=200)


@admin_router.get("/{set_id}/chapters", summary="章节列表（带题数与题型分布）")
def list_chapters(set_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        if set_id < 0:            # 内置题库不支持建章节，但按知识点分组的既有章节照常展示
            where, params = _scope_where(set_id)
            rows = conn.execute(
                f"""SELECT topic1 AS name, COUNT(*) AS n FROM questions
                    WHERE {where} AND topic1 != '' GROUP BY topic1 ORDER BY topic1""",
                params,
            ).fetchall()
            return {"items": [
                {"id": 0, "set_id": set_id, "name": r["name"], "description": "",
                 "sort_order": 0, "count": r["n"], "answered": 0, "created_at": "",
                 "readonly": True}
                for r in rows
            ]}
        _get_set(conn, set_id)
        rows = conn.execute(
            "SELECT * FROM question_chapters WHERE set_id = ? ORDER BY sort_order, id", (set_id,)
        ).fetchall()
        # 还没归章的老题（CSV 导入时只带了知识点一）：后台提示用，不在这里列出来
        untagged = conn.execute(
            "SELECT COUNT(*) AS n FROM questions WHERE set_id = ? AND chapter_id IS NULL", (set_id,)
        ).fetchone()["n"]
        # 注意：题数要在这里就算出来 —— get_conn 出块就关连接，出去再查库会报 closed database
        items = [_chapter_public(conn, row_to_dict(r)) for r in rows]
    return {"items": items, "untagged": int(untagged or 0)}


@admin_router.post("/{set_id}/chapters", summary="新建章节")
def create_chapter(set_id: int, body: ChapterBody, admin: dict = Depends(get_current_admin)):
    if set_id < 0:
        raise HTTPException(status_code=400, detail="内置题库不能新建章节")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="章节名称不能为空")
    with get_conn() as conn:
        _get_set(conn, set_id)
        dup = conn.execute(
            "SELECT id FROM question_chapters WHERE set_id = ? AND name = ?", (set_id, name)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="该题库下已存在同名章节")
        cur = conn.execute(
            """INSERT INTO question_chapters (set_id, name, description, sort_order, created_at)
               VALUES (?,?,?,(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM question_chapters WHERE set_id = ?),?)""",
            (set_id, name, body.description.strip(), set_id, now_iso()),
        )
        chapter_id = cur.lastrowid
    return {"ok": True, "id": chapter_id, "message": f"章节「{name}」已创建，可以往里导入 CSV 了"}


@admin_router.put("/{set_id}/chapters/{chapter_id}", summary="修改章节（改名会同步已导入题目的知识点）")
def update_chapter(
    set_id: int, chapter_id: int, body: ChapterBody, admin: dict = Depends(get_current_admin)
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="章节名称不能为空")
    with get_conn() as conn:
        c = _get_chapter(conn, set_id, chapter_id)
        dup = conn.execute(
            "SELECT id FROM question_chapters WHERE set_id = ? AND name = ? AND id != ?",
            (set_id, name, chapter_id),
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="该题库下已存在同名章节")
        conn.execute(
            "UPDATE question_chapters SET name = ?, description = ? WHERE id = ?",
            (name, body.description.strip(), chapter_id),
        )
        if name != c["name"]:
            # 章节名冗余在 questions.topic1（考生端按章节练习/统计沿用老口径），改名要一起同步
            conn.execute(
                "UPDATE questions SET topic1 = ? WHERE chapter_id = ?", (name, chapter_id)
            )
    return {"ok": True, "message": "章节已更新"}


@admin_router.delete("/{set_id}/chapters/{chapter_id}", summary="删除章节（章节内题目保留，退回「未归章节」）")
def delete_chapter(set_id: int, chapter_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        c = _get_chapter(conn, set_id, chapter_id)
        kept = conn.execute(
            "UPDATE questions SET chapter_id = NULL, topic1 = '' WHERE chapter_id = ?", (chapter_id,)
        ).rowcount
        conn.execute("DELETE FROM question_chapters WHERE id = ?", (chapter_id,))
    return {"ok": True, "kept_questions": kept,
            "message": f"章节「{c['name']}」已删除（{kept} 道题退回「未归章节」，题目都还在）"}


@admin_router.post("/{set_id}/chapters/order", summary="批量调整章节顺序（后台「上移 / 下移」）")
def order_chapters(set_id: int, body: OrderBody, admin: dict = Depends(get_current_admin)):
    """章节按「自然顺序」排（sort_order 升序 = 列表从上到下），与题库/系列的从大到小相反：
    章节列表在后台和考生端都是编号清单（01、02、03…），新建的章节追加在最后，
    这里 body.ids = 后台当前可见的完整顺序，只把这几条占的槽位换内容，其它记录位置不动。"""
    with get_conn() as conn:
        global_ids = [
            int(r["id"])
            for r in conn.execute(
                "SELECT id FROM question_chapters WHERE set_id = ? ORDER BY sort_order, id", (set_id,)
            ).fetchall()
        ]
        if not global_ids:
            return {"ok": True, "updated": 0, "message": "已调整 0 个章节的顺序"}
        valid = set(global_ids)
        seen: set[int] = set()
        order: list[int] = []
        for raw in body.ids:
            i = int(raw)
            if i in valid and i not in seen:
                seen.add(i)
                order.append(i)
        new_ids = list(global_ids)
        for slot, nid in zip([k for k, gid in enumerate(global_ids) if gid in seen], order):
            new_ids[slot] = nid
        conn.executemany(
            "UPDATE question_chapters SET sort_order = ? WHERE id = ?",
            [(k + 1, cid) for k, cid in enumerate(new_ids)],
        )
    return {"ok": True, "updated": len(order), "message": f"已调整 {len(order)} 个章节的顺序"}


# ── 管理端：题目管理 ────────────────────────────────────────

def _escape_like(text: str) -> str:
    """转义 LIKE 的通配符（配合 ESCAPE '\\'）：否则管理员搜「_」或「%」会全表命中。"""
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@admin_router.get("/{set_id}/questions", summary="题库题目列表（内置/自定义通用，可按题型筛选、按关键词搜索）")
def list_questions(
    set_id: int,
    qtype: str = Query(default="", pattern=QTYPE_FILTER),
    q: str = Query(default="", max_length=60, description="关键词：匹配题干 / 选项 / 答案"),
    limit: int = Query(default=500, ge=1, le=2000),
    admin: dict = Depends(get_current_admin),
):
    """带序号返回。

    seq = 题目在**整套题库**里的固定序号（1 起，按录入顺序，与内置题库原始序号一致），
    只在整库范围内编号、不受题型筛选和关键词搜索影响 —— 这样后台列表、搜索结果、
    编辑弹窗里看到的都是同一个号，方便对着纸质题册 / 导入文件核题。
    """
    with get_conn() as conn:
        where, params = _scope_where(set_id)
        picks: list[str] = []
        extra: list = []
        if qtype:
            picks.append("qtype = ?")
            extra.append(qtype)
        kw = (q or "").strip()
        if kw:
            # 选项文本存在 options_json（JSON 字符串）里，用 LIKE 直接命中即可，
            # 不解 JSON —— 这样题干、选项、答案三处任意位置的关键词都能搜到。
            like = f"%{_escape_like(kw)}%"
            picks.append(
                "(content LIKE ? ESCAPE '\\' OR options_json LIKE ? ESCAPE '\\'"
                " OR answer LIKE ? ESCAPE '\\')"
            )
            extra.extend([like, like, like])
        sql = (
            f"WITH ranked AS (SELECT *, ROW_NUMBER() OVER (ORDER BY id) AS seq"
            f" FROM questions WHERE {where}) SELECT * FROM ranked"
            + (" WHERE " + " AND ".join(picks) if picks else "")
            + " ORDER BY seq LIMIT ?"
        )
        rows = conn.execute(sql, params + extra + [limit]).fetchall()
    items = []
    for r in rows:
        d = row_to_dict(r)
        items.append({
            "id": d["id"],
            "seq": int(d["seq"]),  # 题库内固定序号（1 起），后端权威，前端别自己数
            "qtype": d["qtype"],
            "qtype_label": QTYPE_NAMES.get(d["qtype"], d["qtype"]),
            "content": d["content"],
            "options": json.loads(d["options_json"]),
            "answer": d["answer"],
            # 「题目原题讲解」的解答过程（后台编辑弹窗回填用；老题多为空）
            "explanation": d.get("explanation") or "",
            # 章节归属（老数据可能只有知识点一没有 chapter_id）
            "chapter_id": int(d.get("chapter_id") or 0),
            "topic": d.get("topic1") or "",
        })
    return {"items": items}


class QuestionBody(BaseModel):
    qtype: str = Field(pattern=QTYPE_ONLY)
    content: str = Field(min_length=1, max_length=2000)
    options_raw: str = Field(default="", max_length=4000,
                             description="选项文本，A、xx；##B、xx；##…；判断题留空自动生成")
    answer: str = Field(min_length=1, max_length=1000,
                        description="选择题=单个选项字母；多选题=多个字母（如 ACD）；"
                                    "判断题=正确/错误；计算题/简答题=参考文本")
    explanation: str = Field(default="", max_length=2000)
    chapter_id: int = Field(default=0, ge=0, description="归到哪个章节；0 = 不归章节")


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
    if qtype == "multi":
        keys = [o["key"] for o in options]
        norm = normalize_multi_answer(answer)
        if not norm:
            raise HTTPException(status_code=400,
                                detail="多选题答案请填选项字母，如 AC（多个字母连着写，顺序不限）")
        bad = [ch for ch in norm if ch not in keys]
        if bad:
            raise HTTPException(status_code=400,
                                detail=f"答案里的 「{'、'.join(bad)}」 不在选项内（可选：{'/'.join(keys)}）")
        return norm
    if qtype in ("single", "calcsel"):
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
        # 选择题 / 多选题 / 计算选择题必须有选项，否则考生没法作答
        if qtype in CHOICE_QTYPES and len(options) < 2:
            raise HTTPException(status_code=400,
                                detail="选择题/多选题至少需要 2 个选项（格式：A、选项；##B、选项）")
    return qtype, options, _normalize_answer(qtype, answer, options)


@admin_router.post("/{set_id}/questions", summary="添加单题（内置/自定义题库通用；自定义题库可指定章节）")
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
            topic1, chapter_id = "", None
        else:
            s = _get_set(conn, set_id)
            method, grade, db_set_id = SET_METHOD, s["level"], set_id
            # 指定了章节：章节名冗余写进 topic1，考生端「按章节练习」直接用
            topic1, chapter_id = "", None
            if body.chapter_id:
                c = _get_chapter(conn, set_id, body.chapter_id)
                topic1, chapter_id = c["name"], c["id"]
        cur = conn.execute(
            """INSERT INTO questions
               (set_id, chapter_id, method, grade, topic1, topic2, qtype, content, options_json, answer, explanation, source_no, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (db_set_id, chapter_id, method, grade, topic1, "", qtype, content,
             json.dumps(options, ensure_ascii=False), answer,
             _clean_text(body.explanation), 0, now_iso()),
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
        # chapter_id > 0 时一并改章节归属（topic1 跟着章节名走）；等于 0 = 不改动章节
        if set_id > 0 and body.chapter_id:
            c = _get_chapter(conn, set_id, body.chapter_id)
            conn.execute(
                "UPDATE questions SET chapter_id = ?, topic1 = ? WHERE id = ?",
                (c["id"], c["name"], question_id),
            )
        conn.execute(
            """UPDATE questions
               SET qtype = ?, content = ?, options_json = ?, answer = ?, explanation = ?
               WHERE id = ?""",
            (qtype, content, json.dumps(options, ensure_ascii=False), answer,
             _clean_text(body.explanation), question_id),
        )
        # 题目被修正后，之前针对它的待处理纠错工单一并关闭
        conn.execute(
            """UPDATE question_reports SET status = 'resolved', handled_by = ?, handled_at = ?
               WHERE question_id = ? AND status = 'pending'""",
            (admin["username"], now_iso(), question_id),
        )
    return {"ok": True, "message": "题目已更新"}


# 导入模板文件：与项目根「题库导入模板.csv」同源（单一维护点，别在别处再存一份）
TEMPLATE_PATH = Path(__file__).resolve().parent.parent.parent / "题库导入模板.csv"


@admin_router.get("/import-template", summary="下载题库导入模板 CSV（标准 8 列 + 六种题型示例）")
def download_import_template(admin: dict = Depends(get_current_admin)):
    """后台「批量导入题目」弹窗的「下载模板」按钮走这里。

    注意：本路由是 GET /import-template，与 GET /{set_id}/cover 这类子路径不冲突；
    若将来新增 GET /{set_id} 形式的接口，必须把它声明在本路由之后。
    """
    if not TEMPLATE_PATH.exists():
        raise HTTPException(status_code=404, detail="模板文件不存在（服务端缺少 题库导入模板.csv）")
    disp = f"attachment; filename=tiku-template.csv; filename*=UTF-8''{quote('题库导入模板.csv')}"
    return Response(
        content=TEMPLATE_PATH.read_bytes(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": disp},
    )


@admin_router.post("/{set_id}/import", summary="批量导入题目（CSV / Excel，可指定章节；自动识别编码、列名与题型）")
def import_csv(set_id: int, body: dict, admin: dict = Depends(get_current_admin)):
    """body.csv = 已解码的 CSV 文本；或 body.file_b64 = 原始文件字节（base64）+ body.filename。
    可选 body.chapter_id = 章节 id。

    标准格式：序号,项目,知识点一,知识点二,题目类型,题目内容,题目选项,题目答案
    「题目类型」列决定入库的题型，认不出的一律按选择题兜底：
      判断题 / 选择题（单选）/ 多选题 / 计算题 / 计算选择题 / 简答题
    兼容格式（tabular.py 自动识别，认不出就按位置解析）：
      - 文件真实类型：.xlsx（哪怕扩展名写成 .csv）/ GBK 或 UTF-8 的 CSV 文本
      - 表头列名：章节→知识点一、题型→题目类型、题目→题目内容、选项A~E→题目选项、答案→题目答案
    指定章节时，导入的题一律归到该章节（知识点一以章节名为准），考生端即可按章练习。

    返回的三类反馈都面向管理员（前端「导入结果」小结窗直接展示）：
      - errors          跳过的行（没写进题库）：行号 + 原因 + 怎么改
      - warnings        已导入但值得复查的行（如多选题只有 1 个正确项）
      - imported_by_type 本次各题型各导入了多少题"""
    body = body or {}
    raw = body.get("csv", "")
    note = ""

    file_b64 = body.get("file_b64") or ""
    if file_b64:
        try:
            blob = base64.b64decode(file_b64, validate=False)
        except Exception:
            raise HTTPException(status_code=400, detail="文件内容读取失败，请重新选择文件")
        if len(blob) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="文件太大（限 10MB），请拆分后再导入")
        try:
            raw, note = normalize_table_input(blob)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    elif isinstance(raw, str) and raw.strip():
        # 直接粘贴的文本：只做表头列名映射
        raw, note = normalize_text_input(raw)

    if not isinstance(raw, str) or not raw.strip():
        raise HTTPException(status_code=400, detail="请提供 CSV 内容或选择文件")
    chapter_id = int(body.get("chapter_id") or 0)
    chapter_name = ""

    if set_id < 0:
        if chapter_id:
            raise HTTPException(status_code=400, detail="内置题库不能按章节导入（它按 CSV 的知识点一自动分章）")
        b = _builtin_by_id(set_id)
        if not b:
            raise HTTPException(status_code=404, detail="题库不存在")
        method, grade = b["method"], BUILTIN_LEVEL
    else:
        with get_conn() as conn:
            s = _get_set(conn, set_id)
            if chapter_id:
                chapter_name = _get_chapter(conn, set_id, chapter_id)["name"]
        method, grade = SET_METHOD, s["level"]

    imported = skipped = 0
    by_type: dict[str, int] = {code: 0 for code in QTYPE_CODES}
    errors: list[str] = []
    warnings: list[str] = []
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
        # 模板里的说明行（首格以 # 开头）：跳过，不计入错误
        if row and (row[0] or "").lstrip().startswith("#"):
            continue
        if len(row) < 8:
            # 兼容简式：题型,题目,选项,答案
            if len(row) == 4:
                row = ["", "", "", "", row[0], row[1], row[2], row[3]]
            else:
                skipped += 1
                errors.append(f"第 {i} 行：列数不足（需要 8 列，实际 {len(row)} 列）")
                continue
        _no, _project, topic1, topic2, qtype_raw, content, options_raw, answer = row[:8]
        # 列数多于 8：多半是题干或选项里写了英文逗号又没加引号 → 后面几列都错位了，
        # 这类行即使勉强导入也是错题，明确提醒管理员去核对（不阻断导入）
        if len(row) > 8:
            warnings.append(
                f"第 {i} 行：有 {len(row)} 列（标准 8 列），可能是题干/选项里含英文逗号被拆开了，请核对这一行"
            )

        content_clean = _clean_text(content)
        if not content_clean:
            skipped += 1
            errors.append(f"第 {i} 行：题干为空")
            continue

        qtype = _normalize_qtype(qtype_raw)
        label = QTYPE_NAMES.get(qtype, qtype)
        answer_clean = (answer or "").strip()
        if not answer_clean:
            skipped += 1
            errors.append(f"第 {i} 行：答案为空（{label}必须填「题目答案」列）")
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
                errors.append(f"第 {i} 行：判断题答案应为 正确/错误（填 A/B 也认）")
                continue
        elif qtype == "short":
            options = []
            if len(answer_clean) > 1000:
                answer_clean = answer_clean[:1000]
        elif qtype == "calc":
            # 计算题的「答案」是参考文本（公式/数值），**原样存不能转大写**（与手工添加口径一致；
            # 判分是两边都 upper 后比对，不影响对错）；选项可有可无（没选项时考生端按自评作答，属正常）
            options = _parse_options(options_raw)
            if len(answer_clean) > 1000:
                answer_clean = answer_clean[:1000]
        elif qtype == "multi":
            options = _parse_options(options_raw)
            if len(options) < 2:
                skipped += 1
                errors.append(f"第 {i} 行：多选题选项不足 2 个（选项列格式：A、xx；##B、xx）")
                continue
            keys = [o["key"] for o in options]
            answer_clean = normalize_multi_answer(answer_clean)
            bad = [ch for ch in answer_clean if ch not in keys]
            if not answer_clean or bad:
                skipped += 1
                errors.append(
                    f"第 {i} 行：多选题答案「{(answer or '').strip()}」不在选项内"
                    f"（可选：{'/'.join(keys)}；多个答案连着写，如 AC）"
                )
                continue
            if len(answer_clean) < 2:
                warnings.append(f"第 {i} 行：多选题只有 1 个正确项（{answer_clean}），建议题型改「选择题」")
        else:  # single / calcsel —— 都必须选中一个选项字母
            options = _parse_options(options_raw)
            if len(options) < 2:
                skipped += 1
                errors.append(f"第 {i} 行：{label}选项不足 2 个（选项列格式：A、xx；##B、xx）")
                continue
            keys = [o["key"] for o in options]
            answer_clean = answer_clean.upper()
            if answer_clean not in keys:
                hint = "；答案里有多个字母，题型是不是该写「多选题」？" if len(answer_clean) > 1 else ""
                skipped += 1
                errors.append(
                    f"第 {i} 行：{label}答案「{(answer or '').strip()}」不是选项字母"
                    f"（可选：{'/'.join(keys)}）{hint}"
                )
                continue

        with get_conn() as conn:
            conn.execute(
                """INSERT INTO questions
                   (set_id, chapter_id, method, grade, topic1, topic2, qtype, content, options_json, answer, source_no, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (set_id if set_id > 0 else None, chapter_id if chapter_id else None,
                 method, grade,
                 # 指定了章节 → 知识点一以章节名为准（考生端按章练习直接吃这一列）
                 chapter_name if chapter_name else _clean_text(topic1),
                 _clean_text(topic2),
                 qtype, content_clean, json.dumps(options, ensure_ascii=False),
                 answer_clean, 0, now_iso()),
            )
        imported += 1
        by_type[qtype] = by_type.get(qtype, 0) + 1

    detail = "、".join(f"{QTYPE_NAMES[c]} {n}" for c, n in by_type.items() if n)
    where = f"「{chapter_name}」" if chapter_name else ""
    msg = f"导入{where}完成：成功 {imported} 题"
    if detail:
        msg += f"（{detail}）"
    if skipped:
        msg += f"，跳过 {skipped} 条异常行"
    if warnings:
        msg += f"，{len(warnings)} 条需复查提醒"
    return {"ok": True, "imported": imported, "skipped": skipped,
            "imported_by_type": {c: n for c, n in by_type.items() if n},
            "errors": errors[:50], "warnings": warnings[:50],
            "note": note, "message": msg}


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


# ── 考生端：题库列表 + 章节 ─────────────────────────────────

@router.get("/sets", summary="题库列表（题库页数据源，只返回有题的；可按系列筛选）")
def user_sets(
    series_id: int = Query(default=0, ge=0, description="只看某个题库系列下的题库"),
    user: dict = Depends(get_current_user),
):
    """管理员在后台创建并放了题的题库才会出现；按后台排定的顺序。"""
    sql = "SELECT * FROM question_sets WHERE 1=1"
    params: list = []
    if series_id:
        sql += " AND series_id = ?"
        params.append(series_id)
    sql += " ORDER BY sort_order DESC, id DESC"
    with get_conn() as conn:
        items = [_set_public(conn, row_to_dict(r)) for r in conn.execute(sql, params).fetchall()]
    return {"items": [s for s in items if s["total"] > 0]}


@router.get("/sets/{set_id}/cover", summary="取题库封面图（考生端题库卡片）")
def user_set_cover(set_id: int, user: dict = Depends(get_current_user)):
    """没设封面 / 文件丢了都 404（前端回落图标水印），与系列封面同一套实现。"""
    if set_id < 0:
        raise HTTPException(status_code=404, detail="内置题库没有自定义封面")
    with get_conn() as conn:
        s = _get_set(conn, set_id)
        name = (s.get("cover_name") or "").strip()
    return cover_response(name)


@router.get("/sets/{set_id}/chapters", summary="某套题库的章节（练习面板「按章节」数据源）")
def user_set_chapters(
    set_id: int,
    qtype: str = Query(default="", pattern=QTYPE_FILTER),
    user: dict = Depends(get_current_user),
):
    """显式章节（后台「章节管理」建的）+ 老数据按知识点一（topic1）自动分组的章节，两部分合并。

    - 显式章节：按后台排定的顺序在前，空章节也返回（count=0，前端置灰）
    - 按知识点分组：只处理没归章节的题目（CSV 导入时带了知识点一的老数据），按题数降序跟在后面
    - count / answered 都按 qtype 过滤，口径与 /api/bank/chapters 一致（answered 只算本人）
    """
    conds = ["q.set_id = ?"]
    params: list = [set_id]
    if qtype:
        conds.append("q.qtype = ?")
        params.append(qtype)
    where = " AND ".join(conds)
    answered_conds = ["a.user_id = ?", "q.set_id = ?"]
    answered_params: list = [user["id"], set_id]
    if qtype:
        answered_conds.append("q.qtype = ?")
        answered_params.append(qtype)

    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT q.chapter_id AS chapter_id, q.topic1 AS topic, COUNT(*) AS n
                  FROM questions q WHERE {where}
                 GROUP BY q.chapter_id, q.topic1""",
            params,
        ).fetchall()
        answered_by_chapter: dict[int, int] = {}
        answered_loose: dict[str, int] = {}
        for r in conn.execute(
            f"""SELECT q.chapter_id AS chapter_id, q.topic1 AS topic,
                       COUNT(DISTINCT a.question_id) AS n
                  FROM answer_records a JOIN questions q ON q.id = a.question_id
                 WHERE {' AND '.join(answered_conds)}
                 GROUP BY q.chapter_id, q.topic1""",
            answered_params,
        ).fetchall():
            cid = int(r["chapter_id"] or 0)
            if cid:
                answered_by_chapter[cid] = answered_by_chapter.get(cid, 0) + int(r["n"])
            elif (r["topic"] or "").strip():
                answered_loose[r["topic"]] = answered_loose.get(r["topic"], 0) + int(r["n"])
        chapters = [
            row_to_dict(r)
            for r in conn.execute(
                "SELECT * FROM question_chapters WHERE set_id = ? ORDER BY sort_order, id", (set_id,)
            ).fetchall()
        ]

    by_chapter: dict[int, int] = {}
    loose_topics: dict[str, int] = {}
    for r in rows:
        cid = int(r["chapter_id"] or 0)
        if cid:
            by_chapter[cid] = by_chapter.get(cid, 0) + int(r["n"])
        elif (r["topic"] or "").strip():
            loose_topics[r["topic"]] = loose_topics.get(r["topic"], 0) + int(r["n"])

    items = []
    for c in chapters:
        items.append({
            "id": c["id"],
            "chapter_id": c["id"],
            "name": c["name"],
            "description": c["description"] or "",
            "count": by_chapter.get(c["id"], 0),
            # 已做数只认 chapter_id（老题可能带过别的知识点一，不能漏算）
            "answered": int(answered_by_chapter.get(c["id"], 0) or 0),
            "tagged": True,
        })
    for topic, n in sorted(loose_topics.items(), key=lambda kv: (-kv[1], kv[0])):
        items.append({
            "id": 0,
            "chapter_id": 0,
            "name": topic,
            "description": "",
            "count": n,
            "answered": int(answered_loose.get(topic, 0) or 0),
            "tagged": False,
        })
    return {"items": items}
