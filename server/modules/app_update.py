"""
版本更新模块 —— 前端「检查更新」用的公开接口。

接口（前缀 /api/app）：
  GET /version   返回最新版本信息（无需登录）

版本信息来源：
  1. server/data/version.json（存在则用，改版本不用改代码、不用重启逻辑）
  2. 文件不存在 / 解析失败 → 用本文件 DEFAULT_VERSION 兜底

version.json 字段（全部可选，缺省用 DEFAULT_VERSION 的值）：
  {
    "latest_version": "1.1.0",          # 最新版本号，与前端 src/data/appVersion.ts 的 APP_VERSION 比较
    "published_at": "2026-10-01",        # 发布时间
    "notes": ["修复…", "新增…"],          # 更新说明（逐条）
    "download_url": "https://…",         # 更新包 / 下载页地址（前端「前往更新」按钮打开）
    "force": false                        # true = 强制更新提示
  }

修改注意：
  - 这里只「告知」版本，不做真正的热更新；发布流程见 .modular/backend.md「版本与更新」
  - 版本号比较规则（x.y.z 逐段数值比较）在前端 src/data/appVersion.ts，后端不参与判断
"""

import json

from fastapi import APIRouter

from config import BASE_DIR

router = APIRouter(prefix="/api/app", tags=["版本更新"])

VERSION_FILE = BASE_DIR / "data" / "version.json"

DEFAULT_VERSION: dict = {
    "latest_version": "1.0.0",
    "published_at": "2026-09-29",
    "notes": ["首个版本：题库练习、错题本、学习记录、个人资料与设置"],
    "download_url": "",
    "force": False,
}


@router.get("/version", summary="最新版本信息")
def latest_version():
    """读 data/version.json；读不到就用兜底常量。永远返回 200，前端只负责比较版本号。"""
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
