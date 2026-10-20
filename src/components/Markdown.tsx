import React, { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/* ============================================================
   轻量 Markdown 渲染器 —— 专供 AI 输出（题目解析 / 视频概括）使用

   为什么不用成熟库：AI 输出的格式范围是可控的（我们自己的提示词就要求了
   「**加粗** + - 列表」这套），为它引一个 markdown-it + 高亮包不划算，
   而且第三方渲染器默认允许原始 HTML，安全上还得多一步过滤。

   支持范围（刻意克制，超出的一律按普通文本原样显示）：
     # ## ### 标题        **加粗**        *斜体*        `行内代码`
     - / * / • 无序列表    1. 有序列表     > 引用        --- 分割线
     LaTeX 公式（v1.86，KaTeX 渲染）：
       \( … \) 或 $…$   行内公式，如 \( T_{1/2} = \frac{\ln(2)}{\lambda} \)
       \[ … \] 或 $$…$$ 块级公式（独占一行时整体居中、可横向滑动）
     段落（空行分隔）+ 段内换行

   修改注意：
     - 组件里一律用 var(--token)，深色模式靠令牌自动适配，不要写死颜色
     - 解析在 useMemo 里做，流式追加文本时每帧都会重算，别塞进大循环之外的副作用
     - 公式渲染用 katex.renderToString（throwOnError:false，解析失败原样显示文本，
       不会把整段讲解弄白屏）；样式微调在 index.css 的 .md-katex* 两个类
   ============================================================ */

interface MarkdownProps {
  text: string
  /** 正文基础字号（AI 面板里用 text-xs / text-sm 传入） */
  className?: string
  style?: React.CSSProperties
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'latex'; tex: string }
  | { kind: 'hr' }
  | { kind: 'p'; text: string }

/* ── LaTeX 公式（v1.86）──────────────────────────────────────
   AI 最常输出的两种定界符都认：\( … \) / \[ … \]（LaTeX 原生）与
   $…$ / $$…$$（简写）。公式 token 永远排在 markdown token 之前匹配，
   避免 \(a*b*\) 这类内容被斜体规则切坏。 */
const LATEX_RE =
  /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^\s$][^$\n]*?\$)/
const INLINE_RE =
  /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$[^\s$][^$\n]*?\$|\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g

/** 整行就是一个块级公式（\[…\] / $$…$$）→ 不包段落，独立居中显示 */
function latexOnlyLine(line: string): string | null {
  const m = /^\s*(\\\[[\s\S]*\\\]|\$\$[\s\S]*\$\$)\s*$/.exec(line)
  return m ? m[1] : null
}

function extractTex(token: string): { tex: string; display: boolean } {
  if (token.startsWith('\\[') || token.startsWith('$$')) {
    return { tex: token.slice(2, -2).trim(), display: true }
  }
  if (token.startsWith('\\(')) {
    return { tex: token.slice(2, -2).trim(), display: false }
  }
  return { tex: token.slice(1, -1).trim(), display: false } // $ … $
}

/** KaTeX → HTML。解析失败回落成行内代码样式，绝不抛异常打断渲染 */
function renderLatex(token: string, key: string): React.ReactNode {
  const { tex, display } = extractTex(token)
  let html = ''
  try {
    html = katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'html' })
  } catch {
    return (
      <code key={key} style={{ background: 'var(--field-bg)', color: 'var(--accent)', borderRadius: 6, padding: '1px 5px', fontSize: '0.92em' }}>
        {tex}
      </code>
    )
  }
  if (display) {
    return <div key={key} className="md-katex-display" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <span key={key} className="md-katex" dangerouslySetInnerHTML={{ __html: html }} />
}

/** 行内解析：LaTeX 公式 / **加粗** / *斜体* / `代码` */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = INLINE_RE
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${i++}`
    if (LATEX_RE.test(token)) {
      nodes.push(renderLatex(token, key))
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} style={{ color: 'var(--text-1)', fontWeight: 700 }}>
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          style={{
            background: 'var(--field-bg)',
            color: 'var(--accent)',
            borderRadius: 6,
            padding: '1px 5px',
            fontSize: '0.92em',
            fontWeight: 600,
          }}
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      nodes.push(
        <em key={key} style={{ fontStyle: 'italic', color: 'var(--text-1)' }}>
          {token.slice(1, -1)}
        </em>,
      )
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function parseBlocks(source: string): Block[] {
  const lines = (source || '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join('\n') })
      para = []
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    // 空行 = 段落分隔
    if (!trimmed) {
      flushPara()
      continue
    }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara()
      blocks.push({ kind: 'hr' })
      continue
    }

    // 块级公式（v1.86）：整行只有 \[ … \] 或 $$ … $$ 时独立成块（居中显示，不夹在段落里）
    const loneLatex = latexOnlyLine(trimmed)
    if (loneLatex) {
      flushPara()
      blocks.push({ kind: 'latex', tex: loneLatex })
      continue
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushPara()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }

    // 引用
    if (/^>\s?/.test(trimmed)) {
      flushPara()
      const prev = blocks[blocks.length - 1]
      if (prev && prev.kind === 'quote') prev.text += '\n' + trimmed.replace(/^>\s?/, '')
      else blocks.push({ kind: 'quote', text: trimmed.replace(/^>\s?/, '') })
      continue
    }

    // 无序列表
    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed)
    if (bullet) {
      flushPara()
      const prev = blocks[blocks.length - 1]
      if (prev && prev.kind === 'ul') prev.items.push(bullet[1])
      else blocks.push({ kind: 'ul', items: [bullet[1]] })
      continue
    }

    // 有序列表
    const ordered = /^\d+[.、)]\s+(.*)$/.exec(trimmed)
    if (ordered) {
      flushPara()
      const prev = blocks[blocks.length - 1]
      if (prev && prev.kind === 'ol') prev.items.push(ordered[1])
      else blocks.push({ kind: 'ol', items: [ordered[1]] })
      continue
    }

    para.push(trimmed)
  }
  flushPara()
  return blocks
}

export function Markdown({ text, className = '', style }: MarkdownProps) {
  const blocks = useMemo(() => parseBlocks(text), [text])

  return (
    <div className={className} style={{ color: 'var(--text-2)', ...style }}>
      {blocks.map((block, bi) => {
        const key = `b${bi}`

        if (block.kind === 'hr') {
          return <div key={key} style={{ height: 1, background: 'var(--line)', margin: '10px 0' }} />
        }

        // 独立成块的公式（\[…\] / $$…$$ 整行）：KaTeX display 模式，居中 + 可横向滑动
        if (block.kind === 'latex') {
          return renderLatex(block.tex, key)
        }

        if (block.kind === 'heading') {
          const size = block.level <= 2 ? '0.95em' : block.level === 3 ? '0.88em' : '0.82em'
          return (
            <p
              key={key}
              style={{
                fontSize: size,
                fontWeight: 800,
                color: 'var(--text-1)',
                margin: bi === 0 ? '0 0 6px' : '12px 0 6px',
                letterSpacing: '-0.01em',
              }}
            >
              {renderInline(block.text, key)}
            </p>
          )
        }

        if (block.kind === 'quote') {
          return (
            <div
              key={key}
              style={{
                margin: '8px 0',
                padding: '8px 12px',
                borderRadius: 10,
                background: 'var(--surface-warm)',
                borderLeft: '2px solid var(--accent-border)',
              }}
            >
              {block.text.split('\n').map((t, i) => (
                <p key={`${key}-q${i}`} style={{ lineHeight: 1.7 }}>
                  {renderInline(t, `${key}-q${i}`)}
                </p>
              ))}
            </div>
          )
        }

        if (block.kind === 'ul' || block.kind === 'ol') {
          return (
            <div key={key} style={{ margin: '6px 0' }}>
              {block.items.map((item, i) => (
                <div key={`${key}-${i}`} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                  <span
                    style={{
                      flexShrink: 0,
                      color: 'var(--accent)',
                      fontWeight: 700,
                      minWidth: block.kind === 'ol' ? 16 : 10,
                      lineHeight: 1.7,
                    }}
                  >
                    {block.kind === 'ol' ? `${i + 1}.` : '•'}
                  </span>
                  <span style={{ flex: 1, lineHeight: 1.7 }}>
                    {renderInline(item, `${key}-${i}`)}
                  </span>
                </div>
              ))}
            </div>
          )
        }

        // 段落：段内单个换行也保留（AI 偶尔直接换行分点）
        return (
          <p key={key} style={{ lineHeight: 1.75, margin: bi === 0 ? 0 : '8px 0 0' }}>
            {block.text.split('\n').map((t, i) => (
              <React.Fragment key={`${key}-l${i}`}>
                {i > 0 && <br />}
                {renderInline(t, `${key}-l${i}`)}
              </React.Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
