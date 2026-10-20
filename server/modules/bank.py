"""
题库模块 —— questions 表的导入与概览统计。

职责：
  1. ensure_bank_imported()：首次启动从 data/question_bank.csv 导入题库（表空才导，幂等）
  2. GET /api/bank/summary：题库概览（各方向题量 + 当前考生已做题量），首页/题库页用
  3. POST /api/admin/question-bank/restore：把内置题库还原成官方基线
     （后台「恢复内置题库」按钮；可先 dry_run 预览，执行前自动备份）

权限边界：
  - 考生端对题库**只有读接口**，没有任何写入口；题库修改只能由管理员操作
    （导入脚本 / 将来在管理后台加编辑功能），接口层天然保证「除管理员外不能改」

CSV 格式（question_bank.csv，UTF-8）：
  序号,项目,知识点一,知识点二,题目类型,题目内容,题目选项,题目答案
  - 项目形如 UT(Ⅰ) / RT(Ⅰ)，取前两个字母当方向；RT(Ⅰ)1 这类尾巴视为同一方向
  - 选项用 「；##」 分隔，形如 A、正确；##B、错误；
  - 题目类型：判断题 → judge，单选题 → single，多选题 → multi，计算题 → calc，
    计算选择题 → calcsel，简答题 → short（题库 CSV 只有前两种，其余为管理员导入预留）
  - 选项里的 <img src="jcpicture/..."> 是原书图片，本地没有资源，导入时替换成「【图】」占位

修改注意：
  - 导入只在 questions 表为空时执行：改 CSV 后想重新导入，先清空 questions 表再重启服务
  - METHOD_NAMES 是「方向代码 → 中文名」的唯一映射，前端概览卡片直接用这里返回的 name
  - QTYPE_NAMES / QTYPE_FILTER / answers_match 是题型体系的唯一来源，
    新增题型只改本文件，再按 QTYPE_NAMES 的注释同步前端四处常量
  - 「官方原题 id」= CSV 里第几条**有效**行（首行为表头）。首次导入是逐行 INSERT 到空表，
    id 从 1 递增且被跳过的坏行不占号，所以两边严格一一对应 ——
    restore 靠这个对应关系把被误删的原题按原 id 补回（考生端历史记录仍能对上）。
    改了下面 _official_rows() 的过滤条件就等于改了 id 对应关系，别乱动。
"""

import csv
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from config import DB_PATH
from database import get_conn, now_iso
from deps import get_current_admin, get_current_user

router = APIRouter(prefix="/api/bank", tags=["题库"])
admin_router = APIRouter(prefix="/api/admin", tags=["题库"])

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
#   改这里必须同步：src/data/qtypes.ts、src/components/RandomDrillSheet.tsx、
#   src/screens/ExamSetupScreen.tsx、server/static/dashboard.js 的 QS_QTYPES
QTYPE_NAMES = {
    "judge": "判断题",
    "single": "选择题",
    "multi": "多选题",
    "calc": "计算题",
    "calcsel": "计算选择题",
    "short": "简答题",
}

# 全部题型代码（顺序 = QTYPE_NAMES 的声明顺序；各端展示顺序在各自端里另定）
QTYPE_CODES = tuple(QTYPE_NAMES)

# 题型筛选参数的共用正则（空 = 不限题型）：各接口的 Query pattern 统一引用这里
QTYPE_FILTER = "^(" + "|".join(("",) + QTYPE_CODES) + ")$"
# 必须指定题型的场景（后台添加 / 编辑单题）
QTYPE_ONLY = "^(" + "|".join(QTYPE_CODES) + ")$"

# 答案必须是「选项字母」的题型（单选 1 个字母，多选若干个），导入时要校验字母都在选项里
CHOICE_QTYPES = {"single", "multi", "calcsel"}

# 需要按「多键集合」比对的题型：答案是 'ACD' 这种字母串，顺序无关
MULTI_QTYPES = {"multi"}


def _normalize_qtype(raw: str) -> str:
    """CSV 题目类型 → qtype 代码；不认识的类型按选择题处理（保守兜底）。

    判断顺序有讲究：先认「多选 / 计算选择」这类组合词，再认单个「计算」，
    否则「计算选择题」会被“计算”提前截走变成 calc。
    """
    t = (raw or "").strip()
    if not t:
        return "single"
    if "多选" in t or "多项" in t:
        return "multi"
    if "计算" in t and "选择" in t:
        return "calcsel"
    if "判断" in t:
        return "judge"
    if "计算" in t:
        return "calc"
    if "简答" in t or "问答" in t or "论述" in t:
        return "short"
    return "single"


def normalize_multi_answer(raw: str) -> str:
    """多选题答案归一：只留字母、去重、按字母升序拼成 'ACD'。

    这样「C、A」「A,C」「ac d」都存成同一个 'ACD'：判分与存储都不受书写顺序影响。
    """
    return "".join(sorted({ch for ch in (raw or "").upper() if "A" <= ch <= "Z"}))


def answers_match(qtype: str, user_answer: str, correct: str) -> bool:
    """判分口径（练习在前端判、考试在服务端判，两边都走同一套规则）：

      - 多选（multi）：把两边都归一成字母集合再比，顺序 / 分隔符不同也算对；
      - 其余（判断 / 选择 / 计算选择题 / 计算 / 简答）：strip + upper 直接比对。
    """
    if qtype in MULTI_QTYPES:
        return normalize_multi_answer(user_answer) == normalize_multi_answer(correct)
    return (user_answer or "").strip().upper() == (correct or "").strip().upper()

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


# ── 内置题库「恢复官方基线」 ─────────────────────────────────
# 后台允许往内置一级题库导入题目（排查/补题用），但误把一整份 CSV 导进去就会多出一堆题。
# 这个接口把内置题库（set_id IS NULL）还原成 data/question_bank.csv：
#   ① 删掉多出来的题（连带清掉指向它们的答题记录/错题标记/纠错工单，与后台「删除题目」同口径）
#   ② 把被删掉的官方原题按原 id 补回
#   ③ 已经被管理员改过内容的官方原题**不动**（那可能是修错别字，不该被覆盖）
BUILTIN_RESTORE_KEEP_BACKUPS = 10  # 只保留最近 N 份「恢复前」快照，避免长期堆积


def _official_rows() -> list[dict]:
    """按 CSV 文件顺序解析官方题库；返回列表第 k 项对应**官方原题 id = k + 1**。

    ⚠️ 过滤条件必须与 ensure_bank_imported() 完全一致（列数、方向、题干/选项/答案非空），
    任何一条放宽或收紧都会让 id 对应关系错位，补回的题就会串号。
    """
    rows: list[dict] = []
    if not CSV_PATH.exists():
        return rows
    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        next(reader, None)  # 表头
        for row in reader:
            if len(row) < 8:
                continue
            no, project, topic1, topic2, qtype, content, options_raw, answer = row[:8]
            m = _METHOD_RE.search(project or "")
            if not m:
                continue
            options = _parse_options(options_raw)
            content_clean = _clean_text(content)
            answer_clean = (answer or "").strip().upper()
            if not content_clean or not options or not answer_clean:
                continue
            rows.append({
                "method": m.group(1),
                "grade": "I",
                "topic1": _clean_text(topic1),
                "topic2": _clean_text(topic2),
                "qtype": _normalize_qtype(qtype),
                "content": content_clean,
                "options_json": json.dumps(options, ensure_ascii=False),
                "answer": answer_clean,
                "source_no": int(no) if str(no).strip().isdigit() else 0,
            })
    return rows


def builtin_bank_diff() -> dict:
    """当前内置题库 vs 官方 CSV 的差异（只读，不写库）。

    extra     = 多出来的题（id 不在 1..官方题数 范围内）→ 要被删掉
    missing   = 官方有、库里没有的题（含管理员手工删掉的原题）→ 要被补回
    mismatch  = id 对得上但题干与官方不一致的原题（管理员改过）→ 本次不动，只提示
    """
    official = _official_rows()
    total = len(official)
    with get_conn() as conn:
        have = {
            r["id"]: (r["content"] or "")
            for r in conn.execute("SELECT id, content FROM questions WHERE set_id IS NULL").fetchall()
        }
    return {
        "official_total": total,
        "current_total": len(have),
        "extra": sorted(i for i in have if i < 1 or i > total),
        "missing": [k + 1 for k in range(total) if (k + 1) not in have],
        "mismatch": [k + 1 for k in range(total) if (k + 1) in have and have[k + 1] != official[k]["content"]],
        "official": official,
    }


def _count_question_refs(ids: list[int]) -> dict:
    """待删题被多少条考生数据引用（答题记录 / 错题标记 / 纠错工单）。"""
    out = {"answer_records": 0, "wrong_dismissals": 0, "question_reports": 0}
    if not ids:
        return out
    ph = ",".join("?" * len(ids))
    with get_conn() as conn:
        for tbl in out:
            try:
                out[tbl] = conn.execute(
                    f"SELECT COUNT(*) AS n FROM {tbl} WHERE question_id IN ({ph})", ids
                ).fetchone()["n"]
            except Exception:
                out[tbl] = 0  # 表不存在（老库）就当 0
    return out


def _backup_db(tag: str) -> str:
    """恢复前的手工快照。项目没有备份接口，沿用 data/app.db.bak-<原因>-<时间> 的惯例。"""
    src = Path(DB_PATH)
    dst = src.with_name(f"{src.name}.bak-{tag}-{datetime.now().strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(src, dst)
    for old in sorted(src.parent.glob(f"{src.name}.bak-{tag}-*"))[:-BUILTIN_RESTORE_KEEP_BACKUPS]:
        try:
            old.unlink()
        except OSError:
            pass
    return dst.name


@admin_router.post("/question-bank/restore", summary="恢复内置题库到官方基线（dry_run=true 只预览）")
def restore_builtin_bank(body: dict | None = None, admin: dict = Depends(get_current_admin)):
    """把内置一级题库（UT / RT / MT / PT）还原成 data/question_bank.csv 的官方题库。

    body.dry_run = true 时只算差异、给后台弹确认框用，不写任何数据；
    正式执行前会自动备份数据库，返回里带上快照文件名，出问题可手工回滚。
    """
    body = body or {}
    info = builtin_bank_diff()
    extra, missing, official = info["extra"], info["missing"], info["official"]

    # ⚠️ 两道护栏，都是「宁可恢复不了也绝不能误删」：
    #   ① CSV 缺失 / 解析出 0 道题 → 直接拒绝（否则「多出来的题」会等于全部内置题，一键清空）
    #   ② 要删的比官方题库本身还多 → 多半是 CSV 被截断或换错了文件，停下来让人排查
    if not official:
        raise HTTPException(
            status_code=409,
            detail="官方题库文件 data/question_bank.csv 缺失或没有可解析的题目，已中止恢复（不会删除任何数据）",
        )
    if len(extra) > len(official):
        raise HTTPException(
            status_code=409,
            detail=f"异常：待移除 {len(extra)} 题 多于 官方题库 {len(official)} 题，疑似 CSV 不完整，已中止恢复（不会删除任何数据）",
        )

    refs = _count_question_refs(extra)
    base = {
        "official_total": info["official_total"],
        "current_total": info["current_total"],
        "remove_count": len(extra),
        "remove_ids": extra[:20],
        "remove_range": [extra[0], extra[-1]] if extra else [],
        "restore_count": len(missing),
        "restore_ids": missing[:20],
        "restore_range": [missing[0], missing[-1]] if missing else [],
        "mismatch_count": len(info["mismatch"]),
        "refs": refs,
    }

    if body.get("dry_run"):
        return {**base, "dry_run": True}

    if not extra and not missing:
        return {
            **base,
            "dry_run": False,
            "backup": "",
            "total": info["current_total"],
            "message": f"内置题库已是官方基线（{info['official_total']} 题），无需恢复",
        }

    backup = _backup_db("restore")
    with get_conn() as conn:
        if extra:
            ph = ",".join("?" * len(extra))
            # 与后台「删除题目」同口径：连带清掉指向这些题的考生数据，不留悬空引用
            conn.execute(f"DELETE FROM answer_records WHERE question_id IN ({ph})", extra)
            conn.execute(f"DELETE FROM wrong_dismissals WHERE question_id IN ({ph})", extra)
            conn.execute(f"DELETE FROM question_reports WHERE question_id IN ({ph})", extra)
            conn.execute(f"DELETE FROM questions WHERE id IN ({ph})", extra)
        # 按原 id 补回被删的官方原题：id 不变，考生端历史答题记录自动重新对上
        for k in missing:
            o = official[k - 1]
            conn.execute(
                """INSERT INTO questions
                   (id, method, grade, topic1, topic2, qtype, content, options_json, answer, source_no, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (k, o["method"], o["grade"], o["topic1"], o["topic2"], o["qtype"],
                 o["content"], o["options_json"], o["answer"], o["source_no"], now_iso()),
            )
        total = conn.execute("SELECT COUNT(*) AS n FROM questions WHERE set_id IS NULL").fetchone()["n"]

    parts = []
    if extra:
        parts.append(f"移除 {len(extra)} 题")
    if missing:
        parts.append(f"补回 {len(missing)} 题")
    msg = f"内置题库已恢复官方基线：{'、'.join(parts)}，现共 {total} 题"
    if any(refs.values()):
        msg += f"（连带清理答题记录 {refs['answer_records']} 条）"
    return {**base, "dry_run": False, "backup": backup, "total": total, "message": msg}


def _question_public(row: dict) -> dict:
    """questions 行 → 对外格式（options_json 解开，内部字段不外露）。

    explanation = 「题目原题讲解」的解答过程（管理员在后台题目里填写，可含插图标记）。
    考试开卷时会由调用方把 answer / explanation 一并 pop 掉（防止考生偷看）。
    """
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
        # 老库行可能没有该键，统一兜底成空串（前端据此判断「要不要走 AI 生成」）
        "explanation": row.get("explanation") or "",
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
    qtype: str = Query(default="", pattern=QTYPE_FILTER),
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
