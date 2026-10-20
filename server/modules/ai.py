"""
AI 智能助手模块 —— 对接智谱开放平台（BigModel / GLM），给考生端加两个能力：

  1. 题目 AI 解析：拿题干 / 选项 / 标准答案让大模型讲清楚「为什么」，
     补上 CSV 题库本身没有解析字段的短板（考生端练习页解析面板里点「AI 解析」）
  2. 计算题 AI 解答过程：计算题（无选项）的「题目原题讲解」如果管理员没在题库里配，
     就由大模型**分步算出答案**（考生端练习页答完后点开「题目原题讲解」时生成）
  3. 视频 AI 概括：用 ffmpeg 从教学视频里均匀抽几帧关键画面，**拼成一张宫格图**
     再交给视觉模型看图说话（视觉模型单次能接收的图片数量有限，拼图一次只算 1 张），
     生成「讲了什么 / 讲解脉络 / 关键知识点」的 Markdown 概括（考生端视频详情页）

三个设计原则（改之前先读一遍）：

  1. **API Key 只在服务端**。密钥放 config.json 的 ai.api_key，由本模块代调智谱；
     绝不下发到前端（前端能看到的东西等于任何人都能看到）。
  2. **结果落库缓存**（ai_question_explain / ai_question_solution / ai_video_summary）。
     同一道题、同一个视频只让大模型生成一次，之后所有考生复用同一份结果，省时省钱。
     想重新生成：考生端点「重新生成」（refresh=true），或直接删掉对应缓存行。
  3. **流式输出（SSE）**。生成动辄好几秒，一次性返回会让页面一直干等；
     这里按 SSE 把增量文本边生成边推给前端，考生看到的是逐字打出来的效果。

接口一览（均需考生登录，见 deps.get_current_user）：

  GET  /api/ai/status                      AI 是否已配置（前端据此显示「未配置」提示）
  GET  /api/ai/cache/{kind}/{target_id}    只读缓存（不触发生成；kind = question | solution | video）
  POST /api/ai/question-explain            body {question_id, refresh?}   → SSE 流
  POST /api/ai/question-solution           body {question_id, refresh?}   → SSE 流（计算题解答过程）
  POST /api/ai/video-summary               body {material_id, refresh?}   → SSE 流

SSE 帧约定（前端 src/api/client.ts 的 streamAi 负责解析，两边必须一致）：

  event: meta    data: {"cached": bool, "model": "…", "frames": N}   开始
                 （cached=true 表示直接回放缓存；frames 仅视频有，0 = 没抽到画面）
  event: delta   data: {"text": "本次新增的一段文本"}    可反复出现
  event: error   data: {"message": "给考生看的人话"}     出错（终止，不会再发 done）
  event: done    data: {"cached": bool}                 正常结束

错误处理注意：SSE 一旦发出首帧，HTTP 状态码就已经定死成 200 了，
所以智谱那边报错（密钥无效 / 余额不足 / 限流）**不能**靠抛 HTTPException，
必须包成 error 帧在流里发出去，否则前端只会看到连接莫名其妙断掉。
"""

import base64
import json
import os
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import ai_ready, config
from database import get_conn, now_iso, row_to_dict
from deps import get_current_user
from modules.upload_utils import UPLOAD_DIR

router = APIRouter(prefix="/api/ai", tags=["AI 智能助手"])

# 题型中文名（与 modules/bank.py 的 QTYPE_NAMES 保持一致，这里只用于拼提示词）
_QTYPE_NAMES = {
    "judge": "判断题",
    "single": "选择题",
    "multi": "多选题",
    "calc": "计算题",
    "calcsel": "计算选择题",
    "short": "简答题",
}

_SSE_HEADERS = {
    "Cache-Control": "no-store",
    # 关掉 Nginx / 中间层的响应缓冲，否则流会被攒成一坨再吐出来，失去逐字效果
    "X-Accel-Buffering": "no",
}

# 视觉模型单次请求能接受的图片张数上限（智谱 glm-4v-flash 实测为 5，超过报错 1210）。
# 只在「宫格拼图失败、不得不逐张发送」时用作兜底上限。
_VISION_MAX_IMAGES = 5


# ── 智谱调用 ────────────────────────────────────────────────

class _AiError(Exception):
    """给考生看的人话错误（不暴露内网细节 / 原始堆栈）。"""


def _ai_conf() -> dict:
    return config["ai"]


def _map_http_error(status: int, raw: str) -> str:
    """智谱返回的英文错误码 → 考生能看懂的中文提示。"""
    if status == 401:
        return "AI 服务密钥无效或已过期，请联系管理员更新服务端的 ai.api_key"
    if status == 429:
        return "AI 调用太频繁了，请稍后再试"
    if status in (402, 403):
        return "AI 账户额度不足或无权调用该模型，请联系管理员"
    if status == 400 and "model" in raw.lower():
        return "AI 模型名不可用，请联系管理员检查 ai.chat_model / ai.vision_model 配置"
    if status == 400 and "1210" in raw:
        return "一次送出的画面太多，AI 看不完，请稍后重试"
    return f"AI 服务返回错误（{status}）"


def _iter_chat_deltas(model: str, messages: list, timeout: int):
    """调用智谱 /chat/completions 并逐段吐出增量文本（生成器）。

    用标准库 urllib 而不是第三方 SDK：项目只跑在本机 / 小服务器上，
    没必要为一次 HTTP 调用再装一个包（requirements.txt 保持精简）。
    """
    conf = _ai_conf()
    url = conf["base_url"].rstrip("/") + "/chat/completions"
    payload = json.dumps(
        {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": 0.5,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": "Bearer " + str(conf["api_key"]).strip(),
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raw = ""
        try:
            raw = exc.read().decode("utf-8", "ignore")
        except Exception:
            pass
        raise _AiError(_map_http_error(exc.code, raw)) from exc
    except Exception as exc:  # 网络不通 / 超时
        raise _AiError("无法连接 AI 服务，请检查服务器网络") from exc

    try:
        for raw_line in resp:
            line = raw_line.decode("utf-8", "ignore").strip()
            if not line or line.startswith(":"):
                continue  # 空行 / 注释帧（心跳）
            if not line.startswith("data:"):
                continue
            chunk = line[5:].strip()
            if chunk == "[DONE]":
                break
            try:
                obj = json.loads(chunk)
            except json.JSONDecodeError:
                continue
            choices = obj.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            piece = delta.get("content")
            if piece:
                yield piece
    finally:
        try:
            resp.close()
        except Exception:
            pass


# ── 提示词 ──────────────────────────────────────────────────

_EXPLAIN_SYSTEM = (
    "你是无损检测（NDT）一级资格考试的资深辅导老师。"
    "讲解要准确、通俗、抓住考点，不说废话，不编造标准号与数据。"
)


def _options_text(options_json: str) -> str:
    try:
        options = json.loads(options_json or "[]")
    except Exception:
        options = []
    return "\n".join(f"{o.get('key', '?')}. {o.get('text', '')}" for o in options)


def _build_explain_messages(q: dict) -> list:
    qtype = _QTYPE_NAMES.get(q.get("qtype", ""), "题目")
    lines = [
        f"【科目方向】{q.get('method', '')}",
        f"【题型】{qtype}",
    ]
    if q.get("topic1"):
        lines.append(f"【知识点】{q['topic1']}" + (f" · {q['topic2']}" if q.get("topic2") else ""))
    lines.append(f"【题干】{q.get('content', '')}")
    opts = _options_text(q.get("options_json", ""))
    if opts:
        lines.append("【选项】\n" + opts)
    lines.append(f"【标准答案】{q.get('answer', '')}")
    lines.append(
        "\n请针对这道题写一段解析，帮助考生真正理解。要求：\n"
        "1. 先用一句 **正确选项的依据** 点明考点；\n"
        "2. 用「逐项分析」说明每个选项为什么对 / 为什么错（简答题改为讲清答题要点）；\n"
        "3. 最后给「易错点」或「记忆口诀」1~2 条。\n"
        "格式要求：用 Markdown，小标题用 **加粗**（不要用 # 号），分点用 - 列表；"
        "总字数控制在 400 字以内，直接输出解析正文，不要任何寒暄或开场白。"
    )
    return [
        {"role": "system", "content": _EXPLAIN_SYSTEM},
        {"role": "user", "content": "\n".join(lines)},
    ]


_SOLUTION_SYSTEM = (
    "你是无损检测（NDT）一级资格考试的资深辅导老师。"
    "你擅长把计算题的解答过程一步一步算给学生看：公式、代入、中间结果、结论都写清楚，"
    "不跳步、不编造标准号与数据。"
)


def _build_solution_messages(q: dict) -> list:
    """拼「计算题解答过程」提示词。

    与 _build_explain_messages 的区别：那份是讲**选项为什么对错**，
    这份是真正把题**从头算一遍**（计算题没有选项，考生要的是解题过程）。
    """
    lines = [
        f"【科目方向】{q.get('method', '')}",
        f"【题型】{_QTYPE_NAMES.get(q.get('qtype', ''), '计算题')}",
    ]
    if q.get("topic1"):
        lines.append(f"【知识点】{q['topic1']}" + (f" · {q['topic2']}" if q.get("topic2") else ""))
    lines.append(f"【题干】{q.get('content', '')}")
    opts = _options_text(q.get("options_json", ""))
    if opts:
        lines.append("【选项】\n" + opts)
    lines.append(f"【标准答案】{q.get('answer', '')}")
    lines.append(
        "\n请写出这道题完整的解答过程（要真正一步步算出答案，不是逐个点评选项）。要求：\n"
        "1. **已知与所求**：一句话说明已知量和要求什么；\n"
        "2. **依据 / 公式**：写出用到的公式或标准依据；\n"
        "3. **代入计算**：分步代入数值并算出中间结果，每一步都写出来，不要跳步；\n"
        "4. **结论**：给出最终答案，并说明与标准答案是否一致。\n"
        "格式要求：用 Markdown，小标题用 **加粗**（不要用 # 号），步骤用 - 列表；"
        "公式写成普通文本（如 HVL = 0.693 / μ），不要用 LaTeX；"
        "总字数控制在 500 字以内，直接输出解答正文，不要任何寒暄或开场白。"
    )
    return [
        {"role": "system", "content": _SOLUTION_SYSTEM},
        {"role": "user", "content": "\n".join(lines)},
    ]


_SUMMARY_SYSTEM = (
    "你是无损检测（NDT）培训课程的内容编辑。"
    "你擅长把一段教学视频概括成考生能快速抓重点的笔记，只写画面与标题里真实存在的信息，不臆造。"
)


def _build_summary_messages(
    m: dict,
    images: list[str],
    total_frames: int = 0,
    grid: tuple[int, int] | None = None,
) -> list:
    """拼「视频概括」提示词。

    images    实际送给视觉模型的图片（0 张 = 纯文字概括；1 张且 grid 非空 = 宫格拼图）
    total_frames  抽取到的关键画面总数（拼图时告诉模型这张图里塞了几帧）
    grid      拼图的 (列数, 行数)，用于说明阅读顺序
    """
    head = [
        f"视频标题：《{m.get('title', '')}》",
    ]
    if m.get("method"):
        head.append(f"检测方向：{m['method']}")
    if m.get("description"):
        head.append(f"管理员填写的简介：{m['description']}")

    if images and grid:
        cols, rows = grid
        head.append(
            f"下面这张图是把从视频里均匀抽取的 {total_frames} 张关键画面拼成的宫格图"
            f"（{cols} 列 × {rows} 行）：**从左到右、从上到下就是视频的时间顺序**，"
            "请按这个顺序理解整段视频。"
        )
    elif images:
        head.append(
            f"下面按时间顺序附上从这段视频里抽取的 {total_frames or len(images)} 张关键画面。"
        )

    if images:
        ask = (
            "\n请综合关键画面与标题，写一份视频内容概括。格式要求（Markdown，简洁，不要客套）：\n"
            "**一句话主题**：xxxx\n"
            "- 讲解脉络：按画面顺序分 3~5 点说明视频讲了什么\n"
            "- 关键知识点：列 2~4 条\n"
            "- 学习建议：1 句\n"
            "注意：**直接从「**一句话主题**」开始写，不要再用 # 标题重复视频标题**；"
            "画面里看不清或没体现的内容不要编造；总字数 350 字以内。"
        )
    else:
        head.append("（本次未能抽取到画面，请仅根据标题与简介概括。）")
        ask = (
            "\n请根据标题与简介写一份视频内容概括。格式（Markdown，简洁）：\n"
            "**一句话主题**：xxxx\n- 预计讲解内容：分 3 点\n- 建议关注：2 条\n"
            "总字数 200 字以内，不要编造具体数据。"
        )

    if images:
        content: list = [{"type": "text", "text": "\n".join(head) + ask}]
        for url in images:
            content.append({"type": "image_url", "image_url": {"url": url}})
    else:
        content = "\n".join(head) + ask

    return [
        {"role": "system", "content": _SUMMARY_SYSTEM},
        {"role": "user", "content": content},
    ]


# ── 视频抽帧（ffmpeg） ──────────────────────────────────────

def _probe_duration(path) -> float:
    """用 ffprobe 读视频总时长（秒）；读不到返回 0。"""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=nw=1:nk=1", str(path),
            ],
            capture_output=True, text=True, timeout=30,
        )
        return float((out.stdout or "").strip())
    except Exception:
        return 0.0


def _extract_frames(path, count: int) -> list[str]:
    """按时间均匀抽 count 张画面，返回 data:image/jpeg;base64,... 列表。

    抽不到（没装 ffmpeg / 文件损坏 / 超时）就返回空列表 —— 调用方会退化成
    「只按标题简介概括」，功能不中断，只是概括质量差一些。
    """
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe") or not os.path.exists(path):
        return []
    duration = _probe_duration(path)
    if duration <= 0:
        return []

    count = max(1, min(int(count or 6), 8))
    # 取每段的中间时刻，避开片头片尾的黑场 / 片尾字幕
    stamps = [duration * (i + 0.5) / count for i in range(count)]

    frames: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        for idx, stamp in enumerate(stamps):
            out = os.path.join(tmp, f"f{idx}.jpg")
            try:
                subprocess.run(
                    [
                        "ffmpeg", "-v", "error", "-y",
                        "-ss", f"{stamp:.2f}",          # 放在 -i 前 = 关键帧快速定位
                        "-i", str(path),
                        "-frames:v", "1",
                        "-vf", "scale=480:-2",           # 宽度压到 480，够模型看清又不至于太大
                        "-q:v", "5",
                        out,
                    ],
                    capture_output=True, timeout=40,
                )
            except Exception:
                continue
            if os.path.exists(out) and os.path.getsize(out) > 0:
                with open(out, "rb") as fh:
                    frames.append("data:image/jpeg;base64," + base64.b64encode(fh.read()).decode())
    return frames


# ⚠️ 智谱 glm-4v-flash 单次请求最多只接受 5 张图，超过直接 400
#    「输入图片数量超过限制」（错误码 1210）。画面多于 1 张时一律拼成宫格图，
#    一次只送 1 张 —— 既绕开上限，又省 token（多图比拼图贵得多）。
def _contact_sheet(frames: list[str], cols: int = 0) -> tuple[str, int, int] | None:
    """把多张关键帧拼成一张宫格图。

    返回 (data_url, cols, rows)；拼不出来返回 None（调用方退回逐张发送）。
    """
    n = len(frames)
    if n < 2 or not shutil.which("ffmpeg"):
        return None
    if cols <= 0:  # 默认取「接近正方形」的列数：6 帧 → 3×2，4 帧 → 2×2
        cols = max(1, int(n ** 0.5 + 0.999))
    cols = min(cols, n)
    rows = (n + cols - 1) // cols

    try:
        with tempfile.TemporaryDirectory() as tmp:
            for idx, url in enumerate(frames):
                b64 = url.split(",", 1)[1] if "," in url else url
                with open(os.path.join(tmp, f"f{idx:02d}.jpg"), "wb") as fh:
                    fh.write(base64.b64decode(b64))
            sheet = os.path.join(tmp, "sheet.jpg")
            subprocess.run(
                [
                    "ffmpeg", "-v", "error", "-y",
                    "-start_number", "0",
                    "-i", os.path.join(tmp, "f%02d.jpg"),
                    "-vf", f"tile={cols}x{rows}:padding=6:color=black",
                    "-frames:v", "1",
                    "-q:v", "4",
                    sheet,
                ],
                capture_output=True, timeout=60,
            )
            if not (os.path.exists(sheet) and os.path.getsize(sheet) > 0):
                return None
            with open(sheet, "rb") as fh:
                data = "data:image/jpeg;base64," + base64.b64encode(fh.read()).decode()
            return data, cols, rows
    except Exception:
        return None


# ── SSE 辅助 ────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sse_response(gen) -> StreamingResponse:
    return StreamingResponse(gen, media_type="text/event-stream", headers=_SSE_HEADERS)


# ── 只读接口 ────────────────────────────────────────────────

@router.get("/status", summary="AI 助手状态（是否已配置、当前模型、能否抽帧）")
def ai_status(user: dict = Depends(get_current_user)):
    conf = _ai_conf()
    return {
        "configured": ai_ready(),
        "chat_model": conf.get("chat_model", ""),
        "vision_model": conf.get("vision_model", ""),
        # 没装 ffmpeg 时视频概括退化为「按标题简介概括」，前端据此提示
        "can_extract_frames": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")),
        "video_frames": int(conf.get("video_frames", 6) or 6),
    }


@router.get("/cache/{kind}/{target_id}", summary="只读 AI 缓存（不触发模型生成）")
def ai_cache(kind: str, target_id: int, user: dict = Depends(get_current_user)):
    """前端进页面时先看有没有缓存：有就直接展示，不再花时间 / 花钱生成。"""
    table = {
        "question": "ai_question_explain",
        "solution": "ai_question_solution",
        "video": "ai_video_summary",
    }.get(kind)
    if not table:
        raise HTTPException(status_code=400, detail="kind 只能是 question / solution / video")
    column = "material_id" if kind == "video" else "question_id"
    with get_conn() as conn:
        row = row_to_dict(
            conn.execute(f"SELECT * FROM {table} WHERE {column} = ?", (target_id,)).fetchone()
        )
    if not row:
        return {"content": "", "model": "", "created_at": ""}
    return {"content": row["content"], "model": row["model"], "created_at": row["created_at"]}


# ── 题目 AI 解析 ────────────────────────────────────────────

class _QuestionBody(BaseModel):
    question_id: int
    refresh: bool = False


def _explain_stream(question_id: int, refresh: bool):
    try:
        with get_conn() as conn:
            q = row_to_dict(conn.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone())
            cached = row_to_dict(
                conn.execute("SELECT * FROM ai_question_explain WHERE question_id = ?", (question_id,)).fetchone()
            )
        if not q:
            yield _sse("error", {"message": "题目不存在或已被删除"})
            return

        conf = _ai_conf()
        if cached and cached["content"] and not refresh:
            yield _sse("meta", {"cached": True, "model": cached["model"]})
            yield _sse("delta", {"text": cached["content"]})
            yield _sse("done", {"cached": True})
            return

        if not ai_ready():
            yield _sse("error", {"message": "AI 服务尚未配置，请联系管理员在服务端填写 ai.api_key"})
            return

        model = str(conf.get("chat_model") or "glm-4-flash")
        yield _sse("meta", {"cached": False, "model": model})

        parts: list[str] = []
        for piece in _iter_chat_deltas(model, _build_explain_messages(q), int(conf.get("timeout_seconds", 120))):
            parts.append(piece)
            yield _sse("delta", {"text": piece})

        text = "".join(parts).strip()
        if text:
            with get_conn() as conn:
                conn.execute(
                    """INSERT INTO ai_question_explain (question_id, content, model, created_at)
                       VALUES (?,?,?,?)
                       ON CONFLICT(question_id) DO UPDATE SET
                         content = excluded.content,
                         model   = excluded.model,
                         created_at = excluded.created_at""",
                    (question_id, text, model, now_iso()),
                )
        yield _sse("done", {"cached": False})
    except _AiError as exc:
        yield _sse("error", {"message": str(exc)})
    except GeneratorExit:  # 考生中途关页面，正常收摊
        raise
    except Exception as exc:  # 兜底：别让异常穿透成 500（那时流已经开始了）
        yield _sse("error", {"message": f"AI 生成失败：{exc}"})


@router.post("/question-explain", summary="AI 题目解析（SSE 流式）")
def question_explain(body: _QuestionBody, user: dict = Depends(get_current_user)):
    return _sse_response(_explain_stream(body.question_id, body.refresh))


# ── 计算题 AI 解答过程 ──────────────────────────────────────
# 用在考生端「题目原题讲解」：题库里配了 explanation 就直接显示题库内容，
# 没配才调这里让 AI 分步算一遍（前端在 AI 正文后面固定加一句「AI 仅供参考」）。

def _solution_stream(question_id: int, refresh: bool):
    try:
        with get_conn() as conn:
            q = row_to_dict(conn.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone())
            cached = row_to_dict(
                conn.execute("SELECT * FROM ai_question_solution WHERE question_id = ?", (question_id,)).fetchone()
            )
        if not q:
            yield _sse("error", {"message": "题目不存在或已被删除"})
            return

        conf = _ai_conf()
        if cached and cached["content"] and not refresh:
            yield _sse("meta", {"cached": True, "model": cached["model"]})
            yield _sse("delta", {"text": cached["content"]})
            yield _sse("done", {"cached": True})
            return

        if not ai_ready():
            yield _sse("error", {"message": "AI 服务尚未配置，请联系管理员在服务端填写 ai.api_key"})
            return

        model = str(conf.get("chat_model") or "glm-4-flash")
        yield _sse("meta", {"cached": False, "model": model})

        parts: list[str] = []
        for piece in _iter_chat_deltas(model, _build_solution_messages(q), int(conf.get("timeout_seconds", 120))):
            parts.append(piece)
            yield _sse("delta", {"text": piece})

        text = "".join(parts).strip()
        if text:
            with get_conn() as conn:
                conn.execute(
                    """INSERT INTO ai_question_solution (question_id, content, model, created_at)
                       VALUES (?,?,?,?)
                       ON CONFLICT(question_id) DO UPDATE SET
                         content = excluded.content,
                         model   = excluded.model,
                         created_at = excluded.created_at""",
                    (question_id, text, model, now_iso()),
                )
        yield _sse("done", {"cached": False})
    except _AiError as exc:
        yield _sse("error", {"message": str(exc)})
    except GeneratorExit:
        raise
    except Exception as exc:
        yield _sse("error", {"message": f"AI 生成失败：{exc}"})


@router.post("/question-solution", summary="AI 计算题解答过程（SSE 流式）")
def question_solution(body: _QuestionBody, user: dict = Depends(get_current_user)):
    return _sse_response(_solution_stream(body.question_id, body.refresh))


# ── 视频 AI 概括 ────────────────────────────────────────────

class _VideoBody(BaseModel):
    material_id: int
    refresh: bool = False


def _summary_stream(material_id: int, refresh: bool):
    try:
        with get_conn() as conn:
            m = row_to_dict(conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone())
            cached = row_to_dict(
                conn.execute("SELECT * FROM ai_video_summary WHERE material_id = ?", (material_id,)).fetchone()
            )
        if not m:
            yield _sse("error", {"message": "视频不存在或已被删除"})
            return
        if m.get("kind") != "video":
            yield _sse("error", {"message": "该资料不是视频，暂不支持 AI 概括"})
            return

        conf = _ai_conf()
        if cached and cached["content"] and not refresh:
            yield _sse("meta", {"cached": True, "model": cached["model"]})
            yield _sse("delta", {"text": cached["content"]})
            yield _sse("done", {"cached": True})
            return

        if not ai_ready():
            yield _sse("error", {"message": "AI 服务尚未配置，请联系管理员在服务端填写 ai.api_key"})
            return

        yield _sse("meta", {"cached": False, "model": ""})

        # 抽帧要跑 ffmpeg（几秒），先发一帧把连接立起来，前端好切到「正在生成」
        frames = _extract_frames(
            UPLOAD_DIR / m["stored_name"], int(conf.get("video_frames", 6) or 6)
        )

        # 多帧一律拼成宫格图再送：视觉模型单次能看的图有限（glm-4v-flash 是 5 张），
        # 拼图既不会超限、又比多张图省 token；拼图失败才退回逐张（最多 _VISION_MAX_IMAGES 张）。
        images: list[str] = []
        grid: tuple[int, int] | None = None
        if len(frames) == 1:
            images = frames
        elif len(frames) >= 2:
            sheet = _contact_sheet(frames)
            if sheet:
                images = [sheet[0]]
                grid = (sheet[1], sheet[2])
            else:
                images = frames[:_VISION_MAX_IMAGES]

        model = str(conf.get("vision_model") or "glm-4v-flash") if frames else str(conf.get("chat_model") or "glm-4-flash")
        # frames=0 表示没抽到画面（没装 ffmpeg / 视频损坏），前端据此显示一行小提示
        yield _sse("meta", {"cached": False, "model": model, "frames": len(frames)})

        parts: list[str] = []
        messages = _build_summary_messages(m, images, total_frames=len(frames), grid=grid)
        for piece in _iter_chat_deltas(model, messages, int(conf.get("timeout_seconds", 120))):
            parts.append(piece)
            yield _sse("delta", {"text": piece})

        text = "".join(parts).strip()
        # 单独发的「未取到画面」提示不写进缓存，缓存只存真正的概括正文
        if text and frames:
            with get_conn() as conn:
                conn.execute(
                    """INSERT INTO ai_video_summary (material_id, content, model, created_at)
                       VALUES (?,?,?,?)
                       ON CONFLICT(material_id) DO UPDATE SET
                         content = excluded.content,
                         model   = excluded.model,
                         created_at = excluded.created_at""",
                    (material_id, text, model, now_iso()),
                )
        yield _sse("done", {"cached": False})
    except _AiError as exc:
        yield _sse("error", {"message": str(exc)})
    except GeneratorExit:
        raise
    except Exception as exc:
        yield _sse("error", {"message": f"AI 生成失败：{exc}"})


@router.post("/video-summary", summary="AI 视频概括（SSE 流式）")
def video_summary(body: _VideoBody, user: dict = Depends(get_current_user)):
    return _sse_response(_summary_stream(body.material_id, body.refresh))
