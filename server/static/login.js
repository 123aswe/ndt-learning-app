/* ============================================================
   管理后台 · 登录页逻辑
   流程：提交 → POST /api/auth/admin/login → 存 token → 跳 dashboard.html
   ============================================================ */

(function () {
  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('error');
  const submitBtn = document.getElementById('submit');

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
  }

  function hideError() {
    errorBox.classList.add('hidden');
  }

  // 已登录直接进后台
  if (getToken()) {
    location.href = 'dashboard.html';
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideError();

    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!username || !password) {
      showError('请输入账号和密码');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '登录中…';
    try {
      const data = await api('/api/auth/admin/login', {
        method: 'POST',
        auth: false,
        body: { username, password },
      });
      setToken(data.token, data.admin);
      location.href = 'dashboard.html';
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '登录';
    }
  });
})();
