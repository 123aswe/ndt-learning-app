/* ============================================================
   题目富文本 —— 题干 / 选项 / 答案解析里的图片解析
   ------------------------------------------------------------
   背景：有些题（识图题、粗糙度符号、公式）光靠文字说不清，需要在题目里放图。
   做法：题目文本仍是纯文本，图片以内嵌标记 [[img:qimg_xxx.png]] 写在文字里，
        由 RichText 组件换成 <img>；后台是同一套标记（server/static/dashboard.js 的 richTextHtml）。

   修改注意：
     1. 标记语法只有一种：[[img:已存盘文件名]]，文件名由后端 upload_utils.is_question_image_name()
        生成（qimg_ + 16 位十六进制 + 扩展名）。前端只做**格式**校验，不判断文件是否存在，
        图片丢了靠 <img> 的 onError 回落到「图片已丢失」占位。
     2. 列表摘要（首页最近练习 / 错题本这类一行两行的场景）用 stripRichText 把标记换成
        「［图片］」，免得摘要里突然冒出一张图。
     3. 新增标记类型（比如以后要支持公式）一律加在这里，别在各页面里各写一套解析。
   ============================================================ */

/** 标记匹配：[[img:文件名]]，文件名限定为安全字符（与后端存盘命名一致） */
const IMG_TOKEN_RE = /\[\[img:([A-Za-z0-9_.-]{1,80})\]\]/g

export interface RichSegment {
  type: 'text' | 'img'
  /** type=text 时是文字；type=img 时是图片文件名 */
  value: string
}

/** 文本里有没有图片标记（没有就走纯文本快路径，省掉一次切分） */
export function hasRichImage(text?: string | null): boolean {
  if (!text) return false
  IMG_TOKEN_RE.lastIndex = 0
  return IMG_TOKEN_RE.test(text)
}

/** 把文本切成「文字段 / 图片段」的有序列表（图片段之间是纯文字，换行原样保留） */
export function splitRichText(text?: string | null): RichSegment[] {
  const raw = text ?? ''
  if (!raw) return []
  const segments: RichSegment[] = []
  let last = 0
  IMG_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMG_TOKEN_RE.exec(raw)) !== null) {
    if (m.index > last) segments.push({ type: 'text', value: raw.slice(last, m.index) })
    segments.push({ type: 'img', value: m[1] })
    last = m.index + m[0].length
  }
  if (last < raw.length) segments.push({ type: 'text', value: raw.slice(last) })
  return segments
}

/** 摘要用：把图片标记换成「［图片］」（列表里一行两行显示不下图，给个文字提示） */
export function stripRichText(text?: string | null): string {
  if (!text) return ''
  return text.replace(IMG_TOKEN_RE, '［图片］')
}
