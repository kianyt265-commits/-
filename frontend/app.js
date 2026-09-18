/* ==============================================================
   V2Box Panel — frontend SPA (vanilla JS, RTL/Persian)

   Talks to the FastAPI backend through relative URLs so it works
   behind nginx (:80 / :8080) and when uvicorn serves /frontend.
   ============================================================== */

'use strict';

/* ============================== utils ============================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (value) => String(value ?? '').replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
const num = (value, decimals = 0) =>
  toFa(Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }));

function formatBytes(bytes, decimals = 1) {
  const n = Number(bytes || 0);
  if (!n) return '۰ بایت';
  if (n < 0) return 'نامحدود';
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];
  let value = n, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${toFa(value.toFixed(i === 0 ? 0 : decimals))} ${units[i]}`;
}

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

function toJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = gy <= 1600 ? 0 : 979;
  const gy2 = gy <= 1600 ? gy - 621 : gy - 1600;
  let days = 365 * gy2 + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
  if (gm > 2 && ((gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0)) days++;
  jy += 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

function jalaliDate(iso, withTime = false) {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  const [jy, jm, jd] = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const date = `${toFa(jy)}/${toFa(String(jm).padStart(2, '0'))}/${toFa(String(jd).padStart(2, '0'))}`;
  if (!withTime) return date;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${date} — ${toFa(hh)}:${toFa(mm)}`;
}

function jalaliMonthDay(iso) {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  const [, jm, jd] = toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${toFa(jd)} ${JALALI_MONTHS[jm - 1]}`;
}

function timeAgo(iso) {
  if (!iso) return 'هرگز';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 0) return '—';
  if (diff < 60) return `${toFa(diff)} ثانیه پیش`;
  if (diff < 3600) return `${toFa(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${toFa(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 86400 * 30) return `${toFa(Math.floor(diff / 86400))} روز پیش`;
  return jalaliDate(iso);
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const STATUS_LABEL = {
  active: 'فعال', expired: 'منقضی', limited: 'اتمام حجم', disabled: 'غیرفعال',
};
const PROTOCOL_LABEL = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', shadowsocks: 'Shadowsocks', ss: 'Shadowsocks' };
const NETWORK_LABEL = { ws: 'WebSocket', tcp: 'TCP', grpc: 'gRPC', h2: 'HTTP/2', httpupgrade: 'HTTPUpgrade' };
const SECURITY_LABEL = { tls: 'TLS', reality: 'REALITY', none: 'بدون رمزنگاری' };

async function copyText(text, label = 'کپی شد') {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(label, 'success');
    return true;
  } catch (err) {
    toast('کپی ناموفق بود — دستی انتخاب کنید', 'error', String(err));
    return false;
  }
}

function toast(message, type = 'success', detail = '') {
  const root = $('#toastRoot');
  if (!root) return;
  const icons = { success: '✓', error: '✕', warn: '⚠', info: '◈' };
  const node = document.createElement('div');
  node.className = `toast ${type === 'success' ? '' : type}`;
  node.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span>
    <div><span>${esc(message)}</span>${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 260);
  }, type === 'error' ? 6000 : 3400);
}

/* =============================== api =============================== */
const state = {
  token: localStorage.getItem('v2box_token') || '',
  view: 'dashboard',
  theme: localStorage.getItem('v2box_theme') || 'dark',
  meta: null,
  profile: null,
  dashboard: null,
  servers: [],
  users: { items: [], total: 0, skip: 0, limit: 20, search: '', status: '', protocol: '', sort: 'created_desc' },
  xray: { status: null, config: null, logs: null, tab: 'status' },
  audit: [],
  busy: false,
};

function authHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return headers;
}

async function api(path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(path, {
    method,
    headers: authHeaders(headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && state.token) {
    logout(false);
    throw new Error('نشست شما منقضی شد — دوباره وارد شوید');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
  if (!res.ok) {
    const detail = data && (data.detail || data.message);
    if (typeof detail === 'object') throw new Error(JSON.stringify(detail));
    throw new Error(detail || `خطای سرور (${res.status})`);
  }
  return data;
}

async function apiBlob(path) {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`دریافت ناموفق (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

async function run(label, fn) {
  try {
    return await fn();
  } catch (err) {
    toast(`${label} ناموفق بود`, 'error', err.message || String(err));
    return null;
  }
}

/* ============================== modal ============================== */
let activeObjectUrls = [];

function openModal({ title, subtitle = '', body, footer = '', size = '', onMount }) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <div>
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <button class="modal-close" data-modal-close aria-label="بستن">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-modal-close]')) closeModal();
  });
  $('#modalRoot').appendChild(overlay);
  document.body.style.overflow = 'hidden';
  if (onMount) onMount(overlay);
  const focusable = overlay.querySelector('input, select, textarea, button.btn-primary');
  if (focusable) setTimeout(() => focusable.focus(), 60);
  return overlay;
}

function closeModal() {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls = [];
  $('#modalRoot').innerHTML = '';
  document.body.style.overflow = '';
}

function confirmDialog({ title = 'تأیید عملیات', message, confirmText = 'انجام شود', danger = false, onConfirm }) {
  openModal({
    title,
    size: 'narrow',
    body: `<p style="margin:0;color:var(--muted);font-size:13.4px;line-height:2">${message}</p>`,
    footer: `
      <button class="btn" data-modal-close>انصراف</button>
      <div class="spacer"></div>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmOk">${esc(confirmText)}</button>`,
    onMount: (overlay) => {
      $('#confirmOk', overlay).addEventListener('click', async () => {
        closeModal();
        await onConfirm();
      });
    },
  });
}

/* ============================ rendering ============================ */
const viewRoot = $('#viewRoot');

const VIEW_META = {
  dashboard: ['داشبورد', 'نمای کلی وضعیت پنل و هستهٔ Xray'],
  users: ['کاربران', 'ساخت، ویرایش و مدیریت کانفیگ‌ها'],
  servers: ['سرورها', 'این‌باندها و آدرس‌های اتصال'],
  xray: ['هستهٔ Xray', 'وضعیت، کانفیگ و راه‌اندازی مجدد'],
  logs: ['گزارش‌ها', 'رویدادهای پنل و لاگ هسته'],
  settings: ['تنظیمات', 'امنیت، ظاهر و اطلاعات پنل'],
};

function setView(view) {
  if (!VIEW_META[view]) view = 'dashboard';
  state.view = view;
  $$('#primaryNav .nav-item').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
  const [title, subtitle] = VIEW_META[view];
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
  document.title = `${title} — پنل V2Box`;
  closeSidebar();
  render();
}

function skeleton(count = 3) {
  return `<div class="stack">${Array.from({ length: count }, () =>
    `<div class="skeleton" style="height:${42 + Math.random() * 30}px"></div>`).join('')}</div>`;
}

async function render() {
  const view = state.view;
  viewRoot.innerHTML = skeleton();
  try {
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'users') await renderUsers();
    else if (view === 'servers') await renderServers();
    else if (view === 'xray') await renderXray();
    else if (view === 'logs') await renderLogs();
    else if (view === 'settings') await renderSettings();
  } catch (err) {
    viewRoot.innerHTML = `<div class="card"><div class="empty">
      <span class="empty-icon">⚠</span><strong>خطا در بارگذاری</strong>
      <p>${esc(err.message || err)}</p>
      <button class="btn" data-action="refresh">تلاش دوباره</button></div></div>`;
  }
}

/* ---------------------------- dashboard ---------------------------- */
async function renderDashboard() {
  const [dash] = await Promise.all([
    api('/api/dashboard'),
    refreshCoreChip(),
  ]);
  state.dashboard = dash;

  const chart = dash.traffic_chart || [];
  const maxTotal = Math.max(1, ...chart.map((c) => c.total));
  const bars = chart.length
    ? chart.slice(-7).map((c) => {
      const downH = Math.max(2, Math.round((c.download / maxTotal) * 110));
      const upH = Math.max(2, Math.round((c.upload / maxTotal) * 110));
      return `<div class="bar-col" title="${esc(jalaliDate(c.day))} — دانلود ${formatBytes(c.download)} / آپلود ${formatBytes(c.upload)}">
          <div class="bar-stack"><i style="height:${downH}px"></i><i class="up" style="height:${upH}px"></i></div>
          <small>${esc(jalaliMonthDay(c.day + 'T00:00:00'))}</small>
        </div>`;
    }).join('')
    : `<div class="empty" style="width:100%"><span class="empty-icon">◔</span><strong>داده‌ای برای نمایش نیست</strong>
        <p>پس از اولین ترافیک، نمودار ۷ روز اخیر اینجا ظاهر می‌شود.</p></div>`;

  const protocols = dash.protocols || {};
  const totalProto = Object.values(protocols).reduce((a, b) => a + b, 0) || 1;
  const colors = ['#10b981', '#38bdf8', '#a78bfa', '#f59e0b'];
  let acc = 0;
  const stops = Object.entries(protocols).map(([key, value], i) => {
    const start = (acc / totalProto) * 360;
    acc += value;
    const end = (acc / totalProto) * 360;
    return `${colors[i % colors.length]} ${start}deg ${end}deg`;
  }).join(', ');
  const legend = Object.entries(protocols).map(([key, value], i) =>
    `<div class="legend-row"><i style="background:${colors[i % colors.length]}"></i>
      <span>${esc(PROTOCOL_LABEL[key] || key)}</span><strong>${num(value)}</strong></div>`).join('');

  const topUsers = (dash.top_users || []).map((u, i) =>
    `<div class="top-row"><span class="rank">${toFa(i + 1)}</span>
      <span class="name">${esc(u.username)}</span>
      <span class="chip badge-status ${esc(u.status)}">${esc(STATUS_LABEL[u.status] || u.status)}</span>
      <span class="val">${esc(u.traffic_human)}</span></div>`).join('') ||
    `<div class="empty"><span class="empty-icon">◌</span><p>هنوز کاربری ساخته نشده است.</p></div>`;

  const events = (dash.recent_events || []).map((e) =>
    `<div class="kv-row"><span>${esc(actionLabel(e.action))}</span>
      <strong>${esc(e.target || '')}</strong>
      <small style="color:var(--muted-2);font-size:11px">${esc(timeAgo(e.created_at))}</small></div>`).join('') ||
    `<div class="empty"><p>رویدادی ثبت نشده است.</p></div>`;

  const x = dash.xray || {};

  viewRoot.innerHTML = `
    <div class="grid grid-4">
      ${statCard('◉', 'کاربران', num(dash.total_users), `${num(dash.active_users)} فعال · ${num(dash.inactive_users)} غیرفعال`, '')}
      ${statCard('⛁', 'سرورها', num(dash.total_servers), `${num(dash.enabled_servers)} این‌باند فعال`, 'blue')}
      ${statCard('⇅', 'ترافیک کل', esc(dash.total_traffic_human), `آپلود ${formatBytes(dash.total_upload)} · دانلود ${formatBytes(dash.total_download)}`, 'violet')}
      ${statCard('⚠', 'نیازمند رسیدگی', num(dash.expired_users + dash.limited_users + dash.expiring_soon),
        `${num(dash.expired_users)} منقضی · ${num(dash.limited_users)} اتمام حجم · ${num(dash.expiring_soon)} رو به اتمام`, 'warn')}
    </div>

    <div class="grid grid-side">
      <div class="card">
        <div class="card-head">
          <div><h3>ترافیک ۷ روز اخیر</h3><p>مجموع آپلود و دانلود کاربران (بر اساس نمونه‌های ساعتی)</p></div>
          <div class="spacer"></div>
          <span class="chip"><i class="dot dot-running"></i> دانلود</span>
          <span class="chip chip-blue"><i class="dot" style="background:var(--accent-2)"></i> آپلود</span>
        </div>
        <div class="bars">${bars}</div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>توزیع پروتکل‌ها</h3><p>سهم هر پروتکل میان کاربران</p></div></div>
        <div class="donut-wrap">
          <div class="donut" style="background:conic-gradient(${stops || 'var(--surface-3) 0 360deg'})">
            <span><strong>${num(dash.total_users)}</strong><small>کاربر</small></span>
          </div>
          <div class="legend">${legend || '<span class="chip">داده‌ای نیست</span>'}</div>
        </div>
      </div>
    </div>

    <div class="grid grid-side">
      <div class="card">
        <div class="card-head">
          <div><h3>وضعیت هستهٔ Xray</h3><p>کانتینر، کانفیگ و این‌باندها</p></div>
          <div class="spacer"></div>
          <button class="btn btn-sm" data-action="xray-sync">↻ همگام‌سازی کاربران</button>
          <button class="btn btn-sm" data-action="xray-restart">⏻ ری‌استارت</button>
        </div>
        <div class="kv">
          <div class="kv-row"><span>وضعیت کانتینر</span>
            <strong>${x.container_running
              ? '<span class="chip chip-accent">در حال اجرا</span>'
              : `<span class="chip chip-danger">${esc(x.container_state || 'متوقف')}</span>`}</strong></div>
          <div class="kv-row"><span>کانفیگ معتبر</span>
            <strong>${x.config_ok ? '<span class="chip chip-accent">بله</span>' : '<span class="chip chip-danger">خیر</span>'}</strong></div>
          <div class="kv-row"><span>تعداد این‌باند</span><strong>${num(x.inbounds || 0)}</strong></div>
          <div class="kv-row"><span>API آمار (gRPC)</span>
            <strong>${x.api_enabled ? '<span class="chip chip-accent">فعال</span>' : '<span class="chip chip-mute">غیرفعال</span>'}</strong></div>
          <div class="kv-row"><span>کاربران آنلاین (۱۰ دقیقهٔ اخیر)</span><strong>${num(dash.online_recent)}</strong></div>
          <div class="kv-row"><span>آخرین به‌روزرسانی</span><strong>${esc(jalaliDate(dash.generated_at, true))}</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>پرمصرف‌ترین کاربران</h3><p>بر اساس مجموع ترافیک</p></div></div>
        <div class="top-list">${topUsers}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h3>آخرین رویدادها</h3><p>تغییرات ثبت‌شده در پنل</p></div>
        <div class="spacer"></div><button class="btn btn-sm" data-action="goto" data-view="logs">مشاهدهٔ همه</button></div>
      <div class="kv">${events}</div>
    </div>`;
}

function statCard(icon, label, value, foot, tone) {
  return `<div class="card stat-card ${tone}">
    <div class="stat-top">
      <div class="stat-icon">${icon}</div>
      <div><div class="stat-value">${value}</div><div class="stat-label">${esc(label)}</div></div>
    </div>
    <div class="stat-foot">${foot}</div>
  </div>`;
}

const ACTION_LABELS = {
  login: 'ورود به پنل', login_failed: 'ورود ناموفق', password_changed: 'تغییر رمز عبور',
  user_created: 'ساخت کاربر', user_updated: 'ویرایش کاربر', user_deleted: 'حذف کاربر',
  user_toggled: 'تغییر وضعیت کاربر', users_bulk_created: 'ساخت گروهی کاربران',
  traffic_reset: 'ریست ترافیک', traffic_updated: 'به‌روزرسانی ترافیک',
  user_extended: 'تمدید کاربر', uuid_rotated: 'تغییر UUID',
  server_created: 'افزودن سرور', server_updated: 'ویرایش سرور', server_deleted: 'حذف سرور',
  server_set_default: 'تعیین سرور پیش‌فرض', servers_imported: 'شناسایی این‌باندها',
  reality_keys_generated: 'ساخت کلید REALITY', reality_keys_rotated: 'چرخش کلید REALITY',
  xray_restarted: 'ری‌استارت هسته', xray_synced: 'همگام‌سازی کانفیگ',
  xray_config_saved: 'ذخیرهٔ config.json', auto_disable: 'غیرفعال‌سازی خودکار',
};
const actionLabel = (action) => ACTION_LABELS[action] || action;

/* ------------------------------ users ------------------------------ */
async function renderUsers() {
  if (!state.servers.length) await loadServers();
  const data = await fetchUsers();
  paintUsers(data);
}

async function fetchUsers() {
  const u = state.users;
  const params = new URLSearchParams({
    skip: u.skip, limit: u.limit, sort: u.sort,
    search: u.search, status: u.status, protocol: u.protocol,
  });
  return api(`/api/users?${params.toString()}`);
}

async function refreshUserBadge() {
  try {
    const data = await api('/api/users?limit=1');
    $('#navUsersCount').textContent = num((data && data.total) || 0);
  } catch { /* the badge is cosmetic — ignore failures */ }
}

function paintUsers(data) {
  state.users.items = data.users || [];
  state.users.total = data.total || 0;
  $('#navUsersCount').textContent = num(state.users.total);

  const filters = [
    ['', 'همه'], ['active', 'فعال'], ['expired', 'منقضی'], ['expiring', 'رو به اتمام'],
    ['limited', 'اتمام حجم'], ['disabled', 'غیرفعال'], ['unlimited', 'نامحدود'],
  ].map(([key, label]) =>
    `<button class="filter-chip ${state.users.status === key ? 'active' : ''}" data-action="filter-status" data-value="${key}">${label}</button>`).join('');

  const protocols = ['', 'vless', 'vmess', 'trojan', 'shadowsocks'].map((key) =>
    `<button class="filter-chip ${state.users.protocol === key ? 'active' : ''}" data-action="filter-protocol" data-value="${key}">${key ? esc(PROTOCOL_LABEL[key]) : 'همهٔ پروتکل‌ها'}</button>`).join('');

  const rows = state.users.items.map(userRow).join('');

  viewRoot.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>کاربران</h3><p>مجموعاً ${num(state.users.total)} کاربر — ${num(state.users.items.length)} مورد نمایش داده شده</p></div>
        <div class="spacer"></div>
        <button class="btn" data-action="bulk-modal">⧉ ساخت گروهی</button>
        <button class="btn btn-primary" data-action="user-create">+ کاربر جدید</button>
      </div>

      <div class="toolbar" style="margin-bottom:12px">
        <div class="search-box">
          <input type="search" id="userSearch" placeholder="جستجو در نام کاربری، ایمیل یا UUID…" value="${esc(state.users.search)}" />
        </div>
        <select id="userSort" style="max-width:190px">
          ${[['created_desc', 'جدیدترین'], ['created_asc', 'قدیمی‌ترین'], ['username_asc', 'نام (الفبا)'],
             ['traffic_desc', 'پرمصرف‌ترین'], ['expire_asc', 'نزدیک‌ترین انقضا']]
            .map(([key, label]) => `<option value="${key}" ${state.users.sort === key ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <div class="spacer"></div>
        <button class="btn btn-sm btn-ghost" data-action="refresh">↻</button>
      </div>

      <div class="toolbar" style="margin-bottom:14px">
        <div class="filter-chips">${filters}</div>
        <div class="filter-chips">${protocols}</div>
      </div>

      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>کاربر</th><th>پروتکل</th><th>وضعیت</th><th>مصرف</th>
            <th>انقضا</th><th>آخرین اتصال</th><th style="text-align:end">عملیات</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="7"><div class="empty">
            <span class="empty-icon">◌</span><strong>کاربری یافت نشد</strong>
            <p>اولین کاربر را بسازید تا کانفیگ‌ها تولید شوند.</p>
            <button class="btn btn-primary" data-action="user-create">+ کاربر جدید</button></div></td></tr>`}
          </tbody>
        </table>
      </div>
      ${pager()}
    </div>`;

  const search = $('#userSearch');
  if (search) {
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.users.search = search.value.trim();
        state.users.skip = 0;
        refreshUsers();
      }, 320);
    });
  }
  const sort = $('#userSort');
  if (sort) sort.addEventListener('change', () => { state.users.sort = sort.value; refreshUsers(); });
}

function userRow(u) {
  const used = u.data_used || 0;
  const limit = u.data_limit || 0;
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const progressClass = percent >= 100 ? 'over' : percent >= 80 ? 'warn' : '';
  const initial = (u.username || '?').charAt(0).toUpperCase();

  return `<tr data-user="${esc(u.id)}">
    <td>
      <div class="cell-user">
        <span class="avatar">${esc(initial)}</span>
        <div>
          <strong>${esc(u.remark || u.username)}</strong>
          <small>${esc(u.username)}${u.email ? ` · ${esc(u.email)}` : ''}</small>
        </div>
      </div>
    </td>
    <td>
      <div class="row" style="gap:5px">
        <span class="chip chip-accent">${esc(PROTOCOL_LABEL[u.protocol] || u.protocol)}</span>
        <span class="chip">${esc(NETWORK_LABEL[u.network] || u.network)}</span>
        <span class="chip ${u.security === 'reality' ? 'chip-violet' : u.security === 'tls' ? 'chip-blue' : 'chip-mute'}">${esc(SECURITY_LABEL[u.security] || u.security)}</span>
      </div>
    </td>
    <td><span class="chip badge-status ${esc(u.status)}">${esc(STATUS_LABEL[u.status] || u.status)}</span></td>
    <td>
      <div class="usage-cell">
        <div class="progress ${progressClass}"><i style="width:${limit ? percent : 4}%"></i></div>
        <div class="usage-text"><span>${formatBytes(used)}</span><span>${limit ? formatBytes(limit) : 'نامحدود'}</span></div>
      </div>
    </td>
    <td>${u.expire_date
      ? `<div>${esc(jalaliDate(u.expire_date))}</div><small style="color:${u.days_left <= 3 ? 'var(--danger)' : 'var(--muted-2)'};font-size:11.4px">${u.days_left >= 0 ? `${toFa(u.days_left)} روز مانده` : `${toFa(Math.abs(u.days_left))} روز پیش منقضی شد`}</small>`
      : '<span class="chip chip-mute">نامحدود</span>'}</td>
    <td><span style="color:var(--muted);font-size:12.2px">${esc(timeAgo(u.last_connected))}</span></td>
    <td>
      <div class="row-actions">
        <button class="btn btn-sm btn-primary" data-action="user-links" data-id="${esc(u.id)}" title="کانفیگ‌ها و QR">لینک‌ها</button>
        <button class="btn btn-sm" data-action="user-edit" data-id="${esc(u.id)}" title="ویرایش">✎</button>
        <button class="btn btn-sm" data-action="user-toggle" data-id="${esc(u.id)}" title="${u.is_active ? 'غیرفعال کردن' : 'فعال کردن'}">${u.is_active ? '⏻' : '▶'}</button>
        <button class="btn btn-sm" data-action="user-more" data-id="${esc(u.id)}" title="بیشتر">⋯</button>
      </div>
    </td>
  </tr>`;
}

function pager() {
  const u = state.users;
  const pages = Math.max(1, Math.ceil(u.total / u.limit));
  const current = Math.floor(u.skip / u.limit) + 1;
  if (u.total <= u.limit) return '';
  return `<div class="pager">
    <button class="btn btn-sm" data-action="page" data-value="${Math.max(0, u.skip - u.limit)}" ${u.skip === 0 ? 'disabled' : ''}>› قبلی</button>
    <span>صفحهٔ ${toFa(current)} از ${toFa(pages)}</span>
    <button class="btn btn-sm" data-action="page" data-value="${Math.min((pages - 1) * u.limit, u.skip + u.limit)}" ${current >= pages ? 'disabled' : ''}>بعدی ‹</button>
  </div>`;
}

async function refreshUsers() {
  const data = await run('بارگذاری کاربران', fetchUsers);
  if (data) paintUsers(data);
}

/* ---------------------------- user modal --------------------------- */
function userFormHtml(user = {}, servers = []) {
  const isEdit = Boolean(user.id);
  const m = state.meta || {};
  const baseServer = servers.find((s) => s.is_default) || servers[0] || {};
  const selectedServer = user.server_id || baseServer.id || '';
  if (!isEdit) {
    user = {
      protocol: baseServer.protocol || 'vless',
      network: baseServer.network || 'ws',
      security: baseServer.security || 'tls',
      flow: baseServer.security === 'reality' ? 'xtls-rprx-vision' : '',
      ...user,
    };
  }
  const optionList = (list, current, labels = {}) => list.map((key) =>
    `<option value="${esc(key)}" ${String(current || '') === key ? 'selected' : ''}>${esc(labels[key] || key)}</option>`).join('');

  return `
  <form id="userForm" class="stack">
    <div class="form-grid">
      <label class="field ${isEdit ? '' : ''}">
        <span>نام کاربری *</span>
        <input type="text" name="username" required minlength="2" maxlength="64" pattern="[A-Za-z0-9._@-]+"
          value="${esc(user.username || '')}" ${isEdit ? 'readonly style="opacity:.6"' : ''}
          placeholder="مثلاً ali-1403" autocomplete="off" />
        <small class="hint">فقط حروف انگلیسی، عدد و . _ - @ — پس از ساخت قابل تغییر نیست</small>
      </label>

      <label class="field">
        <span>نام نمایشی (remark)</span>
        <input type="text" name="remark" value="${esc(user.remark || '')}" placeholder="در کانفیگ نمایش داده می‌شود" />
      </label>

      <label class="field">
        <span>پروتکل</span>
        <select name="protocol">${optionList(m.protocols || ['vless', 'vmess', 'trojan', 'shadowsocks'], user.protocol || 'vless', PROTOCOL_LABEL)}</select>
      </label>

      <label class="field">
        <span>انتقال (network)</span>
        <select name="network">${optionList(m.networks || ['ws', 'tcp', 'grpc', 'h2'], user.network || 'ws', NETWORK_LABEL)}</select>
      </label>

      <label class="field">
        <span>لایهٔ امنیتی</span>
        <select name="security">${optionList(m.securities || ['tls', 'reality', 'none'], user.security || 'tls', SECURITY_LABEL)}</select>
      </label>

      <label class="field" data-flow-field>
        <span>flow</span>
        <select name="flow">${optionList(m.flows || ['', 'xtls-rprx-vision'], user.flow || '', { '': 'بدون flow', 'xtls-rprx-vision': 'xtls-rprx-vision', 'xtls-rprx-vision-udp443': 'vision-udp443' })}</select>
      </label>

      <label class="field">
        <span>سقف حجم (گیگابایت)</span>
        <input type="number" name="data_limit" min="0" step="1" value="${esc(user.data_limit ? Math.round(user.data_limit / 1073741824) : 0)}" />
        <small class="hint">صفر = نامحدود</small>
      </label>

      <label class="field">
        <span>مدت اعتبار (روز)</span>
        <input type="number" name="expire_days" min="0" step="1" value="${esc(isEdit ? '' : 30)}" placeholder="${isEdit ? 'خالی = بدون تغییر' : 'صفر = نامحدود'}" />
        <small class="hint">${isEdit ? 'برای حذف انقضا عدد ۰ بگذارید' : 'صفر = نامحدود'}</small>
      </label>

      <label class="field">
        <span>حداکثر اتصال همزمان</span>
        <input type="number" name="max_connections" min="1" value="${esc(user.max_connections || 2)}" />
      </label>

      <label class="field">
        <span>فینگرپرینت</span>
        <select name="fingerprint">${optionList(m.fingerprints || ['chrome', 'firefox', 'safari'], user.fingerprint || 'chrome')}</select>
      </label>

      ${!isEdit ? `
      <label class="field">
        <span>سرور (این‌باند)</span>
        <select name="server_id" id="serverSelect">
          ${servers.map((s) => `<option value="${esc(s.id)}" ${selectedServer === s.id ? 'selected' : ''}
            data-protocol="${esc(s.protocol)}" data-network="${esc(s.network)}" data-security="${esc(s.security)}"
            data-service="${esc(s.service_name || '')}">${esc(s.server_name)} — ${esc(PROTOCOL_LABEL[s.protocol] || s.protocol)}/${esc(NETWORK_LABEL[s.network] || s.network)}/${esc(SECURITY_LABEL[s.security] || s.security)}</option>`).join('')}
        </select>
        <small class="hint">پروتکل، انتقال و امنیت کاربر از سرور انتخابی پر می‌شود</small>
      </label>` : ''}

      <label class="field">
        <span>ایمیل (اختیاری)</span>
        <input type="text" name="email" value="${esc(user.email || '')}" placeholder="user@example.com" />
      </label>

      <div class="field full">
        <span>وضعیت</span>
        <div class="switch-row">
          <label class="switch"><input type="checkbox" name="is_active" ${user.is_active === false ? '' : 'checked'} /><i></i></label>
          <span style="color:var(--muted);font-size:12.6px">کاربر فعال باشد (در غیر این صورت کانفیگی در xray ثبت نمی‌شود)</span>
        </div>
      </div>
    </div>
  </form>`;
}

function openUserModal(user = null) {
  const isEdit = Boolean(user);
  openModal({
    title: isEdit ? `ویرایش کاربر «${user.username}»` : 'ساخت کاربر جدید',
    subtitle: isEdit ? 'تغییرات بلافاصله در config.json اعمال و هسته ری‌استارت می‌شود' : 'پس از ساخت، لینک‌ها و QRcode آمادهٔ اشتراک‌گذاری است',
    size: '',
    body: userFormHtml(user || {}, state.servers),
    footer: `
      <button class="btn" data-modal-close>انصراف</button>
      <div class="spacer"></div>
      ${isEdit ? `<span class="chip chip-mute" id="userUuidChip">UUID: ${esc((user.uuid_key || '').slice(0, 8))}…</span>` : ''}
      <button class="btn btn-primary" id="saveUser">${isEdit ? 'ذخیرهٔ تغییرات' : 'ساخت کاربر'}</button>`,
    onMount: (overlay) => {
      $('#saveUser', overlay).addEventListener('click', () => saveUser(user));
      syncFlowField(overlay);
      $$('select[name="security"], select[name="protocol"], select[name="network"]', overlay)
        .forEach((sel) => sel.addEventListener('change', () => syncFlowField(overlay)));

      const serverSelect = $('#serverSelect', overlay);
      if (serverSelect) {
        serverSelect.addEventListener('change', () => {
          const option = serverSelect.selectedOptions[0];
          if (!option) return;
          $('select[name="protocol"]', overlay).value = option.dataset.protocol || 'vless';
          $('select[name="network"]', overlay).value = option.dataset.network || 'ws';
          $('select[name="security"]', overlay).value = option.dataset.security || 'tls';
          const flowSelect = $('select[name="flow"]', overlay);
          if (flowSelect) {
            flowSelect.value = (option.dataset.security === 'reality' && option.dataset.protocol === 'vless'
              && option.dataset.network === 'tcp') ? 'xtls-rprx-vision' : '';
          }
          syncFlowField(overlay);
        });
      }
    },
  });
}

function syncFlowField(overlay) {
  const security = $('select[name="security"]', overlay).value;
  const protocol = $('select[name="protocol"]', overlay).value;
  const network = $('select[name="network"]', overlay).value;
  const field = $('[data-flow-field]', overlay);
  const allowed = protocol === 'vless' && (security === 'reality' || security === 'none') && (network === 'tcp' || network === 'raw');
  field.style.opacity = allowed ? '1' : '.45';
  field.title = allowed ? '' : 'flow فقط برای vless روی tcp/reality کاربرد دارد';
}

async function saveUser(existing) {
  const form = $('#userForm');
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    username: data.username.trim(),
    protocol: data.protocol,
    network: data.network,
    security: data.security,
    flow: data.flow || '',
    fingerprint: data.fingerprint || 'chrome',
    data_limit: Number(data.data_limit || 0),
    max_connections: Number(data.max_connections || 2),
    email: data.email || null,
    remark: data.remark || null,
    is_active: form.querySelector('[name="is_active"]').checked,
  };
  if (data.expire_days !== '' && data.expire_days !== undefined) payload.expire_days = Number(data.expire_days);
  if (!existing && data.server_id) payload.server_id = data.server_id;

  const button = $('#saveUser');
  button.disabled = true;
  button.textContent = 'در حال ذخیره…';

  const result = existing
    ? await run('ویرایش کاربر', () => api(`/api/users/${existing.id}`, { method: 'PUT', body: payload }))
    : await run('ساخت کاربر', () => api('/api/users', { method: 'POST', body: payload }));

  button.disabled = false;
  button.textContent = existing ? 'ذخیرهٔ تغییرات' : 'ساخت کاربر';
  if (!result) return;

  closeModal();
  toast(existing ? 'کاربر به‌روزرسانی شد' : `کاربر «${payload.username}» ساخته شد`);
  reportWarnings(result.warnings);
  reportXray(result.xray);
  if (existing) await refreshUsers();
  else {
    state.users.skip = 0;
    state.users.sort = 'created_desc';
    await refreshUsers();
    openLinksModal(result.user.id || result.id);
  }
}

function reportWarnings(warnings) {
  (warnings || []).forEach((message) => toast(message, 'warn'));
}

function reportXray(report) {
  if (!report) return;
  if (report.unmatched_users && report.unmatched_users.length) {
    toast(`این کاربران با هیچ این‌باندی سازگار نیستند: ${report.unmatched_users.join('، ')}`, 'warn');
  }
  if (report.ok === false) {
    toast('کانفیگ xray به‌روزرسانی نشد', 'warn', report.message);
    return;
  }
  if (report.restart && report.restart.ok === false) {
    toast('config.json ذخیره شد اما ری‌استارت هسته ناموفق بود', 'warn', report.restart.message);
  }
}

/* ---------------------------- links modal -------------------------- */
async function openLinksModal(userId) {
  const detail = await run('دریافت کانفیگ‌ها', () => api(`/api/users/${userId}`));
  if (!detail) return;
  const { user, links } = detail;
  const rawSub = detail.subscription || `/sub/${user.sub_id}`;
  reportWarnings(detail.warnings);
  const subUrl = /^https?:\/\//.test(rawSub) ? rawSub : `${location.origin}${rawSub.startsWith('/') ? rawSub : `/${rawSub}`}`;

  const linkRows = links.map((item, index) => `
    <div class="link-row">
      <div>
        <div class="link-head">
          <span class="chip chip-accent">${esc(PROTOCOL_LABEL[item.protocol] || item.protocol)}</span>
          <span class="chip">${esc(item.server)}</span>
          <span class="chip chip-mute">${esc(item.remark)}</span>
        </div>
        <code data-link-code="${index}">${esc(item.link)}</code>
      </div>
      <div class="link-actions">
        <button class="btn btn-sm" data-action="copy" data-copy-index="${index}" data-copy-scope="link">کپی</button>
        <button class="btn btn-sm" data-action="qr" data-id="${esc(user.id)}" data-index="${index}">QR</button>
      </div>
    </div>`).join('');

  openModal({
    title: `کانفیگ‌های «${user.remark || user.username}»`,
    subtitle: 'لینک‌ها را در V2Box / v2rayNG / Streisand / Nekoray وارد کنید',
    size: 'wide',
    body: `
      <div class="tabs" id="linkTabs">
        <button class="tab active" data-tab="links">لینک‌ها</button>
        <button class="tab" data-tab="qr">QRcode</button>
        <button class="tab" data-tab="sub">اشتراک (Subscription)</button>
        <button class="tab" data-tab="json">فایل JSON</button>
        <button class="tab" data-tab="info">جزئیات</button>
      </div>

      <div data-pane="links" class="stack">${linkRows || `<div class="empty">
        <span class="empty-icon">⚠</span><strong>کانفیگی ساخته نشد</strong>
        <p>هیچ سرور فعالی با ترکیب <code>${esc(user.protocol)}/${esc(user.network)}/${esc(user.security)}</code> سازگار نیست.
        کاربر را ویرایش کنید یا یک سرور هم‌خوان اضافه کنید.</p>
      </div>`}</div>

      <div data-pane="qr" class="stack hidden">
        <div class="row" style="justify-content:center;gap:8px">
          ${links.map((item, i) => `<button class="filter-chip ${i === 0 ? 'active' : ''}" data-action="qr-select" data-id="${esc(user.id)}" data-index="${i}">${esc(item.server)}</button>`).join('')}
          <button class="filter-chip" data-action="qr-select" data-id="${esc(user.id)}" data-index="-1">اشتراک</button>
        </div>
        <div class="qr-box" id="qrBox"><div class="skeleton" style="width:210px;height:210px"></div></div>
        <div class="row" style="justify-content:center">
          <button class="btn btn-sm" data-action="qr-download" data-id="${esc(user.id)}">⤓ دانلود تصویر</button>
        </div>
      </div>

      <div data-pane="sub" class="stack hidden">
        <div class="note">این نشانی را به کاربر بدهید تا در اپلیکیشن خود «اشتراک» اضافه کند؛ با هر تغییر در پنل، کانفیگ‌ها خودکار به‌روز می‌شوند.</div>
        <div class="link-row">
          <div>
            <div class="link-head"><span class="chip chip-blue">Subscription URL</span><span class="chip chip-mute">بدون نیاز به لاگین</span></div>
            <code id="subUrlCode">${esc(subUrl)}</code>
          </div>
          <div class="link-actions">
            <button class="btn btn-sm" data-action="copy" data-copy-text="${esc(subUrl)}">کپی</button>
            <button class="btn btn-sm" data-action="open-tab" data-href="${esc(subUrl)}">باز کردن</button>
          </div>
        </div>
        <div class="row">
          <button class="btn btn-sm" data-action="sub-base64" data-id="${esc(user.id)}">کپی نسخهٔ base64</button>
          <button class="btn btn-sm" data-action="sub-plain" data-id="${esc(user.id)}">کپی لینک‌های ساده</button>
          <button class="btn btn-sm" data-action="qr-select" data-id="${esc(user.id)}" data-index="-1">QR اشتراک</button>
        </div>
      </div>

      <div data-pane="json" class="stack hidden">
        <div class="note">فایل کامل کانفیگ برای وارد کردن در v2rayN / Nekoray (Import from clipboard).</div>
        <pre class="log" id="jsonPane" style="max-height:280px">در حال آماده‌سازی…</pre>
        <div class="row">
          <button class="btn btn-sm" data-action="json-copy" data-id="${esc(user.id)}">کپی JSON</button>
          <button class="btn btn-sm" data-action="json-download" data-id="${esc(user.id)}">⤓ دانلود فایل</button>
        </div>
      </div>

      <div data-pane="info" class="stack hidden">
        <div class="kv">
          <div class="kv-row"><span>نام کاربری</span><strong>${esc(user.username)}</strong></div>
          <div class="kv-row"><span>UUID / رمز</span><strong>${esc(user.uuid_key)}</strong></div>
          <div class="kv-row"><span>وضعیت</span><strong><span class="chip badge-status ${esc(user.status)}">${esc(STATUS_LABEL[user.status] || user.status)}</span></strong></div>
          <div class="kv-row"><span>مصرف / سقف</span><strong>${formatBytes(user.data_used)} از ${user.data_limit ? formatBytes(user.data_limit) : 'نامحدود'}</strong></div>
          <div class="kv-row"><span>تاریخ انقضا</span><strong>${esc(jalaliDate(user.expire_date, true))}</strong></div>
          <div class="kv-row"><span>تاریخ ساخت</span><strong>${esc(jalaliDate(user.created_at, true))}</strong></div>
          <div class="kv-row"><span>آخرین اتصال</span><strong>${esc(timeAgo(user.last_connected))}</strong></div>
        </div>
      </div>`,
    footer: `
      <button class="btn" data-modal-close>بستن</button>
      <div class="spacer"></div>
      <button class="btn btn-sm" data-action="user-edit" data-id="${esc(user.id)}">✎ ویرایش کاربر</button>
      <button class="btn btn-primary btn-sm" data-action="copy" data-copy-text="${esc(links[0] ? links[0].link : subUrl)}">کپی اولین کانفیگ</button>`,
    onMount: (overlay) => {
      overlay.dataset.links = JSON.stringify(links.map((l) => l.link));
      overlay.dataset.subUrl = subUrl;
      overlay.dataset.userId = user.id;

      $$('#linkTabs .tab', overlay).forEach((tab) => tab.addEventListener('click', () => {
        $$('#linkTabs .tab', overlay).forEach((t) => t.classList.toggle('active', t === tab));
        $$('[data-pane]', overlay).forEach((pane) => pane.classList.toggle('hidden', pane.dataset.pane !== tab.dataset.tab));
        if (tab.dataset.tab === 'qr') loadQr(overlay, 0);
        if (tab.dataset.tab === 'json') loadJson(overlay);
      }));
    },
  });
}

async function loadQr(overlay, index) {
  const box = $('#qrBox', overlay);
  if (!box) return;
  box.innerHTML = '<div class="skeleton" style="width:210px;height:210px"></div>';
  const userId = overlay.dataset.userId;
  const url = index === -1
    ? `/api/users/${userId}/qrcode?content=subscription`
    : `/api/users/${userId}/qrcode?index=${index}`;
  try {
    const objectUrl = await apiBlob(url);
    activeObjectUrls.push(objectUrl);
    box.innerHTML = `<img src="${objectUrl}" alt="QR code" />`;
    box.dataset.current = objectUrl;
  } catch (err) {
    box.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`;
  }
}

async function loadJson(overlay) {
  const pane = $('#jsonPane', overlay);
  if (!pane || pane.dataset.loaded) return;
  try {
    const data = await api(`/api/users/${overlay.dataset.userId}/config.json`);
    pane.textContent = JSON.stringify(data, null, 2);
    pane.dataset.loaded = '1';
  } catch (err) {
    pane.textContent = `خطا: ${err.message}`;
  }
}

/* ------------------------------ servers ---------------------------- */
async function loadServers() {
  const data = await run('بارگذاری سرورها', () => api('/api/servers'));
  state.servers = (data && data.servers) || [];
  return state.servers;
}

async function renderServers() {
  const [data, detected] = await Promise.all([
    run('بارگذاری سرورها', () => api('/api/servers')),
    run('شناسایی این‌باندها', () => api('/api/servers/detect')),
  ]);
  state.servers = (data && data.servers) || [];
  const userCounts = (data && data.users_by_server) || {};
  const placeholders = (data && data.placeholder_addresses) || [];
  const newInbounds = (detected && detected.new) || [];

  const cards = state.servers.map((s) => `
    <div class="card server-card">
      <div class="server-head">
        <div class="stat-icon" style="width:38px;height:38px;border-radius:12px">${s.is_default ? '★' : '⛁'}</div>
        <div>
          <strong>${esc(s.server_name)}</strong>
          <div class="row" style="gap:5px;margin-top:3px">
            <span class="chip chip-accent">${esc(PROTOCOL_LABEL[s.protocol] || s.protocol)}</span>
            <span class="chip">${esc(NETWORK_LABEL[s.network] || s.network)}</span>
            <span class="chip ${s.security === 'reality' ? 'chip-violet' : s.security === 'tls' ? 'chip-blue' : 'chip-mute'}">${esc(SECURITY_LABEL[s.security] || s.security)}</span>
            ${s.is_default ? '<span class="chip chip-warn">پیش‌فرض</span>' : ''}
            ${s.is_enabled ? '' : '<span class="chip chip-danger">غیرفعال</span>'}
          </div>
        </div>
      </div>

      <div class="server-addr">${esc(s.server_address)}:${esc(s.server_port)}${s.path && s.path !== '/' ? esc(s.path) : ''}${s.service_name ? '/' + esc(s.service_name) : ''}</div>

      ${(s.warnings || []).map((w) => `<div class="note warn" style="padding:9px 12px;font-size:12.2px">⚠ ${esc(w)}</div>`).join('')}

      <div class="kv">
        ${s.sni ? `<div class="kv-row"><span>SNI</span><strong>${esc(s.sni)}</strong></div>` : ''}
        ${s.security === 'reality' ? `<div class="kv-row"><span>کلید عمومی</span><strong style="font-size:11px">${esc(s.reality_public_key || '—')}</strong></div>
          <div class="kv-row"><span>Short ID</span><strong>${esc(s.reality_short_id || '—')}</strong></div>` : ''}
        <div class="kv-row"><span>تگ این‌باند</span><strong>${esc(s.inbound_tag || '—')}</strong></div>
      </div>

      <div class="row">
        <button class="btn btn-sm" data-action="server-edit" data-id="${esc(s.id)}">✎ ویرایش</button>
        ${s.is_default ? '' : `<button class="btn btn-sm" data-action="server-default" data-id="${esc(s.id)}">★ پیش‌فرض</button>`}
        ${s.security === 'reality' ? `<button class="btn btn-sm" data-action="server-keys" data-id="${esc(s.id)}">⚿ کلید جدید</button>` : ''}
        <div class="spacer" style="margin-inline-start:auto"></div>
        <span class="chip ${userCounts[s.id] ? 'chip-accent' : 'chip-warn'}">${num(userCounts[s.id] || 0)} کاربر سازگار</span>
        <button class="btn btn-sm btn-danger" data-action="server-delete" data-id="${esc(s.id)}">حذف</button>
      </div>
    </div>`).join('');

  viewRoot.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>سرورها و این‌باندها</h3>
          <p>هر سرور یک این‌باند در <code>xray/config.json</code> است که لینک‌ها بر اساس آن ساخته می‌شوند</p></div>
        <div class="spacer"></div>
        <button class="btn" data-action="server-import">⇪ شناسایی از config.json ${newInbounds.length ? `<span class="chip chip-accent">${num(newInbounds.length)} جدید</span>` : ''}</button>
        <button class="btn btn-primary" data-action="server-create">+ سرور جدید</button>
      </div>
      <div id="presetRow" class="row" style="margin-bottom:12px"></div>
      ${placeholders.length ? `<div class="note danger" style="margin-bottom:12px">
        <strong>آدرس سرور تنظیم نشده است:</strong> ${placeholders.map(esc).join('، ')} —
        تا وقتی آدرس واقعی (دامنه یا IP) وارد نشود، لینک‌های ساخته‌شده برای کاربران کار نمی‌کنند.
      </div>` : ''}
      <div class="note warn">
        هر کاربر فقط روی سروری کانفیگ می‌گیرد که <strong>پروتکل + انتقال + لایهٔ امنیتی</strong> یکسانی داشته باشد.
        برای TLS به گواهی معتبر (Let's Encrypt) نیاز دارید؛ گواهی خودامضای فعلی فقط برای تست است.
      </div>
    </div>
    <div class="grid grid-3">${cards || `<div class="card"><div class="empty">
      <span class="empty-icon">⛁</span><strong>سروری ثبت نشده</strong>
      <p>یکی از الگوهای آمادهٔ بالا را انتخاب کنید (بدون دامنه: REALITY).</p>
      <button class="btn btn-primary" data-action="server-preset" data-preset="reality-no-domain">+ سرور REALITY بدون دامنه</button>
    </div></div>`}
    </div>`;

  loadPresets();
}

async function loadPresets() {
  const row = $('#presetRow');
  if (!row) return;
  const data = await run('دریافت الگوها', () => api('/api/servers/presets?with_keys=false'));
  const presets = (data && data.presets) || [];
  row.innerHTML = `
    <span class="chip chip-mute">الگوهای آماده:</span>
    ${presets.map((p) => `<button class="filter-chip ${p.requires_domain ? '' : 'active'}"
        data-action="server-preset" data-preset="${esc(p.id)}" title="${esc(p.hint)}">
        ${esc(p.label)}${p.requires_domain ? ' <small style="opacity:.65">(با دامنه)</small>' : ''}</button>`).join('')}`;
}

function serverFormHtml(server = {}) {
  const m = state.meta || {};
  const isEdit = Boolean(server.id);
  const opt = (list, current, labels = {}) => list.map((key) =>
    `<option value="${esc(key)}" ${String(current || '') === key ? 'selected' : ''}>${esc(labels[key] || key)}</option>`).join('');

  return `<form id="serverForm" class="stack">
    <div class="form-grid">
      <label class="field"><span>نام سرور *</span>
        <input type="text" name="server_name" required value="${esc(server.server_name || '')}" placeholder="مثلاً VLESS-WS-8443" /></label>
      <label class="field"><span>آدرس (دامنه یا IP) *</span>
        <input type="text" name="server_address" required value="${esc(server.server_address || '')}" placeholder="vpn.example.com" style="direction:ltr" /></label>
      <label class="field"><span>پورت</span>
        <input type="number" name="server_port" min="1" max="65535" value="${esc(server.server_port || 443)}" /></label>
      <label class="field"><span>تگ این‌باند در config.json</span>
        <input type="text" name="inbound_tag" value="${esc(server.inbound_tag || '')}" placeholder="VLESS-WS-8443" style="direction:ltr" />
        <small class="hint">اگر خالی باشد، پنل بر اساس پورت و پروتکل این‌باند را پیدا می‌کند</small></label>
      <label class="field"><span>پروتکل</span>
        <select name="protocol">${opt(m.protocols || ['vless'], server.protocol || 'vless', PROTOCOL_LABEL)}</select></label>
      <label class="field"><span>انتقال</span>
        <select name="network">${opt(m.networks || ['ws'], server.network || 'ws', NETWORK_LABEL)}</select></label>
      <label class="field"><span>لایهٔ امنیتی</span>
        <select name="security">${opt(m.securities || ['tls'], server.security || 'tls', SECURITY_LABEL)}</select></label>
      <label class="field"><span>SNI / دامنهٔ گواهی</span>
        <input type="text" name="sni" value="${esc(server.sni || '')}" placeholder="vpn.example.com" style="direction:ltr" /></label>
      <label class="field" data-need="ws h2 httpupgrade"><span>مسیر (path)</span>
        <input type="text" name="path" value="${esc(server.path || '/')}" placeholder="/v2box-ws" style="direction:ltr" /></label>
      <label class="field" data-need="ws h2 httpupgrade"><span>Host هدر</span>
        <input type="text" name="host" value="${esc(server.host || '')}" placeholder="خالی = همان SNI" style="direction:ltr" /></label>
      <label class="field" data-need="grpc"><span>serviceName (gRPC)</span>
        <input type="text" name="service_name" value="${esc(server.service_name || '')}" placeholder="v2box-grpc" style="direction:ltr" /></label>
      <label class="field" data-need-sec="reality"><span>کلید عمومی REALITY</span>
        <input type="text" name="reality_public_key" value="${esc(server.reality_public_key || '')}" style="direction:ltr" /></label>
      <label class="field" data-need-sec="reality"><span>کلید خصوصی REALITY</span>
        <input type="text" name="reality_private_key" value="${esc(server.reality_private_key || '')}" style="direction:ltr" placeholder="خالی = تولید خودکار" /></label>
      <label class="field" data-need-sec="reality"><span>Short ID</span>
        <input type="text" name="reality_short_id" value="${esc(server.reality_short_id || '')}" style="direction:ltr" /></label>
      <label class="field" data-need-sec="reality"><span>dest (سایت مقصد)</span>
        <input type="text" name="reality_target" value="${esc(server.reality_target || 'www.microsoft.com:443')}" style="direction:ltr" /></label>
      <label class="field full" data-need-sec="reality"><span>serverNames (با کاما جدا کنید)</span>
        <input type="text" name="reality_server_names" value="${esc(server.reality_server_names || '')}" placeholder="www.microsoft.com,www.apple.com" style="direction:ltr" /></label>
      <label class="field" data-need-proto="shadowsocks"><span>روش رمزنگاری</span>
        <select name="method">${opt(m.ciphers || ['chacha20-ietf-poly1305'], server.method || 'chacha20-ietf-poly1305')}</select></label>
      <div class="field full">
        <span>وضعیت</span>
        <div class="row">
          <label class="switch-row"><label class="switch"><input type="checkbox" name="is_enabled" ${server.is_enabled === false ? '' : 'checked'} /><i></i></label>
            <span style="color:var(--muted);font-size:12.6px">فعال</span></label>
          <label class="switch-row"><label class="switch"><input type="checkbox" name="is_default" ${server.is_default ? 'checked' : ''} /><i></i></label>
            <span style="color:var(--muted);font-size:12.6px">سرور پیش‌فرض</span></label>
        </div>
      </div>
    </div>
  </form>`;
}

function openServerModal(server = null, preset = null) {
  const isEdit = Boolean(server);
  const seed = isEdit ? server : { ...(preset ? preset.values : {}), ...(server || {}) };
  openModal({
    title: isEdit ? `ویرایش سرور «${server.server_name}»`
      : (preset ? `الگوی «${preset.label}»` : 'سرور / این‌باند جدید'),
    subtitle: preset ? preset.hint
      : (state.meta && state.meta.builder_only
        ? 'در حالت کانفیگ‌ساز فقط لینک‌ها بر اساس این سرور ساخته می‌شوند'
        : 'پس از ذخیره، config.json بازنویسی و هسته ری‌استارت می‌شود'),
    size: 'wide',
    body: (preset && preset.values.security === 'reality' && preset.values.reality_public_key ? `
      <div class="note">کلیدهای REALITY به‌صورت خودکار ساخته شدند — بعد از ذخیره از کارت سرور کپی کنید.
        <div class="row" style="margin-top:8px">
          <button class="btn btn-sm" data-action="copy" data-copy-text="${esc(preset.values.reality_public_key)}">کپی Public Key</button>
          <button class="btn btn-sm" data-action="copy" data-copy-text="${esc(preset.values.reality_private_key)}">کپی Private Key</button>
          <button class="btn btn-sm" data-action="copy" data-copy-text="${esc(preset.values.reality_short_id)}">کپی Short ID</button>
        </div>
      </div>` : '') + (preset && preset.requires_domain ? `
      <div class="note warn">این الگو به <strong>دامنه و گواهی معتبر</strong> نیاز دارد.
        اگر دامنه ندارید، الگوی «REALITY — بدون دامنه» را انتخاب کنید.</div>` : '') + serverFormHtml(seed),
    footer: `<button class="btn" data-modal-close>انصراف</button><div class="spacer"></div>
      <button class="btn btn-primary" id="saveServer">${isEdit ? 'ذخیرهٔ تغییرات' : 'افزودن سرور'}</button>`,
    onMount: (overlay) => {
      const sync = () => {
        const network = $('select[name="network"]', overlay).value;
        const security = $('select[name="security"]', overlay).value;
        const protocol = $('select[name="protocol"]', overlay).value;
        $$('[data-need]', overlay).forEach((f) => f.classList.toggle('hidden', !f.dataset.need.split(' ').includes(network)));
        $$('[data-need-sec]', overlay).forEach((f) => f.classList.toggle('hidden', f.dataset.needSec !== security));
        $$('[data-need-proto]', overlay).forEach((f) => f.classList.toggle('hidden', f.dataset.needProto !== protocol));
      };
      $$('select', overlay).forEach((s) => s.addEventListener('change', sync));
      const addressInput = $('input[name="server_address"]', overlay);
      const ipWarn = () => {
        let box = $('#ipWarning', overlay);
        const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test((addressInput.value || '').trim())
          || /^\[?[0-9a-f:]+\]?$/i.test((addressInput.value || '').trim());
        const tls = $('select[name="security"]', overlay).value === 'tls';
        if (isIp && tls) {
          if (!box) {
            box = document.createElement('div');
            box.id = 'ipWarning';
            box.className = 'note danger';
            addressInput.closest('.field').after(box);
          }
          box.textContent = '⚠ آدرس IP با TLS کار نمی‌کند: گواهی معتبر فقط برای دامنه صادر می‌شود. ' +
            'لایهٔ امنیتی را روی REALITY بگذارید (بدون دامنه و بدون گواهی).';
        } else if (box) {
          box.remove();
        }
      };
      addressInput.addEventListener('input', ipWarn);
      $$('select', overlay).forEach((s) => s.addEventListener('change', ipWarn));
      sync();
      ipWarn();
      $('#saveServer', overlay).addEventListener('click', () => saveServer(server));
    },
  });
}

async function saveServer(existing) {
  const form = $('#serverForm');
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    ...data,
    server_port: Number(data.server_port || 443),
    is_enabled: form.querySelector('[name="is_enabled"]').checked,
    is_default: form.querySelector('[name="is_default"]').checked,
  };
  const button = $('#saveServer');
  button.disabled = true;
  const result = existing
    ? await run('ویرایش سرور', () => api(`/api/servers/${existing.id}`, { method: 'PUT', body: payload }))
    : await run('افزودن سرور', () => api('/api/servers', { method: 'POST', body: payload }));
  button.disabled = false;
  if (!result) return;
  closeModal();
  toast(existing ? 'سرور به‌روزرسانی شد' : 'سرور افزوده شد');
  reportXray(result.xray);
  await loadServers();
  await renderServers();
}

/* ------------------------------- xray ------------------------------ */
async function refreshCoreChip() {
  try {
    const status = await api('/api/xray/status');
    state.xray.status = status;
    const running = status.container && status.container.running;
    const dot = $('#coreChip .dot');
    dot.className = `dot ${running ? 'dot-running' : status.container && status.container.available ? 'dot-stopped' : 'dot-unknown'}`;
    $('#coreChipState').textContent = running ? 'در حال اجرا' : (status.container && status.container.state) || 'نامشخص';
    return status;
  } catch {
    $('#coreChipState').textContent = 'بدون دسترسی';
    return null;
  }
}

async function renderXray() {
  if (state.meta && state.meta.builder_only) {
    viewRoot.innerHTML = `
      <div class="card"><div class="empty">
        <span class="empty-icon">✦</span>
        <strong>حالت «کانفیگ‌ساز» فعال است</strong>
        <p>در این حالت پنل فقط کاربر و کانفیگ می‌سازد و کاری به هستهٔ Xray ندارد
        (نه <code>config.json</code> را تغییر می‌دهد، نه ری‌استارت می‌کند).<br />
        برای مدیریت هسته، سرویس‌ها را با <code>docker compose up -d</code> بالا بیاورید و
        <code>BUILDER_ONLY=false</code> را در <code>.env</code> بگذارید.</p>
        <button class="btn btn-primary" data-action="goto" data-view="users">ساخت کانفیگ</button>
      </div></div>`;
    return;
  }
  const [status, config] = await Promise.all([
    refreshCoreChip(),
    run('دریافت کانفیگ', () => api('/api/xray/config')),
  ]);
  state.xray.config = config;

  const inbounds = (config && config.summary && config.summary.inbounds) || [];
  const inboundRows = inbounds.map((i) => `
    <tr>
      <td><code>${esc(i.tag || '—')}</code></td>
      <td><span class="chip chip-accent">${esc(PROTOCOL_LABEL[i.protocol] || i.protocol)}</span></td>
      <td><code>${esc(i.port)}</code></td>
      <td>${esc(NETWORK_LABEL[i.network] || i.network)}</td>
      <td>${esc(SECURITY_LABEL[i.security] || i.security)}</td>
      <td>${i.path ? `<code>${esc(i.path)}</code>` : (i.service_name ? `<code>${esc(i.service_name)}</code>` : '—')}</td>
      <td style="text-align:center"><strong>${num(i.clients)}</strong></td>
    </tr>`).join('');

  const container = (status && status.container) || {};
  const cert = (status && status.certificate) || {};
  const certDays = cert.not_after
    ? Math.floor((new Date(cert.not_after) - Date.now()) / 86400000)
    : null;

  viewRoot.innerHTML = `
    <div class="grid grid-4">
      ${statCard('⛓', 'کانتینر xray', container.running ? 'در حال اجرا' : (container.state || 'نامشخص'),
        container.error ? esc(container.error) : `منبع: ${esc(container.source || '—')}`, container.running ? '' : 'danger')}
      ${statCard('⚙', 'نسخهٔ هسته', esc((status && status.version) ? String(status.version).split(' ')[0] : '—'),
        'docker ' + ((status && status.docker_available) ? 'در دسترس' : 'در دسترس نیست'), 'blue')}
      ${statCard('▤', 'اینباندها', num(inbounds.length), 'از فایل config.json', 'violet')}
      ${statCard('✓', 'اعتبار کانفیگ', config && config.summary && config.summary.ok ? 'معتبر' : 'خطا',
        esc((config && config.summary && config.summary.error) || config && config.path || ''), (config && config.summary && config.summary.ok) ? '' : 'warn')}
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>عملیات</h3><p>همگام‌سازی کاربران با هسته، تست و ری‌استارت</p></div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-action="xray-sync">↻ همگام‌سازی</button>
        <button class="btn btn-sm" data-action="xray-test">✓ تست کانفیگ</button>
        <button class="btn btn-sm btn-danger" data-action="xray-restart">⏻ ری‌استارت هسته</button>
      </div>
      <div class="table-wrap">
        <table class="data" style="min-width:720px">
          <thead><tr><th>تگ</th><th>پروتکل</th><th>پورت</th><th>انتقال</th><th>امنیت</th><th>مسیر / سرویس</th><th style="text-align:center">کلاینت</th></tr></thead>
          <tbody>${inboundRows || '<tr><td colspan="7"><div class="empty"><p>این‌باندی در کانفیگ نیست</p></div></td></tr>'}</tbody>
        </table>
      </div>

      <div class="divider" style="margin:14px 0"></div>
      <div class="kv">
        <div class="kv-row"><span>گواهی TLS</span>
          <strong>${cert.exists
            ? (cert.self_signed ? '<span class="chip chip-warn">خودامضا (فقط تست)</span>' : '<span class="chip chip-accent">نصب‌شده</span>')
            : '<span class="chip chip-danger">یافت نشد</span>'}</strong></div>
        ${cert.not_after ? `<div class="kv-row"><span>اعتبار گواهی تا</span>
          <strong>${esc(cert.not_after.slice(0, 10))}${certDays !== null ? ` (${toFa(certDays)} روز)` : ''}</strong></div>` : ''}
        <div class="kv-row"><span>مسیر گواهی</span><strong style="font-size:11.4px">${esc(cert.fullchain || '—')}</strong></div>
      </div>
      ${cert.self_signed ? `<div class="note warn" style="margin-top:12px">
        گواهی خودامضا باعث هشدار امنیتی در برخی کلاینت‌ها می‌شود. برای استفادهٔ واقعی، گواهی دامنهٔ خود
        (Let's Encrypt / acme.sh) را در پوشهٔ <code>certs/</code> با نام‌های <code>fullchain.pem</code> و
        <code>privkey.pem</code> قرار دهید و هسته را ری‌استارت کنید.
      </div>` : ''}
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>ویرایشگر config.json</h3><p>تغییرات با پشتیبان‌گیری خودکار ذخیره می‌شوند (۱۰ نسخهٔ آخر)</p></div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-action="config-format">مرتب‌سازی</button>
        <button class="btn btn-sm btn-primary" data-action="config-save">ذخیره و ری‌استارت</button>
      </div>
      <div id="configError" class="form-error hidden" style="margin-bottom:10px"></div>
      <textarea id="configEditor" class="mono json-editor" spellcheck="false">${esc(JSON.stringify((config && config.config) || {}, null, 2))}</textarea>
      <div class="row" style="margin-top:10px">
        <span class="chip chip-mute">مسیر: <code>${esc((config && config.path) || '')}</code></span>
        <span class="chip chip-mute">پشتیبان‌ها: <code>xray/backup/</code></span>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div><h3>لاگ هسته</h3><p>۲۰۰ خط آخر access log</p></div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-action="xray-logs">↻ بارگذاری لاگ</button>
      </div>
      <pre class="log" id="xrayLogPane">برای دیدن لاگ‌ها روی «بارگذاری لاگ» بزنید.</pre>
    </div>`;
}

/* ------------------------------- logs ------------------------------ */
async function renderLogs() {
  const data = await run('بارگذاری رویدادها', () => api('/api/audit?limit=200'));
  state.audit = (data && data.logs) || [];

  const rows = state.audit.map((log) => `
    <tr>
      <td><span class="chip">${esc(actionLabel(log.action))}</span></td>
      <td>${esc(log.actor || 'system')}</td>
      <td>${esc(log.target || '—')}</td>
      <td style="max-width:340px"><small style="color:var(--muted);font-size:11.8px">${esc(log.detail || '')}</small></td>
      <td style="white-space:nowrap"><small style="color:var(--muted-2)">${esc(jalaliDate(log.created_at, true))}</small></td>
    </tr>`).join('');

  viewRoot.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h3>رویدادهای پنل</h3><p>${num(state.audit.length)} رویداد آخر${data && data.total ? ` از ${num(data.total)}` : ''}</p></div>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-action="refresh">↻ تازه‌سازی</button>
        <button class="btn btn-sm" data-action="goto" data-view="xray">لاگ هسته</button>
      </div>
      <div class="table-wrap">
        <table class="data" style="min-width:760px">
          <thead><tr><th>رویداد</th><th>کاربر</th><th>هدف</th><th>جزئیات</th><th>زمان</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5"><div class="empty"><p>رویدادی ثبت نشده است.</p></div></td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

/* ----------------------------- settings ---------------------------- */
async function renderSettings() {
  const m = state.meta || {};
  viewRoot.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><div><h3>تغییر رمز عبور</h3><p>رمز مدیر پنل را به‌روزرسانی کنید</p></div></div>
        <form id="passwordForm" class="stack">
          <label class="field"><span>رمز فعلی</span>
            <input type="password" name="current_password" required autocomplete="current-password" /></label>
          <label class="field"><span>رمز جدید</span>
            <input type="password" name="new_password" required minlength="6" autocomplete="new-password" /></label>
          <label class="field"><span>تکرار رمز جدید</span>
            <input type="password" name="confirm_password" required minlength="6" autocomplete="new-password" /></label>
          <button class="btn btn-primary" type="submit">ذخیرهٔ رمز جدید</button>
        </form>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>اطلاعات پنل</h3><p>پیکربندی جاری بک‌اند</p></div></div>
        <div class="kv">
          <div class="kv-row"><span>نسخهٔ پنل</span><strong>2.0.0</strong></div>
          <div class="kv-row"><span>مدیر فعلی</span><strong>${esc((state.profile && state.profile.username) || '—')}</strong></div>
          <div class="kv-row"><span>آخرین ورود</span><strong>${esc(jalaliDate(state.profile && state.profile.last_login, true))}</strong></div>
          <div class="kv-row"><span>مسیر کانفیگ</span><strong style="font-size:11.4px">${esc(m.xray_config_path || '—')}</strong></div>
          <div class="kv-row"><span>فاصلهٔ همگام‌سازی</span><strong>${num(m.sync_interval || 60)} ثانیه</strong></div>
          <div class="kv-row"><span>اعتبار توکن</span><strong>${num(m.token_expire_hours || 24)} ساعت</strong></div>
          <div class="kv-row"><span>docker socket</span><strong>${m.docker ? '<span class="chip chip-accent">متصل</span>' : '<span class="chip chip-warn">بدون دسترسی</span>'}</strong></div>
          <div class="kv-row"><span>دادهٔ نمونه</span><strong>${m.demo_mode ? '<span class="chip chip-warn">فعال</span>' : '<span class="chip chip-mute">غیرفعال</span>'}</strong></div>
          <div class="kv-row"><span>شبیه‌ساز ترافیک</span><strong>${m.simulate_traffic ? '<span class="chip chip-warn">فعال</span>' : '<span class="chip chip-mute">غیرفعال</span>'}</strong></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>ظاهر</h3><p>تم روشن یا تاریک</p></div></div>
        <div class="row">
          <button class="btn ${state.theme === 'dark' ? 'btn-primary' : ''}" data-action="theme" data-value="dark">◐ تاریک</button>
          <button class="btn ${state.theme === 'light' ? 'btn-primary' : ''}" data-action="theme" data-value="light">◑ روشن</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><h3>نشانی اشتراک</h3><p>برای ارسال به کاربران</p></div></div>
        <div class="note">
          نشانی اشتراک هر کاربر به شکل <code>${esc(location.origin)}/sub/&lt;sub_id&gt;</code> است.
          اگر پنل پشت دامنهٔ دیگری است، متغیر <code>PUBLIC_DOMAIN</code> را در فایل <code>.env</code> تنظیم کنید تا
          لینک‌ها و QRcodeها با دامنهٔ درست ساخته شوند.
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-sm" data-action="copy" data-copy-text="${esc(location.origin)}">کپی نشانی پنل</button>
          <button class="btn btn-sm" data-action="open-tab" data-href="/docs">مستندات API</button>
        </div>
      </div>

      <div class="card" style="border-color:rgba(244,63,94,.3)">
        <div class="card-head"><div><h3>منطقهٔ خطر</h3><p>عملیات برگشت‌ناپذیر</p></div></div>
        <div class="row">
          <button class="btn btn-danger btn-sm" data-action="xray-sync-norestart">بازنویسی config.json بدون ری‌استارت</button>
          <button class="btn btn-danger btn-sm" data-action="logout">خروج از حساب</button>
        </div>
      </div>
    </div>`;

  const form = $('#passwordForm');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (data.new_password !== data.confirm_password) {
      toast('رمز جدید و تکرار آن یکسان نیستند', 'error');
      return;
    }
    const result = await run('تغییر رمز', () => api('/api/auth/change-password', {
      method: 'POST',
      body: { current_password: data.current_password, new_password: data.new_password },
    }));
    if (result) {
      toast('رمز عبور با موفقیت تغییر کرد');
      form.reset();
    }
  });
}

/* ============================ user actions ========================= */
function findUser(id) {
  return state.users.items.find((u) => u.id === id) || null;
}

function openMoreModal(id) {
  const user = findUser(id);
  if (!user) return;
  openModal({
    title: `عملیات بیشتر — ${user.username}`,
    size: 'narrow',
    body: `<div class="stack">
      <button class="btn" data-action="user-extend" data-id="${esc(user.id)}">⏱ تمدید / تغییر مدت اعتبار</button>
      <button class="btn" data-action="user-reset-traffic" data-id="${esc(user.id)}">↺ ریست شمارندهٔ ترافیک</button>
      <button class="btn" data-action="user-rotate" data-id="${esc(user.id)}">⚿ تغییر UUID (باطل کردن کانفیگ‌های قبلی)</button>
      <button class="btn" data-action="copy" data-copy-text="${esc(location.origin + '/sub/' + user.sub_id)}">⎘ کپی نشانی اشتراک</button>
      <button class="btn" data-action="open-tab" data-href="${esc('/share/' + user.sub_id)}">↗ صفحهٔ اشتراک کاربر</button>
      <button class="btn btn-danger" data-action="user-delete" data-id="${esc(user.id)}">✕ حذف کاربر</button>
    </div>`,
  });
}

function openExtendModal(id) {
  const user = findUser(id);
  if (!user) return;
  openModal({
    title: `تمدید «${user.username}»`,
    subtitle: user.expire_date ? `انقضای فعلی: ${jalaliDate(user.expire_date)}` : 'در حال حاضر بدون انقضا است',
    size: 'narrow',
    body: `<form id="extendForm" class="stack">
      <label class="field"><span>تعداد روز</span>
        <input type="number" name="days" value="30" min="-3650" max="3650" />
        <small class="hint">عدد مثبت = افزودن به اعتبار فعلی · منفی = کسر · صفر = نامحدود</small></label>
      <div class="row">
        ${[7, 30, 90, 180, 365].map((d) => `<button type="button" class="filter-chip" data-action="extend-set" data-value="${d}">${toFa(d)} روز</button>`).join('')}
        <button type="button" class="filter-chip" data-action="extend-set" data-value="0">نامحدود</button>
      </div>
    </form>`,
    footer: `<button class="btn" data-modal-close>انصراف</button><div class="spacer"></div>
      <button class="btn btn-primary" id="extendOk">اعمال</button>`,
    onMount: (overlay) => {
      $$('[data-action="extend-set"]', overlay).forEach((btn) => btn.addEventListener('click', () => {
        $('input[name="days"]', overlay).value = btn.dataset.value;
      }));
      $('#extendOk', overlay).addEventListener('click', async () => {
        const days = Number($('input[name="days"]', overlay).value || 0);
        const result = await run('تمدید کاربر', () => api(`/api/users/${id}/extend`, { method: 'POST', body: { days } }));
        if (!result) return;
        closeModal();
        toast(result.message || 'اعتبار به‌روزرسانی شد');
        reportXray(result.xray);
        await refreshUsers();
      });
    },
  });
}

function openBulkModal() {
  openModal({
    title: 'ساخت گروهی کاربران',
    subtitle: 'مثلاً user1 تا user20 با یک تنظیم مشترک',
    body: `<form id="bulkForm" class="stack">
      <div class="form-grid">
        <label class="field"><span>پیشوند نام</span><input type="text" name="prefix" value="user" /></label>
        <label class="field"><span>تعداد</span><input type="number" name="count" value="5" min="1" max="200" /></label>
        <label class="field"><span>پروتکل</span><select name="protocol">
          <option value="vless">VLESS</option><option value="vmess">VMess</option>
          <option value="trojan">Trojan</option><option value="shadowsocks">Shadowsocks</option></select></label>
        <label class="field"><span>انتقال</span><select name="network">
          <option value="ws">WebSocket</option><option value="tcp">TCP</option>
          <option value="grpc">gRPC</option><option value="h2">HTTP/2</option></select></label>
        <label class="field"><span>امنیت</span><select name="security">
          <option value="tls">TLS</option><option value="reality">REALITY</option><option value="none">بدون</option></select></label>
        <label class="field"><span>حجم (گیگابایت)</span><input type="number" name="data_limit" value="0" min="0" /></label>
        <label class="field"><span>اعتبار (روز)</span><input type="number" name="expire_days" value="30" min="0" /></label>
        <label class="field"><span>اتصال همزمان</span><input type="number" name="max_connections" value="2" min="1" /></label>
      </div>
      <div id="bulkResult"></div>
    </form>`,
    footer: `<button class="btn" data-modal-close>بستن</button><div class="spacer"></div>
      <button class="btn btn-primary" id="bulkOk">ساخت کاربران</button>`,
    onMount: (overlay) => {
      $('#bulkOk', overlay).addEventListener('click', async () => {
        const data = Object.fromEntries(new FormData($('#bulkForm', overlay)).entries());
        const payload = {
          prefix: data.prefix, count: Number(data.count), protocol: data.protocol, network: data.network,
          security: data.security, data_limit: Number(data.data_limit), expire_days: Number(data.expire_days),
          max_connections: Number(data.max_connections),
        };
        const button = $('#bulkOk', overlay);
        button.disabled = true;
        const result = await run('ساخت گروهی', () => api('/api/users/bulk', { method: 'POST', body: payload }));
        button.disabled = false;
        if (!result) return;
        reportXray(result.xray);
        toast(`${num(result.count)} کاربر ساخته شد`);
        $('#bulkResult', overlay).innerHTML = `
          <div class="note">کاربران ساخته‌شده: ${result.created.map((c) => `<code>${esc(c.username)}</code>`).join('، ')}
          ${result.skipped && result.skipped.length ? `<br />رد شده (تکراری): ${result.skipped.map(esc).join('، ')}` : ''}</div>`;
        await refreshUsers();
      });
    },
  });
}

/* ============================ event wiring ========================= */
document.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;
  const id = trigger.dataset.id;
  const value = trigger.dataset.value;

  switch (action) {
    case 'goto': setView(trigger.dataset.view); break;
    case 'refresh': render(); break;

    case 'filter-status':
      state.users.status = value; state.users.skip = 0; refreshUsers(); break;
    case 'filter-protocol':
      state.users.protocol = value; state.users.skip = 0; refreshUsers(); break;
    case 'page':
      state.users.skip = Number(value); refreshUsers(); break;

    case 'user-create': openUserModal(null); break;
    case 'bulk-modal': openBulkModal(); break;
    case 'user-edit': openUserModal(findUser(id) || await fetchUser(id)); break;
    case 'user-links': openLinksModal(id); break;
    case 'user-more': openMoreModal(id); break;
    case 'user-extend': openExtendModal(id); break;

    case 'user-toggle': {
      const result = await run('تغییر وضعیت', () => api(`/api/users/${id}/toggle`, { method: 'POST' }));
      if (result) { toast(result.message); reportXray(result.xray); refreshUsers(); }
      break;
    }
    case 'user-reset-traffic': {
      const result = await run('ریست ترافیک', () => api(`/api/users/${id}/reset-traffic`, { method: 'POST' }));
      if (result) { closeModal(); toast(result.message); reportXray(result.xray); refreshUsers(); }
      break;
    }
    case 'user-rotate':
      confirmDialog({
        title: 'تغییر UUID', danger: true, confirmText: 'تغییر بده',
        message: 'با تغییر UUID، تمام کانفیگ‌های قبلی این کاربر از کار می‌افتند و باید لینک جدید را برایش بفرستید. ادامه می‌دهید؟',
        onConfirm: async () => {
          const result = await run('تغییر UUID', () => api(`/api/users/${id}/rotate-uuid`, { method: 'POST' }));
          if (result) { closeModal(); toast(result.message); reportXray(result.xray); refreshUsers(); openLinksModal(id); }
        },
      });
      break;

    case 'user-delete':
      confirmDialog({
        title: 'حذف کاربر', danger: true, confirmText: 'حذف کن',
        message: `کاربر «${esc((findUser(id) || {}).username || '')}» به‌همراه کانفیگ‌ها و آمار ترافیک حذف می‌شود. این عملیات برگشت‌ناپذیر است.`,
        onConfirm: async () => {
          const result = await run('حذف کاربر', () => api(`/api/users/${id}`, { method: 'DELETE' }));
          if (result) { closeModal(); toast(result.message); reportXray(result.xray); refreshUsers(); }
        },
      });
      break;

    case 'qr': {
      const overlay = $('.modal-overlay');
      $$('#linkTabs .tab', overlay).forEach((t) => t.classList.toggle('active', t.dataset.tab === 'qr'));
      $$('[data-pane]', overlay).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== 'qr'));
      loadQr(overlay, Number(trigger.dataset.index || 0));
      break;
    }
    case 'qr-select': {
      const overlay = $('.modal-overlay');
      $$('[data-action="qr-select"]', overlay).forEach((b) => b.classList.toggle('active', b === trigger));
      loadQr(overlay, Number(trigger.dataset.index));
      break;
    }
    case 'qr-download': {
      const img = $('#qrBox img');
      if (!img) { toast('ابتدا QR را بسازید', 'warn'); break; }
      const a = document.createElement('a');
      a.href = img.src; a.download = `v2box-qr-${id}.png`; a.click();
      toast('دانلود شروع شد');
      break;
    }
    case 'json-copy': {
      const data = await run('دریافت JSON', () => api(`/api/users/${id}/config.json`));
      if (data) copyText(JSON.stringify(data, null, 2), 'JSON کپی شد');
      break;
    }
    case 'json-download': {
      const data = await run('دریافت JSON', () => api(`/api/users/${id}/config.json`));
      if (!data) break;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `v2box-${id}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      break;
    }
    case 'sub-base64': {
      const data = await run('دریافت اشتراک', () => api(`/api/users/${id}/subscription`));
      if (data) copyText(data.base64, 'اشتراک base64 کپی شد');
      break;
    }
    case 'sub-plain': {
      const data = await run('دریافت اشتراک', () => api(`/api/users/${id}/subscription`));
      if (data) copyText(data.plain, 'لینک‌ها کپی شدند');
      break;
    }

    case 'copy': {
      let text = trigger.dataset.copyText;
      if (!text && trigger.dataset.copyIndex !== undefined) {
        const overlay = $('.modal-overlay');
        const list = JSON.parse(overlay.dataset.links || '[]');
        text = list[Number(trigger.dataset.copyIndex)];
      }
      if (text) copyText(text);
      break;
    }
    case 'open-tab': window.open(trigger.dataset.href, '_blank', 'noopener'); break;

    case 'server-create': openServerModal(null); break;
    case 'server-preset': {
      const data = await run('دریافت الگو', () => api('/api/servers/presets'));
      const preset = ((data && data.presets) || []).find((p) => p.id === value || p.id === trigger.dataset.preset);
      if (!preset) { toast('الگو پیدا نشد', 'error'); break; }
      openServerModal(null, preset);
      break;
    }
    case 'server-edit': {
      const server = state.servers.find((s) => s.id === id);
      if (server) openServerModal(server);
      break;
    }
    case 'server-default': {
      const result = await run('تعیین پیش‌فرض', () => api(`/api/servers/${id}/set-default`, { method: 'POST' }));
      if (result) { toast(result.message); await loadServers(); renderServers(); }
      break;
    }
    case 'server-keys':
      confirmDialog({
        title: 'ساخت کلید REALITY', danger: true, confirmText: 'کلید جدید بساز',
        message: 'کلیدهای REALITY این سرور تغییر می‌کنند؛ کانفیگ‌های قبلی دیگر کار نخواهند کرد و باید دوباره برای کاربران ارسال شوند.',
        onConfirm: async () => {
          const result = await run('ساخت کلید', () => api(`/api/servers/${id}/reality-keys`, { method: 'POST' }));
          if (result) {
            closeModal();
            toast('کلیدهای جدید ساخته شد');
            reportXray(result.xray);
            openModal({
              title: 'کلیدهای REALITY',
              subtitle: 'این مقادیر را ذخیره کنید',
              size: 'narrow',
              body: `<div class="stack">
                <div class="link-row"><div><div class="link-head"><span class="chip chip-violet">Public Key</span></div><code>${esc(result.public_key)}</code></div>
                  <div class="link-actions"><button class="btn btn-sm" data-action="copy" data-copy-text="${esc(result.public_key)}">کپی</button></div></div>
                <div class="link-row"><div><div class="link-head"><span class="chip chip-danger">Private Key</span></div><code>${esc(result.private_key)}</code></div>
                  <div class="link-actions"><button class="btn btn-sm" data-action="copy" data-copy-text="${esc(result.private_key)}">کپی</button></div></div>
                <div class="link-row"><div><div class="link-head"><span class="chip">Short ID</span></div><code>${esc(result.short_id)}</code></div>
                  <div class="link-actions"><button class="btn btn-sm" data-action="copy" data-copy-text="${esc(result.short_id)}">کپی</button></div></div>
              </div>`,
            });
            await loadServers();
            renderServers();
          }
        },
      });
      break;
    case 'server-delete':
      confirmDialog({
        title: 'حذف سرور', danger: true, confirmText: 'حذف کن',
        message: 'این سرور از پنل حذف می‌شود (این‌باند در config.json باقی می‌ماند ولی دیگر لینکی برایش ساخته نمی‌شود).',
        onConfirm: async () => {
          const result = await run('حذف سرور', () => api(`/api/servers/${id}`, { method: 'DELETE' }));
          if (result) { closeModal(); toast(result.message); await loadServers(); renderServers(); }
        },
      });
      break;
    case 'server-import': {
      const address = window.prompt('آدرس (دامنه یا IP) سرور برای لینک‌ها — می‌توانید خالی بگذارید:', '');
      const result = await run('شناسایی این‌باندها', () => api('/api/servers/import', {
        method: 'POST', body: { address: address || null },
      }));
      if (result) { toast(result.message); await loadServers(); renderServers(); }
      break;
    }

    case 'xray-sync':
    case 'xray-sync-norestart': {
      const restart = action === 'xray-sync';
      toast('در حال همگام‌سازی با هسته…', 'info');
      const result = await run('همگام‌سازی', () => api(`/api/xray/sync?restart=${restart}`, { method: 'POST' }));
      if (result) {
        toast(`${num(result.pushed_users)} کاربر در کانفیگ ثبت شد` + (result.changed ? ' — هسته به‌روزرسانی شد' : ' — تغییری لازم نبود'),
          result.restart && result.restart.ok === false ? 'warn' : 'success',
          result.restart && !result.restart.ok ? result.restart.message : '');
        if (state.view === 'xray') renderXray(); else refreshCoreChip();
      }
      break;
    }
    case 'xray-restart':
      confirmDialog({
        title: 'ری‌استارت هسته', danger: true, confirmText: 'ری‌استارت کن',
        message: 'کانتینر xray-core ری‌استارت می‌شود؛ اتصال کاربران برای چند ثانیه قطع خواهد شد.',
        onConfirm: async () => {
          const result = await run('ری‌استارت', () => api('/api/xray/restart', { method: 'POST' }));
          if (result) { closeModal(); toast(result.message || 'هسته ری‌استارت شد', 'success', result.method); refreshCoreChip(); }
        },
      });
      break;
    case 'xray-test': {
      const result = await run('تست کانفیگ', () => api('/api/xray/test', { method: 'POST' }));
      if (!result) break;
      openModal({
        title: 'نتیجهٔ تست کانفیگ',
        size: 'narrow',
        body: `<div class="row" style="margin-bottom:10px">
            <span class="chip ${result.json_valid ? 'chip-accent' : 'chip-danger'}">JSON: ${result.json_valid ? 'معتبر' : 'نامعتبر'}</span>
            <span class="chip ${result.ok ? 'chip-accent' : 'chip-warn'}">xray -test: ${result.ok ? 'قبول شد' : 'رد شد'}</span>
          </div>
          <pre class="log">${esc(result.output || result.json_error || 'خروجی‌ای دریافت نشد')}</pre>`,
      });
      break;
    }
    case 'xray-logs': {
      const pane = $('#xrayLogPane');
      if (pane) pane.textContent = 'در حال دریافت…';
      const result = await run('دریافت لاگ', () => api('/api/xray/logs?lines=200'));
      if (pane && result) {
        pane.textContent = result.ok ? (result.lines.join('\n') || '— لاگ خالی است —') : (result.message || 'خطا');
        pane.scrollTop = pane.scrollHeight;
      }
      break;
    }
    case 'config-format': {
      const editor = $('#configEditor');
      try {
        editor.value = JSON.stringify(JSON.parse(editor.value), null, 2);
        $('#configError').classList.add('hidden');
        toast('کانفیگ مرتب شد');
      } catch (err) {
        showConfigError(`JSON نامعتبر: ${err.message}`);
      }
      break;
    }
    case 'config-save': {
      const editor = $('#configEditor');
      let parsed;
      try {
        parsed = JSON.parse(editor.value);
      } catch (err) {
        showConfigError(`JSON نامعتبر: ${err.message}`);
        return;
      }
      $('#configError').classList.add('hidden');
      trigger.disabled = true;
      const result = await run('ذخیرهٔ کانفیگ', () => api('/api/xray/config', { method: 'PUT', body: { config: parsed, restart: true } }));
      trigger.disabled = false;
      if (!result) break;
      const valid = result.test && result.test.ok;
      toast(result.message || 'ذخیره شد', valid === false ? 'warn' : 'success',
        valid === false ? (result.test.output || '').slice(0, 160) : '');
      renderXray();
      break;
    }

    case 'theme': setTheme(value); break;
    case 'logout': logout(true); break;
    default: break;
  }
});

function showConfigError(message) {
  const box = $('#configError');
  if (!box) return;
  box.textContent = message;
  box.classList.remove('hidden');
}

async function fetchUser(id) {
  const data = await run('دریافت کاربر', () => api(`/api/users/${id}`));
  return data ? data.user : null;
}

/* =========================== auth / shell ========================== */
function setTheme(theme) {
  state.theme = theme;
  document.body.classList.toggle('light', theme === 'light');
  localStorage.setItem('v2box_theme', theme);
}

function showLogin() {
  $('#appShell').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
  document.body.style.overflow = '';
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
}

function logout(notify) {
  state.token = '';
  localStorage.removeItem('v2box_token');
  closeModal();
  showLogin();
  if (notify) toast('از حساب خارج شدید', 'info');
}

function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebarBackdrop').classList.add('show');
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebarBackdrop').classList.remove('show');
}

async function boot() {
  setTheme(state.theme);

  // login form
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('#loginError');
    errorBox.classList.add('hidden');
    const button = $('#loginSubmit');
    button.disabled = true;
    button.textContent = 'در حال ورود…';
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { username: $('#loginUsername').value.trim(), password: $('#loginPassword').value },
      });
      state.token = data.access_token;
      localStorage.setItem('v2box_token', state.token);
      await afterLogin();
    } catch (err) {
      errorBox.textContent = err.message === 'Invalid credentials' ? 'نام کاربری یا رمز عبور اشتباه است' : err.message;
      errorBox.classList.remove('hidden');
    } finally {
      button.disabled = false;
      button.textContent = 'ورود به پنل';
    }
  });

  $('#togglePassword').addEventListener('click', () => {
    const input = $('#loginPassword');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('#logoutBtn').addEventListener('click', () => logout(true));
  $('#mobileMenu').addEventListener('click', openSidebar);
  $('#sidebarBackdrop').addEventListener('click', closeSidebar);
  $('#refreshBtn').addEventListener('click', () => render());
  $$('#primaryNav .nav-item').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeModal(); closeSidebar(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      const search = $('#userSearch');
      if (search) search.focus();
    }
  });

  if (state.token) {
    try {
      await afterLogin();
      return;
    } catch {
      logout(false);
    }
  }
  showLogin();
}

async function afterLogin() {
  const [profile, meta] = await Promise.all([api('/api/auth/me'), api('/api/meta')]);
  state.profile = profile;
  state.meta = meta;
  $('#userName').textContent = profile.username;
  $('#userAvatar').textContent = (profile.username || 'A').charAt(0).toUpperCase();
  $('#demoChip').classList.toggle('hidden', !meta.demo_mode);
  $('#builderChip').classList.toggle('hidden', !meta.builder_only);
  $('#navXray').classList.toggle('hidden', Boolean(meta.builder_only));
  if (meta.builder_only && state.view === 'xray') state.view = 'users';
  $('#demoChip').title = meta.simulate_traffic
    ? 'داده‌های نمونه + شبیه‌سازی رشد ترافیک (SIMULATE_TRAFFIC=true)'
    : 'کاربران و آمار اولیهٔ نمونه — با SEED_DEMO_DATA=false نصب تمیز داشته باشید';
  showApp();
  await loadServers();
  await Promise.all([refreshCoreChip(), refreshUserBadge()]);
  setView('dashboard');
  setInterval(refreshCoreChip, 30000);
}

boot();
