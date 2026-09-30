/* ============================================================
   管理后台 · 主界面逻辑
   五个模块各自独立：管理员账号 / 注册申请 / 考生账号 / 密码重置工单 / 通知管理
   每个模块都有完整的「查（列表+搜索+分页）/ 增 / 改 / 删」

   修改注意：
   - 所有请求都走 api.js 的 api()；401 统一由 handleAuthError 处理
   - 新增字段时：改下面的表头 row 渲染 + 表单字段 + 提交时的 body
   - 考生登录名是 account（自定义账号），不是手机号
   - 密码重置：考生在 App 提交申请 → 这里处理 → 重置密码并以「系统通知」把新密码发给考生
   - 通知类型：system（考生不可删除）/ notice（考生可删除），由管理员在「通知管理」设置
   - 发送对象：全部启用考生 / 指定考生（可搜索多选，同一次发送里同一个账号只能选一次）
     相关接口见 server/modules/notifications.py 与 server/modules/password_resets.py
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
    bindTabs();
    bindAdminModule();
    bindRegistrationModule();
    bindUserModule();
    bindResetModule();
    bindNotifyModule();
    bindQuestionSetModule();
    bindMaterialModule();
    bindReportModule();
    bindChangePassword();

    try {
      await Promise.all([loadMode(), loadStats()]);
      await Promise.all([loadAdmins(), loadRegistrations(), loadUsers(), loadResets(), loadNotifies(), loadQuestionSets(), loadMaterials(), loadReports()]);
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
        ['admins', 'registrations', 'users', 'resets', 'notifications', 'questionsets', 'materials', 'reports'].forEach((name) => {
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
       DELETE /api/admin/notifications/{batch_id}             删除记录（考生端保留）
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
    if (!confirm(`确定删除这条发送记录？\n「${n.title}」\n考生已经收到的通知不受影响。`)) return;
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
       judge 判断题 / single 选择题 / calc 计算题 / short 简答题
     ============================================================ */

  const QS_QTYPES = [
    { v: 'single', t: '选择题' },
    { v: 'judge', t: '判断题' },
    { v: 'calc', t: '计算题' },
    { v: 'short', t: '简答题' },
  ];

  function bindQuestionSetModule() {
    $('qs-refresh').addEventListener('click', loadQuestionSets);
    $('qs-create').addEventListener('click', () => openSetModal(null));
  }

  async function loadQuestionSets() {
    const tbody = $('qs-body');
    try {
      const data = await api('/api/admin/question-sets');
      const items = data.items || [];
      tbody.innerHTML = items.map(setRow).join('');
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
          if (act === 'import') openImportModal(item);
          if (act === 'edit') openSetModal(item);
          if (act === 'del') removeSet(item);
        });
      });
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function setRow(s) {
    const dist = (s.qtype_counts && Object.keys(s.qtype_counts).length)
      ? QS_QTYPES
          .filter((q) => (s.qtype_counts[q.v] || 0) > 0)
          .map((q) => `<span class="badge badge-off">${q.t} ${s.qtype_counts[q.v]}</span>`)
          .join(' ')
      : '<span class="badge badge-warn">空题库</span>';
    /* 内置一级题库（负数伪 id）：可查题/改题/导入，不可改名或删除 */
    const builtin = !!s.builtin;
    const actions = builtin
      ? `<button class="btn btn-sm btn-primary" data-act="questions" data-id="${s.id}">题目</button>
         <button class="btn btn-sm" data-act="import" data-id="${s.id}">导入</button>`
      : `<button class="btn btn-sm btn-primary" data-act="questions" data-id="${s.id}">题目</button>
         <button class="btn btn-sm" data-act="import" data-id="${s.id}">导入</button>
         <button class="btn btn-sm" data-act="edit" data-id="${s.id}">编辑</button>
         <button class="btn btn-sm btn-danger" data-act="del" data-id="${s.id}">删除</button>`;
    return `<tr>
      <td class="mono">${s.id}</td>
      <td><strong>${esc(s.name)}</strong>${builtin ? ' <span class="badge badge-ok">内置</span>' : ''}${s.description ? `<div class="card-sub" style="margin:2px 0 0;">${esc(s.description)}</div>` : ''}</td>
      <td>${s.level ? `<span class="badge badge-ok">${esc(s.level)}</span>` : '—'}</td>
      <td class="mono"><strong>${s.total}</strong> 题</td>
      <td>${dist}</td>
      <td class="mono">${esc(s.created_at || '—')}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }

  function openSetModal(item) {
    const isEdit = !!item;
    const s = item || { name: '', level: '', description: '' };

    const body =
      field('题库名称', `<input class="input" name="name" value="${esc(s.name)}" required
        placeholder="例如：二级 UT 题库" maxlength="50" />`) +
      field('级别', `<input class="input" name="level" value="${esc(s.level)}"
        placeholder="如：二级 / 三级（留空不显示）" maxlength="20" />`) +
      field('描述', `<textarea class="input" name="description" rows="2"
        placeholder="选填，考生端题库卡片副标题" maxlength="200">${esc(s.description)}</textarea>`);

    openModal({
      title: isEdit ? `编辑题库：${s.name}` : '新建题库',
      sub: isEdit ? '保存后考生端题库页同步更新' : '创建后点「题目」添加题目，或「导入」批量上传 CSV',
      fieldsHtml: body,
      okText: isEdit ? '保存修改' : '创建',
      onSubmit: async (values, close) => {
        const payload = {
          name: values.name.trim(),
          level: values.level.trim(),
          description: values.description.trim(),
        };
        if (isEdit) {
          await api(`/api/admin/question-sets/${item.id}`, { method: 'PUT', body: payload });
          toast('题库信息已更新');
        } else {
          await api('/api/admin/question-sets', { method: 'POST', body: payload });
          toast('题库已创建，接下来点「题目」或「导入」放题');
        }
        close();
        await loadQuestionSets();
      },
    });
  }

  async function removeSet(s) {
    if (!confirm(`确定删除题库「${s.name}」？\n包含 ${s.total} 道题将一并删除，相关答题记录也会清空，不可恢复！`)) return;
    try {
      const res = await api(`/api/admin/question-sets/${s.id}`, { method: 'DELETE' });
      toast(res.message || '已删除');
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
        <div class="modal" style="max-width: 760px;">
          <h3>题目管理：${esc(set.name)}</h3>
          <p class="modal-sub">共 ${set.total} 题，按题型分类。考生端按这些题型选择练习。</p>
          <div id="qsm-err" class="alert alert-err hidden"></div>
          <div id="qsm-list" class="table-wrap" style="max-height: 46vh; overflow-y: auto;">
            <div class="empty">加载中…</div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-primary" id="qsm-add">+ 添加题目</button>
            <button type="button" class="btn" id="qsm-import">批量导入 CSV</button>
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
    $('qsm-add').addEventListener('click', () => openAddQuestionModal(set));
    $('qsm-import').addEventListener('click', () => openImportModal(set));

    async function loadList() {
      try {
        const data = await api(`/api/admin/question-sets/${set.id}/questions`);
        const items = data.items || [];
        const groups = QS_QTYPES.map((q) => ({
          label: q.t,
          rows: items.filter((x) => x.qtype === q.v),
        })).filter((g) => g.rows.length > 0);

        $('qsm-list').innerHTML = groups.length
          ? groups.map((g) => `
              <div style="margin-bottom: 14px;">
                <div style="margin: 6px 0 6px;"><span class="badge badge-super">${g.label} · ${g.rows.length}</span></div>
                <table>
                  <thead><tr><th style="width:56px;">ID</th><th>题干</th><th style="width:120px;">答案</th><th style="width:80px;">操作</th></tr></thead>
                  <tbody>
                    ${g.rows.map((r) => `<tr>
                      <td class="mono">${r.id}</td>
                      <td class="wrap" style="white-space:normal;max-width:380px;">${esc(r.content)}</td>
                      <td class="wrap">${esc(r.answer)}</td>
                      <td class="actions">
                        <button class="btn btn-sm" data-qedit="${r.id}">编辑</button>
                        <button class="btn btn-sm btn-danger" data-qid="${r.id}">删除</button>
                      </td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>`).join('')
          : '<div class="empty">还没有题目，点「添加题目」或「批量导入 CSV」</div>';

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
            if (row) openEditQuestionModal(set, row);
          });
        });
      } catch (err) {
        if (!handleAuthError(err)) showErr(err.message);
      }
    }

    loadList();
  }

  function openAddQuestionModal(set) {
    const body =
      field('题型', selectHtml('qtype', QS_QTYPES, 'single'),
        '判断题会自动生成「正确 / 错误」两个选项；简答题不需要选项') +
      field('题干', `<textarea class="input" name="content" rows="3" required
        placeholder="输入题目内容" maxlength="2000"></textarea>`) +
      field('选项', `<textarea class="input" name="options_raw" rows="3"
        placeholder="A、选项一；##B、选项二；##C、选项三；##D、选项四"></textarea>`,
        '选择题 / 计算题必填，多个选项用「；##」分隔；简答题留空') +
      field('答案', `<input class="input" name="answer" required
        placeholder="选择题填选项字母（如 A）；判断题填 正确/错误；简答题填参考答案" maxlength="1000" />`) +
      field('解析', `<textarea class="input" name="explanation" rows="2"
        placeholder="选填" maxlength="2000"></textarea>`);

    openModal({
      title: `添加题目：${set.name}`,
      sub: '保存后立即出现在考生端这套题库里',
      fieldsHtml: body,
      okText: '保存题目',
      onSubmit: async (values, close) => {
        await api(`/api/admin/question-sets/${set.id}/questions`, {
          method: 'POST',
          body: {
            qtype: values.qtype,
            content: values.content,
            options_raw: values.options_raw || '',
            answer: values.answer,
            explanation: values.explanation || '',
          },
        });
        toast('题目已添加');
        close();
        openQuestionsModal(set);
        await loadQuestionSets();
      },
    });
  }

  /** 编辑题目：预填现有题干/选项/答案，PUT 保存（内置一级题库同样适用，直接写库） */
  function openEditQuestionModal(set, q) {
    const optionsRaw = (q.options || []).map((o) => `${o.key}、${o.text}`).join('；##');
    const body =
      field('题型', selectHtml('qtype', QS_QTYPES, q.qtype),
        '改题型会按规则重建选项：判断题=正确/错误，简答题无选项') +
      field('题干', `<textarea class="input" name="content" rows="3" required
        maxlength="2000">${esc(q.content)}</textarea>`) +
      field('选项', `<textarea class="input" name="options_raw" rows="3"
        placeholder="A、选项一；##B、选项二；##C、选项三；##D、选项四">${esc(optionsRaw)}</textarea>`,
        '选择题 / 计算题用；判断题留空自动生成；简答题留空') +
      field('正确答案', `<input class="input" name="answer" required
        placeholder="选择题填选项字母（如 A）；判断题填 正确/错误；简答题填参考答案" maxlength="1000"
        value="${esc(q.answer)}" />`) +
      field('解析', `<textarea class="input" name="explanation" rows="2"
        placeholder="选填" maxlength="2000"></textarea>`);

    openModal({
      title: `编辑题目 #${q.id}`,
      sub: '保存后立即生效，考生端下次拉题即为修正后的内容',
      fieldsHtml: body,
      okText: '保存修改',
      onSubmit: async (values, close) => {
        await api(`/api/admin/question-sets/${set.id}/questions/${q.id}`, {
          method: 'PUT',
          body: {
            qtype: values.qtype,
            content: values.content,
            options_raw: values.options_raw || '',
            answer: values.answer,
            explanation: values.explanation || '',
          },
        });
        toast('题目已更新');
        close();
        openQuestionsModal(set);
        await loadQuestionSets();
        await loadReports(); // 编辑题目会自动关闭对应纠错工单，刷新工单列表
      },
    });
  }

  function openImportModal(set) {
    const sample = '表头行…,然后每行一题，例如：\\n' +
      '1,,GENERAL,,判断题,超声检测中探头频率越高分辨率越高,,正确\\n' +
      '2,,GENERAL,,单选题,超声波在钢中的声速约为？,A、5900m/s；##B、340m/s；##C、1500m/s,A';

    const body =
      field('选择 CSV 文件', `<input class="input" type="file" id="qsi-file" accept=".csv,.txt" />`,
        '也可以直接在下面粘贴 CSV 文本（UTF-8）') +
      field('CSV 内容', `<textarea class="input" name="csv" id="qsi-text" rows="8"
        placeholder="${esc(sample)}"></textarea>`,
        '格式与内置一级题库 CSV 相同：序号,项目,知识点一,知识点二,题目类型,题目内容,题目选项,题目答案；' +
        '题型支持 判断题/单选题(选择题)/计算题/简答题；简答题选项列留空、答案列写参考答案；首行表头会自动跳过');

    openModal({
      title: `批量导入：${set.name}`,
      sub: '按行解析，异常行会跳过并提示，不影响已导入的题目',
      fieldsHtml: body,
      okText: '开始导入',
      onSubmit: async (values, close) => {
        if (!values.csv || !values.csv.trim()) throw new Error('请先选择文件或粘贴 CSV 内容');
        const res = await api(`/api/admin/question-sets/${set.id}/import`, {
          method: 'POST',
          body: { csv: values.csv },
        });
        const errs = (res.errors || []).length ? `\n示例：${res.errors[0]}` : '';
        toast(`${res.message}${errs}`);
        close();
        await loadQuestionSets();
      },
    });

    // 选文件后自动读入文本框
    const fileInput = $('qsi-file');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => { $('qsi-text').value = String(reader.result || ''); };
        reader.readAsText(f, 'utf-8');
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
    $('mats-upload').addEventListener('click', openUploadModal);
    $('mats-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMaterials(); });
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  async function loadMaterials() {
    const tbody = $('mats-body');
    try {
      const category = $('mats-category').value;
      const q = $('mats-q').value.trim();
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (q) params.set('q', q);
      const data = await api('/api/admin/materials?' + params.toString());
      const items = data.items || [];
      tbody.innerHTML = items.map(matRow).join('');
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
    } catch (err) {
      if (!handleAuthError(err)) toast(err.message);
    }
  }

  function matRow(m) {
    const cat = MATERIAL_CATEGORIES.find((c) => c.v === m.category);
    const method = m.method || '通用';
    const cover = m.has_cover
      ? `<img class="mat-cover" src="/api/admin/materials/${m.id}/cover?token=${encodeURIComponent(getToken())}" alt="封面" />`
      : `<span class="mat-cover mat-cover-none">首帧</span>`;
    return `<tr>
      <td class="mono">${m.id}</td>
      <td class="wrap"><strong>${esc(m.title)}</strong>${m.description ? `<div class="card-sub" style="margin:2px 0 0;">${esc(m.description)}</div>` : ''}</td>
      <td><span class="badge badge-ok">${esc(cat ? cat.t : m.category)}</span></td>
      <td>${esc(method)}</td>
      <td>${cover}</td>
      <td class="wrap" style="max-width:180px;">${esc(m.file_name)}</td>
      <td class="mono">${fmtSize(m.file_size)}</td>
      <td class="mono">${m.view_count || 0}</td>
      <td class="mono">${m.fav_count || 0}</td>
      <td class="mono">${m.comment_count || 0}</td>
      <td class="mono">${esc(m.created_at || '—')}</td>
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
      field('分类', `<select class="input" name="category">${categoryOptions('textbook')}</select>`,
        '决定考生端 App 里的分组（标准规范 / 教材 / 辅导资料 / 视频课程）') +
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
        const coverInput = $('mats-cover');
        const cf = coverInput && coverInput.files && coverInput.files[0];
        if (cf) form.append('cover', cf);
        const res = await uploadMaterialRequest(form);
        toast(res.message || '已上传');
        close();
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
      field('分类', `<select class="input" name="category">${categoryOptions(m.category)}</select>`,
        '改分类 / 换文件都不会动原文件，只更新数据库里的信息') +
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
          },
        });
        toast('资料信息已更新');
        close();
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
        <div style="white-space:normal;">${esc(q.content || '（题目已删除）')}</div>
        <div class="card-sub">现答案：<strong>${esc(q.answer || '—')}</strong>${opts ? ` · 选项：${esc(opts.slice(0, 80))}${opts.length > 80 ? '…' : ''}` : ''}</div>
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

  function openModal({ title, sub, fieldsHtml, okText, onSubmit, wide }) {
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
              <button type="button" class="btn" id="modal-cancel">取消</button>
              <button type="submit" class="btn btn-primary" id="modal-ok">${esc(okText || '保存')}</button>
            </div>
          </form>
        </div>
      </div>`;

    const close = () => { root.innerHTML = ''; };
    $('modal-cancel').addEventListener('click', close);
    root.querySelector('.modal-mask').addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('modal-mask')) close();
    });

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
})();
