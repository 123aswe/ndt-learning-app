"""
配置模块 —— 全项目唯一的配置来源。

职责：
  1. 定义所有配置项的默认值（DEFAULTS）
  2. 若同目录存在 config.json，用它的内容覆盖默认值（支持部分覆盖，不用全写）
  3. 对外暴露一个 config 对象，以及 sms_ready() 判断腾讯云短信是否已配置齐全

修改注意：
  - 新增配置项 → 先加进 DEFAULTS，再在 config.example.json 里补上同样的键
  - 不要在本文件写死任何密钥；密钥一律来自 config.json
"""

import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"


# ── 默认配置（不含任何密钥） ──────────────────────────────────────
DEFAULTS: dict = {
    "server": {
        # host 固定 0.0.0.0：本机/局域网/公网隧道共用一个监听，
        # 「谁能访问」由 lan_access.enabled 控制（main.py 的 lan_guard 中间件）——
        # 关（默认）= 只有本机能访问，行为与旧版只监听 127.0.0.1 完全一致
        "host": "0.0.0.0",
        "port": 8000,
    },
    "lan_access": {
        # 局域网访问开关：false 时非本机请求一律 403；管理后台「网络访问」卡片可开关，
        # 开关状态写回本文件（modules/network.py）
        "enabled": False,
    },
    "database": {
        "path": "data/app.db",
    },
    "security": {
        # 令牌有效期（小时）：360 = 15 天。有效期内每访问一次自动续期（见 deps._renew_session），
        # 所以实际效果是「15 天不登录才需要重新登录」；改成 24 就是「一天不登录就得重登」
        "token_ttl_hours": 360,
        "pbkdf2_iterations": 200_000,
    },
    "captcha": {
        # 注册时使用的图形验证码（纯服务端 SVG 生成，无第三方依赖）
        "ttl_seconds": 300,  # 有效期（秒）
        "length": 4,         # 字符数
    },
    "sms": {
        # 腾讯云短信五项凭证：全部填好才会真正发短信
        "secret_id": "",
        "secret_key": "",
        "sdk_app_id": "",
        "sign_name": "",     # 需审核通过的签名，填写时不含【】
        "template_id": "",   # 需审核通过的模板 ID
        "region": "ap-guangzhou",
        # 验证码风控参数
        "code_ttl_seconds": 300,        # 验证码有效期（秒）
        "resend_interval_seconds": 60,  # 同一手机号两次发送的最小间隔（秒）
        "daily_limit_per_phone": 10,    # 同一手机号每日最多发送次数
        "max_verify_attempts": 5,       # 同一验证码最多允许校验错误次数
    },
    "realtime": {
        # 实时通道（SSE）：通知 / 评论回复 / 版本更新 写库后立刻推给在线考生，
        # 不再等前端每 30 秒轮询一次。关掉它前端会自动退回轮询，功能不受影响。
        "enabled": True,
        "heartbeat_seconds": 15,  # 空闲心跳间隔，防止代理掐掉长连接
    },
    "ai": {
        # AI 智能助手（modules/ai.py）：题目 AI 解析 + 视频 AI 概括，走智谱开放平台
        # （BigModel / GLM，接口是 OpenAI 兼容的 /chat/completions）。
        # api_key 为空时 AI 相关按钮会提示「未配置」，其余功能不受影响。
        "api_key": "",                       # 智谱 API Key（形如 xxxxxxxx.yyyyyyyy，密钥只放这里，不要进前端）
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "chat_model": "glm-4-flash",         # 纯文本模型：题目解析、无画面的视频概括
        "vision_model": "glm-4v-flash",      # 视觉模型：视频抽帧后看图概括
        "timeout_seconds": 120,              # 单次生成超时（秒）
        "video_frames": 6,                   # 视频概括抽取的关键帧数量（1~8，越多越慢越贵）
    },
    "frontend_origins": [
        "http://localhost:8443",
        "http://127.0.0.1:8443",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
}


def _deep_merge(base: dict, override: dict) -> dict:
    """递归合并：override 覆盖 base，未出现的键保持 base 的值。"""
    result = dict(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _load() -> dict:
    if not CONFIG_PATH.exists():
        return dict(DEFAULTS)
    try:
        user_config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # 配置写坏时不要拖垮服务，退回默认值并明确提示
        print(f"[config] config.json 解析失败，已退回默认配置：{exc}")
        return dict(DEFAULTS)
    return _deep_merge(DEFAULTS, user_config)


config: dict = _load()

# 把数据库相对路径解析成绝对路径（相对 server/ 目录）
_db_path = Path(config["database"]["path"])
if not _db_path.is_absolute():
    _db_path = BASE_DIR / _db_path
DB_PATH: Path = _db_path


def sms_ready() -> bool:
    """腾讯云短信是否已配置齐全（五项凭证都不为空）。"""
    sms = config["sms"]
    return all(
        str(sms.get(key, "")).strip()
        for key in ("secret_id", "secret_key", "sdk_app_id", "sign_name", "template_id")
    )


def sms_mode() -> str:
    """当前短信模式：tencent（真发） / local（本地调试）。"""
    return "tencent" if sms_ready() else "local"


def ai_ready() -> bool:
    """AI 智能助手是否已配置（智谱 API Key 非空）。未配置时相关接口返回友好提示。"""
    return bool(str(config["ai"].get("api_key", "")).strip())
