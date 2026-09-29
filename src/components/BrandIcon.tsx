import React from 'react'
import brandIcon from '../assets/brand-icon.png'

/* ============================================================
   品牌 App 图标（NDT-劳人）· 用户提供的官方图标资产包原图
   - 从用户发来的资产图精确裁剪（白底圆角 + 蓝青波形线 + 金色闪电 + 金色环形 + 人物剪影）
   - 图片资源：src/assets/brand-icon.png（透明圆角 PNG）
   - 用途：引导页 / 登录页品牌 Logo 的统一来源
   - 注意：图标为横向比例（约 3:2），按高度缩放、宽度自适应，勿用固定方形拉伸
   ============================================================ */

export function BrandIcon({ size = 64 }: { size?: number }) {
  return (
    <img
      src={brandIcon}
      alt="NDT-劳人"
      draggable={false}
      className="w-auto select-none"
      style={{ height: size }}
    />
  )
}
