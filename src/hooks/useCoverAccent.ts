import { useEffect, useState } from 'react'

/* ============================================================
   useCoverAccent —— 从封面图提取「氛围主色」（音乐播放页按封面动态变色用）

   做两件事：
   1. 有真封面上传时：把封面画进离屏 canvas，采样像素做加权聚类，
      取「主色 + 辅色 + 光晕色」三档（低饱和化处理，保证文字可读）。
   2. 没有封面（走内置 SVG 插画）或取色失败：用调用方传入的兜底色
      （即 track.palette 派生的三档色）。

   返回值全部是 CSS 颜色字符串，直接写进 style 的 --mu-* 变量即可。

   修改注意：
   - 图片跨域（?token= 同源，正常不跨域）取色失败会静默回落兜底色。
   - 结果按 url 缓存到模块级 Map，切歌来回切不会重复解码。
   ============================================================ */

export interface AccentTriple {
  /** 背景渐变起始色（偏亮） */
  a: string
  /** 背景渐变结束色（偏深一点点，仍是淡彩） */
  b: string
  /** 光晕 / 光斑色（半透明） */
  glow: string
}

const cache = new Map<string, AccentTriple>()

/** #RRGGBB → {r,g,b} */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

const clamp = (v: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, v))

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map(v => clamp(Math.round(v)).toString(16).padStart(2, '0'))
      .join('')
  )
}

/** 与白 / 黑混合，level 越大越亮/越暗（level 0~1） */
function mix(hex: string, target: [number, number, number], level: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(
    r + (target[0] - r) * level,
    g + (target[1] - g) * level,
    b + (target[2] - b) * level,
  )
}

const lighten = (hex: string, l: number) => mix(hex, [255, 255, 255], l)
const darken = (hex: string, l: number) => mix(hex, [0, 0, 0], l)

/** 统一压饱和 + 提亮：保证播放页是「淡彩背景 + 深色文字可读」的调性。
    降饱和保留 55% 色度（约 1/3 向灰靠拢）→ 有封面个性又不干扰内容 */
function soften(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  const avg = (r + g + b) / 3
  // 向灰度靠拢 33% → 降饱和但保留主色调个性
  const sr = r + (avg - r) * 0.33
  const sg = g + (avg - g) * 0.33
  const sb = b + (avg - b) * 0.33
  const lift = 202 / Math.max(1, (sr + sg + sb) / 3)
  return rgbToHex(sr * Math.min(1.26, Math.max(0.94, lift)), sg * Math.min(1.26, Math.max(0.94, lift)), sb * Math.min(1.26, Math.max(0.94, lift)))
}

/** 由单个主色派生三档 */
export function deriveTriple(primaryHex: string): AccentTriple {
  const soft = soften(primaryHex)
  return {
    a: lighten(soft, 0.62),
    b: lighten(darken(soft, 0.10), 0.38),
    glow: `${soft}55`, // 33% alpha 光晕
  }
}

/** 从 palette（内置插画配色）派生兜底三档 */
export function paletteTriple(p: { skyTop: string; skyBottom: string; mid: string }): AccentTriple {
  const soft = soften(p.skyBottom)
  const midSoft = soften(p.mid)
  return {
    a: lighten(soften(p.skyTop), 0.35),
    b: lighten(soft, 0.18),
    glow: `${midSoft}4d`,
  }
}

/** 采样封面像素，聚出主色（跳过接近纯白/纯黑的像素） */
function extractPrimary(img: HTMLImageElement): string | null {
  const SIZE = 40 // 缩到 40x40 采样足够，快且稳
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, SIZE, SIZE)
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE)

    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      const pr = data[i]
      const pg = data[i + 1]
      const pb = data[i + 2]
      const pa = data[i + 3]
      if (pa < 128) continue
      const mx = Math.max(pr, pg, pb)
      const mn = Math.min(pr, pg, pb)
      // 跳过接近纯白（过曝）与接近纯黑（死黑）的像素
      if (mx > 246) continue
      if (mn < 14) continue
      // 跳过几乎全灰的像素（没有色彩信息）
      if (mx - mn < 8) continue
      r += pr
      g += pg
      b += pb
      n++
    }
    if (!n) return null
    return rgbToHex(r / n, g / n, b / n)
  } catch {
    return null
  }
}

export function useCoverAccent(
  coverUrl: string,
  fallback: AccentTriple,
): AccentTriple {
  const [triple, setTriple] = useState<AccentTriple>(() =>
    coverUrl && cache.has(coverUrl) ? (cache.get(coverUrl) as AccentTriple) : fallback,
  )

  useEffect(() => {
    if (!coverUrl) {
      // 无真封面：直接用插画派生的兜底色
      setTriple(fallback)
      return
    }
    const cached = cache.get(coverUrl)
    if (cached) {
      setTriple(cached)
      return
    }

    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      if (cancelled) return
      const primary = extractPrimary(img)
      const next = primary ? deriveTriple(primary) : fallback
      cache.set(coverUrl, next)
      setTriple(next)
    }
    img.onerror = () => {
      if (!cancelled) setTriple(fallback)
    }
    img.src = coverUrl

    return () => {
      cancelled = true
    }
    // fallback 是每曲新建对象，不能进依赖（否则每渲染就重跑）；用 URL 作主键
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverUrl])

  return triple
}

/** 供非 Hook 场景（如内联计算）直接使用的派生快捷函数 */
export function tripleForTrack(coverUrl: string, palette: { skyTop: string; skyBottom: string; mid: string }): AccentTriple {
  if (coverUrl && cache.has(coverUrl)) return cache.get(coverUrl) as AccentTriple
  return paletteTriple(palette)
}
