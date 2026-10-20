"""
题库系列模块 —— 题库页最外一层的分组（v30）。

结构：题库系列（question_set_series，如「二级 UT 题库系列」）
      → 题库（question_sets，series_id 归属；NULL = 散题库，考生端归到「其他题库」）
      → 章节（question_chapters，题库下面自己建，CSV 按章节导入）
      → 题目（questions）

接口：
  管理端（需管理员登录，admin_router）：
    GET    /api/admin/question-series                 系列列表（可按级别 / 方向筛选，带题库数与题数）
    POST   /api/admin/question-series                 新建系列 {name, level, method, description}
    PUT    /api/admin/question-series/{id}            修改系列
    DELETE /api/admin/question-series/{id}            删除系列（**题库保留**，退回「其他题库」）
    POST   /api/admin/question-series/order           批量调整系列顺序（body.ids = 后台当前可见的完整顺序）
    GET    /api/admin/question-series/{id}/cover      取系列封面（管理员预览）
    POST   /api/admin/question-series/{id}/cover      设置 / 替换系列封面（老封面一并删）
    DELETE /api/admin/question-series/{id}/cover      清除系列封面
  考生端（需考生登录，router）：
    GET    /api/bank/series                           系列列表（题库页系列卡，只返回有题库的）
    GET    /api/bank/series/{id}/cover                系列封面图（无封面 404，前端回落图标水印）

设计取舍：
  - 只做两层「系列 → 题库」，章节挂在题库下（不是挂在系列下），因为考生端的练习范围
    单位是「题库」（practice_progress / answer_records 都按 set_id 记），章节必须能定位到唯一题库
  - 删系列不删题库：代码把 question_sets.series_id 置 NULL，题库退回「其他题库」，可放心整理
  - 封面文件与资料库共用同一个上传目录与校验逻辑（modules/upload_utils.py）

修改注意：
  - ⚠️ /order 路由必须声明在 /{series_id} 之前，否则 'order' 会被当成 id 解析报 422
  - ⚠️ 本模块的路由前缀是 /api/bank（与 bank.py、question_sets.py 同前缀，各自独立 APIRouter）
"""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user
from modules.upload_utils import (
    apply_manual_order,
    cover_response,
    save_cover,
    unlink_quiet,
)

admin_router = APIRouter(prefix="/api/admin/question-series", tags=["题库系列"])
router = APIRouter(prefix="/api/bank", tags=["题库"])

# 方向代码（与 src/types.ts NDTMethod / materials.MATERIAL_METHODS 同口径，'' = 通用）
QS_METHODS = ("", "UT", "RT", "MT", "PT", "ET", "VT", "综合")

TABLE = "question_set_series"


# ── 内部工具 ────────────────────────────────────────────────

def _get_series(conn, series_id: int) -> dict:
    row = conn.execute("SELECT * FROM question_set_series WHERE id = ?", (series_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="题库系列不存在或已删除")
    return row_to_dict(row)


def _series_public(s: dict, bank_count: int = 0, total: int = 0) -> dict:
    """对外字段（管理端 / 考生端共用）。"""
    return {
        "id": s["id"],
        "name": s["name"],
        "level": s["level"] or "",
        "method": s["method"] or "",
        "description": s["description"] or "",
        "has_cover": bool((s.get("cover_name") or "").strip()),
        "sort_order": int(s.get("sort_order") or 0),
        "created_by": s.get("created_by") or "",
        "created_at": s["created_at"],
        "bank_count": int(bank_count or 0),   # 系列下题库数
        "total": int(total or 0),             # 系列下题目总数
    }


# 系列 + 题库数 + 题数（三条列表接口共用同一段 SQL，避免口径跑偏）
_SERIES_SQL = f"""
SELECT s.*,
       (SELECT COUNT(*) FROM question_sets q WHERE q.series_id = s.id) AS bank_count,
       (SELECT COUNT(*) FROM questions qs
          JOIN question_sets q2 ON q2.id = qs.set_id
         WHERE q2.series_id = s.id) AS total
  FROM {TABLE} s
"""


# ── 管理端：系列 CRUD ───────────────────────────────────────

class SeriesBody(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    level: str = Field(default="", max_length=20)
    method: str = Field(default="", max_length=8)
    description: str = Field(default="", max_length=200)


def _clean_series_body(body: SeriesBody) -> tuple[str, str, str, str]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="系列名称不能为空")
    if body.method not in QS_METHODS:
        raise HTTPException(status_code=400, detail="方向取值不合法")
    return name, body.level.strip(), body.method, body.description.strip()


@admin_router.get("", summary="题库系列列表（可按级别 / 方向筛选，带题库数与题数）")
def list_series(
    level: str = Query(default="", max_length=20),
    method: str = Query(default="", max_length=8),
    admin: dict = Depends(get_current_admin),
):
    sql = _SERIES_SQL + " WHERE 1=1"
    params: list = []
    if level:
        sql += " AND s.level = ?"
        params.append(level)
    if method:
        sql += " AND s.method = ?"
        params.append(method)
    sql += " ORDER BY s.sort_order DESC, s.id DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return {"items": [_series_public(row_to_dict(r), r["bank_count"], r["total"]) for r in rows]}


@admin_router.post("", summary="新建题库系列")
def create_series(body: SeriesBody, admin: dict = Depends(get_current_admin)):
    name, level, method, description = _clean_series_body(body)
    with get_conn() as conn:
        dup = conn.execute("SELECT id FROM question_set_series WHERE name = ?", (name,)).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="已存在同名题库系列")
        cur = conn.execute(
            f"""INSERT INTO {TABLE} (name, level, method, description, cover_name, sort_order, created_by, created_at)
                VALUES (?,?,?,?,'',(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM {TABLE}),?,?)""",
            (name, level, method, description, admin["username"], now_iso()),
        )
        series_id = cur.lastrowid
    return {"ok": True, "id": series_id, "message": f"题库系列「{name}」已创建"}


@admin_router.put("/{series_id}", summary="修改题库系列（名称/级别/方向/简介）")
def update_series(series_id: int, body: SeriesBody, admin: dict = Depends(get_current_admin)):
    name, level, method, description = _clean_series_body(body)
    with get_conn() as conn:
        _get_series(conn, series_id)
        dup = conn.execute(
            "SELECT id FROM question_set_series WHERE name = ? AND id != ?", (name, series_id)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="已存在同名题库系列")
        conn.execute(
            f"UPDATE {TABLE} SET name = ?, level = ?, method = ?, description = ? WHERE id = ?",
            (name, level, method, description, series_id),
        )
    return {"ok": True, "message": "题库系列已更新"}


@admin_router.delete("/{series_id}", summary="删除题库系列（系列内题库保留，退回「其他题库」）")
def delete_series(series_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        s = _get_series(conn, series_id)
        kept = conn.execute(
            "UPDATE question_sets SET series_id = NULL WHERE series_id = ?", (series_id,)
        ).rowcount
        conn.execute(f"DELETE FROM {TABLE} WHERE id = ?", (series_id,))
    unlink_quiet(s.get("cover_name") or "")
    return {"ok": True, "kept_banks": kept,
            "message": f"题库系列「{s['name']}」已删除（{kept} 套题库退回「其他题库」，题目都还在）"}


# ── 管理端：系列封面 ────────────────────────────────────────

@admin_router.get("/{series_id}/cover", summary="取系列封面（管理员预览）")
def admin_get_cover(series_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        s = _get_series(conn, series_id)
    return cover_response(s.get("cover_name") or "")


@admin_router.post("/{series_id}/cover", summary="设置 / 替换系列封面（老封面一并删除）")
async def admin_set_cover(
    series_id: int,
    cover: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await save_cover(cover, prefix="qseries")
    with get_conn() as conn:
        s = _get_series(conn, series_id)
        old = (s.get("cover_name") or "").strip()
        conn.execute(f"UPDATE {TABLE} SET cover_name = ? WHERE id = ?", (new_name, series_id))
    unlink_quiet(old)
    return {"ok": True, "message": f"系列「{s['name']}」封面已更新"}


@admin_router.delete("/{series_id}/cover", summary="清除系列封面")
def admin_clear_cover(series_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        s = _get_series(conn, series_id)
        old = (s.get("cover_name") or "").strip()
        conn.execute(f"UPDATE {TABLE} SET cover_name = '' WHERE id = ?", (series_id,))
    unlink_quiet(old)
    return {"ok": True, "message": f"系列「{s['name']}」已恢复默认封面"}


# ── 管理端：系列排序 ────────────────────────────────────────

class OrderBody(BaseModel):
    """后台「上移 / 下移」提交的完整可见顺序（只带本次列表里显示出来的 id）。"""

    ids: list[int] = Field(default_factory=list, max_length=2000)


@admin_router.post("/order", summary="批量调整题库系列顺序（后台「上移 / 下移」）")
def order_series(body: OrderBody, admin: dict = Depends(get_current_admin)):
    """注意：本路由必须声明在 /{series_id} 之前，否则 'order' 会被当成 id 解析报 422。"""
    with get_conn() as conn:
        n = apply_manual_order(conn, TABLE, body.ids)
    return {"ok": True, "updated": n, "message": f"已调整 {n} 个题库系列的顺序"}


# ── 考生端：系列列表 ────────────────────────────────────────

@router.get("/series", summary="题库系列列表（题库页系列卡数据源，只返回有题库的）")
def user_series(user: dict = Depends(get_current_user)):
    """管理员建好系列并往里放题库后才出现；按后台排定的顺序。"""
    sql = _SERIES_SQL + " WHERE (SELECT COUNT(*) FROM question_sets q WHERE q.series_id = s.id) > 0" \
                        " ORDER BY s.sort_order DESC, s.id DESC"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return {"items": [_series_public(row_to_dict(r), r["bank_count"], r["total"]) for r in rows]}


@router.get("/series/{series_id}/cover", summary="取系列封面图（考生端系列卡片）")
def user_series_cover(series_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        s = _get_series(conn, series_id)
    return cover_response(s.get("cover_name") or "")
