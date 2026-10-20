import React, { useCallback, useEffect, useMemo, useRef } from 'react'

/* ============================================================
   KaraokeLyrics · 移动端卡拉OK「逐字渐变填充」歌词组件
   ------------------------------------------------------------
   数据结构（KRC 口径，酷狗歌词同构）：
     一行 KaraokeLine { start, end, text, chars }
     行内每字 KaraokeChar { text, start, end }   —— 时间单位均为秒
   逐字填充原理（每字一个 <span>，播放中零重排、零重挂载）：
     span 设 background-clip:text + color:transparent（文字挖空成蒙版），
     背景图 = linear-gradient(to right, 高亮色 var(--kr-p), 灰色 var(--kr-p))，
     帧循环里只更新命中 span 的 CSS 变量 --kr-p（0% ~ 100%），
     文字就像进度条一样从左到右被高亮色慢慢填满（不是瞬间变色）。
     改 CSS 变量只触发该 span 的重绘（paint），不触发布局（layout）；
     且「百分比没变」的字完全不碰 DOM —— 这是最大的节流点。
   时间驱动（需求 2 / 8）：
     不依赖 timeupdate 事件本身的频率（浏览器约 4Hz，逐字会卡顿），
     用 requestAnimationFrame 帧循环直接读 audio.currentTime
     （getTime 回调），每帧都是实时时间，填充天然平滑；
     拖动进度条后 currentTime 立即变化 → 下一帧所有字同步刷新（需求 6）。
   自动滚动（需求 5）：
     活动行变化时把该行滚到容器垂直居中（首次瞬时、之后 smooth）。
   ============================================================ */

/* ───────────────────────── KRC 数据结构 ───────────────────────── */

/** 行内单个字：文字 + 自己的起止时间（秒） */
export interface KaraokeChar {
  /** 文字内容（也可能是标点 / 一个词组） */
  text: string
  /** 这个字的开始时间（秒） */
  start: number
  /** 这个字的结束时间（秒），通常等于下一个字的开始时间 */
  end: number
}

/** 一行歌词：行起止时间 + 行内逐字时间轴 */
export interface KaraokeLine {
  /** 行开始时间（秒）；-1 表示无时间轴的静态行（纯文本歌词） */
  start: number
  /** 行结束时间（秒），通常等于下一行的开始时间 */
  end: number
  /** 整行文本（悬浮条 / 列表直接显示用） */
  text: string
  /** 行内逐字时间轴；空数组 = 该行不逐字（整行一起显示） */
  chars: KaraokeChar[]
}

/* ───────────────────────── 歌词解析 ─────────────────────────
   把歌词文本解析成上面的 KRC 结构，按行扫描、自动识别四种形态：
   ① 增强型 LRC：[00:12.50]<00:12.50>爱<00:12.90>到…
      字标签只带开始时间 → 字结束 = 下一个标签的时间；
   ② KRC / QRC 原生：[毫秒开始,毫秒行时长]<毫秒开始,毫秒时长,0>字…
      （也兼容 <mm:ss.xx,毫秒时长> 混写）—— 每字自带开始 + 时长；
   ③ 普通 LRC：只有行时间戳 → 把「本行开始 → 下一行开始」的时长均摊到每个字；
   ④ 纯文本：无任何时间轴 → 静态行（start=-1、chars=[]），不逐字。 */
export function parseKrcLyric(raw: string): KaraokeLine[] {
  /* "mm:ss.frac" → 秒（frac 补齐 3 位当毫秒算） */
  const toSec = (mm: string, ss: string, frac?: string) =>
    Number(mm) * 60 + Number(ss) + (frac ? Number(`0.${frac.padEnd(3, '0')}`) : 0)

  const out: KaraokeLine[] = []
  for (const line of (raw || '').replace(/\r\n?/g, '\n').split('\n')) {
    const text = line.trim()
    if (!text) continue

    /* 行标签形态 A：[mm:ss.xx] / [mm:ss.xx,毫秒行时长] + 正文 */
    const mA = text.match(/^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?(?:,(\d{1,5}))?\]\s*(.*)$/)
    /* 行标签形态 B：KRC 原生 [毫秒开始,毫秒行时长] + 正文（无冒号纯数字） */
    const mB = mA ? null : text.match(/^\[(\d{3,}),(\d{1,6})\]\s*(.*)$/)
    if (!mA && !mB) {
      /* 无行时间戳 → 静态行 */
      out.push({ start: -1, end: -1, text, chars: [] })
      continue
    }

    const start = mA ? toSec(mA[1], mA[2], mA[3]) : Number(mB![1]) / 1000
    const lineDur = mA ? (mA[4] ? Number(mA[4]) / 1000 : -1) : Number(mB![2]) / 1000
    let body = (mA ? mA[5] : mB![3]).trim()
    if (!body) continue

    /* ── 切字标签：<mm:ss.xx> | <mm:ss.xx,毫秒> | <毫秒开始,毫秒时长,0> ── */
    const chars: KaraokeChar[] = []
    if (/<[^<>]+>/.test(body)) {
      let cur = start
      let plain = ''
      for (const seg of body.split(/(<[^<>]+>)/)) {
        if (!seg) continue
        const tm = seg.match(/^<(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?|\d{3,})(?:,(\d{1,6}))?(?:,\d+)*>$/)
        if (tm) {
          /* 字标签：只更新「下一个字的开始时间」；上一个字顺带到此结束 */
          const parts = tm[1].split(/[:.]/)
          cur = parts.length >= 3 ? toSec(parts[0], parts[1], parts[2]) : toSec(parts[0], parts[1])
          continue
        }
        /* 标签之间的正文：逐字符建「字」，开始=cur，结束先占位、下一轮回填 */
        for (const ch of seg) {
          chars.push({ text: ch, start: cur, end: cur })
          plain += ch
        }
      }
      body = plain
      /* 回填每个字的结束 = 下一个字的开始；最后一个字先记到最后标签时间 */
      for (let i = 0; i < chars.length; i++) {
        chars[i].end = i + 1 < chars.length ? chars[i + 1].start : cur
      }
    }

    out.push({ start, end: lineDur > 0 ? start + lineDur : start + 5, text: body, chars })
  }

  /* 收尾扫描：行结束 = 下一行开始；无字标签行均摊；最后一字兜底到行尾 */
  for (let i = 0; i < out.length; i++) {
    const l = out[i]
    if (l.start < 0) continue
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].start >= 0) {
        l.end = out[j].start
        break
      }
    }
    /* 无逐字标签的行：把行时长均摊到每个字 → 也得到标准 KRC 结构 */
    if (l.chars.length === 0 && l.text) {
      const span = Math.max(0.4, l.end - l.start)
      const n = Math.max(1, l.text.length)
      l.chars = l.text.split('').map((ch, k) => ({
        text: ch,
        start: l.start + (span * k) / n,
        end: l.start + (span * (k + 1)) / n,
      }))
    }
    /* 最后一个字的结束兜底 = 行结束（防止最后那个字一直填不满） */
    if (l.chars.length) l.chars[l.chars.length - 1].end = l.end
  }
  return out
}

/* ───────────────────────── 组件 ───────────────────────── */

interface KaraokeLyricsProps {
  /** 歌词（KRC 结构），父层建议 useMemo 缓存解析结果，引用变了才重建 */
  lines: KaraokeLine[]
  /** 读当前播放时间（秒）：直接 () => audioRef.current.currentTime ——
      拖动进度条后下一次 rAF 读到的就是新值，所有字立刻同步（需求 6） */
  getTime: () => number
  /** 是否播放中：播放中跑 rAF 帧循环；暂停时只在 seekSignal 变化时刷一遍 */
  playing?: boolean
  /** 跳转 / 拖动进度条后 +1：即使暂停也立刻刷新一次填充状态（需求 6） */
  seekSignal?: number
  /** 面板高度（px） */
  height?: number
  /** 已唱部分的填充高亮色 */
  fillColor?: string
  /** 未唱部分的灰色 */
  baseColor?: string
  /** 无歌词时的占位文案 */
  emptyText?: string
  /** 点某行歌词回调（可选，做「点行跳播」） */
  onSeekLine?: (index: number, line: KaraokeLine) => void
}

export const KaraokeLyrics: React.FC<KaraokeLyricsProps> = ({
  lines,
  getTime,
  playing = false,
  seekSignal = 0,
  height = 96,
  fillColor = '#3D6E93',
  baseColor = '#A9BACA',
  emptyText = '暂无歌词',
  onSeekLine,
}) => {
  /* DOM 引用全部走 ref（命令式更新，不进 React 状态 → 不触发重渲染） */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lineElsRef = useRef<(HTMLDivElement | null)[]>([])
  const spanRefs = useRef<(HTMLSpanElement | null)[]>([])
  /** 每个字上一次写入的百分比（0~100 整数）：没变就不写 DOM —— 核心节流 */
  const pctCache = useRef<number[]>([])
  /** 上一次活动行在 ranges 里的下标（-1 = 前奏/间奏），相邻推进找行，不做每帧二分 */
  const activeRef = useRef(-1)
  /** 首次居中用瞬时滚动（切歌不漂移），之后都是 smooth */
  const firstCenterRef = useRef(true)
  /* 回调放进 ref：父层每次渲染传新箭头函数也不会重建帧循环 */
  const getTimeRef = useRef(getTime)
  getTimeRef.current = getTime

  /* 每行字符在 spanRefs 一维数组里的起始下标（与渲染同序） */
  const lineOffsets = useMemo(() => {
    let o = 0
    return lines.map((l) => {
      const s = o
      o += l.chars.length
      return s
    })
  }, [lines])
  const totalChars = lineOffsets.length
    ? lineOffsets[lineOffsets.length - 1] + lines[lines.length - 1].chars.length
    : 0

  /* 参与逐字驱动的行区间表（静态行不进表）：
     offset/count = 该行字符在 flat 数组里的区间，line = lines 下标 */
  const ranges = useMemo(
    () =>
      lines
        .map((l, li) => ({
          line: li,
          offset: lineOffsets[li],
          count: l.chars.length,
          start: l.start,
          end: l.end,
        }))
        .filter((r) => r.start >= 0 && r.count > 0),
    [lines, lineOffsets],
  )

  /* 每个字的起止时间拍平进 Float64Array（连续内存，每帧读取零 GC 压力） */
  const charTimes = useMemo(() => {
    const arr = new Float64Array(totalChars * 2)
    lines.forEach((l, li) => {
      const base = lineOffsets[li] * 2
      l.chars.forEach((c, ci) => {
        arr[base + ci * 2] = c.start
        arr[base + ci * 2 + 1] = c.end
      })
    })
    return arr
  }, [lines, lineOffsets, totalChars])

  /* 写一个字的填充百分比：p∈[0,1] → 取整成百分比，与缓存不同才写 CSS 变量 */
  const setPct = useCallback((flatIdx: number, p: number) => {
    const q = p <= 0 ? 0 : p >= 1 ? 100 : Math.round(p * 100)
    if (pctCache.current[flatIdx] === q) return
    pctCache.current[flatIdx] = q
    const el = spanRefs.current[flatIdx]
    if (el) el.style.setProperty('--kr-p', `${q}%`)
  }, [])

  /* 把某行滚到容器垂直居中（需求 5）：
     offsetTop 相对滚动容器（容器 position:relative），
     目标 scrollTop = 行顶 - (容器高 - 行高)/2，首尾行也能居中 */
  const centerLine = useCallback((linesIdx: number) => {
    const c = scrollRef.current
    const el = lineElsRef.current[linesIdx]
    if (!c || !el) return
    const top = el.offsetTop - (c.clientHeight - el.offsetHeight) / 2
    c.scrollTo({ top: Math.max(0, top), behavior: firstCenterRef.current ? 'auto' : 'smooth' })
    firstCenterRef.current = false
  }, [])

  /* 主刷新：把时间 t 同步到所有字的填充状态。
     - 活动行变化（跨行 / 拖动跳行）：整表重算一次（每行百来个字，只在跨行时发生）
     - 同一行内：只算当前行那几个字 —— 每帧的实际 DOM 写入通常只有 1~2 个字 */
  const apply = useCallback(
    (t: number) => {
      const rs = ranges
      if (!rs.length) return
      const ct = charTimes

      /* 1. 找活动行：最后一个 start <= t 的行（从缓存位置相邻推进，不二分） */
      let li = activeRef.current
      if (li >= rs.length) li = rs.length - 1
      if (li < 0) li = 0
      while (li > 0 && t < rs[li].start) li--
      while (li < rs.length - 1 && t >= rs[li + 1].start) li++
      if (t < rs[0].start) li = -1 /* 还在前奏 → 全灰 */

      /* 2. 计算一行内每个字的填充比例并落 DOM */
      const perChar = (r: (typeof rs)[number], tt: number) => {
        for (let i = 0; i < r.count; i++) {
          const s = ct[(r.offset + i) * 2]
          const e = ct[(r.offset + i) * 2 + 1]
          const p = tt < s ? 0 : tt >= e ? 1 : (tt - s) / Math.max(1e-3, e - s)
          setPct(r.offset + i, p)
        }
      }
      /* 整行统一设满 / 清零（跨行 / 跳转时用，比逐字算快） */
      const whole = (r: (typeof rs)[number], p: number) => {
        for (let i = 0; i < r.count; i++) setPct(r.offset + i, p)
      }

      /* 3. 跨行：整表校准 + 居中滚动；同行：只刷新当前行 */
      if (li !== activeRef.current) {
        activeRef.current = li
        for (let ri = 0; ri < rs.length; ri++) {
          if (ri < li) whole(rs[ri], 1)
          else if (ri > li) whole(rs[ri], 0)
          else perChar(rs[li], t)
        }
        if (li >= 0) centerLine(rs[li].line)
      } else if (li >= 0) {
        perChar(rs[li], t)
      }
    },
    [ranges, charTimes, setPct, centerLine],
  )

  /* apply 稳定引用：下面几个 effect 永远调到最新版 apply，又不重建帧循环 */
  const applyRef = useRef(apply)
  applyRef.current = apply

  /* lines 变化（切歌 / 重解析）：重建缓存 → 立即同步一次 → 允许瞬时居中 */
  useEffect(() => {
    pctCache.current = new Array(totalChars).fill(-1)
    activeRef.current = -1
    firstCenterRef.current = true
    applyRef.current(getTimeRef.current())
  }, [ranges, charTimes, totalChars])

  /* 主时间循环（需求 2 / 8）：
     播放中 → rAF 帧循环逐帧刷新（同一帧时间没变就跳过 = 双保险节流）；
     暂停 → 不跑循环，只立刻刷一遍（等 seekSignal 或重新播放再动） */
  useEffect(() => {
    if (!playing) {
      applyRef.current(getTimeRef.current())
      return
    }
    let raf = 0
    let last = -1
    const loop = () => {
      const t = getTimeRef.current()
      if (t !== last) {
        last = t
        applyRef.current(t)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, ranges, charTimes])

  /* 拖动进度条 / 点行跳转（需求 6）：seekSignal 变化 → 立刻全量刷新一遍，
     暂停状态下拖进度条也能看到所有字的填充状态同步跳变 */
  useEffect(() => {
    applyRef.current(getTimeRef.current())
  }, [seekSignal])

  /* 上下留白 = (面板高 - 一行高)/2 左右：首行/末行也能滚到正中间 */
  const spacer = Math.max(0, Math.round(height / 2 - 18))

  /* ── 渲染：结构只在 lines 变化时重建；播放中只改 CSS 变量 ── */
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        height,
        /* 全透明面板（v1.66）：方框自身无色，直接透出页面背景，只留边缘渐隐 */
        background: 'transparent',
        border: 'none',
        /* 四周边缘渐隐（v1.68）：上下 + 左右两层渐变遮罩取交集，歌词滚进/滚出、过长行两端都淡入淡出 */
        maskImage:
          'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%)',
        maskComposite: 'intersect',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%), linear-gradient(to right, transparent 0%, #000 12%, #000 88%, transparent 100%)',
        WebkitMaskComposite: 'source-in',
      }}
    >
      <div
        ref={scrollRef}
        /* position:relative 让行元素的 offsetTop 以内容坐标计算，居中公式才准 */
        className="relative h-full overflow-y-auto"
        /* 高亮色 / 灰色挂在容器 CSS 变量上，所有字共享 */
        style={{ '--kr-fill': fillColor, '--kr-base': baseColor } as React.CSSProperties}
      >
        {lines.length === 0 ? (
          <p className="flex h-full items-center justify-center text-[14px]" style={{ color: baseColor }}>
            {emptyText}
          </p>
        ) : (
          <>
            <div style={{ height: spacer }} />
            {lines.map((l, li) => (
              <div
                key={li}
                ref={(el) => {
                  lineElsRef.current[li] = el
                }}
                onClick={l.start >= 0 && onSeekLine ? () => onSeekLine(li, l) : undefined}
                className="px-4 py-[5px] text-center text-[15px] font-semibold leading-6"
                style={{ color: baseColor, cursor: l.start >= 0 && onSeekLine ? 'pointer' : undefined }}
              >
                {l.chars.length === 0
                  ? /* 静态行：无逐字时间轴，整行灰色显示 */
                    l.text
                  : l.chars.map((c, ci) => {
                      const flat = lineOffsets[li] + ci
                      return (
                        <span
                          key={ci}
                          ref={(el) => {
                            spanRefs.current[flat] = el
                          }}
                          /* 填充核心（需求 3 / 4）：
                             背景以 --kr-p 为分界：左高亮、右灰，
                             background-clip:text 把背景挖进文字形状里；
                             --kr-p 从 0% 长到 100% = 从左到右填充该字 */
                          style={{
                            backgroundImage:
                              'linear-gradient(to right, var(--kr-fill) var(--kr-p, 0%), var(--kr-base) var(--kr-p, 0%))',
                            WebkitBackgroundClip: 'text',
                            backgroundClip: 'text',
                            color: 'transparent',
                            WebkitTextFillColor: 'transparent',
                          }}
                        >
                          {c.text}
                        </span>
                      )
                    })}
              </div>
            ))}
            <div style={{ height: spacer }} />
          </>
        )}
      </div>
    </div>
  )
}

export default KaraokeLyrics
