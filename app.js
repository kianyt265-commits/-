const faDigits = '۰۱۲۳۴۵۶۷۸۹';
const enDigits = '0123456789';
const toFa = (value) => String(value).replace(/[0-9]/g, (d) => faDigits[Number(d)]);
const num = (value, decimals = 0) => {
  const n = Number(value) || 0;
  return toFa(n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }));
};
const compact = (value) => {
  const n = Number(value) || 0;
  if (n >= 1000000) return toFa((n / 1000000).toFixed(1)) + ' میلیون';
  if (n >= 1000) return toFa((n / 1000).toFixed(n >= 10000 ? 0 : 1)) + ' هزار';
  return num(n);
};
const el = (selector) => document.querySelector(selector);
const root = el('#viewRoot');
const modalRoot = el('#modalRoot');
const toastRoot = el('#toastRoot');

const state = {
  view: 'overview',
  range: '۳۰',
  filter: 'همه',
  dark: localStorage.getItem('insight-dark') === 'true',
  sample: true,
  followers: 12480,
  postFrequency: 3,
  profile: { name: 'نیلوفر احمدی', username: 'niloofar.studio', niche: 'سبک زندگی و آموزش خلاقیت' }
};

const posts = [
  { id: 1, title: 'سه عادت کوچک برای صبح‌های پربازده', type: 'کاروسل', typeKey: 'carousel', date: '۲۳ آبان', likes: 1840, comments: 126, saves: 342, reach: 27400, rate: '۹.۸٪', thumb: 'one', best: true },
  { id: 2, title: 'پشت صحنه یک روز خلاقانه', type: 'ریلز', typeKey: 'reel', date: '۲۰ آبان', likes: 3260, comments: 198, saves: 501, reach: 41800, rate: '۸.۷٪', thumb: 'two', best: true },
  { id: 3, title: 'چطور با رنگ‌ها حس بسازیم؟', type: 'پست تصویری', typeKey: 'photo', date: '۱۸ آبان', likes: 1110, comments: 74, saves: 183, reach: 16800, rate: '۷.۱٪', thumb: 'three' },
  { id: 4, title: 'یک میز کار که حالتان را خوب می‌کند', type: 'کاروسل', typeKey: 'carousel', date: '۱۵ آبان', likes: 875, comments: 42, saves: 116, reach: 11200, rate: '۵.۴٪', thumb: 'four' },
  { id: 5, title: 'پرسش شما: از کجا شروع کنم؟', type: 'ریلز', typeKey: 'reel', date: '۱۲ آبان', likes: 680, comments: 31, saves: 68, reach: 9200, rate: '۴.۲٪', thumb: 'five' }
];

const viewNames = { overview: 'نمای کلی', posts: 'محتوا و پست‌ها', stories: 'عملکرد استوری', calendar: 'تقویم محتوا', audience: 'مخاطب‌شناسی', trends: 'رادار ترند', competitors: 'مقایسه رقبا' };

function iconStar() { return '<span class="sparkle">✦</span>'; }
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i></i><span>${message}</span>`;
  toastRoot.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function lineChart(range) {
  const datasets = {
    '۷': [11200, 11340, 11520, 11480, 11720, 11910, 12110],
    '۳۰': [10420, 10680, 10740, 10960, 11080, 11240, 11360, 11420, 11580, 11710, 11860, 12030, 12480],
    '۹۰': [7840, 8210, 8460, 8710, 9040, 9230, 9610, 10020, 10380, 10720, 11140, 11560, 11940, 12480]
  };
  const values = datasets[range] || datasets['۳۰'];
  const labels = range === '۷' ? ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'] : range === '۹۰' ? ['شهریور', 'مهر', 'آبان'] : ['۱ آبان', '۴ آبان', '۷ آبان', '۱۰ آبان', '۱۳ آبان', '۱۶ آبان', '۱۹ آبان', '۲۳ آبان'];
  const width = 620; const height = 190; const left = 12; const right = 11; const top = 12; const bottom = 25;
  const min = Math.min(...values) - (Math.max(...values) - Math.min(...values)) * .16;
  const max = Math.max(...values) + (Math.max(...values) - Math.min(...values)) * .12;
  const x = (i) => left + (i / (values.length - 1)) * (width - left - right);
  const y = (v) => top + (1 - (v - min) / (max - min)) * (height - top - bottom);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `${points.join(' ')} ${x(values.length - 1)},${height - bottom} ${x(0)},${height - bottom}`;
  let guides = '';
  for (let i = 0; i < 4; i += 1) {
    const gy = top + i * ((height - top - bottom) / 3);
    guides += `<line class="chart-grid-line" x1="${left}" x2="${width - right}" y1="${gy}" y2="${gy}"></line>`;
  }
  const labelIndexes = range === '۹۰' ? [0, 6, 13] : range === '۷' ? [0, 1, 2, 3, 4, 5, 6] : [0, 2, 4, 6, 8, 10, 12];
  let axis = '';
  labelIndexes.forEach((i, ix) => {
    if (!values[i]) return;
    axis += `<text class="chart-axis-label" x="${x(i)}" y="${height - 5}" text-anchor="middle">${labels[ix] || labels[labels.length - 1]}</text>`;
  });
  const pointsMarkup = values.map((v, i) => (i === values.length - 1 || i === Math.floor(values.length / 2) ? `<circle class="chart-point" cx="${x(i)}" cy="${y(v)}" r="4"></circle>` : '')).join('');
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="نمودار رشد دنبال‌کننده‌ها">
    <defs><linearGradient id="areaFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#a9dbb3" stop-opacity=".35"></stop><stop offset="1" stop-color="#a9dbb3" stop-opacity="0"></stop></linearGradient></defs>
    ${guides}<polygon class="chart-area" points="${area}"></polygon><polyline class="chart-line" points="${points.join(' ')}"></polyline>${pointsMarkup}${axis}
  </svg>`;
}

function forecastSvg() {
  return `<svg viewBox="0 0 310 80" preserveAspectRatio="none" aria-label="روند پیش‌بینی رشد"><defs><linearGradient id="forecastFade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#bfe984" stop-opacity=".23"></stop><stop offset="1" stop-color="#bfe984" stop-opacity="0"></stop></linearGradient></defs><polygon points="0,70 42,65 84,59 126,62 168,48 210,43 250,29 310,11 310,80 0,80"></polygon><path d="M0 70 C30 69 37 62 62 64 S99 60 125 62 S154 49 178 51 S208 45 228 41 S266 28 310 11"></path></svg>`;
}

function heatmap() {
  const days = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const levels = [1, 2, 1, 3, 2, 4, 3, 2, 1, 2, 3, 4, 3, 1, 2, 2, 3, 4, 4, 2, 1, 2, 3, 3, 4, 2, 1, 2, 3, 4, 3, 2, 1, 1, 2, 3, 4, 3, 2, 1, 1, 2, 2, 3, 3, 2, 1, 1, 2, 3, 4, 3, 2, 1, 1];
  let markup = '<div class="heatmap-grid"><span></span>' + days.map(d => `<span class="day">${d}</span>`).join('');
  ['۹', '۱۲', '۱۵', '۱۸', '۲۱'].forEach((t, row) => {
    markup += `<span class="time">${t}</span>`;
    for (let col = 0; col < 7; col += 1) markup += `<i class="heat-cell l${levels[row * 7 + col]}" title="فعالیت مخاطب در ساعت ${t}"></i>`;
  });
  return markup + '</div><div class="heatmap-legend"><span>کمتر</span><i></i><i></i><i></i><i></i><span>بیشتر</span></div>';
}

function metricCard(label, value, trend, note, spark, featured = false) {
  return `<article class="card metric-card ${featured ? 'featured' : ''}"><div class="metric-top"><span>${label}</span><span class="metric-help" title="این عدد نسبت به ۳۰ روز گذشته مقایسه شده است">؟</span></div><strong class="metric-number">${value}</strong><div class="metric-bottom"><span class="positive">↗ ${trend}</span><span>${note}</span></div>${spark ? `<svg class="mini-spark" viewBox="0 0 76 35" aria-hidden="true"><polyline points="1,29 12,25 20,27 32,18 42,22 53,11 63,15 75,3"></polyline></svg>` : ''}</article>`;
}

function renderOverview() {
  return `<section class="dashboard-view">
    <div class="page-intro">
      <div><div class="eyebrow"><span class="eyebrow-dot"></span> گزارش عملکرد امروز <span class="muted">•</span> پنجشنبه ۲۴ آبان</div><h1>سلام نیلوفر، وقتشه پیجت <span>بدرخشه.</span></h1><p>از بینش‌های واقعی، تصمیم‌های ساده بساز. اینجا مهم‌ترین اتفاق‌های صفحه‌ات را یک‌جا می‌بینی.</p></div>
      <div class="hero-actions"><button class="btn btn-soft" data-action="open-data">＋ اتصال داده‌های من</button><button class="btn btn-primary" data-action="generate-idea">✦ پیشنهاد تازه</button></div>
    </div>
    <div class="sample-notice"><span class="notice-icon">✦</span><span><strong>${state.sample ? 'در حال تماشای داده‌های نمونه هستید.' : 'تحلیل صفحه با داده‌های واردشده انجام شد.'}</strong> ${state.sample ? 'اعداد با الگوی واقعی صفحات سبک زندگی شبیه‌سازی شده‌اند تا ابزار را راحت امتحان کنید.' : 'اعداد جدید شما ذخیره شده‌اند و از اینجا به بعد با داده‌های اختصاصی به‌روزرسانی می‌شوند.'}</span><button class="notice-action" data-action="open-data">${state.sample ? 'جایگزین کردن با داده من' : 'ویرایش اطلاعات'}</button></div>
    <div class="kpi-grid">
      ${metricCard('دنبال‌کننده‌ها', compact(state.followers), '۸٫۴٪', 'در ۳۰ روز گذشته', true, true)}
      ${metricCard('نرخ تعامل', '۷٫۸٪', '۱٫۲٪', 'بالاتر از میانگین حوزه', true)}
      ${metricCard('میانگین دسترسی', compact(18700), '۱۴٫۶٪', 'برای هر محتوا', true)}
      ${metricCard('ذخیره به ازای پست', num(128), '۲۲٫۳٪', 'نشانه محتوای مفید', true)}
    </div>
    <div class="grid-main">
      <article class="card chart-card"><div class="chart-head"><div><h2>روند رشد دنبال‌کننده‌ها</h2><p>مسیر رشد صفحه در بازه انتخابی</p></div><div class="range-tabs" data-range-tabs><button class="${state.range === '۷' ? 'active' : ''}" data-range="۷">۷ روز</button><button class="${state.range === '۳۰' ? 'active' : ''}" data-range="۳۰">۳۰ روز</button><button class="${state.range === '۹۰' ? 'active' : ''}" data-range="۹۰">۹۰ روز</button></div></div>${lineChart(state.range)}<div class="chart-legend"><span class="legend-item"><i class="legend-swatch"></i> دنبال‌کننده واقعی</span><span class="legend-item"><i class="legend-swatch faded"></i> میانگین صفحات مشابه</span></div></article>
      <article class="card forecast-card"><div class="section-heading"><div><h2>پیش‌بینی رشد</h2><p>بر اساس روند ۳۰ روز اخیر</p></div><span class="forecast-status"><i></i> پایدار</span></div><div class="forecast-main"><div class="forecast-big" id="forecastValue">${compact(14120)}<small>دنبال‌کننده تا ۹۰ روز آینده</small></div><span class="forecast-gain" id="forecastGain">+۱۳٫۱٪</span></div><div class="forecast-chart">${forecastSvg()}</div><div class="forecast-dates"><span>امروز</span><span>۳۰ روز</span><span>۹۰ روز</span></div><div class="forecast-control"><div><span>اگر هفته‌ای پست بگذاری</span><strong id="forecastPercent">${toFa(state.postFrequency)} بار</strong></div><input id="forecastSlider" class="forecast-slider" type="range" min="۲" max="۷" value="${state.postFrequency}" /><div class="slider-notes"><span>کمتر</span><span>پیشنهاد ما: ۵ بار</span><span>بیشتر</span></div></div></article>
    </div>
    <div class="grid-secondary">
      <article class="card secondary-card"><div class="section-heading"><div><h2>عملکرد بر اساس نوع محتوا</h2><p>نرخ تعامل میان فرمت‌ها</p></div><button class="text-link" data-view="posts">جزئیات ←</button></div><div class="bar-chart"><div class="bar-column"><span class="bar-value">۹٫۸٪</span><div class="bar-track"><i class="bar-fill" style="height:88%"></i></div><span class="bar-label">کاروسل</span></div><div class="bar-column"><span class="bar-value">۸٫۷٪</span><div class="bar-track"><i class="bar-fill" style="height:77%"></i></div><span class="bar-label">ریلز</span></div><div class="bar-column"><span class="bar-value">۷٫۱٪</span><div class="bar-track"><i class="bar-fill" style="height:63%"></i></div><span class="bar-label">تصویر</span></div><div class="bar-column"><span class="bar-value">۵٫۴٪</span><div class="bar-track"><i class="bar-fill" style="height:49%"></i></div><span class="bar-label">استوری</span></div><div class="bar-column"><span class="bar-value">۴٫۲٪</span><div class="bar-track"><i class="bar-fill" style="height:38%"></i></div><span class="bar-label">لایو</span></div></div></article>
      <article class="card secondary-card"><div class="section-heading"><div><h2>بهترین زمان انتشار</h2><p>ساعت‌های فعال بودن مخاطب‌ها</p></div><span class="metric-help" title="هرچه رنگ خانه پررنگ‌تر باشد، مخاطب فعال‌تری دارید">؟</span></div><div class="heatmap-wrap">${heatmap()}</div><div class="best-time"><span class="best-time-icon">◷</span><span>بهترین فرصت شما: <strong>سه‌شنبه، ساعت ۱۸</strong></span></div></article>
      <article class="card secondary-card insight-card"><span class="sparkle">✦</span><div class="eyebrow">بینش این هفته</div><h2>کاروسل‌هایت ۲٫۱ برابر بیشتر ذخیره می‌شوند.</h2><p>مخاطب تو دنبال محتوای کاربردی است. این هفته یک مجموعه «قدم‌به‌قدم» منتشر کن.</p><button class="btn" data-action="generate-idea">ساخت ایده بر اساس این بینش ←</button></article>
    </div>
    <div class="lower-grid"><article class="card posts-card"><div class="section-heading"><div><h2>بهترین محتواها</h2><p>محتواهایی که بیشترین اثر را گذاشته‌اند</p></div><button class="text-link" data-view="posts">مشاهده همه ←</button></div><table class="post-table"><thead><tr><th>محتوا</th><th>نوع</th><th>دسترسی</th><th>تعامل</th><th>ذخیره</th></tr></thead><tbody>${posts.slice(0, 4).map(postRow).join('')}</tbody></table></article>
      <article class="card activity-card"><div class="section-heading"><div><h2>ریتم رشد تو</h2><p>یک قدم کوچک، هر روز</p></div><span title="روزهای پیوسته فعالیت">✦</span></div><div class="streak-box"><div class="streak-number">۷</div><div class="streak-copy"><strong>روز پشت سر هم فعال بودی!</strong><span>فقط ۳ روز تا نشان بعدی</span></div><span class="fire">♨</span></div><div class="activity-list"><div class="activity-item"><span class="activity-icon">✓</span><p>پیشنهاد زمان انتشار را فعال کردی<small>امروز، ۱۰:۲۴</small></p></div><div class="activity-item"><span class="activity-icon">↗</span><p>ریلزت از میانگین بهتر عمل کرد<small>دیروز، ۱۹:۴۰</small></p></div><div class="activity-item"><span class="activity-icon">✦</span><p>یک نشان تازه به دست آوردی<small>۲ روز پیش</small></p></div></div></article></div>
  </section>`;
}

function postRow(post) {
  return `<tr data-post="${post.id}"><td><div class="post-info"><span class="post-thumb thumb-${post.thumb}"></span><span class="post-copy"><strong>${post.title}</strong><small>${post.date}  •  ${post.likes > 2000 ? 'درخشان' : 'خوب'}</small></span></div></td><td><span class="content-type"><i class="type-dot ${post.typeKey}"></i>${post.type}</span></td><td class="strong-number">${compact(post.reach)}</td><td><span class="engagement-pill">${post.rate}</span></td><td>${num(post.saves)}</td></tr>`;
}

function renderPosts() {
  const filtered = state.filter === 'همه' ? posts : posts.filter((p) => p.type === state.filter || (state.filter === 'تصویر' && p.type === 'پست تصویری'));
  return `<section class="inner-view"><div class="view-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> آزمایشگاه محتوا</div><h1>محتواهایی که <span>نتیجه می‌سازند.</span></h1><p>فرمت برنده صفحه‌ات را پیدا کن، جزئیات هر محتوا را ببین و ایده بعدی را با اطمینان انتخاب کن.</p></div><div class="view-actions"><button class="btn btn-soft" data-action="open-report">↓ گزارش عملکرد</button><button class="btn btn-primary" data-action="generate-idea">✦ ساخت ایده پست</button></div></div><div class="stats-row"><div class="card simple-stat"><span class="simple-stat-label">محتوای منتشرشده</span><strong class="simple-stat-value">۲۴</strong><span class="simple-stat-note">↗ ۴ محتوای بیشتر</span></div><div class="card simple-stat"><span class="simple-stat-label">فرمت برنده</span><strong class="simple-stat-value">کاروسل</strong><span class="simple-stat-note">۹٫۸٪ نرخ تعامل</span></div><div class="card simple-stat"><span class="simple-stat-label">بیشترین دسترسی</span><strong class="simple-stat-value">۴۱٫۸ هزار</strong><span class="simple-stat-note">ریلز «پشت صحنه»</span></div><div class="card simple-stat"><span class="simple-stat-label">امتیاز محتوایی</span><strong class="simple-stat-value">۸۶ <small>/۱۰۰</small></strong><span class="simple-stat-note">✦ عالی و رو به رشد</span></div></div><div class="card posts-card"><div class="section-heading"><div><h2>همه محتواها</h2><p>برای دیدن جزئیات روی هر کارت بزن</p></div><div class="filter-tabs"><button class="${state.filter === 'همه' ? 'active' : ''}" data-filter="همه">همه</button><button class="${state.filter === 'ریلز' ? 'active' : ''}" data-filter="ریلز">ریلز</button><button class="${state.filter === 'کاروسل' ? 'active' : ''}" data-filter="کاروسل">کاروسل</button><button class="${state.filter === 'تصویر' ? 'active' : ''}" data-filter="تصویر">تصویر</button></div></div><div class="post-grid">${filtered.map((p) => `<article class="card post-grid-card" data-post="${p.id}"><div class="big-thumb ${p.thumb}"><div class="thumb-overlay"><span>${p.type}</span><strong>امتیاز ${p.rate}</strong></div></div><div class="post-score"><h3>${p.title}</h3><div class="post-score-meta"><span>${p.date}  •  ${compact(p.reach)} دسترسی</span><strong>♡ ${num(p.saves)} ذخیره</strong></div></div></article>`).join('')}</div></div><div class="two-col" style="margin-top:14px"><article class="card card-pad"><div class="section-heading"><div><h2>مقایسه اثرگذاری فرمت‌ها</h2><p>بر اساس میانگین ۶ محتوای اخیر</p></div></div><div class="mix-list"><div class="mix-row"><span>کاروسل</span><div class="mix-bar"><i style="width:92%"></i></div><strong>۹٫۸٪</strong></div><div class="mix-row"><span>ریلز</span><div class="mix-bar"><i style="width:81%"></i></div><strong>۸٫۷٪</strong></div><div class="mix-row"><span>تصویر</span><div class="mix-bar"><i style="width:66%"></i></div><strong>۷٫۱٪</strong></div><div class="mix-row"><span>استوری</span><div class="mix-bar"><i style="width:49%"></i></div><strong>۵٫۴٪</strong></div></div></article><article class="card insight-card card-pad"><div class="eyebrow">فرصت بازیافت محتوا</div><h2>۳ محتوای قدیمی هنوز پتانسیل وایرال شدن دارند.</h2><p>پست «چطور با رنگ‌ها حس بسازیم؟» را به یک ریلز کوتاه تبدیل کن.</p><button class="btn" data-action="recycle">دیدن پیشنهادها ←</button></article></div></section>`;
}

function renderStories() {
  const stories = [
    ['نکته صبحگاهی', 'امروز، ۰۹:۱۰', '۳٫۸ هزار', 'green'],
    ['نظرسنجی رنگ‌ها', 'دیروز، ۱۸:۲۰', '۴٫۶ هزار', ''],
    ['پشت صحنه کارگاه', 'دوشنبه، ۱۶:۴۰', '۳٫۲ هزار', 'blue'],
    ['سؤال از شما', 'یکشنبه، ۲۰:۰۵', '۲٫۹ هزار', 'pink']
  ];
  return `<section class="inner-view"><div class="view-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> مسیر تماشا و تعامل</div><h1>استوری‌هایت را <span>زنده‌تر</span> ببین.</h1><p>بفهم کجا مخاطب می‌ماند، کجا رد می‌شود و چطور داستان بعدی را بهتر بسازی.</p></div><div class="view-actions"><button class="btn btn-soft" data-action="open-data">＋ وارد کردن خروجی استوری</button><button class="btn btn-primary" data-action="generate-story">✦ ایده استوری</button></div></div><div class="story-hero"><div class="eyebrow" style="color:#bfe681"><span class="eyebrow-dot"></span> جمع‌بندی ۷ روز اخیر</div><h2>مخاطب‌ها تا پایان داستانت با تو می‌مانند.</h2><p>نرخ تکمیل تو ۱۲٪ بالاتر از میانگین صفحات مشابه است. استیکر سؤال را بیشتر امتحان کن.</p><div class="hero-metrics"><div class="hero-metric"><strong>۷۴٪</strong><small>نرخ تکمیل</small></div><div class="hero-metric"><strong>۱۸٪</strong><small>نرخ خروج</small></div><div class="hero-metric"><strong>۲٫۴ هزار</strong><small>پاسخ‌ها</small></div></div></div><div class="two-col" style="margin-top:14px"><article class="card funnel"><div class="section-heading"><div><h2>قیف تماشای داستان</h2><p>از اولین فریم تا آخرین فریم</p></div><span class="tag">هفته جاری</span></div><div class="funnel-row"><span class="funnel-label">شروع</span><div class="funnel-bar"><i style="width:100%"></i></div><strong>۱۰۰٪</strong></div><div class="funnel-row"><span class="funnel-label">فریم ۳</span><div class="funnel-bar"><i style="width:86%"></i></div><strong>۸۶٪</strong></div><div class="funnel-row"><span class="funnel-label">فریم ۶</span><div class="funnel-bar"><i style="width:77%"></i></div><strong>۷۷٪</strong></div><div class="funnel-row"><span class="funnel-label">پایان</span><div class="funnel-bar"><i style="width:74%"></i></div><strong>۷۴٪</strong></div></article><article class="card card-pad"><div class="section-heading"><div><h2>نوع تعامل</h2><p>چه کاری بیشتر انجام شده؟</p></div></div><div class="mix-list"><div class="mix-row"><span>جلو رفتن</span><div class="mix-bar"><i style="width:62%;background:#e6b27d"></i></div><strong>۶۲٪</strong></div><div class="mix-row"><span>بازگشت</span><div class="mix-bar"><i style="width:19%;background:#7eb995"></i></div><strong>۱۹٪</strong></div><div class="mix-row"><span>پاسخ</span><div class="mix-bar"><i style="width:12%;background:#b3d878"></i></div><strong>۱۲٪</strong></div><div class="mix-row"><span>خروج</span><div class="mix-bar"><i style="width:7%;background:#e99c94"></i></div><strong>۷٪</strong></div></div></article></div><article class="card posts-card story-table"><div class="section-heading"><div><h2>آخرین مجموعه‌های استوری</h2><p>عملکرد هر مجموعه را با هم مقایسه کن</p></div><button class="text-link" data-action="open-report">گزارش استوری ←</button></div><table class="post-table"><thead><tr><th>مجموعه</th><th>بازدید</th><th>تکمیل</th><th>خروج</th><th>پاسخ</th></tr></thead><tbody>${stories.map((s, i) => `<tr data-story="${i}"><td><div class="story-tiny"><span class="story-circle ${s[3]}"></span><span class="post-copy"><strong>${s[0]}</strong><small>${s[1]}</small></span></div></td><td>${s[2]}</td><td class="strong-number">${['۸۱٪', '۷۸٪', '۷۳٪', '۶۸٪'][i]}</td><td>${['۱۲٪', '۱۵٪', '۱۹٪', '۲۳٪'][i]}</td><td>${['۲۴۰', '۱۸۵', '۱۰۷', '۹۱'][i]}</td></tr>`).join('')}</tbody></table></article></section>`;
}

function calendarDays() {
  const data = { 1: ['ریلز', 'reel'], 3: ['کاروسل', 'carousel'], 5: ['استوری', 'story'], 8: ['ریلز', 'reel'], 10: ['کاروسل', 'carousel'], 12: ['استوری', 'story'], 15: ['ریلز', 'reel'], 17: ['کاروسل', 'carousel'], 19: ['استوری', 'story'], 22: ['ریلز', 'reel'], 24: ['کاروسل', 'carousel'], 26: ['استوری', 'story'] };
  let html = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map((d) => `<div class="cal-weekday">${d}</div>`).join('');
  [29, 30].forEach((d) => { html += `<div class="cal-day muted-day"><strong>${toFa(d)}</strong></div>`; });
  for (let d = 1; d <= 30; d += 1) {
    const item = data[d];
    html += `<div class="cal-day ${d === 24 ? 'today' : ''}"><strong>${toFa(d)}</strong>${item ? `<div class="cal-content ${item[1]}"><i></i>${item[0]}</div>` : ''}</div>`;
  }
  return html;
}

function renderCalendar() {
  return `<section class="inner-view"><div class="view-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> نظم، بدون فشار</div><h1>این هفته چه چیزی <span>منتشر کنیم؟</span></h1><p>برنامه‌ای که از داده‌های واقعی صفحه‌ات ساخته شده؛ منعطف بمان و با ریتم خودت جلو برو.</p></div><div class="view-actions"><button class="btn btn-soft" data-action="download-calendar">↓ ذخیره برنامه</button><button class="btn btn-primary" data-action="add-plan">＋ افزودن محتوا</button></div></div><div class="calendar-layout"><article class="card calendar-card"><div class="calendar-nav"><div class="calendar-nav-controls"><button title="ماه قبل">›</button><button title="ماه بعد">‹</button></div><strong>آبان ۱۴۰۳</strong><span class="tag">امروز: ۲۴ آبان</span></div><div class="calendar-grid">${calendarDays()}</div></article><aside class="card card-pad"><div class="section-heading"><div><h2>پیشنهادهای این هفته</h2><p>ساخته‌شده برای مخاطب تو</p></div><span class="metric-help" title="این پیشنهادها با توجه به محتوای برنده‌ات ساخته شده‌اند">؟</span></div><div class="plan-list"><div class="plan-item"><span class="plan-icon">◉</span><div><strong>ریلز آموزشی کوتاه</strong><small>شنبه، ساعت ۱۸:۰۰</small></div><span class="tag">پیشنهاد طلایی</span></div><div class="plan-item"><span class="plan-icon">▦</span><div><strong>کاروسل قدم‌به‌قدم</strong><small>دوشنبه، ساعت ۱۲:۳۰</small></div><span class="tag">تعامل‌ساز</span></div><div class="plan-item"><span class="plan-icon">◌</span><div><strong>استوری پرسش و پاسخ</strong><small>چهارشنبه، ساعت ۲۰:۰۰</small></div><span class="tag">صمیمی</span></div></div><button class="btn btn-soft" style="width:100%;margin-top:14px" data-action="generate-calendar">✦ ساخت برنامه جدید</button></aside></div><div class="three-col" style="margin-top:14px"><article class="card card-pad"><div class="eyebrow">تعادل پیشنهادی</div><h2 style="margin-top:10px;font-size:17px">۳ ریلز <span class="muted">/</span> ۲ کاروسل <span class="muted">/</span> ۵ استوری</h2><p class="muted" style="margin-top:7px;font-size:10px;line-height:1.8">ترکیبی که هم دسترسی می‌سازد و هم اعتماد.</p></article><article class="card card-pad"><div class="eyebrow">یادآوری بعدی</div><h2 style="margin-top:10px;font-size:17px">استوری امشب</h2><p class="muted" style="margin-top:7px;font-size:10px;line-height:1.8">۲۰:۰۰، یک سؤال ساده از مخاطب‌ها بپرس.</p></article><article class="card insight-card card-pad"><div class="eyebrow">نشان استمرار</div><h2 style="margin-top:10px">۲ پست تا کامل شدن هدف هفتگی!</h2><p>تو از چیزی که فکر می‌کنی نزدیک‌تری.</p></article></div></section>`;
}

function renderAudience() {
  return `<section class="inner-view"><div class="view-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> آدم‌های پشت عددها</div><h1>مخاطب‌هایت را <span>بهتر بشناس.</span></h1><p>این بخش به تو می‌گوید چه کسانی گوش می‌دهند، چه چیزی برایشان مهم است و از کجا به صفحه‌ات می‌رسند.</p></div><div class="view-actions"><button class="btn btn-soft" data-action="open-data">＋ تکمیل اطلاعات مخاطب</button><button class="btn btn-primary" data-action="open-advisor">✦ پرسش از مشاور</button></div></div><div class="two-col"><article class="card audience-score"><div class="score-ring"><div><strong>۷۴</strong><small>امتیاز شناخت</small></div></div><div><div class="eyebrow">تحلیل مخاطب</div><h2>مخاطب تو دنبال الهام عملی است.</h2><p>بیشترین واکنش را از زنان ۲۴ تا ۳۴ ساله در شهرهای بزرگ می‌گیری؛ مخصوصاً وقتی مثال واقعی و راهکار کوتاه می‌دهی.</p><button class="text-link" style="margin-top:13px" data-action="show-demographics">جزئیات تحلیل ←</button></div></article><article class="card card-pad"><div class="section-heading"><div><h2>سن و جنسیت</h2><p>برآوردشده از تعامل‌های صفحه</p></div><span class="tag">تخمینی</span></div><div class="demographic-list"><div class="demo-row"><label>۱۸–۲۴ سال</label><div class="demo-bar"><i style="width:32%"></i></div><b>۳۲٪</b></div><div class="demo-row"><label>۲۵–۳۴ سال</label><div class="demo-bar"><i style="width:46%;background:#4f9c81"></i></div><b>۴۶٪</b></div><div class="demo-row"><label>۳۵–۴۴ سال</label><div class="demo-bar"><i style="width:17%;background:#a8d373"></i></div><b>۱۷٪</b></div><div class="demo-row"><label>سایر</label><div class="demo-bar"><i style="width:5%;background:#e5b17e"></i></div><b>۵٪</b></div></div></article></div><div class="three-col"><article class="card card-pad"><div class="section-heading"><div><h2>علاقه‌مندی‌ها</h2><p>موضوعاتی که بیشتر دنبال می‌کنند</p></div></div><div class="interest-cloud"><span class="interest">خلاقیت</span><span class="interest">سبک زندگی</span><span class="interest">خودشناسی</span><span class="interest">دکوراسیون</span><span class="interest">عکاسی</span><span class="interest">کتاب</span></div></article><article class="card card-pad"><div class="section-heading"><div><h2>منبع رشد</h2><p>مخاطب‌ها از کجا می‌آیند؟</p></div></div><div class="mix-list"><div class="mix-row"><span>اکسپلور</span><div class="mix-bar"><i style="width:57%"></i></div><strong>۵۷٪</strong></div><div class="mix-row"><span>پروفایل</span><div class="mix-bar"><i style="width:24%;background:#efb27e"></i></div><strong>۲۴٪</strong></div><div class="mix-row"><span>اشتراک‌گذاری</span><div class="mix-bar"><i style="width:12%;background:#afd477"></i></div><strong>۱۲٪</strong></div><div class="mix-row"><span>سایر</span><div class="mix-bar"><i style="width:7%;background:#dea0a0"></i></div><strong>۷٪</strong></div></div></article><article class="card insight-card card-pad"><div class="eyebrow">فرصت رشد</div><h2>از مخاطب‌های وفادارت دعوت کن حرف بزنند.</h2><p>یک سؤال باز در کپشن بعدی می‌تواند کامنت‌ها را ۲۸٪ بیشتر کند.</p><button class="btn" data-action="generate-caption">ساخت کپشن تعاملی ←</button></article></div></section>`;
}

function renderTrends() {
  const trends = [
    ['۰۱', 'روایت «قبل و بعد»', 'فرمت • مناسب برای آموزش‌های کوتاه', '۸۹'],
    ['۰۲', 'صدای آرام و مینیمال', 'صدای ترند • ۲٫۸ میلیون استفاده', '۸۴'],
    ['۰۳', 'مینی‌سری «یک دقیقه برای خودم»', 'موضوع • در حوزه سبک زندگی', '۸۱'],
    ['۰۴', 'پرسش دوگزینه‌ای در ریلز', 'الگوی تعامل • مناسب جامعه تو', '۷۶']
  ];
  return `<section class="inner-view"><div class="view-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> هر روز یک قدم جلوتر</div><h1>رادار <span>ترندهای تو.</span></h1><p>ترندهایی که فقط محبوب نیستند؛ با لحن، حوزه و مخاطب صفحه تو هم‌خوانی دارند.</p></div><div class="view-actions"><button class="btn btn-soft" data-action="refresh-trends">↻ به‌روزرسانی</button><button class="btn btn-primary" data-action="generate-idea">✦ ترکیب ترندها</button></div></div><div class="two-col"><article class="card card-pad"><div class="section-heading"><div><h2>ترندهای مناسب برای تو</h2><p>آخرین بررسی: همین امروز، ۰۹:۳۰</p></div><span class="tag">۴ پیشنهاد تازه</span></div><div class="trend-list">${trends.map((t) => `<div class="trend-item"><span class="trend-rank">${t[0]}</span><div class="trend-copy"><strong>${t[1]}</strong><small>${t[2]}</small></div><span class="trend-score">${t[3]}٪</span><button class="text-link" data-action="use-trend" title="ساخت ایده با این ترند">＋</button></div>`).join('')}</div></article><article class="card insight-card card-pad"><span class="sparkle">✦</span><div class="eyebrow">ترکیب پیشنهادی</div><h2>«قبل و بعد» را با صدای آرام امتحان کن.</h2><p>این ترکیب با کاروسل‌های آموزشی برنده تو هم‌افزایی دارد و امتیاز وایرال ۹۲ از ۱۰۰ گرفته است.</p><button class="btn" data-action="generate-idea">ساخت این ایده ←</button></article></div><div class="three-col"><article class="card card-pad"><div class="section-heading"><div><h2>هشتگ‌های رو به رشد</h2><p>هشتگ‌هایی نزدیک به حوزه تو</p></div></div><div class="interest-cloud"><span class="interest">#عادت_خوب</span><span class="interest">#خلاقیت_روزانه</span><span class="interest">#ایده_ساده</span><span class="interest">#حال_خوب</span><span class="interest">#سبک_زندگی</span></div></article><article class="card card-pad"><div class="section-heading"><div><h2>صدای محبوب این هفته</h2><p>برای ریلز بعدی</p></div></div><div style="display:flex;align-items:center;gap:11px"><span class="ai-avatar">♫</span><div><strong style="font-size:11px">نفس عمیق، شروع دوباره</strong><p class="muted" style="margin-top:4px;font-size:9px">استفاده در ۲٫۸ میلیون ریلز</p></div><span class="trend-score" style="margin-right:auto">+۳۴٪</span></div></article><article class="card card-pad"><div class="section-heading"><div><h2>امتیاز فرصت</h2><p>آمادگی صفحه برای موج بعدی</p></div></div><div style="display:flex;align-items:baseline;gap:7px"><strong style="font-size:34px;color:var(--teal)">۸۸</strong><span class="muted" style="font-size:10px">از ۱۰۰</span></div><div class="mix-bar" style="height:8px;margin-top:13px"><i style="width:88%;background:linear-gradient(90deg,#73b98b,#c4e47e)"></i></div></article></div></section>`;
}

function renderCompetitors() {
  return `<section class="inner-view"><div class="view-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> دید وسیع‌تر، تصمیم بهتر</div><h1>تو در کنار <span>رقبا.</span></h1><p>سه صفحه مشابه را کنار صفحه خودت ببین؛ نه برای مقایسه بی‌پایان، برای پیدا کردن فرصت‌های تازه.</p></div><div class="view-actions"><button class="btn btn-soft" data-action="add-competitor">＋ افزودن رقیب</button><button class="btn btn-primary" data-action="open-report">↓ گزارش مقایسه</button></div></div><div class="card posts-card" style="padding-bottom:18px"><div class="section-heading"><div><h2>مقایسه سریع</h2><p>اعداد ماه گذشته، برآوردشده از محتوای عمومی</p></div><span class="tag">تخمینی</span></div><table class="post-table"><thead><tr><th>صفحه</th><th>دنبال‌کننده</th><th>رشد ماهانه</th><th>تعامل</th><th>فرمت برنده</th></tr></thead><tbody><tr><td><div class="post-info"><span class="avatar" style="background:#f0c17d">ن</span><span class="post-copy"><strong>niloofar.studio <span class="tag">شما</span></strong><small>سبک زندگی و آموزش</small></span></div></td><td class="strong-number">۱۲٫۴ هزار</td><td><span class="engagement-pill">+۸٫۴٪</span></td><td>۷٫۸٪</td><td>کاروسل</td></tr><tr><td><div class="post-info"><span class="avatar" style="background:#c3dca1">آ</span><span class="post-copy"><strong>aramesh.daily</strong><small>خودشناسی و آرامش</small></span></div></td><td>۱۸٫۷ هزار</td><td><span class="engagement-pill">+۵٫۹٪</span></td><td>۶٫۲٪</td><td>ریلز</td></tr><tr><td><div class="post-info"><span class="avatar" style="background:#e5aaa2">د</span><span class="post-copy"><strong>daily.design</strong><small>طراحی و خلاقیت</small></span></div></td><td>۲۶٫۳ هزار</td><td><span class="engagement-pill">+۷٫۲٪</span></td><td>۵٫۸٪</td><td>کاروسل</td></tr></tbody></table></div><div class="three-col" style="margin-top:14px"><article class="card card-pad"><div class="eyebrow">فرصت محتوایی</div><h2 style="margin-top:10px;font-size:16px">تو تعامل بیشتری می‌سازی.</h2><p class="muted" style="margin-top:7px;font-size:10px;line-height:1.8">نرخ تعامل تو ۲۶٪ بالاتر از میانگین این گروه است.</p></article><article class="card card-pad"><div class="eyebrow">چیزی برای یادگیری</div><h2 style="margin-top:10px;font-size:16px">ریلزهای آموزشی رقبا بیشتر دیده می‌شوند.</h2><p class="muted" style="margin-top:7px;font-size:10px;line-height:1.8">با این حال، ذخیره‌سازی کاروسل تو هنوز برنده است.</p></article><article class="card insight-card card-pad"><div class="eyebrow">حرکت بعدی</div><h2 style="margin-top:10px">هویت خودت را حفظ کن.</h2><p>قرار نیست شبیه رقبا باشی؛ قرار است واضح‌تر دیده شوی.</p><button class="btn" data-action="generate-idea">ساخت ایده متمایز ←</button></article></div></section>`;
}

function renderView() {
  if (state.view === 'overview') root.innerHTML = renderOverview();
  if (state.view === 'posts') root.innerHTML = renderPosts();
  if (state.view === 'stories') root.innerHTML = renderStories();
  if (state.view === 'calendar') root.innerHTML = renderCalendar();
  if (state.view === 'audience') root.innerHTML = renderAudience();
  if (state.view === 'trends') root.innerHTML = renderTrends();
  if (state.view === 'competitors') root.innerHTML = renderCompetitors();
  el('#breadcrumbTitle').textContent = viewNames[state.view] || 'نمای کلی';
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  bindViewEvents();
}

function closeModal() { modalRoot.innerHTML = ''; }
function openModal(content, className = '') {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal ${className}">${content}</div></div>`;
  const backdrop = modalRoot.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
  modalRoot.querySelectorAll('.close-modal').forEach((button) => button.addEventListener('click', closeModal));
}

function openDataModal() {
  openModal(`<div class="modal-head"><div><h2>صفحه‌ات را به استودیو معرفی کن</h2><p>هرچقدر داده بیشتری بدهی، پیشنهادها شخصی‌تر می‌شوند. اگر چیزی نداری، ما با داده نمونه شروع می‌کنیم.</p></div><button class="close-modal">×</button></div><form id="dataForm"><div class="form-grid"><div class="form-field"><label for="usernameInput">نام کاربری صفحه</label><input id="usernameInput" required dir="ltr" value="${state.profile.username}" placeholder="مثلاً: your.page" /></div><div class="form-field"><label for="nicheInput">حوزه فعالیت</label><select id="nicheInput"><option>سبک زندگی و آموزش خلاقیت</option><option>فروشگاه و محصول</option><option>سلامت و ورزش</option><option>غذا و آشپزی</option><option>مد و زیبایی</option><option>هنر و سرگرمی</option></select></div><div class="form-field"><label for="followersInput">تعداد دنبال‌کننده <span class="muted">(اختیاری)</span></label><input id="followersInput" inputmode="numeric" value="${state.sample ? '' : state.followers}" placeholder="مثلاً: ۱۲۵۰۰" /></div><div class="form-field"><label for="postsInput">تعداد پست‌ها <span class="muted">(اختیاری)</span></label><input id="postsInput" inputmode="numeric" placeholder="مثلاً: ۱۸۰" /></div><div class="form-field full"><label for="bioInput">درباره صفحه و مخاطب هدفت</label><textarea id="bioInput" placeholder="مثلاً: به زنان جوان کمک می‌کنم با عادت‌های کوچک، روزهای خلاق‌تری بسازند."></textarea></div><div class="form-field full"><label>خروجی اینستاگرام <span class="muted">(اختیاری)</span></label><label class="dropzone" for="fileInput"><span class="drop-icon">⇧</span><span><strong id="fileName">فایل CSV، JSON یا اسکرین‌شات را اینجا بکش</strong><small>تحلیل کپشن، لایک، کامنت، ذخیره، ریچ و تاریخ انتشار</small></span><input id="fileInput" type="file" accept=".csv,.json,image/*" hidden /></label></div></div><div class="modal-footer"><span class="form-hint">🔒 اطلاعاتت فقط در فضای کاری تو می‌ماند.</span><button type="button" class="btn btn-soft close-modal">انصراف</button><button type="submit" class="btn btn-primary">شروع تحلیل صفحه ✦</button></div></form>`);
  const file = el('#fileInput');
  file.addEventListener('change', () => { if (file.files[0]) el('#fileName').textContent = `فایل «${file.files[0].name}» آماده تحلیل است`; });
  el('#dataForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const username = el('#usernameInput').value.trim().replace(/^@/, '') || 'صفحه من';
    const enteredFollowers = parseInt((el('#followersInput').value || '').replace(/[^0-9]/g, ''), 10);
    state.profile.username = username;
    state.profile.niche = el('#nicheInput').value;
    state.profile.name = username === 'niloofar.studio' ? 'نیلوفر احمدی' : 'مدیر صفحه';
    state.followers = enteredFollowers || Math.floor(8200 + Math.random() * 9000);
    state.sample = false;
    document.querySelectorAll('.workspace-name strong').forEach((node) => node.textContent = state.profile.username);
    document.querySelectorAll('.profile-copy strong').forEach((node) => node.textContent = state.profile.name);
    closeModal();
    state.view = 'overview';
    renderView();
    showToast(`تحلیل ${state.profile.username} با موفقیت آماده شد`);
  });
}

function openIdeaModal() {
  openModal(`<div class="modal-head"><div><h2>ایده‌ای که به صفحه تو می‌آید</h2><p>این پیشنهاد با توجه به کاروسل‌های موفق، لحن صمیمی و مخاطب علاقه‌مند به خلاقیت ساخته شده است.</p></div><button class="close-modal">×</button></div><div class="card" style="padding:17px;background:#f6faef;border-color:#e0ebc9"><div class="eyebrow">امتیاز پتانسیل وایرال <strong style="margin-right:auto;color:#568944">۹۲ از ۱۰۰</strong></div><h3 style="margin-top:12px;color:var(--ink-strong);font-size:17px;line-height:1.7">«۳ تغییر کوچک روی میز کارت که تمرکزت را برمی‌گرداند»</h3><p class="muted" style="margin-top:8px;font-size:10px;line-height:1.9">شروع پیشنهادی: «اگر هر روز پشت میزت می‌نشینی اما ذهنت همراهت نیست، این سه تغییر را امتحان کن.»</p><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px"><span class="tag">کاروسل ۶ اسلایدی</span><span class="tag">ذخیره‌پذیر</span><span class="tag">مناسب سه‌شنبه ۱۸:۰۰</span></div></div><div class="three-col" style="margin-top:14px;margin-bottom:0"><div class="card card-pad"><div class="eyebrow">چرا جواب می‌دهد؟</div><p style="margin-top:7px;font-size:10px;line-height:1.8;color:var(--muted)">بهترین فرمت تو را با موضوعی کاربردی و قابل ذخیره ترکیب می‌کند.</p></div><div class="card card-pad"><div class="eyebrow">فرمت پیشنهادی</div><p style="margin-top:7px;font-size:10px;line-height:1.8;color:var(--muted)">۶ اسلاید، یک مثال واقعی و دعوت به نظر دادن در پایان.</p></div><div class="card card-pad"><div class="eyebrow">امتیاز تعامل</div><p style="margin-top:7px;font-size:10px;line-height:1.8;color:var(--muted)">احتمال ذخیره: زیاد • احتمال کامنت: متوسط</p></div></div><div class="modal-footer"><button class="btn btn-soft close-modal">بعداً</button><button class="btn btn-primary" data-action="generate-caption">ساخت کپشن همین ایده ✦</button></div>`);
}

function openPostModal(id) {
  const post = posts.find((item) => item.id === Number(id)) || posts[0];
  openModal(`<div class="modal-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> جزئیات محتوا</div><h2 style="margin-top:7px">${post.title}</h2><p>${post.date}  •  ${post.type}  •  تحلیل‌شده با داده‌های ۲۴ ساعت اول</p></div><button class="close-modal">×</button></div><div class="two-col" style="margin:0"><div class="big-thumb ${post.thumb}" style="height:220px;border-radius:14px"><div class="thumb-overlay"><span>${post.type}</span><strong>امتیاز ${post.rate}</strong></div></div><div class="card card-pad"><div class="section-heading"><div><h2>خلاصه عملکرد</h2><p>در مقایسه با میانگین پیج</p></div></div><div class="mix-list"><div class="mix-row"><span>دسترسی</span><div class="mix-bar"><i style="width:83%"></i></div><strong>${compact(post.reach)}</strong></div><div class="mix-row"><span>لایک</span><div class="mix-bar"><i style="width:74%;background:#efb27e"></i></div><strong>${compact(post.likes)}</strong></div><div class="mix-row"><span>کامنت</span><div class="mix-bar"><i style="width:57%;background:#afd477"></i></div><strong>${num(post.comments)}</strong></div><div class="mix-row"><span>ذخیره</span><div class="mix-bar"><i style="width:91%;background:#78b493"></i></div><strong>${num(post.saves)}</strong></div></div><p style="margin-top:17px;padding-top:12px;border-top:1px solid var(--line);color:#5f8e51;font-size:10px;line-height:1.8">✦ این محتوا به‌خاطر کاربردی بودن، ۲٫۱ برابر بیشتر ذخیره شده است.</p></div></div><div class="modal-footer"><button class="btn btn-soft" data-action="recycle">پیشنهاد بازتولید</button><button class="btn btn-primary" data-action="generate-caption">ساخت نسخه جدید ✦</button></div>`);
}

function openChat() {
  if (el('.chat-drawer')) return;
  const drawer = document.createElement('aside');
  drawer.className = 'chat-drawer';
  drawer.innerHTML = `<div class="chat-head"><span class="ai-avatar">✦</span><div><strong>مشاور رشد تو</strong><small>بر اساس داده‌های niloofar.studio</small></div><button class="chat-close">×</button></div><div class="chat-messages" id="chatMessages"><div class="chat-message bot">سلام نیلوفر! من داده‌های صفحه‌ات را می‌بینم و آماده‌ام کمک کنم. از من بپرس چرا ریچ افت کرده، چه چیزی منتشر کنی یا چطور تعامل را بالا ببری.</div><div class="chat-message bot">یک نکته فوری: کاروسل‌های آموزشی تو ۲٫۱ برابر بیشتر ذخیره می‌شوند. دوست داری برای هفته آینده از همین الگو برنامه بسازیم؟</div></div><div class="chat-suggestions"><button data-chat="چرا ریچم افت کرده؟">چرا ریچم افت کرده؟</button><button data-chat="این هفته چه پست کنم؟">این هفته چه پست کنم؟</button><button data-chat="یک کپشن بده">یک کپشن بده</button></div><form class="chat-input" id="chatForm"><input id="chatInput" placeholder="سؤال استراتژیکت را بنویس…" autocomplete="off" /><button type="submit">➤</button></form>`;
  document.body.appendChild(drawer);
  drawer.querySelector('.chat-close').addEventListener('click', () => drawer.remove());
  drawer.querySelectorAll('[data-chat]').forEach((button) => button.addEventListener('click', () => sendChat(button.dataset.chat)));
  drawer.querySelector('#chatForm').addEventListener('submit', (event) => { event.preventDefault(); const input = el('#chatInput'); if (input.value.trim()) { sendChat(input.value.trim()); input.value = ''; } });
}

function sendChat(text) {
  const messages = el('#chatMessages');
  if (!messages) return;
  const user = document.createElement('div'); user.className = 'chat-message user'; user.textContent = text; messages.appendChild(user);
  const lower = text.toLowerCase();
  let answer = 'با توجه به داده‌های تو، پیشنهاد می‌کنم این موضوع را با یک کاروسل ۵ تا ۶ اسلایدی و یک مثال شخصی شروع کنی. این فرمت در صفحه تو بیشترین ذخیره را می‌سازد.';
  if (lower.includes('ریچ') || lower.includes('افت')) answer = 'ریچ کلی افت نکرده؛ در ۷ روز اخیر فقط سهم اکسپلور ۸٪ کمتر شده است. دلیل محتمل، فاصله ۵ روزه بین دو ریلز است. این هفته یک ریلز کوتاه در سه‌شنبه ساعت ۱۸ منتشر کن و در ۳۰ دقیقه اول به کامنت‌ها پاسخ بده.';
  if (lower.includes('کپشن')) answer = '«لازم نیست همه چیز را یک‌باره درست کنی. گاهی یک تغییر کوچک در میز کارت، شروع یک روز بهتر است. تو امروز چه چیزی را تغییر می‌دهی؟»\n\nپیشنهاد دعوت به تعامل: تجربه‌ات را برای من بنویس.';
  if (lower.includes('پست') || lower.includes('این هفته')) answer = 'این هفته ترکیب پیشنهادی من: یک ریلز «قبل و بعد» شنبه ساعت ۱۸، یک کاروسل قدم‌به‌قدم دوشنبه ظهر و سه استوری پرسش‌محور. این برنامه دقیقاً بر اساس فرمت‌های برنده توست.';
  setTimeout(() => { const bot = document.createElement('div'); bot.className = 'chat-message bot'; bot.textContent = answer; messages.appendChild(bot); messages.scrollTop = messages.scrollHeight; }, 450);
  messages.scrollTop = messages.scrollHeight;
}

function downloadReportFile() {
  const report = `<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><title>گزارش رشد ${state.profile.username}</title><body style="font-family:Tahoma,sans-serif;max-width:760px;margin:40px auto;padding:24px;color:#153f37;line-height:2"><h1>گزارش رشد ${state.profile.username}</h1><p>هفته ۱۸ تا ۲۴ آبان • ساخته‌شده در استودیو بینش</p><hr><h2>خلاصه عملکرد</h2><ul><li>رشد دنبال‌کننده: +۸٫۴٪</li><li>نرخ تعامل: ۷٫۸٪</li><li>محتوای برنده: کاروسل آموزشی</li><li>بهترین زمان انتشار: سه‌شنبه، ساعت ۱۸</li></ul><h2>پیشنهاد هفته بعد</h2><p>یک ریلز کوتاه در سه‌شنبه منتشر کن، سپس یک کاروسل قدم‌به‌قدم در دوشنبه ظهر و سه مجموعه استوری پرسش‌محور بساز.</p><p style="color:#75857e">این گزارش بر اساس داده‌های ${state.sample ? 'نمونه و تخمینی' : 'واردشده توسط شما'} تهیه شده است.</p></body></html>`;
  const blob = new Blob([report], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `گزارش-رشد-${state.profile.username}.html`; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function showReport() {
  openModal(`<div class="modal-head"><div><div class="eyebrow"><span class="eyebrow-dot"></span> گزارش آماده است</div><h2 style="margin-top:7px">گزارش عملکرد صفحه</h2><p>خلاصه خوانا و قابل اشتراک‌گذاری برای هفته ۱۸ تا ۲۴ آبان.</p></div><button class="close-modal">×</button></div><div class="card" style="padding:18px;background:#f7fbf1;border-color:#e1eccf"><div style="display:flex;justify-content:space-between;align-items:center"><span class="muted" style="font-size:10px">امتیاز رشد کلی</span><strong style="font-size:28px;color:var(--teal)">۸۶<span style="font-size:11px;color:var(--muted)">/۱۰۰</span></strong></div><p style="margin-top:9px;color:var(--muted);font-size:10px;line-height:1.9">صفحه در مسیر سالمی است. بیشترین فرصت این هفته: استمرار ریلزهای آموزشی و استفاده از ساعت طلایی سه‌شنبه.</p></div><div class="three-col" style="margin-top:14px;margin-bottom:0"><div class="card card-pad"><div class="eyebrow">رشد دنبال‌کننده</div><strong style="display:block;margin-top:8px;font-size:18px">+۸٫۴٪</strong></div><div class="card card-pad"><div class="eyebrow">نرخ تعامل</div><strong style="display:block;margin-top:8px;font-size:18px">۷٫۸٪</strong></div><div class="card card-pad"><div class="eyebrow">محتوای برنده</div><strong style="display:block;margin-top:8px;font-size:14px">کاروسل</strong></div></div><div class="modal-footer"><span class="form-hint">گزارش فارسی، آماده اشتراک‌گذاری</span><button class="btn btn-soft close-modal">بستن</button><button class="btn btn-primary" data-action="download-report">↓ دریافت گزارش</button></div>`);
}

function openNotifications() {
  openModal(`<div class="modal-head"><div><h2>اعلان‌های استودیو</h2><p>چیز مهمی از دستت نرفته.</p></div><button class="close-modal">×</button></div><div class="activity-list"><div class="activity-item"><span class="activity-icon">✦</span><p><strong>ریلزت عملکرد خوبی گرفته</strong><small>پشت صحنه یک روز خلاقانه، ۲۸٪ بالاتر از میانگین دیده شده.</small></p></div><div class="activity-item"><span class="activity-icon">◷</span><p><strong>زمان طلایی نزدیک است</strong><small>امشب ساعت ۱۸ مخاطب‌هایت فعال‌تر هستند.</small></p></div><div class="activity-item"><span class="activity-icon">✓</span><p><strong>گزارش هفتگی آماده شد</strong><small>یک نگاه کوتاه به چیزهایی که این هفته جواب داد.</small></p></div></div><div class="modal-footer"><button class="btn btn-primary close-modal">متوجه شدم</button></div>`);
}

function bindViewEvents() {
  root.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => { state.range = button.dataset.range; renderView(); }));
  root.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; renderView(); }));
  root.querySelectorAll('[data-post]').forEach((item) => item.addEventListener('click', () => openPostModal(item.dataset.post)));
  const slider = el('#forecastSlider');
  if (slider) slider.addEventListener('input', () => {
    const frequency = Number(slider.value); state.postFrequency = frequency;
    const uplift = (frequency - 2) * 2.7 + 7.5;
    const predicted = state.followers + Math.round(state.followers * uplift / 100);
    el('#forecastValue').innerHTML = `${compact(predicted)}<small>دنبال‌کننده تا ۹۰ روز آینده</small>`;
    el('#forecastGain').textContent = `+${toFa(uplift.toFixed(1))}٪`;
    el('#forecastPercent').textContent = `${toFa(frequency)} بار`;
    slider.style.background = `linear-gradient(to left, #bfe984 0 ${(frequency - 2) * 20}%, rgba(255,255,255,.14) ${(frequency - 2) * 20}%)`;
  });
}

// Global interactions intentionally use delegation so every new view stays interactive.
document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-view]');
  if (nav) { state.view = nav.dataset.view; renderView(); el('#sidebar').classList.remove('open'); return; }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const act = action.dataset.action;
  if (act === 'open-data') openDataModal();
  if (act === 'generate-idea' || act === 'generate-story') openIdeaModal();
  if (act === 'open-advisor') openChat();
  if (act === 'open-report' || act === 'download-report') { if (act === 'download-report') { downloadReportFile(); closeModal(); showToast('گزارش فارسی برای دریافت آماده شد'); } else showReport(); }
  if (act === 'recycle') { closeModal(); showToast('۳ پیشنهاد بازتولید محتوا پیدا شد'); }
  if (act === 'generate-caption') { closeModal(); openModal(`<div class="modal-head"><div><h2>کپشن آماده انتشار</h2><p>لحن صمیمی و دعوت‌کننده، هماهنگ با صدای صفحه تو.</p></div><button class="close-modal">×</button></div><div class="card card-pad" style="background:#fbfcf5;border-color:#e2ebcf"><p style="color:var(--ink);font-size:12px;line-height:2.1">گاهی برای شروع یک روز بهتر، لازم نیست همه‌چیز را عوض کنی؛ فقط یک گوشه کوچک را با خودت همراه کن. 🌿<br><br>من امروز میز کارم را کمی مرتب کردم و نتیجه‌اش بیشتر از چیزی بود که فکر می‌کردم.<br><br><strong style="color:var(--teal)">تو برای حال بهترت چه تغییر کوچکی می‌دهی؟</strong></p></div><div class="modal-footer"><span class="form-hint">۳ هشتگ پیشنهادی هم اضافه شد</span><button class="btn btn-soft close-modal">ویرایش</button><button class="btn btn-primary" data-action="copy-caption">کپی کپشن</button></div>`); }
  if (act === 'copy-caption') { closeModal(); showToast('کپشن در کلیپ‌بورد کپی شد'); }
  if (act === 'refresh-trends') showToast('رادار ترند به‌روز شد؛ ۲ فرصت تازه پیدا شد');
  if (act === 'use-trend') openIdeaModal();
  if (act === 'add-competitor') { openDataModal(); showToast('رقیب جدید را در توضیحات وارد کن'); }
  if (act === 'download-calendar' || act === 'generate-calendar' || act === 'add-plan') showToast(act === 'add-plan' ? 'جای خالی جدید به تقویم اضافه شد' : 'تقویم محتوایی ذخیره شد');
  if (act === 'show-demographics') showToast('تحلیل کامل جمعیت‌شناسی بر اساس ۲۴۰۰ تعامل اخیر آماده شد');
});

el('#openData').addEventListener('click', openDataModal);
el('#openAdvisor').addEventListener('click', openChat);
el('#toggleTheme').addEventListener('click', () => {
  state.dark = !state.dark;
  document.body.classList.toggle('dark-mode', state.dark);
  localStorage.setItem('insight-dark', state.dark);
  el('#themeIcon').textContent = state.dark ? '☀' : '☾';
  showToast(state.dark ? 'حالت شب فعال شد' : 'حالت روشن فعال شد');
});
el('#mobileMenu').addEventListener('click', () => el('#sidebar').classList.toggle('open'));
el('#showNotifications').addEventListener('click', openNotifications);
el('#openProfile').addEventListener('click', () => openDataModal());

document.body.classList.toggle('dark-mode', state.dark);
if (state.dark) el('#themeIcon').textContent = '☀';
renderView();
