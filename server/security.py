"""
安全模块 —— 密码哈希与登录令牌。

职责：
  1. hash_password / verify_password：密码只存哈希，永不存明文
     （PBKDF2-HMAC-SHA256 + 随机盐，只用 Python 标准库，不引入额外依赖）
  2. new_token：生成登录令牌
  3. new_random_password：生成随机登录密码（管理员重置考生密码时用）
  4. 令牌的存取在 database.py 的 sessions 表，不在本文件

修改注意：
  - 想换哈希算法（如 bcrypt）只需改本文件的两个函数，调用方不用动
  - 存储格式：pbkdf2_sha256$迭代次数$盐$哈希，改格式必须同时兼容旧数据
"""

import hashlib
import hmac
import secrets

from config import config

ALGORITHM = "pbkdf2_sha256"


def _iterations() -> int:
    return int(config["security"]["pbkdf2_iterations"])


def hash_password(password: str) -> str:
    """把明文密码变成可安全存储的字符串。"""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _iterations())
    return f"{ALGORITHM}${_iterations()}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    """校验明文密码是否匹配已存储的哈希。stored 为空（如考生未设密码）时返回 False。"""
    if not stored:
        return False
    try:
        algorithm, iterations, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if algorithm != ALGORITHM:
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
    )
    # 用 compare_digest 做定长比较，避免时序侧信道
    return hmac.compare_digest(digest.hex(), digest_hex)


def new_token() -> str:
    """生成一个 43 字符左右的随机会话令牌。"""
    return secrets.token_urlsafe(32)


def new_sms_code(length: int = 6) -> str:
    """生成短信验证码（纯数字，首位不为 0）。"""
    first = str(secrets.randbelow(9) + 1)  # 1–9，保证首位不是 0
    rest = "".join(str(secrets.randbelow(10)) for _ in range(length - 1))
    return first + rest


# 图形验证码字符集：去掉易混淆的 0 / O / 1 / I / L
CAPTCHA_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def new_captcha_code(length: int = 4) -> str:
    """生成图形验证码文本（大写字母 + 数字）。校验时统一忽略大小写。"""
    return "".join(secrets.choice(CAPTCHA_CHARS) for _ in range(max(3, length)))


# 随机密码字符集：去掉易混淆字符，方便管理员口头/短信转达给考生
PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def new_random_password(length: int = 8) -> str:
    """生成随机登录密码（管理员重置考生密码时用）。"""
    return "".join(secrets.choice(PASSWORD_CHARS) for _ in range(max(6, length)))
