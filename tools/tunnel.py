# -*- coding: utf-8 -*-
"""
Cloudflare 快速隧道（TryCloudflare）—— 把本机服务暴露到公网，让别人的手机/电脑能直接访问。

用法（由「启动公网访问.bat」自动调用，也可手动执行）：

    server\\.venv\\Scripts\\python.exe tools\\tunnel.py            # 用默认端口 8000
    server\\.venv\\Scripts\\python.exe tools\\tunnel.py 8080       # 指定本地端口
    server\\.venv\\Scripts\\python.exe tools\\tunnel.py --download # 只下载 cloudflared.exe

做了三件事：
  1. 拉起 cloudflared 的快速隧道，把本机端口穿到公网（不用公网 IP、不碰路由器、不用注册）
  2. 从 cloudflared 日志里解析出本次的公网地址，并实测一次 /api/health
  3. 打印到控制台 + 写入项目根目录的「公网地址.txt」，方便复制转发

⚠️ 快速隧道的特点（和 SakuraFrp 的区别）：
  - **地址每次重启都会变**（形如 https://xxxx-xx-xx-xx-xx.trycloudflare.com），
    发给别人前请以本次控制台打印的地址为准，重启后要重新发。
  - 完全免费、零配置：不注册、不实名、不填任何密钥，跑起来就有地址。
  - 走 Cloudflare 的 HTTPS，本身就是 https，不用管明文拦截那套。

修改注意：
  - 输出的「公网地址.txt」标签（考生端 App / 管理后台 / 接口文档 / 本机地址 / 生成时间）
    被 server/modules/overview.py 的 /api/admin/tunnel 依赖，改标签要两边一起改
  - 隧道客户端只认 cloudflared.exe
"""

from __future__ import annotations

import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
ROOT_DIR = TOOLS_DIR.parent
ADDR_FILE = ROOT_DIR / "公网地址.txt"
CLOUDFLARED_PATH = TOOLS_DIR / "cloudflared.exe"

DEFAULT_PORT = 8000
DOWNLOAD_URL = (
    "https://github.com/cloudflare/cloudflared/releases/latest/download/"
    "cloudflared-windows-amd64.exe"
)
DOWNLOAD_PAGE = "https://github.com/cloudflare/cloudflared/releases/latest"

# 快速隧道连上后，日志里会给一行 trycloudflare 公网地址
PUBLIC_URL_RE = re.compile(r"https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com", re.I)

# 隧道已连上的日志特征
OK_MARKERS = ("your quick tunnel has been created", "trycloudflare.com")

# 出错日志特征 → 直接给出人能看懂的结论
FAIL_HINTS = (
    ("failed to request quick tunnel", "Cloudflare 拒绝了快速隧道请求，稍后重试或检查网络"),
    ("failed to dial to edge", "连不上 Cloudflare 边缘节点，检查网络 / 代理"),
    ("unable to reach the origin", "隧道连上了，但本机后端没起来（先启动后端再跑隧道）"),
    ("context deadline", "连接 Cloudflare 超时，稍后重试"),
    ("no such host", "域名解析失败，检查 DNS / 网络"),
)


def _reconfigure_stdio() -> None:
    """让输出不因编码问题崩掉，同时中文不乱码。

    两种场景要分开（2026-09-30 实测踩坑）：
    - 真控制台（isatty=True）：Python 3.6+ 走 WriteConsoleW 直接写 Unicode，
      天然不乱码 —— **千万别改编码**！底层 WindowsConsoleIO 只认 UTF-8 字节，
      硬改成 cp936 后 GBK 字节被当 UTF-8 解，中文全变乱码（之前的乱码就是这么来的）。
    - 被重定向/管道（isatty=False）：编码跟随环境变量，只兜 errors=replace
      防止极端字符让脚本崩掉。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            if not stream.isatty():
                stream.reconfigure(errors="replace")  # type: ignore[union-attr]
        except Exception:
            pass


def _line(text: str = "") -> None:
    print(text, flush=True)


# ── cloudflared 客户端 ──────────────────────────────────────


def find_cloudflared() -> Path | None:
    """按优先级找 cloudflared.exe：项目 tools/ → PATH。"""
    if CLOUDFLARED_PATH.exists():
        return CLOUDFLARED_PATH
    found = shutil.which("cloudflared")
    return Path(found) if found else None


def download_cloudflared() -> bool:
    """下载 cloudflared.exe 到 tools/，并实际跑一次 --version 校验。"""
    _line(f"  正在下载 cloudflared（约 53MB）：{DOWNLOAD_URL}")
    tmp = CLOUDFLARED_PATH.with_suffix(".download")
    tmp.unlink(missing_ok=True)
    try:
        with urllib.request.urlopen(DOWNLOAD_URL, timeout=180) as resp, open(tmp, "wb") as fp:
            while True:
                chunk = resp.read(64 * 1024)
                if not chunk:
                    break
                fp.write(chunk)
    except Exception as exc:  # noqa: BLE001
        _line(f"  [错误] 下载失败：{exc}")
        _line(f"         可手动到 {DOWNLOAD_PAGE} 下载 cloudflared-windows-amd64.exe，")
        _line(f"         改名为 cloudflared.exe 放进 {TOOLS_DIR}")
        tmp.unlink(missing_ok=True)
        return False

    tmp.replace(CLOUDFLARED_PATH)
    try:
        out = subprocess.run(
            [str(CLOUDFLARED_PATH), "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        version = (out.stdout or out.stderr or "").strip().splitlines()[0] if (out.stdout or out.stderr) else ""
    except Exception as exc:  # noqa: BLE001
        version = ""
        _line(f"  [错误] 下载的文件跑不起来：{exc}")
    if not version:
        _line("  [错误] 下载不完整，已删除，请重试。")
        CLOUDFLARED_PATH.unlink(missing_ok=True)
        return False

    _line(f"  cloudflared 就绪：{version}")
    return True


def ensure_cloudflared(auto_download: bool = True) -> Path | None:
    exe = find_cloudflared()
    if exe is not None:
        return exe
    if not auto_download:
        return None
    if not download_cloudflared():
        return None
    return find_cloudflared()


# ── 公网地址 ────────────────────────────────────────────────


def probe(url: str, timeout: float = 8.0) -> tuple[bool, str, str]:
    """走公网地址打一次 /api/health，判断隧道是否真的通。

    返回 (是否通过, 结果说明, 排错建议)。
    """
    target = url.rstrip("/") + "/api/health"
    request = urllib.request.Request(target, headers={"User-Agent": "ndt-tunnel-check"})
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE  # 自签 / 证书链路不一致时不至于误判
    # 每次都新建 opener：不复用可能已失效的连接（隧道刚起时首连常失败）
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}),  # 绕开系统代理，免得被拦
        urllib.request.HTTPSHandler(context=context),
    )
    try:
        with opener.open(request, timeout=timeout) as resp:
            body = resp.read(400).decode("utf-8", "replace").strip()
            return resp.status == 200, f"{resp.status} {body[:40]}", ""
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}", ""
    except Exception as exc:  # noqa: BLE001 —— 隧道未就绪时常见超时/DNS 未传播，交给上层重试
        return False, type(exc).__name__, ""


def resolve_public_url(raw: str, attempts: int = 8, delay: float = 3.0) -> tuple[str, bool, str, str]:
    """重试探测公网地址，返回 (最终地址, 是否实测通过, 结果说明, 排错建议)。

    隧道刚起来时 Cloudflare 边缘可能还没就绪（DNS 传播 / 边缘下发配置有延迟），
    所以多试几次；每次用一个全新的 opener，避免连接池里缓存了失败的连接。
    """
    if not raw:
        return "", False, "未取到公网地址", ""
    last_note = ""
    last_hint = ""
    for _ in range(attempts):
        ok, note, hint = probe(raw)
        if ok:
            return raw, True, note, ""
        last_note, last_hint = note, hint
        time.sleep(delay)
    return raw, False, last_note, last_hint


# ── 输出 ────────────────────────────────────────────────────


def announce(url: str, local: str, verified: bool, hint: str = "") -> None:
    """把公网地址写到「公网地址.txt」并高亮打印。"""
    footer = ""
    if url and not verified:
        advice = hint or "请稍后重新运行 启动公网访问.bat 获取新地址。"
        footer = (
            "\n"
            "注意：本次没能从本机实测通过该地址（Cloudflare 边缘可能还在就绪中）。\n"
            "      如果确实打不开：" + advice.split("\n")[0] + "\n"
        )
    ADDR_FILE.write_text(
        "NDT 刷题 App · 公网访问地址\n"
        + "=" * 44
        + "\n"
        + (f"官网入口   ：{url}\n" if url else "官网入口   ：（本次未取到公网地址）\n")
        + f"考生端 App ：{url}/app/\n"
        + f"管理后台   ：{url}/admin/\n"
        + f"接口文档   ：{url}/docs\n"
        + "\n"
        + f"本机地址   ：{local}\n"
        + "隧道平台   ：Cloudflare 快速隧道（TryCloudflare）\n"
        + f"生成时间   ：{datetime.now():%Y-%m-%d %H:%M:%S}\n"
        + "\n"
        + "地址由 Cloudflare 快速隧道提供，每次重启都会变，重启后请重新获取并发给别人。\n"
        + "关闭这个窗口 = 公网访问中断（本机仍可正常使用）。\n"
        + footer,
        encoding="utf-8-sig",
    )

    bar = "=" * 62
    _line()
    _line("  " + bar)
    if url:
        _line("  公网隧道已建立，把下面的地址发给别人就能访问：")
        _line()
        _line(f"     官网入口   ： {url}")
        _line(f"     考生端 App ： {url}/app/")
        _line(f"     管理后台   ： {url}/admin/")
        _line()
        _line("     [提醒] 快速隧道地址每次重启都会变，重启后请重新发一遍。")
        if not verified:
            _line()
            if hint:
                _line("     [注意] 本机没能实测通过该地址，原因和改法如下：")
                for part in hint.split("\n"):
                    _line("     " + part.strip())
            else:
                _line("     [注意] 本机未能实测通过该地址，若打不开请重新运行本脚本")
    else:
        _line("  隧道窗口已就绪，但还没拿到公网地址。")
        _line("  请稍等片刻，或重新运行 启动公网访问.bat。")
    _line()
    _line(f"  地址已保存到：{ADDR_FILE}")
    _line("  " + bar)
    _line()


# ── 主流程 ──────────────────────────────────────────────────


def _diagnose(log_tail: list[str]) -> None:
    _line()
    _line("  [错误] 隧道没能连上，参考下面的原因：")
    hits = 0
    for line in log_tail:
        for keyword, advice in FAIL_HINTS:
            if keyword.lower() in line.lower():
                _line(f"         · {advice}")
                hits += 1
                break
        if hits >= 3:
            break
    if not hits:
        _line("         · 请检查网络（尤其是能否访问 cloudflare.com）；上方是 cloudflared 的原始日志。")
    _line("         · 改完配置后重新运行：启动公网访问.bat")


def _start_log_drain(proc: subprocess.Popen) -> None:
    """连着跑的时候继续把 cloudflared 的日志读掉。

    不读的话管道缓冲区迟早写满，cloudflared 会阻塞在写日志上 —— 表现为隧道「莫名其妙断了」。
    """
    stop_markers = (" error", "failed", "unable", "401", "403", "reconnect", "disconnect")

    def run() -> None:
        try:
            assert proc.stdout is not None
            for raw in proc.stdout:
                low = raw.lower()
                if any(k in low for k in stop_markers):
                    _line("  [隧道] " + raw.rstrip("\r\n"))
        except Exception:  # noqa: BLE001 —— 进程结束/管道关闭都正常
            pass

    threading.Thread(target=run, name="cloudflared-log", daemon=True).start()


def _shutdown(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def main() -> int:
    _reconfigure_stdio()
    args = sys.argv[1:]

    if "--download" in args:
        _line("=" * 62)
        _line("  Cloudflare 快速隧道客户端 cloudflared 下载")
        _line("=" * 62)
        if find_cloudflared() and "--force" not in args:
            _line(f"  已存在，无需下载：{find_cloudflared()}")
            return 0
        return 0 if download_cloudflared() else 1

    port = DEFAULT_PORT
    for arg in args:
        if arg.isdigit():
            port = int(arg)
    local = f"http://127.0.0.1:{port}"
    hostport = f"127.0.0.1:{port}"

    exe = ensure_cloudflared()
    if exe is None:
        _line()
        _line("  [错误] 没有可用的 cloudflared.exe")
        _line(f"         请到 {DOWNLOAD_PAGE} 下载 Windows amd64 版，")
        _line(f"         改名为 cloudflared.exe 放进 {TOOLS_DIR}")
        return 1

    _line("=" * 62)
    _line(f"  正在为 {local} 建立 Cloudflare 快速隧道 ...")
    _line(f"  隧道程序：{exe}")
    _line("  隧道地址：本次连接后自动分配（每次重启都会变）")
    _line("  首次连接约 5~20 秒。按 Ctrl+C 可断开。")
    _line("=" * 62)

    proc = subprocess.Popen(
        [str(exe), "tunnel", "--url", local, "--no-autoupdate"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )

    url = ""
    log_tail: list[str] = []
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\r\n")
            if not line.strip():
                continue
            log_tail.append(line)
            del log_tail[:-12]

            low = line.lower()
            if not url:
                match = PUBLIC_URL_RE.search(line)
                if match:
                    url = match.group(0)
                    _line("  隧道已连接，正在校验公网地址（首次可能要等十几秒）...")
                    break

            # 其它日志默认静音，只把出错信息透出来，便于排查
            if any(k in low for k in (" err ", "error", "failed", "unable", "401", "403")):
                _line(f"  [隧道] {line}")
    except KeyboardInterrupt:
        _line("\n  正在断开隧道 ...")
        _shutdown(proc)
        _line("  隧道已关闭。")
        return 0

    if not url:
        # cloudflared 直接退出了（网络不通 / 代理），或者没读到地址
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
        if proc.poll() is not None:
            _diagnose(log_tail)
            return 1
        _line("  没读到公网地址日志，继续等待 ...")

    _start_log_drain(proc)

    if url:
        resolved, verified, note, hint = resolve_public_url(url)
        announce(resolved, local, verified, hint)
    else:
        announce("", local, False)

    if not url:
        _shutdown(proc)
        _diagnose(log_tail)
        return 1

    _line("  隧道运行中，关闭本窗口即断开（本机 127.0.0.1 不受影响）。")
    try:
        code = proc.wait()
    except KeyboardInterrupt:
        _line("\n  正在断开隧道 ...")
    else:
        if code:
            _line(f"  [警告] cloudflared 异常退出（退出码 {code}），隧道可能已断开 —— 重新运行本脚本即可。")
    finally:
        _shutdown(proc)

    _line("  隧道已关闭。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
