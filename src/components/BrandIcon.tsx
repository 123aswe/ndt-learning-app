import React from 'react'
import brandGraphics from '../assets/brand-icon-graphics.png'

/* ============================================================
   品牌 App 图标（NDT-劳人）· SVG 混合方案
   - 背景：SVG 矢量绘制（暖白→米色渐变 + 柔光阴影），与页面 #F6F4EE 底色自然融合，
     不再有"贴了一张白底图"的割裂感
   - 图形：嵌入官方图标资产包原图去底后的透明图形层（保证和原图一模一样）
   - 画幅：466x322（原图标比例），按高度缩放、宽度自适应
   ============================================================ */

export function BrandIcon({ size = 64 }: { size?: number }) {
  const w = Math.round((size * 466) / 322)
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 466 322"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="NDT-劳人 品牌图标"
    >
      <defs>
        {/* 图标底：接近页面 #F6F4EE 的米色渐变，上略亮下略沉，与背景融为一体 */}
        <linearGradient id="brandIconBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F9F6F0" />
          <stop offset="1" stopColor="#F2EDE2" />
        </linearGradient>
        {/* 柔光阴影：同色系暖影，仅提供轻微悬浮感 */}
        <filter id="brandIconShadow" x="-30%" y="-40%" width="160%" height="220%">
          <feDropShadow dx="0" dy="8" stdDeviation="12" floodColor="#8A6D3B" floodOpacity="0.10" />
        </filter>
      </defs>

      <rect
        x="0"
        y="0"
        width="466"
        height="322"
        rx="30"
        fill="url(#brandIconBg)"
        filter="url(#brandIconShadow)"
      />
      <image
        href={brandGraphics}
        x="0"
        y="0"
        width="466"
        height="322"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  )
}
