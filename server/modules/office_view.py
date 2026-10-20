# -*- coding: utf-8 -*-
"""Office 文档在线预览 —— 把「浏览器里没法直接渲染」的资料转成 PDF，复用 PDF 那套预览链路。

为什么需要它
------------
考生端点开资料走的是 components/DocViewer.tsx：pdf 有 pdf.js、docx 有 docx-preview、
xlsx 有 SheetJS，唯独 **旧版二进制格式（doc / ppt）和 pptx 没有轻量前端方案** ——
以前只能提示「该格式暂不支持应用内预览」，考生看到的就是「打不开」。

本模块用**本机已装的 MS Office**（COM 自动化，见 office_convert_worker.py）把这类文档
转成 PDF，再交给 pdf_slice 切片，于是考生端直接复用「单页翻阅」：首屏只取一页（几十 KB），
左右翻页，和看 PDF 教材完全一致。

落盘约定
--------
    uploads/<stored_name>              ← 原件（**永远保留**：管理员下载、兜底打开都用它）
    uploads/<stored_name>.view.pdf     ← 转换产物（考生端预览看的就是它）
    uploads/<stored_name>.view.pdf.pages/  ← 转换产物的切片目录（pdf_slice 生成）
    uploads/<stored_name>.view.tmp.pdf ← 转换中的中间文件（转完改名，半成品不会被当成成品）

设计取舍
--------
1. **后台串行队列**：Office 的 COM 服务器是「每用户单实例」，并发转换会互相抢实例甚至
   弹框卡死；单 worker 串行最稳。转换一次 40MB/253 页的 ppt 实测约 70 秒，绝不能塞进
   请求线程里 —— 考生点开只查状态，转换在后台慢慢跑。
2. **状态只放内存，成品只认磁盘**：进程重启后内存状态清空，但已转好的 .view.pdf 还在，
   is_ready() 直接判 ready，不会重转。
3. **失败即降级**：没装 Office / 装了但转换报错 / 缺 comtypes → state=failed，
   前端提示「本地打开」兜底，不影响其它资料、不影响上传。
4. **不建表**：产物路径由 stored_name 推导，删资料时 remove() 一起清掉，跟 pdf_slice 一个路子。
5. **上传即预转**：管理员上传时就把转换排上队，考生点开时通常已经是 ready，无需等待。
"""

import queue
import shutil
import subprocess
import sys
import threading
from pathlib import Path

from config import BASE_DIR
from modules import pdf_slice

# 转换产物后缀。考生端预览、切片、整份兜底都认这个名字
VIEW_SUFFIX = ".view.pdf"
# 转换中的中间文件名（**必须仍以 .pdf 结尾**：Office 另存时会按扩展名判断格式，
# 写成 xxx.part 会让 PowerPoint 报「不支持的文件格式」）
TMP_SUFFIX = ".view.tmp.pdf"

# 需要服务端转换的扩展名：前端没有渲染方案的旧格式 / 宏格式
# （docx / xlsx / xls / csv / txt 前端能自己渲染，不在这里，免得白跑一趟 Office）
NEEDS_CONVERT = {
    "doc", "docm", "dot", "dotx",
    "ppt", "pptx", "pps", "ppsx", "pptm", "pot", "potx",
    "xlsm",
}

# 单个文件转换超时（秒）：40MB / 253 页的 ppt 实测 ~70 秒，这里留足余量给超大课件
CONVERT_TIMEOUT = 900

# 内存状态：stored_name → 'queued' | 'converting' | 'ready' | 'failed'
_state: dict[str, str] = {}
_msg: dict[str, str] = {}
_queue: "queue.Queue[tuple[Path, str]]" = queue.Queue()
_lock = threading.Lock()
_worker: threading.Thread | None = None


# ── 路径 / 判定 ─────────────────────────────────────────────

def needs_convert(ext: str) -> bool:
    """这种扩展名是否需要走服务端转换。"""
    return (ext or "").lower() in NEEDS_CONVERT


def view_pdf_name(stored_name: str) -> str:
    """转换产物在 uploads/ 下的文件名。"""
    return f"{stored_name}{VIEW_SUFFIX}"


def view_pdf_path(root: Path, stored_name: str) -> Path:
    return root / view_pdf_name(stored_name)


def is_ready(root: Path, stored_name: str) -> bool:
    """转换产物是否已就绪（存在且非空）。"""
    try:
        p = view_pdf_path(root, stored_name)
        return p.is_file() and p.stat().st_size > 0
    except OSError:
        return False


def status(root: Path, stored_name: str) -> tuple[str, str]:
    """返回 (状态, 说明)。状态：ready / queued / converting / failed / idle。

    ready 以**磁盘**为准（重启后内存空了也能正确判 ready）；其余看内存，
    进程重启后未完成的转换回到 idle，下次请求会重新排队。"""
    if is_ready(root, stored_name):
        return "ready", ""
    with _lock:
        st = _state.get(stored_name, "")
        msg = _msg.get(stored_name, "")
    if st in ("queued", "converting", "failed"):
        return st, msg
    return "idle", ""


# ── 调度 ────────────────────────────────────────────────────

def request(root: Path, stored_name: str, force: bool = False) -> tuple[str, str]:
    """查状态；若还没转且没在转，就排进队列（幂等，可反复调用）。

    force=True：忽略失败记录重新排队（管理员点「补转」时用；已 ready 的不会重转）。"""
    if is_ready(root, stored_name):
        return "ready", ""
    if force:
        with _lock:
            _state.pop(stored_name, None)
            _msg.pop(stored_name, None)
    else:
        st = _state.get(stored_name, "")
        if st in ("queued", "converting"):
            return st, _msg.get(stored_name, "")

    with _lock:
        # 双检：避免并发请求把同一份文件排两次
        if _state.get(stored_name) in ("queued", "converting"):
            return _state[stored_name], _msg.get(stored_name, "")
        _state[stored_name] = "queued"
        _msg.pop(stored_name, None)
    _queue.put((Path(root), stored_name))
    _ensure_worker()
    return "queued", ""


def warm_up(root: Path, stored_names: list[str]) -> int:
    """启动时给历史资料补转（后台排队，不阻塞启动）。返回本次入队的份数。"""
    root = Path(root)
    count = 0
    for name in stored_names:
        if not name or is_ready(root, name):
            continue
        _cleanup(root / f"{name}{TMP_SUFFIX}")  # 上次进程被杀留下的半成品
        with _lock:
            if _state.get(name) in ("queued", "converting"):
                continue
            _state[name] = "queued"
            _msg.pop(name, None)
        _queue.put((root, name))
        count += 1
    if count:
        _ensure_worker()
    return count


def pending_count() -> int:
    """队列里还没处理完的份数（给管理端看进度用）。"""
    with _lock:
        return sum(1 for v in _state.values() if v in ("queued", "converting"))


def remove(root: Path, stored_name: str) -> None:
    """删除资料时清掉转换产物与它的切片目录（尽力而为，失败不抛）。"""
    if not stored_name:
        return
    root = Path(root)
    _cleanup(root / f"{stored_name}{TMP_SUFFIX}")
    _cleanup(view_pdf_path(root, stored_name))
    pdf_slice.remove_slices(root, view_pdf_name(stored_name))
    with _lock:
        _state.pop(stored_name, None)
        _msg.pop(stored_name, None)


# ── worker（单线程串行）─────────────────────────────────────

def _ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _worker = threading.Thread(target=_loop, name="office-view", daemon=True)
        _worker.start()


def _loop() -> None:
    while True:
        root, name = _queue.get()
        try:
            _process(root, name)
        except Exception:
            # 兜底：异常绝不能带走 worker 线程，否则后面的文件永远排不上
            _mark_failed(name, "转换进程异常退出")
        finally:
            _queue.task_done()


def _process(root: Path, stored_name: str) -> None:
    src = root / stored_name
    if not src.is_file():
        _mark_failed(stored_name, "原件已丢失，请管理员重新上传")
        return

    with _lock:
        _state[stored_name] = "converting"

    tmp = root / f"{stored_name}{TMP_SUFFIX}"
    _cleanup(tmp)
    ok, err = _run_worker(src, tmp)
    if not ok:
        _cleanup(tmp)
        _mark_failed(stored_name, err)
        return

    # 中间文件改名成成品：同目录改名是原子的，转换中途被杀也不会留下「假成品」
    dst = view_pdf_path(root, stored_name)
    try:
        if dst.exists():
            dst.unlink()
        tmp.replace(dst)
    except OSError:
        try:
            shutil.copyfile(tmp, dst)
            _cleanup(tmp)
        except OSError as err2:
            _cleanup(tmp)
            _mark_failed(stored_name, f"转换产物落盘失败：{err2}")
            return

    # 统一切片（force 跳过 pdf_slice 的体积门槛）：转换产物通常几 MB、几十到几百页，
    # 切片后考生端一页一个请求，首屏几十 KB。切片失败不影响已就绪的转换产物。
    pdf_slice.build_slices(root, view_pdf_name(stored_name), force=True)

    with _lock:
        _state[stored_name] = "ready"
        _msg.pop(stored_name, None)


def _run_worker(src: Path, dst: Path) -> tuple[bool, str]:
    """起子进程做真正的 COM 转换。返回 (是否成功, 失败原因)。"""
    cmd = [sys.executable, "-m", "modules.office_convert_worker", str(src), str(dst)]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(BASE_DIR),
            capture_output=True,
            timeout=CONVERT_TIMEOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        _cleanup(dst)
        return False, f"转换超过 {CONVERT_TIMEOUT // 60} 分钟仍未完成，请确认本机 Office 可用"
    except OSError as err:
        return False, f"无法启动转换进程：{err}"

    if proc.returncode != 0:
        lines = [ln.strip() for ln in (proc.stderr or b"").decode("utf-8", "replace").splitlines() if ln.strip()]
        return False, lines[-1] if lines else f"转换失败（退出码 {proc.returncode}）"
    if not dst.is_file() or dst.stat().st_size == 0:
        return False, "转换没有产出 PDF"
    return True, ""


def _mark_failed(stored_name: str, msg: str) -> None:
    with _lock:
        _state[stored_name] = "failed"
        _msg[stored_name] = msg


def _cleanup(p: Path) -> None:
    try:
        p.unlink(missing_ok=True)
    except OSError:
        pass
