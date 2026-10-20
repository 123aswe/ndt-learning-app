/* ============================================================
   小程序唯一页面 —— web-view 承载现有 H5
   ------------------------------------------------------------
   三个状态（**任何时候都不会出现"白屏"**）：
     loading → 小程序原生的「正在连接」界面（App 还没出来，但用户知道在等）
     ok      → 只渲染 <web-view>，界面 100% 由里面的 H5 提供（与 App 完全一致）
     fail    → web-view 卸载，显示原生兜底页：重连 / 自动探测 / 改地址 /
               快捷地址（内容来自后端 = 后台「网络访问」卡片）/
               「开启调试模式」/ 完整诊断信息

   ⚠️ 为什么要做「诊断信息」和「开启调试模式」按钮：
      微信开发者工具里勾了「不校验合法域名、web-view（业务域名）、TLS 版本以及
      HTTPS 证书」，所以**工具里一切正常**；但「预览 / 体验版 / 正式版」是真机环境，
      **强制域名校验**，未在微信后台配置的地址会被客户端直接拦掉 ——
      wx.request 报 "url not in domain list"，web-view 则直接白屏（还要求 https +
      域名已配成「业务域名」）。本页把这两种情况区分开，并给出对应解法。
   ============================================================ */

const app = getApp()

/** 总超时：探测 + 首屏加载加起来的最长等待（超了就显示兜底页） */
const TIMEOUT_MS = 20000

Page({
  data: {
    /** loading | ok | fail */
    state: 'loading',
    /** 交给 web-view 的地址 */
    url: '',

    /* ── 失败态 ── */
    errTitle: '暂时进不去',
    errDesc: '',
    /** 是否被「域名校验」拦下（决定要不要显示「开启调试模式」按钮） */
    errBlocked: false,
    /** 显示在兜底页的当前地址 */
    appUrl: '',
    /** 是否用的是「手填地址」（决定要不要显示「恢复自动探测」按钮） */
    custom: false,
    /** 后端报过的可用地址，兜底页给「点一下切换」的快捷按钮 */
    suggestions: [],
    /** 诊断信息：[{ k, v }]，排查时直接截图即可 */
    diag: [],
  },

  onLoad(query) {
    // 从「分享链接」打开时可能带着服务器地址（真机首次没有缓存时的救急通道）：
    // 只当候选地址用，探不到就自动跳过，不影响自动探测
    if (query && query.server) {
      try {
        if (app.hintAppUrl(decodeURIComponent(query.server))) {
          wx.showToast({ title: '已带上分享的服务器地址', icon: 'none' })
        }
      } catch (err) {
        // 链接里的地址不合法，忽略即可
      }
    }
    this.bootstrap()
  },

  onShow() {
    // 从后台切回来时如果还停在兜底页，顺手再自动探一次
    if (this.data.state === 'fail') this.bootstrap()
  },

  onUnload() {
    this.clearTimer()
  },

  /* ── 启动：自动探测地址 → 渲染 web-view ─────────────────── */

  /** @param {{ignoreManual?: boolean}} [opts] 透传给 app.resolveAppUrl */
  bootstrap(opts) {
    this.setData({ state: 'loading', url: '' })
    this.startTimer()

    app
      .resolveAppUrl(opts)
      .then((url) => {
        if (!url) return this.failFromProbe()
        this.setData({
          state: 'ok',
          url,
          appUrl: url,
          custom: app.hasCustomAppUrl(),
        })
      })
      .catch((err) => {
        // 兜底：任何意外都换兜底页，绝不留在白屏
        this.failFromProbe(err)
      })
  },

  /* ── web-view 事件 ────────────────────────────────────── */

  onWebLoad() {
    this.clearTimer()
    this.setData({ state: 'ok' })
  },

  onWebError(e) {
    this.clearTimer()
    const detail = (e && e.detail && e.detail.errMsg) || ''
    this.setData({
      state: 'fail',
      url: '',
      errTitle: '页面加载失败',
      errDesc: detail || 'web-view 没能加载这个地址，请换个地址重试。',
      errBlocked: /domain|合法域名|业务域名/i.test(detail),
      appUrl: app.getAppUrl(),
      custom: app.hasCustomAppUrl(),
      suggestions: this.buildSuggestions(),
      diag: this.buildDiag(app.globalData.lastProbe, null, detail),
    })
  },

  /* ── 超时守卫 ─────────────────────────────────────────── */

  startTimer() {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.failFromProbe()
    }, TIMEOUT_MS)
  },

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  },

  /* ── 失败态：把探测结果翻译成人话 ──────────────────────── */

  /** 根据 app.globalData.lastProbe（每个地址的真实探测结果）生成原因与诊断 */
  failFromProbe(extraErr) {
    const p = app.globalData.lastProbe || {}
    const tried = p.tried || []
    const blocked = !!p.blocked
    const rt = p.runtime || app.runtimeInfo()

    let title = '连不上服务器'
    let desc = '已经逐个试过所有已知地址，没有一个能连通。'

    if (blocked) {
      title = '被小程序的域名校验拦下'
      desc =
        '「开发者工具」里勾了「不校验合法域名」，所以工具里一切正常；' +
        '但预览 / 体验版 / 正式版是真机环境，强制校验：没在微信后台配置过的地址会被客户端直接拦掉。'
    } else if (p.online === false) {
      title = '手机当前没有网络'
      desc = '检测到网络已断开，连上 WiFi 或流量后点「重新连接」。'
    } else if (tried.length && tried.every((t) => t.statusCode && t.statusCode !== 200)) {
      title = '服务器没正常响应'
      desc = '地址能连上，但接口返回的不是 200。确认后端已完全启动。'
    } else if (!tried.length) {
      desc = '没有可尝试的地址，请点「修改服务器地址」手填一个，或「自动探测服务器」。'
    }

    if (extraErr) desc += '（' + String((extraErr && extraErr.message) || extraErr) + '）'

    this.clearTimer()
    this.setData({
      state: 'fail',
      url: '',
      errTitle: title,
      errDesc: desc,
      errBlocked: blocked,
      appUrl: app.getAppUrl(),
      custom: app.hasCustomAppUrl(),
      suggestions: this.buildSuggestions(),
      diag: this.buildDiag(p, rt),
    })
  },

  /** 后端报过的地址 → 兜底页快捷按钮（点一下即切换地址重连） */
  buildSuggestions() {
    const info = app.globalData.accessInfo
    if (!info) return []
    const out = []
    const push = (label, u) => {
      if (u && !out.some((x) => x.url === u)) out.push({ label, url: u })
    }
    if (info.local && info.local.app_url) push('本机', info.local.app_url)
    if (info.lan && info.lan.enabled && info.lan.app_url) push('局域网', info.lan.app_url)
    if (info.public && info.public.available && info.public.app_url) {
      push('公网', info.public.app_url)
    }
    return out
  },

  /** 诊断信息：环境 + 每个候选地址的真实结果（截图就能定位问题） */
  buildDiag(probe, runtimeOverride, extra) {
    const p = probe || {}
    const rt = runtimeOverride || p.runtime || app.runtimeInfo()
    const rows = []

    rows.push({ k: '运行环境', v: rt.platformText + (rt.envVersionText ? ' · ' + rt.envVersionText : '') })
    if (rt.sdkVersion) rows.push({ k: '基础库', v: rt.sdkVersion })
    if (rt.appId) rows.push({ k: 'AppID', v: rt.appId })
    rows.push({ k: '网络', v: p.online === false ? '已断开' : '已连接' })
    rows.push({ k: '手填地址', v: app.hasCustomAppUrl() ? '有（优先试它）' : '无（纯自动探测）' })

    const tried = p.tried || []
    if (tried.length) {
      tried.forEach((t) => {
        let v = '连通'
        if (!t.ok) {
          if (t.blocked) v = '被域名校验拦下'
          else if (t.statusCode) v = 'HTTP ' + t.statusCode
          else v = t.errMsg || '连不上'
        }
        rows.push({ k: '试过', v: t.url + ' → ' + v })
      })
    } else {
      rows.push({ k: '试过', v: '（没有可尝试的地址）' })
    }

    if (extra) rows.push({ k: 'web-view', v: extra })
    return rows
  },

  /* ── 兜底页按钮 ───────────────────────────────────────── */

  /** 重新连接：按当前优先级再探一遍（手填地址仍生效） */
  onRetry() {
    this.bootstrap()
  },

  /** 自动探测：忽略手填地址，纯自动找一遍（手填地址填错时用） */
  onAutoDetect() {
    this.bootstrap({ ignoreManual: true })
  },

  /** 点快捷地址：改成它并重连 */
  onPickServer(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    app.setAppUrl(url)
    this.bootstrap()
  },

  /** 手填服务器地址（本地服务 / 局域网 / 公网隧道 / 腾讯云 都在这里切换） */
  onEditServer() {
    wx.showModal({
      title: '服务器地址',
      editable: true,
      placeholderText: '例如 192.168.1.100:8000',
      content: this.data.appUrl || '',
      success: (res) => {
        if (!res.confirm) return
        const saved = app.setAppUrl(res.content)
        if (!saved) {
          wx.showToast({ title: '地址格式不对', icon: 'none' })
          return
        }
        wx.showToast({ title: '已保存', icon: 'success' })
        this.bootstrap()
      },
    })
  },

  /** 恢复自动探测（清掉手填地址） */
  onResetServer() {
    wx.showModal({
      title: '恢复自动探测？',
      content: '将清掉手填的地址，改回自动探测（按 config/env.js 与后端返回的地址）。',
      success: (res) => {
        if (!res.confirm) return
        app.setAppUrl('')
        wx.showToast({ title: '已恢复自动', icon: 'success' })
        this.bootstrap()
      },
    })
  },

  onCopyUrl() {
    if (!this.data.appUrl) return wx.showToast({ title: '没有可复制的地址', icon: 'none' })
    wx.setClipboardData({ data: this.data.appUrl })
  },

  /**
   * 开启「调试模式」——真机上看效果的免费解法。
   * 开了之后手机上会临时放开域名校验 / HTTPS 证书校验，
   * web-view 才能加载未配置业务域名的地址（局域网 IP、http 都行）。
   * 仅对开发版 / 体验版有效。
   */
  onEnableDebug() {
    app.enableDebug().then((res) => {
      if (res.ok) {
        wx.showModal({
          title: '调试模式已开启',
          content: '小程序会自动重启。重启后域名校验就放开了，再看能否加载。',
          showCancel: false,
        })
      } else {
        wx.showModal({
          title: '没能开启调试模式',
          content:
            res.errMsg +
            '\n\n说明当前是正式版（或基础库过低）。正式版必须在微信后台配置 HTTPS 业务域名。',
          showCancel: false,
        })
      }
    })
  },

  /** 复制诊断信息，方便发给开发者 */
  onCopyDiag() {
    const text = this.data.diag.map((d) => d.k + '：' + d.v).join('\n')
    if (!text) return wx.showToast({ title: '没有诊断信息', icon: 'none' })
    wx.setClipboardData({ data: text })
  },

  /* ── 分享 ─────────────────────────────────────────────── */

  /** 分享路径带上当前可用的服务器地址 —— 对方（或自己的手机）打开就能直接连 */
  sharePath() {
    const server = app.shareServer()
    return server
      ? '/pages/index/index?server=' + encodeURIComponent(server)
      : '/pages/index/index'
  },

  onShareAppMessage() {
    return { title: 'NDT 无损检测刷题', path: this.sharePath() }
  },

  onShareTimeline() {
    const server = app.shareServer()
    return server
      ? { title: 'NDT 无损检测刷题', query: 'server=' + encodeURIComponent(server) }
      : { title: 'NDT 无损检测刷题' }
  },
})
