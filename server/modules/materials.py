"""
资料库模块 —— 管理员上传标准 / 教材 / 资料文档与教学视频，考生端在线获取。

结构：大类（category：标准规范 / 教材 / 辅导资料 / 视频课程）
      → 系列（material_series，如「UT 培训视频合集」）
      → 资料（materials，series_id 归属；NULL = 散资料，考生端归到「未归系列」）

接口：
  管理端资料（需管理员登录，admin_router）：
    GET    /api/admin/materials                资料列表（可按分类 / 方向 / 系列 / 关键词筛选，带播放量与收藏数）
    GET    /api/admin/materials?series_id=1    只看某系列内的资料；?loose=1 只看未归系列的散资料
    POST   /api/admin/materials                上传资料（multipart：file + cover? + title/category/method/series_id/description）
    PUT    /api/admin/materials/{id}           修改资料信息（标题/分类/方向/描述/所属系列，不换文件）
    DELETE /api/admin/materials/{id}           删除资料（连服务器上的文件 + 封面 + 观看/收藏/评论一起删）
    POST   /api/admin/materials/order          批量调整资料顺序（后台列表「上移 / 下移」，body.ids = 当前可见的完整顺序）
    GET    /api/admin/materials/{id}/file      下载 / 预览文件（管理员，给的是**原件**）
    POST   /api/admin/materials/slice-existing 给已有 PDF 资料补做按页切片（只补没切过的，可反复调用）
    POST   /api/admin/materials/convert-existing 给已有 Office 文档（doc/ppt/pptx）补做在线预览转换
    GET    /api/admin/materials/office-status  转换队列进度（还剩几份在转）
    GET    /api/admin/materials/{id}/cover     取封面图（管理员预览）
    POST   /api/admin/materials/{id}/cover     替换封面（multipart：cover；老封面文件一起删）
    DELETE /api/admin/materials/{id}/cover     清除封面（考生端回落为「视频首帧」）
  管理端系列（admin_router，注意 /series 路由必须排在 /{material_id} 前面）：
    GET    /api/admin/materials/series                   系列列表（可按大类筛选，带资料数）
    POST   /api/admin/materials/series                   新建系列
    PUT    /api/admin/materials/series/{id}              修改系列（名称/大类/方向/简介）
    DELETE /api/admin/materials/series/{id}              删除系列（**资料保留**，退回未归系列）
    POST   /api/admin/materials/series/order             批量调整系列顺序（同资料，body.ids = 当前可见的完整顺序）
    GET/POST/DELETE /api/admin/materials/series/{id}/cover   系列封面 取 / 设 / 清除
  管理端评论（admin_comment_router）：
    GET    /api/admin/material-comments?material_id=   某资料的评论列表
    POST   /api/admin/material-comments                管理员回复 / 发表评论（以「管理员」身份）
    DELETE /api/admin/material-comments/{id}           删除评论（违规内容）
  考生端（需考生登录，router）：
    GET    /api/library                        资料列表（教材/视频页数据源，带播放量/收藏数/是否已收藏/有无封面/所属系列）
    GET    /api/library?series_id=1            只看某系列内的资料
    GET    /api/library/series                 系列列表（大类页系列卡，带资料数）
    GET    /api/library/series/{id}/cover      系列封面图（无封面返回 404，前端回落图标水印）
    GET    /api/library/favorites              我的收藏（视频）
    GET    /api/library/history                观看历史（我看过的视频，按最近观看倒序，同一视频只保留最近一次）
    DELETE /api/library/history                清空观看历史（隐藏标记，不删行 → 播放量不变）
    DELETE /api/library/history/{id}           从观看历史移除某条（隐藏标记）
    GET    /api/library/{id}                   资料详情（视频详情页数据源）
    GET    /api/library/{id}/file              取文件内容（文档在线打开 / 视频播放，
                                                支持 ?token= 查询参数鉴权与 HTTP Range 断点拖动）
    GET    /api/library/{id}/pages             PDF 切片信息（是否已切片 / 页数 / 每页字节；
                                                Office 资料看的是转换出来的 PDF，口径一致）
    GET    /api/library/{id}/page/{n}          取第 n 页切片（单页翻阅模式，一页一个 PDF）
    GET    /api/library/{id}/preview            文档预览准备状态（Office 转 PDF 进度；调用即触发转换）
    GET    /api/library/{id}/preview-file       取预览用 PDF 整份（切片不可用时的兜底）
    GET    /api/library/{id}/cover             取封面图（管理员指定；无封面返回 404，前端回落到首帧）
    POST   /api/library/{id}/view              记一次播放（B 站式口径：每次打开 +1）
    POST   /api/library/{id}/favorite          收藏
    DELETE /api/library/{id}/favorite          取消收藏
    GET    /api/library/{id}/comments          评论列表（楼中楼：顶层评论带 replies + reply_count）
    POST   /api/library/{id}/comments          发表评论 / 回复（1~200 字，即时可见；带 parent_id = 回复，
                                               被回复人会收到一条「收到新回复」站内通知）
    DELETE /api/library/comments/{id}          删除自己的评论（删顶层连楼中楼回复一起删）

数据模型：
  - materials 表存元数据（标题/分类/方向/文件名/大小/mime/封面名/所属系列），文件字节存 server/data/uploads/
    （视频动辄几百 MB，塞进 SQLite 会让整个库变慢，所以元数据入库、内容落盘）
  - **PDF 按页切片**（见 modules/pdf_slice.py）：上传 PDF 时额外把每页拆成独立小 PDF，
    存在 uploads/<stored_name>.pages/slices/<n>.pdf，页数/每页大小写在同目录 pages.json。
    原件**保留不删**（管理员下载 / 兜底打开 / 切片失败回落都用它）。切片不建表、不侵入数据库，
    删除资料时由 delete_material 调 pdf_slice.remove_slices 一并清掉。
    动机：非线性化的大 PDF 走 HTTP Range 也会被 pdf.js 拉满整份（实测 49.5MB/148 页，
    打开首屏下载 49.46MB），切片后首屏只需 42KB。
  - **Office 文档转 PDF**（见 modules/office_view.py）：doc / ppt / pptx 这类前端没有
    渲染方案的格式，用本机 MS Office 经 COM 转成 uploads/<stored_name>.view.pdf，
    再交给 pdf_slice 切片 → 考生端复用上面那套「单页翻阅」。原件保留不删。
    转换在**后台串行队列**里跑（40MB/253 页的 ppt 约 70 秒），上传时自动排队、
    服务启动时给历史资料补转；失败只影响这一份的在线预览，前端提示「本地打开」。
    删除资料时由 delete_material 调 office_view.remove 一并清掉产物与切片。
  - material_series 表存系列（标题/大类/方向/简介/封面），系列与资料是 1:N，用 materials.series_id 关联；
    不建外键约束（SQLite 默认不开），删除系列时由 admin_delete_series 手动把 series_id 置 NULL
  - 封面 cover_name 为空 = 管理员没指定，考生端自动取视频首帧（<video preload=metadata #t=0.1>）
  - 播放量 material_views / 收藏 material_favorites / 评论 material_comments 三张表，
    删除资料时级联清掉（同库删除，不会残留孤儿数据）
  - 评论楼中楼两层结构：回复一律挂根评论（parent_id = 根 id），回复的回复也归到同一根；
    reply_to 存被回复人昵称快照（展示「回复 @xx」）；回复时给被回复人发站内通知
    （走 notifications.py 的 create_batch + push_notification，type=notice 可删除）
  - category 跨端一致常量 MATERIAL_CATEGORIES：standard 标准 / textbook 教材 /
    material 资料 / video 视频（与后台 dashboard.js MATERIAL_CATEGORIES、
    前端 src/screens/MaterialsScreen.tsx 同步）
  - method 存方向：'' 通用 / UT / RT / MT / PT / ET / VT / 综合
  - **sort_order = 管理端排定的展示顺序**（materials 与 material_series 各一份）：
    新上传 / 新建时取「当前最大值 + 1」，于是默认仍是「新的在最前」，与老行为一致；
    后台点「上移 / 下移」调 `_apply_manual_order()`：这批 id 在全表顺序里的槽位不动、
    只把内容按新顺序填回去，再把全表 sort_order 压实成 1..N。列表一律
    `ORDER BY sort_order DESC, id DESC`（sort_order 全为 0 的老库 = 纯按 id 倒序，行为不变）。
    考生端「顺序 / 倒序」按钮只是把同一份结果反过来，不需要额外排序参数。

修改注意：
  - 删除资料会连磁盘文件（含封面）一起删，不可恢复；重名文件在磁盘上按内容哈希前缀改名避免互踩
  - 删除资料还会清掉 PDF 切片目录（pdf_slice.remove_slices）和 Office 转换产物
    （office_view.remove），别忘了新加清理逻辑时同步
  - 切片是「尽力而为」：pdf_slice.build_slices 失败只返回 None，不能让上传失败；
    前端拿 /pages 看到 sliced=false 会自动回落整份 pdf.js 预览（老逻辑始终可用）
  - 删除系列**不删**资料（只把 series_id 置 NULL），避免误操作造成文件丢失
  - 新增分类要同时改 MATERIAL_CATEGORIES + dashboard.js + MaterialsScreen.tsx 三处
  - 考生端路由顺序：/favorites、/history、/series 都必须声明在 /{material_id} 之前，
    否则会被当成 id 解析报 422；管理端同理，/series、/order、/series/order 都要排在 /{material_id} 前
"""

import mimetypes
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from config import BASE_DIR
from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user
from modules import office_view, pdf_slice
from modules.notifications import create_batch, push_notification

admin_router = APIRouter(prefix="/api/admin/materials", tags=["资料库管理"])
admin_comment_router = APIRouter(prefix="/api/admin/material-comments", tags=["视频评论管理"])
router = APIRouter(prefix="/api/library", tags=["资料库"])

# 资料分类（跨端一致常量：backend dashboard.js MATERIAL_CATEGORIES ↔ 前端 MaterialsScreen）
MATERIAL_CATEGORIES = {
    "standard": "标准规范",
    "textbook": "教材",
    "material": "辅导资料",
    "video": "视频课程",
}

# 允许的方向（'' 通用；与 user_accounts.py 的报考方向保持一致）
MATERIAL_METHODS = ["", "UT", "RT", "MT", "PT", "ET", "VT", "综合"]

# 允许上传的扩展名（文档 + 视频）
ALLOWED_EXTENSIONS = {
    "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt",
    "mp4", "webm", "mov", "m4v", "mp3", "m4a",
}
# 允许的封面图扩展名（管理员为视频/资料自定义封面）
# 上传文件 / 封面图的目录、格式限制、封面读写、手动排序一律走共用工具
# （见 modules/upload_utils.py；题库那边也用同一套，避免两处实现跑偏）
from modules.upload_utils import (  # noqa: E402  (放在常量区旁边，便于对照)
    COVER_EXTENSIONS as _COVER_EXTENSIONS,
    MAX_COVER_MB as _MAX_COVER_MB,
    UPLOAD_DIR as _SHARED_UPLOAD_DIR,
    apply_manual_order,
    cover_response as _shared_cover_response,
    ext_of as _ext_of,
    save_cover as _save_cover_file,
    unlink_quiet as _unlink_quiet,
)

COVER_EXTENSIONS = _COVER_EXTENSIONS
MAX_COVER_MB = _MAX_COVER_MB
MAX_UPLOAD_MB = 1024  # 单文件上限（本机局域网使用，放宽到 1GB）

# 前端 DocViewer 自己能渲染的文档格式（与 src/components/DocViewer.tsx 同步）：
#   docx → docx-preview / xlsx·xls·csv → SheetJS / txt → 纯文本
# 不在这里的 Office 格式（doc/ppt/pptx…）走服务端转 PDF（modules/office_view.py）
FRONTEND_RENDER_EXTS = {"docx", "xlsx", "xls", "csv", "txt"}

COMMENT_MAX_LEN = 200  # 单条评论字数上限

# 文件存放目录：server/data/uploads/（与 upload_utils 同一个目录）
UPLOAD_DIR = _SHARED_UPLOAD_DIR


# ── 内部工具 ────────────────────────────────────────────────

def _get_material(conn, material_id: int) -> dict:
    row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="资料不存在或已删除")
    return row_to_dict(row)


def _public(m: dict, view_count: int = 0, fav_count: int = 0, favorited: bool = False) -> dict:
    """对外（考生端/管理端列表共用）的资料字段。"""
    category = m["category"]
    series_id = m.get("series_id")
    return {
        "id": m["id"],
        "title": m["title"],
        "category": category,
        "category_name": MATERIAL_CATEGORIES.get(category, category),
        "method": m["method"] or "",
        "description": m["description"],
        "kind": m["kind"],
        # 所属系列：series_id 为 NULL = 散资料（考生端归到「未归系列」分组）
        "series_id": int(series_id) if series_id else 0,
        "series_name": m.get("series_name") or "",
        "file_name": m["file_name"],
        "file_size": m["file_size"],
        "mime": m["mime"],
        # 管理端「上移 / 下移」排定的顺序（越大越靠前）；0 = 从没排过，按 id 倒序兜底
        "sort_order": int(m.get("sort_order") or 0),
        "created_at": m["created_at"],
        # 封面：管理员指定过才是 true，否则考生端自动取视频首帧
        "has_cover": bool((m.get("cover_name") or "").strip()),
        # 互动数据
        "view_count": int(view_count or 0),
        "fav_count": int(fav_count or 0),
        "favorited": bool(favorited),
        # 仅管理端列表会带上（考生端列表不查这个子查询，为 0 不展示）
        "comment_count": int(m.get("comment_count") or 0),
    }


def _stats_select(user_id: int | None = None, with_comments: bool = False) -> str:
    """列表查询的统计子查询片段（避免 N+1 查询）。user_id 非空时附带「我是否收藏」。"""
    sql = (
        " (SELECT COUNT(*) FROM material_views v WHERE v.material_id = m.id) AS view_count,"
        " (SELECT COUNT(*) FROM material_favorites f WHERE f.material_id = m.id) AS fav_count,"
        " (SELECT s.title FROM material_series s WHERE s.id = m.series_id) AS series_name"
    )
    if with_comments:
        sql += " , (SELECT COUNT(*) FROM material_comments c WHERE c.material_id = m.id) AS comment_count"
    if user_id is not None:
        sql += (
            " , (SELECT COUNT(*) FROM material_favorites f2 WHERE f2.material_id = m.id"
            f" AND f2.user_id = {int(user_id)}) AS favorited"
        )
    return sql


def _row_public(row, with_fav: bool = False) -> dict:
    m = row_to_dict(row)
    return _public(
        m,
        view_count=m.get("view_count", 0),
        fav_count=m.get("fav_count", 0),
        favorited=bool(m.get("favorited", 0)) if with_fav else False,
    )


def _file_path(stored_name: str) -> object:
    return UPLOAD_DIR / stored_name


# ── 手动排序（管理端「上移 / 下移」）────────────────────────
#   实现在 modules/upload_utils.apply_manual_order（题库也用同一套），这里只是别名
_apply_manual_order = apply_manual_order


def _guess_kind(mime: str, ext: str) -> str:
    if mime.startswith("video/") or mime.startswith("audio/") or ext in ("mp4", "webm", "mov", "m4v", "mp3", "m4a"):
        return "video"
    if ext == "pdf":
        return "pdf"
    return "doc"


def _sliced_pages(stored_name: str) -> int:
    """这份文件按页切片后共几页（没切片返回 0）。"""
    if not stored_name:
        return 0
    meta = pdf_slice.read_manifest(UPLOAD_DIR, stored_name) if pdf_slice.is_sliced(UPLOAD_DIR, stored_name) else None
    return int(meta["count"]) if meta else 0


def _preview_pdf_name(m: dict) -> str | None:
    """这份资料在「预览用 PDF」视角下的 stored_name —— 切片 / 翻页接口统一用它。

    - PDF 资料              → 原件本身
    - Office 资料（doc/ppt/pptx…）→ 服务端转换产物（office_view）；还没转好返回 None
    - 其余（docx/xlsx/txt/视频）  → None（前端自己渲染，不走服务端 PDF 链路）

    这样考生端的 /pages、/page/{n} 完全不用关心「这份资料到底是 PDF 还是转出来的 PDF」。"""
    ext = _ext_of(m["file_name"])
    if ext == "pdf":
        return m["stored_name"]
    if office_view.needs_convert(ext) and office_view.is_ready(UPLOAD_DIR, m["stored_name"]):
        return office_view.view_pdf_name(m["stored_name"])
    return None


def _unlink_quiet(stored_name: str) -> None:
    """删磁盘文件，失败不抛（文件本来就可能已被手工清掉）。"""
    if not stored_name:
        return
    try:
        _file_path(stored_name).unlink(missing_ok=True)
    except OSError:
        pass


async def _save_cover(cover: UploadFile) -> str:
    """校验并存封面图，返回磁盘随机文件名（实现在 upload_utils，前缀统一 cover_）。"""
    return await _save_cover_file(cover)


def _unlink_old_cover(stored_name: str) -> None:
    """换 / 清封面时删老文件（静默失败，见 upload_utils.unlink_quiet）。"""
    _unlink_quiet(stored_name)


def _comment_public(c: dict) -> dict:
    # 管理员发的评论 user_id = 0（user_accounts 里不存在该 id，LEFT JOIN 出来全是 NULL）
    is_admin = not int(c.get("user_id") or 0)
    return {
        "id": c["id"],
        "material_id": c["material_id"],
        "user_id": c["user_id"],
        "nickname": "管理员" if is_admin else (c.get("nickname") or c.get("account") or "学员"),
        "avatar": "" if is_admin else (c.get("avatar") or ""),
        "content": c["content"],
        "parent_id": int(c.get("parent_id") or 0),
        "reply_to": c.get("reply_to") or "",
        "created_at": c["created_at"],
    }


_COMMENT_SQL = """
SELECT c.*, u.nickname AS nickname, u.avatar AS avatar, u.account AS account
  FROM material_comments c
  LEFT JOIN user_accounts u ON u.id = c.user_id
"""


# ── 管理端：上传 / 列表 / 改 / 删 / 封面 ─────────────────────

@admin_router.get("", summary="资料列表（带播放量与收藏数）")
def list_materials(
    category: str = Query(default="", pattern="^(|standard|textbook|material|video)$"),
    method: str = Query(default="", max_length=8),
    series_id: int = Query(default=0, ge=0, description="0 = 不限；-1 不支持，散资料用 loose=1"),
    loose: int = Query(default=0, ge=0, le=1, description="1 = 只看未归系列的散资料"),
    q: str = Query(default="", max_length=50),
    limit: int = Query(default=500, ge=1, le=1000),
    admin: dict = Depends(get_current_admin),
):
    sql = f"SELECT m.*,{_stats_select(with_comments=True)} FROM materials m WHERE 1=1"
    params: list = []
    if category:
        sql += " AND m.category = ?"
        params.append(category)
    if method:
        sql += " AND m.method = ?"
        params.append(method)
    if loose:
        sql += " AND m.series_id IS NULL"
    elif series_id:
        sql += " AND m.series_id = ?"
        params.append(series_id)
    if q:
        sql += " AND (m.title LIKE ? OR m.description LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
    # 管理端排定的顺序优先（sort_order 越大越靠前），没排过的按 id 倒序兜底 = 保持老行为
    sql += " ORDER BY m.sort_order DESC, m.id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return {"items": [_row_public(r) for r in rows]}


# ── 管理端：资料系列（大类下的分组）────────────────────────

def _get_series(conn, series_id: int) -> dict:
    row = conn.execute("SELECT * FROM material_series WHERE id = ?", (series_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="系列不存在或已删除")
    return row_to_dict(row)


def _series_public(s: dict, count: int = 0) -> dict:
    return {
        "id": s["id"],
        "title": s["title"],
        "category": s["category"],
        "category_name": MATERIAL_CATEGORIES.get(s["category"], s["category"]),
        "method": s["method"] or "",
        "description": s["description"],
        "has_cover": bool((s.get("cover_name") or "").strip()),
        "created_by": s.get("created_by") or "",
        "sort_order": int(s.get("sort_order") or 0),
        "created_at": s["created_at"],
        "item_count": int(count or 0),
    }


@admin_router.get("/series", summary="系列列表（可按大类筛选，带资料数）")
def admin_list_series(
    category: str = Query(default="", pattern="^(|standard|textbook|material|video)$"),
    admin: dict = Depends(get_current_admin),
):
    """注意：本路由必须声明在 /{material_id} 之前，否则 'series' 会被当成 id 解析报 422。"""
    sql = (
        "SELECT s.*, (SELECT COUNT(*) FROM materials m WHERE m.series_id = s.id) AS item_count"
        " FROM material_series s WHERE 1=1"
    )
    params: list = []
    if category:
        sql += " AND s.category = ?"
        params.append(category)
    sql += " ORDER BY s.sort_order DESC, s.id DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return {"items": [_series_public(row_to_dict(r), row_to_dict(r).get("item_count", 0)) for r in rows]}


class SeriesBody(BaseModel):
    title: str = Field(min_length=1, max_length=60)
    category: str = Field(pattern="^(standard|textbook|material|video)$")
    method: str = Field(default="", max_length=8)
    description: str = Field(default="", max_length=200)


@admin_router.post("/series", summary="新建系列")
def admin_create_series(body: SeriesBody, admin: dict = Depends(get_current_admin)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="系列名不能为空")
    if body.method not in MATERIAL_METHODS:
        raise HTTPException(status_code=400, detail="方向不合法")
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO material_series (title, category, method, description, cover_name, created_by, sort_order, created_at)"
            " VALUES (?,?,?,?,?,?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM material_series), ?)",
            (title, body.category, body.method, body.description.strip(), "", admin["username"], now_iso()),
        )
        series_id = cur.lastrowid
    return {"ok": True, "id": series_id, "message": f"系列「{title}」已创建"}


@admin_router.put("/series/{series_id}", summary="修改系列（名称/大类/方向/简介）")
def admin_update_series(series_id: int, body: SeriesBody, admin: dict = Depends(get_current_admin)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="系列名不能为空")
    if body.method not in MATERIAL_METHODS:
        raise HTTPException(status_code=400, detail="方向不合法")
    with get_conn() as conn:
        s = _get_series(conn, series_id)
        conn.execute(
            "UPDATE material_series SET title = ?, category = ?, method = ?, description = ? WHERE id = ?",
            (title, body.category, body.method, body.description.strip(), series_id),
        )
    return {"ok": True, "message": f"系列「{s['title']}」已更新"}


@admin_router.delete("/series/{series_id}", summary="删除系列（系列内资料保留，变为散资料）")
def admin_delete_series(series_id: int, admin: dict = Depends(get_current_admin)):
    """只删系列本身，**不删**系列里的资料与文件——资料退回「未归系列」。
    这样误删系列不会造成不可恢复的文件丢失；真要清空资料，去资料列表里删。"""
    with get_conn() as conn:
        s = _get_series(conn, series_id)
        cur = conn.execute(
            "UPDATE materials SET series_id = NULL WHERE series_id = ?", (series_id,)
        )
        moved = cur.rowcount
        conn.execute("DELETE FROM material_series WHERE id = ?", (series_id,))
    _unlink_quiet(s.get("cover_name") or "")
    msg = f"系列「{s['title']}」已删除"
    if moved:
        msg += f"，{moved} 份资料已变为「未归系列」"
    return {"ok": True, "message": msg, "moved": int(moved)}


@admin_router.get("/series/{series_id}/cover", summary="取系列封面（管理员预览）")
def admin_get_series_cover(series_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        s = _get_series(conn, series_id)
    return _cover_response(s)


@admin_router.post("/series/{series_id}/cover", summary="设置 / 替换系列封面（老封面一并删除）")
async def admin_set_series_cover(
    series_id: int,
    cover: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await _save_cover(cover)
    with get_conn() as conn:
        s = _get_series(conn, series_id)
        old = (s.get("cover_name") or "").strip()
        conn.execute("UPDATE material_series SET cover_name = ? WHERE id = ?", (new_name, series_id))
    _unlink_quiet(old)
    return {"ok": True, "message": f"系列「{s['title']}」封面已更新"}


@admin_router.delete("/series/{series_id}/cover", summary="清除系列封面")
def admin_clear_series_cover(series_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        s = _get_series(conn, series_id)
        old = (s.get("cover_name") or "").strip()
        conn.execute("UPDATE material_series SET cover_name = '' WHERE id = ?", (series_id,))
    _unlink_quiet(old)
    return {"ok": True, "message": f"系列「{s['title']}」已恢复默认封面"}


class OrderBody(BaseModel):
    """后台「上移 / 下移」提交的完整可见顺序（只带本次列表里显示出来的 id）。"""

    ids: list[int] = Field(default_factory=list, max_length=2000)


@admin_router.post("/order", summary="批量调整资料顺序（后台「上移 / 下移」）")
def admin_order_materials(body: OrderBody, admin: dict = Depends(get_current_admin)):
    """注意：本路由必须声明在 /{material_id} 之前，否则 'order' 会被当成 id 解析报 422。"""
    with get_conn() as conn:
        n = _apply_manual_order(conn, "materials", body.ids)
    return {"ok": True, "updated": n, "message": f"已调整 {n} 份资料的顺序"}


@admin_router.post("/series/order", summary="批量调整系列顺序（后台「上移 / 下移」）")
def admin_order_series(body: OrderBody, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        n = _apply_manual_order(conn, "material_series", body.ids)
    return {"ok": True, "updated": n, "message": f"已调整 {n} 个系列的顺序"}


@admin_router.post("", summary="上传资料（multipart 文件 + 元数据，封面选填）")
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(..., max_length=60),
    category: str = Form(..., pattern="^(standard|textbook|material|video)$"),
    method: str = Form(default="", max_length=8),
    description: str = Form(default="", max_length=200),
    series_id: int = Form(default=0),
    cover: UploadFile | None = File(default=None),
    admin: dict = Depends(get_current_admin),
):
    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if method not in MATERIAL_METHODS:
        raise HTTPException(status_code=400, detail="方向不合法")

    original = file.filename or "file"
    ext = _ext_of(original)
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型「.{ext}」，允许：{'、'.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await file.read()
    size_mb = len(content) / 1024 / 1024
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(status_code=400, detail=f"文件超过 {MAX_UPLOAD_MB}MB 上限")

    # 封面先存盘（校验失败就直接 400，不留垃圾文件）
    cover_name = ""
    if cover is not None and (cover.filename or "").strip():
        cover_name = await _save_cover(cover)

    mime = file.content_type or mimetypes.guess_type(original)[0] or "application/octet-stream"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{secrets.token_hex(10)}.{ext}"  # 磁盘随机名，避免重名互踩 / 路径注入
    (UPLOAD_DIR / stored_name).write_bytes(content)

    # PDF 按页切片（尽力而为）：让考生端「单页翻阅」一次只取一页（~300KB），
    # 而不是打开就拉整份（实测 49.5MB 文件首屏要下 49.46MB）。
    # 失败/小文件/没装 pikepdf 都返回 None，前端自动回落整份预览，不影响上传。
    sliced = pdf_slice.build_slices(UPLOAD_DIR, stored_name) if ext == "pdf" else None

    # Office 文档（doc / ppt / pptx…）排进后台转换队列：转成 PDF + 切片后考生端才能
    # 在线翻阅（前端没有这些格式的渲染方案）。转换在后台串行执行，**不阻塞本次上传**；
    # 失败也只是这份资料没有在线预览，上传本身照常成功。
    converting = office_view.needs_convert(ext)
    if converting:
        office_view.request(UPLOAD_DIR, stored_name)

    with get_conn() as conn:
        # 归属系列：0 / 不存在 → 视为散资料（不因系列填错而丢失上传的文件，退回散资料更安全）
        sid: int | None = None
        if series_id:
            row = conn.execute("SELECT id FROM material_series WHERE id = ?", (series_id,)).fetchone()
            sid = int(row["id"]) if row else None
        cur = conn.execute(
            """INSERT INTO materials
               (title, category, method, description, kind, series_id,
                file_name, stored_name, cover_name, file_size, mime, uploaded_by, sort_order, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,
                       (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM materials), ?)""",
            (
                title, category, method, description.strip(),
                _guess_kind(mime, ext), sid,
                original, stored_name, cover_name, len(content), mime,
                admin["username"], now_iso(),
            ),
        )
        material_id = cur.lastrowid
    return {
        "ok": True,
        "id": material_id,
        "sliced": bool(sliced),
        "pages": int(sliced["count"]) if sliced else 0,
        "message": f"「{title}」已上传"
        + ("（含自定义封面）" if cover_name else "")
        + (f"，已按页切片 {sliced['count']} 页" if sliced else "")
        + ("，正在后台转成可在线翻阅的 PDF" if converting else ""),
    }


class MaterialUpdateBody(BaseModel):
    title: str = Field(min_length=1, max_length=60)
    category: str = Field(pattern="^(standard|textbook|material|video)$")
    method: str = Field(default="", max_length=8)
    description: str = Field(default="", max_length=200)
    series_id: int = Field(default=0, ge=0)


@admin_router.put("/{material_id}", summary="修改资料信息（标题/分类/方向/描述/所属系列）")
def update_material(material_id: int, body: MaterialUpdateBody, admin: dict = Depends(get_current_admin)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if body.method not in MATERIAL_METHODS:
        raise HTTPException(status_code=400, detail="方向不合法")
    with get_conn() as conn:
        m = _get_material(conn, material_id)
        sid: int | None = None
        if body.series_id:
            row = conn.execute("SELECT id FROM material_series WHERE id = ?", (body.series_id,)).fetchone()
            sid = int(row["id"]) if row else None
        conn.execute(
            "UPDATE materials SET title = ?, category = ?, method = ?, description = ?, series_id = ? WHERE id = ?",
            (title, body.category, body.method, body.description.strip(), sid, material_id),
        )
    return {"ok": True, "message": f"「{m['title']}」已更新"}


@admin_router.delete("/{material_id}", summary="删除资料（连文件/封面/观看/收藏/评论一起删，不可恢复）")
def delete_material(material_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        m = _get_material(conn, material_id)
        conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))
        # 互动数据同库删除，避免留下孤儿统计
        conn.execute("DELETE FROM material_views WHERE material_id = ?", (material_id,))
        conn.execute("DELETE FROM material_favorites WHERE material_id = ?", (material_id,))
        conn.execute("DELETE FROM material_comments WHERE material_id = ?", (material_id,))
    _unlink_quiet(m["stored_name"])
    _unlink_quiet(m.get("cover_name") or "")
    pdf_slice.remove_slices(UPLOAD_DIR, m["stored_name"])  # 切片目录跟着原件一起删
    office_view.remove(UPLOAD_DIR, m["stored_name"])       # Office 转换产物 + 它的切片
    return {"ok": True, "message": f"「{m['title']}」已删除"}


@admin_router.post("/slice-existing", summary="给已有的 PDF 资料补做按页切片（只补没切过的）")
def admin_slice_existing(admin: dict = Depends(get_current_admin)):
    """一次性补齐：把库里所有还没切片的 PDF 批量切一遍。

    为什么需要：切片功能上线前上传的 PDF 只有原件，考生端还得整份下载。
    本接口可反复调用（已切片的会跳过），后台「资料管理」页给个按钮即可。
    单个文件失败不影响其它文件（build_slices 内部吞异常返回 None）。
    注意：本路由必须声明在 /{material_id} 之前，否则 'slice-existing' 会被当成 id 解析报 422。
    """
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, file_name, stored_name, mime FROM materials ORDER BY id"
        ).fetchall()

    done: list[dict] = []
    failed: list[dict] = []
    skipped = 0
    for r in rows:
        m = row_to_dict(r)
        if _guess_kind(m["mime"] or "", _ext_of(m["file_name"])) != "pdf":
            skipped += 1
            continue
        if pdf_slice.is_sliced(UPLOAD_DIR, m["stored_name"]):
            skipped += 1
            continue
        if not _file_path(m["stored_name"]).is_file():
            failed.append({"id": m["id"], "title": m["title"], "reason": "原件缺失"})
            continue
        meta = pdf_slice.build_slices(UPLOAD_DIR, m["stored_name"])
        if meta:
            done.append({"id": m["id"], "title": m["title"], "pages": int(meta["count"])})
        else:
            failed.append({"id": m["id"], "title": m["title"], "reason": "体积过小或格式不支持"})

    total_pages = sum(d["pages"] for d in done)
    msg = f"已切 {len(done)} 份（共 {total_pages} 页），跳过 {skipped} 份，失败 {len(failed)} 份"
    return {"ok": True, "done": done, "failed": failed, "skipped": skipped, "message": msg}


@admin_router.post("/convert-existing", summary="给已有的 Office 文档（doc/ppt/pptx）补做在线预览转换")
def admin_convert_existing(admin: dict = Depends(get_current_admin)):
    """一次性补齐：把库里所有还没转过的 Office 文档排进后台转换队列。

    为什么需要：转换功能上线前上传的 doc/ppt/pptx 只有原件，考生端点开只会看到
    「该格式暂不支持应用内预览」。本接口可反复调用（已转好的会跳过，失败的会重试）。
    转换在后台串行执行，本接口立刻返回；管理员可稍后刷新看结果。
    注意：本路由必须声明在 /{material_id} 之前，否则 'convert-existing' 会被当成 id 解析报 422。
    """
    with get_conn() as conn:
        rows = conn.execute("SELECT id, title, file_name, stored_name FROM materials ORDER BY id").fetchall()

    queued: list[dict] = []
    skipped = 0
    for r in rows:
        m = row_to_dict(r)
        ext = _ext_of(m["file_name"])
        if not office_view.needs_convert(ext):
            skipped += 1
            continue
        if office_view.is_ready(UPLOAD_DIR, m["stored_name"]):
            skipped += 1
            continue
        if not _file_path(m["stored_name"]).is_file():
            continue
        # force=True：把之前失败的状态清掉重试（已就绪的在上面已跳过，不会被重转）
        state, _ = office_view.request(UPLOAD_DIR, m["stored_name"], force=True)
        queued.append({"id": m["id"], "title": m["title"], "state": state})

    msg = (
        f"已排入 {len(queued)} 份待转换，跳过 {skipped} 份"
        if queued
        else f"没有需要转换的文档（已跳过 {skipped} 份）"
    )
    return {"ok": True, "queued": queued, "skipped": skipped, "pending": office_view.pending_count(), "message": msg}


@admin_router.get("/office-status", summary="Office 在线预览转换进度（队列里还剩几份）")
def admin_office_status(admin: dict = Depends(get_current_admin)):
    """给后台一个「还有几份在转」的数字，管理员点完补转按钮后可以来回刷新看进度。"""
    return {"ok": True, "pending": office_view.pending_count()}


def ensure_office_converted() -> int:
    """服务启动时调一次：把库里还没转过的 Office 文档排进后台转换队列。

    只排队、不在启动线程里转换（转换在 office_view 的 worker 线程里慢慢跑），
    所以不会拖慢启动。返回本次入队份数。任何异常都吞掉 —— 转换是加分项，
    绝不能因为它让整个服务起不来。"""
    try:
        with get_conn() as conn:
            rows = conn.execute("SELECT file_name, stored_name FROM materials").fetchall()
        names = [
            d["stored_name"]
            for d in (row_to_dict(r) for r in rows)
            if d["stored_name"] and office_view.needs_convert(_ext_of(d["file_name"]))
        ]
        if not names:
            return 0
        return office_view.warm_up(UPLOAD_DIR, names)
    except Exception:
        return 0


@admin_router.get("/{material_id}/file", summary="下载 / 预览文件（管理员）")
def admin_get_file(material_id: int, download: int = Query(default=0), admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    path = _file_path(m["stored_name"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失，请重新上传")
    headers = {"Content-Disposition": "attachment"} if download else None
    return FileResponse(str(path), media_type=m["mime"] or "application/octet-stream", headers=headers)


def _cover_response(m: dict) -> FileResponse:
    """封面图文件响应（实现在 upload_utils，与题库封面同一套逻辑）。"""
    return _shared_cover_response(m.get("cover_name") or "")


@admin_router.get("/{material_id}/cover", summary="取封面图（管理员预览）")
def admin_get_cover(material_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    return _cover_response(m)


@admin_router.post("/{material_id}/cover", summary="替换封面（老封面一并删除）")
async def admin_set_cover(
    material_id: int,
    cover: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await _save_cover(cover)
    with get_conn() as conn:
        m = _get_material(conn, material_id)
        old = (m.get("cover_name") or "").strip()
        conn.execute("UPDATE materials SET cover_name = ? WHERE id = ?", (new_name, material_id))
    _unlink_quiet(old)
    return {"ok": True, "message": f"「{m['title']}」封面已更新"}


@admin_router.delete("/{material_id}/cover", summary="清除封面（考生端回落为视频首帧）")
def admin_clear_cover(material_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        m = _get_material(conn, material_id)
        old = (m.get("cover_name") or "").strip()
        conn.execute("UPDATE materials SET cover_name = '' WHERE id = ?", (material_id,))
    _unlink_quiet(old)
    return {"ok": True, "message": f"「{m['title']}」已恢复默认封面（自动取视频首帧）"}


# ── 管理端：评论管理 ───────────────────────────────────────

@admin_comment_router.get("", summary="某资料的评论列表")
def admin_list_comments(
    material_id: int = Query(..., ge=1),
    admin: dict = Depends(get_current_admin),
):
    with get_conn() as conn:
        m = _get_material(conn, material_id)
        rows = conn.execute(
            _COMMENT_SQL + " WHERE c.material_id = ? ORDER BY c.id DESC", (material_id,)
        ).fetchall()
    return {
        "material": {"id": m["id"], "title": m["title"]},
        "items": [_comment_public(row_to_dict(r)) for r in rows],
    }


@admin_comment_router.delete("/{comment_id}", summary="删除评论（违规内容，顶层评论连回复一起删）")
def admin_delete_comment(comment_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM material_comments WHERE id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="评论不存在或已删除")
        c = row_to_dict(row)
        conn.execute("DELETE FROM material_comments WHERE id = ?", (comment_id,))
        if not int(c.get("parent_id") or 0):
            conn.execute("DELETE FROM material_comments WHERE parent_id = ?", (comment_id,))
    return {"ok": True, "message": "评论已删除"}


class AdminCommentBody(BaseModel):
    content: str = Field(min_length=1, max_length=COMMENT_MAX_LEN)
    material_id: int = Field(ge=1)
    parent_id: int = Field(default=0, ge=0, description="回复目标评论 id；0 = 发表顶层评论")


@admin_comment_router.post("", summary="管理员回复 / 发表评论（以「管理员」身份，user_id=0）")
def admin_add_comment(body: AdminCommentBody, admin: dict = Depends(get_current_admin)):
    """后台「视频详情」弹窗里管理员直接回复考生。逻辑与 library_add_comment 对齐：
    回复一律挂根评论；被回复的考生会收到「管理员回复了你的评论」站内通知。
    管理员身份用 user_id=0 落库（考生端展示昵称「管理员」，考生无法删除）。"""
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    with get_conn() as conn:
        m = _get_material(conn, body.material_id)

        parent_id = 0
        reply_to = ""
        notify_user_id = 0
        if body.parent_id:
            trow = conn.execute(
                _COMMENT_SQL + " WHERE c.id = ?", (body.parent_id,)
            ).fetchone()
            if not trow:
                raise HTTPException(status_code=404, detail="要回复的评论不存在或已删除")
            target = row_to_dict(trow)
            if target["material_id"] != body.material_id:
                raise HTTPException(status_code=400, detail="要回复的评论不属于该资料")
            root_id = int(target["parent_id"] or 0)
            parent_id = root_id if root_id else int(target["id"])
            reply_to = "管理员" if not int(target.get("user_id") or 0) else (target.get("nickname") or "学员")
            notify_user_id = int(target["user_id"] or 0)

        cur = conn.execute(
            "INSERT INTO material_comments (material_id, user_id, content, parent_id, reply_to, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (body.material_id, 0, content, parent_id, reply_to, now_iso()),
        )
        comment_id = cur.lastrowid

        # 站内通知：管理员回复考生时给对方发一条（走 notifications.py 唯一写入口）
        if notify_user_id:
            note_title = "管理员回复了你的评论"
            note_content = f"管理员 回复了你在「{m['title']}」的评论：{content}"[:1000]
            acct_row = conn.execute(
                "SELECT account FROM user_accounts WHERE id = ?", (notify_user_id,)
            ).fetchone()
            if acct_row:
                batch_id = create_batch(
                    conn,
                    scope="one",
                    type_="notice",
                    title=note_title[:40],
                    content=note_content,
                    sender="管理员",
                    target_desc=f"账号 {acct_row['account']}",
                    accounts=[acct_row["account"]],
                )
                push_notification(
                    conn,
                    user_id=notify_user_id,
                    type_="notice",
                    title=note_title[:40],
                    content=note_content,
                    sender="管理员",
                    batch_id=batch_id,
                )

        row = conn.execute(_COMMENT_SQL + " WHERE c.id = ?", (comment_id,)).fetchone()
    item = _comment_public(row_to_dict(row))
    item["replies"] = []
    item["reply_count"] = 0
    return {"ok": True, "item": item, "message": "回复已发布" if parent_id else "评论已发布"}


# ── 考生端：列表 / 详情 / 文件 / 封面 / 播放 / 收藏 / 评论 ───

@router.get("", summary="资料列表（教材/视频页数据源）")
def library_list(
    category: str = Query(default="", pattern="^(|standard|textbook|material|video)$"),
    series_id: int = Query(default=0, ge=0, description=">0 = 只看该系列内的资料"),
    user: dict = Depends(get_current_user),
):
    """全部上架资料，按上传时间倒序；每条都带 series_id / series_name
    （series_id = 0 表示散资料，考生端归到「未归系列」分组）。
    series_id 传了就只返回该系列内的资料。"""
    sql = f"SELECT m.*,{_stats_select(user['id'])} FROM materials m WHERE 1=1"
    params: list = []
    if category:
        sql += " AND m.category = ?"
        params.append(category)
    if series_id:
        sql += " AND m.series_id = ?"
        params.append(series_id)
    # 管理端排定的顺序优先（sort_order 越大越靠前）；前端「顺序 / 倒序」只需把结果反过来
    sql += " ORDER BY m.sort_order DESC, m.id DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return {"items": [_row_public(r, with_fav=True) for r in rows]}


@router.get("/series", summary="系列列表（考生端大类页数据源，带资料数）")
def library_series(
    category: str = Query(default="", pattern="^(|standard|textbook|material|video)$"),
    user: dict = Depends(get_current_user),
):
    """大类下的所有系列 + 每个系列的资料数。只返回「确实有资料」的系列除外——
    空系列也返回（管理员刚建好还没传文件时，考生端能看到「即将更新」占位）。
    注意：本路由必须声明在 /{material_id} 之前，否则 'series' 会被当成 id 解析。"""
    sql = (
        "SELECT s.*, (SELECT COUNT(*) FROM materials m WHERE m.series_id = s.id) AS item_count"
        " FROM material_series s WHERE 1=1"
    )
    params: list = []
    if category:
        sql += " AND s.category = ?"
        params.append(category)
    sql += " ORDER BY s.sort_order DESC, s.id DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    items = []
    for r in rows:
        d = row_to_dict(r)
        pub = _series_public(d, d.get("item_count", 0))
        items.append(pub)
    return {"items": items}


@router.get("/series/{series_id}/cover", summary="取系列封面图（考生端系列卡片）")
def library_series_cover(series_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        s = _get_series(conn, series_id)
    return _cover_response(s)


@router.get("/favorites", summary="我的收藏（视频）")
def library_favorites(user: dict = Depends(get_current_user)):
    """注意：本路由必须声明在 /{material_id} 之前，否则 'favorites' 会被当成 id 解析。"""
    sql = (
        f"SELECT m.*,{_stats_select(user['id'])}, f.created_at AS favorited_at"
        " FROM material_favorites f JOIN materials m ON m.id = f.material_id"
        " WHERE f.user_id = ? ORDER BY f.created_at DESC, f.rowid DESC"
    )
    with get_conn() as conn:
        rows = conn.execute(sql, (user["id"],)).fetchall()
    items = []
    for r in rows:
        d = row_to_dict(r)
        pub = _public(d, view_count=d.get("view_count", 0), fav_count=d.get("fav_count", 0), favorited=True)
        pub["favorited_at"] = d.get("favorited_at") or ""
        items.append(pub)
    return {"items": items}


@router.get("/history", summary="观看历史（我最近看过的视频，同一视频只保留最近一次）")
def library_history(
    limit: int = Query(default=100, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    """按最近观看时间倒序，同一视频只出现一次（带最近观看时间与我看过几次）。
    从历史里移除过的记录（material_views.hidden=1）不展示，但播放量照旧统计。
    注意：本路由必须声明在 /{material_id} 之前，否则 'history' 会被当成 id 解析。"""
    sql = f"""
      SELECT m.*,{_stats_select(user['id'])},
             (SELECT MAX(v.created_at) FROM material_views v
               WHERE v.material_id = m.id AND v.user_id = ? AND v.hidden = 0) AS watched_at,
             (SELECT COUNT(*) FROM material_views v
               WHERE v.material_id = m.id AND v.user_id = ?) AS my_view_count
        FROM materials m
       WHERE EXISTS (SELECT 1 FROM material_views v
                      WHERE v.material_id = m.id AND v.user_id = ? AND v.hidden = 0)
       ORDER BY watched_at DESC
       LIMIT ?
    """
    with get_conn() as conn:
        rows = conn.execute(sql, (user["id"], user["id"], user["id"], limit)).fetchall()
    items = []
    for r in rows:
        d = row_to_dict(r)
        pub = _row_public(r, with_fav=True)
        pub["watched_at"] = d.get("watched_at") or ""
        pub["my_view_count"] = int(d.get("my_view_count") or 0)
        items.append(pub)
    return {"items": items}


@router.delete("/history", summary="清空观看历史（隐藏标记，播放量不受影响）")
def library_clear_history(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE material_views SET hidden = 1 WHERE user_id = ? AND hidden = 0",
            (user["id"],),
        )
        n = cur.rowcount
    return {"ok": True, "removed": int(n), "message": "观看历史已清空"}


@router.delete("/history/{material_id}", summary="从观看历史移除某个视频（隐藏标记）")
def library_remove_history(material_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE material_views SET hidden = 1 WHERE user_id = ? AND material_id = ? AND hidden = 0",
            (user["id"], material_id),
        )
        n = cur.rowcount
    if not n:
        raise HTTPException(status_code=404, detail="该视频不在你的观看历史里")
    return {"ok": True, "removed": int(n), "message": "已从观看历史移除"}


@router.get("/{material_id}/pages", summary="PDF 切片信息（考生端单页翻阅模式的数据源）")
def library_pages(material_id: int, user: dict = Depends(get_current_user)):
    """返回这份文档是否已切片、共几页、每页多少字节。

    前端拿到 sliced=true 就切到「单页翻阅」模式（一次只请求一页，首屏 ~300KB）；
    sliced=false 则回落原来的整份 pdf.js 预览。**Office 资料（doc/ppt/pptx）看的是
    服务端转换出来的 PDF**（见 _preview_pdf_name），所以对前端来说口径完全一致。
    注意：本路由必须声明在 /{material_id}/file 之前无所谓，但必须晚于 /series 等
    具体路径；这里放在 /{material_id} 详情之后是安全的（路径段数不同不会误判）。"""
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    name = _preview_pdf_name(m)
    if not name:
        return {"sliced": False, "count": 0, "sizes": []}
    meta = pdf_slice.read_manifest(UPLOAD_DIR, name) if pdf_slice.is_sliced(UPLOAD_DIR, name) else None
    if not meta:
        return {"sliced": False, "count": 0, "sizes": []}
    return {
        "sliced": True,
        "count": int(meta["count"]),
        "sizes": [int(x) for x in (meta.get("sizes") or [])],
    }


@router.get("/{material_id}/preview", summary="文档预览准备状态（Office 转 PDF 进度；调用即触发转换）")
def library_preview(material_id: int, user: dict = Depends(get_current_user)):
    """考生端点开文档前先问一句「这份能怎么预览」。

    kind：
      - pdf      → 走 pdf.js（切片单页翻阅 / 整份兜底）
      - office   → 服务端转 PDF 中或已转好，看 state 轮询
      - frontend → docx / xlsx / xls / csv / txt，前端自己渲染
      - other    → 前端渲染不了也转换不了，只能「本地打开」

    state（office 才有意义）：
      - ready      → 已转好，接着请求 /pages 拿页数即可
      - queued     → 已排进后台队列
      - converting → 正在转换（40MB 的 ppt 约 1 分钟，前端显示进度提示）
      - failed     → 转换失败（message 里是原因），前端给「本地打开」兜底

    首次调用会把没转过的文件排进后台队列（幂等，重复调用不会重复转）。"""
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    ext = _ext_of(m["file_name"])

    if ext == "pdf":
        return {"kind": "pdf", "state": "ready", "pages": _sliced_pages(m["stored_name"]), "message": ""}

    if office_view.needs_convert(ext):
        state, msg = office_view.request(UPLOAD_DIR, m["stored_name"])
        pages = _sliced_pages(office_view.view_pdf_name(m["stored_name"])) if state == "ready" else 0
        return {"kind": "office", "state": state, "pages": pages, "message": msg}

    if ext in FRONTEND_RENDER_EXTS:
        return {"kind": "frontend", "state": "ready", "pages": 0, "message": ""}

    return {"kind": "other", "state": "unsupported", "pages": 0, "message": "该格式暂不支持应用内预览"}


@router.get("/{material_id}/preview-file", summary="取预览用 PDF 整份（切片不可用时的兜底）")
def library_preview_file(material_id: int, user: dict = Depends(get_current_user)):
    """切片没做成时（缺 pikepdf / 页数超限 / 文件损坏），pdf.js 直接整份打开这个 PDF。

    PDF 资料 = 原件；Office 资料 = 转换产物。视频等类型返回 404。"""
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    name = _preview_pdf_name(m)
    if not name:
        raise HTTPException(status_code=404, detail="这份资料没有可在线翻阅的 PDF 版本")
    path = _file_path(name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="预览文件已丢失，请联系管理员")
    return FileResponse(str(path), media_type="application/pdf")


@router.get("/{material_id}/page/{page}", summary="取 PDF 第 N 页切片（单页翻阅模式）")
def library_get_page(material_id: int, page: int, user: dict = Depends(get_current_user)):
    """取第 page 页（1 起）的独立单页 PDF。

    一页一个文件，pdf.js 打开它只需要**一个请求**（404 也不会有 Range 反复探测），
    实测首屏 41KB、中位页 346KB。页数越界 / 未切片 / 文件缺失统一 404，
    前端捕获后回落到整份预览。"""
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    name = _preview_pdf_name(m)
    if not name:
        raise HTTPException(status_code=404, detail="该文档没有可翻阅的 PDF 页")
    meta = pdf_slice.read_manifest(UPLOAD_DIR, name)
    if not meta:
        raise HTTPException(status_code=404, detail="该 PDF 未切片，请用整份预览")
    total = int(meta["count"])
    if page < 1 or page > total:
        raise HTTPException(status_code=404, detail=f"页码超出范围（共 {total} 页）")
    path = pdf_slice.slice_page_path(UPLOAD_DIR, name, page)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="该页切片文件已丢失，请管理员重新上传")
    # 切片是不可变内容（同一资料同一页永远同一份字节）→ 长缓存，翻回上一页不再走网络
    return FileResponse(
        str(path),
        media_type="application/pdf",
        headers={"Cache-Control": "private, max-age=86400"},
    )


@router.get("/{material_id}", summary="资料详情（视频详情页数据源）")
def library_detail(material_id: int, user: dict = Depends(get_current_user)):
    sql = f"SELECT m.*,{_stats_select(user['id'])} FROM materials m WHERE m.id = ?"
    with get_conn() as conn:
        row = conn.execute(sql, (material_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="资料不存在或已删除")
        comment_count = conn.execute(
            "SELECT COUNT(*) AS n FROM material_comments WHERE material_id = ?", (material_id,)
        ).fetchone()["n"]
    data = _row_public(row, with_fav=True)
    data["comment_count"] = int(comment_count)
    return data


@router.get("/{material_id}/file", summary="取文件内容（文档在线打开 / 视频播放，支持拖动）")
def library_get_file(material_id: int, user: dict = Depends(get_current_user)):
    """FileResponse 自带 HTTP Range 支持：<video> 拖动进度条不会整段重下。
    令牌可放在 ?token=（<video>/<iframe> 标签没法带 Authorization 头）。"""
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    path = _file_path(m["stored_name"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失，请联系管理员")
    return FileResponse(str(path), media_type=m["mime"] or "application/octet-stream")


@router.get("/{material_id}/cover", summary="取封面图（管理员指定的自定义封面）")
def library_get_cover(material_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        m = _get_material(conn, material_id)
    return _cover_response(m)


@router.post("/{material_id}/view", summary="记一次播放（每次打开 +1）")
def library_record_view(material_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        _get_material(conn, material_id)
        conn.execute(
            "INSERT INTO material_views (material_id, user_id, created_at) VALUES (?,?,?)",
            (material_id, user["id"], now_iso()),
        )
        view_count = conn.execute(
            "SELECT COUNT(*) AS n FROM material_views WHERE material_id = ?", (material_id,)
        ).fetchone()["n"]
        fav_count = conn.execute(
            "SELECT COUNT(*) AS n FROM material_favorites WHERE material_id = ?", (material_id,)
        ).fetchone()["n"]
    return {"ok": True, "view_count": int(view_count), "fav_count": int(fav_count)}


@router.post("/{material_id}/favorite", summary="收藏")
def library_add_favorite(material_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        _get_material(conn, material_id)
        exists = conn.execute(
            "SELECT 1 FROM material_favorites WHERE material_id = ? AND user_id = ?",
            (material_id, user["id"]),
        ).fetchone()
        if not exists:
            conn.execute(
                "INSERT INTO material_favorites (material_id, user_id, created_at) VALUES (?,?,?)",
                (material_id, user["id"], now_iso()),
            )
        fav_count = conn.execute(
            "SELECT COUNT(*) AS n FROM material_favorites WHERE material_id = ?", (material_id,)
        ).fetchone()["n"]
    return {"ok": True, "favorited": True, "fav_count": int(fav_count), "message": "已收藏"}


@router.delete("/{material_id}/favorite", summary="取消收藏")
def library_remove_favorite(material_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        _get_material(conn, material_id)
        conn.execute(
            "DELETE FROM material_favorites WHERE material_id = ? AND user_id = ?",
            (material_id, user["id"]),
        )
        fav_count = conn.execute(
            "SELECT COUNT(*) AS n FROM material_favorites WHERE material_id = ?", (material_id,)
        ).fetchone()["n"]
    return {"ok": True, "favorited": False, "fav_count": int(fav_count), "message": "已取消收藏"}


@router.get("/{material_id}/comments", summary="评论列表（楼中楼）")
def library_comments(
    material_id: int,
    limit: int = Query(default=200, ge=1, le=500),
    user: dict = Depends(get_current_user),
):
    """两层楼中楼：顶层评论（parent_id=0）按时间倒序，每条带 replies（正序）与 reply_count。
    回复的回复也挂在同一根评论下，靠 reply_to 区分回复对象。"""
    with get_conn() as conn:
        _get_material(conn, material_id)
        rows = conn.execute(
            _COMMENT_SQL + " WHERE c.material_id = ? ORDER BY c.id ASC LIMIT ?",
            (material_id, limit * 5),  # 上限放宽：顶层 + 其回复一起取
        ).fetchall()
    items: list[dict] = []
    by_id: dict[int, dict] = {}
    total = 0
    for r in rows:
        d = _comment_public(row_to_dict(r))
        d["is_mine"] = d["user_id"] == user["id"]
        total += 1
        if d["parent_id"]:
            root = by_id.get(d["parent_id"])
            if root is not None:
                root["replies"].append(d)
                root["reply_count"] += 1
            continue  # 根评论被管理员删掉后回复成为孤儿：不单独展示
        d["replies"] = []
        d["reply_count"] = 0
        by_id[d["id"]] = d
        items.append(d)
    items.reverse()  # 顶层评论：新的在前
    return {"items": items, "total": total}


class CommentBody(BaseModel):
    content: str = Field(min_length=1, max_length=COMMENT_MAX_LEN)
    parent_id: int = Field(default=0, ge=0, description="回复目标评论 id；0 = 发表顶层评论")


@router.post("/{material_id}/comments", summary="发表评论 / 回复（回复会通知被回复人）")
def library_add_comment(material_id: int, body: CommentBody, user: dict = Depends(get_current_user)):
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    with get_conn() as conn:
        m = _get_material(conn, material_id)

        # ── 回复：找到目标评论，一律挂到根评论（两层楼中楼）─────────
        parent_id = 0
        reply_to = ""
        notify_user_id = 0
        if body.parent_id:
            trow = conn.execute(
                _COMMENT_SQL + " WHERE c.id = ?", (body.parent_id,)
            ).fetchone()
            if not trow:
                raise HTTPException(status_code=404, detail="要回复的评论不存在或已删除")
            target = row_to_dict(trow)
            if target["material_id"] != material_id:
                raise HTTPException(status_code=400, detail="要回复的评论不属于该资料")
            root_id = int(target["parent_id"] or 0)
            parent_id = root_id if root_id else int(target["id"])
            reply_to = target.get("nickname") or "学员"
            notify_user_id = int(target["user_id"])

        cur = conn.execute(
            "INSERT INTO material_comments (material_id, user_id, content, parent_id, reply_to, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (material_id, user["id"], content, parent_id, reply_to, now_iso()),
        )
        comment_id = cur.lastrowid

        # ── 站内通知：回复别人时给对方发一条（自己回自己不发）────────
        # 走 notifications.py 的唯一写入口（直接 INSERT 后台看不到批次记录）
        if notify_user_id and notify_user_id != user["id"]:
            sender = user.get("nickname") or user.get("account") or "学员"
            note_title = "收到新回复"
            note_content = f"{sender} 回复了你在「{m['title']}」的评论：{content}"[:1000]
            acct_row = conn.execute(
                "SELECT account FROM user_accounts WHERE id = ?", (notify_user_id,)
            ).fetchone()
            if acct_row:
                batch_id = create_batch(
                    conn,
                    scope="one",
                    type_="notice",
                    title=note_title[:40],
                    content=note_content,
                    sender=sender,
                    target_desc=f"账号 {acct_row['account']}",
                    accounts=[acct_row["account"]],
                )
                push_notification(
                    conn,
                    user_id=notify_user_id,
                    type_="notice",
                    title=note_title[:40],
                    content=note_content,
                    sender=sender,
                    batch_id=batch_id,
                )

        row = conn.execute(_COMMENT_SQL + " WHERE c.id = ?", (comment_id,)).fetchone()
    item = _comment_public(row_to_dict(row))
    item["is_mine"] = True
    item["replies"] = []
    item["reply_count"] = 0
    return {"ok": True, "item": item, "message": "回复已发布" if parent_id else "评论已发布"}


@router.delete("/comments/{comment_id}", summary="删除自己的评论（顶层连楼中楼回复一起删）")
def library_delete_comment(comment_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM material_comments WHERE id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="评论不存在或已删除")
        c = row_to_dict(row)
        if c["user_id"] != user["id"]:
            raise HTTPException(status_code=403, detail="只能删除自己的评论")
        conn.execute("DELETE FROM material_comments WHERE id = ?", (comment_id,))
        # 顶层评论被删，挂在它下面的回复一起删（数据库保持同步，不留孤儿）
        if not int(c.get("parent_id") or 0):
            conn.execute("DELETE FROM material_comments WHERE parent_id = ?", (comment_id,))
    return {"ok": True, "message": "评论已删除"}
