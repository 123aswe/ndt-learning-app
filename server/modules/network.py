"""
网络访问模块 —— 管理后台「网络访问」卡片：局域网直连开关 + 公网隧道一键启动/停止。

背景：
  服务现在监听 0.0.0.0（config.server.host），「谁能访问」改由本模块的开关控制，
  守卫逻辑在 main.py 的 lan_guard 中间件里调用 lan_allowed()：
  - 局域网访问「关」（默认）：非本机来源一律 403 → 行为与旧版「只监听 127.0.0.1」完全一致。
    公网隧道不受影响：cloudflared 从本机 127.0.0.1 连入，始终算本机请求。
  - 局域网访问「开」：同一 WiFi 下的手机/电脑直接用局域网地址访问（比公网隧道快得多）。
  公网隧道：本模块代替「启动公网访问.bat」在后台拉起 tools/tunnel.py 子进程；
  公网地址仍由 tunnel.py 写进项目根「公网地址.txt」，/api/admin/tunnel 继续负责读取展示，
  前端「网络访问」卡片只负责启动/停止与状态展示。

接口（前缀 /api/admin，需要管理员登录）：
  GET  /api/admin/network          局域网开关/三条地址 + 公网隧道运行状态
  POST /api/admin/network/lan      {enabled: bool} 开关局域网访问（写回 config.json，重启保持）
  POST /api/admin/network/public   {action: "start"|"stop"} 一键启动/停止公网隧道

公开接口（**无需登录**，小程序端自动获取当前可用地址）：
  GET  /api/access-info            本机 / 局域网 / 公网 三条入口地址
                                   （与后台「网络访问」卡片同源 —— 后台显示什么，小程序就跟随什么）

修改注意：
  - 局域网开关 = 内存态 _lan_state（启动时从 config 读）+ 写回 config.json 的 lan_access.enabled；
    写回时直接改 config.json 文件，保留文件里其余键（含 _说明 等注释键）
  - 停止隧道必须 taskkill /T /F 杀整棵进程树（tunnel.py → cloudflared），
    只 Popen.terminate() 会留下孤儿 cloudflared 继续占着隧道
  - 后端因 uvicorn reload 重启后，靠 server/data/tunnel.pid 恢复隧道状态（进程活着 = running）
  - 「公网地址.txt」的标签文案由 tools/tunnel.py announce() 写出、modules/overview.py 解析，
    动文案要三处同步（解析点已收敛到 overview.tunnel_addresses()，本模块直接调它）
  - /api/access-info 故意不带 admin 令牌：小程序端没有管理员身份。
    安全性由 main.py 的 lan_guard 兜底 —— 局域网开关关时非本机请求一律 403；
    公网隧道从 127.0.0.1 连入，始终放行。暴露的信息与后台卡片一致，不多给任何数据
"""

from __future__ import annotations

import json
import socket
import subprocess
import sys
import threading
import time
from collections import deque
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import BASE_DIR, CONFIG_PATH, config
from deps import get_current_admin
from modules import overview

router = APIRouter(prefix="/api/admin", tags=["网络访问"])

# ── 路径 ────────────────────────────────────────────────────
# 项目根 = server/ 的上一级
ROOT_DIR = BASE_DIR.parent
TUNNEL_SCRIPT = ROOT_DIR / "tools" / "tunnel.py"
PID_FILE = BASE_DIR / "data" / "tunnel.pid"


# ════════════════════════════════════════════════════════════
# 局域网访问
# ════════════════════════════════════════════════════════════

# 内存态开关：启动时读 config.json（config.py 已合并 DEFAULTS）
_lan_state: bool = bool(config.get("lan_access", {}).get("enabled", False))


def lan_enabled() -> bool:
    """局域网访问当前是否开启（供 main.py 守卫中间件高频调用，纯内存读）。"""
    return _lan_state


def _write_lan_enabled(value: bool) -> None:
    """把开关写回 config.json（保留文件里其余键，含 _说明 注释键）。

    只改这一个键，不动用户的其他配置；文件不存在（理论不可能，启动脚本会生成）就新建。
    """
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}
    except Exception:
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    lan_block = raw.get("lan_access")
    raw["lan_access"] = {**(lan_block if isinstance(lan_block, dict) else {}), "enabled": bool(value)}
    CONFIG_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ── 本机地址探测 ────────────────────────────────────────────

_ip_cache: tuple[float, frozenset[str]] = (0.0, frozenset())
_IP_TTL = 60.0  # 秒：网卡地址缓存的刷新间隔


def _local_ips() -> frozenset[str]:
    """本机所有地址（回环 + 各网卡 IPv4/IPv6），带 60 秒缓存。

    用途：判断「请求是不是来自本机」。用户在本机用局域网 IP 打开页面时，
    request.client.host 是本机网卡地址而不是 127.0.0.1，必须一并放行。
    """
    global _ip_cache
    now = time.monotonic()
    if _ip_cache[1] and now - _ip_cache[0] < _IP_TTL:
        return _ip_cache[1]
    ips = {"127.0.0.1", "::1"}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ips.add(str(info[4][0]).lower())
    except OSError:
        pass  # 主机名解析失败不影响其余判断
    _ip_cache = (now, frozenset(ips))
    return _ip_cache[1]


def lan_ip() -> str:
    """本机局域网 IPv4。

    UDP connect 只查本机路由表、不真正发包，拿到的就是默认路由出口的网卡地址；
    完全离线时回退到本机地址里第一个私网段 IP，再取不到就返回空串。
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("223.5.5.5", 80))
        return s.getsockname()[0]
    except OSError:
        for ip in _local_ips():
            if "." in ip and ip.startswith(("192.168.", "10.", "172.")) and not ip.startswith("172.0."):
                return ip
        return ""
    finally:
        s.close()


def is_local_client(host: str | None) -> bool:
    """请求来源是否本机。

    - 127.0.0.1 / ::1 → 本机（cloudflared 隧道从 127.0.0.1 连入，天然放行，公网不受开关影响）
    - 本机网卡地址（用局域网 IP 打开自己）→ 本机
    - host 取不到（异常场景）→ 按本机处理，宁放行勿误伤
    """
    if not host:
        return True
    host = str(host).lower().strip("[]")
    if host in _local_ips():
        return True
    # IPv6 回环的映射写法
    return host in ("::1", "::ffff:127.0.0.1")


def lan_allowed(host: str | None) -> bool:
    """守卫中间件唯一入口：局域网开关开着，或请求来自本机，都放行。"""
    return _lan_state or is_local_client(host)


def _lan_payload() -> dict:
    """局域网信息汇总（三条地址给前端直接展示/复制）。"""
    port = int(config["server"]["port"])
    ip = lan_ip()
    base = f"http://{ip}:{port}" if ip else ""
    return {
        "enabled": _lan_state,
        "ip": ip,
        "port": port,
        "base_url": base,
        "site_url": (base + "/") if base else "",
        "app_url": (base + "/app/") if base else "",
        "admin_url": (base + "/admin/") if base else "",
    }


# ════════════════════════════════════════════════════════════
# 公网隧道（tools/tunnel.py 子进程）
# ════════════════════════════════════════════════════════════

_tunnel_proc: subprocess.Popen | None = None
_tunnel_started_at: str = ""
_tunnel_log: deque = deque(maxlen=60)  # 最近日志，供后台排错展示
_tunnel_lock = threading.Lock()


def _pid_alive(pid: int) -> bool:
    """Windows 下用 tasklist 判断进程是否存活（不引第三方依赖）。"""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV"],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=10,
        ).stdout or ""
    except Exception:
        return False
    # CSV 第二列才是 PID，但带引号匹配 "{pid}" 已足够防 1234 误匹配 12345
    return f'"{pid}"' in out


def _drain(proc: subprocess.Popen) -> None:
    """读掉 tunnel.py 的输出，防止管道缓冲区写满把它卡死；同时留最近几十行排错。"""
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\r\n")
            if line.strip():
                _tunnel_log.append(line)
    except Exception:
        pass  # 进程结束 / 管道关闭都属正常


def tunnel_status() -> dict:
    """公网隧道运行状态。

    两种来源都认：本进程句柄活着（正常路径）；后端因 reload 重启后句柄丢失，
    但隧道子进程还在 —— 用 server/data/tunnel.pid 里的 PID 查 tasklist 恢复状态。
    """
    global _tunnel_started_at
    with _tunnel_lock:
        proc = _tunnel_proc
        started_at = _tunnel_started_at

    pid = 0
    running = False
    if proc is not None and proc.poll() is None:
        running = True
        pid = proc.pid
    else:
        try:
            pid = int(PID_FILE.read_text(encoding="utf-8").strip())
        except (OSError, ValueError):
            pid = 0
        if pid > 0 and _pid_alive(pid):
            running = True
            started_at = ""  # 恢复场景拿不到准确启动时间
        else:
            PID_FILE.unlink(missing_ok=True)
            pid = 0
    return {
        "running": running,
        "pid": pid,
        "started_at": started_at if running else "",
        "log_tail": list(_tunnel_log)[-8:],
    }


def start_tunnel() -> dict:
    """后台拉起 tools/tunnel.py（它自己会解析公网地址并写「公网地址.txt」）。"""
    global _tunnel_proc, _tunnel_started_at
    st = tunnel_status()
    if st["running"]:
        return {"ok": True, "already": True, **st}
    if not TUNNEL_SCRIPT.exists():
        return {"ok": False, "error": f"没找到隧道脚本：{TUNNEL_SCRIPT}"}

    port = int(config["server"]["port"])
    proc = subprocess.Popen(
        [sys.executable, str(TUNNEL_SCRIPT), str(port)],
        cwd=str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    with _tunnel_lock:
        _tunnel_proc = proc
        _tunnel_started_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _tunnel_log.clear()
    PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    threading.Thread(target=_drain, args=(proc,), name="tunnel-drain", daemon=True).start()
    return {"ok": True, "already": False, **tunnel_status()}


def stop_tunnel() -> dict:
    """停止隧道：taskkill /T /F 杀整棵进程树（tunnel.py + cloudflared），并清理 pid 文件。"""
    global _tunnel_proc, _tunnel_started_at
    st = tunnel_status()
    if not st["running"]:
        PID_FILE.unlink(missing_ok=True)
        return {"ok": True, "was_running": False}

    pid = st["pid"]
    try:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(pid)],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=15,
        )
    except Exception:
        pass  # 进程可能刚好自己退了，下方 wait + pid 文件清理兜底

    with _tunnel_lock:
        if _tunnel_proc is not None:
            try:
                _tunnel_proc.wait(timeout=5)
            except Exception:
                pass
        _tunnel_proc = None
        _tunnel_started_at = ""
    PID_FILE.unlink(missing_ok=True)
    return {"ok": True, "was_running": True}


# ════════════════════════════════════════════════════════════
# 路由
# ════════════════════════════════════════════════════════════


class LanToggleBody(BaseModel):
    enabled: bool


class PublicActionBody(BaseModel):
    action: str  # start | stop


@router.get("/network", summary="网络访问总览（局域网开关/地址 + 公网隧道状态）")
def network_overview(admin: dict = Depends(get_current_admin)):
    return {"lan": _lan_payload(), "public": tunnel_status()}


@router.post("/network/lan", summary="开关局域网访问（写回 config.json，重启保持）")
def toggle_lan(body: LanToggleBody, admin: dict = Depends(get_current_admin)):
    global _lan_state
    _lan_state = bool(body.enabled)
    _write_lan_enabled(_lan_state)
    return _lan_payload()


@router.post("/network/public", summary="一键启动 / 停止公网隧道")
def toggle_public(body: PublicActionBody, admin: dict = Depends(get_current_admin)):
    action = (body.action or "").strip().lower()
    if action == "start":
        result = start_tunnel()
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error", "启动失败"))
        return result
    if action == "stop":
        return stop_tunnel()
    raise HTTPException(status_code=400, detail="action 只支持 start / stop")


# ════════════════════════════════════════════════════════════
# 公开接口：当前可用地址（小程序端自动获取，无需登录）
# ════════════════════════════════════════════════════════════

public_router = APIRouter(prefix="/api", tags=["网络访问"])


@public_router.get("/access-info", summary="当前可用的访问地址（小程序端自动获取，无需登录）")
def access_info():
    """本机 / 局域网 / 公网 三条入口地址，供小程序端自动挑选可用后端。

    内容与后台「网络访问」卡片**同源**（局域网地址来自本模块的 lan_ip/_lan_state，
    公网地址来自 overview.tunnel_addresses）—— 后台显示什么，小程序就跟随什么：
    局域网 IP 变了、隧道地址重启后变了，小程序下次打开会自动跟上，不用手改配置。

    为什么不带 admin 令牌：小程序端没有管理员身份，且它本来就知道自己要连哪台机器。
    真正的边界是 main.py 的 lan_guard —— 局域网开关关时，非本机请求连这个方法都到不了（403）。
    """
    port = int(config["server"]["port"])
    ip = lan_ip()
    local_base = f"http://127.0.0.1:{port}"
    lan_base = f"http://{ip}:{port}" if ip else ""
    pub = overview.tunnel_addresses()
    return {
        "ok": True,
        "port": port,
        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "local": {
            "base_url": local_base,
            "app_url": f"{local_base}/app/",
        },
        "lan": {
            "enabled": _lan_state,
            "ip": ip,
            "base_url": lan_base,
            "app_url": f"{lan_base}/app/" if lan_base else "",
        },
        "public": {
            "available": bool(pub.get("app_url")),
            "app_url": pub.get("app_url", ""),
            "generated_at": pub.get("generated_at", ""),
        },
    }
