"""
实时通道模块 —— SSE（Server-Sent Events）事件流，服务端主动推送到浏览器。

解决什么问题：
  以前考生端靠「每 30 秒轮询一次」发现新通知，最坏要等 30 秒。
  现在改成一条长连接：管理员一发通知 / 有人回复评论 / 发了新版本 / 账号被踢，
  服务端写库后立刻通过本模块推给在线的考生，基本无感（<1 秒）。
  轮询不删除，降级为兜底（见 src/hooks/useNotifications.ts）。

接口（前缀 /api/user，需要考生登录）：
  GET  "/stream"   考生端事件流（text/event-stream，长连接，不要加超时）

事件格式（SSE 标准帧：event: 名字 + data: JSON）：
  ready         连接建立，data = {server_time, user_id}
  notification  收到新通知，data = 与 GET /api/user/notifications 的单条结构完全一致
  update        有新版本，data = data/version.json 的内容
  kick          会话被踢（改密码 / 重置密码 / 封号 / 删号），data = {reason}
  （": ping" 注释帧是心跳，浏览器不会派发事件，只用来保活）

给其它模块用的推送工具（**写完数据库再调**，不要自己拼 HTTP）：
  publish(user_id, event, data)        推给某个考生的所有在线连接
  publish_many(user_ids, event, data)  推给一批考生
  publish_all(event, data)             推给所有在线考生（发新版本用）
  kick_session(user_id, reason)        通知某考生「登录已失效，请重新登录」
  online_user_count()                  当前在线考生数（调试用）

修改注意：
  1. 本模块是「进程内广播」（内存队列 + 事件循环），**只支持单进程启动**。
     server/main.py 用的是 uvicorn 默认单进程，够用；将来若改成 --workers N，
     必须把 _subscribers 换成 Redis Pub/Sub，否则跨进程收不到。
  2. 推送是「尽力而为」：考生不在线就丢弃，内容以数据库为准（前端上线后会拉一次列表补齐）。
     所以推送漏了不会丢数据，只是少了即时感。
  3. FastAPI 的同步路由（def）跑在线程池里，而流式响应跑在事件循环里，
     所以投递必须用 loop.call_soon_threadsafe 跨线程送到队列，不能直接 put_nowait。
  4. 令牌优先取 Authorization 头（前端用 fetch 流式读取，能带头）；
     ?token= 只是兜底（EventSource 那种带不了头的场景），会进访问日志，尽量别用。
  5. 部署到 Nginx / 反代后面时，必须对该路径关闭缓冲：proxy_buffering off;
     并放宽读超时，否则推送会被缓冲住、看起来「还是有延迟」。
"""

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from config import config
from database import now_iso
from deps import USER, bearer_token, resolve_session

router = APIRouter(prefix="/api/user", tags=["实时通道"])

# 事件名（前端 src/api/realtime.ts 的 REALTIME_EVENT 要与此保持一致）
EVENT_READY = "ready"
EVENT_NOTIFICATION = "notification"
# 管理员删掉了某条通知 → 在线考生立刻把它从列表里去掉（data: {"ids": [通知 id...]}）
EVENT_NOTIFICATION_REMOVED = "notification-removed"
EVENT_UPDATE = "update"
EVENT_KICK = "kick"

# 心跳间隔（秒）：没有事件时也定期发一帧，防止中间层（代理/防火墙）把空闲连接掐掉
HEARTBEAT_SECONDS = int(config.get("realtime", {}).get("heartbeat_seconds", 15) or 15)

# 单个连接的待发队列上限：客户端读得太慢就丢帧，绝不拖累服务端（前端有兜底轮询补数据）
QUEUE_MAX = 100

# 断线后浏览器自动重连的等待时间（毫秒），随第一帧下发给前端
RETRY_MS = 3000

# 每个考生可以有多个在线连接（多标签页 / 手机 + 电脑），所以是「队列的集合」
_subscribers: dict[int, set[asyncio.Queue]] = {}

# 主事件循环：lifespan 启动时记录，供线程池里的同步路由跨线程投递
_main_loop: asyncio.AbstractEventLoop | None = None


# ── 启动期绑定 ──────────────────────────────────────────────

def bind_loop() -> None:
    """在服务启动时（lifespan）记录主事件循环，之后线程池里的推送才能送进来。"""
    global _main_loop
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:  # 理论上不会发生（lifespan 一定在事件循环里）
        _main_loop = None


def enabled() -> bool:
    """实时通道总开关（config.json 的 realtime.enabled，默认开）。"""
    return bool(config.get("realtime", {}).get("enabled", True))


def online_user_count() -> int:
    """当前在线（挂着事件流）的考生数，调试 / 后台概览用。"""
    return len(_subscribers)


# ── 帧构造与投递 ────────────────────────────────────────────

def build_frame(event: str, data: Any) -> str:
    """拼一个标准 SSE 帧；ensure_ascii=False 保证中文不被转义成 \\uXXXX。"""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


def _safe_put(queue: asyncio.Queue, frame: str) -> None:
    """在事件循环线程里入队；队列满（客户端读得慢）就丢这一帧。"""
    try:
        queue.put_nowait(frame)
    except asyncio.QueueFull:
        pass


def publish(user_id: int, event: str, data: Any) -> None:
    """把一个事件推给某个考生的全部在线连接。可以在任意线程调用（同步路由里也能用）。

    不在线 / 未启用 / 事件循环未就绪 → 静默忽略，调用方不需要 try。
    """
    if not enabled():
        return
    loop = _main_loop
    queues = _subscribers.get(int(user_id))
    if loop is None or loop.is_closed() or not queues:
        return
    frame = build_frame(event, data)
    # list() 快照：避免遍历时另一个线程刚好在增删连接
    for queue in list(queues):
        try:
            loop.call_soon_threadsafe(_safe_put, queue, frame)
        except RuntimeError:  # 事件循环正在关闭（服务退出中）
            return


def publish_many(user_ids, event: str, data: Any) -> None:
    """推给一批考生（去重后逐个推）。"""
    if not enabled():
        return
    for user_id in set(user_ids):
        publish(user_id, event, data)


def publish_all(event: str, data: Any) -> None:
    """推给所有当前在线的考生（发新版本时用）。"""
    if not enabled():
        return
    publish_many(list(_subscribers.keys()), event, data)


def kick_session(user_id: int, reason: str) -> None:
    """告诉某考生「你的登录已失效」——前端收到后立刻退回登录页。

    用在：改密码 / 管理员重置密码 / 封号 / 删号（这些操作会删掉 sessions 行）。
    以前考生端要靠下一次轮询拿到 401 才知道（最坏 30 秒），现在即点即走；
    但**不能只靠它**：没连上的客户端仍由 client.ts 的 401 兜底，两者是互补的。
    """
    publish(user_id, EVENT_KICK, {"reason": reason})


# ── 事件流端点 ──────────────────────────────────────────────

async def _event_stream(request: Request, user_id: int):
    """SSE 生成器：先发握手帧，然后「有事件发事件、没事件发心跳」，直到客户端断开。"""
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    # setdefault + add 都是原子操作，流式响应的建立发生在事件循环线程里
    _subscribers.setdefault(user_id, set()).add(queue)
    try:
        # retry：告诉浏览器断线后隔多久自动重连
        yield f"retry: {RETRY_MS}\n\n"
        yield build_frame(EVENT_READY, {"server_time": now_iso(), "user_id": user_id})

        while True:
            # 客户端切走 / 关页面 → Starlette 会在这里读到 http.disconnect
            if await request.is_disconnected():
                break
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield ": ping\n\n"  # 注释帧：保活，浏览器不派发事件
                continue
            yield frame
    finally:
        # 断开一定清理，否则订阅表会一直涨（内存泄漏 + 推给死连接）
        conns = _subscribers.get(user_id)
        if conns is not None:
            conns.discard(queue)
            if not conns:
                _subscribers.pop(user_id, None)


@router.get("/stream", summary="实时事件流（SSE 长连接）")
async def stream(request: Request):
    """考生端实时事件流。前端用 fetch + ReadableStream 读，不要用普通请求调它。

    header 传 Authorization: Bearer <令牌>（推荐）；也兼容 ?token=<令牌>（兜底）。
    """
    if not enabled():
        # 关掉开关时明确拒绝，前端据此直接走轮询，不做无谓重连
        raise HTTPException(status_code=503, detail="实时通道未启用，请使用轮询")

    token = bearer_token(request)
    # 数据库查询是同步的，丢到线程里跑，别阻塞事件循环（长连接很在意这个）
    session = await asyncio.to_thread(resolve_session, token)
    if not session or session["subject_type"] != USER:
        raise HTTPException(status_code=401, detail="请先登录")

    return StreamingResponse(
        _event_stream(request, int(session["subject_id"])),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # 反向代理（Nginx）默认会缓冲响应体，关掉推送才出得去
            "X-Accel-Buffering": "no",
        },
    )
