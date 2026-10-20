# -*- coding: utf-8 -*-
"""Office → PDF 转换子进程（只做一件事，做完就退出）。

为什么单独起一个进程，而不是在 uvicorn 里直接调 COM：
  1. MS Office 的 COM 自动化偶尔会卡住（弹「正在配置 Office」「文档被占用」这类对话框），
     子进程能被 subprocess 超时**强杀**；同进程里的线程卡死就只能重启整个后端服务。
  2. Office 组件自身崩溃（COM 异常）不会把后端主进程带崩 —— 转换失败只是这一份资料
     没有在线预览，其它功能照常。

用法（仅供 modules/office_view.py 的调度线程调用，不对外暴露）：
    python -m modules.office_convert_worker <源文件> <目标.pdf>

退出码：0 = 目标 PDF 已生成且非空；其它 = 失败，stderr 最后一行是给考生看的原因。

⚠️ 单实例干扰的防护
   Office 的 COM 服务器是「每用户单实例」：用户自己开着 PowerPoint 时，
   CreateObject 会**附加到用户那个实例**，此时直接 Quit 会把用户正在编辑的窗口一起关掉。
   所以每种应用都先记下「打开前已有多少个文档」：只有确认实例是我们自己拉起来的
   （打开前一个文档都没有）才 Quit；否则只关自己打开的那一份，不碰用户的。
"""

import sys
from pathlib import Path

# 让管道里的中文错误信息始终能被父进程按 utf-8 解出来
# （Windows 上管道默认用 cp936，父进程按 utf-8 读会变乱码）
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# PowerPoint 另存为：32 = ppSaveAsPDF
_PP_SAVE_AS_PDF = 32
# Word 另存为：17 = wdFormatPDF
_WD_FORMAT_PDF = 17
# Excel 固定格式导出：0 = xlTypePDF
_XL_TYPE_PDF = 0

PPT_EXT = {".ppt", ".pptx", ".pps", ".ppsx", ".pptm", ".pot", ".potx"}
DOC_EXT = {".doc", ".docx", ".docm", ".dot", ".dotx", ".rtf"}
XLS_EXT = {".xls", ".xlsx", ".xlsm", ".xlt"}


def _convert_ppt(src: Path, dst: Path) -> None:
    import comtypes.client

    app = comtypes.client.CreateObject("PowerPoint.Application", dynamic=True)
    # 打开前已有演示文稿 = 用户正开着 PowerPoint，绝不能 Quit（会关掉人家的窗口）
    user_busy = app.Presentations.Count > 0
    try:
        # Open(FileName, ReadOnly, Untitled, WithWindow) —— 不开窗口，纯后台转换
        pres = app.Presentations.Open(str(src), True, False, False)
        try:
            pres.SaveAs(str(dst), _PP_SAVE_AS_PDF)
        finally:
            pres.Close()
    finally:
        if not user_busy:
            try:
                app.Quit()
            except Exception:
                pass


def _convert_word(src: Path, dst: Path) -> None:
    import comtypes.client

    app = comtypes.client.CreateObject("Word.Application", dynamic=True)
    user_busy = app.Documents.Count > 0
    if not user_busy:
        try:
            app.Visible = False  # 自己拉起的实例才隐藏窗口，别动用户的
        except Exception:
            pass
    try:
        # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
        doc = app.Documents.Open(str(src), False, True, False)
        try:
            doc.SaveAs2(str(dst), _WD_FORMAT_PDF)
        finally:
            doc.Close(False)
    finally:
        if not user_busy:
            try:
                app.Quit()
            except Exception:
                pass


def _convert_excel(src: Path, dst: Path) -> None:
    import comtypes.client

    app = comtypes.client.CreateObject("Excel.Application", dynamic=True)
    user_busy = app.Workbooks.Count > 0
    if not user_busy:
        try:
            app.Visible = False
            app.DisplayAlerts = False
        except Exception:
            pass
    try:
        # Open(FileName, UpdateLinks, ReadOnly)
        wb = app.Workbooks.Open(str(src), 0, True)
        try:
            # ExportAsFixedFormat(Type, Filename, ...) —— 比 SaveAs 更能保住排版与打印区域
            wb.ExportAsFixedFormat(_XL_TYPE_PDF, str(dst))
        finally:
            wb.Close(False)
    finally:
        if not user_busy:
            try:
                app.Quit()
            except Exception:
                pass


def main() -> int:
    if len(sys.argv) < 3:
        print("用法：python -m modules.office_convert_worker <源文件> <目标.pdf>", file=sys.stderr)
        return 2

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    if not src.is_file():
        print(f"源文件不存在：{src.name}", file=sys.stderr)
        return 3

    ext = src.suffix.lower()
    try:
        if ext in PPT_EXT:
            _convert_ppt(src, dst)
        elif ext in DOC_EXT:
            _convert_word(src, dst)
        elif ext in XLS_EXT:
            _convert_excel(src, dst)
        else:
            print(f"不支持转换的格式：{ext}", file=sys.stderr)
            return 4
    except ImportError:
        print("缺少 comtypes 组件，无法调用 Office 转换（请在 server/.venv 执行 pip install comtypes）", file=sys.stderr)
        return 5
    except Exception as err:  # COM 报错五花八门，统一收口成一句人话
        print(f"转换失败：{type(err).__name__} {err}".strip(), file=sys.stderr)
        return 6

    if not dst.is_file() or dst.stat().st_size == 0:
        print("转换结束但没有产出 PDF（可能未安装 Office，或文件设置了打开密码）", file=sys.stderr)
        return 7
    return 0


if __name__ == "__main__":
    sys.exit(main())
