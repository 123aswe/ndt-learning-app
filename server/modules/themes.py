"""
主题商店模块 —— 管理员上传「背景 + 配色」皮肤，考生在 App「我的 → 主题商店」自选应用。

一个主题 = 背景图 + 主色 + 辅色 + 字色（深色字 / 浅色字）+ 预览图。
考生端把选中的主题存本机（localStorage: ndt_skin），首屏渲染前就应用：
登录 / 注册页与登录后的界面都生效。**只改颜色与背景**（背景图 cover 铺满、不拉伸，
配色通过覆盖 CSS 变量实现），不动任何尺寸 → 界面不变形。

接口：
  管理端（需管理员登录，admin_router，前缀 /api/admin/themes）：
    GET    /api/admin/themes                     主题列表（带预览图 / 背景图有无标记）
    POST   /api/admin/themes                     新建主题（multipart：名称 / 主色 / 辅色 / 字色 / 预览图 / 背景图）
    PUT    /api/admin/themes/{id}                修改主题（JSON：名称 / 主色 / 辅色 / 字色）
    DELETE /api/admin/themes/{id}                删除主题（连同预览图 / 背景图文件）
    POST   /api/admin/themes/order               批量调整顺序（后台「上移 / 下移」）
    GET    /api/admin/themes/{id}/preview        取预览图（后台缩略图）
    POST   /api/admin/themes/{id}/preview        设置 / 替换预览图（老图一并删）
    DELETE /api/admin/themes/{id}/preview        清除预览图
    GET    /api/admin/themes/{id}/background     取背景图（后台预览）
    POST   /api/admin/themes/{id}/background     设置 / 替换背景图（老图一并删）
    DELETE /api/admin/themes/{id}/background     清除背景图
  考生端（公开、**故意不加登录依赖**，前缀 /api/themes —— 登录 / 注册页也要应用主题）：
    GET    /api/themes                           可用主题列表（id / 名称 / 配色 / 字色 / 有无图）
    GET    /api/themes/{id}/preview              预览图
    GET    /api/themes/{id}/background           背景图

设计取舍：
  - 考生端「选了哪个主题」存 localStorage，不入库：登录 / 注册页在未登录时就得应用主题，
    必须在拿到令牌之前读出来；换设备重新挑一次即可（和深色模式设置同一口径）。
  - 主题图片与其它上传共用 data/uploads/（前缀 theme_preview_ / theme_bg_）。
  - 主色 / 辅色只接受 #RRGGBB：这些值会被前端写进 CSS 变量，必须严格限制形状。

修改注意：
  - ⚠️ /order 路由必须声明在 /{theme_id} 之前，否则 'order' 会被当成 id 解析报 422
  - 删除主题要把预览图与背景图两个文件都 unlink_quiet 掉，别只删一个
"""

import re
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from database import get_conn, now_iso, row_to_dict
from deps import get_current_admin
from modules.upload_utils import (
    UPLOAD_DIR,
    apply_manual_order,
    ext_of,
    stored_file_response,
    unlink_quiet,
)

admin_router = APIRouter(prefix="/api/admin/themes", tags=["主题商店"])
router = APIRouter(prefix="/api/themes", tags=["主题商店"])

TABLE = "themes"

# 主色 / 辅色：严格的 #RRGGBB（前端会直接塞进 CSS 变量，不能放开）
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
# 字色：dark = 深色字（配浅色背景）；light = 浅色字（配深色背景）
TONES = ("dark", "light")

THEME_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_PREVIEW_MB = 8
MAX_BACKGROUND_MB = 15


# ── 内部工具 ────────────────────────────────────────────────

def _get_theme(conn, theme_id: int) -> dict:
    row = conn.execute(f"SELECT * FROM {TABLE} WHERE id = ?", (theme_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="主题不存在或已删除")
    return row_to_dict(row)


def _theme_public(t: dict) -> dict:
    """对外字段（管理端 / 考生端共用；图片按需另取）。"""
    return {
        "id": t["id"],
        "name": t["name"],
        "primary_color": t["primary_color"] or "",
        "secondary_color": t["secondary_color"] or "",
        "text_tone": t["text_tone"] or "dark",
        "has_preview": bool((t.get("preview_name") or "").strip()),
        "has_background": bool((t.get("background_name") or "").strip()),
        "sort_order": int(t.get("sort_order") or 0),
        "created_by": t.get("created_by") or "",
        "created_at": t["created_at"],
    }


def _clean_color(value: str, label: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    if not COLOR_RE.match(value):
        raise HTTPException(status_code=400, detail=f"{label}要填 #RRGGBB 形式的颜色值，例如 #5F8D8C")
    return value.upper()


def _clean_tone(value: str) -> str:
    value = (value or "").strip()
    if value not in TONES:
        raise HTTPException(status_code=400, detail="字色取值不合法（只能是深色字 / 浅色字）")
    return value


async def _save_theme_image(f: UploadFile, prefix: str, label: str, max_mb: int) -> str:
    """校验并存主题图片，返回磁盘随机文件名（{prefix}_{16位十六进制}.{ext}）。"""
    original = f.filename or label
    ext = ext_of(original)
    if ext not in THEME_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"{label}只支持 {'、'.join(sorted(THEME_IMAGE_EXTENSIONS))} 格式",
        )
    content = await f.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"{label}文件为空")
    if len(content) / 1024 / 1024 > max_mb:
        raise HTTPException(status_code=400, detail=f"{label}超过 {max_mb}MB 上限，请先压缩再上传")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{prefix}_{secrets.token_hex(8)}.{ext}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    return stored_name


def _image_response(stored_name: str, label: str):
    stored_name = (stored_name or "").strip()
    if not stored_name:
        raise HTTPException(status_code=404, detail=f"没有{label}")
    return stored_file_response(stored_name, f"{label}文件已丢失，请重新上传")


# ── 管理端：主题 CRUD ───────────────────────────────────────

class ThemeBody(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    primary_color: str = Field(default="", max_length=7)
    secondary_color: str = Field(default="", max_length=7)
    text_tone: str = Field(default="dark", max_length=8)


def _clean_body(body: ThemeBody) -> tuple[str, str, str, str]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="主题名称不能为空")
    return (
        name,
        _clean_color(body.primary_color, "主色"),
        _clean_color(body.secondary_color, "辅色"),
        _clean_tone(body.text_tone),
    )


@admin_router.get("", summary="主题列表")
def list_themes(admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        rows = conn.execute(f"SELECT * FROM {TABLE} ORDER BY sort_order DESC, id DESC").fetchall()
    return {"items": [_theme_public(row_to_dict(r)) for r in rows]}


@admin_router.post("", summary="新建主题（可同时上传预览图 / 背景图）")
async def create_theme(
    name: str = Form(...),
    primary_color: str = Form(""),
    secondary_color: str = Form(""),
    text_tone: str = Form("dark"),
    preview: UploadFile | None = File(default=None),
    background: UploadFile | None = File(default=None),
    admin: dict = Depends(get_current_admin),
):
    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="主题名称不能为空")
    if len(clean_name) > 40:
        raise HTTPException(status_code=400, detail="主题名称最多 40 个字")
    pc = _clean_color(primary_color, "主色")
    sc = _clean_color(secondary_color, "辅色")
    tone = _clean_tone(text_tone)

    preview_name = ""
    background_name = ""
    if preview is not None and (preview.filename or ""):
        preview_name = await _save_theme_image(preview, "theme_preview", "预览图", MAX_PREVIEW_MB)
    if background is not None and (background.filename or ""):
        background_name = await _save_theme_image(background, "theme_bg", "背景图", MAX_BACKGROUND_MB)

    with get_conn() as conn:
        dup = conn.execute(f"SELECT id FROM {TABLE} WHERE name = ?", (clean_name,)).fetchone()
        if dup:
            unlink_quiet(preview_name)
            unlink_quiet(background_name)
            raise HTTPException(status_code=409, detail="已存在同名主题")
        cur = conn.execute(
            f"""INSERT INTO {TABLE}
                (name, primary_color, secondary_color, text_tone, preview_name, background_name,
                 sort_order, created_by, created_at)
                VALUES (?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM {TABLE}),?,?)""",
            (clean_name, pc, sc, tone, preview_name, background_name, admin["username"] if admin else "", now_iso()),
        )
        theme_id = cur.lastrowid
    return {"ok": True, "id": theme_id, "message": f"主题「{clean_name}」已创建"}


@admin_router.put("/{theme_id}", summary="修改主题（名称 / 主色 / 辅色 / 字色）")
def update_theme(theme_id: int, body: ThemeBody, admin: dict = Depends(get_current_admin)):
    name, pc, sc, tone = _clean_body(body)
    with get_conn() as conn:
        _get_theme(conn, theme_id)
        dup = conn.execute(
            f"SELECT id FROM {TABLE} WHERE name = ? AND id != ?", (name, theme_id)
        ).fetchone()
        if dup:
            raise HTTPException(status_code=409, detail="已存在同名主题")
        conn.execute(
            f"UPDATE {TABLE} SET name = ?, primary_color = ?, secondary_color = ?, text_tone = ? WHERE id = ?",
            (name, pc, sc, tone, theme_id),
        )
    return {"ok": True, "message": "主题已更新"}


@admin_router.delete("/{theme_id}", summary="删除主题（连同预览图 / 背景图）")
def delete_theme(theme_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
        conn.execute(f"DELETE FROM {TABLE} WHERE id = ?", (theme_id,))
    unlink_quiet(t.get("preview_name") or "")
    unlink_quiet(t.get("background_name") or "")
    return {"ok": True, "message": f"主题「{t['name']}」已删除"}


# ── 管理端：预览图 / 背景图 ─────────────────────────────────

@admin_router.get("/{theme_id}/preview", summary="取预览图（后台缩略图）")
def admin_get_preview(theme_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
    return _image_response(t.get("preview_name") or "", "预览图")


@admin_router.post("/{theme_id}/preview", summary="设置 / 替换预览图（老图一并删除）")
async def admin_set_preview(
    theme_id: int,
    preview: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await _save_theme_image(preview, "theme_preview", "预览图", MAX_PREVIEW_MB)
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
        old = (t.get("preview_name") or "").strip()
        conn.execute(f"UPDATE {TABLE} SET preview_name = ? WHERE id = ?", (new_name, theme_id))
    unlink_quiet(old)
    return {"ok": True, "message": f"主题「{t['name']}」预览图已更新"}


@admin_router.delete("/{theme_id}/preview", summary="清除预览图")
def admin_clear_preview(theme_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
        old = (t.get("preview_name") or "").strip()
        conn.execute(f"UPDATE {TABLE} SET preview_name = '' WHERE id = ?", (theme_id,))
    unlink_quiet(old)
    return {"ok": True, "message": "预览图已清除（考生端改用配色渐变兜底）"}


@admin_router.get("/{theme_id}/background", summary="取背景图（后台预览）")
def admin_get_background(theme_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
    return _image_response(t.get("background_name") or "", "背景图")


@admin_router.post("/{theme_id}/background", summary="设置 / 替换背景图（老图一并删除）")
async def admin_set_background(
    theme_id: int,
    background: UploadFile = File(...),
    admin: dict = Depends(get_current_admin),
):
    new_name = await _save_theme_image(background, "theme_bg", "背景图", MAX_BACKGROUND_MB)
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
        old = (t.get("background_name") or "").strip()
        conn.execute(f"UPDATE {TABLE} SET background_name = ? WHERE id = ?", (new_name, theme_id))
    unlink_quiet(old)
    return {"ok": True, "message": f"主题「{t['name']}」背景图已更新"}


@admin_router.delete("/{theme_id}/background", summary="清除背景图")
def admin_clear_background(theme_id: int, admin: dict = Depends(get_current_admin)):
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
        old = (t.get("background_name") or "").strip()
        conn.execute(f"UPDATE {TABLE} SET background_name = '' WHERE id = ?", (theme_id,))
    unlink_quiet(old)
    return {"ok": True, "message": "背景图已清除（考生端改用配色渐变背景）"}


# ── 管理端：排序 ────────────────────────────────────────────

class OrderBody(BaseModel):
    """后台「上移 / 下移」提交的完整可见顺序。"""

    ids: list[int] = Field(default_factory=list, max_length=2000)


@admin_router.post("/order", summary="批量调整主题顺序（后台「上移 / 下移」）")
def order_themes(body: OrderBody, admin: dict = Depends(get_current_admin)):
    """注意：本路由必须声明在 /{theme_id} 之前，否则 'order' 会被当成 id 解析报 422。"""
    with get_conn() as conn:
        n = apply_manual_order(conn, TABLE, body.ids)
    return {"ok": True, "updated": n, "message": f"已调整 {n} 个主题的顺序"}


# ── 考生端（公开）：列表 + 图片 ─────────────────────────────
# ⚠️ 故意不加 get_current_user 依赖：登录 / 注册页在未登录时也要应用主题，
#    必须能匿名读到主题列表与背景图（主题本身不是敏感数据）。

@router.get("", summary="可用主题列表（考生端主题商店 / 登录页自动应用）")
def user_themes():
    with get_conn() as conn:
        rows = conn.execute(f"SELECT * FROM {TABLE} ORDER BY sort_order DESC, id DESC").fetchall()
    return {"items": [_theme_public(row_to_dict(r)) for r in rows]}


@router.get("/{theme_id}/preview", summary="取主题预览图（考生端）")
def user_preview(theme_id: int):
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
    return _image_response(t.get("preview_name") or "", "预览图")


@router.get("/{theme_id}/background", summary="取主题背景图（考生端）")
def user_background(theme_id: int):
    with get_conn() as conn:
        t = _get_theme(conn, theme_id)
    return _image_response(t.get("background_name") or "", "背景图")
