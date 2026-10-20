/* ============================================================
   环境配置 —— 小程序要连到哪个后端
   ------------------------------------------------------------
   策略：**自动探测 + 自动跟随**（正常情况下不需要手改任何东西）

     1. 先试「你手动填过的地址」（填过就优先用，优先级最高）
     2. 再按下面 ENVS 的顺序逐个试，谁先通（/api/health 返回 200）就用谁
     3. 连通后向该后端要一份「当前可用地址」（GET /api/access-info）——
        内容就是管理后台「网络访问」卡片上显示的那三条地址（本机 / 局域网 / 公网），
        记进本机缓存，下次打开优先试它们

   → 所以后台那边局域网 IP 变了、公网隧道重启换了地址，小程序下次打开会自动跟上。

   唯一需要手填一次的情况：**真机首次运行**（手机还不知道电脑的局域网 IP），
   在兜底页点「修改服务器地址」填一次即可，之后就一直记住了。

   ⚠️ 正式发布必须用 https 且域名已在微信后台配置为「业务域名」
      （且小程序主体必须为企业/组织 —— 个人主体不支持 web-view）。
   ============================================================ */

/** 各环境的 App 地址（末尾带 /app/，那是现有 H5 的挂载路径）
 *  留空 = 不预置，交给自动探测（lan / tunnel / cloud 通常都不用填） */
const ENVS = {
  /* ① 本机开发：微信开发者工具里用（工具跑在本机，能直连 127.0.0.1） */
  local: {
    name: '本地服务（本机）',
    appUrl: 'http://127.0.0.1:8000/app/',
  },

  /* ② 手机预览：手机和电脑在同一 WiFi。
        一般不用填 —— 在电脑上连过一次后，后端会把当前局域网地址告诉小程序并记住；
        真机首次使用若探测不到，再手填一次电脑的局域网 IP */
  lan: {
    name: '本地服务（局域网）',
    appUrl: '',
  },

  /* ③ 公网隧道：跑「启动公网访问.bat」拿到的 https 地址。
        TryCloudflare 地址每次重启都会变 → 靠自动探测从后端取，不用手填 */
  tunnel: {
    name: '公网隧道（临时）',
    appUrl: '',
  },

  /* ④ 腾讯云：以后的正式域名（同样可以留空，靠自动探测） */
  cloud: {
    name: '腾讯云服务',
    appUrl: '',
  },
}

/** 默认第一个试哪个环境（本机开发用 local；将来纯云端运行可改成 'cloud'） */
const DEFAULT_ENV = 'local'

/** 探测连通性用的接口（挂在站点根路径，不在 /app/ 下） */
const HEALTH_PATH = '/api/health'

/** 取「当前可用地址」的接口（公开、无需登录，内容 = 后台「网络访问」卡片的三条地址） */
const ACCESS_INFO_PATH = '/api/access-info'

/** 取某个环境的 App 地址；地址为空时回退到默认环境，再回退到本机 */
function appUrlOf(envKey) {
  const picked = ENVS[envKey] || {}
  if (picked.appUrl) return picked.appUrl
  const fallback = ENVS[DEFAULT_ENV] || {}
  if (fallback.appUrl) return fallback.appUrl
  return 'http://127.0.0.1:8000/app/'
}

/** 补全用户手输的地址：没写协议补 http，没写 /app/ 补上 */
function normalizeAppUrl(raw) {
  let url = String(raw || '').trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url
  url = url.replace(/\/+$/, '')
  /* 允许直接填域名 / IP:端口（不带 /app/），自动补全 */
  if (!/\/app(\/|$)/i.test(url)) url = url + '/app/'
  else url = url + '/'
  return url
}

/** App 地址 → 站点根地址：接口都挂在根上（/api/xxx），不在 /app/ 下 */
function baseOf(appUrl) {
  return String(appUrl || '')
    .replace(/\/+$/, '')
    .replace(/\/app$/i, '')
}

/** 自动探测的候选地址（默认环境优先 → 其余环境），自动去空、去重 */
function probeSeeds() {
  const list = []
  const push = (u) => {
    if (u && list.indexOf(u) < 0) list.push(u)
  }
  push(ENVS[DEFAULT_ENV] && ENVS[DEFAULT_ENV].appUrl)
  Object.keys(ENVS).forEach((k) => push(ENVS[k].appUrl))
  return list
}

module.exports = {
  ENVS,
  DEFAULT_ENV,
  HEALTH_PATH,
  ACCESS_INFO_PATH,
  appUrlOf,
  normalizeAppUrl,
  baseOf,
  probeSeeds,
}
