"""
考生资料的默认随机值 —— 昵称与头像。

职责：
  - random_nickname()：生成一个随机中文昵称（形容词 × 名词 组合）
  - random_avatar()：随机挑一个预设头像 id
  - AVATAR_PRESET_COUNT：预设头像个数

跨端一致常量（改动必须两边同步，见 .modular/backend.md「跨端一致常量」）：
  - 头像值格式：预设为 "preset:<1..N>"，本地上传为 "data:image/...;base64,..."
  - 预设头像的顺序与个数必须与前端 src/data/avatars.ts 的 AVATAR_PRESETS 完全一致，
    前端按 id 里的序号取第几个预设来渲染
  - 空字符串表示没设过头像，前端会退化成「昵称首字」头像

修改注意：
  - 新增 / 删除预设头像时，AVATAR_PRESET_COUNT 与前端 avatars.ts 要一起改，
    否则老账号的 preset:N 会渲染不出来
"""

import secrets

# 预设头像个数（与前端 src/data/avatars.ts 的 AVATAR_PRESETS.length 保持一致）
AVATAR_PRESET_COUNT = 12

# 随机昵称词库：形容词 × 名词 = 12 × 10 = 120 种组合
_ADJECTIVES = (
    "认真",
    "沉稳",
    "敏捷",
    "专注",
    "严谨",
    "踏实",
    "好学",
    "执着",
    "冷静",
    "细致",
    "勤勉",
    "明亮",
)

_NOUNS = (
    "学员",
    "考生",
    "检测员",
    "技师",
    "探头",
    "波形",
    "小匠",
    "书生",
    "探伤工",
    "工程师",
)


def random_nickname() -> str:
    """随机昵称，例如「严谨的检测员」。"""
    return f"{secrets.choice(_ADJECTIVES)}的{secrets.choice(_NOUNS)}"


def random_avatar() -> str:
    """随机预设头像 id，例如 "preset:7"。"""
    return f"preset:{secrets.randbelow(AVATAR_PRESET_COUNT) + 1}"
