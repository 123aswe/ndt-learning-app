"""
短信验证码模块 —— 发送与校验。

两种模式（由 config.sms 的凭证是否填全自动决定）：
  tencent  腾讯云短信真发（需要 SecretId/SecretKey/SdkAppId/签名/模板 五项齐全）
  local    本地降级：验证码只存库 + 打印到服务端控制台，可在管理后台「验证码调试」页查看
           —— 用途是「凭证还没申请下来时先把整条流程跑通」，不是给生产用的

风控规则（参数见 config.json 的 sms 段）：
  - 同一手机号两次发送间隔 >= resend_interval_seconds（默认 60 秒）
  - 同一手机号每日发送上限 daily_limit_per_phone（默认 10 条）
  - 验证码有效期 code_ttl_seconds（默认 5 分钟），一次性使用
  - 同一验证码最多允许校验错误 max_verify_attempts 次（默认 5 次）

修改注意：
  - 要换短信服务商（阿里云等）只需改 _send_via_tencent() 为对应实现，其余逻辑不动
  - 模板参数顺序必须与腾讯云控制台里模板的 {1} {2} 顺序一致（本项目：{1}=验证码 {2}=有效分钟数）
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query

from config import config, sms_mode, sms_ready
from database import get_conn, is_expired, now_iso, row_to_dict
from deps import get_current_admin
from security import new_sms_code

# ── 腾讯云 SDK 是可选依赖：没装也不影响服务启动（走本地模式） ──
try:
    from tencentcloud.common import credential
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.sms.v20210111 import models as sms_models
    from tencentcloud.sms.v20210111 import sms_client

    _TENCENT_SDK_OK = True
except Exception:  # pragma: no cover - 只取决于是否安装了 SDK
    _TENCENT_SDK_OK = False


class SmsError(Exception):
    """短信发送/校验失败，message 直接面向用户展示。"""


def _settings() -> dict:
    return config["sms"]


# ── 腾讯云发送实现 ──────────────────────────────────────────

def _send_via_tencent(phone: str, code: str) -> str:
    """
    调用腾讯云短信 API 发送验证码，返回发送结果说明；失败抛 SmsError。
    换服务商时只改这个函数即可。
    """
    if not _TENCENT_SDK_OK:
        raise SmsError(
            "未安装腾讯云短信 SDK。请执行 pip install -r requirements.txt，"
            "或清空 config.json 中的短信凭证以使用本地调试模式"
        )

    sms = _settings()
    ttl_minutes = max(1, int(sms["code_ttl_seconds"]) // 60)

    try:
        cred = credential.Credential(sms["secret_id"], sms["secret_key"])
        http_profile = HttpProfile()
        http_profile.endpoint = "sms.tencentcloudapi.com"
        client_profile = ClientProfile()
        client_profile.httpProfile = http_profile
        client = sms_client.SmsClient(cred, sms["region"], client_profile)

        request = sms_models.SendSmsRequest()
        request.SmsSdkAppId = str(sms["sdk_app_id"])
        request.SignName = str(sms["sign_name"])
        request.TemplateId = str(sms["template_id"])
        # 模板参数顺序需与控制台模板里的 {1} {2} 一致
        request.TemplateParamSet = [code, str(ttl_minutes)]
        request.PhoneNumberSet = [f"+86{phone}"]

        response = client.SendSms(request)
    except SmsError:
        raise
    except Exception as exc:
        raise SmsError(f"调用腾讯云短信失败：{exc}") from exc

    status = (getattr(response, "SendStatusSet", None) or [None])[0]
    if status is None:
        raise SmsError("腾讯云未返回发送结果")
    if getattr(status, "Code", "") != "Ok":
        raise SmsError(
            f"腾讯云返回失败：{getattr(status, 'Code', '')} {getattr(status, 'Message', '')}"
        )
    return f"已通过腾讯云发送（{getattr(status, 'SerialNo', '')}）"


# ── 发送 ────────────────────────────────────────────────────

def send_code(phone: str, purpose: str = "login") -> dict:
    """
    发送验证码。返回 {phone, channel, message, dev_code}。
    dev_code 仅在本地降级模式返回（方便前端/后台直接看到码，真发短信时为 None）。
    """
    sms = _settings()
    with get_conn() as conn:
        # 1) 间隔限制
        last = conn.execute(
            "SELECT created_at FROM sms_codes WHERE phone = ? ORDER BY id DESC LIMIT 1",
            (phone,),
        ).fetchone()
        if last:
            elapsed = (datetime.now() - datetime.strptime(
                last["created_at"], "%Y-%m-%d %H:%M:%S"
            )).total_seconds()
            wait = int(sms["resend_interval_seconds"]) - int(elapsed)
            if wait > 0:
                raise SmsError(f"发送过于频繁，请 {wait} 秒后再试")

        # 2) 每日上限
        today = datetime.now().strftime("%Y-%m-%d")
        today_count = conn.execute(
            "SELECT COUNT(*) AS n FROM sms_codes WHERE phone = ? AND created_at LIKE ?",
            (phone, f"{today}%"),
        ).fetchone()["n"]
        if today_count >= int(sms["daily_limit_per_phone"]):
            raise SmsError("今日验证码发送次数已达上限，请明天再试")

        # 3) 生成并落库（先入库，发送结果回填）
        code = new_sms_code()
        expires_at = (
            datetime.now() + timedelta(seconds=int(sms["code_ttl_seconds"]))
        ).strftime("%Y-%m-%d %H:%M:%S")
        channel = sms_mode()
        cursor = conn.execute(
            """INSERT INTO sms_codes
               (phone, code, purpose, channel, send_status, used, fail_count, expires_at, created_at)
               VALUES (?,?,?,?,?,0,0,?,?)""",
            (phone, code, purpose, channel, "待发送", expires_at, now_iso()),
        )
        record_id = cursor.lastrowid

    # 4) 真正发送（在事务外做，避免网络耗时占着数据库连接）
    dev_code = None
    if channel == "tencent":
        try:
            result_text = _send_via_tencent(phone, code)
        except SmsError as exc:
            _update_send_status(record_id, f"发送失败：{exc}")
            raise
        _update_send_status(record_id, result_text)
        message = "验证码已发送，请注意查收短信"
    else:
        dev_code = code
        result_text = "本地调试模式：未调用腾讯云，验证码见服务端控制台/管理后台"
        _update_send_status(record_id, result_text)
        # 控制台显眼打印，方便本地联调
        print("=" * 58)
        print(f"[本地验证码] 手机号 {phone}  用途 {purpose}  验证码 {code}"
              f"（{int(sms['code_ttl_seconds']) // 60} 分钟内有效）")
        print("=" * 58)
        message = "验证码已生成（本地调试模式）"

    return {
        "phone": phone,
        "channel": channel,
        "message": message,
        "dev_code": dev_code,
    }


def _update_send_status(record_id: int, text: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE sms_codes SET send_status = ? WHERE id = ?", (text, record_id))


# ── 校验 ────────────────────────────────────────────────────

def verify_code(phone: str, code: str, purpose: str = "login") -> None:
    """校验验证码，成功则标记为已使用；失败抛 SmsError。"""
    sms = _settings()
    code = (code or "").strip()

    with get_conn() as conn:
        row = conn.execute(
            """SELECT * FROM sms_codes
               WHERE phone = ? AND purpose = ? AND used = 0
               ORDER BY id DESC LIMIT 1""",
            (phone, purpose),
        ).fetchone()
        record = row_to_dict(row)

        if not record:
            raise SmsError("请先获取验证码")
        if is_expired(record["expires_at"]):
            raise SmsError("验证码已过期，请重新获取")
        if record["fail_count"] >= int(sms["max_verify_attempts"]):
            conn.execute("UPDATE sms_codes SET used = 1 WHERE id = ?", (record["id"],))
            raise SmsError("验证码错误次数过多，请重新获取")

        if record["code"] != code:
            conn.execute(
                "UPDATE sms_codes SET fail_count = fail_count + 1 WHERE id = ?",
                (record["id"],),
            )
            left = int(sms["max_verify_attempts"]) - record["fail_count"] - 1
            raise SmsError("验证码错误" + (f"，还可尝试 {left} 次" if left > 0 else ""))

        # 成功：一次性使用
        conn.execute("UPDATE sms_codes SET used = 1 WHERE id = ?", (record["id"],))


# ── 管理后台：查看最近验证码（本地调试模式下特别有用） ──

def list_recent_codes(limit: int = 50, phone: str = "") -> list[dict]:
    limit = max(1, min(int(limit), 200))
    sql = "SELECT * FROM sms_codes"
    params: list = []
    if phone:
        sql += " WHERE phone LIKE ?"
        params.append(f"%{phone}%")
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


# ── 管理后台：验证码调试接口 ────────────────────────────────

router = APIRouter(prefix="/api/admin", tags=["验证码调试"])


@router.get("/sms-codes", summary="最近的验证码记录（本地调试模式必备）")
def recent_codes(
    limit: int = Query(50, ge=1, le=200),
    phone: str = Query("", description="按手机号模糊筛选"),
    admin: dict = Depends(get_current_admin),
):
    """
    查看最近的验证码发送记录。
    未配置腾讯云凭证时（本地调试模式），这里能直接看到验证码明文，方便先把登录流程跑通。
    """
    return {
        "mode": sms_mode(),
        "ready": sms_ready(),
        "items": list_recent_codes(limit, phone),
    }
