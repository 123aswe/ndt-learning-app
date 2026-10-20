"""
PDF 按页切片模块 —— 把一份多页 PDF 拆成「每页一个小 PDF」，考生端一页一页取。

为什么需要它
------------
在线预览大 PDF（教材/标准扫描件动辄几十上百 MB）的老路是「整份交给 pdf.js，
靠 HTTP Range 按需取」。这条路对**线性化（Linearized）PDF** 有效，但国内绝大
多数扫描件是**非线性化**的：交叉引用表（xref）与 trailer 在文件末尾，页对象
与图片又交错存放。pdf.js 为了解析文档结构必须读到文件末尾，于是 Range 请求
会把几乎所有字节都拉一遍 —— 实测 49.5MB / 148 页的文件，打开第一页就要下载
49.46MB（100% 覆盖），首屏体验与「整份下载」无异。

切片方案的收益（实测数据，同文件 148 页）
----------------------------------------
  整份 + Range 按需     打开首屏下载 49.46MB
  切片 + 单页翻阅       首屏下载 42KB（第 1 页），翻到第 50 页累计约 3.5MB
  切片耗时              1.1 秒 / 148 页（pikepdf，qpdf 引擎）
  切片总体积            49.6MB（与原件几乎一致，图片无法跨页复用所致）

目录结构
--------
每个 PDF 资料在 uploads/ 下有一个同名目录存切片：

    uploads/
      <stored_name>               ← 原始文件（保留，删除/兜底/管理员下载都用它）
      <stored_name>.pages/        ← 切片目录（名字由 slice_dir_name() 决定）
        slices/
          1.pdf  2.pdf  ...       ← 每页一个独立 PDF，可直接交给 pdf.js 打开
        pages.json                ← {"count":148,"sizes":[...],"generated_at":"..."}

设计取舍
--------
1. **保留原文件**：切片只是「加分项」，原件永远在。切片失败 → 前端回落整份
   预览（老逻辑），管理员下载 / 「本地打开」也始终是原件。
2. **不建表**：页数、每页大小写在 pages.json 里，跟切片目录同生命周期。
   真的需要分页元数据时再读 json（极小，几 KB）。
3. **切片是尽力而为**：任何一步失败都不抛给调用方，只返回 False 让调用方继续
   （上传成功 > 切片成功，不能因为切片把上传搞挂）。
4. **加密 PDF 不切片**：pikepdf 能开带空用户口令的文件，但真加密的直接跳过。
"""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

# 切片目录后缀（拼在 stored_name 后面）
_SLICE_SUFFIX = ".pages"
# 单页切片文件名
_SLICE_SUBDIR = "slices"
# 元数据文件名
_MANIFEST = "pages.json"

# 超过这个页数就不切片（防止极端文件耗光磁盘/时间；这类文件再回落整份预览）
MAX_SLICE_PAGES = 3000
# 小于这个体积的 PDF 不值得切片（几十 KB 的文本型 PDF 整份下载比 148 个请求更快）
MIN_SLICE_BYTES = 2 * 1024 * 1024


def slice_dir_name(stored_name: str) -> str:
    """切片目录名（相对 uploads/）。故意不叫 <stored_name> 本身，避免和同名文件撞。"""
    return stored_name + _SLICE_SUFFIX


def slice_dir(root: Path, stored_name: str) -> Path:
    """切片根目录的绝对路径。"""
    return root / slice_dir_name(stored_name)


def slice_page_path(root: Path, stored_name: str, page: int) -> Path:
    """第 page 页（1 起）切片文件的绝对路径。"""
    return slice_dir(root, stored_name) / _SLICE_SUBDIR / f"{page}.pdf"


def manifest_path(root: Path, stored_name: str) -> Path:
    return slice_dir(root, stored_name) / _MANIFEST


# ── 读取 ────────────────────────────────────────────────────

def read_manifest(root: Path, stored_name: str) -> dict | None:
    """读切片元数据；目录不存在 / json 损坏统一返回 None（调用方按「没切片」处理）。"""
    p = manifest_path(root, stored_name)
    try:
        if not p.is_file():
            return None
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    try:
        count = int(data.get("count") or 0)
    except (TypeError, ValueError):
        return None
    if count <= 0:
        return None
    data["count"] = count
    return data


def is_sliced(root: Path, stored_name: str) -> bool:
    """是否已切片且第 1 页切片确实存在（避免 json 在、文件被手工删了的半残状态）。"""
    meta = read_manifest(root, stored_name)
    if not meta:
        return False
    return slice_page_path(root, stored_name, 1).is_file()


def page_size(root: Path, stored_name: str, page: int) -> int | None:
    """第 page 页切片的字节数（拿不到返回 None，调用方自己 stat 兜底）。"""
    try:
        return slice_page_path(root, stored_name, page).stat().st_size
    except OSError:
        return None


# ── 生成 ────────────────────────────────────────────────────

def _cleanup_quiet(p: Path) -> None:
    """尽力删目录，任何失败都吞掉。

    ⚠️ 本机环境（WorkBuddy 沙箱）把 shutil.rmtree 拦截成「移入回收站」，
    回收站失败时会在 rmtree 内部直接抛 OSError（ignore_errors=True 也拦不住）。
    所以这里必须自己包一层 try/except —— 删不掉就留着，绝不影响主流程：
    残留的 .tmp/.old 目录会在下次 build_slices 时被覆盖复用或换名重试。"""
    try:
        shutil.rmtree(p)
    except Exception:
        pass


def build_slices(root: Path, stored_name: str, force: bool = False) -> dict | None:
    """把 uploads/<stored_name> 按页拆到 uploads/<stored_name>.pages/。

    返回 manifest dict（成功）或 None（跳过/失败）。**绝不抛异常**——
    切片是加分项，失败必须让上传流程照常走完。

    force=True：跳过 MIN_SLICE_BYTES 体积门槛。用于 Office 转换产物
    （modules/office_view.py）—— 它们普遍只有几 MB，但页数可能上百页，
    切片后首屏只要几十 KB，收益比「整份下载」大得多，所以必须切。

    幂等：已存在完整切片会直接复用；半残（只有 json 没有文件）会重建。

    ⚠️ 为什么「直接写进最终目录」而不是「写 tmp 再 rename」：
      本机环境（WorkBuddy 沙箱）会把删除拦截成回收站操作（失败即抛），
      且实测 workspace 内新建目录会被锁住、rename 直接报 WinError 5。
      所以流程设计成**只写入 + 覆盖，零删除零改名**：
        1. 切片逐个写进 <name>.pages/slices/（同页号直接覆盖）
        2. pages.json **最后**写 —— 写完才算成品；中途失败留下的半成品目录
           没有 manifest，is_sliced 判 False，前端自动回落整份预览（安全）。
        3. 残留的多余切片文件无害：接口按 manifest 的 count 校验页码，
           超出范围直接 404，不会把旧文件当成新一页发出去。"""
    src = root / stored_name
    if not src.is_file():
        return None

    if is_sliced(root, stored_name):
        return read_manifest(root, stored_name)

    try:
        size = src.stat().st_size
    except OSError:
        return None
    if not force and size < MIN_SLICE_BYTES:
        return None  # 小文件不值得拆

    try:
        import pikepdf
    except ImportError:
        return None  # 没装 pikepdf 就静默跳过，前端回落整份预览

    final_dir = slice_dir(root, stored_name)
    try:
        (final_dir / _SLICE_SUBDIR).mkdir(parents=True, exist_ok=True)

        sizes: list[int] = []
        with pikepdf.open(src) as pdf:
            total = len(pdf.pages)
            if total <= 0 or total > MAX_SLICE_PAGES:
                return None

            for i in range(total):
                page_no = i + 1
                out = final_dir / _SLICE_SUBDIR / f"{page_no}.pdf"
                one = pikepdf.new()
                # 单页 PDF：只搬这一页，资源（字体/图片 XObject）由 pikepdf 自动带上
                one.pages.append(pdf.pages[i])
                one.save(
                    out,
                    object_stream_mode=pikepdf.ObjectStreamMode.generate,
                    # 切片不线性化：单页文件本来就小，pdf.js 一次请求就拿完了
                    compress_streams=True,
                )
                one.close()
                sizes.append(out.stat().st_size)

        manifest = {
            "count": total,
            "sizes": sizes,
            "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        }
        # manifest 最后写：它就是「成品开关」
        (final_dir / _MANIFEST).write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        return manifest

    except Exception:
        # 任何异常（损坏 PDF / 加密 / 磁盘满）都只留半成品目录（无 manifest = 不可见），不影响上传
        return None


def remove_slices(root: Path, stored_name: str) -> None:
    """删除资料时一起清掉切片目录（任何失败都吞掉，见 _cleanup_quiet 的环境说明）。"""
    if not stored_name:
        return
    _cleanup_quiet(slice_dir(root, stored_name))
    _cleanup_quiet(root / (slice_dir_name(stored_name) + ".tmp"))
