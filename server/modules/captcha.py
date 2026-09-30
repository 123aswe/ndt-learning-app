"""
图形验证码模块 —— 注册页的人机校验。

无第三方依赖：服务端直接生成 SVG 图片（干扰线 + 干扰点 + 字符随机旋转），
前端把返回的 base64 直接塞进 <img src> 即可。

接口：
  GET /api/auth/captcha     生成一张新验证码 → {captcha_id, image, ttl_seconds}

风控：
  - 有效期 captcha.ttl_seconds（默认 5 分钟）
  - 一次性：校验通过即作废；过期或已用不可再用
  - 校验忽略大小写

修改注意：
  - 本模块只做「生成 + 校验」，不涉及注册业务（那在 registrations.py）
  - 想换成接第三方图形验证码服务，只需改 generate() 与 verify()
"""

import base64
import random
import secrets
from datetime import datetime, timedelta
from xml.sax.saxutils import escape

from fastapi import APIRouter

from config import config
from database import get_conn, is_expired, now_iso
from security import new_captcha_code

router = APIRouter(prefix="/api/auth", tags=["图形验证码"])


class CaptchaError(Exception):
    """图形验证码校验失败；message 直接面向用户展示。"""


def _build_svg(code: str) -> str:
    """把验证码文本画成一张 SVG 图片（120×44）。"""
    width, height = 120, 44
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="#eef2f7"/>',
    ]

    # 干扰线
    for _ in range(5):
        x1, y1 = random.randint(0, width), random.randint(0, height)
        x2, y2 = random.randint(0, width), random.randint(0, height)
        color = random.choice(["#94a3b8", "#a5b4c8", "#b6c2d1"])
        parts.append(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
            f'stroke="{color}" stroke-width="1.2" opacity="0.7"/>'
        )

    # 干扰点
    for _ in range(26):
        cx, cy = random.randint(0, width), random.randint(0, height)
        color = random.choice(["#94a3b8", "#a5b4c8", "#cbd5e1"])
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="1" fill="{color}" opacity="0.7"/>')

    # 字符：等间距分布，各自随机旋转 / 上下偏移 / 字号 / 颜色
    step = width / (len(code) + 1)
    for index, char in enumerate(code):
        cx = step * (index + 1)
        cy = height / 2 + random.randint(-4, 4)
        rotate = random.randint(-26, 26)
        size = random.randint(22, 27)
        color = random.choice(["#0f172a", "#1e293b", "#0f766e", "#155e75", "#3f3f46"])
        parts.append(
            f'<text x="{cx:.1f}" y="{cy:.1f}" font-size="{size}" font-family="Georgia,serif" '
            f'font-weight="700" fill="{color}" text-anchor="middle" dominant-baseline="middle" '
            f'transform="rotate({rotate} {cx:.1f} {cy:.1f})">{escape(char)}</text>'
        )

    parts.append("</svg>")
    return "".join(parts)


def generate() -> dict:
    """生成一张新验证码并落库，返回 {captcha_id, image, ttl_seconds}。"""
    cfg = config["captcha"]
    ttl = int(cfg["ttl_seconds"])
    code = new_captcha_code(int(cfg["length"]))
    captcha_id = secrets.token_urlsafe(18)
    expires_at = (datetime.now() + timedelta(seconds=ttl)).strftime("%Y-%m-%d %H:%M:%S")

    with get_conn() as conn:
        conn.execute(
            "INSERT INTO captchas (id, code, used, expires_at, created_at) VALUES (?,?,0,?,?)",
            (captcha_id, code, expires_at, now_iso()),
        )

    svg = _build_svg(code)
    image = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return {"captcha_id": captcha_id, "image": image, "ttl_seconds": ttl}


def verify(captcha_id: str, code: str) -> None:
    """校验图形验证码；成功即作废，失败抛 CaptchaError。"""
    captcha_id = (captcha_id or "").strip()
    code = (code or "").strip().upper()

    if not captcha_id:
        raise CaptchaError("请输入图形验证码")

    with get_conn() as conn:
        row = conn.execute("SELECT * FROM captchas WHERE id = ?", (captcha_id,)).fetchone()
        record = dict(row) if row else None

        if not record or record["used"]:
            raise CaptchaError("图形验证码无效，请点击图片刷新后重试")
        if is_expired(record["expires_at"]):
            raise CaptchaError("图形验证码已过期，请点击图片刷新后重试")
        if record["code"].upper() != code:
            raise CaptchaError("图形验证码错误，请重新输入")

        conn.execute("UPDATE captchas SET used = 1 WHERE id = ?", (captcha_id,))


@router.get("/captcha", summary="生成图形验证码")
def new_captcha() -> dict:
    """返回一张新的图形验证码；前端把 image 直接用于 <img src>。"""
    return generate()
