"""
题库导入的表格兼容层 —— 「用户给什么，都能认出来」。

解决的问题（管理员导入题库时踩到的三层坑）：
  1. 扩展名骗人：.csv 里其实是 Excel 二进制（文件头 PK），当文本读必然乱码；
  2. 编码不统一：Excel 默认另存 CSV 在中文系统上是 GBK/GB18030，前端按 UTF-8 读就花；
  3. 列名/列序不一样：`章节,题型,题号,题目,选项A..E,答案` 这类常见表要能自动对到系统
     标准列 `序号,项目,知识点一,知识点二,题目类型,题目内容,题目选项,题目答案`。

对外只有一个入口：normalize_table_input()，返回 (标准 8 列 CSV 文本, 说明文字)。
说明文字用于后台 toast 回显（识别到了什么编码 / 是不是 Excel / 映射了哪些列）。

零第三方依赖：xlsx 用 zipfile + xml.etree 自己拆（只取第一个有数据的 sheet）。

修改注意：
  - _ALIASES 是「标准列 → 可认的表头写法」的唯一来源，新增别名只改这一张表；
  - 只在**首行能认出 >=3 个已知表头**时才做列映射，认不出就原样返回，
    交给原有「按位置解析 8 列」的老逻辑（保证老格式文件行为完全不变）；
  - 列映射成功后输出的是带标准表头的 CSV，question_sets.import_csv 那边照旧跳表头解析。
"""

import codecs
import csv
import io
import re
import zipfile
import xml.etree.ElementTree as ET

# xlsx / xls 的真实文件头（不看扩展名，认字节）
_ZIP_MAGIC = b"PK\x03\x04"
_OLE2_MAGIC = b"\xd0\xcf\x11\xe0"

_NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

# 标准 8 列（与 data/question_bank.csv、bank.py 文档口径一致）
STD_HEADER = ["序号", "项目", "知识点一", "知识点二", "题目类型", "题目内容", "题目选项", "题目答案"]

# 标准列 → 认得出来的表头写法（归一化后比对：去空白、全角转半角、转大写、去标点）
#   归一化规则见 _norm_head()
_ALIASES: dict[str, set[str]] = {
    "序号": {"序号", "编号", "题号", "题序", "序号NO", "NO", "ID", "顺序号"},
    "项目": {"项目", "项目名称", "分类", "方向", "科目", "专业"},
    "知识点一": {"知识点一", "知识点1", "知识点", "章节", "章", "章节名", "所属章节", "专题", "知识模块", "模块"},
    "知识点二": {"知识点二", "知识点2", "小节", "子知识点", "考点", "二级知识点"},
    "题目类型": {"题目类型", "题型", "类型", "题类型", "试题类型", "题目类别", "问答类型"},
    "题目内容": {"题目内容", "题目", "题干", "试题", "问题", "题目描述", "试题内容"},
    "题目选项": {"题目选项", "选项", "备选项", "选择项"},
    "题目答案": {"题目答案", "答案", "正确答案", "参考答案", "标准答案"},
}

# 「选项A / 选项1 / A / ①」这类一列一个选项的表头
_OPT_COL_RE = re.compile(r"^(?:选项|备选|OPTION|OPT)?([A-Ha-h1-9]|①|②|③|④|⑤|⑥|⑦|⑧)$")
_CIRCLED = {"①": "A", "②": "B", "③": "C", "④": "D", "⑤": "E", "⑥": "F", "⑦": "G", "⑧": "H"}


def sniff_kind(raw: bytes) -> str:
    """按文件头判断真实类型：xlsx（zip 容器）/ xls（OLE2）/ text（其余按文本处理）。"""
    if raw[:4] == _ZIP_MAGIC:
        return "xlsx"
    if raw[:4] == _OLE2_MAGIC:
        return "xls"
    return "text"


def decode_bytes(raw: bytes) -> tuple[str, str]:
    """字节 → 文本，返回 (文本, 编码名)。顺序即优先级：

    UTF-8 BOM → UTF-16 BOM → UTF-8（严格，失败才往下）→ GB18030 → Big5 → 兜底替换。
    UTF-8 放最前是关键：它是严格的，能过就几乎不可能是别的编码；
    GB18030 兜底能力极强（几乎不会抛错），所以必须排在 UTF-8 之后。
    """
    if raw.startswith(codecs.BOM_UTF8):
        return raw[len(codecs.BOM_UTF8):].decode("utf-8", "replace"), "UTF-8 (带 BOM)"
    if raw.startswith(codecs.BOM_UTF16_LE):
        return raw[2:].decode("utf-16-le", "replace"), "UTF-16 LE"
    if raw.startswith(codecs.BOM_UTF16_BE):
        return raw[2:].decode("utf-16-be", "replace"), "UTF-16 BE"
    try:
        return raw.decode("utf-8"), "UTF-8"
    except UnicodeDecodeError:
        pass
    for enc, name in (("gb18030", "GBK / GB18030"), ("big5", "Big5"), ("cp1252", "CP1252")):
        try:
            return raw.decode(enc), name
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace"), "UTF-8（含无法识别的字节，已替换）"


# --------------------------------------------------------------------------
# xlsx 解析（只用标准库，够用就好：第一个有数据的 sheet，按单元格引用对齐列）
# --------------------------------------------------------------------------

def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    try:
        xml = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(xml)
    out: list[str] = []
    for si in root.findall(f"{_NS_MAIN}si"):
        out.append("".join(t.text or "" for t in si.iter(f"{_NS_MAIN}t")))
    return out


def _sheet_paths(z: zipfile.ZipFile) -> list[str]:
    """按工作簿里的顺序返回 sheet 的 zip 路径；拿不到关系表就退回 sheet1/2/3..."""
    names = set(z.namelist())
    try:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid2target = {}
        for rel in rels:
            target = (rel.get("Target") or "").lstrip("/")
            if target.startswith("xl/"):
                rid2target[rel.get("Id")] = target
            else:
                rid2target[rel.get("Id")] = "xl/" + target
        paths = []
        for sh in wb.iter(f"{_NS_MAIN}sheet"):
            p = rid2target.get(sh.get(f"{_NS_REL}id"))
            if p and p in names:
                paths.append(p)
        if paths:
            return paths
    except Exception:
        pass
    return [n for n in sorted(names) if n.startswith("xl/worksheets/") and n.endswith(".xml")]


def _col_index(ref: str) -> int:
    """单元格引用 'C12' → 列下标 2（0 起）。"""
    letters = ""
    for ch in ref:
        if ch.isalpha():
            letters += ch
        else:
            break
    idx = 0
    for ch in letters.upper():
        idx = idx * 26 + (ord(ch) - 64)
    return max(idx - 1, 0)


def _cell_text(cell: ET.Element, shared: list[str]) -> str:
    """取单元格显示值：共享串 / 内联串 / 公式结果 / 布尔 / 数字（整数去掉 .0）。"""
    t = cell.get("t")
    if t == "inlineStr":
        node = cell.find(f"{_NS_MAIN}is")
        return "".join(x.text or "" for x in node.iter(f"{_NS_MAIN}t")) if node is not None else ""
    v = cell.find(f"{_NS_MAIN}v")
    if v is None or v.text is None:
        return ""
    s = v.text
    if t == "s":
        try:
            return shared[int(s)]
        except (ValueError, IndexError):
            return ""
    if t == "b":
        return "对" if s == "1" else "错"
    if t in ("str", "e"):
        return s
    try:  # 数字：1.0 → 1（题号那列从 Excel 读出来常带小数点）
        f = float(s)
        if f.is_integer() and abs(f) < 1e15:
            return str(int(f))
    except ValueError:
        pass
    return s


def _xlsx_rows(raw: bytes) -> list[list[str]]:
    """xlsx 字节 → 二维字符串表（第一个有数据的 sheet）。"""
    z = zipfile.ZipFile(io.BytesIO(raw))
    shared = _shared_strings(z)
    for path in _sheet_paths(z):
        try:
            root = ET.fromstring(z.read(path))
        except ET.ParseError:
            continue
        rows: list[list[str]] = []
        for row in root.iter(f"{_NS_MAIN}row"):
            texts: list[str] = []
            for cell in row.iter(f"{_NS_MAIN}c"):
                idx = _col_index(cell.get("r") or "")
                while len(texts) < idx:
                    texts.append("")
                texts.append(_cell_text(cell, shared))
            if texts and any(x.strip() for x in texts):
                rows.append([_clean_cell(x) for x in texts])
        if rows:
            return rows
    return []


def _clean_cell(s: str) -> str:
    """Excel 里常见的脏字符：_x000D_ 换行转义、不可见控制符。"""
    s = re.sub(r"_x[0-9A-Fa-f]{4}_", " ", s or "")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s).strip()


# --------------------------------------------------------------------------
# 表头识别 + 列映射
# --------------------------------------------------------------------------

def _norm_head(s: str) -> str:
    """表头归一化：去空白/全角空格、全角括号冒号转半角、去标点、转大写。"""
    s = (s or "").replace("\ufeff", "").replace("\u3000", "")
    s = s.translate(str.maketrans("（）【】［］：；．", "()[]  :;."))
    s = re.sub(r"[\s]+", "", s)
    s = re.sub(r"[*＊·、,，。:：;；()\[\]/\\\"'’“”\-_]+", "", s)
    return s.upper()


def _build_map(header: list[str]) -> tuple[dict[str, int], list[tuple[int, str]], dict[str, str]]:
    """表头行 → (标准列→列下标, [(选项列下标, 选项字母)], 原始表头→标准列 的说明)。"""
    alias2std = {_norm_head(a): std for std, al in _ALIASES.items() for a in al}
    col2std: dict[str, int] = {}
    opt_cols: list[tuple[int, str]] = []
    mapped_show: dict[str, str] = {}
    for i, raw in enumerate(header):
        h = _norm_head(raw)
        if not h:
            continue
        std = alias2std.get(h)
        if std and std not in col2std:
            col2std[std] = i
            mapped_show[raw.strip()] = std
            continue
        m = _OPT_COL_RE.match(h)
        if m:
            letter = _CIRCLED.get(m.group(1), m.group(1).upper())
            # 「选项1/选项2」这类没有字母的，交给调用方按出现顺序补
            opt_cols.append((i, "" if letter.isdigit() else letter))
            mapped_show[raw.strip()] = "题目选项"
    return col2std, opt_cols, mapped_show


def _looks_like_header(row: list[str]) -> bool:
    col2std, opt_cols, _ = _build_map(row)
    hit = len(col2std) + len(opt_cols)
    # 至少认出一半列，且必须认出「内容 / 题型 / 答案」里的一个，才敢当表头
    enough = hit >= 3 and hit >= max(3, (len(row) + 1) // 2)
    key = any(k in col2std for k in ("题目内容", "题目类型", "题目答案"))
    return enough and key


def _rows_to_std_csv(rows: list[list[str]]) -> tuple[str, dict[str, str]] | None:
    """首行是表头 → 按列名搬成标准 8 列 CSV；不是表头返回 None。"""
    if not rows or not _looks_like_header(rows[0]):
        return None
    col2std, opt_cols, mapped_show = _build_map(rows[0])
    out_rows: list[list[str]] = []
    for row in rows[1:]:
        def pick(std: str) -> str:
            i = col2std.get(std)
            return row[i] if i is not None and i < len(row) else ""

        opts = ""
        if opt_cols:
            parts: list[tuple[str, str]] = []
            for n, (i, letter) in enumerate(opt_cols):
                if i < len(row) and row[i].strip():
                    # 表头自带字母就用它（A/B 之间有空白列时也不会错位），否则按出现顺序补
                    parts.append((letter or chr(65 + n), row[i].strip()))
            if parts:
                opts = "；##".join(f"{k}、{t}" for k, t in parts) + "；"
        else:
            opts = pick("题目选项")

        out_rows.append([
            pick("序号"), pick("项目"), pick("知识点一"), pick("知识点二"),
            pick("题目类型"), pick("题目内容"), opts, pick("题目答案"),
        ])
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(STD_HEADER)
    w.writerows(out_rows)
    return buf.getvalue(), mapped_show


# --------------------------------------------------------------------------
# 唯一入口
# --------------------------------------------------------------------------

def normalize_table_input(raw: bytes) -> tuple[str, str]:
    """上传的任意表格字节 → (标准 8 列 CSV 文本, 给管理员看的说明)。

    认不出来就原样当文本返回（不破坏老格式文件的既有行为）。
    """
    if not raw:
        return "", ""
    kind = sniff_kind(raw)
    notes: list[str] = []

    if kind == "xls":
        raise ValueError(
            "这是老版 Excel（.xls）文件，浏览器读不了。请在 Excel 里「另存为」"
            ".xlsx，或「另存为 → CSV UTF-8（逗号分隔）」，再重新导入。"
        )

    if kind == "xlsx":
        try:
            rows = _xlsx_rows(raw)
        except (zipfile.BadZipFile, ET.ParseError, KeyError) as e:
            raise ValueError(
                f"这个文件标着 Excel 但内容已损坏或不是标准 .xlsx（{type(e).__name__}）："
                "请在 Excel 里重新「另存为」后再导入。"
            )
        if not rows:
            raise ValueError("这个 Excel 文件里没读到数据（可能是空表或只有图表），请检查后重试。")
        notes.append(f"已按 Excel（.xlsx）解析，读取 {len(rows)} 行")
    else:
        text, enc = decode_bytes(raw)
        notes.append(f"文本编码识别为 {enc}")
        rows = [r for r in csv.reader(io.StringIO(text)) if any((c or "").strip() for c in r)]

    if not rows:
        raise ValueError("文件里没读到任何内容（空文件或全是空行），请检查后重试。")

    mapped = _rows_to_std_csv(rows)
    if mapped:
        csv_text, show = mapped
        pairs = [f"{k}→{v}" for k, v in show.items()]
        notes.append(f"已按表头自动对应列：{'、'.join(pairs)}")
        return csv_text, "；".join(notes)

    # 没有表头（或表头认不出）：原样拼成 CSV，交给后面的「按位置解析」老逻辑
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    notes.append("未识别到表头，按标准 8 列顺序解析")
    return buf.getvalue(), "；".join(notes)


def normalize_text_input(text: str) -> tuple[str, str]:
    """粘贴进来的 CSV 文本：只做表头映射（文本已经是 Unicode，无需猜编码）。"""
    if not text or not text.strip():
        return text or "", ""
    rows = [r for r in csv.reader(io.StringIO(text)) if any((c or "").strip() for c in r)]
    mapped = _rows_to_std_csv(rows)
    if mapped:
        csv_text, show = mapped
        pairs = [f"{k}→{v}" for k, v in show.items()]
        return csv_text, f"已按表头自动对应列：{'、'.join(pairs)}"
    return text, ""
