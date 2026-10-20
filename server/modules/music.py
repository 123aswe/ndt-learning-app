"""
音乐模块 —— 管理员在后台「音乐」页上传曲目（音频 + 封面 + 歌手 + 歌词），
考生端 App「音乐」页在线播放（真实音频，不是模拟进度条）。

接口：
  管理端（需管理员登录，admin_router）：
    GET    /api/admin/music                  曲目列表（带播放量、歌词字数、排序值）
    POST   /api/admin/music                  上传曲目（multipart：file + cover? + title/artist/album/lyric/duration）
    PUT    /api/admin/music/{id}             修改曲目信息（歌名 / 歌手 / 专辑 / 歌词 / 时长，不换音频）
    DELETE /api/admin/music/{id}             删除曲目（连音频 + 封面文件一起删，不可恢复）
    POST   /api/admin/music/order            批量调整顺序（后台「上移 / 下移」，body.ids = 当前可见的完整顺序）
    GET    /api/admin/music/{id}/file        试听 / 下载音频（管理员）
    GET    /api/admin/music/{id}/cover       取封面图（管理员预览）
    POST   /api/admin/music/{id}/cover       替换封面（multipart：cover；老封面文件一起删）
    DELETE /api/admin/music/{id}/cover       清除封面（考生端回落内置山水插画）
    GET    /api/admin/music/albums           专辑列表（带歌曲数）
    POST   /api/admin/music/albums           新建专辑（multipart：name + description? + cover?）
    PUT    /api/admin/music/albums/{id}      修改专辑（名称 / 简介）
    DELETE /api/admin/music/albums/{id}      删除专辑（歌曲退回「未归专辑」，不删歌）
    GET    /api/admin/music/albums/{id}/cover  专辑封面（管理员预览）
    POST   /api/admin/music/albums/{id}/cover  替换专辑封面（老封面一并删）
    DELETE /api/admin/music/albums/{id}/cover  清除专辑封面（考生端回落首曲封面 / 插画）
  考生端（需考生登录，router）：
    GET    /api/music                        曲目列表（含歌词、播放量、收藏数、评论数）
    GET    /api/music/albums                 专辑列表（含每张专辑的歌曲，考生端「专辑」Tab 数据源）
    GET    /api/music/albums/{id}/cover      专辑封面图（没设置返回 404，前端回落首曲封面 / 插画）
    GET    /api/music/favorites              我的音乐收藏（按收藏时间倒序）
    GET    /api/music/history                我的播放历史（同一首只留最近一次，可移除/清空）
    DELETE /api/music/history                清空播放历史（隐藏标记，不删播放量）
    DELETE /api/music/history/{track_id}     从历史移除某一首（隐藏标记）
    POST   /api/music/{id}/favorite          收藏 / 取消收藏（返回 favorited 与最新收藏数）
    GET    /api/music/{id}/comments          歌曲评论列表（昵称快照，按时间正序）
    POST   /api/music/{id}/comments          发表评论（1~300 字）
    DELETE /api/music/comments/{cid}         删除自己的评论（别人的 403）
    GET    /api/music/{id}/file              音频流（<audio> 播放，支持 ?token= 与 HTTP Range 拖动）
    GET    /api/music/{id}/cover             封面图（没设置封面返回 404，前端回落内置插画）
    POST   /api/music/{id}/play              记一次播放（播放量 +1，并写入 music_plays 播放历史）

数据模型：
  - music_tracks 表存元数据（歌名/歌手/专辑/歌词/时长/文件名/封面名/播放量/排序），
    音频与封面字节落盘 server/data/uploads/（music_* 音频、cover_* 封面）。
  - music_albums 表存专辑（名称/简介/封面/排序）；歌曲通过 music_tracks.album_id 归入专辑。
    album_id 为空 = 未归专辑。上传 / 编辑歌曲时选中的专辑会同步写入 album 文本字段
    （考生端列表 / 搜索沿用 album 字段即可显示专辑名），专辑改名时代码把归属歌曲的
    album 文本一起更新，保证两者一致。
  - lyric 原样存：纯文本（一行一句）或带 [mm:ss.xx] 时间轴的 LRC 都行 ——
    考生端能解析时间轴就逐行高亮，解析不到就整段滚动展示。
  - duration 由后台在上传时用浏览器 <audio> 读出后提交（单位秒）；读不到传 0，
    考生端会以音频实际加载到的时长为准。
  - sort_order 语义与资料库一致：越大越靠前，新上传取「当前最大值 + 1」，
    后台「上移 / 下移」走 upload_utils.apply_manual_order。

修改注意：
  - 允许的音频格式见 AUDIO_EXTENSIONS（浏览器能直接播的几种）；新增要同步前端 accept 提示
  - 换 / 清封面、删除曲目都要把磁盘上的老文件删掉（unlink_quiet 静默失败）
  - 管理端路由顺序：/order 必须声明在 /{track_id} 之前，否则 'order' 会被当成 id 解析报 422
"""

import mimetypes
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin, get_current_user
from modules.upload_utils import (
    UPLOAD_DIR,
    apply_manual_order,
    cover_response,
    ext_of,
    next_sort_order,
    save_cover,
    unlink_quiet,
)

admin_router = APIRouter(prefix="/api/admin/music", tags=["音乐管理"])
router = APIRouter(prefix="/api/music", tags=["音乐"])

# 浏览器 <audio> 能直接播放的音频格式（mp3 / m4a(aac) / wav / flac / ogg 系）
AUDIO_EXTENSIONS = {"mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "weba"}
# 音乐文件上限：一首无损 flac 常见 30~50MB，留足余量
MAX_AUDIO_MB = 200
# 歌词上限（字符）：LRC 全文几千字足够，防止误贴超长文本撑爆列表接口
MAX_LYRIC_CHARS = 20000
# 音频在 uploads/ 下的文件名前缀（与封面 cover_、题目插图 qimg_ 区分）
AUDIO_PREFIX = "music"


# ── 内部工具 ────────────────────────────────────────────────

def _get_track(conn, track_id: int) -> dict:
    row = conn.execute("SELECT * FROM music_tracks WHERE id = ?", (track_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="歌曲不存在或已删除")
    return row_to_dict(row)


def _public(t: dict) -> dict:
    """对外（考生端 / 管理端共用）的曲目字段。fav_count / comment_count 由列表 SQL 带出。"""
    lyric = t.get("lyric") or ""
    return {
        "id": int(t["id"]),
        "title": t["title"],
        "artist": t.get("artist") or "",
        "album": t.get("album") or "",
        "album_id": int(t["album_id"]) if t.get("album_id") else 0,
        "lyric": lyric,
        "lyric_lines": len([x for x in lyric.splitlines() if x.strip()]),
        "duration": int(t.get("duration") or 0),
        "file_name": t.get("file_name") or "",
        "file_size": int(t.get("file_size") or 0),
        "mime": t.get("mime") or "",
        "has_cover": bool((t.get("cover_name") or "").strip()),
        "play_count": int(t.get("play_count") or 0),
        "fav_count": int(t.get("fav_count") or 0),
        "comment_count": int(t.get("comment_count") or 0),
        "sort_order": int(t.get("sort_order") or 0),
        "uploaded_by": t.get("uploaded_by") or "",
        "created_at": t.get("created_at") or "",
    }


def _count_select(track_expr: str = "music_tracks.id") -> str:
    """收藏数 / 评论数子查询（拼进 SELECT * 后面，别名与 _public 对齐）。

    track_expr 默认按主表写法；JOIN 场景传别名（如 't.id'）。
    """
    return (
        f", (SELECT COUNT(*) FROM music_favorites f WHERE f.track_id = {track_expr}) AS fav_count"
        f", (SELECT COUNT(*) FROM music_comments c WHERE c.track_id = {track_expr}) AS comment_count"
    )


def _count_select_track(alias: str) -> str:
    return _count_select(f"{alias}.id")


def _audio_path(stored_name: str):
    return UPLOAD_DIR / stored_name


async def _save_audio(audio: UploadFile) -> tuple[str, int, str]:
    """校验并存音频，返回（磁盘随机文件名, 字节数, MIME）。"""
    original = audio.filename or "audio"
    ext = ext_of(original)
    if ext not in AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的音乐格式「.{ext}」，允许：{'、'.join(sorted(AUDIO_EXTENSIONS))}",
        )
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="音乐文件为空")
    if len(content) / 1024 / 1024 > MAX_AUDIO_MB:
        raise HTTPException(status_code=400, detail=f"音乐文件超过 {MAX_AUDIO_MB}MB 上限")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{AUDIO_PREFIX}_{secrets.token_hex(10)}.{ext}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    mime = audio.content_type or mimetypes.guess_type(original)[0] or "audio/mpeg"
    if mime in ("application/octet-stream", ""):
        mime = mimetypes.guess_type(original)[0] or "audio/mpeg"
    return stored_name, len(content), mime


def _next_sort(conn) -> int:
    row = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS m FROM music_tracks").fetchone()
    return int(row["m"] or 0) + 1


def _norm_lyric(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    if len(text) > MAX_LYRIC_CHARS:
        raise HTTPException(status_code=400, detail=f"歌词太长（上限 {MAX_LYRIC_CHARS} 字）")
    return text.strip()


# ── 专辑工具（music_albums）────────────────────────────────

def _get_album(conn, album_id: int) -> dict:
    row = conn.execute("SELECT * FROM music_albums WHERE id = ?", (album_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="专辑不存在或已删除")
    return row_to_dict(row)


def _album_public(a: dict, track_count: int = 0) -> dict:
    """对外（考生端 / 管理端共用）的专辑字段。"""
    return {
        "id": int(a["id"]),
        "name": a["name"],
        "description": a.get("description") or "",
        "has_cover": bool((a.get("cover_name") or "").strip()),
        "track_count": int(track_count or 0),
        "sort_order": int(a.get("sort_order") or 0),
        "uploaded_by": a.get("uploaded_by") or "",
        "created_at": a.get("created_at") or "",
    }


def _norm_album_id(conn, album_id) -> int | None:
    """校验歌曲归属的专辑：0 / 空 / 负数 → None（未归专辑）；给了不存在的 id → 400。"""
    try:
        aid = int(album_id or 0)
    except (TypeError, ValueError):
        aid = 0
    if aid <= 0:
        return None
    if not conn.execute("SELECT 1 FROM music_albums WHERE id = ?", (aid,)).fetchone():
        raise HTTPException(status_code=400, detail="选择的专辑不存在，请刷新后重试")
    return aid


def _album_name(conn, album_id: int | None) -> str:
    """取专辑名（用于同步写入歌曲 album 文本字段）；专辑不存在返回 ''。"""
    if not album_id:
        return ""
    row = conn.execute("SELECT name FROM music_albums WHERE id = ?", (album_id,)).fetchone()
    return (row["name"] if row else "") or ""


# ── 管理端 ──────────────────────────────────────────────────

@admin_router.get("", summary="曲目列表（带播放量 / 收藏数 / 评论数 / 歌词行数 / 排序值）")
def admin_list_music(admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT *{_count_select()} FROM music_tracks ORDER BY sort_order DESC, id DESC"
        ).fetchall()
    return {"items": [_public(row_to_dict(r)) for r in rows]}


# ── 管理端：专辑（音乐 → 专辑管理）─────────────────────────

@admin_router.get("/albums", summary="专辑列表（带歌曲数）")
def admin_list_albums(admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT a.*,
                      (SELECT COUNT(*) FROM music_tracks t WHERE t.album_id = a.id) AS track_count
                 FROM music_albums a
                ORDER BY a.sort_order DESC, a.id DESC"""
        ).fetchall()
    return {"items": [_album_public(row_to_dict(r), r["track_count"]) for r in rows]}


@admin_router.post("/albums", summary="新建专辑（multipart：name + description? + cover?）")
async def admin_create_album(
    name: str = Form(..., max_length=80),
    description: str = Form(default="", max_length=200),
    cover: UploadFile | None = File(default=None),
    admin: dict = Depends(get_current_admin),
):
    album_name = (name or "").strip()
    if not album_name:
        raise HTTPException(status_code=400, detail="专辑名不能为空")
    # 封面先存盘：格式不对直接 400，不会留下孤儿记录
    cover_name = ""
    if cover is not None and (cover.filename or "").strip():
        cover_name = await save_cover(cover)
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO music_albums
               (name, description, cover_name, sort_order, uploaded_by, created_at)
               VALUES (?,?,?,?,?,?)""",
            (album_name, description.strip(), cover_name,
             next_sort_order(conn, "music_albums"), admin["username"], now_iso()),
        )
        album_id = cur.lastrowid
    return {
        "ok": True,
        "id": album_id,
        "message": f"专辑《{album_name}》已创建" + ("（含封面）" if cover_name else ""),
    }


class AlbumUpdateBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=200)


@admin_router.put("/albums/{album_id}", summary="修改专辑（名称 / 简介）")
def admin_update_album(album_id: int, body: AlbumUpdateBody, admin: dict = Depends(get_current_admin)):
    album_name = body.name.strip()
    if not album_name:
        raise HTTPException(status_code=400, detail="专辑名不能为空")
    with get_conn() as conn:
        a = _get_album(conn, album_id)
        conn.execute(
            "UPDATE music_albums SET name = ?, description = ? WHERE id = ?",
            (album_name, body.description.strip(), album_id),
        )
        # 专辑改名 → 归属歌曲的 album 文本一并更新（考生端列表 / 搜索按 album 展示，保持一致）
        conn.execute("UPDATE music_tracks SET album = ? WHERE album_id = ?", (album_name, album_id))
    return {"ok": True, "message": f"专辑《{a['name']}》已更新"}


@admin_router.delete("/albums/{album_id}", summary="删除专辑（歌曲退回「未归专辑」，不删歌）")
def admin_delete_album(album_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        a = _get_album(conn, album_id)
        # 删专辑不删歌：归属歌曲退回「未归专辑」（album 文本保留，作为历史名）
        conn.execute("UPDATE music_tracks SET album_id = NULL WHERE album_id = ?", (album_id,))
        conn.execute("DELETE FROM music_albums WHERE id = ?", (album_id,))
    unlink_quiet(a.get("cover_name") or "")
    return {"ok": True, "message": f"专辑《{a['name']}》已删除，歌曲已退回「未归专辑」"}


@admin_router.get("/albums/{album_id}/cover", summary="专辑封面（管理员预览）")
def admin_get_album_cover(album_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        a = _get_album(conn, album_id)
    return cover_response(a.get("cover_name") or "")


@admin_router.post("/albums/{album_id}/cover", summary="替换专辑封面（老封面一并删除）")
async def admin_set_album_cover(
    album_id: int,
    cover: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await save_cover(cover)
    with get_conn() as conn:
        a = _get_album(conn, album_id)
        old = (a.get("cover_name") or "").strip()
        conn.execute("UPDATE music_albums SET cover_name = ? WHERE id = ?", (new_name, album_id))
    unlink_quiet(old)
    return {"ok": True, "message": f"专辑《{a['name']}》封面已更新"}


@admin_router.delete("/albums/{album_id}/cover", summary="清除专辑封面（考生端回落首曲封面 / 插画）")
def admin_clear_album_cover(album_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        a = _get_album(conn, album_id)
        old = (a.get("cover_name") or "").strip()
        conn.execute("UPDATE music_albums SET cover_name = '' WHERE id = ?", (album_id,))
    unlink_quiet(old)
    return {"ok": True, "message": f"专辑《{a['name']}》已恢复默认封面"}


class OrderBody(BaseModel):
    """后台「上移 / 下移」提交的完整可见顺序。"""

    ids: list[int] = Field(default_factory=list, max_length=2000)


@admin_router.post("/order", summary="批量调整曲目顺序（后台「上移 / 下移」）")
def admin_order_music(body: OrderBody, admin: dict = Depends(get_current_admin)):
    """注意：本路由必须声明在 /{track_id} 之前，否则 'order' 会被当成 id 解析报 422。"""
    with get_conn() as conn:
        n = apply_manual_order(conn, "music_tracks", body.ids)
    return {"ok": True, "updated": n, "message": f"已调整 {n} 首歌曲的顺序"}


@admin_router.post("", summary="上传曲目（multipart：音频 + 封面? + 歌名/歌手/专辑/歌词/时长）")
async def admin_upload_music(
    file: UploadFile = File(...),
    title: str = Form(..., max_length=80),
    artist: str = Form(default="", max_length=60),
    album: str = Form(default="", max_length=60),
    album_id: int = Form(default=0),
    lyric: str = Form(default=""),
    duration: int = Form(default=0),
    cover: UploadFile | None = File(default=None),
    admin: dict = Depends(get_current_admin),
):
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="歌名不能为空")

    # 封面先存盘：格式不对就直接 400，不会留下孤儿音频文件
    cover_name = ""
    if cover is not None and (cover.filename or "").strip():
        cover_name = await save_cover(cover)

    stored_name, size, mime = await _save_audio(file)
    lyric_text = _norm_lyric(lyric)

    with get_conn() as conn:
        aid = _norm_album_id(conn, album_id)
        # 归入专辑时以专辑名为准，避免文本与专辑不一致；未归专辑则用自由文本
        album_text = _album_name(conn, aid) if aid else album.strip()
        cur = conn.execute(
            """INSERT INTO music_tracks
               (title, artist, album, album_id, lyric, duration, file_name, stored_name, mime,
                file_size, cover_name, uploaded_by, sort_order, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                title, artist.strip(), album_text, aid, lyric_text, max(0, int(duration or 0)),
                file.filename or "audio", stored_name, mime,
                size, cover_name, admin["username"], _next_sort(conn), now_iso(),
            ),
        )
        track_id = cur.lastrowid
    return {
        "ok": True,
        "id": track_id,
        "message": f"《{title}》已上传"
        + ("（含封面）" if cover_name else "")
        + ("（含歌词）" if lyric_text else ""),
    }


class MusicUpdateBody(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    artist: str = Field(default="", max_length=60)
    album: str = Field(default="", max_length=60)
    album_id: int = Field(default=0, ge=0)
    lyric: str = Field(default="")
    duration: int = Field(default=0, ge=0, le=36000)


@admin_router.put("/{track_id}", summary="修改曲目信息（歌名/歌手/专辑/歌词/时长）")
def admin_update_music(track_id: int, body: MusicUpdateBody, admin: dict = Depends(get_current_admin)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="歌名不能为空")
    lyric_text = _norm_lyric(body.lyric)
    with get_conn() as conn:
        t = _get_track(conn, track_id)
        aid = _norm_album_id(conn, body.album_id)
        # 归入专辑时以专辑名为准；未归专辑则用自由文本
        album_text = _album_name(conn, aid) if aid else body.album.strip()
        conn.execute(
            "UPDATE music_tracks SET title = ?, artist = ?, album = ?, album_id = ?, lyric = ?, duration = ? WHERE id = ?",
            (title, body.artist.strip(), album_text, aid, lyric_text, int(body.duration or 0), track_id),
        )
    return {"ok": True, "message": f"《{t['title']}》已更新"}


@admin_router.delete("/{track_id}", summary="删除曲目（连音频与封面文件一起删，不可恢复）")
def admin_delete_music(track_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_track(conn, track_id)
        conn.execute("DELETE FROM music_tracks WHERE id = ?", (track_id,))
        # 级联清理：收藏 / 评论 / 播放历史里的引用一起删（磁盘播放量计数随曲目消失）
        conn.execute("DELETE FROM music_favorites WHERE track_id = ?", (track_id,))
        conn.execute("DELETE FROM music_comments WHERE track_id = ?", (track_id,))
        conn.execute("DELETE FROM music_plays WHERE track_id = ?", (track_id,))
    unlink_quiet(t["stored_name"])
    unlink_quiet(t.get("cover_name") or "")
    return {"ok": True, "message": f"《{t['title']}》已删除"}


@admin_router.get("/{track_id}/file", summary="试听 / 下载音频（管理员）")
def admin_get_music_file(
    track_id: int,
    download: int = Query(default=0),
    admin: dict = Depends(get_current_admin),
):
    with get_conn() as conn:
        t = _get_track(conn, track_id)
    path = _audio_path(t["stored_name"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="音频文件已丢失，请重新上传")
    headers = {"Content-Disposition": "attachment"} if download else None
    return FileResponse(str(path), media_type=t["mime"] or "audio/mpeg", headers=headers)


@admin_router.get("/{track_id}/cover", summary="取封面图（管理员预览）")
def admin_get_music_cover(track_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_track(conn, track_id)
    return cover_response(t.get("cover_name") or "")


@admin_router.post("/{track_id}/cover", summary="替换封面（老封面一并删除）")
async def admin_set_music_cover(
    track_id: int,
    cover: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await save_cover(cover)
    with get_conn() as conn:
        t = _get_track(conn, track_id)
        old = (t.get("cover_name") or "").strip()
        conn.execute("UPDATE music_tracks SET cover_name = ? WHERE id = ?", (new_name, track_id))
    unlink_quiet(old)
    return {"ok": True, "message": f"《{t['title']}》封面已更新"}


@admin_router.delete("/{track_id}/cover", summary="清除封面（考生端回落内置插画）")
def admin_clear_music_cover(track_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_track(conn, track_id)
        old = (t.get("cover_name") or "").strip()
        conn.execute("UPDATE music_tracks SET cover_name = '' WHERE id = ?", (track_id,))
    unlink_quiet(old)
    return {"ok": True, "message": f"《{t['title']}》已恢复默认插画封面"}


# ── 考生端 ──────────────────────────────────────────────────

@router.get("", summary="曲目列表（音乐页首页 / 搜索 / 播放列表数据源，含歌词与各项计数）")
def music_list(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT *{_count_select()} FROM music_tracks ORDER BY sort_order DESC, id DESC"
        ).fetchall()
        items = []
        for r in rows:
            d = row_to_dict(r)
            pub = _public(d)
            # 附带我是否收藏过（播放页爱心初态用）
            pub["favorited"] = bool(conn.execute(
                "SELECT 1 FROM music_favorites WHERE track_id = ? AND user_id = ?",
                (pub["id"], user["id"]),
            ).fetchone())
            items.append(pub)
    return {"items": items}


@router.get("/albums", summary="专辑列表（含每张专辑的歌曲，音乐首页「专辑」Tab 数据源）")
def music_albums(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        # 先把专辑行 fetchall 到内存，再在循环里查歌曲：避免复用游标导致外层中断（见项目红线）
        rows = conn.execute(
            """SELECT a.*,
                      (SELECT COUNT(*) FROM music_tracks t WHERE t.album_id = a.id) AS track_count
                 FROM music_albums a
                ORDER BY a.sort_order DESC, a.id DESC"""
        ).fetchall()
        items = []
        for r in rows:
            a = _album_public(row_to_dict(r), r["track_count"])
            trows = conn.execute(
                f"SELECT *{_count_select()} FROM music_tracks WHERE album_id = ? ORDER BY sort_order DESC, id DESC",
                (a["id"],),
            ).fetchall()
            a["tracks"] = [_track_public_with_fav(conn, tr, user["id"]) for tr in trows]
            items.append(a)
    return {"items": items}


@router.get("/albums/{album_id}/cover", summary="专辑封面图（没设置返回 404，前端回落首曲封面 / 插画）")
def music_album_cover(album_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        a = _get_album(conn, album_id)
    return cover_response(a.get("cover_name") or "")


@router.get("/{track_id}/file", summary="音频流（<audio> 播放，支持 ?token= 与拖动进度）")
def music_file(track_id: int, user: dict = Depends(get_current_user)):
    """FileResponse 自带 HTTP Range 支持：拖动进度条不会整段重下。
    令牌走 ?token=（<audio> 标签带不了 Authorization 头，同资料库口径）。"""
    with get_conn() as conn:
        t = _get_track(conn, track_id)
    path = _audio_path(t["stored_name"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="音频文件已丢失，请联系管理员")
    return FileResponse(str(path), media_type=t["mime"] or "audio/mpeg")


@router.get("/{track_id}/cover", summary="封面图（没设置封面返回 404，前端回落内置插画）")
def music_cover(track_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        t = _get_track(conn, track_id)
    return cover_response(t.get("cover_name") or "")


@router.post("/{track_id}/play", summary="记一次播放（播放量 +1，并写入我的播放历史）")
def music_record_play(track_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        _get_track(conn, track_id)
        conn.execute("UPDATE music_tracks SET play_count = play_count + 1 WHERE id = ?", (track_id,))
        conn.execute(
            "INSERT INTO music_plays (track_id, user_id, played_at) VALUES (?,?,?)",
            (track_id, user["id"], now_iso()),
        )
        play_count = conn.execute(
            "SELECT play_count FROM music_tracks WHERE id = ?", (track_id,)
        ).fetchone()["play_count"]
    return {"ok": True, "play_count": int(play_count)}


# ── 考生端：收藏 / 评论 / 播放历史 ──────────────────────────
# ⚠️ 这些固定路径路由必须声明在文件更下面的 /{track_id} 动态路由之前没有影响
#    （路径段数不同），但 /favorites /history 必须在 router 挂载顺序上早于
#    GET /{track_id}/file 之类不冲突；FastAPI 按「固定段优先」匹配，安全起见
#    全部放在本文件这一节统一维护。

def _track_public_with_fav(conn, row, user_id: int, favorited: bool | None = None) -> dict:
    d = row_to_dict(row)
    pub = _public(d)
    if favorited is None:
        favorited = bool(conn.execute(
            "SELECT 1 FROM music_favorites WHERE track_id = ? AND user_id = ?",
            (pub["id"], user_id),
        ).fetchone())
    pub["favorited"] = bool(favorited)
    return pub


@router.get("/favorites", summary="我的音乐收藏（按收藏时间倒序）")
def music_favorites(user: dict = Depends(get_current_user)):
    """注意：本路由靠固定路径段与 /{track_id}/xxx 天然区分（段数不同），声明顺序无关。"""
    sql = f"""
      SELECT t.*{_count_select_track('t')}, f.created_at AS favorited_at
        FROM music_favorites f JOIN music_tracks t ON t.id = f.track_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC, f.rowid DESC
    """
    with get_conn() as conn:
        rows = conn.execute(sql, (user["id"],)).fetchall()
        items = []
        for r in rows:
            pub = _track_public_with_fav(conn, r, user["id"], favorited=True)
            pub["favorited_at"] = row_to_dict(r).get("favorited_at") or ""
            items.append(pub)
    return {"items": items}


@router.get("/history", summary="我的播放历史（同一首只留最近一次，带最近播放时间与次数）")
def music_history(
    limit: int = Query(default=100, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    sql = f"""
      SELECT t.*{_count_select_track('t')},
             (SELECT MAX(p.played_at) FROM music_plays p
               WHERE p.track_id = t.id AND p.user_id = ? AND p.hidden = 0) AS played_at,
             (SELECT COUNT(*) FROM music_plays p
               WHERE p.track_id = t.id AND p.user_id = ?) AS my_play_count
        FROM music_tracks t
       WHERE EXISTS (SELECT 1 FROM music_plays p
                      WHERE p.track_id = t.id AND p.user_id = ? AND p.hidden = 0)
       ORDER BY played_at DESC
       LIMIT ?
    """
    with get_conn() as conn:
        rows = conn.execute(sql, (user["id"], user["id"], user["id"], limit)).fetchall()
        items = []
        for r in rows:
            d = row_to_dict(r)
            pub = _track_public_with_fav(conn, r, user["id"])
            pub["played_at"] = d.get("played_at") or ""
            pub["my_play_count"] = int(d.get("my_play_count") or 0)
            items.append(pub)
    return {"items": items}


@router.delete("/history", summary="清空播放历史（隐藏标记，播放量不受影响）")
def music_clear_history(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE music_plays SET hidden = 1 WHERE user_id = ? AND hidden = 0",
            (user["id"],),
        )
        n = cur.rowcount
    return {"ok": True, "removed": int(n), "message": "播放历史已清空"}


@router.delete("/history/{track_id}", summary="从播放历史移除某一首（隐藏标记）")
def music_remove_history(track_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE music_plays SET hidden = 1 WHERE user_id = ? AND track_id = ? AND hidden = 0",
            (user["id"], track_id),
        )
        n = cur.rowcount
    if not n:
        raise HTTPException(status_code=404, detail="这首歌不在你的播放历史里")
    return {"ok": True, "removed": int(n), "message": "已从播放历史移除"}


@router.post("/{track_id}/favorite", summary="收藏 / 取消收藏（返回 favorited 与最新收藏数）")
def music_toggle_favorite(track_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        _get_track(conn, track_id)
        existing = conn.execute(
            "SELECT 1 FROM music_favorites WHERE track_id = ? AND user_id = ?",
            (track_id, user["id"]),
        ).fetchone()
        if existing:
            conn.execute(
                "DELETE FROM music_favorites WHERE track_id = ? AND user_id = ?",
                (track_id, user["id"]),
            )
            favorited = False
            message = "已取消收藏"
        else:
            conn.execute(
                "INSERT INTO music_favorites (track_id, user_id, created_at) VALUES (?,?,?)",
                (track_id, user["id"], now_iso()),
            )
            favorited = True
            message = "已收藏"
        fav_count = conn.execute(
            "SELECT COUNT(*) AS n FROM music_favorites WHERE track_id = ?", (track_id,)
        ).fetchone()["n"]
    return {"ok": True, "favorited": favorited, "fav_count": int(fav_count), "message": message}


@router.get("/{track_id}/comments", summary="歌曲评论列表（昵称快照，按时间正序）")
def music_comment_list(track_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        _get_track(conn, track_id)
        rows = conn.execute(
            """SELECT c.id, c.user_id, c.content, c.created_at,
                      COALESCE(a.nickname, '') AS nickname, COALESCE(a.avatar, '') AS avatar
                 FROM music_comments c
                 LEFT JOIN user_accounts a ON a.id = c.user_id
                WHERE c.track_id = ?
                ORDER BY c.id ASC
                LIMIT 500""",
            (track_id,),
        ).fetchall()
        me = user["id"]
    items = []
    for r in rows:
        d = row_to_dict(r)
        items.append({
            "id": int(d["id"]),
            "user_id": int(d["user_id"]),
            "nickname": d.get("nickname") or "同学",
            "avatar": d.get("avatar") or "",
            "content": d["content"],
            "created_at": d["created_at"],
            "mine": int(d["user_id"]) == int(me),
        })
    return {"items": items}


class MusicCommentBody(BaseModel):
    content: str = Field(min_length=1, max_length=300)


@router.post("/{track_id}/comments", summary="发表歌曲评论（1~300 字）")
def music_comment_add(track_id: int, body: MusicCommentBody, user: dict = Depends(get_current_user)):
    content = (body.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    with get_conn() as conn:
        _get_track(conn, track_id)
        cur = conn.execute(
            "INSERT INTO music_comments (track_id, user_id, content, created_at) VALUES (?,?,?,?)",
            (track_id, user["id"], content, now_iso()),
        )
        cid = cur.lastrowid
        total = conn.execute(
            "SELECT COUNT(*) AS n FROM music_comments WHERE track_id = ?", (track_id,)
        ).fetchone()["n"]
    return {"ok": True, "id": cid, "comment_count": int(total), "message": "评论已发布"}


@router.delete("/comments/{comment_id}", summary="删除自己的歌曲评论（别人的 403）")
def music_comment_delete(comment_id: int, user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM music_comments WHERE id = ?", (comment_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="评论不存在或已删除")
        if int(row["user_id"]) != int(user["id"]):
            raise HTTPException(status_code=403, detail="只能删除自己的评论")
        conn.execute("DELETE FROM music_comments WHERE id = ?", (comment_id,))
        total = conn.execute(
            "SELECT COUNT(*) AS n FROM music_comments WHERE track_id = ?",
            (row["track_id"],),
        ).fetchone()["n"]
    return {"ok": True, "comment_count": int(total), "message": "评论已删除"}
