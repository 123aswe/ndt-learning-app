/* ============================================================
   管理后台 · 主界面逻辑
   十一个模块各自独立：管理员账号 / 注册申请 / 考生账号 / 密码重置工单 / 通知管理
                     / 题库管理 / 资料库 / 音乐 / 主题商店 / 纠错工单 / 版本发布
   每个模块都有完整的「查（列表+搜索+分页）/ 增 / 改 / 删」

   修改注意：
   - 所有请求都走 api.js 的 api()；401 统一由 handleAuthError 处理
   - 新增字段时：改下面的表头 row 渲染 + 表单字段 + 提交时的 body
   - 考生登录名是 account（自定义账号），不是手机号
   - 密码重置：考生在 App 提交申请 → 这里处理 → 重置密码并以「系统通知」把新密码发给考生
   - 通知类型：system（考生不可删除）/ notice（考生可删除），由管理员在「通知管理」设置
   - 发送对象：全部启用考生 / 指定考生（可搜索多选，同一次发送里同一个账号只能选一次）
     相关接口见 server/modules/notifications.py 与 server/modules/password_resets.py
   - 新增功能面板三步：dashboard.html 加 <button class="tab" data-panel="x"> 与 <section id="panel-x">，
     这里 bindTabs 的面板数组加 'x'，再写一个 bindXModule() 并在启动处调用
   - 版本发布：写 server/data/version.json + 经实时通道推给在线考生，见 modules/app_update.py
   ============================================================ */

(function () {
  if (!getToken()) {
    location.href = 'index.html';
    return;
  }

  // ── 各模块的查询状态 ──────────────────────────────────────
  const state = {
    admins: { page: 1, pageSize: 20, q: '', status: '', total: 0 },
    registrations: { page: 1, pageSize: 20, q: '', status: '', total: 0 },
    users: { page: 1, pageSize: 20, q: '', status: '', method: '', total: 0 },
    resets: { page: 1, pageSize: 20, q: '', status: '', total: 0 },
    notifies: { page: 1, pageSize: 20, total: 0 },
  };

  const $ = (id) => document.getElementById(id);

  /** 各列表「上移 / 下移」的动作表（素材列表 material/series、题库 qseries/qset/chapter 共用一套按钮）
      放在最上面声明：init() 里 await 之后就会用到，别在文件后段再定义（免得踩 TDZ） */
  const MOVE_ACTIONS = {
    material: (id, dir) => moveMaterial(id, dir),
    series: (id, dir) => moveSeries(id, dir),
    qseries: (id, dir) => moveQuestionSeries(id, dir),
    qset: (id, dir) => moveQuestionSet(id, dir),
    chapter: (id, dir) => moveChapter(id, dir),
    music: (id, dir) => moveMusic(id, dir),
    theme: (id, dir) => moveTheme(id, dir),
  };

  /** 待审核注册申请数 / 待处理密码重置数 / 待处理纠错工单数（renderPending 用） */
  let regsPending = 0;
  let resetsPending = 0;
  let reportsPending = 0;

  /* 「通知管理 → 指定考生」已选账号（顺序即添加顺序；同一个账号只允许出现一次） */
  let notifyPicked = [];

  /* 预设头像 —— 跨端一致常量，改动要同步：
       server/profile_defaults.py（AVATAR_PRESET_COUNT）
       src/data/avatars.ts（AVATAR_PRESETS：图案与配色）
     值格式：preset:N（预设）/ data:image/...（考生自己上传的图片）/ 空（用昵称首字） */
  const AVATAR_PRESETS = [
    { id: 'preset:1',  emoji: '🔬', label: '探头',   from: '#E6F1EF', to: '#C9E0DC' },
    { id: 'preset:2',  emoji: '📐', label: '量角尺', from: '#EDEBF6', to: '#D6D2EA' },
    { id: 'preset:3',  emoji: '🧭', label: '方向',   from: '#E9EFF6', to: '#CBDCEB' },
    { id: 'preset:4',  emoji: '🛠️', label: '工具',   from: '#F2EEE6', to: '#E2D8C3' },
    { id: 'preset:5',  emoji: '🔩', label: '螺栓',   from: '#EDEFF2', to: '#D5DAE0' },
    { id: 'preset:6',  emoji: '📊', label: '数据',   from: '#E8F0EC', to: '#CDE2D5' },
    { id: 'preset:7',  emoji: '🎯', label: '目标',   from: '#F6EDEC', to: '#EBD5D3' },
    { id: 'preset:8',  emoji: '⚡', label: '闪电',   from: '#F6F1E6', to: '#EBDFC2' },
    { id: 'preset:9',  emoji: '🧠', label: '思考',   from: '#F2EAF0', to: '#E3D2DE' },
    { id: 'preset:10', emoji: '🏆', label: '奖杯',   from: '#F5EFE4', to: '#E9DBBE' },
    { id: 'preset:11', emoji: '🌟', label: '星标',   from: '#F1F0E6', to: '#E0DFC4' },
    { id: 'preset:12', emoji: '🚀', label: '出发',   from: '#E9EEF5', to: '#CCD9E9' },
  ];

  /** 渲染头像小圆：预设 → emoji + 渐变底；上传的图片 → <img>；其它 → 破折号 */
  function avatarHtml(value, size) {
    const cls = 'ava' + (size === 'lg' ? ' ava-lg' : '');
    if (value && (value.startsWith('data:image/') || value.startsWith('http'))) {
      return `<img class="${cls}" src="${value}" alt="头像" />`;
    }
    const p = AVATAR_PRESETS.find((x) => x.id === value);
    if (!p) return `<span class="${cls} ava-empty">—</span>`;
    return `<span class="${cls}" style="background:linear-gradient(160deg,${p.from},${p.to})" title="${esc(p.label)}">${p.emoji}</span>`;
  }

  /** 下拉选项：预设头像（value 为空时的含义由调用方决定：新增=随机，编辑=不修改） */
  function avatarOptions() {
    return AVATAR_PRESETS.map((p) => ({ v: p.id, t: `${p.emoji} ${p.label}` }));
  }

  /** 头像的文字说明（弹窗里「当前头像」预览用） */
  function avatarLabel(value) {
    if (value && (value.startsWith('data:image/') || value.startsWith('http'))) return '考生上传的图片';
    const p = AVATAR_PRESETS.find((x) => x.id === value);
    return p ? `预设 · ${p.label}` : '未设置（显示昵称首字）';
  }

  /* ============================================================
     启动
     ============================================================ */
  (async function init() {
    renderWho();
    bindRichImages();
    bindTabs();
    bindAdminModule();
    bindRegistrationModule();
    bindUserModule();
    bindResetModule();
    bindNotifyModule();
    bindQuestionSetModule();
    bindMaterialModule();
    bindMusicModule();
    bindThemeModule();
    bindReportModule();
    bindVersionModule();
    bindChangePassword();
    bindTunnel();
    bindNetwork();

    try {
      await Promise.all([loadMode(), loadStats(), loadTunnel(), loadNetwork()]);
      await Promise.all([loadAdmins(), loadRegistrations(), loadUsers(), loadResets(), loadNotifies(), loadQuestionSeries(), loadQuestionSets(), loadSeries(), loadMaterials(), loadAlbums(), loadMusic(), loadThemes(), loadReports(), loadVersion()]);
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  })();

  /* ============================================================
     顶部信息 / 统计 / 短信模式
     ============================================================ */

  function renderWho() {
    const admin = currentAdmin();
    if (admin) {
      const roleText = admin.role === 'super' ? '超级管理员' : '普通管理员';
      $('who').textContent = `当前登录：${admin.username}（${roleText}）`;
    }
  }

  async function loadMode() {
    const data = await api('/api/auth/sms-mode', { auth: false });
    const pill = $('mode-pill');
    if (data.mode === 'tencent') {
      pill.className = 'mode-pill';
      pill.textContent = '短信：腾讯云已配置';
    } else {
      pill.className = 'mode-pill local';
      pill.textContent = '登录方式：图形验证码';
      const alert = $('mode-alert');
      alert.textContent =
        'ℹ️ 登录与注册已改用图形验证码，不再依赖短信。' +
        '腾讯云短信尚未配置凭证，如需启用请填写 server/config.json。';
      alert.classList.remove('hidden');
    }
  }

  async function loadStats() {
    const data = await api('/api/admin/stats');
    const reg = data.registration || { pending: 0, total: 0, approved: 0, rejected: 0 };
    const reset = data.password_reset || { pending: 0, total: 0 };
    const cards = [
      { k: '待审核注册申请', v: reg.pending, m: `累计提交 ${reg.total} 份` },
      { k: '待处理密码重置', v: reset.pending, m: `累计申请 ${reset.total} 条` },
      { k: '考生账号', v: data.user.total, m: `启用 ${data.user.active} 个 · 今日新增 ${data.user.today_new}` },
      { k: '管理员账号', v: data.admin.total, m: `启用 ${data.admin.active} 个` },
      { k: '活跃会话', v: data.sessions.active, m: '未过期的登录令牌数' },
    ];
    $('stats').innerHTML = cards
      .map(
        (c) => `<div class="stat"><div class="k">${esc(c.k)}</div>
          <div class="v">${esc(c.v)}</div><div class="m">${esc(c.m)}</div></div>`
      )
      .join('');
  }

  /** 顶部「有待审核申请 / 待处理工单」提示 + Tab 上的数量角标
      两个数字由各模块加载时写入，这里只负责渲染 */
  function renderPending() {
    const dot = $('pending-dot');
    const resetDot = $('reset-dot');
    const alert = $('pending-alert');
    const tips = [];

    if (regsPending > 0) {
      dot.textContent = regsPending;
      dot.classList.remove('hidden');
      tips.push(`📋 当前有 ${regsPending} 份注册申请待审核，请到「注册申请」页处理。`);
    } else {
      dot.classList.add('hidden');
    }

    if (resetsPending > 0) {
      resetDot.textContent = resetsPending;
      resetDot.classList.remove('hidden');
      tips.push(`🔐 当前有 ${resetsPending} 条密码重置申请待处理，请到「密码重置」页处理。`);
    } else {
      resetDot.classList.add('hidden');
    }

    const repDot = $('report-dot');
    if (reportsPending > 0) {
      repDot.textContent = reportsPending;
      repDot.classList.remove('hidden');
    } else {
      repDot.classList.add('hidden');
    }

    if (tips.length) {
      alert.textContent = tips.join(' ');
      alert.classList.remove('hidden');
    } else {
      alert.classList.add('hidden');
    }
  }

  /* ============================================================
     Tab 切换
     ============================================================ */

  function bindTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        ['admins', 'registrations', 'users', 'resets', 'notifications', 'questionsets', 'materials', 'music', 'themes', 'reports', 'version'].forEach((name) => {
          $(`panel-${name}`).classList.toggle('hidden', name !== tab.dataset.panel);
        });
      });
    });

    $('btn-logout').addEventListener('click', async () => {
      try {
        await api('/api/auth/logout', { method: 'POST' });
      } catch (e) {
        /* 退出失败也照样清理本地令牌 */
      }
      clearToken();
      location.href = 'index.html';
    });
  }

  /* ============================================================
     公网地址横幅 + 官网入口
     隧道（启动公网访问.bat）的地址由 tools/tunnel.py
     写进项目根「公网地址.txt」，后端 /api/admin/tunnel 负责读出来。
     ============================================================ */

  async function loadTunnel() {
    const banner = $('tunnel-banner');
    try {
      const data = await api('/api/admin/tunnel');
      if (!data.available) {
        banner.classList.remove('hidden');
        $('tunnel-state').textContent = '公网访问：未启动';
        $('tunnel-url').textContent = '';
        $('tunnel-url').removeAttribute('href');
        $('tunnel-time').textContent = '运行项目根目录的「启动公网访问.bat」后会在这里显示地址';
        return;
      }
      banner.classList.remove('hidden');
      $('tunnel-state').textContent = '公网访问';
      $('tunnel-url').textContent = data.app_url;
      $('tunnel-url').href = data.app_url;
      $('tunnel-time').textContent = data.generated_at ? `生成于 ${data.generated_at}` : '';
    } catch (err) {
      if (!handleAuthError(err)) toast('公网地址读取失败：' + err.message);
    }
  }

  function bindTunnel() {
    $('tunnel-copy').addEventListener('click', async () => {
      const url = $('tunnel-url').textContent.trim();
      if (!url) { toast('当前没有可复制的公网地址'); return; }
      try {
        await navigator.clipboard.writeText(url);
        toast('已复制考生端地址');
      } catch (e) {
        // 剪贴板不可用（非 HTTPS / 旧浏览器）时退化为选中文本让用户手动 Ctrl+C
        window.getSelection().selectAllChildren($('tunnel-url'));
        toast('已选中地址，请按 Ctrl+C 复制');
      }
    });
    $('tunnel-refresh').addEventListener('click', loadTunnel);
    $('btn-open-site').addEventListener('click', () => {
      // 官网与后台同源：本地 8000 → http://127.0.0.1:8000/；走隧道 → 当前域名根路径
      window.open('/', '_blank');
    });
  }

  /* ============================================================
     网络访问卡片（局域网开关 + 公网隧道一键启停）
     后端：modules/network.py → /api/admin/network*
     公网地址仍由 /api/admin/tunnel（公网地址.txt）读取，两处联动展示
     ============================================================ */

  let _pubRunning = false;      // 隧道是否运行中（按钮行为依据）
  let _pubPollTimer = null;     // 启动后等地址的轮询定时器

  async function loadNetwork() {
    try {
      const [net, tun] = await Promise.all([
        api('/api/admin/network'),
        api('/api/admin/tunnel').catch(() => null),
      ]);
      renderNetwork(net, tun);
    } catch (err) {
      if (!handleAuthError(err)) toast('网络访问状态读取失败：' + err.message);
    }
  }

  function renderNetwork(net, tun) {
    const lan = net.lan || {};
    renderLan(lan);
    renderPublic(net.public || {}, tun);
  }

  function renderLan(lan) {
    const sw = $('net-lan-switch');
    const stateEl = $('net-lan-state');
    const urlsEl = $('net-lan-urls');
    const tipEl = $('net-lan-tip');
    sw.checked = !!lan.enabled;
    if (lan.enabled && lan.base_url) {
      stateEl.textContent = '已开启';
      stateEl.className = 'net-state on';
      urlsEl.classList.remove('hidden');
      setNetLink('net-lan-app', lan.app_url);
      setNetLink('net-lan-admin', lan.admin_url);
      setNetLink('net-lan-site', lan.site_url);
      tipEl.textContent = '同一 WiFi 下的手机/电脑直接打开即可；首次访问如不通，检查本机防火墙是否放行 Python。';
    } else if (lan.enabled) {
      stateEl.textContent = '已开启';
      stateEl.className = 'net-state on';
      urlsEl.classList.add('hidden');
      tipEl.textContent = '已开启，但没有探测到本机局域网 IP（请确认电脑已连网）。';
    } else {
      stateEl.textContent = '已关闭';
      stateEl.className = 'net-state off';
      urlsEl.classList.add('hidden');
      tipEl.textContent = '关闭时只有这台电脑能访问服务；开启后同一 WiFi 下的设备可直连（比公网快得多）。';
    }
  }

  function setNetLink(id, url) {
    const el = $(id);
    el.textContent = url || '';
    if (url) el.href = url; else el.removeAttribute('href');
  }

  function renderPublic(pub, tun) {
    const btn = $('net-pub-btn');
    const stateEl = $('net-pub-state');
    const tipEl = $('net-pub-tip');
    _pubRunning = !!(pub && pub.running);
    if (_pubRunning) {
      btn.textContent = '停止公网';
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-danger');
      stateEl.textContent = '运行中';
      stateEl.className = 'net-state on';
      tipEl.textContent = (tun && tun.available)
        ? `公网地址：${tun.app_url}（每次启动都会变，以顶部横幅为准）`
        : '隧道连接中，公网地址约 10~40 秒后生成 …';
    } else {
      btn.textContent = '一键启动';
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-danger');
      stateEl.textContent = '未启动';
      stateEl.className = 'net-state off';
      tipEl.textContent = (tun && tun.available)
        ? `最近一次地址：${tun.app_url}（隧道已停止，该地址已失效）`
        : '启动后由 Cloudflare 隧道生成公网地址（每次启动都会变），地址显示在顶部横幅。';
    }
  }

  function bindNetwork() {
    // 局域网开关
    $('net-lan-switch').addEventListener('change', async (e) => {
      const sw = e.target;
      const on = sw.checked;
      sw.disabled = true;
      try {
        const data = await api('/api/admin/network/lan', { method: 'POST', body: { enabled: on } });
        toast(on ? '局域网访问已开启' : '局域网访问已关闭，非本机访问将被拒绝');
        renderLan(data || {});
      } catch (err) {
        sw.checked = !on; // 失败回弹
        if (!handleAuthError(err)) toast('操作失败：' + err.message);
      }
      sw.disabled = false;
    });

    // 复制按钮（三条地址）
    $('net-lan-copy-app').addEventListener('click', () => copyNetText($('net-lan-app').textContent, '已复制考生端局域网地址'));
    $('net-lan-copy-admin').addEventListener('click', () => copyNetText($('net-lan-admin').textContent, '已复制后台局域网地址'));
    $('net-lan-copy-site').addEventListener('click', () => copyNetText($('net-lan-site').textContent, '已复制官网局域网地址'));

    // 公网一键启动 / 停止
    $('net-pub-btn').addEventListener('click', async () => {
      const btn = $('net-pub-btn');
      const stateEl = $('net-pub-state');
      const tipEl = $('net-pub-tip');
      if (_pubRunning) {
        btn.disabled = true;
        try {
          await api('/api/admin/network/public', { method: 'POST', body: { action: 'stop' } });
          toast('公网访问已停止');
        } catch (err) {
          if (!handleAuthError(err)) toast('停止失败：' + err.message);
        }
        btn.disabled = false;
        await loadNetwork();
        return;
      }
      // 启动：先请求后端拉起隧道，再轮询公网地址（隧道连上 + 地址实测通过约需 10~60 秒）
      btn.disabled = true;
      try {
        await api('/api/admin/network/public', { method: 'POST', body: { action: 'start' } });
      } catch (err) {
        if (!handleAuthError(err)) toast('启动失败：' + err.message);
        btn.disabled = false;
        await loadNetwork();
        return;
      }
      btn.textContent = '启动中…';
      stateEl.textContent = '启动中';
      stateEl.className = 'net-state busy';
      tipEl.textContent = '正在建立 Cloudflare 隧道并校验公网地址，通常 10~60 秒 …';
      pollPublicUrl(90);
    });
  }

  /** 启动隧道后轮询公网地址；拿到 / 隧道退出 / 超时 三种出口都会恢复按钮 */
  function pollPublicUrl(seconds) {
    if (_pubPollTimer) clearInterval(_pubPollTimer);
    const deadline = Date.now() + seconds * 1000;
    _pubPollTimer = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(_pubPollTimer);
        _pubPollTimer = null;
        $('net-pub-btn').disabled = false;
        toast('等待公网地址超时：请看「网络访问」里隧道状态，或重试启动');
        await loadNetwork();
        return;
      }
      let net = null;
      let tun = null;
      try {
        [net, tun] = await Promise.all([
          api('/api/admin/network'),
          api('/api/admin/tunnel').catch(() => null),
        ]);
      } catch (err) {
        return; // 单次轮询失败不打断，等下一轮
      }
      if (!net.public || !net.public.running) {
        clearInterval(_pubPollTimer);
        _pubPollTimer = null;
        $('net-pub-btn').disabled = false;
        toast('隧道进程已退出：可重新一键启动（详情看后台服务日志）');
        renderNetwork(net, tun);
        return;
      }
      if (tun && tun.available) {
        clearInterval(_pubPollTimer);
        _pubPollTimer = null;
        $('net-pub-btn').disabled = false;
        renderNetwork(net, tun);
        await loadTunnel(); // 顶部横幅同步显示公网地址
        toast('公网访问已就绪，地址见顶部横幅');
      }
    }, 3000);
  }

  async function copyNetText(text, okMsg) {
    if (!text) { toast('当前没有可复制的地址'); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg);
    } catch (e) {
      // 剪贴板不可用（非 HTTPS / 旧浏览器）：退化为临时 textarea + execCommand
      const input = document.createElement('textarea');
      input.value = text;
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand('copy');
        toast(okMsg);
      } catch (e2) {
        toast('复制失败，请手动选择地址复制');
      }
      document.body.removeChild(input);
    }
  }

  /* ============================================================
     修改我的密码（顶栏入口）
     ============================================================ */

  function bindChangePassword() {
    $('btn-change-pwd').addEventListener('click', () => {
      const admin = currentAdmin() || {};
      const body =
        field('当前密码', `<input class="input" name="old_password" type="password" required
          placeholder="请输入你现在使用的密码" />`) +
        field('新密码', `<input class="input" name="new_password" type="password" required
          placeholder="至少 6 位" />`, '不能与当前密码相同') +
        field('确认新密码', `<input class="input" name="confirm_password" type="password" required
          placeholder="再输入一次新密码" />`);

      openModal({
        title: `修改我的密码${admin.username ? '：' + admin.username : ''}`,
        sub: '修改成功后，所有已登录的设备都会退出，需要用新密码重新登录。',
        fieldsHtml: body,
        okText: '确认修改',
        onSubmit: async (values) => {
          if (values.new_password !== values.confirm_password) {
            throw new Error('两次输入的新密码不一致');
          }
          const res = await api('/api/auth/change-password', {
            method: 'POST',
            body: { old_password: values.old_password, new_password: values.new_password },
          });
          toast(res.message || '密码已修改，请重新登录');
          // 后端已踢掉全部会话，这里清本地令牌并回登录页
          clearToken();
          setTimeout(() => (location.href = 'index.html'), 900);
        },
      });
    });
  }

  /* ============================================================
     模块一：管理员账号
     ============================================================ */

  function bindAdminModule() {
    $('admins-search').addEventListener('click', () => {
      state.admins.page = 1;
      loadAdmins();
    });
    $('admins-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { state.admins.page = 1; loadAdmins(); }
    });
    $('admins-status').addEventListener('change', () => {
      state.admins.page = 1;
      loadAdmins();
    });
    $('admins-create').addEventListener('click', () => openAdminModal(null));
    $('admins-prev').addEventListener('click', () => {
      if (state.admins.page > 1) { state.admins.page--; loadAdmins(); }
    });
    $('admins-next').addEventListener('click', () => {
      if (state.admins.page * state.admins.pageSize < state.admins.total) {
        state.admins.page++;
        loadAdmins();
      }
    });
  }

  async function loadAdmins() {
    const s = state.admins;
    s.q = $('admins-q').value.trim();
    s.status = $('admins-status').value;

    const params = new URLSearchParams({ page: s.page, page_size: s.pageSize });
    if (s.q) params.set('q', s.q);
    if (s.status !== '') params.set('status', s.status);

    const data = await api('/api/admin/admins?' + params.toString());
    s.total = data.total;

    const tbody = $('admins-body');
    tbody.innerHTML = data.items.map(adminRow).join('');
    $('admins-empty').classList.toggle('hidden', data.items.length > 0);

    const from = data.total === 0 ? 0 : (s.page - 1) * s.pageSize + 1;
    const to = Math.min(s.page * s.pageSize, data.total);
    $('admins-count').textContent = `共 ${data.total} 条，当前显示 ${from}-${to}`;
    $('admins-page').textContent = `第 ${s.page} 页`;

    // 行内操作
    tbody.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const item = data.items.find((x) => x.id === id);
        if (btn.dataset.act === 'edit') openAdminModal(item);
        if (btn.dataset.act === 'del') removeAdmin(item);
      });
    });
  }

  function adminRow(a) {
    const roleBadge =
      a.role === 'super'
        ? '<span class="badge badge-super">超级管理员</span>'
        : '<span class="badge badge-off">普通管理员</span>';
    const statusBadge = a.status
      ? '<span class="badge badge-ok">已启用</span>'
      : '<span class="badge badge-err">已禁用</span>';
    return `<tr>
      <td class="mono">${a.id}</td>
      <td><strong>${esc(a.username)}</strong></td>
      <td>${esc(a.real_name) || '—'}</td>
      <td>${roleBadge}</td>
      <td>${statusBadge}</td>
      <td class="mono">${esc(a.last_login_at) || '从未登录'}</td>
      <td class="mono">${esc(a.created_at)}</td>
      <td class="actions">
        <button class="btn btn-sm" data-act="edit" data-id="${a.id}">编辑</button>
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${a.id}">删除</button>
      </td>
    </tr>`;
  }

  function openAdminModal(item) {
    const isEdit = !!item;
    const a = item || { username: '', real_name: '', role: 'admin', status: 1, remark: '' };

    const body =
      field('登录账号', `<input class="input" name="username" value="${esc(a.username)}"
        ${isEdit ? 'readonly' : 'required'} placeholder="2-32 个字符" />`,
        isEdit ? '账号创建后不可修改；如需变更请新建账号' : '') +
      field('密码',
        `<input class="input" name="password" type="password"
          placeholder="${isEdit ? '留空表示不修改密码' : '至少 6 位'}" ${isEdit ? '' : 'required'} />`,
        isEdit ? '填写后该管理员已登录的会话会立即失效，需要重新登录' : '') +
      field('姓名', `<input class="input" name="real_name" value="${esc(a.real_name)}" placeholder="选填" />`) +
      field('角色', selectHtml('role', [
        { v: 'admin', t: '普通管理员' },
        { v: 'super', t: '超级管理员（可执行全部操作）' },
      ], a.role)) +
      field('状态', selectHtml('status', [
        { v: '1', t: '启用' },
        { v: '0', t: '禁用' },
      ], String(a.status))) +
      field('备注', `<input class="input" name="remark" value="${esc(a.remark)}" placeholder="选填" />`);

    openModal({
      title: isEdit ? `编辑管理员：${a.username}` : '新增管理员',
      sub: isEdit ? '留空的项目不会被修改' : '新增后该账号即可登录管理后台',
      fieldsHtml: body,
      okText: isEdit ? '保存修改' : '创建',
      onSubmit: async (values, close) => {
        if (isEdit) {
          const payload = {
            real_name: values.real_name,
            role: values.role,
            status: Number(values.status),
            remark: values.remark,
          };
          if (values.password) payload.password = values.password;
          await api(`/api/admin/admins/${a.id}`, { method: 'PUT', body: payload });
          toast('已保存修改');
        } else {
          await api('/api/admin/admins', {
            method: 'POST',
            body: {
              username: values.username.trim(),
              password: values.password,
              real_name: values.real_name,
              role: values.role,
              status: Number(values.status),
              remark: values.remark,
            },
          });
          toast('已新增管理员');
        }
        close();
        await loadAdmins();
        await loadStats();
      },
    });
  }

  async function removeAdmin(item) {
    if (!confirm(`确定删除管理员「${item.username}」？\n该操作不可撤销，其登录会话会立即失效。`)) return;
    try {
      const res = await api(`/api/admin/admins/${item.id}`, { method: 'DELETE' });
      toast(res.message);
      await loadAdmins();
      await loadStats();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ============================================================
     模块二：注册申请（考生自助注册 → 管理员审核）
     ============================================================ */

  function bindRegistrationModule() {
    $('regs-search').addEventListener('click', () => {
      state.registrations.page = 1;
      loadRegistrations();
    });
    $('regs-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { state.registrations.page = 1; loadRegistrations(); }
    });
    $('regs-status').addEventListener('change', () => {
      state.registrations.page = 1;
      loadRegistrations();
    });
    $('regs-prev').addEventListener('click', () => {
      if (state.registrations.page > 1) { state.registrations.page--; loadRegistrations(); }
    });
    $('regs-next').addEventListener('click', () => {
      const s = state.registrations;
      if (s.page * s.pageSize < s.total) { s.page++; loadRegistrations(); }
    });
  }

  async function loadRegistrations() {
    const s = state.registrations;
    s.q = $('regs-q').value.trim();
    s.status = $('regs-status').value;

    const params = new URLSearchParams({ page: s.page, page_size: s.pageSize });
    if (s.q) params.set('q', s.q);
    if (s.status) params.set('status', s.status);

    const data = await api('/api/admin/registrations?' + params.toString());
    s.total = data.total;
    regsPending = data.pending || 0;
    renderPending();

    const tbody = $('regs-body');
    tbody.innerHTML = data.items.map(registrationRow).join('');
    $('regs-empty').classList.toggle('hidden', data.items.length > 0);
    $('regs-summary').textContent = `待审核 ${data.pending} 份 · 共 ${data.total} 条`;

    const from = data.total === 0 ? 0 : (s.page - 1) * s.pageSize + 1;
    const to = Math.min(s.page * s.pageSize, data.total);
    $('regs-count').textContent = `共 ${data.total} 条，当前显示 ${from}-${to}`;
    $('regs-page').textContent = `第 ${s.page} 页`;

    tbody.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const item = data.items.find((x) => x.id === id);
        const act = btn.dataset.act;
        if (act === 'view') viewRegistration(item);
        if (act === 'approve') approveRegistration(item);
        if (act === 'reject') rejectRegistration(item);
        if (act === 'del') removeRegistration(item);
      });
    });
  }

  const REG_STATUS = {
    pending: '<span class="badge badge-warn">待审核</span>',
    approved: '<span class="badge badge-ok">已通过</span>',
    rejected: '<span class="badge badge-err">已拒绝</span>',
  };

  function registrationRow(r) {
    const statusBadge = REG_STATUS[r.status] || esc(r.status);
    const actions = [];
    actions.push(`<button class="btn btn-sm" data-act="view" data-id="${r.id}">查看</button>`);
    if (r.status === 'pending') {
      actions.push(`<button class="btn btn-sm btn-primary" data-act="approve" data-id="${r.id}">通过</button>`);
      actions.push(`<button class="btn btn-sm" data-act="reject" data-id="${r.id}">拒绝</button>`);
    }
    actions.push(`<button class="btn btn-sm btn-danger" data-act="del" data-id="${r.id}">删除</button>`);

    return `<tr>
      <td class="mono">${r.id}</td>
      <td><strong>${esc(r.account)}</strong></td>
      <td>${esc(r.org) || '—'}</td>
      <td>${statusBadge}</td>
      <td class="mono">${esc(r.created_at)}</td>
      <td>${esc(r.reviewed_by) || '—'}</td>
      <td class="mono">${esc(r.reviewed_at) || '—'}</td>
      <td class="actions">${actions.join('')}</td>
    </tr>`;
  }

  /** 详情弹窗：只读展示申请信息（含拒绝原因） */
  function viewRegistration(reg) {
    const rows = [
      ['申请账号', reg.account],
      ['单位 / 学校', reg.org || '未填写'],
      ['是否已设密码', reg.has_password ? '是（注册时已设置）' : '否'],
      ['状态', { pending: '待审核', approved: '已通过', rejected: '已拒绝' }[reg.status] || reg.status],
      ['提交时间', reg.created_at],
      ['审核人', reg.reviewed_by || '—'],
      ['审核时间', reg.reviewed_at || '—'],
      ['拒绝原因', reg.reject_reason || '—'],
    ];
    const body = `<div class="table-wrap"><table><tbody>${rows
      .map(
        ([k, v]) =>
          `<tr><th style="width:130px;">${esc(k)}</th><td style="white-space:normal;">${esc(v)}</td></tr>`
      )
      .join('')}</tbody></table></div>`;

    openModal({
      title: `注册申请详情：${reg.account}`,
      sub: '仅查看，不做修改',
      fieldsHtml: body,
      okText: '关闭',
      onSubmit: async (_values, close) => close(),
    });
  }

  /** 通过：可选指定密码 / 修正单位，默认沿用考生注册时填写的 */
  function approveRegistration(reg) {
    const body =
      field('申请账号', `<input class="input" value="${esc(reg.account)}" readonly />`,
        '通过后将以此账号为 TA 建立考生账号') +
      field('单位 / 学校', `<input class="input" name="org" value="${esc(reg.org)}"
        placeholder="可留空沿用考生填写值" />`) +
      field('初始密码', `<input class="input" name="password" type="password"
        placeholder="留空 = 沿用考生注册时设置的密码" />`,
        '如需改为管理员指定的密码，在此填写（至少 6 位）');

    openModal({
      title: `通过注册申请：${reg.account}`,
      sub: '通过后该考生即可用「账号 + 密码」登录 App',
      fieldsHtml: body,
      okText: '确认通过',
      onSubmit: async (values, close) => {
        if (values.password && values.password.length < 6) {
          throw new Error('初始密码至少 6 位');
        }
        const payload = {};
        if (values.org.trim()) payload.org = values.org.trim();
        if (values.password) payload.password = values.password;

        const res = await api(`/api/admin/registrations/${reg.id}/approve`, {
          method: 'POST',
          body: payload,
        });
        toast(res.message || '已通过');
        close();
        await loadRegistrations();
        await loadUsers();
        await loadStats();
      },
    });
  }

  /** 拒绝：填写原因，会记录在申请上 */
  function rejectRegistration(reg) {
    const body = field('拒绝原因',
      `<textarea class="input" name="reason" placeholder="例如：单位信息不完整，请补充后重新提交"></textarea>`,
      '该原因会随申请一起保存，便于后续核对');

    openModal({
      title: `拒绝注册申请：${reg.account}`,
      sub: '拒绝后该考生仍然无法登录',
      fieldsHtml: body,
      okText: '确认拒绝',
      onSubmit: async (values, close) => {
        const res = await api(`/api/admin/registrations/${reg.id}/reject`, {
          method: 'POST',
          body: { reason: values.reason || '' },
        });
        toast(res.message || '已拒绝');
        close();
        await loadRegistrations();
        await loadStats();
      },
    });
  }

  async function removeRegistration(reg) {
    if (!confirm(`确定删除「${reg.account}」的注册申请记录？\n该操作不可撤销（不会影响已建立的考生账号）。`)) return;
    try {
      const res = await api(`/api/admin/registrations/${reg.id}`, { method: 'DELETE' });
      toast(res.message);
      await loadRegistrations();
      await loadStats();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ============================================================
     模块三：考生账号
     ============================================================ */

  function bindUserModule() {
    $('users-search').addEventListener('click', () => {
      state.users.page = 1;
      loadUsers();
    });
    $('users-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { state.users.page = 1; loadUsers(); }
    });
    $('users-status').addEventListener('change', () => { state.users.page = 1; loadUsers(); });
    $('users-method').addEventListener('change', () => { state.users.page = 1; loadUsers(); });
    $('users-create').addEventListener('click', () => openUserModal(null));
    $('users-prev').addEventListener('click', () => {
      if (state.users.page > 1) { state.users.page--; loadUsers(); }
    });
    $('users-next').addEventListener('click', () => {
      if (state.users.page * state.users.pageSize < state.users.total) {
        state.users.page++;
        loadUsers();
      }
    });
  }

  async function loadUsers() {
    const s = state.users;
    s.q = $('users-q').value.trim();
    s.status = $('users-status').value;
    s.method = $('users-method').value;

    const params = new URLSearchParams({ page: s.page, page_size: s.pageSize });
    if (s.q) params.set('q', s.q);
    if (s.status !== '') params.set('status', s.status);
    if (s.method) params.set('method', s.method);

    const data = await api('/api/admin/users?' + params.toString());
    s.total = data.total;

    const tbody = $('users-body');
    tbody.innerHTML = data.items.map(userRow).join('');
    $('users-empty').classList.toggle('hidden', data.items.length > 0);

    const from = data.total === 0 ? 0 : (s.page - 1) * s.pageSize + 1;
    const to = Math.min(s.page * s.pageSize, data.total);
    $('users-count').textContent = `共 ${data.total} 条，当前显示 ${from}-${to}`;
    $('users-page').textContent = `第 ${s.page} 页`;

    tbody.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const item = data.items.find((x) => x.id === id);
        if (btn.dataset.act === 'edit') openUserModal(item);
        if (btn.dataset.act === 'pwd') resetUserPassword(item);
        if (btn.dataset.act === 'del') removeUser(item);
      });
    });
  }

  function userRow(u) {
    const statusBadge = u.status
      ? '<span class="badge badge-ok">已启用</span>'
      : '<span class="badge badge-err">已禁用</span>';
    // 在线状态：后端按「是否有未过期会话」实时判定（v1.38 单端登录后 = 该账号是否正有一台设备在线）
    const onlineBadge = u.online
      ? '<span class="badge badge-ok" title="该账号当前有设备在线">在线</span>'
      : '<span class="badge badge-off">离线</span>';
    const pwdBadge = u.has_password
      ? '<span class="badge badge-super">已设密码</span>'
      : '<span class="badge badge-warn">未设密码</span>';
    return `<tr>
      <td class="mono">${u.id}</td>
      <td class="mono"><strong>${esc(u.account)}</strong></td>
      <td>${esc(u.org) || '—'}</td>
      <td><div class="user-cell">${avatarHtml(u.avatar)}<span>${esc(u.nickname) || '—'}</span></div></td>
      <td>${esc(u.real_name) || '—'}</td>
      <td>${esc(u.method) || '—'}</td>
      <td>${statusBadge}</td>
      <td>${onlineBadge}</td>
      <td class="mono">${esc(u.last_login_at) || '从未登录'}</td>
      <td class="actions">
        <button class="btn btn-sm" data-act="edit" data-id="${u.id}">编辑</button>
        <button class="btn btn-sm" data-act="pwd" data-id="${u.id}">${pwdBadge}</button>
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${u.id}">删除</button>
      </td>
    </tr>`;
  }

  function openUserModal(item) {
    const isEdit = !!item;
    const u = item || { account: '', org: '', nickname: '', avatar: '', real_name: '', method: '', status: 1, remark: '' };

    const body =
      field('登录账号',
        `<input class="input" name="account" value="${esc(u.account)}" required
          placeholder="4-20 位字母 / 数字 / 下划线" />`,
        isEdit ? '一般不用改；改了该考生需用新账号登录' : '考生用「账号 + 密码」登录') +
      field('密码',
        `<input class="input" name="password" type="password"
          placeholder="${isEdit ? '留空表示不修改密码' : '至少 6 位，可留空'}" />`,
        isEdit ? '填写即重置密码，该考生已登录的会话会立即失效' : '') +
      field('单位 / 学校', `<input class="input" name="org" value="${esc(u.org)}" placeholder="选填" />`) +
      field('头像',
        selectHtml('avatar', [
          { v: '', t: isEdit ? '不修改（保持现有头像）' : '随机生成' },
          ...avatarOptions(),
        ], '') +
        `<div class="avatar-preview">当前：${avatarHtml(u.avatar, 'lg')}<span>${esc(avatarLabel(u.avatar))}</span></div>`,
        isEdit ? '考生也能在 App「我的」页自行更换' : '留空则随机分配一个预设头像') +
      field('昵称', `<input class="input" name="nickname" value="${esc(u.nickname)}" placeholder="留空自动随机生成" />`, '考生可在 App「我的」页修改') +
      field('姓名', `<input class="input" name="real_name" value="${esc(u.real_name)}" placeholder="选填" />`) +
      field('报考方向', selectHtml('method', [
        { v: '', t: '未设置' },
        { v: 'UT', t: 'UT 超声检测' },
        { v: 'RT', t: 'RT 射线检测' },
        { v: 'MT', t: 'MT 磁粉检测' },
        { v: 'PT', t: 'PT 渗透检测' },
        { v: 'ET', t: 'ET 涡流检测' },
        { v: 'VT', t: 'VT 目视检测' },
        { v: '综合', t: '综合' },
      ], u.method)) +
      field('状态', selectHtml('status', [
        { v: '1', t: '启用' },
        { v: '0', t: '禁用（禁止登录）' },
      ], String(u.status))) +
      field('备注', `<input class="input" name="remark" value="${esc(u.remark)}" placeholder="选填" />`);

    openModal({
      title: isEdit ? `编辑考生：${u.account}` : '新增考生',
      sub: isEdit ? '留空的项目不会被修改' : '新增后考生即可用该账号与密码登录',
      fieldsHtml: body,
      okText: isEdit ? '保存修改' : '创建',
      onSubmit: async (values, close) => {
        const account = values.account.trim();
        if (!/^[A-Za-z0-9_]{4,20}$/.test(account)) {
          throw new Error('账号需为 4-20 位字母 / 数字 / 下划线');
        }
        if (values.password && values.password.length < 6) {
          throw new Error('密码至少 6 位');
        }

        if (isEdit) {
          const payload = {
            account,
            org: values.org,
            nickname: values.nickname,
            real_name: values.real_name,
            method: values.method,
            status: Number(values.status),
            remark: values.remark,
          };
          if (values.password) payload.password = values.password;
          // 头像留空 = 不修改（后端只在前端明确传值时才覆盖）
          if (values.avatar) payload.avatar = values.avatar;
          await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: payload });
          toast('已保存修改');
        } else {
          await api('/api/admin/users', {
            method: 'POST',
            body: {
              account,
              password: values.password || '',
              org: values.org,
              nickname: values.nickname,
              avatar: values.avatar || '',   // 留空则后端随机分配
              real_name: values.real_name,
              method: values.method,
              status: Number(values.status),
              remark: values.remark,
            },
          });
          toast('已新增考生');
        }
        close();
        await loadUsers();
        await loadStats();
      },
    });
  }

  /** 快捷改密码：只改密码，不动其它字段 */
  function resetUserPassword(u) {
    const body =
      field('考生账号', `<input class="input" value="${esc(u.account)}" readonly />`) +
      field('新密码', `<input class="input" name="password" type="password" required
        placeholder="至少 6 位" />`, '修改后该考生已登录的会话会立即失效');

    openModal({
      title: `修改密码：${u.account}`,
      sub: '仅修改该考生的登录密码',
      fieldsHtml: body,
      okText: '确认修改',
      onSubmit: async (values, close) => {
        if (!values.password || values.password.length < 6) {
          throw new Error('新密码至少 6 位');
        }
        await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { password: values.password } });
        toast('密码已修改');
        close();
        await loadUsers();
      },
    });
  }

  async function removeUser(item) {
    if (!confirm(`确定删除考生「${item.account}」？\n该操作不可撤销，其登录会话会立即失效。`)) return;
    try {
      const res = await api(`/api/admin/users/${item.id}`, { method: 'DELETE' });
      toast(res.message);
      await loadUsers();
      await loadStats();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ============================================================
     模块四：密码重置工单（考生在 App 提交申请 → 管理员处理）
     - 处理：重置该考生的登录密码（可手动指定；留空由系统随机生成），
       并自动给该考生发一条「系统通知」，正文里带上新密码
     - 拒绝：记录原因，考生不会收到新密码
     - 说明：考生端申请入口在 App「设置 → 账号安全 → 忘记密码」与登录页

     接口（server/modules/password_resets.py）：
       GET    /api/admin/password-resets?page=&page_size=&q=&status=
       GET    /api/admin/password-resets/{id}
       POST   /api/admin/password-resets/{id}/approve   body { new_password? }
       POST   /api/admin/password-resets/{id}/reject    body { reason }
       DELETE /api/admin/password-resets/{id}
     ============================================================ */

  const RESET_STATUS = {
    pending: '<span class="badge badge-warn">待处理</span>',
    done: '<span class="badge badge-ok">已处理</span>',
    rejected: '<span class="badge badge-err">已拒绝</span>',
  };

  function bindResetModule() {
    $('resets-search').addEventListener('click', () => { state.resets.page = 1; loadResets(); });
    $('resets-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { state.resets.page = 1; loadResets(); }
    });
    $('resets-status').addEventListener('change', () => { state.resets.page = 1; loadResets(); });
    $('resets-prev').addEventListener('click', () => {
      if (state.resets.page > 1) { state.resets.page--; loadResets(); }
    });
    $('resets-next').addEventListener('click', () => {
      const s = state.resets;
      if (s.page * s.pageSize < s.total) { s.page++; loadResets(); }
    });
  }

  async function loadResets() {
    const s = state.resets;
    s.q = $('resets-q').value.trim();
    s.status = $('resets-status').value;

    try {
      const params = new URLSearchParams({ page: s.page, page_size: s.pageSize });
      if (s.q) params.set('q', s.q);
      if (s.status) params.set('status', s.status);
      const data = await api('/api/admin/password-resets?' + params.toString());
      const items = data.items;
      s.total = data.total;
      resetsPending = data.pending;
      renderPending();

      const tbody = $('resets-body');
      tbody.innerHTML = items.map(resetRow).join('');
      $('resets-empty').classList.toggle('hidden', items.length > 0);
      $('resets-summary').textContent = `待处理 ${resetsPending} 条 · 共 ${s.total} 条`;

      const from = s.total === 0 ? 0 : (s.page - 1) * s.pageSize + 1;
      const to = Math.min(s.page * s.pageSize, s.total);
      $('resets-count').textContent = `共 ${s.total} 条，当前显示 ${from}-${to}`;
      $('resets-page').textContent = `第 ${s.page} 页`;

      tbody.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.id);
          const item = items.find((x) => x.id === id);
          if (!item) return;
          const act = btn.dataset.act;
          if (act === 'view') viewReset(item);
          if (act === 'approve') approveReset(item);
          if (act === 'reject') rejectReset(item);
          if (act === 'del') removeReset(item);
        });
      });
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function resetRow(r) {
    const statusBadge = RESET_STATUS[r.status] || esc(r.status);
    const actions = [`<button class="btn btn-sm" data-act="view" data-id="${r.id}">查看</button>`];
    if (r.status === 'pending') {
      actions.push(`<button class="btn btn-sm btn-primary" data-act="approve" data-id="${r.id}">处理</button>`);
      actions.push(`<button class="btn btn-sm" data-act="reject" data-id="${r.id}">拒绝</button>`);
    }
    actions.push(`<button class="btn btn-sm btn-danger" data-act="del" data-id="${r.id}">删除</button>`);
    return `<tr>
      <td class="mono">${r.id}</td>
      <td><strong>${esc(r.account)}</strong></td>
      <td>${esc(r.email) || '—'}</td>
      <td>${statusBadge}</td>
      <td class="mono">${esc(r.created_at)}</td>
      <td>${esc(r.reviewed_by) || '—'}</td>
      <td class="mono">${esc(r.reviewed_at) || '—'}</td>
      <td class="actions">${actions.join('')}</td>
    </tr>`;
  }

  /** 查看工单详情（只读） */
  function viewReset(r) {
    const rows = [
      ['申请账号', r.account],
      ['邮箱', r.email || '未填写'],
      ['状态', { pending: '待处理', done: '已处理', rejected: '已拒绝' }[r.status] || r.status],
      ['提交时间', r.created_at],
      ['处理人', r.reviewed_by || '—'],
      ['处理时间', r.reviewed_at || '—'],
      ['拒绝原因', r.reject_reason || '—'],
    ];
    const body = `<div class="table-wrap"><table><tbody>${rows
      .map(([k, v]) => `<tr><th style="width:130px;">${esc(k)}</th><td style="white-space:normal;">${esc(v)}</td></tr>`)
      .join('')}</tbody></table></div>`;
    openModal({
      title: `重置申请详情：${r.account}`,
      sub: '仅查看，不做修改',
      fieldsHtml: body,
      okText: '关闭',
      onSubmit: async (_values, close) => close(),
    });
  }

  /** 处理：重置密码（可指定，留空随机）+ 自动发系统通知把新密码给考生 */
  function approveReset(r) {
    const body =
      field('申请账号', `<input class="input" value="${esc(r.account)}" readonly />`,
        '将重置该考生的登录密码，并把新密码发到 TA 的通知中心') +
      field('邮箱', `<input class="input" value="${esc(r.email)}" readonly />`,
        '请与考生本人核对，确认无误后再重置') +
      field('新密码', `<input class="input" name="new_password" type="text"
        placeholder="留空 = 系统随机生成 8 位" />`,
        '填写后该考生已登录的会话会立即失效；新密码会以「系统通知」发送，考生不可删除该通知');

    openModal({
      title: `处理重置申请：${r.account}`,
      sub: '处理后会给该考生发送一条包含新密码的系统通知',
      fieldsHtml: body,
      okText: '确认重置并发送',
      onSubmit: async (values, close) => {
        const pwd = (values.new_password || '').trim();
        if (pwd && pwd.length < 6) throw new Error('新密码至少 6 位');

        const res = await api(`/api/admin/password-resets/${r.id}/approve`, {
          method: 'POST',
          body: pwd ? { new_password: pwd } : {},
        });
        toast(res.message || '已处理');

        await Promise.all([loadResets(), loadNotifies(), loadStats()]);

        /* 把最终生效的密码再明确展示一次（留空时是系统随机生成的，管理员需要知道） */
        close();
        openModal({
          title: '已重置密码并发送通知',
          sub: `账号 ${res.account} 的新密码如下，考生也会在 App 通知中心收到同名系统通知`,
          fieldsHtml:
            field('考生账号', `<input class="input" value="${esc(res.account)}" readonly />`) +
            field('新密码', `<input class="input mono" value="${esc(res.new_password)}" readonly />`,
              '请通过可靠渠道告知考生本人；考生用新密码登录后，建议立即到 App 里改成自己的密码'),
          okText: '知道了',
          onSubmit: async (_v, done) => done(),
        });
      },
    });
  }

  /** 拒绝：记录原因 */
  function rejectReset(r) {
    const body = field('拒绝原因',
      `<textarea class="input" name="reason" placeholder="例如：邮箱与账号不匹配，无法核实身份"></textarea>`,
      '原因会随工单保存，便于后续核对');

    openModal({
      title: `拒绝重置申请：${r.account}`,
      sub: '拒绝后该考生密码不变，也不会收到通知',
      fieldsHtml: body,
      okText: '确认拒绝',
      onSubmit: async (values, close) => {
        const res = await api(`/api/admin/password-resets/${r.id}/reject`, {
          method: 'POST',
          body: { reason: values.reason || '' },
        });
        toast(res.message || '已拒绝该申请');
        close();
        await Promise.all([loadResets(), loadStats()]);
      },
    });
  }

  async function removeReset(r) {
    if (!confirm(`确定删除「${r.account}」的密码重置申请记录？\n该操作不可撤销（不会影响该考生当前密码）。`)) return;
    try {
      const res = await api(`/api/admin/password-resets/${r.id}`, { method: 'DELETE' });
      toast(res.message || '已删除申请记录');
      await Promise.all([loadResets(), loadStats()]);
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ============================================================
     模块五：通知管理（发给全部考生 / 指定考生）
     - 类型由管理员设置：system（考生不可删除）/ notice（考生可删除）
     - 「全部考生」= 给当前所有启用的考生各写一条通知
     - 「指定考生」= 从已注册且启用的考生里搜索多选（一个账号只能选一次），
       已添加的候选会置灰；提交时后端还会再按账号去重一次

     接口（server/modules/notifications.py）：
       GET    /api/admin/notifications/candidates?q=&limit=   候选考生
       POST   /api/admin/notifications      body { scope, accounts[], type, title, content }
       GET    /api/admin/notifications?page=&page_size=       已发送记录（按批次）
       DELETE /api/admin/notifications/{batch_id}             删除通知（后台记录 + 考生端对应通知一起删）
     ============================================================ */

  function bindNotifyModule() {
    $('notify-target-row').querySelectorAll('.radio-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        $('notify-target-row').querySelectorAll('.radio-chip').forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
        const isOne = chip.dataset.target === 'one';
        $('notify-recipient-row').classList.toggle('hidden', !isOne);
        $('notify-target-hint').textContent = isOne
          ? '只发送给下方已添加的指定考生'
          : '将发送给当前所有启用的考生账号';
        // 首次切到「指定考生」时先拉一批候选出来
        if (isOne && !$('notify-candidates').dataset.loaded) searchCandidates();
      });
    });

    $('notify-send').addEventListener('click', sendNotify);
    $('notify-clear').addEventListener('click', clearNotifyForm);
    $('notifies-refresh').addEventListener('click', () => loadNotifies());

    // 候选考生搜索：回车 / 点按钮立即搜，输入时 300ms 防抖自动搜
    $('notify-account-search').addEventListener('click', () => searchCandidates());
    $('notify-account-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); searchCandidates(); }
    });
    let searchTimer = null;
    $('notify-account-q').addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(searchCandidates, 300);
    });

    renderPicked();
  }

  function currentNotifyTarget() {
    const on = $('notify-target-row').querySelector('.radio-chip.on');
    return on ? on.dataset.target : 'all';
  }

  /* ── 指定考生：已选列表（chips） ─────────────────────────── */

  /** 重新渲染「已选考生」区域 + 提示文案 */
  function renderPicked() {
    const box = $('notify-picked');
    box.innerHTML = notifyPicked.length
      ? notifyPicked
          .map(
            (a) => `<span class="picked-chip">${esc(a)}
              <button type="button" class="picked-x" data-account="${esc(a)}" title="移除">×</button></span>`
          )
          .join('')
      : '<span class="picker-placeholder">还没有选择考生</span>';

    $('notify-recipient-hint').textContent = notifyPicked.length
      ? `已选择 ${notifyPicked.length} 个账号；同一个账号只会收到一条`
      : '从下方搜索结果里点「添加」选择接收考生；同一个账号只能添加一次';

    box.querySelectorAll('.picked-x').forEach((btn) => {
      btn.addEventListener('click', () => removePicked(btn.dataset.account));
    });
  }

  /** 把某个候选按钮标成「已添加」/ 恢复成「+ 添加」（不重新发请求） */
  function setCandidateState(account, picked) {
    $('notify-candidates').querySelectorAll('.candidate').forEach((btn) => {
      if (btn.dataset.account !== account) return;
      btn.classList.toggle('picked', picked);
      btn.disabled = picked;
      const act = btn.querySelector('.candidate-act');
      if (act) act.textContent = picked ? '已添加' : '+ 添加';
    });
  }

  function addPicked(account) {
    if (!account) return;
    if (notifyPicked.includes(account)) {
      toast(`账号 ${account} 已添加过了，同一个账号只发一次`);
      return;
    }
    notifyPicked.push(account);
    renderPicked();
    setCandidateState(account, true);
  }

  function removePicked(account) {
    notifyPicked = notifyPicked.filter((a) => a !== account);
    renderPicked();
    setCandidateState(account, false);
  }

  /** 搜索候选考生（已注册且启用；被选过的置灰不可再点） */
  async function searchCandidates() {
    const box = $('notify-candidates');
    const q = $('notify-account-q').value.trim();
    box.dataset.loaded = '1';
    box.innerHTML = '<div class="picker-empty">搜索中…</div>';
    try {
      const params = new URLSearchParams({ limit: 20 });
      if (q) params.set('q', q);
      const data = await api('/api/admin/notifications/candidates?' + params.toString());
      box.innerHTML = candidateHtml(data.items, data.total);
      box.querySelectorAll('.candidate').forEach((btn) => {
        btn.addEventListener('click', () => addPicked(btn.dataset.account));
      });
    } catch (err) {
      if (handleAuthError(err)) return;
      box.innerHTML = `<div class="picker-empty">加载失败：${esc(err.message)}</div>`;
    }
  }

  function candidateHtml(items, total) {
    if (!items || !items.length) return '<div class="picker-empty">没有匹配的已注册考生</div>';
    const rows = items
      .map((u) => {
        const picked = notifyPicked.includes(u.account);
        const sub = [u.nickname, u.org].filter(Boolean).join(' · ');
        return `<button type="button" class="candidate ${picked ? 'picked' : ''}"
                  data-account="${esc(u.account)}" ${picked ? 'disabled' : ''}>
          ${avatarHtml(u.avatar)}
          <span class="candidate-main">
            <strong>${esc(u.account)}</strong>
            <em>${esc(sub) || '—'}</em>
          </span>
          <span class="candidate-act">${picked ? '已添加' : '+ 添加'}</span>
        </button>`;
      })
      .join('');
    const more = total > items.length
      ? `<div class="picker-more">还有 ${total - items.length} 个匹配的考生，输入更具体的账号 / 单位可以缩小范围</div>`
      : '';
    return rows + more;
  }

  function clearNotifyForm() {
    $('notify-account-q').value = '';
    $('notify-title').value = '';
    $('notify-content').value = '';
    $('notify-result').textContent = '';
    notifyPicked = [];
    renderPicked();
    $('notify-candidates').querySelectorAll('.candidate').forEach((btn) => {
      btn.classList.remove('picked');
      btn.disabled = false;
      const act = btn.querySelector('.candidate-act');
      if (act) act.textContent = '+ 添加';
    });
  }

  async function sendNotify() {
    const scope = currentNotifyTarget();
    const type = $('notify-type').value;
    const title = $('notify-title').value.trim();
    const content = $('notify-content').value.trim();

    $('notify-result').textContent = '';
    if (scope === 'one' && !notifyPicked.length) { toast('请至少选择一个接收考生'); return; }
    if (!title) { toast('请填写通知标题'); return; }
    if (!content) { toast('请填写通知内容'); return; }
    if (title.length > 40) { toast('标题不超过 40 个字'); return; }

    const btn = $('notify-send');
    btn.disabled = true;
    btn.textContent = '发送中…';
    try {
      const res = await api('/api/admin/notifications', {
        method: 'POST',
        body: {
          scope,
          accounts: scope === 'one' ? notifyPicked.slice() : [],
          type,
          title,
          content,
        },
      });
      const msg = res.message || '已发送';
      toast(msg);
      clearNotifyForm();
      $('notify-result').textContent = msg;
      await Promise.all([loadNotifies(), loadStats()]);
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '发送通知';
    }
  }

  async function loadNotifies() {
    const tbody = $('notifies-body');
    try {
      const data = await api('/api/admin/notifications?page=1&page_size=50');
      const items = data.items;
      state.notifies.total = data.total;

      tbody.innerHTML = items.map(notifyRow).join('');
      $('notifies-empty').classList.toggle('hidden', items.length > 0);
      $('notifies-count').textContent = `共 ${data.total} 条发送记录`;

      tbody.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = items.find((x) => String(x.id) === btn.dataset.batch);
          if (item && btn.dataset.act === 'del') removeNotify(item);
        });
      });
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function notifyRow(n) {
    const typeBadge = n.type === 'system'
      ? '<span class="badge badge-super">系统通知</span>'
      : '<span class="badge badge-off">普通通知</span>';
    let target;
    if (n.scope === 'all') {
      target = `全部考生（${n.receiver_count} 人）`;
    } else if (n.accounts.length > 1) {
      target = `${n.accounts.length} 个指定考生：<span class="mono">${esc(n.accounts.join('、'))}</span>`;
    } else {
      target = `考生账号 <strong>${esc(n.accounts[0] || n.target_desc)}</strong>`;
    }
    return `<tr>
      <td>${typeBadge}</td>
      <td style="white-space:normal;max-width:240px;">${target}</td>
      <td><strong>${esc(n.title)}</strong></td>
      <td class="wrap">${esc(n.content)}</td>
      <td>${esc(n.sender)}</td>
      <td class="mono">${esc(n.created_at)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-danger" data-act="del" data-batch="${esc(n.id)}">删除</button>
      </td>
    </tr>`;
  }

  async function removeNotify(n) {
    if (!confirm(
      `确定删除这条通知？\n「${n.title}」\n\n` +
      `⚠️ 考生端收到的对应通知也会一起删除，且无法恢复。`
    )) return;
    try {
      const res = await api(`/api/admin/notifications/${encodeURIComponent(n.id)}`, { method: 'DELETE' });
      toast(res.message || '已删除记录');
      await loadNotifies();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ============================================================
     模块六：题库管理（自定义题库：建库 → 按题型放题 → 考生端动态获取）
     题型跨端一致常量（与 server/modules/bank.py QTYPE_NAMES 同步）：
       judge 判断题 / single 选择题 / multi 多选题 / calc 计算题 /
       calcsel 计算选择题 / short 简答题
     ============================================================ */

  const QS_QTYPES = [
    { v: 'judge', t: '判断题' },
    { v: 'single', t: '选择题' },
    { v: 'multi', t: '多选题' },
    { v: 'calc', t: '计算题' },
    { v: 'calcsel', t: '计算选择题' },
    { v: 'short', t: '简答题' },
  ];
  /** 题库系列的方向选项（与 server/modules/question_series.py QS_METHODS 同步） */
  const QS_METHODS = [
    { v: '', t: '通用' },
    { v: 'UT', t: 'UT' }, { v: 'RT', t: 'RT' }, { v: 'MT', t: 'MT' },
    { v: 'PT', t: 'PT' }, { v: 'ET', t: 'ET' }, { v: 'VT', t: 'VT' },
    { v: '综合', t: '综合' },
  ];

  /** 题库列表缓存（只含自定义题库：排序只在这批里做，内置一级题库是负数伪 id 不参与） */
  let qsCache = [];
  /** 题库系列全量缓存（列表筛选、题库表单的「所属系列」下拉共用；按方向/级别在前端过滤） */
  let qSeriesCache = [];
  /** 章节管理弹窗的现场（排序要按这个顺序提交） */
  let chapterCtx = { setId: 0, items: [] };

  function bindQuestionSetModule() {
    /* 题库系列 */
    $('qss-refresh').addEventListener('click', loadQuestionSeries);
    $('qss-method').addEventListener('change', loadQuestionSeries);
    $('qss-level').addEventListener('change', loadQuestionSeries);
    $('qss-new').addEventListener('click', () => openQuestionSeriesModal(null));
    /* 题库 */
    $('qs-refresh').addEventListener('click', loadQuestionSets);
    $('qs-search').addEventListener('click', loadQuestionSets);
    $('qs-method').addEventListener('change', loadQuestionSets);
    $('qs-series').addEventListener('change', loadQuestionSets);
    $('qs-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadQuestionSets(); });
    $('qs-create').addEventListener('click', () => openSetModal(null));
    $('qs-restore-builtin').addEventListener('click', restoreBuiltinBank);
  }

  /* ── 题库系列：列表 / 排序 / 封面 ───────────────────────── */

  async function loadQuestionSeries() {
    const tbody = $('qss-body');
    try {
      const data = await api('/api/admin/question-series');
      qSeriesCache = data.items || [];

      // 级别是自由文本：下拉选项按现有系列里出现过的值生成，不写死
      const levelSel = $('qss-level');
      const keepLevel = levelSel.value;
      const levels = Array.from(new Set(qSeriesCache.map((s) => s.level).filter(Boolean))).sort();
      levelSel.innerHTML = '<option value="">全部级别</option>' +
        levels.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
      if (levels.includes(keepLevel)) levelSel.value = keepLevel;

      // 方向 / 级别在前端过滤（系列数量很小，一次拉全再筛更简单，也不影响下拉选项）
      const method = $('qss-method').value;
      const level = levelSel.value;
      const shown = qSeriesCache.filter((s) =>
        (!method || s.method === method) && (!level || s.level === level));
      qSeriesCache = shown;

      tbody.innerHTML = shown.map((s, i) => qSeriesRow(s, i, shown.length)).join('');
      $('qss-empty').classList.toggle('hidden', shown.length > 0);

      tbody.querySelectorAll('[data-sact]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = qSeriesCache.find((x) => x.id === Number(btn.dataset.id));
          if (!item) return;
          if (btn.dataset.sact === 'edit') openQuestionSeriesModal(item);
          if (btn.dataset.sact === 'cover') openQuestionSeriesCoverModal(item);
          if (btn.dataset.sact === 'del') removeQuestionSeries(item);
        });
      });
      bindMoveButtons(tbody, 'qseries');

      renderQSeriesFilterOptions();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function qSeriesRow(s, idx, total) {
    const cover = s.has_cover
      ? `<img class="mat-cover" src="/api/admin/question-series/${s.id}/cover?token=${encodeURIComponent(getToken())}" alt="封面" />`
      : `<span class="mat-cover mat-cover-none">无</span>`;
    return `<tr>
      <td class="mono">${idx + 1}</td>
      <td class="wrap"><strong>${esc(s.name)}</strong></td>
      <td>${s.level ? `<span class="badge badge-ok">${esc(s.level)}</span>` : '—'}</td>
      <td>${esc(s.method || '通用')}</td>
      <td class="wrap" style="max-width:220px;">${esc(s.description || '—')}</td>
      <td class="mono">${s.bank_count || 0}</td>
      <td class="mono">${s.total || 0}</td>
      <td>${cover}</td>
      ${moveCell('qseries', s.id, idx, total)}
      <td class="actions">
        <button class="btn btn-sm" data-sact="edit" data-id="${s.id}">编辑</button>
        <button class="btn btn-sm" data-sact="cover" data-id="${s.id}">封面</button>
        <button class="btn btn-sm btn-danger" data-sact="del" data-id="${s.id}">删除</button>
      </td>
    </tr>`;
  }

  /** 题库表的「所属系列」筛选下拉：选项跟着系列走（未归系列 = loose） */
  function renderQSeriesFilterOptions() {
    const sel = $('qs-series');
    const cur = sel.value;
    const options = ['<option value="">全部系列</option>', '<option value="loose">未归系列（其他）</option>'];
    qSeriesCache.forEach((s) => {
      options.push(`<option value="${s.id}">${esc(s.name)}（${s.bank_count || 0}）</option>`);
    });
    sel.innerHTML = options.join('');
    if (cur && (cur === 'loose' || qSeriesCache.some((s) => String(s.id) === cur))) sel.value = cur;
  }

  /** 题库表单里的「所属系列」下拉 */
  function qSeriesSelectOptions(selected) {
    const head = `<option value="0" ${!selected ? 'selected' : ''}>（不归入系列 · 显示在「其他题库」）</option>`;
    return head + qSeriesCache.map((s) =>
      `<option value="${s.id}" ${Number(selected) === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  }

  async function moveQuestionSeries(id, dir) {
    const ids = withMoved(qSeriesCache, id, dir, (x) => x.id);
    if (!ids) return;
    try {
      await api('/api/admin/question-series/order', { method: 'POST', body: { ids } });
      await loadQuestionSeries();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function openQuestionSeriesModal(item) {
    const isEdit = !!item;
    const s = item || { name: '', level: '', method: '', description: '' };
    const body =
      field('系列名称', `<input class="input" name="name" value="${esc(s.name)}" required
        placeholder="例如：二级 UT 题库系列" maxlength="50" />`) +
      field('级别', `<input class="input" name="level" value="${esc(s.level)}"
        placeholder="如：一级 / 二级 / 三级（留空不显示）" maxlength="20" />`,
        '级别是自由文本，填了就出现在系列的级别筛选里') +
      field('方向', selectHtml('method', QS_METHODS, s.method),
        '「通用」= 考生端所有方向 Tab 下都能看到这个系列') +
      field('简介', `<textarea class="input" name="description" rows="2"
        placeholder="选填，考生端系列卡副标题" maxlength="200">${esc(s.description)}</textarea>`);

    openModal({
      title: isEdit ? `编辑题库系列：${s.name}` : '新建题库系列',
      sub: isEdit ? '保存后考生端题库页同步更新' : '建好后可在「新建题库 / 编辑题库」里把题库归入这个系列',
      fieldsHtml: body,
      okText: isEdit ? '保存修改' : '创建',
      onSubmit: async (values, close) => {
        const payload = {
          name: values.name.trim(),
          level: values.level.trim(),
          method: values.method || '',
          description: values.description.trim(),
        };
        if (isEdit) {
          await api(`/api/admin/question-series/${item.id}`, { method: 'PUT', body: payload });
          toast('题库系列已更新');
        } else {
          await api('/api/admin/question-series', { method: 'POST', body: payload });
          toast('题库系列已创建，接下来把题库归入这个系列');
        }
        close();
        await loadQuestionSeries();
        await loadQuestionSets();
      },
    });
  }

  function openQuestionSeriesCoverModal(s) {
    const now = s.has_cover ? '当前为自定义封面（见列表缩略图）' : '当前未设置封面';
    const body =
      field('选择图片', `<input class="input" type="file" id="qss-cover" accept="image/jpeg,image/png,image/webp" />`,
        `${now}。jpg / png / webp，≤8MB；设置后考生端系列卡会用它当封面`) +
      `<div class="form-row"><label>清除封面</label>
        <label class="hint" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" name="clear_cover" value="1" /> 清除自定义封面，恢复默认图标
        </label></div>`;

    openModal({
      title: `系列封面：${s.name}`,
      sub: '选好后点保存即生效',
      fieldsHtml: body,
      okText: '保存',
      onSubmit: async (values, close) => {
        if (values.clear_cover) {
          await api(`/api/admin/question-series/${s.id}/cover`, { method: 'DELETE' });
        } else {
          const input = $('qss-cover');
          const f = input && input.files && input.files[0];
          if (!f) throw new Error('请选择图片，或勾选「清除封面」');
          const form = new FormData();
          form.append('cover', f);
          await multipartRequest(`/api/admin/question-series/${s.id}/cover`, form, 'POST');
        }
        toast('系列封面已更新');
        close();
        await loadQuestionSeries();
      },
    });
  }

  async function removeQuestionSeries(s) {
    if (!confirm(`确定删除题库系列「${s.name}」？\n\n系列里的 ${s.bank_count || 0} 套题库不会被删除，它们会退回「其他题库」（章节和题目都保留）。`)) return;
    try {
      const res = await api(`/api/admin/question-series/${s.id}`, { method: 'DELETE' });
      toast(res.message || '系列已删除');
      await loadQuestionSeries();
      await loadQuestionSets();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ── 题库：列表 / 排序 / 封面 / CRUD ───────────────────── */

  /**
   * 恢复内置题库到官方基线。
   * 先 dry-run 算清「要删几题 / 要补几题」，弹窗让管理员确认后才真正执行
   * （服务端执行前会自动备份数据库，返回里带快照文件名）。
   */
  async function restoreBuiltinBank() {
    const btn = $('qs-restore-builtin');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '检查中…';
    let preview;
    try {
      preview = await api('/api/admin/question-bank/restore', { method: 'POST', body: { dry_run: true } });
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
      return;
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }

    /* 已经干净：不弹确认框，只提示一句（改过内容的原题不动，顺带说一下） */
    if (!preview.remove_count && !preview.restore_count) {
      toast(preview.mismatch_count
        ? `内置题库已是官方基线（${preview.official_total} 题）；有 ${preview.mismatch_count} 道原题内容被改过，未改动`
        : `内置题库已是官方基线（${preview.official_total} 题），无需恢复`);
      return;
    }

    const refs = preview.refs || {};
    const refTotal = (refs.answer_records || 0) + (refs.wrong_dismissals || 0) + (refs.question_reports || 0);
    const range = (r) => (r && r.length === 2 ? (r[0] === r[1] ? `id ${r[0]}` : `id ${r[0]} ~ ${r[1]}`) : '');
    const parts = [];
    parts.push(`<p class="card-sub" style="line-height:1.9;margin-bottom:8px;">
      当前内置题库 <strong>${preview.current_total}</strong> 题，官方基线 <strong>${preview.official_total}</strong> 题。
    </p>`);
    if (preview.remove_count) {
      parts.push(`<p class="card-sub" style="line-height:1.9;margin-bottom:4px;">
        · 移除 <strong style="color:var(--err);">${preview.remove_count}</strong> 道多出来的题
        <span class="hint">（${range(preview.remove_range)}，多半是误导入进来的）</span>
      </p>`);
    }
    if (preview.restore_count) {
      parts.push(`<p class="card-sub" style="line-height:1.9;margin-bottom:4px;">
        · 补回 <strong style="color:var(--ok);">${preview.restore_count}</strong> 道被删掉的官方原题
        <span class="hint">（${range(preview.restore_range)}，按原 id 写回，考生历史记录仍对得上）</span>
      </p>`);
    }
    if (preview.mismatch_count) {
      parts.push(`<p class="card-sub" style="line-height:1.9;margin-bottom:4px;">
        · 有 ${preview.mismatch_count} 道原题内容与官方不一致（可能是有意修改），<strong>本次不动</strong>
      </p>`);
    }
    parts.push(`<p class="card-sub" style="line-height:1.9;margin-top:10px;">
      执行前会<strong>自动备份数据库</strong>；自定义题库、考生账号、资料库都不受影响。
    </p>`);
    if (refTotal) {
      parts.push(`<div class="alert alert-err" style="margin-top:10px;">
        ⚠️ 被移除的题里有 <strong>${refTotal}</strong> 条考生数据（答题记录 ${refs.answer_records || 0} /
        错题标记 ${refs.wrong_dismissals || 0} / 纠错工单 ${refs.question_reports || 0}），会一并清理。
      </div>`);
    }

    openModal({
      title: '恢复内置题库到官方基线',
      sub: '把内置一级题库（UT / RT / MT / PT）还原成官方题库，删掉多出来的、补回被删掉的',
      fieldsHtml: parts.join(''),
      okText: '确认恢复',
      onSubmit: async (_values, close) => {
        const res = await api('/api/admin/question-bank/restore', { method: 'POST', body: {} });
        close();
        toast(res.message || '内置题库已恢复');
        if (res.backup) console.log('[内置题库恢复] 执行前快照：server/data/' + res.backup);
        await loadQuestionSets();
      },
    });
  }

  async function loadQuestionSets() {
    const tbody = $('qs-body');
    try {
      const series = $('qs-series').value;
      const method = $('qs-method').value;
      const q = $('qs-q').value.trim();
      const params = new URLSearchParams();
      // 'loose' = 只看未归系列的散题库；数字 = 某个系列
      if (series === 'loose') params.set('loose', '1');
      else if (series) params.set('series_id', series);
      // 按系列筛选时内置一级题库没有归属，不列出来（避免误导）
      if (series) params.set('include_builtin', '0');
      // 方向筛选（内置题库天生带方向，服务端会保留相符的内置题库）
      if (method) params.set('method', method);
      if (q) params.set('q', q);

      const data = await api('/api/admin/question-sets' + (params.toString() ? '?' + params.toString() : ''));
      const items = data.items || [];
      qsCache = items.filter((x) => !x.builtin);
      let seq = 0;
      tbody.innerHTML = items.map((s) => (s.builtin ? setRow(s, -1, 0) : setRow(s, seq++, qsCache.length))).join('');
      $('qs-empty').classList.toggle('hidden', items.length > 0);

      /* 按钮事件：必须 addEventListener 绑定点击，不能直接调用 ——
         直接调用会在每次列表加载时立刻打开编辑弹窗/触发删除确认，
         而用户点击按钮反而无效（v1.12 事故，v1.13 修复） */
      tbody.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = items.find((x) => x.id === Number(btn.dataset.id));
          if (!item) return;
          const act = btn.dataset.act;
          if (act === 'questions') openQuestionsModal(item);
          if (act === 'chapters') openChaptersModal(item);
          if (act === 'import') openImportModal(item);
          if (act === 'edit') openSetModal(item);
          if (act === 'cover') openSetCoverModal(item);
          if (act === 'del') removeSet(item);
        });
      });
      bindMoveButtons(tbody, 'qset');
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function setRow(s, idx, total) {
    const dist = (s.qtype_counts && Object.keys(s.qtype_counts).length)
      ? QS_QTYPES
          .filter((q) => (s.qtype_counts[q.v] || 0) > 0)
          .map((q) => `<span class="badge badge-off">${q.t} ${s.qtype_counts[q.v]}</span>`)
          .join(' ')
      : '<span class="badge badge-warn">空题库</span>';
    /* 内置一级题库（负数伪 id）：可查题/改题/导入，不可改名、删除、排序、建章节 */
    const builtin = !!s.builtin;
    const seriesCell = builtin
      ? '<span class="hint">内置</span>'
      : (s.series_id
          ? `<span class="badge badge-ok">${esc(s.series_name || ('#' + s.series_id))}</span>`
          : '<span class="hint">未归系列</span>');
    const chapterCell = builtin
      ? '<span class="hint">按知识点</span>'
      : `<span class="mono">${s.chapter_count || 0}</span>`;
    const cover = builtin
      ? '<span class="hint">—</span>'
      : (s.has_cover
          ? `<img class="mat-cover" src="/api/admin/question-sets/${s.id}/cover?token=${encodeURIComponent(getToken())}" alt="封面" />`
          : '<span class="mat-cover mat-cover-none">无</span>');
    const actions = builtin
      ? `<button class="btn btn-sm btn-primary" data-act="questions" data-id="${s.id}">题目</button>
         <button class="btn btn-sm" data-act="import" data-id="${s.id}">导入</button>`
      : `<button class="btn btn-sm btn-primary" data-act="questions" data-id="${s.id}">题目</button>
         <button class="btn btn-sm" data-act="chapters" data-id="${s.id}">章节</button>
         <button class="btn btn-sm" data-act="import" data-id="${s.id}">导入</button>
         <button class="btn btn-sm" data-act="cover" data-id="${s.id}">封面</button>
         <button class="btn btn-sm" data-act="edit" data-id="${s.id}">编辑</button>
         <button class="btn btn-sm btn-danger" data-act="del" data-id="${s.id}">删除</button>`;
    return `<tr>
      <td class="mono">${idx < 0 ? '—' : idx + 1}</td>
      <td><strong>${esc(s.name)}</strong>${builtin ? ' <span class="badge badge-ok">内置</span>' : ''}${s.description ? `<div class="card-sub" style="margin:2px 0 0;">${esc(s.description)}</div>` : ''}</td>
      <td>${s.level ? `<span class="badge badge-ok">${esc(s.level)}</span>` : '—'}</td>
      <td>${esc(s.method || '通用')}</td>
      <td class="wrap" style="max-width:140px;">${seriesCell}</td>
      <td>${chapterCell}</td>
      <td class="mono"><strong>${s.total}</strong> 题</td>
      <td>${dist}</td>
      <td>${cover}</td>
      ${idx < 0 ? '<td class="actions">—</td>' : moveCell('qset', s.id, idx, total)}
      <td class="actions">${actions}</td>
    </tr>`;
  }

  async function moveQuestionSet(id, dir) {
    const ids = withMoved(qsCache, id, dir, (x) => x.id);
    if (!ids) return;
    try {
      await api('/api/admin/question-sets/order', { method: 'POST', body: { ids } });
      await loadQuestionSets();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function openSetModal(item) {
    const isEdit = !!item;
    const s = item || { name: '', level: '', method: '', description: '', series_id: 0 };

    const body =
      field('题库名称', `<input class="input" name="name" value="${esc(s.name)}" required
        placeholder="例如：二级 UT 题库" maxlength="50" />`) +
      field('所属系列', `<select class="input" name="series_id">${qSeriesSelectOptions(s.series_id)}</select>`,
        '系列在考生端是题库页最外一层分组；不选就显示在「其他题库」') +
      field('级别', `<input class="input" name="level" value="${esc(s.level)}"
        placeholder="如：二级 / 三级（留空不显示）" maxlength="20" />`) +
      field('方向', selectHtml('method', QS_METHODS, s.method),
        '题库的类型（UT / RT / 综合…）；上方题库列表可按方向筛选那几套是 RT、那几套是 UT') +
      field('描述', `<textarea class="input" name="description" rows="2"
        placeholder="选填，考生端题库卡片副标题" maxlength="200">${esc(s.description)}</textarea>`);

    openModal({
      title: isEdit ? `编辑题库：${s.name}` : '新建题库',
      sub: isEdit
        ? '保存后考生端题库页同步更新'
        : '创建后点「章节」建章节、往章节里导入题目，或点「题目」逐题添加',
      fieldsHtml: body,
      okText: isEdit ? '保存修改' : '创建',
      onSubmit: async (values, close) => {
        const payload = {
          name: values.name.trim(),
          level: values.level.trim(),
          method: values.method || '',
          description: values.description.trim(),
          series_id: Number(values.series_id || 0),
        };
        if (isEdit) {
          await api(`/api/admin/question-sets/${item.id}`, { method: 'PUT', body: payload });
          toast('题库信息已更新');
        } else {
          await api('/api/admin/question-sets', { method: 'POST', body: payload });
          toast('题库已创建，接下来点「章节」建章节并导入题目');
        }
        close();
        await loadQuestionSets();
        await loadQuestionSeries();
      },
    });
  }

  function openSetCoverModal(s) {
    const now = s.has_cover ? '当前为自定义封面（见列表缩略图）' : '当前未设置封面';
    const body =
      field('选择图片', `<input class="input" type="file" id="qs-cover" accept="image/jpeg,image/png,image/webp" />`,
        `${now}。jpg / png / webp，≤8MB；设置后考生端题库卡片会用它当封面`) +
      `<div class="form-row"><label>清除封面</label>
        <label class="hint" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" name="clear_cover" value="1" /> 清除自定义封面，恢复默认图标
        </label></div>`;

    openModal({
      title: `题库封面：${s.name}`,
      sub: '选好后点保存即生效',
      fieldsHtml: body,
      okText: '保存',
      onSubmit: async (values, close) => {
        if (values.clear_cover) {
          await api(`/api/admin/question-sets/${s.id}/cover`, { method: 'DELETE' });
        } else {
          const input = $('qs-cover');
          const f = input && input.files && input.files[0];
          if (!f) throw new Error('请选择图片，或勾选「清除封面」');
          const form = new FormData();
          form.append('cover', f);
          await multipartRequest(`/api/admin/question-sets/${s.id}/cover`, form, 'POST');
        }
        toast('题库封面已更新');
        close();
        await loadQuestionSets();
      },
    });
  }

  async function removeSet(s) {
    if (!confirm(`确定删除题库「${s.name}」？\n包含 ${s.chapter_count || 0} 个章节、${s.total} 道题将一并删除，相关答题记录也会清空，不可恢复！`)) return;
    try {
      const res = await api(`/api/admin/question-sets/${s.id}`, { method: 'DELETE' });
      toast(res.message || '已删除');
      await loadQuestionSets();
      renderQSeriesFilterOptions();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ── 章节管理（题库下面自己建章节，CSV 按章节导入）──────── */

  function openChaptersModal(set) {
    const root = $('modal-root');
    chapterCtx = { setId: set.id, items: [] };
    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal modal-wide" style="max-width: 780px;">
          <h3>章节管理：${esc(set.name)}</h3>
          <p class="modal-sub">
            题库下面自己建章节，然后往章节里导入题目；考生端点这套题库时可以「按章节练习」。
            <strong>删除章节不会删除题目</strong>，那些题会退回「未归章节」，仍可按整套题库顺序练。
          </p>
          <div class="toolbar">
            <button class="btn" id="chs-refresh">刷新</button>
            <div class="spacer"></div>
            <button class="btn btn-primary" id="chs-new">+ 新建章节</button>
          </div>
          <div id="chs-hint" class="hint" style="margin:6px 0;"></div>
          <div id="chs-err" class="alert alert-err hidden"></div>
          <div id="chs-list" class="table-wrap" style="max-height: 46vh; overflow-y: auto;">
            <div class="empty">加载中…</div>
          </div>
          <div class="modal-actions">
            <div class="spacer"></div>
            <button type="button" class="btn" id="chs-close">关闭</button>
          </div>
        </div>
      </div>`;

    const close = () => { root.innerHTML = ''; };
    const err = $('chs-err');
    const showErr = (msg) => { err.textContent = msg; err.classList.remove('hidden'); };

    $('chs-close').addEventListener('click', close);
    root.querySelector('.modal-mask').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('modal-mask')) close();
    });
    $('chs-refresh').addEventListener('click', loadList);
    $('chs-new').addEventListener('click', () => openChapterModal(set, null, loadList));

    async function loadList() {
      try {
        const data = await api(`/api/admin/question-sets/${set.id}/chapters`);
        const items = data.items || [];
        chapterCtx = { setId: set.id, items };
        $('chs-hint').textContent = data.untagged
          ? `还有 ${data.untagged} 道题没归章节（导入题目 时按知识点一自动分组的旧题），它们仍可按整套题库顺序练。`
          : '';

        if (!items.length) {
          $('chs-list').innerHTML = '<div class="empty">还没有章节，点右上角「新建章节」，建好后点章节行的「导入」上传 CSV</div>';
          return;
        }

        $('chs-list').innerHTML = `<table>
          <thead><tr>
            <th style="width:56px;">序号</th><th>章节名</th><th>说明</th>
            <th style="width:80px;">题数</th><th style="width:90px;">排序</th><th style="width:220px;">操作</th>
          </tr></thead>
          <tbody>
            ${items.map((c, i) => {
              const up = `<button class="btn btn-sm" data-move="up" data-movekind="chapter" data-id="${c.id}"
                title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>`;
              const down = `<button class="btn btn-sm" data-move="down" data-movekind="chapter" data-id="${c.id}"
                title="下移" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>`;
              return `<tr>
                <td class="mono">${i + 1}</td>
                <td><strong>${esc(c.name)}</strong></td>
                <td class="wrap" style="max-width:200px;">${esc(c.description || '—')}</td>
                <td class="mono">${c.count}</td>
                <td class="actions">${up}${down}</td>
                <td class="actions">
                  <button class="btn btn-sm btn-primary" data-cact="import" data-id="${c.id}">导入题目</button>
                  <button class="btn btn-sm" data-cact="edit" data-id="${c.id}">编辑</button>
                  <button class="btn btn-sm btn-danger" data-cact="del" data-id="${c.id}">删除</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;

        $('chs-list').querySelectorAll('[data-cact]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const c = chapterCtx.items.find((x) => x.id === Number(btn.dataset.id));
            if (!c) return;
            if (btn.dataset.cact === 'import') openImportModal(set, c, loadList);
            if (btn.dataset.cact === 'edit') openChapterModal(set, c, loadList);
            if (btn.dataset.cact === 'del') removeChapter(set, c, loadList);
          });
        });
        bindMoveButtons($('chs-list'), 'chapter');
      } catch (e) {
        if (!handleAuthError(e)) showErr(e.message);
      }
    }

    loadList();
  }

  async function moveChapter(id, dir) {
    const ids = withMoved(chapterCtx.items, id, dir, (x) => x.id);
    if (!ids) return;
    try {
      await api(`/api/admin/question-sets/${chapterCtx.setId}/chapters/order`, { method: 'POST', body: { ids } });
      await loadChapterListIntoModal();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /** 章节排序后刷新弹窗里的列表（弹窗是自己绘的，没有独立 loader 时重新点一次刷新） */
  async function loadChapterListIntoModal() {
    const btn = $('chs-refresh');
    if (btn) btn.click();
    await loadQuestionSets();
  }

  function openChapterModal(set, chapter, after) {
    const isEdit = !!chapter;
    const c = chapter || { name: '', description: '' };
    const body =
      field('章节名称', `<input class="input" name="name" value="${esc(c.name)}" required
        placeholder="例如：第 1 章 超声检测物理基础" maxlength="50" />`,
        isEdit ? '改名会同步已导入题目的「知识点一」，考生端按章节练习不受影响' : '') +
      field('章节说明', `<textarea class="input" name="description" rows="2"
        placeholder="选填" maxlength="200">${esc(c.description || '')}</textarea>`);

    openModal({
      title: isEdit ? `编辑章节：${c.name}` : `新建章节：${set.name}`,
      sub: isEdit ? '保存后立即生效' : '建好后点这一行的「导入题目」，整批题都会归到这个章节',
      fieldsHtml: body,
      okText: isEdit ? '保存修改' : '创建',
      onSubmit: async (values, close) => {
        const payload = { name: values.name.trim(), description: values.description.trim() };
        if (isEdit) {
          await api(`/api/admin/question-sets/${set.id}/chapters/${chapter.id}`, { method: 'PUT', body: payload });
          toast('章节已更新');
        } else {
          await api(`/api/admin/question-sets/${set.id}/chapters`, { method: 'POST', body: payload });
          toast('章节已创建，可以往里导入题目 了');
        }
        close();
        if (after) await after();
        await loadQuestionSets();
      },
    });
  }

  async function removeChapter(set, chapter, after) {
    if (!confirm(`确定删除章节「${chapter.name}」？\n\n章节里的 ${chapter.count} 道题不会被删除，它们会退回「未归章节」。`)) return;
    try {
      const res = await api(`/api/admin/question-sets/${set.id}/chapters/${chapter.id}`, { method: 'DELETE' });
      toast(res.message || '章节已删除');
      if (after) await after();
      await loadQuestionSets();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }


  /** 题目管理弹窗（自绘，不用 openModal 表单流程）：按题型分组列出题目，可删单题 */
  function openQuestionsModal(set) {
    const root = $('modal-root');
    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal" style="max-width: 880px;">
          <h3>题目管理：${esc(set.name)}</h3>
          <p class="modal-sub">共 ${set.total} 题，按题型分类；题前序号 = 这道题在本题库里的固定位置（1 起）。</p>
          <div class="toolbar">
            <input class="input" id="qsm-q" type="search" placeholder="搜索题干 / 选项 / 答案"
              style="width:230px;" title="输入关键词即时搜索；回车立即搜" />
            <label class="hint" style="display:flex;align-items:center;gap:6px;margin:0;">
              题型
              <select class="input" id="qsm-qtype" style="width:110px;">
                <option value="">全部</option>
                ${QS_QTYPES.map((q) => `<option value="${q.v}">${q.t}</option>`).join('')}
              </select>
            </label>
            <button class="btn" id="qsm-refresh">刷新</button>
            <div class="spacer"></div>
            ${set.builtin ? '' : '<button class="btn" id="qsm-chapters">章节管理</button>'}
          </div>
          <div id="qsm-err" class="alert alert-err hidden"></div>
          <div id="qsm-list" class="table-wrap" style="max-height: 46vh; overflow-y: auto;">
            <div class="empty">加载中…</div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-primary" id="qsm-add">+ 添加题目</button>
            <button type="button" class="btn" id="qsm-import">批量导入题目</button>
            <div class="spacer"></div>
            <button type="button" class="btn" id="qsm-close">关闭</button>
          </div>
        </div>
      </div>`;

    const close = () => { root.innerHTML = ''; };
    const qsmErr = $('qsm-err');
    const showErr = (msg) => { qsmErr.textContent = msg; qsmErr.classList.remove('hidden'); };

    $('qsm-close').addEventListener('click', close);
    root.querySelector('.modal-mask').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('modal-mask')) close();
    });
    $('qsm-refresh').addEventListener('click', loadList);
    $('qsm-qtype').addEventListener('change', loadList);
    $('qsm-add').addEventListener('click', () => openAddQuestionModal(set, loadList));
    $('qsm-import').addEventListener('click', () => openImportModal(set, null, loadList));
    const chapterBtn = $('qsm-chapters');
    if (chapterBtn) chapterBtn.addEventListener('click', () => openChaptersModal(set));

    // 关键词搜索：输入即搜（250ms 防抖），回车立刻搜（不等防抖）
    let qTimer = null;
    $('qsm-q').addEventListener('input', () => {
      if (qTimer) clearTimeout(qTimer);
      qTimer = setTimeout(loadList, 250);
    });
    $('qsm-q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (qTimer) clearTimeout(qTimer);
        loadList();
      }
    });

    async function loadList() {
      try {
        const qtype = $('qsm-qtype').value;
        const keyword = $('qsm-q').value.trim();
        const params = new URLSearchParams();
        // 一次拉满（接口上限 2000）：搜索要能搜到全库，不能被默认 500 截断
        params.set('limit', '2000');
        if (qtype) params.set('qtype', qtype);
        if (keyword) params.set('q', keyword);
        const query = params.toString();
        const data = await api(`/api/admin/question-sets/${set.id}/questions` + (query ? `?${query}` : ''));
        const items = data.items || [];
        const groups = QS_QTYPES.map((q) => ({
          label: q.t,
          rows: items.filter((x) => x.qtype === q.v),
        })).filter((g) => g.rows.length > 0);

        const hitTip = keyword
          ? `<div class="hint" style="margin:0 0 10px;">关键词「${esc(keyword)}」命中 ${items.length} 题</div>`
          : '';
        $('qsm-list').innerHTML = hitTip + (groups.length
          ? groups.map((g) => `
              <div style="margin-bottom: 14px;">
                <div style="margin: 6px 0 6px;"><span class="badge badge-super">${g.label} · ${g.rows.length}</span></div>
                <table>
                  <thead><tr><th style="width:56px;">#</th><th>题干</th><th style="width:130px;">章节</th><th style="width:110px;">答案</th><th style="width:80px;">操作</th></tr></thead>
                  <tbody>
                    ${g.rows.map((r) => `<tr>
                      <td class="mono" title="数据库 ID ${r.id}">${r.seq || r.id}</td>
                      <td class="wrap" style="white-space:normal;max-width:380px;">${richTextSearchHtml(r.content, 'sm', keyword)}</td>
                      <td class="wrap" style="max-width:130px;">${r.topic ? esc(r.topic) : '<span class="hint">未归章节</span>'}</td>
                      <td class="wrap">${richTextSearchHtml(r.answer, 'sm', keyword)}</td>
                      <td class="actions">
                        <button class="btn btn-sm" data-qedit="${r.id}">编辑</button>
                        <button class="btn btn-sm btn-danger" data-qid="${r.id}">删除</button>
                      </td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>`).join('')
          : (keyword
            ? `<div class="empty">没有匹配「${esc(keyword)}」的题目，换个关键词试试</div>`
            : '<div class="empty">还没有题目，点「添加题目」或「批量导入题目」</div>'));

        $('qsm-list').querySelectorAll('[data-qid]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const qid = Number(btn.dataset.qid);
            const row = items.find((x) => x.id === qid);
            if (!row) return;
            if (!confirm(`删除这道${row.qtype_label}？\n${String(row.content).slice(0, 60)}…\n该题的答题记录也会一并删除，不可恢复。`)) return;
            try {
              await api(`/api/admin/question-sets/${set.id}/questions/${qid}`, { method: 'DELETE' });
              toast('题目已删除');
              await loadList();
              await loadQuestionSets();
            } catch (err) {
              if (!handleAuthError(err)) showErr(err.message);
            }
          });
        });

        /* 编辑题目（内置 / 自定义题库通用，直接写库） */
        $('qsm-list').querySelectorAll('[data-qedit]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const qid = Number(btn.dataset.qedit);
            const row = items.find((x) => x.id === qid);
            if (row) openEditQuestionModal(set, row, loadList);
          });
        });
      } catch (err) {
        if (!handleAuthError(err)) showErr(err.message);
      }
    }

    loadList();
  }

  /** 章节下拉（自定义题库才用得上）：0 = 不归章节 */
  function chapterOptionsHtml(chapters, selected) {
    const head = `<option value="0" ${!selected ? 'selected' : ''}>（不归章节）</option>`;
    return head + chapters.map((c) =>
      `<option value="${c.id}" ${Number(selected) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  }

  /** 拉某套题库的章节（内置题库没有章节，返回空数组） */
  async function fetchChapters(setId) {
    try {
      const data = await api(`/api/admin/question-sets/${setId}/chapters`);
      return (data.items || []).filter((c) => c.id > 0);
    } catch (e) {
      return [];
    }
  }

  async function openAddQuestionModal(set, after) {
    const chapters = set.builtin ? [] : await fetchChapters(set.id);
    const body =
      field('题型', selectHtml('qtype', QS_QTYPES, 'single'),
        '判断题自动生成「正确 / 错误」两个选项；多选题答案填多个字母（如 ACD）；简答题不需要选项') +
      (set.builtin ? '' : field('所属章节', `<select class="input" name="chapter_id">${chapterOptionsHtml(chapters, 0)}</select>`,
        chapters.length ? '选中的话考生端就能按这一章单独练' : '这套题库还没有章节，可先去「章节管理」新建')) +
      field('题干', `<textarea class="input" name="content" rows="3" required
        placeholder="输入题目内容" maxlength="2000"></textarea>`) +
      field('选项', `<textarea class="input" name="options_raw" rows="3"
        placeholder="A、选项一；##B、选项二；##C、选项三；##D、选项四"></textarea>`,
        '选择题 / 多选题 / 计算选择题必填（至少 2 个），用「；##」分隔；判断题留空自动生成；简答题留空') +
      field('答案', `<input class="input" name="answer" required
        placeholder="选择/计算选择题填一个字母（如 A）；多选题填多个字母（如 ACD，顺序不限）；判断题填 正确/错误；计算题/简答题填参考答案" maxlength="1000" />`) +
      field('解析 / 解答过程', `<textarea class="input" name="explanation" rows="2"
        placeholder="选填。计算题建议写解答过程：已知 → 公式 → 代入计算 → 结论；也可以只插一张解答过程图片"
        maxlength="2000"></textarea>`,
        '考生端答完题后展示在「题目原题讲解」里（可展开/收起）。' +
        '<strong>计算题如果留空，考生端会自动让 AI 分步写出解答过程</strong>，并标注「AI 生成、仅供参考」') +
      field('插图', `<div class="rt-tools">
          <button type="button" class="btn btn-sm" data-insert-img="content">＋ 题干插图</button>
          <button type="button" class="btn btn-sm" data-insert-img="explanation">＋ 解答过程插图</button>
          <span class="rt-opt-wrap" data-opt-picker="options_raw"></span>
        </div>
        <div class="rt-preview"></div>`,
        '识图题、粗糙度符号、公式截图用这里：点「题干插图」插到题干里；点「解答过程插图」插到上面的解析里；点「A / B / C …」把图插到对应选项后面，选项还没有就点「＋ 字母」新建一个。显示统一缩放到 180px 高，考生端点一下可看大图');

    openModal({
      title: `添加题目：${set.name}`,
      sub: '保存后立即出现在考生端这套题库里',
      fieldsHtml: body,
      okText: '保存题目',
      onMount: () => bindRichEditor($('modal-root'), [
        { name: 'content', label: '题干' },
        { name: 'options_raw', label: '选项', options: true },
        { name: 'explanation', label: '解析 / 解答过程' },
      ]),
      onSubmit: async (values, close) => {
        await api(`/api/admin/question-sets/${set.id}/questions`, {
          method: 'POST',
          body: {
            qtype: values.qtype,
            content: values.content,
            options_raw: values.options_raw || '',
            answer: values.answer,
            explanation: values.explanation || '',
            chapter_id: Number(values.chapter_id || 0),
          },
        });
        toast('题目已添加');
        close();
        if (after) await after();
        await loadQuestionSets();
      },
    });
  }

  /** 编辑题目：预填现有题干/选项/答案，PUT 保存（内置一级题库同样适用，直接写库） */
  async function openEditQuestionModal(set, q, after) {
    const chapters = set.builtin ? [] : await fetchChapters(set.id);
    const optionsRaw = (q.options || []).map((o) => `${o.key}、${o.text}`).join('；##');
    const body =
      field('题型', selectHtml('qtype', QS_QTYPES, q.qtype),
        '改题型会按规则重建选项：判断题=正确/错误，简答题无选项，多选题答案填多个字母') +
      (set.builtin ? '' : field('所属章节', `<select class="input" name="chapter_id">${chapterOptionsHtml(chapters, q.chapter_id)}</select>`,
        '选「不归章节」= 保持原样，不改变这道题的章节归属')) +
      field('题干', `<textarea class="input" name="content" rows="3" required
        maxlength="2000">${esc(q.content)}</textarea>`) +
      field('选项', `<textarea class="input" name="options_raw" rows="3"
        placeholder="A、选项一；##B、选项二；##C、选项三；##D、选项四">${esc(optionsRaw)}</textarea>`,
        '选择题 / 多选题 / 计算选择题用；判断题留空自动生成；简答题留空') +
      field('正确答案', `<input class="input" name="answer" required
        placeholder="选择/计算选择题填一个字母（如 A）；多选题填多个字母（如 ACD，顺序不限）；判断题填 正确/错误；计算题/简答题填参考答案" maxlength="1000"
        value="${esc(q.answer)}" />`) +
      field('解析 / 解答过程', `<textarea class="input" name="explanation" rows="2"
        placeholder="选填。计算题建议写解答过程：已知 → 公式 → 代入计算 → 结论；也可以只插一张解答过程图片"
        maxlength="2000">${esc(q.explanation || '')}</textarea>`,
        '考生端答完题后展示在「题目原题讲解」里（可展开/收起）。' +
        '<strong>计算题如果留空，考生端会自动让 AI 分步写出解答过程</strong>，并标注「AI 生成、仅供参考」') +
      field('插图', `<div class="rt-tools">
          <button type="button" class="btn btn-sm" data-insert-img="content">＋ 题干插图</button>
          <button type="button" class="btn btn-sm" data-insert-img="explanation">＋ 解答过程插图</button>
          <span class="rt-opt-wrap" data-opt-picker="options_raw"></span>
        </div>
        <div class="rt-preview"></div>`,
        '点「解答过程插图」把图插到上面的解析里；点「A / B / C …」把图插到对应选项后面，选项还没有就点「＋ 字母」新建一个；已有的插图显示在下面，图片丢了会显示「图片已丢失」，重新上传即可');

    openModal({
      // 序号用题库内位置（seq），与题目列表里的「#」列一致；工单跳转过来时没带 seq，退回数据库 id
      title: `编辑题目 #${q.seq || q.id}`,
      sub: '保存后立即生效，考生端下次拉题即为修正后的内容',
      fieldsHtml: body,
      okText: '保存修改',
      onMount: () => bindRichEditor($('modal-root'), [
        { name: 'content', label: '题干' },
        { name: 'options_raw', label: '选项', options: true },
        { name: 'explanation', label: '解析 / 解答过程' },
      ]),
      onSubmit: async (values, close) => {
        await api(`/api/admin/question-sets/${set.id}/questions/${q.id}`, {
          method: 'PUT',
          body: {
            qtype: values.qtype,
            content: values.content,
            options_raw: values.options_raw || '',
            answer: values.answer,
            explanation: values.explanation || '',
            chapter_id: Number(values.chapter_id || 0),
          },
        });
        toast('题目已更新');
        close();
        if (after) await after();
        await loadQuestionSets();
        await loadReports(); // 编辑题目会自动关闭对应纠错工单，刷新工单列表
      },
    });
  }

  /** 导入结果小结窗：成功几题、各题型分布、跳过了哪些、哪些需要复查、文件是怎么被识别的 */
  function showImportResult(res, where) {
    const errs = res.errors || [];
    const warns = res.warnings || [];
    const byType = res.imported_by_type || {};
    const typeLine = QS_QTYPES
      .filter((q) => byType[q.v])
      .map((q) => `${q.t} ${byType[q.v]}`)
      .join(' · ');
    const rows = [
      `<div class="stat"><div class="k">成功导入</div><div class="v">${res.imported}</div><div class="m">题</div></div>`,
      `<div class="stat"><div class="k">跳过</div><div class="v">${res.skipped}</div><div class="m">条</div></div>`,
      warns.length ? `<div class="stat"><div class="k">需复查</div><div class="v">${warns.length}</div><div class="m">条</div></div>` : '',
    ].join('');
    const listBox = (items) =>
      `<div class="hint" style="max-height:200px;overflow:auto;line-height:1.9;">${items.map((e) => esc(e)).join('<br />')}</div>`;
    const html =
      `<div class="stat-row" style="display:flex;gap:12px;margin-bottom:12px;">${rows}</div>` +
      (typeLine ? `<div class="alert alert-info"><strong>题型分布</strong>：${esc(typeLine)}</div>` : '') +
      (res.note ? `<div class="alert alert-info">${esc(res.note)}</div>` : '') +
      (errs.length
        ? `<div class="form-row"><label>跳过的行（最多显示 50 条，未写进题库）</label>${listBox(errs)}</div>`
        : '') +
      (warns.length
        ? `<div class="form-row"><label>需复查提醒（已导入，建议核对）</label>${listBox(warns)}</div>`
        : '');
    openNoticeModal({
      title: `导入完成：${where}`,
      sub: '跳过的行没有写入题库，修好后可再次导入（重复导入会产生重复题，建议先导出核对）',
      html,
    });
  }

  /** 批量导入题目：支持 CSV（UTF-8 / GBK / UTF-16 自动识别）与 Excel（.xlsx，即使扩展名写成 .csv）
   *  chapter 传了就把整批题归到那个章节（章节管理里点「导入题库」走的就是这里） */
  function openImportModal(set, chapter, after) {
    const sample = '表头行…,然后每行一题，例如：\\n' +
      '1,,GENERAL,,判断题,超声检测中探头频率越高分辨率越高,,正确\\n' +
      '2,,GENERAL,,选择题,超声波在钢中的声速约为？,A、5900m/s；##B、340m/s；##C、1500m/s,A\\n' +
      '3,,GENERAL,,多选题,下列超声波检测的说法正确的有？,A、频率越高分辨率越好；##B、声速与频率成正比；##C、耦合不良会使回波降低,AC';

    const body =
      (chapter
        ? `<div class="alert alert-info">这批题会全部归到章节「<strong>${esc(chapter.name)}</strong>」，知识点一以章节名为准。</div>`
        : '') +
      field('选择文件（CSV / Excel）', `<input class="input" type="file" id="qsi-file" accept=".csv,.txt,.xlsx,.xls" />
        <div style="margin-top:6px;"><a href="#" id="qsi-tpl" style="font-size:12px;font-weight:600;color:var(--accent,#2b7a78);">⬇ 下载导入模板（含完整字段说明 + 六种题型示例）</a></div>`,
        '支持 Excel（.xlsx，含被改成 .csv 的）与 CSV；编码 UTF-8 / GBK / UTF-16 自动识别；' +
        '表头列名（章节 / 题型 / 题目 / 选项A~E / 答案…）自动对应') +
      field('题目内容', `<textarea class="input" name="csv" id="qsi-text" rows="8"
        placeholder="${esc(sample)}"></textarea>
        <div class="hint" id="qsi-detect">也可以直接把表格内容粘贴进来；标准 8 列：序号,项目,知识点一,知识点二,题目类型,题目内容,题目选项,题目答案` +
        `（首行表头会自动跳过，以 # 开头的说明行也会自动忽略）。` +
        `题型支持 判断题 / 选择题 / 多选题 / 计算题 / 计算选择题 / 简答题；选项写「A、xx；##B、xx；」；答案：判断题填 正确/错误，选择题填单个字母，多选题把正确项字母连着写（如 AC，顺序不限），计算题、简答题把参考答案写进「题目答案」列。` +
        `想放图的题：正文里先写「[图片]」占位，导入后点该题「编辑」→「插入图片」会自动替换。` +
        `<br />点上面的「⬇ 下载导入模板」可拿到带完整字段说明和六种题型示例的 CSV；图片没法直接放进 CSV，导入后用「编辑」→「＋ 题干插图 / ＋ 选项插图」补上（识图题、粗糙度符号、公式这类）</div>`,
        '') +
      (chapter ? `<input type="hidden" name="chapter_id" value="${chapter.id}" />` : '');

    // 选中原始文件后：原始字节直接送后端（后端权威解码，前端这份只用于预览）
    let picked = null;       // { b64, name }
    let lastPreview = null;  // 上次自动填入的预览文本，用于判断用户有没有手动改过

    openModal({
      title: chapter ? `导入题目到章节：${chapter.name}` : `批量导入：${set.name}`,
      sub: '按行解析，异常行会跳过并提示，不影响已导入的题目',
      fieldsHtml: body,
      okText: '开始导入',
      onSubmit: async (values, close) => {
        const edited = lastPreview !== null && values.csv !== lastPreview;
        const payload = { chapter_id: Number(values.chapter_id || 0) };
        if (picked && !edited) {
          payload.file_b64 = picked.b64;
          payload.filename = picked.name;
        } else if (values.csv && values.csv.trim()) {
          payload.csv = values.csv;
        } else {
          throw new Error('请先选择文件或粘贴题目内容');
        }
        const res = await api(`/api/admin/question-sets/${set.id}/import`, { method: 'POST', body: payload });
        toast(`导入完成：成功 ${res.imported} 题`);
        close();
        if (after) await after();
        await loadQuestionSets();
        // 有跳过的行 / 需复查提醒 / 做了格式识别 → 弹小结，让管理员看清到底导进去了什么
        if (res.skipped || (res.errors || []).length || (res.warnings || []).length || res.note) {
          showImportResult(res, chapter ? chapter.name : set.name);
        }
      },
    });

    // 「下载模板」：直接下服务端那份标准模板（项目根 题库导入模板.csv，含六种题型示例）
    const tplLink = $('qsi-tpl');
    if (tplLink) {
      tplLink.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(`/api/admin/question-sets/import-template?token=${encodeURIComponent(getToken())}`, '_blank');
      });
    }

    // 选文件后：按真实内容判断类型并解码，回填文本框做预览
    const fileInput = $('qsi-file');
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        const tip = $('qsi-detect');
        const textarea = $('qsi-text');
        try {
          if (f.size > 10 * 1024 * 1024) throw new Error('文件超过 10MB，请拆分后再导入');
          const bytes = new Uint8Array(await f.arrayBuffer());
          picked = { b64: bytesToBase64(bytes), name: f.name };
          const size = `${(f.size / 1024).toFixed(0)} KB`;

          if (isZipBytes(bytes)) {
            lastPreview = '';
            textarea.value = '';
            textarea.placeholder = '（Excel 文件无需预览，点「开始导入」即可）';
            if (tip) tip.innerHTML = `已识别为 <strong>Excel 文件</strong>「${esc(f.name)}」（${size}），提交时自动按表格解析，无需转换。`;
            return;
          }
          if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
            picked = null;
            throw new Error('这是老版 Excel（.xls）文件，请在 Excel 里「另存为」.xlsx 或「CSV UTF-8」后再导入');
          }
          const { text, enc } = decodeTabularText(bytes);
          textarea.value = text;
          lastPreview = text;
          if (tip) tip.innerHTML = `已读取「${esc(f.name)}」（${size}），编码识别为 <strong>${enc}</strong>；` +
            `下面内容只是预览，若需修改可直接编辑。`;
        } catch (err) {
          picked = null;
          lastPreview = null;
          textarea.value = '';
          if (tip) tip.innerHTML = `<span style="color:var(--danger,#c0392b)">${esc(err.message)}</span>`;
        }
      });
    }
  }

  /* ============================================================
     模块六点五：资料库（标准 / 教材 / 辅导资料 / 视频课程）
     分类跨端一致常量（与 server/modules/materials.py、考生端 MaterialsScreen.tsx 同步）：
       standard 标准规范 / textbook 教材 / material 辅导资料 / video 视频课程
     文件存服务器 data/uploads/，元数据存 materials 表；
     上传是 multipart，不走 api()（它只发 JSON），单独用 fetch + FormData。
     ============================================================ */

  const MATERIAL_CATEGORIES = [
    { v: 'standard', t: '标准规范' },
    { v: 'textbook', t: '教材' },
    { v: 'material', t: '辅导资料' },
    { v: 'video',    t: '视频课程' },
  ];
  const MATERIAL_METHODS = [
    { v: '', t: '通用' },
    { v: 'UT', t: 'UT' }, { v: 'RT', t: 'RT' }, { v: 'MT', t: 'MT' },
    { v: 'PT', t: 'PT' }, { v: 'ET', t: 'ET' }, { v: 'VT', t: 'VT' },
    { v: '综合', t: '综合' },
  ];

  function bindMaterialModule() {
    $('mats-refresh').addEventListener('click', loadMaterials);
    $('mats-search').addEventListener('click', loadMaterials);
    $('mats-category').addEventListener('change', loadMaterials);
    $('mats-method').addEventListener('change', loadMaterials);
    $('mats-series').addEventListener('change', loadMaterials);
    $('mats-upload').addEventListener('click', openUploadModal);
    $('mats-slice').addEventListener('click', sliceExistingPdfs);
    $('mats-convert').addEventListener('click', convertExistingDocs);
    $('mats-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMaterials(); });
    // 系列管理
    $('series-refresh').addEventListener('click', loadSeries);
    $('series-category').addEventListener('change', loadSeries);
    $('series-new').addEventListener('click', openNewSeriesModal);
  }

  /** 当前系列缓存：资料列表里把 series_id 显示成系列名 */
  let seriesCache = [];

  /* ── 上移 / 下移（资料与系列共用同一套逻辑）────────────────
     后台列表的顺序 = 全表顺序（sort_order 倒序）。点 ↑/↓ 就在**当前可见列表**里
     把这一条和相邻的一条换位，然后把整份可见顺序提交给 /order ——
     后端只动这批 id 占的槽位，筛选出来的部分列表里上下移动不会打乱别的资料。 */
  function withMoved(list, id, dir, idOf) {
    const ids = list.map(idOf);
    const i = ids.indexOf(id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return null;
    const out = ids.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }

  async function moveMaterial(id, dir) {
    const ids = withMoved(matCache, id, dir, (x) => x.id);
    if (!ids) return;
    try {
      await api('/api/admin/materials/order', { method: 'POST', body: { ids } });
      await loadMaterials();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  async function moveSeries(id, dir) {
    const ids = withMoved(seriesCache, id, dir, (x) => x.id);
    if (!ids) return;
    try {
      await api('/api/admin/materials/series/order', { method: 'POST', body: { ids } });
      await loadSeries();
      await loadMaterials();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /** 排序列的两个小按钮（列表首尾各禁用一半，避免点了没反应） */
  function moveCell(kind, id, idx, total) {
    const up = `<button class="btn btn-sm" data-move="up" data-movekind="${kind}" data-id="${id}"
      title="上移" ${idx === 0 ? 'disabled' : ''}>↑</button>`;
    const down = `<button class="btn btn-sm" data-move="down" data-movekind="${kind}" data-id="${id}"
      title="下移" ${idx === total - 1 ? 'disabled' : ''}>↓</button>`;
    return `<td class="actions">${up}${down}</td>`;
  }

  /** 给排序列的按钮挂事件（innerHTML 重渲染后必须重新绑，严禁在渲染里直接调动作） */
  function bindMoveButtons(tbody, kind) {
    const handler = MOVE_ACTIONS[kind];
    if (!handler) return;
    tbody.querySelectorAll(`[data-movekind="${kind}"]`).forEach((btn) => {
      btn.addEventListener('click', () => handler(Number(btn.dataset.id), btn.dataset.move));
    });
  }

  async function loadSeries() {
    const tbody = $('series-body');
    try {
      const category = $('series-category').value;
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      const data = await api('/api/admin/materials/series' + (params.toString() ? '?' + params.toString() : ''));
      seriesCache = data.items || [];
      tbody.innerHTML = seriesCache.map((s, i) => seriesRow(s, i, seriesCache.length)).join('');
      $('series-empty').classList.toggle('hidden', seriesCache.length > 0);

      tbody.querySelectorAll('[data-sact]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = seriesCache.find((x) => x.id === Number(btn.dataset.id));
          if (!item) return;
          if (btn.dataset.sact === 'edit') openEditSeriesModal(item);
          if (btn.dataset.sact === 'cover') openSeriesCoverModal(item);
          if (btn.dataset.sact === 'del') removeSeries(item);
        });
      });
      bindMoveButtons(tbody, 'series');

      renderSeriesFilterOptions();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function seriesRow(s, idx, total) {
    const cat = MATERIAL_CATEGORIES.find((c) => c.v === s.category);
    const cover = s.has_cover
      ? `<img class="mat-cover" src="/api/admin/materials/series/${s.id}/cover?token=${encodeURIComponent(getToken())}" alt="封面" />`
      : `<span class="mat-cover mat-cover-none">无</span>`;
    return `<tr>
      <td class="mono">${idx + 1}</td>
      <td class="wrap"><strong>${esc(s.title)}</strong></td>
      <td><span class="badge badge-ok">${esc(cat ? cat.t : s.category)}</span></td>
      <td>${esc(s.method || '通用')}</td>
      <td class="wrap" style="max-width:220px;">${esc(s.description || '—')}</td>
      <td class="mono">${s.item_count || 0}</td>
      <td>${cover}</td>
      ${moveCell('series', s.id, idx, total)}
      <td class="actions">
        <button class="btn btn-sm" data-sact="edit" data-id="${s.id}">编辑</button>
        <button class="btn btn-sm" data-sact="cover" data-id="${s.id}">封面</button>
        <button class="btn btn-sm btn-danger" data-sact="del" data-id="${s.id}">删除</button>
      </td>
    </tr>`;
  }

  /** 资料列表的「所属系列」下拉：选项跟着系列走（未归系列 = 空值） */
  function renderSeriesFilterOptions() {
    const sel = $('mats-series');
    const cur = sel.value;
    const options = ['<option value="">全部系列</option>', '<option value="loose">未归系列（其他）</option>'];
    seriesCache.forEach((s) => {
      options.push(`<option value="${s.id}">${esc(s.title)}（${s.item_count || 0}）</option>`);
    });
    sel.innerHTML = options.join('');
    // 尽量保留原选择（系列被删就回到「全部系列」）
    if (cur && (cur === 'loose' || seriesCache.some((s) => String(s.id) === cur))) sel.value = cur;
  }

  /** 上传 / 编辑资料时的「所属系列」下拉：只列同一个大类下的系列 */
  function seriesSelectOptions(category, selected) {
    const list = seriesCache.filter((s) => s.category === category);
    const head = `<option value="0" ${!selected ? 'selected' : ''}>（不归入系列 · 显示在「其他」）</option>`;
    return head + list.map((s) =>
      `<option value="${s.id}" ${Number(selected) === s.id ? 'selected' : ''}>${esc(s.title)}</option>`).join('');
  }

  function openNewSeriesModal() {
    const body =
      field('系列名称', `<input class="input" name="title" required maxlength="60"
        placeholder="例如：UT 超声检测培训视频" />`) +
      field('所属大类', `<select class="input" name="category">${categoryOptions('video')}</select>`,
        '系列属于哪个大类，就只会在考生端那个 Tab 下出现') +
      field('适用方向', `<select class="input" name="method">${methodOptions('')}</select>`,
        '「通用」= 所有方向可见') +
      field('系列简介', `<textarea class="input" name="description" rows="2" maxlength="200"
        placeholder="选填，考生端系列卡副标题"></textarea>`);

    openModal({
      title: '新建系列',
      sub: '建好后可在「上传资料」时选择这个系列，把资料放进去',
      fieldsHtml: body,
      okText: '创建',
      onSubmit: async (values, close) => {
        const res = await api('/api/admin/materials/series', {
          method: 'POST',
          body: {
            title: values.title.trim(),
            category: values.category,
            method: values.method || '',
            description: values.description || '',
          },
        });
        toast(res.message || '系列已创建');
        close();
        await loadSeries();
      },
    });
  }

  function openEditSeriesModal(s) {
    const body =
      field('系列名称', `<input class="input" name="title" required maxlength="60" value="${esc(s.title)}" />`) +
      field('所属大类', `<select class="input" name="category">${categoryOptions(s.category)}</select>`) +
      field('适用方向', `<select class="input" name="method">${methodOptions(s.method)}</select>`) +
      field('系列简介', `<textarea class="input" name="description" rows="2" maxlength="200">${esc(s.description || '')}</textarea>`);

    openModal({
      title: `编辑系列：${s.title}`,
      sub: `当前系列内有 ${s.item_count || 0} 份资料`,
      fieldsHtml: body,
      okText: '保存修改',
      onSubmit: async (values, close) => {
        await api(`/api/admin/materials/series/${s.id}`, {
          method: 'PUT',
          body: {
            title: values.title.trim(),
            category: values.category,
            method: values.method || '',
            description: values.description || '',
          },
        });
        toast('系列已更新');
        close();
        await loadSeries();
      },
    });
  }

  function openSeriesCoverModal(s) {
    const now = s.has_cover ? '当前为自定义封面（见列表缩略图）' : '当前未设置封面';
    const body =
      field('选择图片', `<input class="input" type="file" id="series-cover" accept="image/jpeg,image/png,image/webp" />`,
        `${now}。jpg / png / webp，≤8MB；设置后考生端系列卡会用它当封面`) +
      `<div class="form-row"><label>清除封面</label>
        <label class="hint" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" name="clear_cover" value="1" /> 清除自定义封面，恢复默认图标
        </label></div>`;

    openModal({
      title: `系列封面：${s.title}`,
      sub: '选好后点保存即生效',
      fieldsHtml: body,
      okText: '保存',
      onSubmit: async (values, close) => {
        if (values.clear_cover) {
          await api(`/api/admin/materials/series/${s.id}/cover`, { method: 'DELETE' });
        } else {
          const input = $('series-cover');
          const f = input && input.files && input.files[0];
          if (!f) throw new Error('请选择图片，或勾选「清除封面」');
          const form = new FormData();
          form.append('cover', f);
          await multipartRequest(`/api/admin/materials/series/${s.id}/cover`, form, 'POST');
        }
        toast('系列封面已更新');
        close();
        await loadSeries();
      },
    });
  }

  async function removeSeries(s) {
    if (!confirm(`确认删除系列「${s.title}」？\n\n系列内的 ${s.item_count || 0} 份资料不会被删除，它们会退回「其他（未归系列）」。`)) return;
    try {
      const res = await api(`/api/admin/materials/series/${s.id}`, { method: 'DELETE' });
      toast(res.message || '系列已删除');
      await loadSeries();
      await loadMaterials();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  /**
   * 「补 PDF 切片」：把库里所有还没切片的 PDF 批量切一遍（可反复点，已切过的会跳过）。
   * 切片后考生端「教材/视频」打开 PDF 就是单页翻阅，首屏只下几十 KB。
   * 大库可能要跑一会儿，所以按钮期间禁用并提示，避免重复触发。
   */
  async function sliceExistingPdfs() {
    const btn = $('mats-slice');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '切片中…';
    try {
      const data = await api('/api/admin/materials/slice-existing', { method: 'POST' });
      const done = data.done || [];
      const failed = data.failed || [];
      let msg = data.message || '完成';
      if (done.length) {
        msg += '\n' + done.map((d) => `  · ${d.title}（${d.pages} 页）`).join('\n');
      }
      if (failed.length) {
        msg += '\n失败：' + failed.map((f) => `  · ${f.title}（${f.reason}）`).join('\n');
      }
      toast(msg);
    } catch (e) {
      toast(e.message || '切片失败');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /**
   * 「转 Office 预览」：把库里还没转换的 doc/ppt/pptx 排进后台转换队列
   * （转换成 PDF 后考生端就能像看 PDF 一样单页翻阅）。可反复点，已转好的会跳过。
   * 转换在服务器后台串行执行（40MB 的 ppt 约 1 分钟），本接口立刻返回。
   */
  async function convertExistingDocs() {
    const btn = $('mats-convert');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '排队中…';
    try {
      const data = await api('/api/admin/materials/convert-existing', { method: 'POST' });
      const queued = data.queued || [];
      let msg = data.message || '完成';
      if (queued.length) {
        msg += '\n' + queued.map((d) => `  · ${d.title}（${d.state === 'queued' ? '排队中' : d.state}）`).join('\n');
        msg += '\n转换在后台进行，稍后刷新资料列表即可；考生端打开会自动等待转换完成。';
      }
      toast(msg);
    } catch (e) {
      toast(e.message || '排队失败');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /** 当前资料列表缓存（上移 / 下移按这份可见顺序算） */
  let matCache = [];

  async function loadMaterials() {
    const tbody = $('mats-body');
    try {
      const category = $('mats-category').value;
      const method = $('mats-method').value;
      const series = $('mats-series').value;
      const q = $('mats-q').value.trim();
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (method) params.set('method', method);
      // 'loose' = 只看未归系列的散资料；数字 = 某个系列
      if (series === 'loose') params.set('loose', '1');
      else if (series) params.set('series_id', series);
      if (q) params.set('q', q);
      const data = await api('/api/admin/materials?' + params.toString());
      const items = data.items || [];
      matCache = items;
      tbody.innerHTML = items.map((m, i) => matRow(m, i, items.length)).join('');
      $('mats-empty').classList.toggle('hidden', items.length > 0);

      tbody.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = items.find((x) => x.id === Number(btn.dataset.id));
          if (!item) return;
          const act = btn.dataset.act;
          if (act === 'view') {
            // 视频类资料「查看」进视频详情弹窗（可看评论 / 删评论 / 管理员回复）；其余保持新标签页打开
            if (item.category === 'video') openVideoDetail(item);
            else window.open(`/api/admin/materials/${item.id}/file?token=${encodeURIComponent(getToken())}`, '_blank');
          }
          if (act === 'edit') openEditMaterialModal(item);
          if (act === 'comments') openCommentsModal(item);
          if (act === 'del') removeMaterial(item);
        });
      });
      bindMoveButtons(tbody, 'material');
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function matRow(m, idx, total) {
    const cat = MATERIAL_CATEGORIES.find((c) => c.v === m.category);
    const method = m.method || '通用';
    const seriesCell = m.series_id
      ? `<span class="badge badge-ok">${esc(m.series_name || ('#' + m.series_id))}</span>`
      : `<span class="hint">未归系列</span>`;
    const cover = m.has_cover
      ? `<img class="mat-cover" src="/api/admin/materials/${m.id}/cover?token=${encodeURIComponent(getToken())}" alt="封面" />`
      : `<span class="mat-cover mat-cover-none">首帧</span>`;
    return `<tr>
      <td class="mono">${idx + 1}</td>
      <td class="wrap"><strong>${esc(m.title)}</strong>${m.description ? `<div class="card-sub" style="margin:2px 0 0;">${esc(m.description)}</div>` : ''}</td>
      <td><span class="badge badge-ok">${esc(cat ? cat.t : m.category)}</span></td>
      <td>${esc(method)}</td>
      <td class="wrap" style="max-width:140px;">${seriesCell}</td>
      <td>${cover}</td>
      <td class="wrap" style="max-width:180px;">${esc(m.file_name)}</td>
      <td class="mono">${fmtSize(m.file_size)}</td>
      <td class="mono">${m.view_count || 0}</td>
      <td class="mono">${m.fav_count || 0}</td>
      <td class="mono">${m.comment_count || 0}</td>
      <td class="mono">${esc(m.created_at || '—')}</td>
      ${moveCell('material', m.id, idx, total)}
      <td class="actions">
        <button class="btn btn-sm btn-primary" data-act="view" data-id="${m.id}">查看</button>
        <button class="btn btn-sm" data-act="edit" data-id="${m.id}">编辑</button>
        <button class="btn btn-sm" data-act="comments" data-id="${m.id}">评论</button>
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${m.id}">删除</button>
      </td>
    </tr>`;
  }

  /** 上传走 multipart：单独的 fetch（api() 只支持 JSON body） */
  async function multipartRequest(url, form, method) {
    const res = await fetch(url, {
      method: method || 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      let msg = `请求失败（${res.status}）`;
      if (data && typeof data.detail === 'string') msg = data.detail;
      throw new Error(msg);
    }
    return data;
  }

  function uploadMaterialRequest(form) {
    return multipartRequest('/api/admin/materials', form, 'POST');
  }

  function categoryOptions(selected) {
    return MATERIAL_CATEGORIES
      .map((c) => `<option value="${c.v}" ${c.v === selected ? 'selected' : ''}>${c.t}</option>`)
      .join('');
  }

  function methodOptions(selected) {
    return MATERIAL_METHODS
      .map((m) => `<option value="${esc(m.v)}" ${m.v === (selected || '') ? 'selected' : ''}>${esc(m.t)}</option>`)
      .join('');
  }

  function coverFieldHtml(currentId, hint) {
    return field('封面图（选填）',
      `<input class="input" type="file" id="${currentId}" accept="image/jpeg,image/png,image/webp" />`,
      hint);
  }

  function openUploadModal() {
    const body =
      field('选择文件', `<input class="input" type="file" id="mats-file" required
        accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.mp4,.webm,.mov,.m4v,.mp3,.m4a" />`,
        '支持 PDF / Word / PPT / Excel / 文本 / 常见音视频，单个文件最大 1GB') +
      field('标题', `<input class="input" name="title" required maxlength="60"
        placeholder="例如：UT-超声波检测标准 GB/T xxx" />`) +
      field('分类', `<select class="input" name="category" id="mats-cat-select">${categoryOptions('textbook')}</select>`,
        '决定考生端 App 里的分组（标准规范 / 教材 / 辅导资料 / 视频课程）') +
      field('所属系列', `<select class="input" name="series_id" id="mats-series-select">${seriesSelectOptions('textbook', 0)}</select>`,
        '不选就显示在考生端的「其他资料 / 其他视频」里；系列列表可在上方「资料系列」里新建') +
      field('适用方向', `<select class="input" name="method">${methodOptions('')}</select>`,
        '「通用」= 所有方向可见') +
      field('描述', `<textarea class="input" name="description" rows="2" maxlength="200"
        placeholder="选填，考生端条目副标题"></textarea>`) +
      coverFieldHtml('mats-cover', '选填，jpg / png / webp，≤8MB。不上传的话，视频在考生端会自动取首帧当封面');

    openModal({
      title: '上传资料',
      sub: '保存后立即出现在考生端 App「教材 / 视频」页',
      fieldsHtml: body,
      okText: '开始上传',
      onMount: () => {
        // 切分类时刷新「所属系列」选项（系列是按大类分的，跨大类不能混选）
        const catSel = $('mats-cat-select');
        catSel.addEventListener('change', () => {
          $('mats-series-select').innerHTML = seriesSelectOptions(catSel.value, 0);
        });
      },
      onSubmit: async (values, close) => {
        const fileInput = $('mats-file');
        const f = fileInput && fileInput.files && fileInput.files[0];
        if (!f) throw new Error('请先选择文件');
        const form = new FormData();
        form.append('file', f);
        form.append('title', values.title.trim());
        form.append('category', values.category);
        form.append('method', values.method || '');
        form.append('description', values.description || '');
        form.append('series_id', values.series_id || '0');
        const coverInput = $('mats-cover');
        const cf = coverInput && coverInput.files && coverInput.files[0];
        if (cf) form.append('cover', cf);
        const res = await uploadMaterialRequest(form);
        toast(res.message || '已上传');
        close();
        await loadSeries();
        await loadMaterials();
      },
    });
  }

  function openEditMaterialModal(m) {
    const coverNow = m.has_cover
      ? `当前为自定义封面（见列表缩略图）`
      : '当前未设置封面，考生端自动取视频首帧';
    const body =
      field('标题', `<input class="input" name="title" required maxlength="60" value="${esc(m.title)}" />`) +
      field('分类', `<select class="input" name="category" id="mats-cat-select">${categoryOptions(m.category)}</select>`,
        '改分类 / 换文件都不会动原文件，只更新数据库里的信息') +
      field('所属系列', `<select class="input" name="series_id" id="mats-series-select">${seriesSelectOptions(m.category, m.series_id)}</select>`,
        '换到别的系列后，考生端分类页里它就会跟着动') +
      field('适用方向', `<select class="input" name="method">${methodOptions(m.method)}</select>`) +
      field('描述', `<textarea class="input" name="description" rows="2" maxlength="200">${esc(m.description)}</textarea>`) +
      coverFieldHtml('mats-cover', `${coverNow}。选择新图片并保存即替换（旧封面文件会被删除）`) +
      `<div class="form-row"><label>清除封面</label>
        <label class="hint" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" name="clear_cover" value="1" /> 清除自定义封面，恢复「自动取视频首帧」
        </label></div>` +
      `<div class="form-row"><label>文件</label><div class="hint">当前文件：${esc(m.file_name)}（${fmtSize(m.file_size)}），暂不支持替换，如需更换请删除后重新上传</div></div>`;

    openModal({
      title: `编辑资料：${m.title}`,
      sub: '保存后考生端下次打开即为新信息',
      fieldsHtml: body,
      okText: '保存修改',
      onMount: () => {
        const catSel = $('mats-cat-select');
        catSel.addEventListener('change', () => {
          $('mats-series-select').innerHTML = seriesSelectOptions(catSel.value, 0);
        });
      },
      onSubmit: async (values, close) => {
        // 封面先处理：勾了「清除」就删，否则选了新图就替换
        if (values.clear_cover) {
          await api(`/api/admin/materials/${m.id}/cover`, { method: 'DELETE' });
        } else {
          const coverInput = $('mats-cover');
          const cf = coverInput && coverInput.files && coverInput.files[0];
          if (cf) {
            const form = new FormData();
            form.append('cover', cf);
            await multipartRequest(`/api/admin/materials/${m.id}/cover`, form, 'POST');
          }
        }
        await api(`/api/admin/materials/${m.id}`, {
          method: 'PUT',
          body: {
            title: values.title.trim(),
            category: values.category,
            method: values.method || '',
            description: values.description || '',
            series_id: Number(values.series_id) || 0,
          },
        });
        toast('资料信息已更新');
        close();
        await loadSeries();
        await loadMaterials();
      },
    });
  }

  /** 评论管理：查看某资料下的考生评论，可删除违规内容 */
  async function openCommentsModal(m) {
    let data;
    try {
      data = await api(`/api/admin/material-comments?material_id=${m.id}`);
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
      return;
    }
    const comments = data.items || [];
    const replyCount = comments.filter((c) => c.parent_id).length;
    const list = comments.length
      ? comments.map((c) => `<div class="cmt-row" data-cmt-row="${c.id}">
          <div class="cmt-head">
            ${avatarHtml(c.avatar, '')}
            <strong>${esc(c.nickname)}</strong>
            ${c.parent_id ? `<span class="badge" style="background:var(--chip-bg);color:var(--text-2);">回复 @${esc(c.reply_to || '学员')}</span>` : ''}
            <span class="hint">${esc(c.created_at || '')}</span>
            <div class="spacer"></div>
            <button class="btn btn-sm btn-danger" data-cmt-del="${c.id}">删除</button>
          </div>
          <div class="cmt-body">${esc(c.content)}</div>
        </div>`).join('')
      : `<div class="hint">这条资料下还没有评论</div>`;

    openModal({
      title: `评论管理：${m.title}`,
      sub: `共 ${comments.length} 条（含 ${replyCount} 条回复；删顶层评论会连它的回复一起删，不可恢复）`,
      fieldsHtml: `<div class="cmt-list">${list}</div>`,
      okText: '关闭',
      onSubmit: async (_values, close) => { close(); },
    });

    $('modal-root').querySelectorAll('[data-cmt-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.cmtDel);
        const row = $('modal-root').querySelector(`[data-cmt-row="${id}"]`);
        const text = row ? row.querySelector('.cmt-body').textContent : '';
        if (!confirm(`确定删除这条评论？\n「${text.slice(0, 60)}」\n删除后不可恢复。`)) return;
        try {
          await api(`/api/admin/material-comments/${id}`, { method: 'DELETE' });
          toast('评论已删除');
          if (row) row.remove();
          await loadMaterials();
        } catch (err) {
          if (!handleAuthError(err)) toast(err.message);
        }
      });
    });
  }

  /** 单条评论 HTML（视频详情弹窗用）。楼中楼两层：回复一律挂根评论下展示 */
  function vcCommentHtml(c, repliesByRoot, isReply) {
    const replyBadge = c.parent_id
      ? `<span class="badge" style="background:var(--chip-bg);color:var(--text-2);">回复 @${esc(c.reply_to || '学员')}</span>`
      : '';
    const kids = repliesByRoot[c.id] || [];
    const isAdmin = !c.user_id;
    return `<div class="cmt-row" data-cmt-row="${c.id}" data-cmt-name="${esc(c.nickname)}">
      <div class="cmt-head">
        ${avatarHtml(c.avatar, '')}
        <strong>${esc(c.nickname)}${isAdmin ? ' <span class="badge badge-ok">管理员</span>' : ''}</strong>
        ${replyBadge}
        <span class="hint">${esc(c.created_at || '')}</span>
        <div class="spacer"></div>
        <button type="button" class="btn btn-sm" data-cmt-reply="${c.id}">回复</button>
        <button type="button" class="btn btn-sm btn-danger" data-cmt-del="${c.id}">删除</button>
      </div>
      <div class="cmt-body">${esc(c.content)}</div>
      ${kids.length ? `<div class="vc-replies">${kids.map((r) => vcCommentHtml(r, repliesByRoot, true)).join('')}</div>` : ''}
    </div>`;
  }

  /** 视频详情弹窗（管理员视角，对齐考生端「视频详情」页）：
   *  播放器 + 简介 + 评论楼中楼；可直接删除任意评论、以「管理员」身份回复。
   *  仅视频类资料的「查看」按钮进入；「评论」按钮的旧弹窗保持不变。 */
  async function openVideoDetail(m) {
    const fileUrl = `/api/admin/materials/${m.id}/file?token=${encodeURIComponent(getToken())}`;
    const cat = MATERIAL_CATEGORIES.find((c) => c.v === m.category);

    openModal({
      title: m.title,
      sub: `${cat ? cat.t : m.category}${m.method ? ' · ' + m.method : ''} · 播放 ${m.view_count || 0} · 收藏 ${m.fav_count || 0} · 评论 ${m.comment_count || 0}`,
      wide: true,
      fieldsHtml: `
        <video class="vc-video" controls playsinline preload="metadata" src="${fileUrl}"
          ${m.has_cover ? `poster="/api/admin/materials/${m.id}/cover?token=${encodeURIComponent(getToken())}"` : ''}></video>
        ${m.description ? `<p class="vc-desc">${esc(m.description)}</p>` : ''}
        <div class="vc-cmt-bar">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <strong style="font-size:13px;">评论 <span id="vc-cmt-count">0</span></strong>
            <span id="vc-reply-hint" class="badge" style="display:none;background:var(--chip-bg);color:var(--text-2);">
              回复 @<span id="vc-reply-name"></span>
              <button type="button" id="vc-reply-cancel" style="border:none;background:none;color:inherit;cursor:pointer;padding:0 0 0 4px;">✕</button>
            </span>
          </div>
          <textarea class="input" id="vc-reply-input" rows="2" maxlength="200"
            placeholder="以「管理员」身份回复 / 发表评论（最多 200 字）"></textarea>
          <div style="text-align:right;">
            <button type="button" class="btn btn-sm btn-primary" id="vc-reply-send">发布</button>
          </div>
        </div>
        <div class="cmt-list" id="vc-cmt-list" style="max-height:40vh;"></div>`,
      okText: '关闭',
      onSubmit: async (_values, close) => { close(); },
    });

    const root = $('modal-root');
    let replyTarget = null; // { id, name } = 正在回复谁；null = 发表顶层评论

    const setReplyTarget = (t) => {
      replyTarget = t;
      const hint = root.querySelector('#vc-reply-hint');
      if (t) {
        root.querySelector('#vc-reply-name').textContent = t.name;
        hint.style.display = '';
      } else {
        hint.style.display = 'none';
      }
    };

    const fetchComments = async () => {
      const data = await api(`/api/admin/material-comments?material_id=${m.id}`);
      return data.items || [];
    };

    const renderList = (items) => {
      // 接口按 id 倒序返回：根评论新的在前；回复反转成时间正序挂到各自根评论下
      const repliesByRoot = {};
      items.filter((c) => c.parent_id).forEach((c) => {
        (repliesByRoot[c.parent_id] = repliesByRoot[c.parent_id] || []).push(c);
      });
      Object.keys(repliesByRoot).forEach((k) => repliesByRoot[k].reverse());
      const roots = items.filter((c) => !c.parent_id);
      root.querySelector('#vc-cmt-list').innerHTML = roots.length
        ? roots.map((c) => vcCommentHtml(c, repliesByRoot, false)).join('')
        : `<div class="hint">还没有评论，考生端「视频详情」页里可以发表</div>`;
      root.querySelector('#vc-cmt-count').textContent = String(items.length);
      bindList();
    };

    const bindList = () => {
      root.querySelectorAll('[data-cmt-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = Number(btn.dataset.cmtDel);
          const row = root.querySelector(`[data-cmt-row="${id}"]`);
          const text = row ? row.querySelector('.cmt-body').textContent : '';
          if (!confirm(`确定删除这条评论？\n「${text.slice(0, 60)}」\n删除后不可恢复。`)) return;
          try {
            await api(`/api/admin/material-comments/${id}`, { method: 'DELETE' });
            toast('评论已删除');
            if (replyTarget && (replyTarget.id === id)) setReplyTarget(null);
            renderList(await fetchComments()); // 原地刷新（不打断视频播放）
            await loadMaterials();
          } catch (err) {
            if (!handleAuthError(err)) toast(err.message);
          }
        });
      });
      root.querySelectorAll('[data-cmt-reply]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = Number(btn.dataset.cmtReply);
          const row = root.querySelector(`[data-cmt-row="${id}"]`);
          setReplyTarget({ id, name: row ? (row.dataset.cmtName || '学员') : '学员' });
          root.querySelector('#vc-reply-input').focus();
        });
      });
    };

    root.querySelector('#vc-reply-cancel').addEventListener('click', () => setReplyTarget(null));
    root.querySelector('#vc-reply-send').addEventListener('click', async () => {
      const input = root.querySelector('#vc-reply-input');
      const content = input.value.trim();
      if (!content) { toast('请先输入内容'); return; }
      const sendBtn = root.querySelector('#vc-reply-send');
      sendBtn.disabled = true;
      sendBtn.textContent = '发布中…';
      try {
        await api('/api/admin/material-comments', {
          method: 'POST',
          body: { material_id: m.id, content, parent_id: replyTarget ? replyTarget.id : 0 },
        });
        toast(replyTarget ? '回复已发布' : '评论已发布');
        input.value = '';
        setReplyTarget(null);
        renderList(await fetchComments());
        await loadMaterials();
      } catch (err) {
        if (!handleAuthError(err)) toast(err.message);
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = '发布';
      }
    });

    try {
      renderList(await fetchComments());
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  async function removeMaterial(m) {
    if (!confirm(`确定删除「${m.title}」？\n服务器上的文件也会一并删除，考生端立即不可见，不可恢复！`)) return;
    try {
      const res = await api(`/api/admin/materials/${m.id}`, { method: 'DELETE' });
      toast(res.message || '已删除');
      await loadMaterials();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ============================================================
     模块七点五：音乐（上传音频 + 封面 + 歌手 + 歌词 → 考生端「音乐」页播放）
     - 音频与封面都存服务器 data/uploads/（music_* / cover_*），元数据存 music_tracks 表
     - 上传是 multipart（api() 只发 JSON），走 multipartRequest()
     - 时长在上传前用浏览器 <audio> 读出后一起提交（后端不依赖 ffprobe）
     - 歌词纯文本 / LRC 时间轴都行，后端原样存，考生端自行解析
     ============================================================ */

  let musicCache = [];
  /** 专辑缓存（上传 / 编辑歌曲弹窗的「所属专辑」下拉数据源） */
  let albumCache = [];

  function bindMusicModule() {
    $('music-refresh').addEventListener('click', loadMusic);
    $('music-search').addEventListener('click', loadMusic);
    $('music-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMusic(); });
    $('music-upload').addEventListener('click', openUploadMusicModal);
    // 专辑管理
    $('album-refresh').addEventListener('click', loadAlbums);
    $('album-create').addEventListener('click', openCreateAlbumModal);
    $('album-body').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const item = albumCache.find((x) => x.id === Number(btn.dataset.id));
      if (!item) return;
      const act = btn.dataset.act;
      if (act === 'edit') openEditAlbumModal(item);
      if (act === 'cover') openAlbumCoverModal(item);
      if (act === 'del') removeAlbum(item);
    });
  }

  /* ---------- 专辑管理（先建专辑 → 上传 / 编辑歌曲时选所属专辑） ---------- */

  async function loadAlbums() {
    const tbody = $('album-body');
    try {
      const data = await api('/api/admin/music/albums');
      albumCache = data.items || [];
      tbody.innerHTML = albumCache.map((a, i) => albumRow(a, i)).join('');
      $('album-empty').classList.toggle('hidden', albumCache.length > 0);
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function albumRow(a, idx) {
    const cover = a.has_cover
      ? `<img class="mat-cover" src="/api/admin/music/albums/${a.id}/cover?token=${encodeURIComponent(getToken())}&v=${encodeURIComponent(a.created_at || '')}" alt="封面" />`
      : `<span class="mat-cover mat-cover-none">无</span>`;
    return `<tr>
      <td class="mono">${idx + 1}</td>
      <td>${cover}</td>
      <td><strong>${esc(a.name)}</strong></td>
      <td>${esc(a.description) || '—'}</td>
      <td class="mono">${a.track_count || 0}</td>
      <td class="mono">${esc(a.created_at) || '—'}</td>
      <td class="actions">
        <button class="btn btn-sm" data-act="edit" data-id="${a.id}">编辑</button>
        <button class="btn btn-sm" data-act="cover" data-id="${a.id}">封面</button>
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${a.id}">删除</button>
      </td>
    </tr>`;
  }

  /** 「所属专辑」下拉选项：不归入专辑 + 所有专辑（值 0 = 不归入） */
  function albumSelectOptions(selectedId) {
    const opts = [{ v: '0', t: '不归入专辑' }];
    (albumCache || []).forEach((a) => opts.push({ v: String(a.id), t: a.name }));
    return selectHtml('album_id', opts, String(selectedId || 0));
  }

  function openCreateAlbumModal() {
    openModal({
      title: '新建专辑',
      sub: '创建后即可在上传 / 编辑歌曲时把歌曲归入本专辑',
      fieldsHtml:
        field('专辑名', `<input class="input" name="name" required maxlength="80" placeholder="例如：国风轻音乐合集" />`) +
        field('专辑简介', `<input class="input" name="description" maxlength="200" placeholder="选填，考生端专辑卡副标题" />`) +
        field('专辑封面（选填）',
          `<input class="input" type="file" id="album-cover" accept="image/jpeg,image/png,image/webp" />`,
          'jpg / png / webp，≤8MB；不上传则考生端用专辑内首曲封面兜底'),
      okText: '创建',
      onSubmit: async (values, close) => {
        const form = new FormData();
        form.append('name', (values.name || '').trim());
        form.append('description', (values.description || '').trim());
        const coverInput = $('album-cover');
        const coverFile = coverInput && coverInput.files && coverInput.files[0];
        if (coverFile) form.append('cover', coverFile);
        const res = await multipartRequest('/api/admin/music/albums', form, 'POST');
        close();
        toast(res.message || '已创建');
        await loadAlbums();
      },
    });
  }

  function openEditAlbumModal(a) {
    openModal({
      title: `编辑专辑《${a.name}》`,
      sub: '改名会同步更新该专辑下歌曲显示的专辑名',
      fieldsHtml:
        field('专辑名', `<input class="input" name="name" required maxlength="80" value="${esc(a.name)}" />`) +
        field('专辑简介', `<input class="input" name="description" maxlength="200" value="${esc(a.description)}" />`),
      okText: '保存',
      onSubmit: async (values, close) => {
        const res = await api(`/api/admin/music/albums/${a.id}`, {
          method: 'PUT',
          body: { name: (values.name || '').trim(), description: (values.description || '').trim() },
        });
        close();
        toast(res.message || '已保存');
        await Promise.all([loadAlbums(), loadMusic()]);
      },
    });
  }

  function openAlbumCoverModal(a) {
    openModal({
      title: `《${a.name}》专辑封面`,
      sub: '上传新封面会替换旧封面；清除后考生端回落专辑内首曲封面',
      fieldsHtml: field('专辑封面',
        `<input class="input" type="file" id="album-cover-only" accept="image/jpeg,image/png,image/webp" />`,
        'jpg / png / webp，≤8MB'),
      okText: '上传封面',
      onSubmit: async (_values, close) => {
        const input = $('album-cover-only');
        const f = input && input.files && input.files[0];
        if (!f) throw new Error('请先选择封面图片');
        const form = new FormData();
        form.append('cover', f);
        const res = await multipartRequest(`/api/admin/music/albums/${a.id}/cover`, form, 'POST');
        close();
        toast(res.message || '封面已更新');
        await loadAlbums();
      },
    });
  }

  async function removeAlbum(a) {
    if (!confirm(`确定删除专辑《${a.name}》？\n专辑内的 ${a.track_count || 0} 首歌不会被删除，会退回「未归专辑」并继续在考生端显示。`)) return;
    try {
      const res = await api(`/api/admin/music/albums/${a.id}`, { method: 'DELETE' });
      toast(res.message || '已删除');
      await Promise.all([loadAlbums(), loadMusic()]);
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  async function loadMusic() {
    const tbody = $('music-body');
    try {
      const data = await api('/api/admin/music');
      const kw = ($('music-q').value || '').trim().toLowerCase();
      const items = (data.items || []).filter((t) => !kw
        || (t.title || '').toLowerCase().includes(kw)
        || (t.artist || '').toLowerCase().includes(kw)
        || (t.album || '').toLowerCase().includes(kw));
      musicCache = items;
      tbody.innerHTML = items.map((t, i) => musicRow(t, i, items.length)).join('');
      $('music-empty').classList.toggle('hidden', items.length > 0);
      $('music-empty').textContent = kw ? '没有匹配的歌曲' : '还没有歌曲，点右上角「上传歌曲」';

      tbody.querySelectorAll('[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = musicCache.find((x) => x.id === Number(btn.dataset.id));
          if (!item) return;
          const act = btn.dataset.act;
          if (act === 'play') {
            window.open(`/api/admin/music/${item.id}/file?token=${encodeURIComponent(getToken())}`, '_blank');
          }
          if (act === 'edit') openEditMusicModal(item);
          if (act === 'cover') openMusicCoverModal(item);
          if (act === 'del') removeMusic(item);
        });
      });
      bindMoveButtons(tbody, 'music');
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function musicRow(t, idx, total) {
    const cover = t.has_cover
      ? `<img class="mat-cover" src="/api/admin/music/${t.id}/cover?token=${encodeURIComponent(getToken())}&v=${encodeURIComponent(t.created_at || '')}" alt="封面" />`
      : `<span class="mat-cover mat-cover-none">插画</span>`;
    const lyricCell = t.lyric_lines
      ? `<span class="badge badge-ok">${t.lyric_lines} 行</span>`
      : `<span class="hint">无歌词</span>`;
    const dur = t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}` : '—';
    return `<tr>
      <td class="mono">${idx + 1}</td>
      <td>${cover}</td>
      <td><strong>${esc(t.title)}</strong></td>
      <td>${esc(t.artist) || '—'}</td>
      <td>${esc(t.album) || '—'}</td>
      <td class="mono">${dur}</td>
      <td class="mono">${fmtSize(t.file_size)}</td>
      <td>${lyricCell}</td>
      <td class="mono">${t.play_count || 0}</td>
      <td class="mono">${esc(t.created_at) || '—'}</td>
      ${moveCell('music', t.id, idx, total)}
      <td class="actions">
        <button class="btn btn-sm" data-act="play" data-id="${t.id}">试听</button>
        <button class="btn btn-sm" data-act="edit" data-id="${t.id}">编辑</button>
        <button class="btn btn-sm" data-act="cover" data-id="${t.id}">封面</button>
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${t.id}">删除</button>
      </td>
    </tr>`;
  }

  async function moveMusic(id, dir) {
    const ids = withMoved(musicCache, id, dir, (x) => x.id);
    if (!ids) return;
    try {
      await api('/api/admin/music/order', { method: 'POST', body: { ids } });
      await loadMusic();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /** 上传前用浏览器读出音频时长（后端不依赖 ffprobe）；读不到返回 0，考生端按实际时长兜底 */
  function readAudioDuration(file) {
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
          const d = Math.round(audio.duration || 0);
          done(Number.isFinite(d) && d > 0 ? d : 0);
        };
        audio.onerror = () => done(0);
        window.setTimeout(() => done(0), 6000);
        audio.src = url;
      } catch (e) {
        resolve(0);
      }
    });
  }

  async function openUploadMusicModal() {
    await loadAlbums(); // 保证「所属专辑」下拉是最新的（刚建完专辑就能选到）
    const body =
      field('音频文件', `<input class="input" type="file" id="music-file" required
        accept=".mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.weba,audio/*" />`,
        '支持 mp3 / m4a / wav / flac / ogg 等浏览器可直接播放的格式，单个文件 ≤200MB') +
      field('歌名', `<input class="input" name="title" required maxlength="80" placeholder="例如：山水谣" />`) +
      field('歌手', `<input class="input" name="artist" maxlength="60" placeholder="例如：墨染 · 国风轻音乐" />`) +
      field('所属专辑', albumSelectOptions(0),
        '先在「专辑」里创建专辑，再在这里选择归属；选「不归入专辑」则不归属任何专辑') +
      field('歌词', `<textarea class="input" name="lyric" rows="8" id="music-lyric"
        placeholder="一行一句；带时间轴就写 [00:12.34] 这一句歌词（LRC 格式，考生端会逐行高亮）"></textarea>`,
        '纯文本或 LRC 时间轴都行，留空表示暂无歌词') +
      field('封面图（选填）',
        `<input class="input" type="file" id="music-cover" accept="image/jpeg,image/png,image/webp" />`,
        'jpg / png / webp，≤8MB；不上传则考生端使用内置山水插画封面');

    openModal({
      title: '上传歌曲',
      sub: '保存后考生端 App「音乐」页即可在线播放',
      fieldsHtml: body,
      okText: '开始上传',
      wide: true,
      onSubmit: async (values, close) => {
        const fileInput = $('music-file');
        const f = fileInput && fileInput.files && fileInput.files[0];
        if (!f) throw new Error('请先选择音频文件');
        const coverInput = $('music-cover');
        const coverFile = coverInput && coverInput.files && coverInput.files[0];
        const duration = await readAudioDuration(f);

        const form = new FormData();
        form.append('file', f);
        form.append('title', values.title.trim());
        form.append('artist', (values.artist || '').trim());
        form.append('album_id', String(Number(values.album_id || 0)));
        form.append('lyric', values.lyric || '');
        form.append('duration', String(duration));
        if (coverFile) form.append('cover', coverFile);

        const okBtn = $('modal-ok');
        okBtn.textContent = '上传中…';
        const res = await uploadMusicRequest(form);
        close();
        toast(res.message || '已上传');
        await loadMusic();
      },
    });
  }

  async function openEditMusicModal(t) {
    await loadAlbums(); // 保证「所属专辑」下拉是最新的
    const body =
      field('歌名', `<input class="input" name="title" required maxlength="80" value="${esc(t.title)}" />`) +
      field('歌手', `<input class="input" name="artist" maxlength="60" value="${esc(t.artist)}" />`) +
      field('所属专辑', albumSelectOptions(t.album_id),
        '改动归属后歌曲会移入新专辑；选「不归入专辑」则移出专辑') +
      field('时长（秒）', `<input class="input" name="duration" type="number" min="0" max="36000" value="${t.duration || 0}" />`,
        '一般不用改；考生端以音频实际时长为准') +
      field('歌词', `<textarea class="input" name="lyric" rows="12">${esc(t.lyric || '')}</textarea>`,
        '纯文本一行一句；带 [00:12.34] 时间轴则考生端逐行高亮');

    openModal({
      title: `编辑《${t.title}》`,
      sub: '只改歌曲信息，不会替换音频文件；要换音频请重新上传',
      fieldsHtml: body,
      okText: '保存',
      wide: true,
      onSubmit: async (values, close) => {
        const res = await api(`/api/admin/music/${t.id}`, {
          method: 'PUT',
          body: {
            title: values.title.trim(),
            artist: (values.artist || '').trim(),
            album_id: Number(values.album_id || 0),
            lyric: values.lyric || '',
            duration: Number(values.duration || 0),
          },
        });
        close();
        toast(res.message || '已保存');
        await loadMusic();
      },
    });
  }

  function openMusicCoverModal(t) {
    openModal({
      title: `《${t.title}》封面`,
      sub: '上传新封面会替换旧封面；清除后考生端回落内置插画',
      fieldsHtml: field('封面图',
        `<input class="input" type="file" id="music-cover-only" accept="image/jpeg,image/png,image/webp" />`,
        'jpg / png / webp，≤8MB'),
      okText: '上传封面',
      onSubmit: async (_values, close) => {
        const input = $('music-cover-only');
        const f = input && input.files && input.files[0];
        if (!f) throw new Error('请先选择封面图片');
        const form = new FormData();
        form.append('cover', f);
        const res = await multipartRequest(`/api/admin/music/${t.id}/cover`, form, 'POST');
        close();
        toast(res.message || '封面已更新');
        await loadMusic();
      },
    });
  }

  async function removeMusic(t) {
    if (!confirm(`确定删除《${t.title}》？\n服务器上的音频与封面文件会一并删除，考生端立即不可见，不可恢复！`)) return;
    try {
      const res = await api(`/api/admin/music/${t.id}`, { method: 'DELETE' });
      toast(res.message || '已删除');
      await loadMusic();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function uploadMusicRequest(form) {
    return multipartRequest('/api/admin/music', form, 'POST');
  }

  /* ============================================================
     模块八：版本发布（写 data/version.json → 在线考生立刻收到更新提示）
     - 发布接口同时写文件 + 经实时通道推给所有在线考生（服务端 modules/app_update.py）
     - 后端每 10 秒还盯一次 version.json，直接改文件 / git 拉代码同样算发布
     - 注意：版本号必须同时改前端 src/data/appVersion.ts 的 APP_VERSION，否则考生刷新后还是旧版
     ============================================================ */

  function bindVersionModule() {
    $('ver-publish').addEventListener('click', publishVersion);
    $('ver-refresh').addEventListener('click', loadVersion);
    // 更新方式二选一（普通 / 强制）—— 顶部 radio-chip 的通用交互
    document.querySelectorAll('#ver-force-row .radio-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#ver-force-row .radio-chip').forEach((c) => c.classList.remove('on'));
        chip.classList.add('on');
      });
    });
  }

  /** 当前选中的更新方式：true = 强制更新 */
  function versionForceSelected() {
    const on = document.querySelector('#ver-force-row .radio-chip.on');
    return !!on && on.dataset.force === '1';
  }

  /** 渲染「当前线上版本 / 更新方式 / 在线考生数」三张卡（进页面与点刷新时调） */
  async function loadVersion() {
    try {
      const data = await api('/api/admin/app/version');
      const v = data.version || {};
      const cards = [
        { k: '当前线上版本', v: v.latest_version || '—', m: `发布于 ${v.published_at || '—'}` },
        {
          k: '更新方式',
          v: v.force ? '强制更新' : '普通提示',
          m: v.force ? '考生必须更新后才能继续使用' : '考生可以稍后再更新',
        },
        {
          k: '在线考生',
          v: data.online_users || 0,
          m: data.realtime_enabled ? '实时通道已启用，发布即送达' : '实时通道已关闭，考生端走 30 秒轮询',
        },
      ];
      $('ver-current').innerHTML = cards
        .map(
          (c) => `<div class="stat"><div class="k">${esc(c.k)}</div>
            <div class="v">${esc(c.v)}</div><div class="m">${esc(c.m)}</div></div>`
        )
        .join('');

      // 更新说明框的占位提示改成「当前版本的说明」，发布时照着改一眼就知道上一版写了什么
      const notes = v.notes || [];
      $('ver-notes').placeholder = notes.length
        ? `当前版本（${v.latest_version}）的说明：\n${notes.join('\n')}`
        : '一行一条，例如：\n修复错题本偶发重复\n新增模拟考试倒计时提醒';
      // 下载地址回填当前值：网页版通常留空，打包版一般每版都是同一个下载页
      $('ver-url').value = v.download_url || '';
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  async function publishVersion() {
    const number = $('ver-number').value.trim();
    const notes = $('ver-notes').value.split('\n').map((s) => s.trim()).filter(Boolean);
    const url = $('ver-url').value.trim();
    const force = versionForceSelected();

    if (!/^\d+\.\d+\.\d+$/.test(number)) {
      toast('版本号格式不对，请填成「主.次.修订」，例如 1.1.0');
      return;
    }
    const way = force ? '强制更新（考生必须更新后使用）' : '普通提示（考生可稍后更新）';
    if (!confirm(`确认发布 ${number} ？\n\n更新方式：${way}\n\n在线考生会立刻收到更新提示。`)) return;

    const btn = $('ver-publish');
    const box = $('ver-result');
    btn.disabled = true;
    btn.textContent = '发布中…';
    try {
      const res = await api('/api/admin/app/version', {
        method: 'POST',
        body: { latest_version: number, notes, download_url: url, force },
      });
      box.textContent = res.message || '已发布';
      toast(res.message || '已发布');
      $('ver-number').value = '';
      $('ver-notes').value = '';
      await loadVersion();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '发布新版本';
    }
  }

  /* ============================================================
     模块七：纠错工单（考生上报题目答案疑似有误 → 采纳/忽略/删除）
     - 采纳 = 直接把题库里的正确答案改成考生建议的答案（后端校验合法性）
     - 「编辑题目」跳到题库编辑弹窗，可改题干/选项/答案（内置题库同样适用）
     ============================================================ */

  function bindReportModule() {
    $('rep-refresh').addEventListener('click', loadReports);
    $('rep-status').addEventListener('change', loadReports);
  }

  async function loadReports() {
    const tbody = $('rep-body');
    try {
      const status = $('rep-status').value;
      const data = await api(`/api/admin/question-reports?status=${encodeURIComponent(status)}`);
      const items = data.items || [];
      tbody.innerHTML = items.map(repRow).join('');
      $('rep-empty').classList.toggle('hidden', items.length > 0);

      reportsPending = status === 'pending' || status === ''
        ? items.length
        : (await api('/api/admin/question-reports?status=pending')).items.length;
      renderPending();

      tbody.querySelectorAll('[data-rep]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const item = items.find((x) => x.id === Number(btn.dataset.id));
          if (!item) return;
          const act = btn.dataset.rep;
          try {
            if (act === 'apply') {
              if (!confirm(`采纳考生建议，把正确答案改为「${item.suggested_answer}」？\n题目：${String(item.question.content).slice(0, 60)}…`)) return;
              const res = await api(`/api/admin/question-reports/${item.id}/handle`, { method: 'POST', body: { action: 'apply' } });
              toast(res.message || '已采纳');
              await loadReports();
            } else if (act === 'dismiss') {
              const res = await api(`/api/admin/question-reports/${item.id}/handle`, { method: 'POST', body: { action: 'dismiss' } });
              toast(res.message || '已忽略');
              await loadReports();
            } else if (act === 'edit') {
              // 用纠错工单里带的题目信息，打开对应题库的编辑弹窗
              const q = item.question;
              openEditQuestionModal(
                { id: q.set_id, name: `题目 #${q.id}（来自工单）` },
                { id: q.id, qtype: q.qtype, content: q.content, options: q.options, answer: q.answer },
              );
            } else if (act === 'del') {
              if (!confirm('删除这条工单记录？（不影响题目）')) return;
              await api(`/api/admin/question-reports/${item.id}`, { method: 'DELETE' });
              toast('工单记录已删除');
              await loadReports();
            }
          } catch (err) {
            if (!handleAuthError(err)) toast(err.message);
          }
        });
      });
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function repRow(r) {
    const q = r.question || {};
    const opts = (q.options || []).map((o) => `${o.key}、${o.text}`).join('；##');
    const statusBadge = r.status === 'pending'
      ? '<span class="badge badge-warn">待处理</span>'
      : r.status === 'resolved'
        ? '<span class="badge badge-ok">已处理</span>'
        : '<span class="badge badge-off">已忽略</span>';
    const actions = r.status === 'pending'
      ? `<button class="btn btn-sm btn-primary" data-rep="apply" data-id="${r.id}">采纳</button>
         <button class="btn btn-sm" data-rep="edit" data-id="${r.id}">编辑题目</button>
         <button class="btn btn-sm" data-rep="dismiss" data-id="${r.id}">忽略</button>
         <button class="btn btn-sm btn-danger" data-rep="del" data-id="${r.id}">删除</button>`
      : `<button class="btn btn-sm btn-danger" data-rep="del" data-id="${r.id}">删除</button>`;
    return `<tr>
      <td class="mono">${r.id}</td>
      <td class="wrap">
        <div style="white-space:normal;">${q.qtype_label ? `<span class="badge badge-off" style="margin-right:6px;">${esc(q.qtype_label)}</span>` : ''}${q.content ? richTextHtml(q.content, 'sm') : '（题目已删除）'}</div>
        <div class="card-sub">现答案：<strong>${esc(q.answer || '—')}</strong>${opts ? ` · 选项：${richTextPlain(opts.slice(0, 80))}${opts.length > 80 ? '…' : ''}` : ''}</div>
      </td>
      <td class="wrap"><strong>${esc(r.suggested_answer || '—')}</strong></td>
      <td class="wrap">
        <div style="white-space:normal;">${esc(r.reason)}</div>
        <div class="card-sub">${esc(r.user && r.user.nickname ? `${r.user.nickname}（${r.user.account}）` : (r.user && r.user.account) || '未知用户')}</div>
      </td>
      <td class="mono">${esc(r.created_at)}</td>
      <td>${statusBadge}${r.handled_by ? `<div class="card-sub">${esc(r.handled_by)}</div>` : ''}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }

  /* ============================================================
     题目富文本 —— 题干 / 选项 / 答案解析里的插图
     标记：[[img:qimg_xxxxxxxxxxxxxxxx.png]]（由「插入图片」按钮上传后自动写入）
     显示规则与考生端完全一致（src/components/RichText.tsx + src/data/richText.ts）：
       高度上限 180px（列表里 rt-img-sm = 100px）、宽度不超容器、等比缩放、点击看大图
     接口与存盘见 server/modules/question_images.py
     修改注意：标记语法两边必须同步，改这里就要改 RichText.tsx
     ============================================================ */

  const RT_IMG_RE = /\[\[img:([A-Za-z0-9_.-]{1,80})\]\]/g;

  /** 后台取图地址：令牌走 ?token=（<img src> 带不了请求头），与封面图同一口径 */
  function rtImgUrl(name) {
    return `/api/admin/question-images/${encodeURIComponent(name)}?token=${encodeURIComponent(getToken())}`;
  }

  /** 题目文本 → HTML：先转义，再把图片标记换成 <img>。size='sm' 用于列表/表格里省地方 */
  function richTextHtml(text, size) {
    const raw = String(text ?? '');
    if (size === 'sm') {
      // 列表/表格摘要：保持原来的行内小图，不套固定区（行高要紧凑）
      return esc(raw).replace(RT_IMG_RE, (_m, name) =>
        `<img class="rt-img rt-img-sm" src="${rtImgUrl(name)}" data-zoom="${esc(name)}" alt="题目插图" title="点击查看大图" />`);
    }
    // 题干/选项/答案解析：一段文字里的所有图片收进同一个固定高度的滚动区，
    // 每张图固定占位等比缩放，右侧滚动条常驻（与考生端 RichText.tsx 的 .rt-img-area 同口径）
    const areaCls = size === 'lg' ? 'rt-img-area rt-img-area-lg' : 'rt-img-area';
    RT_IMG_RE.lastIndex = 0;
    let out = '', imgs = [], last = 0, m;
    const flush = () => {
      if (!imgs.length) return;
      out += `<div class="${areaCls}">${imgs.join('')}</div>`;
      imgs = [];
    };
    while ((m = RT_IMG_RE.exec(raw)) !== null) {
      const between = raw.slice(last, m.index);
      if (imgs.length && between.trim() === '') {
        // 图片之间的纯空白并进图区，不在区外残留空行
      } else {
        flush();
        if (between) out += esc(between);
      }
      imgs.push(`<img class="rt-img" src="${rtImgUrl(m[1])}" data-zoom="${esc(m[1])}" alt="题目插图" title="点击查看大图" />`);
      last = m.index + m[0].length;
    }
    flush();
    out += esc(raw.slice(last));
    RT_IMG_RE.lastIndex = 0;
    return out;
  }

  /** 摘要文本（放不下图的一行两行场景）：标记换成「［图片］」 */
  function richTextPlain(text) {
    return esc(text).replace(RT_IMG_RE, '［图片］');
  }

  /**
   * 题目列表专用：按关键词搜索时把命中的字标黄（keyword 为空就退回普通渲染）。
   * 先按图片标记切段再高亮 —— 否则关键词里的字符会误伤 [[img:xxx]] 标记本身。
   */
  function richTextSearchHtml(text, size, keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return richTextHtml(text, size);

    let hitRe = null;
    try {
      hitRe = new RegExp(esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    } catch (e) {
      return richTextHtml(text, size);   // 关键词含怪字符，退化成不高亮
    }

    const cls = size === 'sm' ? 'rt-img rt-img-sm' : 'rt-img';
    const raw = String(text === null || text === undefined ? '' : text);
    const mark = (t) => esc(t).replace(hitRe, (m) => `<mark class="rt-hit">${m}</mark>`);

    let out = '';
    let last = 0;
    RT_IMG_RE.lastIndex = 0;
    let m;
    while ((m = RT_IMG_RE.exec(raw)) !== null) {
      out += mark(raw.slice(last, m.index));
      out += `<img class="${cls}" src="${rtImgUrl(m[1])}" data-zoom="${esc(m[1])}" alt="题目插图" title="点击查看大图" />`;
      last = m.index + m[0].length;
    }
    out += mark(raw.slice(last));
    RT_IMG_RE.lastIndex = 0;
    return out;
  }

  /** 大图浮层：点任意处关闭 */
  function openImageZoom(name) {
    const mask = document.createElement('div');
    mask.className = 'rt-zoom-mask';
    mask.innerHTML = `<img src="${rtImgUrl(name)}" alt="题目插图" /><p>点图片外任意处关闭</p>`;
    mask.addEventListener('click', () => mask.remove());
    document.body.appendChild(mask);
  }

  /** 点插图看大图 + 图片丢了回落占位：document 级委托，重渲染后不用重新绑定 */
  function bindRichImages() {
    document.addEventListener('click', (e) => {
      const img = e.target && e.target.closest ? e.target.closest('img.rt-img') : null;
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      const name = img.dataset.zoom;
      if (name) openImageZoom(name);
    });
    // 捕获阶段接图片加载失败（img 的 error 事件不冒泡，必须 capture）
    document.addEventListener('error', (e) => {
      const el = e.target;
      if (!el || el.tagName !== 'IMG' || !el.classList.contains('rt-img')) return;
      const span = document.createElement('span');
      span.className = 'rt-img-dead';
      span.textContent = '图片已丢失';
      el.replaceWith(span);
    }, true);
  }

  /** 上传一张题目插图 → 返回标记文本（失败抛错，调用方弹提示） */
  async function uploadQuestionImage(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await multipartRequest('/api/admin/question-images', form, 'POST');
    return res.markup;
  }

  /**
   * 解析选项文本框 → [{ key, text, start, end }]
   * 与后端 bank._parse_options 同口径（按「##」切段，段内第一个「、/﹑」前是选项字母）。
   * 多出来的 start / end = 这一段在原文里的位置，用来把插图精确插到某个选项末尾。
   */
  function parseOptions(raw) {
    const text = String(raw === null || raw === undefined ? '' : raw);
    const out = [];
    let i = 0;
    while (i <= text.length) {
      let j = text.indexOf('##', i);
      if (j === -1) j = text.length;
      const seg = text.slice(i, j);
      const lead = seg.length - seg.replace(/^\s+/, '').length;
      const body = seg.trim().replace(/[；;]\s*$/, '');
      let k = -1;
      ['、', '﹑'].forEach((sep) => {   // 顿号也可能是全角小逗号「﹑」
        const p = body.indexOf(sep);
        if (p !== -1 && (k === -1 || p < k)) k = p;
      });
      const key = k === -1 ? '' : body.slice(0, k).trim().toUpperCase();
      if (/^[A-Z]$/.test(key)) {
        const start = i + lead;
        out.push({ key, text: body.slice(k + 1).trim(), start, end: start + body.length });
      }
      if (j >= text.length) break;
      i = j + 2;
    }
    return out;
  }

  /** 选项里还没用过的第一个字母（A→Z），用完返回空串 */
  function nextOptionKey(keys) {
    for (let i = 0; i < 26; i += 1) {
      const k = String.fromCharCode(65 + i);
      if (keys.indexOf(k) === -1) return k;
    }
    return '';
  }

  /** CSV 里给图片留的占位符（[图片] / 【图片】 / (图) 这类）：有就替换它 */
  const RT_PLACEHOLDER_RE = /[\[【（(]\s*图\s*片?\s*[\]】）)]/;

  /**
   * 把图片标记插到「指定选项」后面 —— 用户点 A / B / C … 走的就是这里。
   * 该选项还不存在 → 追加成一个新选项，顺便把分隔符统一成「；##」。
   * 返回 { value, replaced, appended }，纯函数，方便单测。
   */
  function insertImageIntoOption(raw, key, markup) {
    const text = String(raw === null || raw === undefined ? '' : raw);
    const hit = parseOptions(text).filter((o) => o.key === key)[0];
    if (hit) {
      const seg = text.slice(hit.start, hit.end);
      const ph = seg.match(RT_PLACEHOLDER_RE);
      if (ph) {
        const at = hit.start + ph.index;
        return { value: text.slice(0, at) + markup + text.slice(at + ph[0].length), replaced: true, appended: false };
      }
      return { value: text.slice(0, hit.end) + markup + text.slice(hit.end), replaced: false, appended: false };
    }
    const parts = text.split('##')
      .map((s) => s.trim().replace(/[；;]\s*$/, ''))
      .filter(Boolean);
    parts.push(`${key}、${markup}`);
    return { value: parts.join('；##'), replaced: false, appended: true };
  }

  /**
   * 给「添加 / 编辑题目」弹窗装上插图按钮与实时预览。
   * scope = 弹窗根节点；targets = [{name: 表单字段名, label: 展示名, options?}]
   *   - 普通字段（题干 / 解析）：光标停在哪就插在哪（该字段里有 [图片] 占位则替换占位）
   *   - options:true 的字段（选项）：先用按钮选 A / B / C …，图插到那个选项后面
   */
  function bindRichEditor(scope, targets) {
    const preview = scope.querySelector('.rt-preview');
    const qtypeEl = scope.querySelector('[name="qtype"]');
    const qtypeLabel = (v) => (QS_QTYPES.filter((q) => q.v === v)[0] || {}).t || '该题型';

    /* 实时预览：选项按「一个选项一行」渲染，其他字段整段渲染 */
    const renderPreview = () => {
      if (!preview) return;
      const parts = [];
      targets.forEach((t) => {
        const el = scope.querySelector(`[name="${t.name}"]`);
        const raw = el ? String(el.value || '') : '';
        if (!raw.trim()) return;
        if (t.options) {
          const opts = parseOptions(raw);
          if (!opts.length) return;
          parts.push(`<div><strong>${esc(t.label)}</strong></div>` +
            opts.map((o) => `<div class="rt-opt-line"><span class="rt-opt-key">${esc(o.key)}、</span>` +
              `<div class="rt-opt-text">${o.text ? richTextHtml(o.text) : '<span class="hint">（空）</span>'}</div></div>`).join(''));
        } else {
          parts.push(`<div><strong>${esc(t.label)}</strong></div>${richTextHtml(raw)}`);
        }
      });
      preview.innerHTML = parts.join('') || '';
    };

    /**
     * 选项按钮组：A / B / C … 点哪个就把图插到哪个选项后面（末尾多一个「＋ 字母」新建选项）。
     * 按当前选项内容重建；内容没变就不重建，免得打字时按钮闪。
     */
    const optSig = {};
    const renderOptPicker = (t) => {
      const wrap = scope.querySelector(`[data-opt-picker="${t.name}"]`);
      const area = scope.querySelector(`[name="${t.name}"]`);
      if (!wrap || !area) return;

      const qtype = qtypeEl ? qtypeEl.value : 'single';
      const noOption = qtype === 'judge' || qtype === 'short';
      const keys = parseOptions(area.value).map((o) => o.key);
      const sig = (noOption ? 'x' : 'o') + '|' + keys.join(',');
      if (optSig[t.name] === sig) return;
      optSig[t.name] = sig;

      if (noOption) {
        wrap.innerHTML = `<span class="hint">「${esc(qtypeLabel(qtype))}」的选项由系统自动生成，图片请用左边的「题干插图」</span>`;
        return;
      }
      const showKeys = keys.length ? keys : ['A', 'B', 'C', 'D'];   // 还没写选项时先给 A~D 打底
      const addKey = nextOptionKey(keys);
      wrap.innerHTML =
        `<span class="hint">选项插图：</span>` +
        showKeys.map((k) => `<button type="button" class="btn btn-sm rt-opt" data-opt-key="${esc(k)}" title="把图片插到选项 ${esc(k)} 后面">${esc(k)}</button>`).join('') +
        (addKey
          ? `<button type="button" class="btn btn-sm rt-opt rt-opt-new" data-opt-key="${addKey}" data-opt-new="1" title="新建选项 ${addKey} 并放图">＋ ${addKey}</button>`
          : '');
    };

    // 一个弹窗共用一个隐藏的文件选择框：点哪个按钮就记下目标（文本框 + 光标 / 选项字母）
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';
    picker.style.display = 'none';
    scope.appendChild(picker);

    let active = null;   // { area, btn, wrap?, start?, end?, optKey? }

    targets.forEach((t) => {
      const area = scope.querySelector(`[name="${t.name}"]`);
      if (!area) return;
      area.addEventListener('input', () => {
        renderPreview();
        if (t.options) renderOptPicker(t);
      });

      if (t.options) {
        // 选项按钮是动态重建的，监听绑在容器上（容器随弹窗重建，不会累积监听）
        const wrap = scope.querySelector(`[data-opt-picker="${t.name}"]`);
        if (wrap) {
          wrap.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('.rt-opt') : null;
            if (!btn) return;
            active = { area, btn, wrap, optKey: btn.dataset.optKey };
            picker.value = '';
            picker.click();
          });
        }
        return;
      }

      const btn = scope.querySelector(`[data-insert-img="${t.name}"]`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        active = { area, btn, start: area.selectionStart, end: area.selectionEnd };
        picker.value = '';
        picker.click();
      });
    });

    // 换题型时选项按钮跟着变（判断题 / 简答题没有可插图的选项）
    if (qtypeEl) {
      qtypeEl.addEventListener('change', () => targets.filter((t) => t.options).forEach(renderOptPicker));
    }

    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      if (!file || !active) return;
      const { area, btn, wrap } = active;
      const original = btn ? btn.textContent : '';
      const siblings = wrap ? Array.prototype.slice.call(wrap.querySelectorAll('.rt-opt')) : [];
      siblings.forEach((b) => { b.disabled = true; });
      if (btn) btn.textContent = '上传中…';

      try {
        const markup = await uploadQuestionImage(file);
        if (active.optKey) {
          const res = insertImageIntoOption(area.value, active.optKey, markup);
          area.value = res.value;
          toast(res.appended
            ? `已新建选项 ${active.optKey} 并插入图片（保存题目后生效）`
            : res.replaced
              ? `已替换选项 ${active.optKey} 里的 [图片] 占位（保存题目后生效）`
              : `图片已插到选项 ${active.optKey} 后面（保存题目后生效）`);
        } else {
          const value = area.value || '';
          const ph = value.match(RT_PLACEHOLDER_RE);
          let start, end, replaced;
          if (ph) {
            start = ph.index;
            end = ph.index + ph[0].length;
            replaced = true;
          } else {
            start = Math.min(active.start, value.length);
            end = Math.min(active.end, value.length);
            replaced = false;
          }
          area.value = value.slice(0, start) + markup + value.slice(end);
          toast(replaced ? '已替换 [图片] 占位（保存题目后生效）' : '图片已插入（保存题目后生效）');
        }
        renderPreview();
        if (active.optKey) targets.filter((t) => t.options).forEach(renderOptPicker);
      } catch (err) {
        if (!handleAuthError(err)) toast(err.message);
      } finally {
        // 按钮可能已被重建（插入后选项字母变了），只改还挂在页面上的那些
        if (btn && btn.isConnected) btn.textContent = original;
        siblings.forEach((b) => { if (b.isConnected) b.disabled = false; });
      }
    });

    targets.filter((t) => t.options).forEach(renderOptPicker);
    renderPreview();
  }

  /* ============================================================
     模块八：主题商店（上传「背景图 + 配色」皮肤 → 考生端「我的 → 主题商店」自选应用）
     - 预览图 / 背景图存服务器 data/uploads/（theme_preview_* / theme_bg_*）
     - 新建一次性 multipart（含两张图）；改配色走 JSON PUT，换图走单独的 POST 接口
     - 换 / 清图都必须让后端把老文件删掉（前端只提交，删除在后端做）
     ============================================================ */

  let themeCache = [];

  function bindThemeModule() {
    $('theme-refresh').addEventListener('click', loadThemes);
    $('theme-create').addEventListener('click', openCreateThemeModal);
    $('theme-body').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const item = themeCache.find((x) => x.id === Number(btn.dataset.id));
      if (!item) return;
      const act = btn.dataset.act;
      if (act === 'edit') openEditThemeModal(item);
      if (act === 'preview') openThemeImageModal(item, 'preview');
      if (act === 'bg') openThemeImageModal(item, 'background');
      if (act === 'del') removeTheme(item);
    });
  }

  async function loadThemes() {
    const tbody = $('theme-body');
    try {
      const data = await api('/api/admin/themes');
      themeCache = data.items || [];
      tbody.innerHTML = themeCache.map((t, i) => themeRow(t, i, themeCache.length)).join('');
      $('theme-empty').classList.toggle('hidden', themeCache.length > 0);
      bindMoveButtons(tbody, 'theme');
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  async function moveTheme(id, dir) {
    const ids = withMoved(themeCache, id, dir, (x) => x.id);
    if (!ids) return;
    try {
      await api('/api/admin/themes/order', { method: 'POST', body: { ids } });
      await loadThemes();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /** 主色 / 辅色的「色块 + 色值」单元格 */
  function colorCell(color) {
    if (!color) return '<span class="hint">—</span>';
    return `<span style="display:inline-flex;align-items:center;gap:6px">
      <span style="display:inline-block;width:14px;height:14px;border-radius:50%;border:1px solid rgba(0,0,0,.16);background:${esc(color)}"></span>
      <span class="mono">${esc(color)}</span>
    </span>`;
  }

  function themeRow(t, idx, total) {
    const preview = t.has_preview
      ? `<img class="mat-cover" src="/api/admin/themes/${t.id}/preview?token=${encodeURIComponent(getToken())}&v=${encodeURIComponent(t.created_at || '')}" alt="预览" />`
      : `<span class="mat-cover mat-cover-none">渐变</span>`;
    const tone = t.text_tone === 'light'
      ? '<span class="badge badge-warn">浅色字</span>'
      : '<span class="badge badge-off">深色字</span>';
    const bg = t.has_background
      ? '<span class="badge badge-ok">已上传</span>'
      : '<span class="hint">无</span>';
    return `<tr>
      <td class="mono">${idx + 1}</td>
      <td>${preview}</td>
      <td><strong>${esc(t.name)}</strong></td>
      <td>${colorCell(t.primary_color)}</td>
      <td>${colorCell(t.secondary_color)}</td>
      <td>${tone}</td>
      <td>${bg}</td>
      <td class="mono">${esc(t.created_at) || '—'}</td>
      ${moveCell('theme', t.id, idx, total)}
      <td class="actions">
        <button class="btn btn-sm" data-act="edit" data-id="${t.id}">编辑</button>
        <button class="btn btn-sm" data-act="preview" data-id="${t.id}">预览图</button>
        <button class="btn btn-sm" data-act="bg" data-id="${t.id}">背景图</button>
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${t.id}">删除</button>
      </td>
    </tr>`;
  }

  /** 颜色选择器（type=color 只认小写 #rrggbb，统一转小写再塞进 value） */
  function colorField(label, name, value, hint) {
    const v = (value || '#5f8d8c').toLowerCase();
    return field(label,
      `<input class="input" type="color" name="${name}" value="${esc(v)}" style="height:42px;padding:4px;max-width:150px" />`,
      hint);
  }

  function toneOptionsHtml(selected) {
    return selectHtml('text_tone', [
      { v: 'dark', t: '深色字（背景偏浅）' },
      { v: 'light', t: '浅色字（背景偏深）' },
    ], selected || 'dark');
  }

  function openCreateThemeModal() {
    openModal({
      title: '上传主题',
      sub: '背景图 + 配色 = 一套皮肤；考生在 App「我的 → 主题商店」自选应用',
      fieldsHtml:
        field('主题名称', `<input class="input" name="name" required maxlength="40" placeholder="例如：青竹 / 暖阳 / 深海" />`) +
        colorField('主色', 'primary_color', '#5f8d8c', '按钮 / 强调色 / 进度条的主色') +
        colorField('辅色', 'secondary_color', '#c9a063', '渐变的第二个颜色（登录按钮的渐变终点）') +
        field('字色', toneOptionsHtml('dark'), '决定文字用深色还是浅色；跟着背景图的明暗选，选反了会看不清') +
        field('背景图（选填）',
          `<input class="input" type="file" id="theme-bg" accept="image/jpeg,image/png,image/webp" />`,
          'jpg / png / webp，≤15MB；按 cover 铺满（裁剪不拉伸）；不上传则用主色 / 辅色的柔和渐变') +
        field('预览图（选填）',
          `<input class="input" type="file" id="theme-preview" accept="image/jpeg,image/png,image/webp" />`,
          'jpg / png / webp，≤8MB；只用于后台与考生端的列表缩略图'),
      okText: '上传主题',
      onSubmit: async (values, close) => {
        const form = new FormData();
        form.append('name', (values.name || '').trim());
        form.append('primary_color', (values.primary_color || '').trim());
        form.append('secondary_color', (values.secondary_color || '').trim());
        form.append('text_tone', values.text_tone || 'dark');
        const bgInput = $('theme-bg');
        const bgFile = bgInput && bgInput.files && bgInput.files[0];
        if (bgFile) form.append('background', bgFile);
        const pvInput = $('theme-preview');
        const pvFile = pvInput && pvInput.files && pvInput.files[0];
        if (pvFile) form.append('preview', pvFile);
        const res = await multipartRequest('/api/admin/themes', form, 'POST');
        close();
        toast(res.message || '已创建');
        await loadThemes();
      },
    });
  }

  function openEditThemeModal(t) {
    openModal({
      title: `编辑主题《${t.name}》`,
      sub: '换预览图 / 背景图请用列表里的对应按钮；这里只改名称与配色',
      fieldsHtml:
        field('主题名称', `<input class="input" name="name" required maxlength="40" value="${esc(t.name)}" />`) +
        colorField('主色', 'primary_color', t.primary_color || '#5f8d8c', '按钮 / 强调色 / 进度条的主色') +
        colorField('辅色', 'secondary_color', t.secondary_color || t.primary_color || '#c9a063', '渐变的第二个颜色') +
        field('字色', toneOptionsHtml(t.text_tone), '决定文字用深色还是浅色；跟着背景图的明暗选'),
      okText: '保存',
      onSubmit: async (values, close) => {
        const res = await api(`/api/admin/themes/${t.id}`, {
          method: 'PUT',
          body: {
            name: (values.name || '').trim(),
            primary_color: (values.primary_color || '').trim(),
            secondary_color: (values.secondary_color || '').trim(),
            text_tone: values.text_tone || 'dark',
          },
        });
        close();
        toast(res.message || '已保存');
        await loadThemes();
      },
    });
  }

  /** 换 / 清某张图（kind = 'preview' | 'background'） */
  function openThemeImageModal(t, kind) {
    const isBg = kind === 'background';
    const label = isBg ? '背景图' : '预览图';
    openModal({
      title: `《${t.name}》${label}`,
      sub: `上传新${label}会替换旧图；也可以勾选「清除」删掉当前${label}`,
      fieldsHtml:
        field(`${label}（jpg / png / webp）`,
          `<input class="input" type="file" id="theme-img" accept="image/jpeg,image/png,image/webp" />`,
          isBg ? '≤15MB；按 cover 铺满，不拉伸变形' : '≤8MB；仅用于列表缩略图') +
        field(`或清除当前${label}`,
          `<label class="hint" style="display:flex;align-items:center;gap:8px;cursor:pointer">
             <input type="checkbox" name="clear" />
             删除当前${label}，改用${isBg ? '配色渐变背景' : '主色 / 辅色渐变兜底'}
           </label>`),
      okText: '保存',
      onSubmit: async (values, close) => {
        const input = $('theme-img');
        const f = input && input.files && input.files[0];
        if (values.clear) {
          if (f) throw new Error(`已选择新的${label}，请先取消勾选「清除」`);
          const res = await api(`/api/admin/themes/${t.id}/${kind}`, { method: 'DELETE' });
          close();
          toast(res.message || '已清除');
          await loadThemes();
          return;
        }
        if (!f) throw new Error(`请先选择${label}图片，或勾选「清除」删除当前${label}`);
        const form = new FormData();
        form.append(kind, f);
        const res = await multipartRequest(`/api/admin/themes/${t.id}/${kind}`, form, 'POST');
        close();
        toast(res.message || '已更新');
        await loadThemes();
      },
    });
  }

  async function removeTheme(t) {
    if (!confirm(`确定删除主题《${t.name}》？\n预览图与背景图会一并删除；已应用该主题的考生会自动恢复默认外观。`)) return;
    try {
      const res = await api(`/api/admin/themes/${t.id}`, { method: 'DELETE' });
      toast(res.message || '已删除');
      await loadThemes();
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  /* ============================================================
     通用：弹窗与表单片段
     ============================================================ */

  function field(label, innerHtml, hint) {
    return `<div class="form-row">
      <label>${esc(label)}</label>
      ${innerHtml}
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
    </div>`;
  }

  function selectHtml(name, options, value) {
    const opts = options
      .map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(value) ? 'selected' : ''}>${esc(o.t)}</option>`)
      .join('');
    return `<select class="input" name="${esc(name)}">${opts}</select>`;
  }

  /* ---------- 文件导入：真实类型嗅探 + 多编码解码（与 server/modules/tabular.py 同口径） ---------- */

  /** zip 容器头（PK\x03\x04）→ 是 .xlsx 而不是真的 CSV */
  function isZipBytes(bytes) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  /** 字节 → base64（分块拼接，避免大文件把调用栈撑爆） */
  function bytesToBase64(bytes) {
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  /** 字节 → 文本，顺带给出编码名。顺序：BOM → UTF-8(严格) → GB18030 → Big5 → 兜底。
   *  只做预览用；导入时后端会用同一套规则重新解一遍（那份才是权威）。 */
  function decodeTabularText(bytes) {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), enc: 'UTF-8（带 BOM）' };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), enc: 'UTF-16 LE' };
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), enc: 'UTF-16 BE' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), enc: 'UTF-8' };
    } catch (e) { /* 不是合法 UTF-8，继续往下试 */ }
    for (const [label, name] of [['GBK / GB18030', 'gb18030'], ['Big5', 'big5']]) {
      try {
        return { text: new TextDecoder(name).decode(bytes), enc: label };
      } catch (e) { /* 该编码不可用或解不了 */ }
    }
    return { text: new TextDecoder('utf-8').decode(bytes), enc: '未知（按 UTF-8 兜底）' };
  }

  function openModal({ title, sub, fieldsHtml, okText, onSubmit, wide, onMount, hideCancel }) {
    const root = $('modal-root');
    root.innerHTML = `
      <div class="modal-mask">
        <div class="modal${wide ? ' modal-wide' : ''}">
          <h3>${esc(title)}</h3>
          <p class="modal-sub">${esc(sub || '')}</p>
          <div id="modal-err" class="alert alert-err hidden"></div>
          <form id="modal-form" autocomplete="off">
            ${fieldsHtml}
            <div class="modal-actions">
              ${hideCancel ? '' : '<button type="button" class="btn" id="modal-cancel">取消</button>'}
              <button type="submit" class="btn btn-primary" id="modal-ok">${esc(okText || '保存')}</button>
            </div>
          </form>
        </div>
      </div>`;

    const close = () => { root.innerHTML = ''; };
    const cancelBtn = $('modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    root.querySelector('.modal-mask').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('modal-mask')) close();
    });
    // 弹窗内容渲染完成后的回调（用于给弹窗里的级联下拉绑定事件）
    if (typeof onMount === 'function') onMount();

    $('modal-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errBox = $('modal-err');
      const okBtn = $('modal-ok');
      errBox.classList.add('hidden');
      okBtn.disabled = true;
      okBtn.textContent = '处理中…';
      try {
        const values = Object.fromEntries(new FormData(event.target).entries());
        await onSubmit(values, close);
      } catch (err) {
        if (handleAuthError(err)) return;
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
        okBtn.disabled = false;
        okBtn.textContent = okText || '保存';
      }
    });
  }

  /** 只读提示弹窗（导入结果小结这类，只有「知道了」） */
  function openNoticeModal({ title, sub, html }) {
    openModal({
      title,
      sub,
      fieldsHtml: html,
      okText: '知道了',
      hideCancel: true,
      onSubmit: async (_values, close) => close(),
    });
  }
})();
