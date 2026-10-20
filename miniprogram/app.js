/* ============================================================
   小程序入口 —— 全局做四件事：
     1. 解析「当前该连哪个后端地址」：手动 > 上次连通 > 逐个探测；
        连通后再向该后端要一份最新地址清单（自动跟随管理后台「网络访问」卡片）
     2. 记录「探测诊断」：每个候选地址试完之后的真实结果（被域名校验拦下 /
        网络不通 / 服务异常 / 超时），供兜底页显示精确原因 ——
        专门用来解释「微信开发者工具里正常、真机或 PC 预览空白」这类问题
     3. 检查小程序自身版本更新 + 监听网络状态
     4. 把地址的读 / 写 / 探测 / 开调试能力暴露给页面用

   ⚠️ 这里不做任何界面 —— 界面 100% 由 web-view 里的现有 H5 提供。
   ============================================================ */

const {
  DEFAULT_ENV,
  appUrlOf,
  normalizeAppUrl,
  baseOf,
  probeSeeds,
  HEALTH_PATH,
  ACCESS_INFO_PATH,
} = require('./config/env')

/** 手动填的地址（最高优先级；存在即不做自动探测） */
const SERVER_URL_KEY = 'ndt_server_url'

/** 上次连通的地址（自动记住，探测时排在种子前面） */
const LAST_GOOD_KEY = 'ndt_last_good_url'

/** 后端报过的地址（下次开机先试它们 → 自动跟随后台地址变化） */
const DISCOVERED_KEY = 'ndt_discovered_urls'

/** 单个候选地址的探测超时（连不上一般是立刻失败，不会真等满） */
const PROBE_TIMEOUT = 1800

/** 运行环境代号 → 中文（兜底页诊断用） */
const ENV_VERSION_NAMES = {
  develop: '开发版',
  trial: '体验版',
  release: '正式版',
}

/**
 * 判断一条失败信息是不是「被小程序的域名校验拦下」。
 *
 * ⚠️ 这是解释「工具正常、真机/PC 预览空白」的关键信号：
 *   开发者工具里勾了「不校验合法域名、web-view（业务域名）…」所以放行；
 *   而 **预览 / 体验版 / 正式版是真机环境，强制校验**，未在微信后台配置的域名
 *   会被客户端直接拦掉（wx.request → errMsg 带 "url not in domain list"），
 *   web-view 更严格：还要求 https 且域名已配成「业务域名」。
 */
function isDomainBlocked(msg) {
  const s = String(msg || '').toLowerCase()
  return (
    s.indexOf('domain list') >= 0 ||
    s.indexOf('not in domain') >= 0 ||
    s.indexOf('合法域名') >= 0 ||
    s.indexOf('业务域名') >= 0 ||
    s.indexOf('domain') >= 0 && s.indexOf('fail') >= 0
  )
}

App({
  globalData: {
    /** 当前生效的后端地址（带 /app/） */
    appUrl: '',
    /** 当前是否在线（网络状态监听维护） */
    online: true,
    /** 小程序版本号，显示在兜底页方便排查 */
    version: '1.0.0',
    /** 最近一次从后端拿到的地址清单（兜底页用来给快捷切换按钮） */
    accessInfo: null,
    /** 当前地址从哪来：manual 手动 / cache 缓存 / probe 探测 */
    resolvedFrom: '',
    /** 最近一次探测的完整诊断（兜底页显示，见 index.js 的 failFromProbe） */
    lastProbe: null,
  },

  onLaunch() {
    this.globalData.appUrl = this.peekAppUrl()
    this.watchNetwork()
    this.watchUpdate()
  },

  /* ── 地址读取（不探测，给首屏一个即时值） ────────────────── */

  /** 当前首选地址：手动 > 上次连通 > config 里 DEFAULT_ENV 的地址 */
  peekAppUrl() {
    const manual = wx.getStorageSync(SERVER_URL_KEY)
    if (manual) return manual
    const lastGood = wx.getStorageSync(LAST_GOOD_KEY)
    if (lastGood) return lastGood
    return appUrlOf(DEFAULT_ENV)
  },

  /** 当前生效的 App 地址 */
  getAppUrl() {
    return this.peekAppUrl()
  },

  /** 是否走的是「手动填的地址」 */
  hasCustomAppUrl() {
    return !!wx.getStorageSync(SERVER_URL_KEY)
  },

  /** 手改地址（兜底页「修改服务器地址」用）；传空字符串 = 恢复自动探测 */
  setAppUrl(raw) {
    const url = normalizeAppUrl(raw)
    if (url) wx.setStorageSync(SERVER_URL_KEY, url)
    else wx.removeStorageSync(SERVER_URL_KEY)
    this.globalData.appUrl = this.peekAppUrl()
    return this.globalData.appUrl
  },

  /**
   * 记一个「别人分享来的」地址：只加进候选列表（不作为手填地址），
   * 所以不阻断自动探测 —— 连得上就用、连不上自动跳过。
   * 用途：真机首次没有任何缓存时，靠分享链接把电脑局域网地址带过去。
   */
  hintAppUrl(raw) {
    const url = normalizeAppUrl(raw)
    if (!url) return ''
    const learned = wx.getStorageSync(DISCOVERED_KEY)
    const list = Array.isArray(learned) ? learned.filter((u) => u !== url) : []
    list.unshift(url)
    wx.setStorageSync(DISCOVERED_KEY, list)
    return url
  },

  /**
   * 适合「发给别的设备」的地址：优先局域网，其次公网。
   * （本机 127.0.0.1 对别的设备没有意义，所以不返回）
   */
  shareServer() {
    const info = this.globalData.accessInfo
    if (!info) return ''
    if (info.lan && info.lan.enabled && info.lan.app_url) return info.lan.app_url
    if (info.public && info.public.available && info.public.app_url) return info.public.app_url
    return ''
  },

  /* ── 运行环境信息（兜底页诊断用） ───────────────────────── */

  /** 平台 / 基础库 / 开发版-体验版-正式版 / AppID —— 排查问题时一眼看懂 */
  runtimeInfo() {
    const out = {
      platform: 'unknown',
      platformText: '未知',
      envVersion: '',
      envVersionText: '',
      sdkVersion: '',
      appId: '',
      devtools: false,
    }
    try {
      const s = wx.getSystemInfoSync()
      out.platform = s.platform || 'unknown'
      out.sdkVersion = s.SDKVersion || ''
    } catch (err) {
      /* 拿不到就留空 */
    }
    try {
      const acc = wx.getAccountInfoSync()
      if (acc && acc.miniProgram) {
        out.envVersion = acc.miniProgram.envVersion || ''
        out.appId = acc.miniProgram.appId || ''
      }
    } catch (err) {
      /* 拿不到就留空 */
    }
    out.devtools = out.platform === 'devtools'
    out.platformText = out.devtools ? '开发者工具（模拟器）' : out.platform
    out.envVersionText = ENV_VERSION_NAMES[out.envVersion] || out.envVersion || '未知'
    return out
  },

  /* ── 自动探测（核心） ───────────────────────────────────── */

  /**
   * 解析出一个可用地址；全部连不上时 resolve('')。
   * 无论成功失败，都会把过程写进 globalData.lastProbe（兜底页据此给出精确原因）。
   *
   * @param {{ignoreManual?: boolean}} [opts]
   *        ignoreManual = true 时跳过手填地址（兜底页「自动探测服务器」用）
   * @returns {Promise<string>} 可用的 App 地址（带 /app/）
   */
  resolveAppUrl(opts) {
    const manual = (opts && opts.ignoreManual) ? '' : wx.getStorageSync(SERVER_URL_KEY)

    return this.probeInOrder(this.candidates(opts)).then((state) => {
      this.globalData.lastProbe = {
        at: Date.now(),
        runtime: this.runtimeInfo(),
        online: this.globalData.online,
        tried: state.tried,
        blocked: state.tried.some((t) => t.blocked),
        hit: state.hit,
      }
      if (!state.hit) {
        this.globalData.resolvedFrom = ''
        return ''
      }
      this.remember(state.hit, manual && state.hit === manual ? 'manual' : 'probe')
      this.learnAddresses(state.hit) // 顺手向后端要最新地址清单（不阻塞返回）
      return state.hit
    })
  },

  /**
   * 候选地址顺序：手填 → 上次连通 → config 种子 → 后端曾报过的地址（去重）。
   *
   * ⚠️ 手填地址也照样走探测（而不是直接用）—— 这样万一它被域名校验拦下 / 写错了，
   *    兜底页能拿到真实原因，而不是把一个加载不出来的地址塞给 web-view（那才是白屏）。
   */
  candidates(opts) {
    const out = []
    const push = (u) => {
      if (u && out.indexOf(u) < 0) out.push(u)
    }
    if (!(opts && opts.ignoreManual)) push(wx.getStorageSync(SERVER_URL_KEY))
    push(wx.getStorageSync(LAST_GOOD_KEY))
    probeSeeds().forEach(push)
    const learned = wx.getStorageSync(DISCOVERED_KEY)
    if (Array.isArray(learned)) learned.forEach(push)
    return out
  },

  /**
   * 依次探测：串行，先试最可能的，命中即停（避免一堆无谓请求）。
   * 返回 { hit, tried }：hit = 可用地址（没有则 ''）；tried = 每个候选的探测结果。
   */
  probeInOrder(list) {
    return list.reduce(
      (chain, url) =>
        chain.then((state) => {
          if (state.hit) return state
          return this.probe(url).then((res) => {
            state.tried.push(res)
            if (res.ok) state.hit = url
            return state
          })
        }),
      Promise.resolve({ hit: '', tried: [] })
    )
  },

  /**
   * 探一个地址：/api/health 返回 200 就算通。
   * @returns {Promise<{url, ok, statusCode, errMsg, blocked}>}
   *          blocked = 被小程序域名校验拦下（真机 / 预览 / 体验版的常见坑）
   */
  probe(appUrl) {
    const base = baseOf(appUrl)
    if (!base) {
      return Promise.resolve({ url: appUrl, ok: false, statusCode: 0, errMsg: '地址不合法', blocked: false })
    }
    return new Promise((resolve) => {
      wx.request({
        url: base + HEALTH_PATH,
        method: 'GET',
        timeout: PROBE_TIMEOUT,
        success: (res) => {
          const ok = res.statusCode === 200
          resolve({
            url: appUrl,
            ok,
            statusCode: res.statusCode,
            errMsg: ok ? '' : 'HTTP ' + res.statusCode,
            blocked: false,
          })
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '请求失败'
          resolve({
            url: appUrl,
            ok: false,
            statusCode: 0,
            errMsg: msg,
            blocked: isDomainBlocked(msg),
          })
        },
      })
    })
  },

  /* ── 自动跟随：向后端要最新地址清单 ─────────────────────── */

  /**
   * 拉 /api/access-info（本机 / 局域网 / 公网，与后台「网络访问」卡片同源），
   * 存进本机缓存，供下次开机优先探测 —— 这就是「跟着管理员页面的地址实时更新」。
   */
  learnAddresses(appUrl) {
    const base = baseOf(appUrl)
    if (!base) return
    wx.request({
      url: base + ACCESS_INFO_PATH,
      method: 'GET',
      timeout: 5000,
      success: (res) => {
        const info = res.data
        if (!info || !info.ok) return
        this.globalData.accessInfo = info
        wx.setStorageSync(DISCOVERED_KEY, this.addressList(info))
      },
      fail: () => {}, // 拉不到不影响主流程，下次再试
    })
  },

  /** 从 access-info 挑出可用地址，顺序 = 局域网 → 公网 → 本机（真机优先能通的） */
  addressList(info) {
    const out = []
    const push = (u) => {
      if (u && out.indexOf(u) < 0) out.push(u)
    }
    push(info.lan && info.lan.enabled && info.lan.app_url)
    push(info.public && info.public.available && info.public.app_url)
    push(info.local && info.local.app_url)
    return out
  },

  /** 记住一个连通成功的地址 */
  remember(url, from) {
    this.globalData.appUrl = url
    this.globalData.resolvedFrom = from
    wx.setStorageSync(LAST_GOOD_KEY, url)
    return url
  },

  /* ── 调试模式（真机预览看效果的免费解法） ───────────────── */

  /**
   * 开启「调试模式」：手机上会临时放开域名校验与 HTTPS 证书校验，
   * 之后 web-view 才能加载未配置业务域名的地址（局域网 IP / http 都行）。
   *
   * ⚠️ 仅对「开发版 / 体验版」有效；正式版调用会失败 —— 正式发布必须老老实实
   *    配 HTTPS 业务域名（且小程序主体不能是个人）。
   * @returns {Promise<{ok, errMsg}>}
   */
  enableDebug() {
    return new Promise((resolve) => {
      if (!wx.setEnableDebug) {
        return resolve({ ok: false, errMsg: '当前基础库不支持 wx.setEnableDebug（需 2.15.0+）' })
      }
      wx.setEnableDebug({
        enableDebug: true,
        success: () => resolve({ ok: true, errMsg: '' }),
        fail: (err) =>
          resolve({ ok: false, errMsg: (err && err.errMsg) || '开启失败（正式版不支持）' }),
      })
    })
  },

  /* ── 网络状态 ──────────────────────────────────────────── */

  watchNetwork() {
    wx.getNetworkType({
      success: (res) => {
        this.globalData.online = res.networkType !== 'none'
      },
    })
    wx.onNetworkStatusChange((res) => {
      this.globalData.online = res.isConnected
      if (!res.isConnected) {
        wx.showToast({ title: '网络已断开', icon: 'none' })
      }
    })
  },

  /* ── 小程序版本更新 ─────────────────────────────────────── */

  watchUpdate() {
    if (!wx.getUpdateManager) return
    const manager = wx.getUpdateManager()
    manager.onUpdateReady(() => {
      wx.showModal({
        title: '发现新版本',
        content: '新版本已下载完成，需要重启小程序生效。',
        confirmText: '立即重启',
        success: (res) => {
          if (res.confirm) manager.applyUpdate()
        },
      })
    })
    manager.onUpdateFailed(() => {
      wx.showToast({ title: '新版本下载失败，请稍后重试', icon: 'none' })
    })
  },
})
