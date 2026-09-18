# پنل مدیریت کانفیگ V2Ray / V2Box

> ⚠️ **این پنل روی سرور شخصی شما نصب می‌شود** و مسئولیت امنیت آن (رمز مدیر، گواهی TLS،
> فایروال و به‌روز بودن Xray) کاملاً بر عهدهٔ شماست. قبل از استفادهٔ واقعی حتماً
> بخش [امنیت](#-امنیت) را بخوانید.

یک پنل مدیریتی سبک و کامل برای **ساخت، مدیریت و توزیع کانفیگ‌های پروتکل‌های V2Ray**
(vless · vmess · trojan · shadowsocks) روی هستهٔ **Xray-core**.

پنل از سه سرویس تشکیل شده است:

| سرویس | نقش |
| --- | --- |
| `xray` | هستهٔ پروکسی (اینباندهای 443/8443/2053/2083/2087) |
| `backend` | API پنل با FastAPI — ساخت کاربر، تولید لینک/QR/سابسکریپشن، بازنویسی `config.json` و ری‌استارت هسته |
| `nginx` | رابط کاربری (پوشهٔ `frontend/`) و پروکسی معکوس `/api` |

---

## ✨ امکانات

- **چهار پروتکل**: VLESS (TLS و REALITY)، VMess، Trojan، Shadowsocks
- **چهار انتقال**: WebSocket، TCP(raw)، gRPC، HTTP/2 و HTTPUpgrade
- **ساخت کاربر** با سقف حجم (گیگابایت)، تاریخ انقضا (روزانه)، محدودیت اتصال همزمان
- **ساخت گروهی** کاربران (مثلاً `user1` تا `user50`) با یک تنظیم مشترک
- **لینک اشتراک (Subscription)** برای هر کاربر + هدرهای `profile-title` و
  `subscription-userinfo` سازگار با v2rayNG / V2Box / Streisand / Nekoray
- **QRcode** برای هر کانفیگ و برای نشانی اشتراک (PNG و SVG)
- **فایل JSON کامل کلاینت** قابل Import در v2rayN و Nekoray
- **صفحهٔ اشتراک کاربر** (`/share/<sub_id>`) — بدون لاگین، برای ارسال به مشتری
- **همگام‌سازی خودکار با `xray/config.json`**: فقط کاربرانِ فعالِ سازگار در این‌باند
  مربوطه ثبت می‌شوند + پشتیبان‌گیری خودکار (۱۰ نسخهٔ آخر) + ری‌استارت هسته
- **غیرفعال‌سازی خودکار** کاربران منقضی یا تمام‌شده ( job پس‌زمینه هر `SYNC_INTERVAL` ثانیه)
- **تولید کلید REALITY** (x25519، دقیقاً با فرمت `xray x25519`) از داخل پنل
- **ویرایشگر config.json** با اعتبارسنجی، تست (`xray -test`) و ری‌استارت
- **داشبورد**: آمار کاربران، ترافیک، نمودار ۷ روزه، توزیع پروتکل‌ها، پرمصرف‌ها
- **گزارش رویدادها (Audit log)** و نمایش لاگ هسته
- **گواهی خودامضا** به‌صورت خودکار ساخته می‌شود تا این‌باندهای TLS از روز اول بالا بیایند
- رابط کاربری **فارسی و راست‌چین**، تم تیره/روشن، ریسپانسیو، بدون هیچ وابستگی JS خارجی

---

## 📁 ساختار پروژه

```
.
├── docker-compose.yml        # سه سرویس: xray، backend، nginx
├── .env.example              # همهٔ متغیرهای محیطی (کپی به .env)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app.py                # روت‌های API + job پس‌زمینه
│   ├── models.py             # جداول: users، server_configs، admins، ...
│   ├── auth.py               # JWT + bcrypt
│   ├── config_generator.py   # تولید لینک vless/vmess/trojan/ss + سابسکریپشن + JSON کلاینت
│   ├── xray_manager.py       # خواندن/نوشتن config.json، ری‌استارت، کلید REALITY
│   ├── certs.py              # ساخت گواهی خودامضا
│   └── tests/test_smoke.py   # تست سرتاسری (۶۰+ بررسی)
├── frontend/
│   ├── index.html            # پنل مدیریت
│   ├── style.css
│   ├── app.js
│   └── share.html            # صفحهٔ اشتراک کاربر (عمومی)
├── xray/
│   ├── config.json           # ۵ این‌باند آماده + API آمار
│   └── entrypoint.sh         # ساخت گواهی و اعتبارسنجی پیش از اجرای هسته
└── nginx/
    └── default.conf          # سرو frontend + پروکسی /api و /sub
```

پوشه‌های `data/`، `certs/` و بکاپ‌ها در `.gitignore` هستند.

---

## 🚀 نصب سریع

پیش‌نیاز: **Docker** و **Docker Compose v2** روی سرور (پورت‌های 80، 443، 8443، 2053، 2083، 2087 آزاد باشند).

```bash
# ۱) دریافت پروژه
git clone <your-repo-url> v2box-panel && cd v2box-panel

# ۲) ساخت فایل محیطی و تولید SECRET_KEY
cp .env.example .env
sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$(openssl rand -hex 32)|" .env

# ۳) رمز مدیر را عوض کنید (و در صورت نیاز دامنهٔ خود را بگذارید)
nano .env          # ADMIN_PASSWORD=... و PUBLIC_DOMAIN=https://vpn.example.com

# ۴) اجرا
docker compose up -d --build

# ۵) ورود به پنل
#    http://<IP-سرور>/        یا  http://<IP-سرور>:8080/
#    نام کاربری: admin   رمز: همان ADMIN_PASSWORD (پیش‌فرض admin123)
```

اولین اجرا به‌صورت خودکار:

1. حساب مدیر را می‌سازد،
2. پنج این‌باند `xray/config.json` را به‌عنوان «سرور» در پنل ثبت می‌کند،
3. یک گواهی خودامضا در `certs/` می‌سازد،
4. در صورت `SEED_DEMO_DATA=true` چند کاربر نمونه (`demo-*`) اضافه می‌کند.

> برای نصب تمیز و واقعی، `SEED_DEMO_DATA=false` را در `.env` بگذارید.

### اجرای بدون Docker (توسعهٔ محلی)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL='sqlite:///./data/v2box.db'
export XRAY_CONFIG_PATH='../xray/config.json'
export SECRET_KEY=$(openssl rand -hex 32)
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

بک‌اند در این حالت خودش `frontend/` را هم سرو می‌کند؛ پس `http://localhost:8000/`
هم پنل است و هم API. (بدون socket داکر، «ری‌استارت هسته» فقط پیام می‌دهد که داکر
در دسترس نیست و بقیهٔ قابلیت‌ها کار می‌کنند.)

---

## ⚙️ متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `SECRET_KEY` | — | کلید امضای JWT — **حتماً** با `openssl rand -hex 32` عوض شود |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | فقط در **اولین** اجرا برای ساخت مدیر استفاده می‌شود |
| `ACCESS_TOKEN_EXPIRE_HOURS` | `24` | اعتبار توکن ورود |
| `DATABASE_URL` | `sqlite:////app/data/v2box.db` | مسیر دیتابیس |
| `XRAY_CONFIG_PATH` | `/etc/xray/config.json` | کانفیگی که پنل بازنویسی می‌کند |
| `XRAY_CONTAINER_NAME` | `xray-core` | کانتینری که ری‌استارت می‌شود |
| `XRAY_BACKUP_DIR` | `/app/data/xray-backup` | محل پشتیبان‌های `config.json` |
| `XRAY_ACCESS_LOG` | `/var/log/xray/access.log` | برای تشخیص «آخرین اتصال» کاربران |
| `CERT_DIR` | `/app/certs` | پوشهٔ گواهی (`fullchain.pem` + `privkey.pem`) |
| `SYNC_INTERVAL` | `60` | فاصلهٔ job پس‌زمینه (انقضا، آمار، همگام‌سازی) |
| `SEED_DEMO_DATA` | `true` | ساخت کاربران نمونه در نصب تازه |
| `SIMULATE_TRAFFIC` | هم‌مقدار `SEED_DEMO_DATA` | رشد تدریجی ترافیک کاربران `demo-*` (فقط نمایشی) |
| `PUBLIC_DOMAIN` | خالی | دامنهٔ عمومی پنل؛ برای ساخت نشانی سابسکریپشن و QR |
| `PANEL_HTTP_PORT` / `PANEL_ALT_PORT` / `BACKEND_PORT` | `80` / `8080` / `8000` | پورت‌های منتشرشده |

---

## 🧭 راهنمای استفاده

### ۱) کاربران
- **کاربر جدید**: نام کاربری، پروتکل/انتقال/امنیت (به‌صورت پیش‌فرض از «سرور پیش‌فرض» پر
  می‌شود)، سقف حجم به گیگابایت (۰ = نامحدود)، اعتبار به روز (۰ = نامحدود).
- **لینک‌ها**: برای هر کاربر فقط سرورهایی لینک می‌سازند که **پروتکل + انتقال + لایهٔ
  امنیتی یکسان** داشته باشند؛ در غیر این صورت پنل هشدار می‌دهد.
- **عملیات روی هر کاربر**: فعال/غیرفعال، تمدید (مثلاً ۳۰ روز)، ریست ترافیک،
  تغییر UUID (باطل کردن کانفیگ‌های قبلی)، حذف.
- **ساخت گروهی**: `prefix` + `count` → کاربرانی مثل `user1 … user20`.

### ۲) سرورها (اینباندها)
هر «سرور» در پنل = یک این‌باند در `config.json`. با دکمهٔ **«شناسایی از config.json»**
اینباندهای موجود به پنل اضافه می‌شوند. فیلدها:

- `server_address` — دامنه یا IP واقعی (تا وقتی `YOUR_SERVER_IP` است، پنل هشدار می‌دهد)
- `inbound_tag` — تگ این‌باند در کانفیگ (دقیق‌ترین راه تطبیق)
- `sni`، `path`، `host`، `service_name` (gRPC)
- برای REALITY: `publicKey` (از `privateKey` مشتق می‌شود)، `shortId`، `dest`، `serverNames`

با ذخیرهٔ هر سرور، `config.json` بازنویسی و هسته ری‌استارت می‌شود.

### ۳) هستهٔ Xray
- **همگام‌سازی**: همهٔ کاربران فعال را در این‌باندها می‌ریزد.
- **تست کانفیگ**: `xray -test` داخل کانتینر.
- **ری‌استارت**: از طریق docker socket.
- **ویرایشگر config.json**: ذخیره با پشتیبان‌گیری خودکار در `data/xray-backup/`.

### ۴) اشتراک (Subscription)
برای هر کاربر یک نشانی عمومی و بدون لاگین وجود دارد:

```
http://<server>/sub/<sub_id>          # base64 — برای اپلیکیشن‌ها
http://<server>/sub/<sub_id>/links    # متن ساده — برای تست با curl
http://<server>/sub/<sub_id>/info     # JSON وضعیت (حجم/انقضا/لینک‌ها)
http://<server>/sub/<sub_id>/qrcode.png
http://<server>/share/<sub_id>        # صفحهٔ آمادهٔ ارسال به کاربر
```

این نشانی را در اپلیکیشن به‌عنوان **Subscription** اضافه کنید تا با هر تغییر در پنل،
کانفیگ‌ها خودکار به‌روز شوند.

---

## 🔌 API

مستندات زندهٔ Swagger در `/docs` (پشت nginx هم در دسترس است). همهٔ روت‌های `/api/*`
به‌جز `login` و `health` نیازمند هدر `Authorization: Bearer <token>` هستند.

<details>
<summary>فهرست کامل روت‌ها</summary>

| متد | مسیر | توضیح |
| --- | --- | --- |
| GET | `/api/health` | سلامت سرویس |
| GET | `/api/meta` | گزینه‌های فرم‌ها و تنظیمات پنل |
| POST | `/api/auth/login` | ورود و دریافت JWT |
| GET | `/api/auth/me` | اطلاعات مدیر فعلی |
| POST | `/api/auth/change-password` | تغییر رمز مدیر |
| GET | `/api/dashboard` | آمار، نمودار، پرمصرف‌ها، وضعیت هسته |
| GET | `/api/users` | فهرست + `search`/`status`/`protocol`/`sort`/`skip`/`limit` |
| POST | `/api/users` | ساخت کاربر |
| POST | `/api/users/bulk` | ساخت گروهی |
| GET/PUT/DELETE | `/api/users/{id}` | مشاهده / ویرایش / حذف |
| POST | `/api/users/{id}/toggle` | فعال یا غیرفعال |
| POST | `/api/users/{id}/extend` | تمدید (`{"days": 30}`، صفر = نامحدود) |
| POST | `/api/users/{id}/reset-traffic` | صفر کردن شمارندهٔ ترافیک |
| PUT | `/api/users/{id}/traffic` | ثبت دستی ترافیک (بایت) |
| POST | `/api/users/{id}/rotate-uuid` | ساخت UUID جدید |
| GET | `/api/users/{id}/links` | لینک‌های سازگار |
| GET | `/api/users/{id}/qrcode` | QR (`fmt=png|svg`، `content=link|subscription`) |
| GET | `/api/users/{id}/config.json` | کانفیگ کامل کلاینت |
| GET | `/api/users/{id}/subscription` | پیش‌نمایش سابسکریپشن |
| GET/POST | `/api/servers` | فهرست / افزودن سرور |
| GET | `/api/servers/detect` | این‌باندهای موجود در کانفیگ |
| POST | `/api/servers/import` | وارد کردن این‌باندها به پنل |
| PUT/DELETE | `/api/servers/{id}` | ویرایش / حذف |
| POST | `/api/servers/{id}/set-default` | تعیین سرور پیش‌فرض |
| POST | `/api/servers/{id}/reality-keys` | چرخش کلیدهای REALITY |
| GET | `/api/xray/status` | وضعیت کانتینر، کانفیگ، گواهی |
| GET/PUT | `/api/xray/config` | خواندن / ذخیرهٔ `config.json` |
| POST | `/api/xray/restart` · `/test` · `/sync` · `/reality-keys` | کنترل هسته |
| GET | `/api/xray/logs` | دنبال کردن لاگ هسته |
| GET | `/api/audit` | رویدادهای پنل |
| GET | `/sub/{sub_id}` (+ `/links` `/info` `/qrcode.png`) | endpoints عمومی |
| GET | `/share/{sub_id}` | صفحهٔ اشتراک کاربر |

</details>

نمونه:

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | jq -r .access_token)

curl -s -X POST http://localhost:8000/api/users \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"username":"ali","protocol":"vless","network":"ws","security":"tls","data_limit":50,"expire_days":30}' | jq .links
```

---

## 🔐 امنیت

1. `SECRET_KEY` را عوض کنید — در غیر این صورت هر کسی می‌تواند توکن معتبر بسازد.
2. بلافاصله بعد از اولین ورود، رمز مدیر را از **تنظیمات ← تغییر رمز عبور** عوض کنید.
3. پورت `8000` (بک‌اند) را با فایروال **فقط برای localhost** باز بگذارید و از طریق
   nginx به پنل دسترسی داشته باشید؛ یا `ports` مربوط به backend را از
   `docker-compose.yml` حذف کنید.
4. گواهی خودامضا فقط برای تست است؛ برای دامنهٔ واقعی گواهی Let's Encrypt بسازید:
   ```bash
   # با acme.sh روی هاست
   acme.sh --issue -d vpn.example.com --standalone
   acme.sh --install-cert -d vpn.example.com \
     --fullchain-file ./certs/fullchain.pem \
     --key-file       ./certs/privkey.pem \
     --reloadcmd      "docker restart xray-core"
   ```
5. `/var/run/docker.sock` به بک‌اند mount شده است؛ یعنی پنل روی داکر هاست اختیار کامل
   دارد. سرور را فقط در اختیار افراد مورد اعتماد بگذارید (یا این mount را حذف کنید؛
   در آن صورت فقط «ری‌استارت هسته» از کار می‌افتد).
6. پنل را پشت HTTPS ببرید (یک reverse proxy با TLS روی دامنه) تا توکن‌ها به‌صورت متنِ ساده جابه‌جا نشوند.
7. برای REALITY از `dest`/`serverNames` معتبر استفاده کنید و کلید خصوصی را در جای امن نگه دارید.

---

## 📊 آمار ترافیک

- «آخرین اتصال» کاربران از روی `access.log` هسته به‌دست می‌آید
  (mount شده از `./data/xray-log`).
- شمارنده‌های حجم را می‌توانید دستی از API ثبت کنید:
  `PUT /api/users/{id}/traffic` با `{"upload": <bytes>, "download": <bytes>}`.
- `config.json` به‌صورت پیش‌فرض `stats` و API gRPC را روی پورت `10085`
  (فقط داخل شبکهٔ داکر) فعال دارد. اگر می‌خواهید حجم‌ها خودکار از خودِ هسته خوانده
  شوند، `grpcio` را در `backend/requirements.txt` از کامنت خارج کنید و یک کالکتر
  خارجی بنویسید که هر دقیقه `stats` را بخواند و روی همان endpoint ثبت کند.
- در حالت دمو (`SEED_DEMO_DATA=true`) ترافیک کاربران `demo-*` به‌صورت شبیه‌سازی‌شده رشد
  می‌کند تا نمودارها خالی نباشند — نشانگر «دمو» در نوار بالای پنل این حالت را یادآوری می‌کند.

---

## 🧪 تست‌ها

```bash
cd backend
python tests/test_smoke.py      # یا: pytest tests/test_smoke.py -q
```

تست‌ها روی یک دیتابیس موقت و یک کپی از `config.json` اجرا می‌شوند و این موارد را
پوشش می‌دهند: احراز هویت، import این‌باندها، سازگاری لینک‌ها با این‌باند، CRUD کاربر،
نوشتن/حذف کلاینت‌ها در `config.json`، QR، سابسکریپشن عمومی، سرورها، کلیدهای REALITY،
ویرایشگر کانفیگ، تغییر رمز و ساخت گواهی.

---

## 🩺 عیب‌یابی

| مشکل | علت / راه‌حل |
| --- | --- |
| `xray` بالا نمی‌آید | `docker logs xray-core` — معمولاً گواهی نبود یا کانفیگ نامعتبر؛ از «تست کانفیگ» در پنل استفاده کنید |
| «docker is not available» | `/var/run/docker.sock` به backend mount نشده یا `XRAY_CONTAINER_NAME` اشتباه است |
| کانفیگ کاربر کار نمی‌کند | `server_address` هنوز `YOUR_SERVER_IP` است، یا ترکیب پروتکل/انتقال/امنیت کاربر با این‌باند نمی‌خواند |
| لینک ساخته نمی‌شود | هیچ سرور **فعالِ سازگار** با آن کاربر وجود ندارد (هشدار در پنل نمایش داده می‌شود) |
| سابسکریپشن در اپ باز نمی‌شود | `PUBLIC_DOMAIN` را در `.env` تنظیم و سرویس‌ها را `docker compose restart backend nginx` کنید |
| تغییرات در هسته اعمال نمی‌شود | دکمهٔ «همگام‌سازی» و سپس «ری‌استارت هسته» در صفحهٔ هستهٔ Xray |
| پورت 80 اشغال است | `PANEL_HTTP_PORT=8081` در `.env` یا استفاده از پورت `8080` |

بازگردانی کانفیگ خراب:

```bash
ls data/xray-backup/                       # ۱۰ نسخهٔ آخر
cp data/xray-backup/config-<timestamp>.json xray/config.json
docker compose restart xray
```

---

## 🗺 محدودیت‌ها

- مدیریت چند-سروری (چند هستهٔ Xray روی ماشین‌های مختلف) هنوز پشتیبانی نمی‌شود؛
  «سرورها» در این پنل این‌باندهای **یک** هسته هستند.
- خواندن خودکار حجم ترافیک از API gRPC هسته اختیاری است (به `grpcio` نیاز دارد).
- رابط کاربری بدون build است (vanilla JS) تا روی هر هاستی بدون Node اجرا شود.

---

## 📄 لایسنس

MIT — با مسئولیت خودتان استفاده کنید.
