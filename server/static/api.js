/* ============================================================
   管理后台 · 公共脚本（两个页面共用）
   职责：令牌存取、统一的 fetch 封装、提示条
   修改注意：所有接口调用都走 api()，不要各页面自己写 fetch
   ============================================================ */

const TOKEN_KEY = 'ndt_admin_token';
const ADMIN_KEY = 'ndt_admin_info';

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token, admin) {
  localStorage.setItem(TOKEN_KEY, token);
  if (admin) localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
}

function currentAdmin() {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

/**
 * 统一请求封装。
 * 失败时抛出带 status 的 Error，message 已转成中文可直接展示。
 */
async function api(path, options = {}) {
  const { method = 'GET', body, auth = true } = options;
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers['Authorization'] = 'Bearer ' + getToken();

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error('无法连接到服务，请确认 Python 服务已启动');
    err.status = 0;
    err.cause = e;
    throw err;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 204 或非 JSON 响应，忽略 */
  }

  if (!res.ok) {
    // FastAPI 校验错误（422）的 detail 是数组，转成可读文案
    let msg = `请求失败（${res.status}）`;
    if (data && typeof data.detail === 'string') msg = data.detail;
    else if (data && Array.isArray(data.detail) && data.detail.length) {
      msg = data.detail.map(d => d.msg || '参数不合法').join('；');
    } else if (data && data.message) msg = data.message;

    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

/** 401 统一处理：清 token 回登录页 */
function handleAuthError(err) {
  if (err && err.status === 401) {
    clearToken();
    location.href = 'index.html';
    return true;
  }
  return false;
}

/** 右下角轻提示 */
let _toastTimer = null;
function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.remove('hidden');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
}

/** 转义 HTML，避免用户输入把表格结构撑坏 */
function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
