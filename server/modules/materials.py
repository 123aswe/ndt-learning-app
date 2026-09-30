"""
资料库模块 —— 管理员上传标准 / 教材 / 资料文档与教学视频，考生端在线获取。

接口：
  管理端（需管理员登录，admin_router）：
    GET    /api/admin/materials                资料列表（可按分类 / 方向 / 关键词筛选，带播放量与收藏数）
    POST   /api/admin/materials                上传资料（multipart：file + cover? + title/category/method/description）
    PUT    /api/admin/materials/{id}           修改资料信息（标题/分类/方向/描述，不换文件）
    DELETE /api/admin/materials/{id}           删除资料（连服务器上的文件 + 封面 + 观看/收藏/评论一起删）
    GET    /api/admin/materials/{id}/file      下载 / 预览文件（管理员）
    GET    /api/admin/materials/{id}/cover     取封面图（管理员预览）
    POST   /api/admin/materials/{id}/cover     替换封面（multipart：cover；老封面文件一起删）
    DELETE /api/admin/materials/{id}/cover     清除封面（考生端回落为「视频首帧」）
  管理端评论（admin_comment_router）：
    GET    /api/admin/material-comments?material_id=   某资料的评论列表
    POST   /api/admin/material-comments                管理员回复 / 发表评论（以「管理员」身份）
    DELETE /api/admin/material-comments/{id}           删除评论（违规内容）
  考生端（需考生登录，router）：
    GET    /api/library                        资料列表（教材/视频页数据源，带播放量/收藏数/是否已收藏/有无封面）
    GET    /api/library/favorites              我的收藏（视频）
    GET    /api/library/history                观看历史（我看过的视频，按最近观看倒序，同一视频只保留最近一次）
    DELETE /api/library/history                清空观看历史（隐藏标记，不删行 → 播放量不变）
    DELETE /api/library/history/{id}           从观看历史移除某条（隐藏标记）
    GET    /api/library/{id}                   资料详情（视频详情页数据源）
    GET    /api/library/{id}/file              取文件内容（文档在线打开 / 视频播放，
                                                支持 ?token= 查询参数鉴权与 HTTP Range 断点拖动）
    GET    /api/library/{id}/cover             取封面图（管理员指定；无封面返回 404，前端回落到首帧）
    POST   /api/library/{id}/view              记一次播放（B 站式口径：每次打开 +1）
    POST   /api/library/{id}/favorite          收藏
    DELETE /api/library/{id}/favorite          取消收藏
    GET    /api/library/{id}/comments          评论列表（楼中楼：顶层评论带 replies + reply_count）
    POST   /api/library/{id}/comments          发表评论 / 回复（1~200 字，即时可见；带 parent_id = 回复，
                                               被回复人会收到一条「收到新回复」站内通知）
    DELETE /api/library/comments/{id}          删除自己的评论（删顶层连楼中楼回复一起删）

数据模型：
  - materials 表存元数据（标题/分类/方向/文件名/大小/mime/封面名），文件字节存 server/data/uploads/
    （视频动辄几百 MB，塞进 SQLite 会让整个库变慢，所以元数据入库、内容落盘）
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

修改注意：
  - 删除资料会连磁盘文件（含封面）一起删，不可恢复；重名文件在磁盘上按内容哈希前缀改名避免互踩
  - 新增分类要同时改 MATERIAL_CATEGORIES + dashboard.js + MaterialsScreen.tsx 三处
  - 考生端路由顺序：/favorites 必须声明在 /{material_id} 之前，否则会被当成 id 解析报 422
"""

import mimetypes
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from config import BASE_DIR
from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user
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
COVER_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_UPLOAD_MB = 1024  # 单文件上限（本机局域网使用，放宽到 1GB）
MAX_COVER_MB = 8      # 封面图上限

COMMENT_MAX_LEN = 200  # 单条评论字数上限

# 文件存放目录：server/data/uploads/
UPLOAD_DIR = BASE_DIR / "data" / "uploads"


# ── 内部工具 ────────────────────────────────────────────────

def _get_material(conn, material_id: int) -> dict:
    row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="资料不存在或已删除")
    return row_to_dict(row)


def _public(m: dict, view_count: int = 0, fav_count: int = 0, favorited: bool = False) -> dict:
    """对外（考生端/管理端列表共用）的资料字段。"""
    category = m["category"]
    return {
        "id": m["id"],
        "title": m["title"],
        "category": category,
        "category_name": MATERIAL_CATEGORIES.get(category, category),
        "method": m["method"] or "",
        "description": m["description"],
        "kind": m["kind"],
        "file_name": m["file_name"],
        "file_size": m["file_size"],
        "mime": m["mime"],
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
        " (SELECT COUNT(*) FROM material_favorites f WHERE f.material_id = m.id) AS fav_count"
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


def _guess_kind(mime: str, ext: str) -> str:
    if mime.startswith("video/") or mime.startswith("audio/") or ext in ("mp4", "webm", "mov", "m4v", "mp3", "m4a"):
        return "video"
    if ext == "pdf":
        return "pdf"
    return "doc"


def _unlink_quiet(stored_name: str) -> None:
    """删磁盘文件，失败不抛（文件本来就可能已被手工清掉）。"""
    if not stored_name:
        return
    try:
        _file_path(stored_name).unlink(missing_ok=True)
    except OSError:
        pass


async def _save_cover(cover: UploadFile) -> str:
    """校验并存封面图，返回磁盘随机文件名。"""
    original = cover.filename or "cover"
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    if ext not in COVER_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"封面只支持 {'、'.join(sorted(COVER_EXTENSIONS))} 格式",
        )
    content = await cover.read()
    if not content:
        raise HTTPException(status_code=400, detail="封面文件为空")
    if len(content) / 1024 / 1024 > MAX_COVER_MB:
        raise HTTPException(status_code=400, detail=f"封面超过 {MAX_COVER_MB}MB 上限")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"cover_{secrets.token_hex(8)}.{ext}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    return stored_name


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
    if q:
        sql += " AND (m.title LIKE ? OR m.description LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
    sql += " ORDER BY m.id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return {"items": [_row_public(r) for r in rows]}


@admin_router.post("", summary="上传资料（multipart 文件 + 元数据，封面选填）")
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(..., max_length=60),
    category: str = Form(..., pattern="^(standard|textbook|material|video)$"),
    method: str = Form(default="", max_length=8),
    description: str = Form(default="", max_length=200),
    cover: UploadFile | None = File(default=None),
    admin: dict = Depends(get_current_admin),
):
    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if method not in MATERIAL_METHODS:
        raise HTTPException(status_code=400, detail="方向不合法")

    original = file.filename or "file"
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
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

    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO materials
               (title, category, method, description, kind,
                file_name, stored_name, cover_name, file_size, mime, uploaded_by, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                title, category, method, description.strip(),
                _guess_kind(mime, ext),
                original, stored_name, cover_name, len(content), mime,
                admin["username"], now_iso(),
            ),
        )
        material_id = cur.lastrowid
    return {
        "ok": True,
        "id": material_id,
        "message": f"「{title}」已上传" + ("（含自定义封面）" if cover_name else ""),
    }


class MaterialUpdateBody(BaseModel):
    title: str = Field(min_length=1, max_length=60)
    category: str = Field(pattern="^(standard|textbook|material|video)$")
    method: str = Field(default="", max_length=8)
    description: str = Field(default="", max_length=200)


@admin_router.put("/{material_id}", summary="修改资料信息（标题/分类/方向/描述）")
def update_material(material_id: int, body: MaterialUpdateBody, admin: dict = Depends(get_current_admin)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if body.method not in MATERIAL_METHODS:
        raise HTTPException(status_code=400, detail="方向不合法")
    with get_conn() as conn:
        m = _get_material(conn, material_id)
        conn.execute(
            "UPDATE materials SET title = ?, category = ?, method = ?, description = ? WHERE id = ?",
            (title, body.category, body.method, body.description.strip(), material_id),
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
    return {"ok": True, "message": f"「{m['title']}」已删除"}


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
    cover_name = (m.get("cover_name") or "").strip()
    if not cover_name:
        raise HTTPException(status_code=404, detail="该资料没有自定义封面")
    path = _file_path(cover_name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="封面文件已丢失，请重新上传")
    media = mimetypes.guess_type(cover_name)[0] or "image/jpeg"
    return FileResponse(str(path), media_type=media)


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
    user: dict = Depends(get_current_user),
):
    """全部上架资料，按上传时间倒序；前端按 category 分组展示。附带播放量/收藏数/我是否收藏。"""
    sql = f"SELECT m.*,{_stats_select(user['id'])} FROM materials m"
    params: list = []
    if category:
        sql += " WHERE m.category = ?"
        params.append(category)
    sql += " ORDER BY m.id DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return {"items": [_row_public(r, with_fav=True) for r in rows]}


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
