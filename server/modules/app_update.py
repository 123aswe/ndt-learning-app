"""
版本更新模块 —— 前端「检查更新」+ 后台发布新版本（实时推给在线考生）。

接口（公开，前缀 /api/app）：
  GET  "/version"   最新版本信息（无需登录，前端启动时比对一次）

接口（管理端，前缀 /api/admin/app，需要管理员登录）：
  POST "/version"   发布新版本：写 data/version.json + 立刻推给所有在线考生

版本信息来源：
  1. server/data/version.json（存在则用，改版本不用改代码）
  2. 文件不存在 / 解析失败 → 用本文件 DEFAULT_VERSION 兜底

version.json 字段（全部可选，缺省用 DEFAULT_VERSION 的值）：
  {
    "latest_version": "1.1.0",          # 最新版本号，与前端 src/data/appVersion.ts 的 APP_VERSION 比较
    "published_at": "2026-10-01",        # 发布时间
    "notes": ["修复…", "新增…"],          # 更新说明（逐条）
    "download_url": "https://…",         # 安装包 / 下载页地址（仅打包版 App 需要，网页版留空即可）
    "force": false                        # true = 强制更新（前端弹不可关闭的更新弹层）
  }

发布后考生端会怎样（见前端 src/hooks/useAppUpdate.ts）：
  在线考生立刻收到 SSE 的 update 事件 → 普通版本弹可关闭的顶部提示条，
  force=true 弹不可关闭的更新弹层；正在答题/考试时不打扰，交卷回到主界面再提示。
  网页版点「立即更新」= 刷新页面（Vite 产物带内容哈希，刷新即拿新版）；
  有 download_url 时同时提供「下载新版本」（打包版 App 用）。

**真正的热更新不在这里做**：本模块只负责「告诉」考生有新版本 + 怎么拿新版本。

修改注意：
  - 版本号比较规则（x.y.z 逐段数值比较）在前端 src/data/appVersion.ts，后端不参与判断
  - 发布必须同时改前端 src/data/appVersion.ts 的 APP_VERSION 并重新构建部署，
    否则会出现「提示有新版，点更新后还是旧版」的循环（版本号没变，前端永远认为自己是旧的）
  - 「新版本推送」是双保险：发布接口即时推 + watch_version_file() 盯文件变更推。
    后者覆盖「直接改文件 / git 拉代码」这类不走接口的发布方式
"""

import asyncio
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config import BASE_DIR
from deps import get_current_admin
from modules import realtime

router = APIRouter(prefix="/api/app", tags=["版本更新"])
admin_router = APIRouter(prefix="/api/admin/app", tags=["版本更新（管理端）"])

VERSION_FILE = BASE_DIR / "data" / "version.json"

# 后台盯 version.json 的间隔（秒）：只为覆盖「不走接口的发布」，10 秒足够，开销可忽略
WATCH_INTERVAL_SECONDS = 10

DEFAULT_VERSION: dict = {
    "latest_version": "1.0.0",
    "published_at": "2026-09-29",
    "notes": ["首个版本：题库练习、错题本、学习记录、个人资料与设置"],
    "download_url": "",
    "force": False,
}


def read_version() -> dict:
    """读 data/version.json；读不到 / 解析失败 / 字段缺失 → 用兜底常量补齐。永远不抛异常。"""
    data = dict(DEFAULT_VERSION)
    if VERSION_FILE.exists():
        try:
            loaded = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                for key in DEFAULT_VERSION:
                    if key in loaded and loaded[key] not in (None, ""):
                        data[key] = loaded[key]
        except Exception as exc:  # 配置写坏不影响检查更新，退回默认值并打日志
            print(f"[app/version] version.json 解析失败，已退回默认版本：{exc}")
    return data


@router.get("/version", summary="最新版本信息")
def latest_version():
    """前端启动时（以及手动点「检查更新」时）调一次，自己比较版本号决定要不要提示。"""
    return read_version()


# ── 管理端：发布新版本 ──────────────────────────────────────

class PublishVersionBody(BaseModel):
    latest_version: str = Field(
        ..., pattern=r"^\d+\.\d+\.\d+$", description="新版本号，格式 主.次.修订（如 1.1.0），不要带 v 前缀"
    )
    notes: list[str] = Field(default_factory=list, description="更新说明，逐条")
    download_url: str = Field("", description="安装包 / 下载页地址；网页版留空")
    force: bool = Field(False, description="true = 强制更新（考生必须更新才能继续用）")


@admin_router.get("/version", summary="当前线上版本（后台版本发布页用）")
def admin_current_version(admin: dict = Depends(get_current_admin)):
    """后台展示用：当前 version.json 的内容 + 此刻在线的考生数。"""
    return {
        "version": read_version(),
        "online_users": realtime.online_user_count(),
        "realtime_enabled": realtime.enabled(),
    }


@admin_router.post("/version", summary="发布新版本（写文件 + 实时推送）")
def publish_version(body: PublishVersionBody, admin: dict = Depends(get_current_admin)):
    """把新版本写进 data/version.json，并立刻推给所有在线考生。

    版本号允许回退（比如发错版本要改回去），但前端只在「服务端版本 > 本地版本」时才提示，
    所以把版本号改小不会有任何提示 —— 这是符合直觉的行为，不用额外拦截。
    """
    version_data = {
        "latest_version": body.latest_version.strip(),
        "published_at": date.today().isoformat(),
        "notes": [n.strip() for n in body.notes if n.strip()],
        "download_url": body.download_url.strip(),
        "force": bool(body.force),
    }

    try:
        VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
        VERSION_FILE.write_text(
            json.dumps(version_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"写入 version.json 失败：{exc}")

    online = realtime.online_user_count()
    realtime.publish_all(realtime.EVENT_UPDATE, version_data)

    return {
        "ok": True,
        "version": version_data,
        "online_users": online,
        "message": (
            f"已发布 {version_data['latest_version']}，"
            + (f"{online} 位在线考生已收到更新提示" if online else "当前没有在线考生，下次打开即提示")
        ),
    }


# ── 后台任务：盯住 version.json 的变更 ──────────────────────

def _fingerprint() -> tuple:
    """版本文件指纹：修改时间（纳秒）+ 大小。文件不存在返回 None。"""
    try:
        stat = VERSION_FILE.stat()
    except OSError:
        return None
    return (stat.st_mtime_ns, stat.st_size)


async def watch_version_file() -> None:
    """常驻协程：version.json 一变就推给所有在线考生（由 main.py 的 lifespan 启动）。

    为什么还要盯文件：实际发布可能直接改文件、或用 git 拉新代码，未必走后台接口。
    两种情况都不会重复打扰考生 —— 前端对「同一个版本号」只提示一次。
    本协程出错绝不退出（否则一次磁盘抖动就永久失去推送能力），只在控制台留一行日志。
    """
    last = _fingerprint()
    while True:
        try:
            await asyncio.sleep(WATCH_INTERVAL_SECONDS)
            current = _fingerprint()
            if current != last:
                last = current
                data = read_version()
                realtime.publish_all(realtime.EVENT_UPDATE, data)
                print(f"[app/version] 检测到版本文件变更，已推送 {data['latest_version']} 给在线考生")
        except asyncio.CancelledError:
            raise  # 服务关闭：正常退出，不要吞掉
        except Exception as exc:
            print(f"[app/version] 版本文件监听出错（已忽略，下一轮继续）：{exc}")
