"""
题库模块 —— questions 表的导入与概览统计。

职责：
  1. ensure_bank_imported()：首次启动从 data/question_bank.csv 导入题库（表空才导，幂等）
  2. GET /api/bank/summary：题库概览（各方向题量 + 当前考生已做题量），首页/题库页用

权限边界：
  - 考生端对题库**只有读接口**，没有任何写入口；题库修改只能由管理员操作
    （导入脚本 / 将来在管理后台加编辑功能），接口层天然保证「除管理员外不能改」

CSV 格式（question_bank.csv，UTF-8）：
  序号,项目,知识点一,知识点二,题目类型,题目内容,题目选项,题目答案
  - 项目形如 UT(Ⅰ) / RT(Ⅰ)，取前两个字母当方向；RT(Ⅰ)1 这类尾巴视为同一方向
  - 选项用 「；##」 分隔，形如 A、正确；##B、错误；
  - 题目类型：判断题 → judge，单选题 → single，计算题 → calc（当前 CSV 只有前两种，
    计算题为将来补充题库预留，随机刷题的题型筛选已支持）
  - 选项里的 <img src="jcpicture/..."> 是原书图片，本地没有资源，导入时替换成「【图】」占位

修改注意：
  - 导入只在 questions 表为空时执行：改 CSV 后想重新导入，先清空 questions 表再重启服务
  - METHOD_NAMES 是「方向代码 → 中文名」的唯一映射，前端概览卡片直接用这里返回的 name
"""

import csv
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Query

from database import get_conn, now_iso
from deps import get_current_user

router = APIRouter(prefix="/api/bank", tags=["题库"])

# CSV 与服务根目录的相对位置（server/data/question_bank.csv）
CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "question_bank.csv"

# 方向代码 → 中文名（唯一映射，后台将来也用这份）
METHOD_NAMES = {
    "UT": "超声检测",
    "RT": "射线检测",
    "MT": "磁粉检测",
    "PT": "渗透检测",
    "ZD": "自定义题库",  # 管理员后台创建的题库（question_sets），统计里单独一类
}

# 项目列形如 "UT(Ⅰ)" / "RT(Ⅰ)1"，提取大写方向代码
_METHOD_RE = re.compile(r"([A-Z]{2})")

# 题目类型 → qtype 代码（「跨端一致常量」：前端 client.ts / 随机刷题选择器 / 管理后台同用这套代码）
QTYPE_NAMES = {
    "judge": "判断题",
    "single": "选择题",
    "calc": "计算题",
    "short": "简答题",
}


def _normalize_qtype(raw: str) -> str:
    """CSV 题目类型 → qtype 代码；不认识的类型按选择题处理（保守兜底）。"""
    t = (raw or "").strip()
    if t == "判断题":
        return "judge"
    if "计算" in t:
        return "calc"
    if "简答" in t or "问答" in t:
        return "short"
    return "single"

# 原书插图标记：<img src="jcpicture/xxx.jpg"> → 【图】
_IMG_RE = re.compile(r"<img[^>]*>")


def _clean_text(text: str) -> str:
    """清理题干/选项文本：去首尾空白，把无法显示的图片标记换成占位符。"""
    return _IMG_RE.sub("【图】", (text or "").strip())


def _parse_options(raw: str) -> list[dict]:
    """把 CSV 的选项列解析成 [{key, text}, ...]，形如 'A、正确；##B、错误；'。

    注意：部分行用的是全角小逗号「﹑」(U+FE51) 而不是顿号「、」(U+3001)，两种都要认。
    """
    options: list[dict] = []
    for chunk in (raw or "").split("##"):
        chunk = _clean_text(chunk).rstrip("；;").strip()
        if not chunk:
            continue
        # 第一个「、」或「﹑」前是选项字母
        sep_idx = -1
        for sep in ("、", "﹑"):
            i = chunk.find(sep)
            if i != -1 and (sep_idx == -1 or i < sep_idx):
                sep_idx = i
        if sep_idx != -1:
            key = chunk[:sep_idx].strip().upper()
            text = chunk[sep_idx + 1:]
        else:
            key, text = "", chunk
        if key:
            options.append({"key": key, "text": text.strip()})
    return options


def ensure_bank_imported() -> str:
    """题库导入：只在 questions 表为空时执行（幂等，绝不覆盖已有题库）。

    返回给启动日志的一句说明。
    """
    with get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) AS n FROM questions").fetchone()["n"]
        if count > 0:
            return f"题库已有 {count} 题，跳过导入"

        if not CSV_PATH.exists():
            return f"⚠️ 未找到题库文件 {CSV_PATH.name}，题库为空（不影响其它功能）"

        imported = 0
        skipped = 0
        with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            next(reader)  # 跳过表头
            for row in reader:
                if len(row) < 8:
                    skipped += 1
                    continue
                no, project, topic1, topic2, qtype, content, options_raw, answer = row[:8]

                m = _METHOD_RE.search(project or "")
                if not m:
                    skipped += 1
                    continue
                method = m.group(1)

                options = _parse_options(options_raw)
                content_clean = _clean_text(content)
                answer_clean = (answer or "").strip().upper()
                # 关键字段缺失的行跳过，不让脏数据进库
                if not content_clean or not options or not answer_clean:
                    skipped += 1
                    continue

                conn.execute(
                    """INSERT INTO questions
                       (method, grade, topic1, topic2, qtype, content, options_json, answer, source_no, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        method,
                        "I",
                        _clean_text(topic1),
                        _clean_text(topic2),
                        _normalize_qtype(qtype),
                        content_clean,
                        json.dumps(options, ensure_ascii=False),
                        answer_clean,
                        int(no) if str(no).strip().isdigit() else 0,
                        now_iso(),
                    ),
                )
                imported += 1

        total = conn.execute("SELECT COUNT(*) AS n FROM questions").fetchone()["n"]
        per_method = conn.execute(
            "SELECT method, COUNT(*) AS n FROM questions GROUP BY method ORDER BY method"
        ).fetchall()
        detail = "、".join(f"{r['method']} {r['n']} 题" for r in per_method)
        note = f"题库导入完成：共 {total} 题（{detail}）"
        if skipped:
            note += f"，跳过 {skipped} 条异常行"
        return note


def _question_public(row: dict) -> dict:
    """questions 行 → 对外格式（options_json 解开，内部字段不外露）。"""
    return {
        "id": row["id"],
        "method": row["method"],
        "grade": row["grade"],
        "qtype": row["qtype"],
        "topic": row["topic1"],
        "sub_topic": row["topic2"],
        "content": row["content"],
        "options": json.loads(row["options_json"]),
        "answer": row["answer"],
    }


# ── 查 ──────────────────────────────────────────────────────

@router.get("/summary", summary="题库概览（各方向题量 + 我的已做题量 + 题型分布）")
def bank_summary(user: dict = Depends(get_current_user)):
    """首页「推荐训练」「随机刷题」与题库页的数据源。answered 只算本人。
    qtype_counts 是「方向 × 题型」矩阵（随机刷题选择器据此显示题量/置灰空题型）。"""
    with get_conn() as conn:
        counts = {
            r["method"]: r["n"]
            for r in conn.execute(
                "SELECT method, COUNT(*) AS n FROM questions GROUP BY method"
            ).fetchall()
        }
        answered = {
            r["method"]: r["n"]
            for r in conn.execute(
                """SELECT method, COUNT(DISTINCT question_id) AS n
                   FROM answer_records WHERE user_id = ? GROUP BY method""",
                (user["id"],),
            ).fetchall()
        }
        qtype_counts = [
            {"method": r["method"], "qtype": r["qtype"], "count": r["n"]}
            for r in conn.execute(
                "SELECT method, qtype, COUNT(*) AS n FROM questions GROUP BY method, qtype"
            ).fetchall()
        ]
        total = conn.execute("SELECT COUNT(*) AS n FROM questions").fetchone()["n"]

    methods = [
        {
            "method": code,
            "name": METHOD_NAMES.get(code, code),
            "count": counts.get(code, 0),
            "answered": answered.get(code, 0),
        }
        for code in sorted(set(counts) | set(answered))
    ]
    return {"total": total, "methods": methods, "qtype_counts": qtype_counts}


@router.get("/chapters", summary="章节列表（按知识点 topic1 分组，题库页「按章节练习」用）")
def bank_chapters(
    category: str = Query(default="综合", max_length=8),
    qtype: str = Query(default="", pattern="^(|judge|single|calc|short)$"),
    user: dict = Depends(get_current_user),
):
    """范围内的章节（知识点一）分组：章节名、题数、我已做过的题数（去重）。
    可按题型（qtype）过滤，只统计该题型；只返回有题的章节，按题数降序。"""
    conds: list[str] = []
    params: list = []
    if category and category != "综合":
        conds.append("method = ?")
        params.append(category)
    if qtype:
        conds.append("qtype = ?")
        params.append(qtype)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    answered_conds = ["a.user_id = ?"]
    answered_params: list = [user["id"]]
    if category and category != "综合":
        answered_conds.append("q.method = ?")
        answered_params.append(category)
    if qtype:
        answered_conds.append("q.qtype = ?")
        answered_params.append(qtype)
    answered_where = " AND ".join(answered_conds)
    with get_conn() as conn:
        counts = [
            (r["topic1"], r["n"])
            for r in conn.execute(
                f"""SELECT topic1, COUNT(*) AS n FROM questions {where}
                    GROUP BY topic1 ORDER BY n DESC""",
                params,
            ).fetchall()
            if r["topic1"]
        ]
        answered = {
            r["topic1"]: r["n"]
            for r in conn.execute(
                f"""SELECT q.topic1 AS topic1, COUNT(DISTINCT a.question_id) AS n
                   FROM answer_records a JOIN questions q ON q.id = a.question_id
                   WHERE {answered_where}""",
                answered_params,
            ).fetchall()
        }
    return {
        "items": [
            {"topic": t, "count": n, "answered": answered.get(t, 0)}
            for t, n in counts
        ]
    }


@router.get("/search", summary="搜索题目（题干 / 知识点）")
def bank_search(
    q: str = Query(min_length=1, max_length=50),
    limit: int = Query(default=30, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    """题库页搜索框的数据源：按题干与知识点模糊匹配（只读，不改题库）。"""
    kw = q.strip()
    if not kw:
        return {"total": 0, "items": []}
    like = f"%{kw}%"
    with get_conn() as conn:
        total = conn.execute(
            """SELECT COUNT(*) AS n FROM questions
               WHERE content LIKE ? OR topic1 LIKE ? OR topic2 LIKE ?""",
            (like, like, like),
        ).fetchone()["n"]
        rows = conn.execute(
            """SELECT id, method, qtype, topic1, content FROM questions
               WHERE content LIKE ? OR topic1 LIKE ? OR topic2 LIKE ?
               ORDER BY id LIMIT ?""",
            (like, like, like, limit),
        ).fetchall()
    return {
        "total": total,
        "items": [
            {
                "id": r["id"],
                "method": r["method"],
                "qtype_label": QTYPE_NAMES.get(r["qtype"], "单选题"),
                "topic": r["topic1"],
                "content": r["content"],
            }
            for r in rows
        ],
    }
