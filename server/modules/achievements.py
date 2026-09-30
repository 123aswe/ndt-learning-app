"""
成就模块 —— 考生成就勋章目录与解锁进度（「我的 → 成就勋章」页数据源）。

接口（需考生登录，数据按 user_id 隔离）：
  GET /api/user/achievements   成就目录：全部勋章 + 我的解锁状态与进度 + 等级概览

判据（全部实时算自现有表，不落库；删答题记录会同步「回退」）：
  答题  first/fifty/hundred/thousand/accuracy   累计答题数、全量正确率
  坚持  week/month/perfect/duration             连续打卡、单日全对、累计学习时长
  考试  exam_first/exam_pass/exam_full          模拟考试完成次数与最高分
  错题  master20/clean                          已订正的错题数、错题本是否清零
  资料  fav5/watch10/comment5                   收藏数、观看数、评论数

修改注意：
  - 目录顺序有约定：前 6 枚是首页 /「我的」页的「最近成就」预览（practice.py 的
    stats_summary 用 build_achievements()[:6]），新增勋章一律往后追加，
    否则首页预览内容会变
  - 判据口径必须与 practice.py / materials.py 保持一致：
      学习时长按 session 去重求和；「已掌握」= 该题最近一条记录 is_correct=1；
      待复习错题排除 wrong_dismissals 隐藏的题
  - icon 用 emoji，前端按 emoji 映射成线性图标（ProfileScreen.tsx / AchievementsScreen.tsx
    的 ACH_ICON_MAP），新增 emoji 记得同步前端映射表
  - XP 口径与 practice.py 一致：每答 1 题 1 经验，每 200 经验升 1 级
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends

from database import get_conn
from deps import get_current_user

router = APIRouter(prefix="/api/user/achievements", tags=["成就"])

XP_PER_LEVEL = 200  # 与 practice.py 保持一致

# 成就分类（前端分段展示）
CATEGORIES = [
    {"id": "answer", "name": "答题成就"},
    {"id": "persist", "name": "坚持成就"},
    {"id": "exam", "name": "考试成就"},
    {"id": "wrong", "name": "错题成就"},
    {"id": "library", "name": "资料成就"},
]

# 勋章品级（前端用来定徽章配色）
TIER_LABEL = {"bronze": "铜章", "silver": "银章", "gold": "金章"}


def _parse_date(text: str):
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").date()
    except (ValueError, TypeError):
        return None


def _compute_streak(days: set, today: date) -> int:
    """连续打卡：从今天（今天没做则从昨天）往回数连续有答题记录的天数。
    口径与 practice.py 的 _compute_streak 一致（故意重复实现，避免循环 import）。"""
    if not days:
        return 0
    cursor = today if today in days else today - timedelta(days=1)
    streak = 0
    while cursor in days:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _ach(id_, category, tier, title, desc, icon, earned, progress=0, max_p=1, unit="题"):
    return {
        "id": id_,
        "category": category,
        "tier": tier,
        "tier_name": TIER_LABEL.get(tier, ""),
        "title": title,
        "description": desc,
        "icon": icon,
        "earned": bool(earned),
        "progress": int(min(progress, max_p)) if max_p else 0,
        "max": int(max_p),
        "unit": unit,
    }


def build_achievements(conn, uid: int) -> list[dict]:
    """算出该考生的全部成就（含进度）。调用方必须传入已打开的连接。"""
    today = date.today()

    # ── 答题量 / 正确率 ──────────────────────────────────────
    row = conn.execute(
        """SELECT COUNT(*) AS n, SUM(is_correct) AS c FROM answer_records
           WHERE user_id = ? AND kind = 'answer'""",
        (uid,),
    ).fetchone()
    total_answered = int(row["n"] or 0)
    total_correct = int(row["c"] or 0)
    accuracy = round(total_correct / total_answered * 100) if total_answered else 0

    # ── 连续打卡 / 单日全对 ──────────────────────────────────
    days = {
        d
        for d in (
            _parse_date(r["d"] + " 00:00:00")
            for r in conn.execute(
                """SELECT DISTINCT substr(answered_at, 1, 10) AS d FROM answer_records
                   WHERE user_id = ? AND kind = 'answer'""",
                (uid,),
            ).fetchall()
        )
        if d
    }
    streak = _compute_streak(days, today)

    perfect_days = int(
        conn.execute(
            """SELECT COUNT(*) AS n FROM (
                   SELECT substr(answered_at, 1, 10) AS d, COUNT(*) AS t, SUM(is_correct) AS c
                     FROM answer_records WHERE user_id = ? AND kind = 'answer'
                    GROUP BY d HAVING t >= 10 AND c = t)""",
            (uid,),
        ).fetchone()["n"]
        or 0
    )

    # ── 累计学习时长（按 session 去重，与 practice.py 口径一致） ──
    duration_s = int(
        conn.execute(
            """SELECT SUM(d) AS s FROM (
                   SELECT MAX(duration_seconds) AS d FROM answer_records
                   WHERE user_id = ? AND kind = 'answer' GROUP BY session_id)""",
            (uid,),
        ).fetchone()["s"]
        or 0
    )
    duration_hours = duration_s / 3600

    # ── 模拟考试 ─────────────────────────────────────────────
    erow = conn.execute(
        """SELECT COUNT(*) AS n, MAX(score) AS best FROM exams
           WHERE user_id = ? AND status = 'finished'""",
        (uid,),
    ).fetchone()
    exam_count = int(erow["n"] or 0)
    exam_best = int(erow["best"] or 0)

    # ── 错题：已订正数量 + 待复习数（排除从错题集移除的隐藏题） ──
    mastered = int(
        conn.execute(
            """SELECT COUNT(*) AS n FROM (
                   SELECT r.question_id,
                          MIN(CASE WHEN r.kind = 'answer' THEN r.is_correct ELSE 1 END) AS ever_wrong,
                          (SELECT b.is_correct FROM answer_records b
                            WHERE b.user_id = r.user_id AND b.question_id = r.question_id
                            ORDER BY b.id DESC LIMIT 1) AS last_correct
                     FROM answer_records r WHERE r.user_id = ? GROUP BY r.question_id)
                WHERE ever_wrong = 0 AND last_correct = 1""",
            (uid,),
        ).fetchone()["n"]
        or 0
    )
    wrong_pending = len(
        [
            r
            for r in conn.execute(
                """SELECT question_id FROM answer_records r
                    WHERE r.user_id = ? AND r.id = (
                          SELECT MAX(id) FROM answer_records
                           WHERE user_id = r.user_id AND question_id = r.question_id)
                      AND r.is_correct = 0
                      AND r.question_id NOT IN (
                          SELECT question_id FROM wrong_dismissals WHERE user_id = ?)""",
                (uid, uid),
            ).fetchall()
        ]
    )

    # ── 资料库互动：收藏 / 观看 / 评论 ────────────────────────
    fav_count = int(
        conn.execute(
            "SELECT COUNT(*) AS n FROM material_favorites WHERE user_id = ?", (uid,)
        ).fetchone()["n"]
        or 0
    )
    watched = int(
        conn.execute(
            "SELECT COUNT(DISTINCT material_id) AS n FROM material_views WHERE user_id = ?", (uid,)
        ).fetchone()["n"]
        or 0
    )
    comments = int(
        conn.execute(
            "SELECT COUNT(*) AS n FROM material_comments WHERE user_id = ?", (uid,)
        ).fetchone()["n"]
        or 0
    )

    # ── 目录（前 6 枚 = 首页 /「我的」预览，顺序勿动） ─────────
    return [
        _ach("first", "answer", "bronze", "破冰者", "完成第一道题目", "🏁",
             total_answered >= 1, min(total_answered, 1), 1),
        _ach("fifty", "answer", "bronze", "小试牛刀", "累计答题 50 道", "✦",
             total_answered >= 50, total_answered, 50),
        _ach("hundred", "answer", "silver", "百题斩", "累计答题 100 道", "⚡",
             total_answered >= 100, total_answered, 100),
        _ach("thousand", "answer", "gold", "千题挑战", "累计答题 1000 道", "〜",
             total_answered >= 1000, total_answered, 1000),
        _ach("week", "persist", "bronze", "七日之约", "连续打卡 7 天", "🔥",
             streak >= 7, streak, 7, "天"),
        _ach("perfect", "persist", "silver", "满分一日", "单日 10 题以上全部正确", "📐",
             perfect_days >= 1, perfect_days, 1, "天"),
        # ── 以下为成就页专属（不参与首页预览） ──
        _ach("accuracy", "answer", "gold", "神枪手", "答满 100 题且正确率 ≥ 90%", "🎯",
             total_answered >= 100 and accuracy >= 90, accuracy, 90, "%"),
        _ach("month", "persist", "gold", "月度恒心", "连续打卡 30 天", "📅",
             streak >= 30, streak, 30, "天"),
        _ach("duration", "persist", "silver", "学海无涯", "累计学习 10 小时", "⏳",
             duration_hours >= 10, int(duration_hours), 10, "小时"),
        _ach("exam_first", "exam", "bronze", "初试锋芒", "完成 1 次模拟考试", "🎓",
             exam_count >= 1, exam_count, 1, "次"),
        _ach("exam_pass", "exam", "silver", "一次通过", "模拟考试成绩 ≥ 80 分", "🏅",
             exam_best >= 80, exam_best, 80, "分"),
        _ach("exam_full", "exam", "gold", "满分答卷", "模拟考试拿到 100 分", "💯",
             exam_best >= 100, exam_best, 100, "分"),
        _ach("master20", "wrong", "silver", "知错能改", "订正掌握 20 道错题", "🧹",
             mastered >= 20, mastered, 20),
        _ach("clean", "wrong", "gold", "错题清零", "答满 100 题且错题本零待复习", "✨",
             total_answered >= 100 and wrong_pending == 0,
             max(total_answered - wrong_pending, 0), 100),
        _ach("fav5", "library", "bronze", "收藏家", "收藏 5 个视频", "🔖",
             fav_count >= 5, fav_count, 5, "个"),
        _ach("watch10", "library", "bronze", "学习不止", "观看 10 个视频", "📺",
             watched >= 10, watched, 10, "个"),
        _ach("comment5", "library", "silver", "互动达人", "发表 5 条视频评论", "💬",
             comments >= 5, comments, 5, "条"),
    ]


def _xp_of(total_answered: int) -> dict:
    """XP 等级（口径同 practice.py：每 200 经验 1 级）。"""
    return {
        "xp": total_answered,
        "xp_in_level": total_answered % XP_PER_LEVEL,
        "xp_level_max": XP_PER_LEVEL,
        "level": total_answered // XP_PER_LEVEL + 1,
    }


@router.get("", summary="我的成就目录（含解锁状态与进度）")
def my_achievements(user: dict = Depends(get_current_user)):
    with get_conn() as conn:
        uid = user["id"]
        items = build_achievements(conn, uid)
        total_answered = int(
            conn.execute(
                "SELECT COUNT(*) AS n FROM answer_records WHERE user_id = ? AND kind = 'answer'",
                (uid,),
            ).fetchone()["n"]
            or 0
        )
    earned = [a for a in items if a["earned"]]
    return {
        "items": items,
        "categories": CATEGORIES,
        "total": len(items),
        "earned_count": len(earned),
        # 最近解锁的 3 枚（目录顺序里靠后的算「更近」，前端做高亮用）
        "recent_earned": [a["id"] for a in earned[-3:]],
        **_xp_of(total_answered),
    }
