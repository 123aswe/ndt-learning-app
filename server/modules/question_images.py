"""
题目插图模块 —— 让题干 / 选项 / 答案解析里能放图片（识图题、粗糙度符号、公式截图）。

做法：题目文本**仍然是纯文本**，图片以内嵌标记 `[[img:qimg_xxxxxxxxxxxxxxxx.png]]` 的形式
写在文字里；渲染端把这个标记换成 <img>（考生端 src/components/RichText.tsx，
后台 server/static/dashboard.js 的 richTextHtml）。显示尺寸由渲染端统一控制：
最高 180px、宽度不超容器，等比缩放；点一下可看大图。

为什么不把图片直接塞进题目字段：
  - 零数据库迁移：content / options_json 里就是一段字符串，老题目、老导入文件全兼容
  - 一张图能被多道题共用（同一张符号表、同一张工艺图）
  - CSV 导入导出天然可用（标记就是普通文本，能从 Excel 里粘贴进来）

接口：
  管理端（需管理员登录，admin_router）：
    POST   /api/admin/question-images                   上传图片（multipart file）→ {name, markup, url}
    GET    /api/admin/question-images/{name}            取图（后台编辑弹窗预览用）
  考生端（需考生登录，router）：
    GET    /api/bank/question-images/{name}             取图（?token= 传令牌，<img src> 带不了请求头）

修改注意：
  - 存盘与文件名校验都在 modules/upload_utils.py（别在这里另写一份）
  - 文件名只认 upload_utils.is_question_image_name() 认可的形式，防止目录穿越
  - 删题目**不**删图片（同一张图可能被多道题引用），需要清理时单独做
  - 取图接口的路径参数是「已存盘文件名」，不是原始文件名（原始名可能带中文 / 空格）
"""

from fastapi import APIRouter, Depends, File, UploadFile

from deps import get_current_admin, get_current_user
from modules.upload_utils import (
    MAX_QUESTION_IMAGE_MB,
    QUESTION_IMAGE_EXTENSIONS,
    question_image_response,
    save_question_image,
)

admin_router = APIRouter(prefix="/api/admin/question-images", tags=["题库图片"])
router = APIRouter(prefix="/api/bank/question-images", tags=["题库图片"])

# 渲染端认的图片标记：[[img:qimg_xxxxxxxxxxxxxxxx.png]]
MARKUP_TPL = "[[img:{name}]]"


def _url_of(name: str, prefix: str) -> str:
    """给前端用的取图地址（相对路径，跟着站点同源走；考生端不带令牌，前端自己拼）。"""
    return f"{prefix}/{name}"


@admin_router.post("", summary="上传题目插图（题干/选项/答案解析里用）")
async def upload_question_image(
    file: UploadFile = File(..., description="图片文件，支持 jpg/png/webp/gif/bmp，上限 5MB"),
    admin: dict = Depends(get_current_admin),
):
    """返回 {name, markup, url}：markup 就是要粘进题干/选项文本里的那串标记。"""
    name = await save_question_image(file)
    return {
        "ok": True,
        "name": name,
        "markup": MARKUP_TPL.format(name=name),
        "url": _url_of(name, "/api/admin/question-images"),
        "message": f"图片已上传（最大 {MAX_QUESTION_IMAGE_MB}MB，"
                   f"支持 {'、'.join(sorted(QUESTION_IMAGE_EXTENSIONS))}）",
    }


@admin_router.get("/{name}", summary="取题目插图（后台预览）")
def admin_get_question_image(name: str, admin: dict = Depends(get_current_admin)):
    return question_image_response(name)


@router.get("/{name}", summary="取题目插图（考生端）")
def user_get_question_image(name: str, user: dict = Depends(get_current_user)):
    """令牌走 ?token=（浏览器加载 <img src> 时带不了 Authorization 头），与封面图同一口径。"""
    return question_image_response(name)
