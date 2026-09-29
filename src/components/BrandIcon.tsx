import React from 'react'

/* ============================================================
   品牌 App 图标（NDT-劳人）· 依据官方图标资产包重绘
   - 白色圆角方形底 + 蓝青渐变波形线 + 金色闪电 + 橙色 U 弧 + 浅橙人物剪影
   - 用途：引导页 / 登录页品牌 Logo 的统一来源，以后改图标只改这里
   - 修改注意：保持 viewBox 48x48 与各元素位置，两侧页面无需再改
   ============================================================ */

export function BrandIcon({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        {/* 蓝青渐变：波形线主色 */}
        <linearGradient id="brandWave" x1="0" y1="0" x2="48" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>

      {/* 白色圆角底 + 极淡描边 */}
      <rect x="1" y="1" width="46" height="46" rx="12" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="1.4" />

      {/* 蓝青渐变波形线（两条，模拟超声/心电波形） */}
      <path
        d="M7 20c2.2-4.6 4.4 4.6 6.6 0c2.2-4.6 4.4 4.6 6.6 0c2.2-4.6 4.4 4.6 6.6 0c2.2-4.6 4.4 4.6 6.6 0"
        stroke="url(#brandWave)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M10 26.5c2.5-3.6 5 3.6 7.5 0c2.5-3.6 5 3.6 7.5 0c2.5-3.6 5 3.6 7.5 0"
        stroke="url(#brandWave)"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.5"
      />

      {/* 金色闪电（左上） */}
      <path d="M19 6.5 9.5 19.5h4.6L12 29.5 23 17h-4.8L21.5 6.5z" fill="#F5B93B" />

      {/* 橙色 U 形弧线（左下） */}
      <path d="M9.5 32v4.3a4.6 4.6 0 0 0 9.2 0V32" stroke="#F59E42" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M20.5 32v4.3a4.6 4.6 0 0 0 9.2 0V32" stroke="#F59E42" strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />

      {/* 浅橙人物剪影（右） */}
      <circle cx="39" cy="13" r="4.2" fill="#FDBE6B" />
      <path d="M32 26c0-7.6 14-7.6 14 0z" fill="#FDBE6B" />
    </svg>
  )
}
