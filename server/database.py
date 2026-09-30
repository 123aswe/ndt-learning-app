"""
数据库模块 —— SQLite 连接、建表、初始数据。

职责：
  1. get_conn()：取一个连接（行可按列名访问，自动提交/回滚）
  2. init_db()：建表（幂等）+ 首次运行创建默认超级管理员
  3. now_iso()：全项目统一的时间字符串格式

数据表：
  admin_accounts  管理员账号（后台登录用）
  user_accounts   考生账号（前端登录用；登录名是自定义账号 account）
  registrations   注册申请（考生自助注册后进入待审核，管理员通过才建号）
  captchas        图形验证码（注册时校验，一次性、有有效期）
  sms_codes       短信验证码记录（历史遗留，当前登录/注册已不使用短信）
  sessions        登录令牌
  notifications   通知（每个接收考生一行，考生端「通知中心」读这张表）
  notification_batches  通知批次（后台「已发送记录」列表）
  password_resets 密码重置申请工单（考生提交 → 管理员处理）
  questions       题库（内置一级题库启动时从 data/question_bank.csv 导入，set_id 为空；
                    管理员在后台「题库管理」创建的题库 set_id 指向 question_sets.id）
  question_sets   自定义题库（管理员在后台创建/重命名/删除，题目按题型分类）
  answer_records  答题记录（每个考生一份，首页统计/错题本/连续打卡的数据源）
  wrong_dismissals 错题集删除记录（考生把某题从错题集移除，只隐藏不删答题记录）
  question_reports 题目纠错工单（考生上报「答案疑似有误」→ 管理员采纳/忽略）
  exams           模拟考试（一次开卷一行，id 同时是 answer_records.session_id）
  exam_answers    考试作答明细（交卷时写入，试卷回看数据源）
  materials       资料库（标准/教材/资料/视频的元数据；文件字节存 data/uploads/）
  app_meta        系统元信息（key-value）：一次性任务的执行标记

修改注意：
  - 新增字段 → 改 CREATE TABLE 并在 _migrate() 里补 ALTER TABLE，老库才能平滑升级
  - 删除表/字段属于破坏性操作，先确认影响再动
  - 老库的 user_accounts.phone 会在 _migrate() 里自动改名为 account
  - 一次性数据补齐（如历史账号补随机昵称/头像）要放在 _backfill_*() 里并用
    app_meta 打标记，**不能裸跑**，否则每次启动都会覆盖用户自己改过的数据
"""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

from config import DB_PATH
from profile_defaults import random_avatar, random_nickname
from security import hash_password

# ── 默认超级管理员（首次启动时自动创建；上线前请立即改密码） ──
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin123"


def now_iso() -> str:
    """统一时间格式：2026-09-29 14:30:00"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def future_iso(seconds: int) -> str:
    return (datetime.now() + timedelta(seconds=seconds)).strftime("%Y-%m-%d %H:%M:%S")


def is_expired(ts: str | None) -> bool:
    """判断时间字符串是否已过期（解析失败按已过期处理）。"""
    if not ts:
        return True
    try:
        return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S") < datetime.now()
    except ValueError:
        return True


SCHEMA = """
CREATE TABLE IF NOT EXISTS admin_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  real_name     TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'admin',
  status        INTEGER NOT NULL DEFAULT 1,
  remark        TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS user_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account       TEXT    NOT NULL UNIQUE,
  password_hash TEXT,
  org           TEXT    NOT NULL DEFAULT '',
  nickname      TEXT    NOT NULL DEFAULT '',
  avatar        TEXT    NOT NULL DEFAULT '',   -- 预设 "preset:N" 或上传的 data URL；空 = 用昵称首字
  real_name     TEXT    NOT NULL DEFAULT '',
  method        TEXT    NOT NULL DEFAULT '',
  status        INTEGER NOT NULL DEFAULT 1,
  remark        TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL,
  last_login_at TEXT
);

-- 注册申请：考生自助提交，管理员审核通过后才在 user_accounts 建号
CREATE TABLE IF NOT EXISTS registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account       TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  org           TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'pending',   -- pending / approved / rejected
  reject_reason TEXT    NOT NULL DEFAULT '',
  reviewed_by   TEXT    NOT NULL DEFAULT '',
  reviewed_at   TEXT,
  created_at    TEXT    NOT NULL
);

-- 图形验证码：注册时校验（一次性、有有效期）
CREATE TABLE IF NOT EXISTS captchas (
  id         TEXT    PRIMARY KEY,
  code       TEXT    NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT    NOT NULL,
  code        TEXT    NOT NULL,
  purpose     TEXT    NOT NULL DEFAULT 'login',
  channel     TEXT    NOT NULL DEFAULT 'local',
  send_status TEXT    NOT NULL DEFAULT '',
  used        INTEGER NOT NULL DEFAULT 0,
  fail_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT    NOT NULL,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT    PRIMARY KEY,
  subject_type TEXT    NOT NULL,
  subject_id   INTEGER NOT NULL,
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL
);

-- 通知：管理员在后台发送，每个接收考生一行（考生端「通知中心」读这张表）
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id   TEXT    NOT NULL,                  -- 一次发送 = 一个批次
  user_id    INTEGER NOT NULL,                  -- 接收考生 user_accounts.id
  type       TEXT    NOT NULL DEFAULT 'notice', -- system（不可删）/ notice（可删）
  title      TEXT    NOT NULL DEFAULT '',
  content    TEXT    NOT NULL DEFAULT '',
  sender     TEXT    NOT NULL DEFAULT '系统',
  read_at    TEXT,                              -- 空 = 未读
  deleted    INTEGER NOT NULL DEFAULT 0,        -- 考生删除（软删，保留审计）
  created_at TEXT    NOT NULL
);

-- 通知批次：后台「已发送记录」列表读这张表；删批次不影响考生已收到的通知
CREATE TABLE IF NOT EXISTS notification_batches (
  id             TEXT    PRIMARY KEY,           -- nb + 16 位十六进制
  type           TEXT    NOT NULL DEFAULT 'notice',
  title          TEXT    NOT NULL DEFAULT '',
  content        TEXT    NOT NULL DEFAULT '',
  scope          TEXT    NOT NULL DEFAULT 'one',-- all = 全部启用考生 / one = 指定考生
  target_desc    TEXT    NOT NULL DEFAULT '',   -- 列表展示用的接收对象描述
  accounts       TEXT    NOT NULL DEFAULT '',   -- 接收账号快照（逗号分隔）
  receiver_count INTEGER NOT NULL DEFAULT 0,
  sender         TEXT    NOT NULL DEFAULT '',
  hidden         INTEGER NOT NULL DEFAULT 0,    -- 后台删除记录 = 置 1（考生端保留）
  created_at     TEXT    NOT NULL
);

-- 密码重置申请（工单）：考生在 App 提交 → 管理员处理（重置密码 + 发系统通知）
CREATE TABLE IF NOT EXISTS password_resets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account       TEXT    NOT NULL,
  email         TEXT    NOT NULL DEFAULT '',    -- 考生填的邮箱（供管理员核对身份）
  user_id       INTEGER,                        -- 账号存在时记录，便于追溯
  status        TEXT    NOT NULL DEFAULT 'pending',  -- pending / done / rejected
  reject_reason TEXT    NOT NULL DEFAULT '',
  reviewed_by   TEXT    NOT NULL DEFAULT '',
  reviewed_at   TEXT,
  created_at    TEXT    NOT NULL
);

-- 题库（内置一级题库由 server/data/question_bank.csv 首次启动导入，set_id 为空；
--      管理员后台创建的自定义题库题目 set_id 指向 question_sets.id；考生只读）
CREATE TABLE IF NOT EXISTS questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id       INTEGER,                            -- NULL = 内置一级题库；非空 = 自定义题库 question_sets.id
  method       TEXT    NOT NULL,                   -- UT / RT / MT / PT；自定义题库统一 'ZD'
  grade        TEXT    NOT NULL DEFAULT 'I',       -- 级别（内置题库均为一级）
  topic1       TEXT    NOT NULL DEFAULT '',        -- 知识点一（章）
  topic2       TEXT    NOT NULL DEFAULT '',        -- 知识点二（节）
  qtype        TEXT    NOT NULL DEFAULT 'single',  -- single 单选 / judge 判断 / calc 计算 / short 简答
  content      TEXT    NOT NULL,                   -- 题干
  options_json TEXT    NOT NULL,                   -- 选项 JSON：[{"key":"A","text":"..."},...]（简答可为 []）
  answer       TEXT    NOT NULL,                   -- 正确答案：选项字母 / 判断（对错字母）/ 简答参考答案
  source_no    INTEGER NOT NULL DEFAULT 0,         -- 原始 CSV 序号（追溯用）
  created_at   TEXT    NOT NULL
);

-- 自定义题库：管理员在后台「题库管理」创建（如「二级 UT 题库」），题目仍存 questions 表
CREATE TABLE IF NOT EXISTS question_sets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,          -- 题库名称（考生端展示）
  level       TEXT    NOT NULL DEFAULT '',      -- 级别：一级 / 二级 / 三级 / 自定义文本
  description TEXT    NOT NULL DEFAULT '',      -- 描述（考生端副标题）
  created_at  TEXT    NOT NULL
);

-- 答题记录（每个考生一份自己的数据；统计/错题本/连续打卡都从这张表算）
CREATE TABLE IF NOT EXISTS answer_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,                -- 考生 user_accounts.id（数据隔离的键）
  question_id      INTEGER NOT NULL,                -- questions.id
  method           TEXT    NOT NULL DEFAULT '',     -- 冗余存方向，方便按方向统计
  kind             TEXT    NOT NULL DEFAULT 'answer', -- answer 正常答题 / master 手动标记已掌握
  user_answer      TEXT    NOT NULL DEFAULT '',     -- 考生选的答案
  is_correct       INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,      -- 本次练习会话总时长（同一 session 的每行相同）
  session_id       TEXT    NOT NULL DEFAULT '',     -- 一次练习 = 一个 session（统计时长按 session 去重）
  answered_at      TEXT    NOT NULL
);

-- 错题集删除记录：考生把某题从错题集「删除」= 加一行隐藏标记（不删答题记录）。
-- 再次答错会自动清掉该标记（见 practice.submit），这道题会重新出现在错题集里
CREATE TABLE IF NOT EXISTS wrong_dismissals (
  user_id    INTEGER NOT NULL,               -- 考生 user_accounts.id
  question_id INTEGER NOT NULL,              -- questions.id
  created_at TEXT    NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

-- 练习进度：考生做到第几题、已答界面快照（下次进来接着做，不用重头开始）。
-- 每条 = 一个练习范围（方向 + 章节 + 题型 + 自定义题库 + 出题方式），按 user_id 严格隔离；
-- 「清除记录」/ 交卷完成时删除，只删自己的这一条
CREATE TABLE IF NOT EXISTS practice_progress (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,               -- 考生 user_accounts.id（数据隔离的键）
  category      TEXT    NOT NULL DEFAULT '综合',   -- 方向代码 / 综合（自定义题库时传 '综合'）
  topic         TEXT    NOT NULL DEFAULT '',    -- 章节（topic1），非章节练习为空
  qtype         TEXT    NOT NULL DEFAULT '',    -- 题型筛选（空 = 不限）
  set_id        INTEGER NOT NULL DEFAULT 0,     -- 自定义题库 id（0 = 内置题库）
  mode          TEXT    NOT NULL DEFAULT 'sequential', -- sequential / random / wrong
  question_ids  TEXT    NOT NULL DEFAULT '[]',  -- 本次练习的题目顺序快照（JSON 数组）
  answers_json  TEXT    NOT NULL DEFAULT '{}',  -- 已答界面快照 {index: {selected, correct}}
  current_index INTEGER NOT NULL DEFAULT 0,     -- 当前做到第几题（0 起）
  updated_at    TEXT    NOT NULL,
  UNIQUE (user_id, category, topic, qtype, set_id, mode)
);

-- 模拟考试：一次开卷 = 一行；id 同时作为 answer_records.session_id，
-- 考试答题记录照常写 answer_records（统计/XP/成绩记录自然汇入）
CREATE TABLE IF NOT EXISTS exams (
  id               TEXT PRIMARY KEY,             -- 'ex' + 16 位十六进制
  user_id          INTEGER NOT NULL,             -- 考生 user_accounts.id（数据隔离的键）
  title            TEXT    NOT NULL DEFAULT '',  -- 展示标题，如「超声检测 · 判断题」
  category         TEXT    NOT NULL DEFAULT '',  -- 方向代码 / 综合（自定义题库时为空）
  set_id           INTEGER NOT NULL DEFAULT 0,   -- 自定义题库 id（0 = 内置题库）
  qtype            TEXT    NOT NULL DEFAULT '',  -- 题型筛选：空=全部 / judge / single / calc / short
  question_ids     TEXT    NOT NULL DEFAULT '[]',-- 试卷快照（JSON 数组，出卷时定格）
  duration_minutes INTEGER NOT NULL DEFAULT 60,  -- 考试时长（倒计时）
  total            INTEGER NOT NULL DEFAULT 0,   -- 试卷题数
  correct          INTEGER NOT NULL DEFAULT 0,   -- 答对题数
  score            INTEGER NOT NULL DEFAULT 0,   -- 百分制得分
  status           TEXT    NOT NULL DEFAULT 'in_progress', -- in_progress / finished
  time_used        INTEGER NOT NULL DEFAULT 0,   -- 实际用时（秒）
  auto_submitted   INTEGER NOT NULL DEFAULT 0,   -- 是否倒计时到点自动交卷
  started_at       TEXT    NOT NULL,
  finished_at      TEXT
);

-- 考试作答明细（每题一行，交卷时写入；试卷回看的数据源）
CREATE TABLE IF NOT EXISTS exam_answers (
  exam_id     TEXT    NOT NULL,
  question_id INTEGER NOT NULL,
  user_answer TEXT    NOT NULL DEFAULT '',     -- 我的答案（未作答则无行）
  is_correct  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (exam_id, question_id)
);

-- 题目纠错工单：考生在练习中觉得某题答案有误 → 提交「我认为的正确答案 + 理由」→
-- 管理员在后台处理（采纳=直接改题库里的正确答案 / 忽略 / 删除）
CREATE TABLE IF NOT EXISTS question_reports (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id      INTEGER NOT NULL,             -- questions.id
  user_id          INTEGER NOT NULL,             -- 考生 user_accounts.id
  suggested_answer TEXT    NOT NULL DEFAULT '',  -- 考生认为的正确答案（选项字母/判断/简答文本）
  reason           TEXT    NOT NULL DEFAULT '',  -- 考生的理由说明
  status           TEXT    NOT NULL DEFAULT 'pending', -- pending 待处理 / resolved 已处理 / dismissed 已忽略
  handled_by       TEXT    NOT NULL DEFAULT '',  -- 处理的管理员用户名
  handled_at       TEXT,
  created_at       TEXT    NOT NULL
);

-- 资料库：管理员上传的标准 / 教材 / 辅导资料 / 视频课程（考生端「教材 / 视频」页读取）。
-- 元数据入库；文件字节存 server/data/uploads/（视频太大，塞 SQLite 会让库变慢）
CREATE TABLE IF NOT EXISTS materials (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,                     -- 标题（考生端展示）
  category    TEXT    NOT NULL,                     -- standard 标准 / textbook 教材 / material 资料 / video 视频
  method      TEXT    NOT NULL DEFAULT '',          -- '' 通用 / UT / RT / MT / PT / ET / VT / 综合
  description TEXT    NOT NULL DEFAULT '',          -- 描述（考生端副标题）
  kind        TEXT    NOT NULL DEFAULT 'doc',       -- pdf / video / doc（决定考生端用什么方式打开）
  file_name   TEXT    NOT NULL DEFAULT '',          -- 上传时的原始文件名（下载/展示用）
  stored_name TEXT    NOT NULL,                     -- 磁盘随机文件名（uploads/ 下的实际文件）
  cover_name  TEXT    NOT NULL DEFAULT '',          -- 管理员指定封面的磁盘随机文件名（'' = 未指定，考生端自动取视频首帧）
  file_size   INTEGER NOT NULL DEFAULT 0,           -- 字节数
  mime        TEXT    NOT NULL DEFAULT '',          -- MIME 类型（FileResponse 用）
  uploaded_by TEXT    NOT NULL DEFAULT '',          -- 上传的管理员用户名
  created_at  TEXT    NOT NULL
);

-- 视频播放记录：考生每次打开视频落一条，播放量 = COUNT(*)（B 站式，同一人重复看会累加）
CREATE TABLE IF NOT EXISTS material_views (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  hidden      INTEGER NOT NULL DEFAULT 0,        -- 1 = 考生从「观看历史」里移除了这条（只影响列表展示，不删行 → 播放量不受影响）
  created_at  TEXT    NOT NULL
);

-- 视频收藏：一个考生对一个资料最多一条（联合主键天然去重）
CREATE TABLE IF NOT EXISTS material_favorites (
  material_id INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  TEXT    NOT NULL,
  PRIMARY KEY (material_id, user_id)
);

-- 视频评论：考生在详情页发表（即时可见），管理员可在后台删除
CREATE TABLE IF NOT EXISTS material_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  content     TEXT    NOT NULL,
  parent_id   INTEGER NOT NULL DEFAULT 0,   -- 楼中楼：0 = 顶层评论；>0 = 所属顶层评论 id（回复一律挂在根评论下，两层结构）
  reply_to    TEXT    NOT NULL DEFAULT '',  -- 被回复人昵称（发回复时快照，展示「回复 @xx」用）
  created_at  TEXT    NOT NULL
);

-- 系统元信息：一次性任务的执行标记等（key-value，避免重复跑破坏性/覆盖性操作）
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sms_phone      ON sms_codes (phone, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_exp   ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_reg_status     ON registrations (status, created_at);
CREATE INDEX IF NOT EXISTS idx_reg_account    ON registrations (account);
CREATE INDEX IF NOT EXISTS idx_captcha_exp    ON captchas (expires_at);
CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications (user_id, id);
CREATE INDEX IF NOT EXISTS idx_notif_batch    ON notifications (batch_id);
CREATE INDEX IF NOT EXISTS idx_preset_status  ON password_resets (status, id);
CREATE INDEX IF NOT EXISTS idx_preset_account ON password_resets (account);
CREATE INDEX IF NOT EXISTS idx_q_method       ON questions (method);
CREATE INDEX IF NOT EXISTS idx_q_set          ON questions (set_id);
CREATE INDEX IF NOT EXISTS idx_rec_user_time  ON answer_records (user_id, answered_at);
CREATE INDEX IF NOT EXISTS idx_rec_user_q     ON answer_records (user_id, question_id);
CREATE INDEX IF NOT EXISTS idx_rec_session    ON answer_records (session_id);
CREATE INDEX IF NOT EXISTS idx_dismiss_user   ON wrong_dismissals (user_id);
CREATE INDEX IF NOT EXISTS idx_progress_user  ON practice_progress (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_exam_user      ON exams (user_id, id);
CREATE INDEX IF NOT EXISTS idx_exam_ans_q     ON exam_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_qrep_status    ON question_reports (status, id);
CREATE INDEX IF NOT EXISTS idx_mat_category   ON materials (category, id);
CREATE INDEX IF NOT EXISTS idx_mat_view       ON material_views (material_id, id);
CREATE INDEX IF NOT EXISTS idx_mat_fav_user   ON material_favorites (user_id, material_id);
CREATE INDEX IF NOT EXISTS idx_mat_cmt        ON material_comments (material_id, id);
"""


@contextmanager
def get_conn():
    """上下文管理器：自动提交、异常回滚、始终关闭。"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row is not None else None


# ── 系统元信息（一次性任务的执行标记） ──────────────────────

def get_meta(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else ""


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _migrate(conn: sqlite3.Connection) -> None:
    """老库平滑升级：表里缺的列在这里补上。新增字段时记得同步。"""
    def has_table(table: str) -> bool:
        return bool(
            conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
        )

    def columns(table: str) -> set[str]:
        return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}

    # 考生账号的登录名从「手机号」改为「自定义账号」：老库把 phone 列改名成 account
    if has_table("user_accounts"):
        cols = columns("user_accounts")
        if "phone" in cols and "account" not in cols:
            conn.execute("ALTER TABLE user_accounts RENAME COLUMN phone TO account")

    # 密码重置工单的核对信息从「工作单位」改为「邮箱」：老库把 org 列改名成 email
    if has_table("password_resets"):
        cols = columns("password_resets")
        if "org" in cols and "email" not in cols:
            conn.execute("ALTER TABLE password_resets RENAME COLUMN org TO email")

    patches = {
        "questions": {
            # 老库补 set_id 列（NULL = 内置一级题库）
            "set_id": "INTEGER",
        },
        "admin_accounts": {
            "real_name": "TEXT NOT NULL DEFAULT ''",
            "role": "TEXT NOT NULL DEFAULT 'admin'",
            "status": "INTEGER NOT NULL DEFAULT 1",
            "remark": "TEXT NOT NULL DEFAULT ''",
            "last_login_at": "TEXT",
        },
        "user_accounts": {
            "account": "TEXT NOT NULL DEFAULT ''",
            "password_hash": "TEXT",
            "org": "TEXT NOT NULL DEFAULT ''",
            "nickname": "TEXT NOT NULL DEFAULT ''",
            "avatar": "TEXT NOT NULL DEFAULT ''",
            "real_name": "TEXT NOT NULL DEFAULT ''",
            "method": "TEXT NOT NULL DEFAULT ''",
            "status": "INTEGER NOT NULL DEFAULT 1",
            "remark": "TEXT NOT NULL DEFAULT ''",
            "last_login_at": "TEXT",
        },
        "sms_codes": {
            "purpose": "TEXT NOT NULL DEFAULT 'login'",
            "channel": "TEXT NOT NULL DEFAULT 'local'",
            "send_status": "TEXT NOT NULL DEFAULT ''",
            "used": "INTEGER NOT NULL DEFAULT 0",
            "fail_count": "INTEGER NOT NULL DEFAULT 0",
        },
        "registrations": {
            "account": "TEXT NOT NULL DEFAULT ''",
            "password_hash": "TEXT NOT NULL DEFAULT ''",
            "org": "TEXT NOT NULL DEFAULT ''",
            "status": "TEXT NOT NULL DEFAULT 'pending'",
            "reject_reason": "TEXT NOT NULL DEFAULT ''",
            "reviewed_by": "TEXT NOT NULL DEFAULT ''",
            "reviewed_at": "TEXT",
        },
        "materials": {
            # 管理员为视频/资料自定义封面（空 = 考生端自动取视频首帧）
            "cover_name": "TEXT NOT NULL DEFAULT ''",
        },
        "material_comments": {
            # 楼中楼：0 = 顶层评论；>0 = 所属根评论 id；reply_to = 被回复人昵称快照
            "parent_id": "INTEGER NOT NULL DEFAULT 0",
            "reply_to": "TEXT NOT NULL DEFAULT ''",
        },
        "material_views": {
            # 观看历史里被考生移除的记录（隐藏标记，不删行 → 播放量不变）
            "hidden": "INTEGER NOT NULL DEFAULT 0",
        },
    }
    for table, cols in patches.items():
        if not has_table(table):
            continue
        existing = columns(table)
        for name, ddl in cols.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


# ── 一次性数据补齐 ──────────────────────────────────────────

# app_meta 里的标记键名（改键名等于让补齐重跑，注意后果）
META_PROFILE_DEFAULTS = "profile_defaults_backfilled"


def _backfill_profile_defaults(conn: sqlite3.Connection) -> int:
    """给「随机昵称/头像」上线之前建的老账号补上随机资料，只跑一次。

    只处理明显是占位值的行，绝不覆盖考生自己改过的资料：
      - avatar 为空          → 从没设过头像（旧版本没有这个字段）
      - nickname 为空或等于账号 → 旧版本建号时用账号兜底的昵称

    用 app_meta 打标记，跑过就不再跑 —— 否则每次启动都会把
    「昵称故意设成账号」的考生资料重新随机化。
    返回处理的账号数。
    """
    if get_meta(conn, META_PROFILE_DEFAULTS) == "1":
        return 0

    rows = conn.execute("SELECT id, account, nickname, avatar FROM user_accounts").fetchall()
    changed = 0
    for r in rows:
        fields: list[str] = []
        params: list = []
        if not (r["avatar"] or "").strip():
            fields.append("avatar = ?")
            params.append(random_avatar())
        if not (r["nickname"] or "").strip() or r["nickname"] == r["account"]:
            fields.append("nickname = ?")
            params.append(random_nickname())
        if not fields:
            continue
        params.append(r["id"])
        conn.execute(f"UPDATE user_accounts SET {', '.join(fields)} WHERE id = ?", params)
        changed += 1

    set_meta(conn, META_PROFILE_DEFAULTS, "1")
    return changed


def init_db() -> str:
    """
    建表 + 首次运行创建默认超级管理员 + 跑一次性数据补齐。
    返回一句给启动日志用的人类可读说明。
    """
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        # 先做列迁移（老库补 set_id 等新列），再执行建表/建索引脚本——
        # 否则 SCHEMA 里的 CREATE INDEX 引用新列时老库还没有这一列，会直接报错
        _migrate(conn)
        conn.executescript(SCHEMA)

        # 清理过期会话与过期图形验证码（顺手做，不用定时任务）
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now_iso(),))
        conn.execute("DELETE FROM captchas WHERE expires_at < ?", (now_iso(),))

        notes: list[str] = []

        # 一次性：给「随机昵称/头像」上线前建的老账号补随机资料（只跑一次）
        backfilled = _backfill_profile_defaults(conn)
        if backfilled:
            notes.append(f"已为 {backfilled} 个历史考生账号补上随机昵称与头像")

        existing = conn.execute("SELECT COUNT(*) AS n FROM admin_accounts").fetchone()["n"]
        if existing == 0:
            conn.execute(
                """INSERT INTO admin_accounts
                   (username, password_hash, real_name, role, status, remark, created_at)
                   VALUES (?, ?, ?, 'super', 1, ?, ?)""",
                (
                    DEFAULT_ADMIN_USERNAME,
                    hash_password(DEFAULT_ADMIN_PASSWORD),
                    "超级管理员",
                    "首次启动自动创建，请尽快登录后台修改密码",
                    now_iso(),
                ),
            )
            notes.append(
                f"已初始化数据库，并创建默认超级管理员："
                f"{DEFAULT_ADMIN_USERNAME} / {DEFAULT_ADMIN_PASSWORD}（请尽快修改）"
            )
        else:
            notes.append("数据库已存在，跳过初始化")

    return "；".join(notes)
