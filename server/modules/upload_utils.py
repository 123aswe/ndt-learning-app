"""
通用上传工具 —— 封面图、题目插图与「上移 / 下移」手动排序。

被多处共用（资料库 materials.py、题库 question_series.py / question_sets.py / question_images.py）：
  - UPLOAD_DIR / COVER_EXTENSIONS / MAX_COVER_MB：封面图的存放目录与格式限制
  - ext_of() / save_cover() / cover_response() / unlink_quiet()：封面图的 取扩展名 / 存 / 取 / 删
  - QUESTION_IMAGE_* / is_question_image_name() / save_question_image()：题干选项里的插图
  - apply_manual_order()：后台「上移 / 下移」的新顺序落库

为什么单独抽出来：资料库与题库都要「上传封面 + 手动排序」，两处各写一份迟早改漏一边
（封面目录、大小上限、排序槽位算法必须完全一致）。题目插图同理，考生端与后台都要取图。

修改注意：
  - 所有上传文件都存 server/data/uploads/，靠前缀区分用途：
      cover_* = 封面图（题库 / 系列 / 资料）    qimg_* = 题目插图
  - 换封面 / 清封面都要把老文件删掉（unlink_quiet 静默失败，文件可能已手工清掉）
  - apply_manual_order 的槽位语义见函数注释，别改成「按 ids 顺序重排全表」
"""

import mimetypes
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse

BASE_DIR = Path(__file__).resolve().parent.parent

# 上传文件 / 封面图存放目录：server/data/uploads/
UPLOAD_DIR = BASE_DIR / "data" / "uploads"

# 允许的封面图扩展名
COVER_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_COVER_MB = 8  # 封面图上限

# ── 题目插图（题干 / 选项 / 答案解析里内嵌的图） ──────────────
# 比封面宽松：公式、符号表常是截图，可能带透明通道或 bmp
QUESTION_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp", "gif", "bmp"}
MAX_QUESTION_IMAGE_MB = 5
QUESTION_IMAGE_PREFIX = "qimg"


def ext_of(file_name: str) -> str:
    """从原始文件名取小写扩展名（'' 表示没有扩展名）。"""
    return file_name.rsplit(".", 1)[-1].lower() if "." in (file_name or "") else ""


def file_path(stored_name: str) -> Path:
    return UPLOAD_DIR / stored_name


def unlink_quiet(stored_name: str) -> None:
    """删磁盘文件，失败不抛（文件本来就可能已被手工清掉）。"""
    if not stored_name:
        return
    try:
        file_path(stored_name).unlink(missing_ok=True)
    except OSError:
        pass


async def save_cover(cover: UploadFile, prefix: str = "cover") -> str:
    """校验并存封面图，返回磁盘随机文件名（{prefix}_{随机}.{ext}）。"""
    original = cover.filename or "cover"
    ext = ext_of(original)
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
    stored_name = f"{prefix}_{secrets.token_hex(8)}.{ext}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    return stored_name


def stored_file_response(stored_name: str, missing_detail: str = "文件已丢失") -> FileResponse:
    """把 uploads 目录里的文件当附件返回（封面图、题目插图共用）。"""
    stored_name = (stored_name or "").strip()
    if not stored_name:
        raise HTTPException(status_code=404, detail=missing_detail)
    path = file_path(stored_name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=missing_detail)
    media = mimetypes.guess_type(stored_name)[0] or "application/octet-stream"
    return FileResponse(str(path), media_type=media)


def cover_response(cover_name: str) -> FileResponse:
    """封面图文件响应；没封面 / 文件丢了都 404（前端回落图标水印）。"""
    cover_name = (cover_name or "").strip()
    if not cover_name:
        raise HTTPException(status_code=404, detail="没有自定义封面")
    return stored_file_response(cover_name, "封面文件已丢失，请重新上传")


# ── 题目插图 ────────────────────────────────────────────────

def is_question_image_name(name: str) -> bool:
    """是不是本服务自己生成的题目插图文件名（防目录穿越：只认 qimg_<十六进制>.<允许的扩展名>）。"""
    name = (name or "").strip()
    if not name.startswith(f"{QUESTION_IMAGE_PREFIX}_"):
        return False
    if "/" in name or "\\" in name or ".." in name:
        return False
    head, _, ext = name.partition(".")
    suffix = head[len(QUESTION_IMAGE_PREFIX) + 1:]
    return bool(suffix) and all(ch in "0123456789abcdef" for ch in suffix) \
        and ext.lower() in QUESTION_IMAGE_EXTENSIONS


async def save_question_image(image: UploadFile) -> str:
    """校验并存题目插图，返回磁盘随机文件名（qimg_<16位十六进制>.<ext>）。"""
    original = image.filename or "image"
    ext = ext_of(original)
    if ext not in QUESTION_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"图片只支持 {'、'.join(sorted(QUESTION_IMAGE_EXTENSIONS))} 格式",
        )
    content = await image.read()
    if not content:
        raise HTTPException(status_code=400, detail="图片文件为空")
    if len(content) / 1024 / 1024 > MAX_QUESTION_IMAGE_MB:
        raise HTTPException(status_code=400, detail=f"图片超过 {MAX_QUESTION_IMAGE_MB}MB 上限，请先压缩再上传")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{QUESTION_IMAGE_PREFIX}_{secrets.token_hex(8)}.{ext}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    return stored_name


def question_image_response(stored_name: str) -> FileResponse:
    """题目插图文件响应；文件名不合法 / 文件丢了都 404（前端回落「图片已丢失」占位）。"""
    if not is_question_image_name(stored_name):
        raise HTTPException(status_code=404, detail="图片不存在")
    return stored_file_response(stored_name, "图片文件已丢失，请重新上传")


def apply_manual_order(conn, table: str, ids: list[int]) -> int:
    """把「后台当前列表」看到的新顺序落到 sort_order 上，返回真正调整的条数。

    做法：这批 id 在**全表顺序**里原本占的那几个槽位不动，只把内容按新顺序填回去 ——
    于是「按分类 / 系列 / 关键词筛选出来的列表」里做上移下移，不会打乱其它（没显示出来的）
    记录的相对位置。只认库里真实存在的 id（不存在 / 重复的忽略）。
    副作用：会把全表 sort_order 压实成 1..N 的稠密值（等于把当前顺序固化成手动顺序）。
    """
    if not ids:
        return 0
    rows = conn.execute(f"SELECT id FROM {table} ORDER BY sort_order DESC, id DESC").fetchall()
    global_ids = [int(r["id"]) for r in rows]
    if not global_ids:
        return 0

    valid = set(global_ids)
    seen: set[int] = set()
    order: list[int] = []
    for raw in ids:
        i = int(raw)
        if i in valid and i not in seen:
            seen.add(i)
            order.append(i)
    if len(order) < 2:
        return len(order)

    slots = [k for k, gid in enumerate(global_ids) if gid in seen]
    new_ids = list(global_ids)
    for slot, nid in zip(slots, order):
        new_ids[slot] = nid

    total = len(new_ids)
    conn.executemany(
        f"UPDATE {table} SET sort_order = ? WHERE id = ?",
        [(total - k, gid) for k, gid in enumerate(new_ids)],
    )
    return len(order)


def next_sort_order(conn, table: str, where: str = "", params: list | None = None) -> int:
    """新内容「排最前」：取当前最大 sort_order + 1（空表从 1 开始）。"""
    sql = f"SELECT COALESCE(MAX(sort_order), 0) AS m FROM {table}"
    if where:
        sql += f" WHERE {where}"
    row = conn.execute(sql, params or []).fetchone()
    return int(row["m"] or 0) + 1
