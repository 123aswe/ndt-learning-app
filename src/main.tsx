import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initTheme } from './theme'
import { initSkin } from './themeStore'
import './index.css'

// 渲染前先定主题，避免首屏浅色闪一下
initTheme()
// 「主题商店」选中的皮肤在渲染前贴上（改配色 + 铺背景图 + 定明暗基调），避免首屏闪一下
initSkin()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
