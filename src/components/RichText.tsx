import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { hasRichImage, splitRichText } from '../data/richText'
import { questionImageUrl } from '../api/client'

/* ============================================================
   题目富文本渲染 —— 把题干 / 选项 / 答案解析里的 [[img:xxx]] 换成图片
   ------------------------------------------------------------
   用法：凡是显示题目文字的地方（题干、选项、参考答案、解析）都套一层
        <RichText text={...} />，不要直接 {text}，否则图片标记会原样漏出来。

   统一显示规则（全站一致，改这里就全改）：
     - md / lg：一段文字里的所有图片收进一个**固定高度**的滚动区
       （md 200px / lg 260px），每张图在区里**固定占位**等比缩放
       （md 160px / lg 220px 高，不裁剪都能看到），右侧滚动条常驻不隐藏
     - sm（列表摘要）：保持行内小图（120px），不套区，行高紧凑
     - 点图片 → 全屏看大图（点击不会顺手选中选项：组件内部 stopPropagation）
     - 图片取不到 → 回落到「图片已丢失」灰框，不留白块

   修改注意：
     - 图片地址走 client.questionImageUrl（令牌在 ?token= 上），别再单独拼 URL
     - 大图浮层用 createPortal 挂到 body：题目卡片上有 transform 动画，
       直接固定定位会被当成包含块，浮层会跑偏
     - 摘要/列表（首页最近练习、错题本）用 data/richText.ts 的 stripRichText，不要用本组件
     - 后台是同一套规则（server/static/dashboard.js 的 richTextHtml + style.css
       的 .rt-img-area）—— 改一边必须同步另一边
   ============================================================ */

/** 图片显示高度上限（px，仅 sm 行内小图用） */
const MAX_HEIGHT: Record<'sm' | 'md' | 'lg', number> = { sm: 120, md: 180, lg: 260 }
/** 固定插图区高度（px）：一段文字里的所有图片都装进这个区，滚动看全 */
const AREA_HEIGHT: Record<'md' | 'lg', number> = { md: 200, lg: 260 }
/** 区内每张图的固定占位高（px）：等比缩放不裁剪，所有图同一大小 */
const IMG_HEIGHT: Record<'md' | 'lg', number> = { md: 160, lg: 220 }

interface RichTextProps {
  text?: string | null
  /** 图片高度档位：md（默认，区内 160px）/ sm（紧凑行内小图 120px）/ lg（区内 220px） */
  size?: 'sm' | 'md' | 'lg'
  /** 关掉「点击看大图」（浮层里再嵌一次 RichText 时用，避免套娃） */
  noZoom?: boolean
}

export function RichText({ text, size = 'md', noZoom = false }: RichTextProps) {
  const [zoomName, setZoomName] = useState<string | null>(null)
  const [broken, setBroken] = useState<Record<string, boolean>>({})

  // 大图打开时锁住页面滚动
  useEffect(() => {
    if (!zoomName) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [zoomName])

  // 没有图片标记 → 纯文本快路径，输出与原来完全一致（不改动行高 / 换行行为）
  if (!hasRichImage(text)) return <>{text}</>

  const segments = splitRichText(text)
  const inArea = size !== 'sm' // sm（列表摘要）保持行内小图，不套固定区
  const maxH = MAX_HEIGHT[size]

  // 归组：连续的图片（中间只隔空白）收进同一个固定区；文字段照常渲染
  type Block = { kind: 'text'; value: string } | { kind: 'imgs'; names: string[] }
  const blocks: Block[] = []
  for (const seg of segments) {
    if (seg.type === 'img') {
      const lastBlock = blocks[blocks.length - 1]
      if (lastBlock && lastBlock.kind === 'imgs') lastBlock.names.push(seg.value)
      else blocks.push({ kind: 'imgs', names: [seg.value] })
    } else if (inArea && seg.value.trim() === '' && blocks.length > 0 && blocks[blocks.length - 1].kind === 'imgs') {
      // 图片之间的纯空白并进图组，不在区外残留空行
      continue
    } else {
      blocks.push({ kind: 'text', value: seg.value })
    }
  }

  const areaH = inArea ? AREA_HEIGHT[size] : 0
  const imgH = inArea ? IMG_HEIGHT[size] : 0

  /** 一张插图：区内 = 固定占位等比缩放；区外（sm）= 原来的行内小图 */
  const renderImg = (name: string, key: string) =>
    broken[name] ? (
      <span
        key={key}
        className={`inline-flex items-center justify-center text-xs rounded-xl ${inArea ? '' : 'my-1'}`}
        style={{
          width: inArea ? '100%' : undefined,
          minWidth: inArea ? undefined : 120,
          height: inArea ? imgH : 72,
          padding: '0 14px',
          background: 'var(--surface-warm)',
          border: '1px dashed var(--line-strong)',
          color: 'var(--text-3)',
        }}
      >
        图片已丢失
      </span>
    ) : (
      <img
        key={key}
        src={questionImageUrl(name)}
        alt="题目插图"
        loading="lazy"
        className={inArea ? 'block' : 'block my-1.5'}
        title={noZoom ? undefined : '点击查看大图'}
        onError={() => setBroken(prev => ({ ...prev, [name]: true }))}
        onClick={(e) => {
          // noZoom（答题中的选项图）：不放大、也不拦截点击——点图 = 正常选中这个选项
          if (noZoom) return
          // 选项卡片整块可点：看图不该顺手把选项也选了
          e.stopPropagation()
          setZoomName(name)
        }}
        style={{
          width: inArea ? '100%' : 'auto',
          height: inArea ? imgH : 'auto',
          maxWidth: '100%',
          maxHeight: inArea ? undefined : maxH,
          objectFit: 'contain',
          borderRadius: 12,
          border: '1px solid var(--line)',
          background: 'var(--surface-warm)',
          cursor: noZoom ? 'default' : 'zoom-in',
        }}
      />
    )

  return (
    <>
      {blocks.map((b, i) =>
        b.kind === 'text' ? (
          <span key={i}>{b.value}</span>
        ) : inArea ? (
          // 固定插图区：所有图片装进同一块固定高度的区域，右侧滚动条常驻（CSS 在 index.css）
          <div key={i} className="rt-img-area" style={{ height: areaH }}>
            {b.names.map((n) => renderImg(n, `${i}-${n}`))}
          </div>
        ) : (
          <Fragment key={i}>{b.names.map((n) => renderImg(n, `${i}-${n}`))}</Fragment>
        ),
      )}

      {zoomName && createPortal(
        <div
          onClick={() => setZoomName(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(12,14,16,0.82)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px',
            cursor: 'zoom-out',
          }}
        >
          <img
            src={questionImageUrl(zoomName)}
            alt="题目插图"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '94vw',
              maxHeight: '84vh',
              objectFit: 'contain',
              borderRadius: 14,
              background: '#fff',
              boxShadow: '0 12px 48px rgba(0,0,0,0.45)',
            }}
          />
          <p className="text-xs mt-4" style={{ color: 'rgba(255,255,255,0.72)' }}>
            点图片外任意处关闭
          </p>
        </div>,
        document.body,
      )}
    </>
  )
}
