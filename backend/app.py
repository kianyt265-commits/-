"""V2Box Panel — FastAPI backend.

Run locally :  uvicorn app:app --host 0.0.0.0 --port 8000 --reload
Run in docker:  docker compose up -d --build
API docs    :  http://localhost:8000/docs
"""

import asyncio
import datetime
import io
import json
import os
import random
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import certs
import xray_manager
from auth import (
    ACCESS_TOKEN_EXPIRE_HOURS,
    create_access_token,
    hash_password,
    verify_password,
    verify_token,
)
from config_generator import ConfigGenerator, human_bytes
from models import (
    Admin,
    AuditLog,
    ServerConfig,
    SessionLocal,
    TrafficSnapshot,
    User,
    init_db,
)

try:
    import qrcode
    import qrcode.image.svg

    HAS_QRCODE = True
except ImportError:  # pragma: no cover
    HAS_QRCODE = False

try:
    from PIL import Image  # noqa: F401

    HAS_PIL = True
except ImportError:  # pragma: no cover
    HAS_PIL = False


# ==================== configuration ====================
XRAY_CONFIG_PATH = os.getenv("XRAY_CONFIG_PATH", "./xray/config.json")
SYNC_INTERVAL = int(os.getenv("SYNC_INTERVAL", "60"))
SEED_DEMO_DATA = os.getenv("SEED_DEMO_DATA", "false").lower() in ("1", "true", "yes")
# opt-in only: grows the counters of the seeded sample users for screenshots
SIMULATE_TRAFFIC = os.getenv("SIMULATE_TRAFFIC", "false").lower() in ("1", "true", "yes")
PUBLIC_DOMAIN = os.getenv("PUBLIC_DOMAIN", "").strip()
# BUILDER_ONLY=true turns the panel into a pure config generator:
# no config.json rewriting, no docker restarts — just users, links, QR and subs.
BUILDER_ONLY = os.getenv("BUILDER_ONLY", "false").lower() in ("1", "true", "yes")
XRAY_ACCESS_LOG = os.getenv("XRAY_ACCESS_LOG", "/var/log/xray/access.log")
FRONTEND_DIR = os.getenv(
    "FRONTEND_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
)
SERVE_FRONTEND = os.getenv("SERVE_FRONTEND", "true").lower() in ("1", "true", "yes")
GB = 1024 ** 3

PROTOCOLS = ["vless", "vmess", "trojan", "shadowsocks"]
NETWORKS = ["ws", "tcp", "grpc", "h2", "httpupgrade"]
SECURITIES = ["tls", "reality", "none"]
FLOWS = ["", "xtls-rprx-vision", "xtls-rprx-vision-udp443"]
CIPHERS = [
    "chacha20-ietf-poly1305", "aes-256-gcm", "aes-128-gcm",
    "xchacha20-ietf-poly1305", "2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm",
]
FINGERPRINTS = ["chrome", "firefox", "safari", "edge", "ios", "android", "random", "randomized"]

USERNAME_RE = re.compile(r"^[A-Za-z0-9._\-@]{2,64}$")
LOG_LINE_RE = re.compile(r"\[(?P<tag>[^\]]+)\]\s*(?P<email>[^\s\[\]]+)\s*$")


def utcnow() -> datetime.datetime:
    return datetime.datetime.utcnow()


# ==================== database dependency ====================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def audit(db: Session, actor: str, action: str, target: str = "", detail: str = "") -> None:
    """Fire-and-forget audit trail entry."""
    try:
        db.add(AuditLog(actor=actor, action=action, target=target or None, detail=(detail or "")[:2000]))
        db.commit()
    except Exception:
        db.rollback()


# ==================== xray helpers ====================
def apply_xray_config(db: Session, restart: bool = True) -> Dict[str, Any]:
    """Push every active user into config.json and (optionally) restart xray."""
    if BUILDER_ONLY:
        return {"ok": True, "changed": False, "restart": None, "builder_only": True,
                "message": "حالت کانفیگ‌ساز: تغییری در xray داده نشد"}
    users = db.query(User).all()
    servers = db.query(ServerConfig).all()
    try:
        report = xray_manager.sync_config(users, servers, XRAY_CONFIG_PATH)
    except xray_manager.XrayConfigError as exc:
        return {"ok": False, "changed": False, "restart": None, "message": str(exc)}
    except Exception as exc:  # pragma: no cover - read-only mount, permissions, ...
        return {"ok": False, "changed": False, "restart": None,
                "message": f"could not write xray config: {exc}"}

    if report.get("changed"):
        db.commit()  # persist inbound_tag values discovered while syncing
        if restart:
            report["restart"] = xray_manager.restart_xray()
        else:
            report["restart"] = None
    else:
        report["restart"] = None
    report["ok"] = True
    return report


def default_server(db: Session) -> Optional[ServerConfig]:
    server = db.query(ServerConfig).filter(ServerConfig.is_default == True).first()  # noqa: E712
    if not server:
        server = db.query(ServerConfig).filter(ServerConfig.is_enabled == True).first()  # noqa: E712
    return server


def active_servers(db: Session) -> List[ServerConfig]:
    return db.query(ServerConfig).filter(ServerConfig.is_enabled == True).all()  # noqa: E712


def public_base_url(request: Request) -> str:
    if PUBLIC_DOMAIN:
        return PUBLIC_DOMAIN.rstrip("/")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost"
    scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    return f"{scheme}://{host}"


def subscription_url_from_db(sub_id: str) -> str:
    """Relative URL when PUBLIC_DOMAIN is unknown (frontend prefixes the origin)."""
    base = PUBLIC_DOMAIN.rstrip("/")
    return f"{base}/sub/{sub_id}" if base else f"/sub/{sub_id}"


# ==================== links & qr codes ====================
def build_user_links(db: Session, user: User, server_id: Optional[str] = None) -> List[Dict[str, str]]:
    servers = active_servers(db)
    if server_id:
        servers = [s for s in servers if s.id == server_id]
    if not servers:
        servers = db.query(ServerConfig).all()
    return ConfigGenerator.generate_all_links(user, servers)


def user_warnings(db: Session, user: User) -> List[str]:
    """Things the admin should know about a freshly saved user."""
    warnings: List[str] = []
    servers = active_servers(db)
    if not servers:
        warnings.append("هیچ سرور فعالی وجود ندارد — ابتدا یک سرور اضافه کنید")
    elif not any(ConfigGenerator.is_compatible(user, s) for s in servers):
        warnings.append(
            f"هیچ این‌باندی با ترکیب {user.protocol}/{user.network}/{user.security} این کاربر "
            "سازگار نیست؛ کانفیگی تولید نمی‌شود"
        )
    for server in servers:
        if str(server.server_address).strip().upper() in ("YOUR_SERVER_IP", "127.0.0.1", "LOCALHOST", ""):
            warnings.append(f"آدرس سرور «{server.server_name}» هنوز واقعی نیست ({server.server_address})")
            break
    if user.security == "reality" and user.protocol == "vless" and not user.flow:
        warnings.append("برای vless/reality معمولاً flow=xtls-rprx-vision لازم است")
    return warnings


def is_ip_literal(value: str) -> bool:
    import ipaddress

    try:
        ipaddress.ip_address((value or "").strip())
        return True
    except ValueError:
        return False


def server_warnings(server: ServerConfig) -> List[str]:
    """Things that would stop this server from producing working configs."""
    warnings: List[str] = []
    address = (server.server_address or "").strip()
    security = (server.security or "none").lower()
    if address.upper() in ("YOUR_SERVER_IP", "LOCALHOST", ""):
        warnings.append("آدرس سرور هنوز تنظیم نشده است")
    if is_ip_literal(address) and security == "tls":
        warnings.append(
            "TLS بدون دامنه کار نمی‌کند — گواهی معتبر به دامنه نیاز دارد. "
            "اگر دامنه ندارید لایهٔ امنیتی را روی REALITY بگذارید."
        )
    if security == "reality" and not server.reality_public_key:
        warnings.append("کلید REALITY ساخته نشده است")
    if (server.network or "").lower() == "grpc" and not server.service_name:
        warnings.append("برای gRPC یک serviceName لازم است")
    if (server.network or "").lower() in ("ws", "h2", "httpupgrade") and (server.path or "/") in ("", None):
        warnings.append("مسیر (path) برای WebSocket خالی است")
    return warnings


def make_qrcode(data: str, fmt: str = "png", box_size: int = 10) -> bytes:
    """PNG when Pillow is installed, SVG otherwise (qrcode can do both)."""
    if not HAS_QRCODE:
        raise HTTPException(status_code=501, detail="qrcode library is not installed in the backend")
    if fmt == "svg" or not HAS_PIL:
        image = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage,
                            box_size=box_size, border=2)
        buf = io.BytesIO()
        image.save(buf)
        return buf.getvalue()
    image = qrcode.make(data, box_size=box_size, border=2)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


# ==================== background jobs ====================
async def periodic_sync() -> None:
    """Every SYNC_INTERVAL seconds: expire users, read logs, keep xray in sync."""
    await asyncio.sleep(10)  # let the containers settle first
    while True:
        db = SessionLocal()
        changed = False
        try:
            now = utcnow()

            # 1) auto-disable expired / over-quota users
            for user in db.query(User).all():
                if user.is_active and (user.is_expired(now) or user.is_over_quota()):
                    user.is_active = False
                    changed = True
                    db.add(AuditLog(actor="system", action="auto_disable", target=user.username,
                                    detail="expired" if user.is_expired(now) else "traffic limit reached"))

            # 2) refresh `last_connected` from the xray access log
            changed = collect_access_log(db) or changed

            # 3) opt-in simulator for demo installations
            if SIMULATE_TRAFFIC:
                changed = simulate_sample_traffic(db) or changed

            snapshot_traffic(db)
            db.commit()

            if changed:
                apply_xray_config(db, restart=True)
        except Exception as exc:  # pragma: no cover - never kill the loop
            db.rollback()
            print(f"[sync] error: {exc}", flush=True)
        finally:
            db.close()
        await asyncio.sleep(max(SYNC_INTERVAL, 10))


def collect_access_log(db: Session) -> bool:
    """Parse the tail of the xray access log and refresh `last_connected`."""
    if not os.path.exists(XRAY_ACCESS_LOG):
        return False
    try:
        with open(XRAY_ACCESS_LOG, "r", encoding="utf-8", errors="replace") as fh:
            try:
                fh.seek(-256 * 1024, os.SEEK_END)  # only the last 256 KB
            except OSError:
                fh.seek(0)
            lines = fh.readlines()
    except Exception:
        return False

    seen_emails = set()
    for line in lines[-3000:]:
        match = LOG_LINE_RE.search(line.rstrip())
        if match:
            seen_emails.add(match.group("email"))
    if not seen_emails:
        return False

    touched = False
    now = utcnow()
    for user in db.query(User).all():
        prefix = f"{user.username}."
        if any(email == user.username or email.startswith(prefix) for email in seen_emails):
            if not user.last_connected or (now - user.last_connected).total_seconds() > 60:
                user.last_connected = now
                touched = True
    return touched


def snapshot_traffic(db: Session) -> None:
    """One hourly cumulative sample per user (powers the dashboard chart)."""
    bucket = utcnow().replace(minute=0, second=0, microsecond=0)
    existing = {
        row.user_id: row
        for row in db.query(TrafficSnapshot).filter(TrafficSnapshot.bucket == bucket).all()
    }
    for user in db.query(User).all():
        row = existing.get(user.id)
        if row:
            row.upload = user.upload or 0
            row.download = user.download or 0
        else:
            db.add(TrafficSnapshot(bucket=bucket, user_id=user.id,
                                   upload=user.upload or 0, download=user.download or 0))
            existing[user.id] = True  # avoid duplicates in the same pass


# ==================== bootstrap ====================
def import_servers_from_config(db: Session, address: Optional[str] = None) -> int:
    """Create a ServerConfig row for every proxy inbound found in config.json."""
    rows = xray_manager.extract_servers_from_config(XRAY_CONFIG_PATH)
    host_hint = address or re.sub(r"^https?://", "", PUBLIC_DOMAIN).split("/")[0]
    created: List[ServerConfig] = []
    for data, _inbound in rows:
        tag = data["inbound_tag"]
        if tag and db.query(ServerConfig).filter(ServerConfig.inbound_tag == tag).first():
            continue
        server = ServerConfig(server_address=host_hint or "YOUR_SERVER_IP", **data)
        db.add(server)
        created.append(server)
    if not created:
        return 0

    db.commit()
    if not db.query(ServerConfig).filter(ServerConfig.is_default == True).first():  # noqa: E712
        # the friendliest default: vless over websocket + tls
        default = next(
            (s for s in created if (s.protocol, s.network, s.security) == ("vless", "ws", "tls")),
            created[0],
        )
        default.is_default = True
        db.commit()
    return len(created)


# A realistic starting dataset (SEED_DEMO_DATA=true): every user sits on an
# inbound that actually exists in xray/config.json, with plausible traffic,
# expiry and status so the panel is usable — and demonstrable — right away.
SAMPLE_USERS = [
    # username,         protocol, network, security,   limit_gb, expire_days, active, used_gb, made_days_ago, last_seen_min
    ("ali.rezaei",      "vless",  "ws",    "tls",        100,      62,       True,    38.4,    96,     42),
    ("sara.karimi",     "vless",  "tcp",   "reality",    200,      18,       True,   121.7,    40,      7),
    ("reza.mousavi",    "vmess",  "ws",    "tls",         50,       2,       True,    44.2,    30,    180),
    ("mina.ahmadi",     "trojan", "tcp",   "tls",         30,      -6,       False,   31.5,   120,   8600),
    ("hamed.nouri",     "vless",  "grpc",  "tls",          0,       0,       True,   210.9,   210,      8),
    ("negar.sadeghi",   "vless",  "ws",    "tls",         75,      11,       True,    71.2,    12,     65),
    ("amir.torabi",     "vless",  "tcp",   "reality",     40,      85,       False,    9.1,   200,  20100),
    ("yasmin.farahi",   "vless",  "grpc",  "tls",         60,      25,       True,    17.3,    25,    320),
]
SAMPLE_USERNAMES = [row[0] for row in SAMPLE_USERS]


def seed_sample_data(db: Session) -> int:
    """Insert the sample users + a week of traffic history. Returns the count."""
    if not default_server(db):
        return 0
    now = utcnow()
    created = 0
    for (username, protocol, network, security, limit_gb, expire_days,
         is_active, used_gb, made_days_ago, last_seen_min) in SAMPLE_USERS:
        if db.query(User).filter(User.username == username).first():
            continue
        used_bytes = int(used_gb * GB)
        upload = int(used_bytes * 0.08)
        download = used_bytes - upload
        db.add(User(
            username=username,
            protocol=protocol,
            network=network,
            security=security,
            flow="xtls-rprx-vision" if (protocol == "vless" and security == "reality") else "",
            fingerprint="chrome",
            data_limit=limit_gb * GB if limit_gb else 0,
            upload=upload,
            download=download,
            data_used=used_bytes,
            expire_date=now + datetime.timedelta(days=expire_days) if expire_days else None,
            is_active=is_active,
            max_connections=3 if limit_gb >= 100 else 2,
            created_at=now - datetime.timedelta(days=made_days_ago),
            last_connected=now - datetime.timedelta(minutes=last_seen_min),
        ))
        created += 1
    db.commit()
    seed_traffic_history(db, days=7)
    return created


def seed_traffic_history(db: Session, days: int = 7) -> None:
    """Cumulative hourly samples for the last week, so the chart is not empty."""
    if db.query(TrafficSnapshot).count():
        return
    now = utcnow().replace(minute=0, second=0, microsecond=0)
    for user in db.query(User).all():
        up_total, down_total = user.upload or 0, user.download or 0
        if not up_total + down_total:
            continue
        for day in range(days, -1, -1):
            progress = (days - day) / days
            curve = 0.12 + 0.88 * (progress ** 0.85)  # starts above zero, like real usage
            db.add(TrafficSnapshot(
                bucket=now - datetime.timedelta(days=day),
                user_id=user.id,
                upload=int(up_total * curve),
                download=int(down_total * curve),
            ))
    db.commit()


def simulate_sample_traffic(db: Session) -> bool:
    """SIMULATE_TRAFFIC=true only: slowly grows the sample users' counters."""
    touched = False
    for user in db.query(User).filter(User.username.in_(SAMPLE_USERNAMES)).all():
        if not user.is_active:
            continue
        up = random.randint(2, 90) * 1024 * 1024
        down = random.randint(20, 600) * 1024 * 1024
        user.upload = (user.upload or 0) + up
        user.download = (user.download or 0) + down
        user.data_used = (user.data_used or 0) + up + down
        user.last_connected = utcnow()
        touched = True
    return touched


def bootstrap(db: Session) -> None:
    """First admin + import of the shipped xray inbounds + optional sample data."""
    init_db()

    # xray cannot start a TLS inbound without a certificate — create a
    # self-signed one on first boot (replace it with a real cert later)
    try:
        cert = certs.ensure_cert()
        if cert.get("created"):
            print(f"[boot] self-signed certificate created in {certs.CERT_DIR}", flush=True)
    except Exception as exc:  # pragma: no cover - read-only mount, no cryptography
        print(f"[boot] certificate bootstrap skipped: {exc}", flush=True)

    admin_username = os.getenv("ADMIN_USERNAME", "admin")
    if not db.query(Admin).filter(Admin.username == admin_username).first():
        db.add(Admin(
            username=admin_username,
            hashed_password=hash_password(os.getenv("ADMIN_PASSWORD", "admin123")),
            is_superadmin=True,
        ))
        db.commit()
        print(f"[boot] admin '{admin_username}' created", flush=True)

    if db.query(ServerConfig).count() == 0:
        count = import_servers_from_config(db)
        print(f"[boot] imported {count} inbound(s) from {XRAY_CONFIG_PATH}", flush=True)

    if SEED_DEMO_DATA and db.query(User).count() == 0:
        count = seed_sample_data(db)
        print(f"[boot] {count} sample user(s) + 7 days of traffic history seeded", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        bootstrap(db)
    finally:
        db.close()
    task = asyncio.create_task(periodic_sync())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="V2Box Panel",
    version="2.0.0",
    description="Admin panel for building V2Ray / V2Box configurations "
                "(vless · vmess · trojan · shadowsocks)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "profile-title", "profile-update-interval", "subscription-userinfo",
        "content-disposition", "profile-web-page-url",
    ],
)


@app.exception_handler(xray_manager.XrayConfigError)
async def xray_config_error_handler(request: Request, exc: xray_manager.XrayConfigError):
    return JSONResponse(status_code=500, content={"detail": str(exc)})


# ==================== schemas ====================
class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    protocol: str = "vless"
    network: str = "ws"
    security: str = "tls"
    flow: str = ""
    method: str = "chacha20-ietf-poly1305"
    fingerprint: str = "chrome"
    data_limit: int = 0        # GB, 0 = unlimited
    expire_days: int = 0       # 0 = unlimited
    max_connections: int = 2
    email: Optional[str] = None
    remark: Optional[str] = None
    server_id: Optional[str] = None
    is_active: bool = True

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        value = (value or "").strip()
        if not USERNAME_RE.match(value):
            raise ValueError("username may only contain letters, digits and . _ - @")
        return value

    @field_validator("protocol")
    @classmethod
    def check_protocol(cls, value: str) -> str:
        value = (value or "vless").lower()
        if value not in PROTOCOLS:
            raise ValueError(f"protocol must be one of {PROTOCOLS}")
        return value

    @field_validator("network")
    @classmethod
    def check_network(cls, value: str) -> str:
        value = (value or "ws").lower()
        if value not in NETWORKS:
            raise ValueError(f"network must be one of {NETWORKS}")
        return value

    @field_validator("security")
    @classmethod
    def check_security(cls, value: str) -> str:
        value = (value or "none").lower()
        if value not in SECURITIES:
            raise ValueError(f"security must be one of {SECURITIES}")
        return value


class BulkUserCreate(BaseModel):
    prefix: str = "user"
    count: int = Field(default=5, ge=1, le=200)
    protocol: str = "vless"
    network: str = "ws"
    security: str = "tls"
    data_limit: int = 0
    expire_days: int = 0
    max_connections: int = 2


class UserUpdate(BaseModel):
    is_active: Optional[bool] = None
    protocol: Optional[str] = None
    network: Optional[str] = None
    security: Optional[str] = None
    flow: Optional[str] = None
    method: Optional[str] = None
    fingerprint: Optional[str] = None
    data_limit: Optional[int] = None       # GB
    expire_days: Optional[int] = None      # from now; <=0 removes the expiry
    expire_date: Optional[str] = None      # ISO date, wins over expire_days
    max_connections: Optional[int] = None
    email: Optional[str] = None
    remark: Optional[str] = None
    add_traffic_gb: Optional[int] = None


class TrafficUpdate(BaseModel):
    upload: Optional[int] = None           # bytes
    download: Optional[int] = None         # bytes
    data_used: Optional[int] = None        # bytes
    reset: bool = False


class ServerCreate(BaseModel):
    server_name: str
    server_address: str
    server_port: int = 443
    protocol: str = "vless"
    network: str = "ws"
    security: str = "tls"
    sni: str = ""
    path: str = "/"
    host: str = ""
    service_name: str = ""
    fingerprint: str = "chrome"
    method: str = "chacha20-ietf-poly1305"
    reality_public_key: str = ""
    reality_private_key: str = ""
    reality_short_id: str = ""
    reality_target: str = "www.microsoft.com:443"
    reality_server_names: str = ""
    inbound_tag: str = ""
    is_default: bool = False
    is_enabled: bool = True

    @field_validator("server_name", "server_address")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not (value or "").strip():
            raise ValueError("this field is required")
        return value.strip()


class ServerUpdate(BaseModel):
    server_name: Optional[str] = None
    server_address: Optional[str] = None
    server_port: Optional[int] = None
    protocol: Optional[str] = None
    network: Optional[str] = None
    security: Optional[str] = None
    sni: Optional[str] = None
    path: Optional[str] = None
    host: Optional[str] = None
    service_name: Optional[str] = None
    fingerprint: Optional[str] = None
    method: Optional[str] = None
    reality_public_key: Optional[str] = None
    reality_private_key: Optional[str] = None
    reality_short_id: Optional[str] = None
    reality_target: Optional[str] = None
    reality_server_names: Optional[str] = None
    inbound_tag: Optional[str] = None
    is_default: Optional[bool] = None
    is_enabled: Optional[bool] = None


class RawConfigUpdate(BaseModel):
    config: Dict[str, Any]
    restart: bool = True


class ExtendRequest(BaseModel):
    days: int = Field(..., ge=-3650, le=3650)


# ==================== health & meta ====================
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "app": "V2Box Panel",
        "version": app.version,
        "time": utcnow().isoformat(),
        "qrcode": HAS_QRCODE,
        "pillow": HAS_PIL,
        "docker": xray_manager.docker_available(),
    }


@app.get("/api/meta")
async def meta(admin: str = Depends(verify_token)):
    return {
        "protocols": PROTOCOLS,
        "networks": NETWORKS,
        "securities": SECURITIES,
        "flows": FLOWS,
        "ciphers": CIPHERS,
        "fingerprints": FINGERPRINTS,
        "demo_mode": SEED_DEMO_DATA,
        "simulate_traffic": SIMULATE_TRAFFIC,
        "builder_only": BUILDER_ONLY,
        "sync_interval": SYNC_INTERVAL,
        "xray_config_path": XRAY_CONFIG_PATH,
        "public_domain": PUBLIC_DOMAIN,
        "token_expire_hours": ACCESS_TOKEN_EXPIRE_HOURS,
        "qrcode": HAS_QRCODE,
        "pillow": HAS_PIL,
        "docker": xray_manager.docker_available(),
    }


# ==================== auth routes ====================
@app.post("/api/auth/login")
async def login(request: LoginRequest, db: Session = Depends(get_db)):
    admin = db.query(Admin).filter(Admin.username == request.username).first()
    if not admin or not verify_password(request.password, admin.hashed_password):
        audit(db, request.username, "login_failed")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    admin.last_login = utcnow()
    db.commit()
    audit(db, admin.username, "login")
    return {
        "access_token": create_access_token(
            data={"sub": admin.username, "super": bool(admin.is_superadmin)}
        ),
        "token_type": "bearer",
        "username": admin.username,
        "is_superadmin": bool(admin.is_superadmin),
        "expires_in_hours": ACCESS_TOKEN_EXPIRE_HOURS,
    }


@app.get("/api/auth/me")
async def me(admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    row = db.query(Admin).filter(Admin.username == admin).first()
    if not row:
        raise HTTPException(status_code=404, detail="Admin not found")
    return {
        "username": row.username,
        "is_superadmin": bool(row.is_superadmin),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_login": row.last_login.isoformat() if row.last_login else None,
    }


@app.post("/api/auth/change-password")
async def change_password(
    payload: PasswordChange,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    row = db.query(Admin).filter(Admin.username == admin).first()
    if not row or not verify_password(payload.current_password, row.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    row.hashed_password = hash_password(payload.new_password)
    db.commit()
    audit(db, admin, "password_changed")
    return {"message": "Password updated", "username": admin}


# ==================== dashboard ====================
@app.get("/api/dashboard")
async def get_dashboard(admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    now = utcnow()
    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()  # noqa: E712
    total_servers = db.query(ServerConfig).count()
    enabled_servers = db.query(ServerConfig).filter(ServerConfig.is_enabled == True).count()  # noqa: E712

    total_upload = int(db.query(func.sum(User.upload)).scalar() or 0)
    total_download = int(db.query(func.sum(User.download)).scalar() or 0)
    expired_users = db.query(User).filter(
        User.expire_date != None, User.expire_date < now  # noqa: E711
    ).count()
    expiring_soon = db.query(User).filter(
        User.expire_date != None,  # noqa: E711
        User.expire_date >= now,
        User.expire_date <= now + datetime.timedelta(days=3),
    ).count()
    limited_users = db.query(User).filter(User.data_limit > 0, User.data_used >= User.data_limit).count()
    online_recent = db.query(User).filter(
        User.last_connected >= now - datetime.timedelta(minutes=10)
    ).count()

    protocols = {
        (proto or "vless"): count
        for proto, count in db.query(User.protocol, func.count(User.id)).group_by(User.protocol).all()
    }

    # 7 day traffic chart — cumulative snapshots aggregated in python (portable)
    since = (now - datetime.timedelta(days=7)).replace(minute=0, second=0, microsecond=0)
    snapshots = (
        db.query(TrafficSnapshot).filter(TrafficSnapshot.bucket >= since).order_by(TrafficSnapshot.bucket).all()
    )
    per_day: Dict[str, Dict[str, int]] = {}
    for snap in snapshots:
        day = snap.bucket.date().isoformat()
        bucket = per_day.setdefault(day, {"upload": 0, "download": 0})
        bucket["upload"] = max(bucket["upload"], snap.upload or 0)
        bucket["download"] = max(bucket["download"], snap.download or 0)
    chart = [
        {"day": day, "upload": v["upload"], "download": v["download"],
         "total": v["upload"] + v["download"]}
        for day, v in sorted(per_day.items())
    ]

    top_users = (
        db.query(User)
        .order_by((func.coalesce(User.upload, 0) + func.coalesce(User.download, 0)).desc())
        .limit(5)
        .all()
    )
    recent_events = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(6).all()
    xray_summary = xray_manager.summarize_config(XRAY_CONFIG_PATH)
    container = xray_manager.container_state()

    return {
        "total_users": total_users,
        "active_users": active_users,
        "inactive_users": total_users - active_users,
        "expired_users": expired_users,
        "expiring_soon": expiring_soon,
        "limited_users": limited_users,
        "online_recent": online_recent,
        "total_servers": total_servers,
        "enabled_servers": enabled_servers,
        "total_upload": total_upload,
        "total_download": total_download,
        "total_traffic": total_upload + total_download,
        "total_traffic_human": human_bytes(total_upload + total_download),
        "protocols": protocols,
        "traffic_chart": chart,
        "top_users": [
            {
                "username": u.username,
                "traffic": int((u.upload or 0) + (u.download or 0)),
                "traffic_human": human_bytes(int((u.upload or 0) + (u.download or 0))),
                "status": u.effective_status(now),
            }
            for u in top_users
        ],
        "recent_events": [e.to_dict() for e in recent_events],
        "xray": {
            "config_ok": xray_summary.get("ok", False),
            "inbounds": xray_summary.get("inbound_count", 0),
            "api_enabled": xray_summary.get("api_enabled", False),
            "stats_enabled": xray_summary.get("stats_enabled", False),
            "container_running": container.get("running", False),
            "container_state": container.get("state", "unknown"),
        },
        "generated_at": now.isoformat(),
    }


# ==================== user CRUD ====================
def _get_user_or_404(db: Session, user_id: str) -> User:
    user = db.query(User).filter(or_(User.id == user_id, User.username == user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.get("/api/users")
async def get_users(
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    search: str = "",
    status: str = "",
    protocol: str = "",
    sort: str = "created_desc",
):
    query = db.query(User)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(or_(User.username.like(like), User.email.like(like), User.uuid_key.like(like)))
    if protocol:
        query = query.filter(User.protocol == protocol.lower())

    now = utcnow()
    if status == "active":
        query = query.filter(User.is_active == True)  # noqa: E712
    elif status == "disabled":
        query = query.filter(User.is_active == False)  # noqa: E712
    elif status == "expired":
        query = query.filter(User.expire_date != None, User.expire_date < now)  # noqa: E711
    elif status == "expiring":
        query = query.filter(
            User.expire_date != None, User.expire_date >= now,  # noqa: E711
            User.expire_date <= now + datetime.timedelta(days=3),
        )
    elif status == "limited":
        query = query.filter(User.data_limit > 0, User.data_used >= User.data_limit)
    elif status == "unlimited":
        query = query.filter(User.expire_date == None, User.data_limit == 0)  # noqa: E711

    total = query.count()
    sorters = {
        "created_desc": User.created_at.desc(),
        "created_asc": User.created_at.asc(),
        "username_asc": User.username.asc(),
        "username_desc": User.username.desc(),
        "traffic_desc": (func.coalesce(User.upload, 0) + func.coalesce(User.download, 0)).desc(),
        "expire_asc": User.expire_date.asc(),
    }
    users = (
        query.order_by(sorters.get(sort, User.created_at.desc()))
        .offset(skip).limit(limit).all()
    )
    return {
        "users": [u.to_dict(now) for u in users],
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": skip + len(users) < total,
    }


def _user_from_payload(data: UserCreate) -> User:
    expire_date = utcnow() + datetime.timedelta(days=data.expire_days) if data.expire_days > 0 else None
    flow = (data.flow or "").strip()
    if data.protocol == "vless" and data.security == "reality" and data.network in ("tcp", "raw"):
        # xtls-rprx-vision is what REALITY needs; default it so links work out of the box
        flow = flow or "xtls-rprx-vision"
    else:
        flow = ""  # invalid anywhere else
    return User(
        username=data.username,
        uuid_key=str(uuid.uuid4()),
        sub_id=secrets.token_hex(10),
        email=data.email,
        remark=data.remark,
        protocol=data.protocol,
        network=data.network,
        security=data.security,
        flow=flow,
        method=data.method if data.protocol == "shadowsocks" else "chacha20-ietf-poly1305",
        fingerprint=data.fingerprint or "chrome",
        data_limit=data.data_limit * GB if data.data_limit > 0 else 0,
        expire_date=expire_date,
        max_connections=max(1, data.max_connections or 1),
        is_active=data.is_active,
    )


@app.post("/api/users")
async def create_user(
    user_data: UserCreate,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.username == user_data.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    server = None
    if user_data.server_id:
        server = db.query(ServerConfig).filter(ServerConfig.id == user_data.server_id).first()
        if not server:
            raise HTTPException(status_code=404, detail="Server not found")
    server = server or default_server(db)
    if not server:
        raise HTTPException(status_code=400,
                            detail="No server is configured yet — add one under 'Servers' first")

    user = _user_from_payload(user_data)
    db.add(user)
    db.commit()
    db.refresh(user)

    report = apply_xray_config(db)
    audit(db, admin, "user_created", user.username,
          f"{user.protocol}/{user.network}/{user.security} limit={user_data.data_limit}GB days={user_data.expire_days}")

    return {
        "id": user.id,
        "username": user.username,
        "uuid_key": user.uuid_key,
        "sub_id": user.sub_id,
        "user": user.to_dict(),
        "links": build_user_links(db, user),
        "warnings": user_warnings(db, user),
        "xray": report,
        "message": "User created successfully",
    }


@app.post("/api/users/bulk")
async def create_users_bulk(
    payload: BulkUserCreate,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    if not default_server(db):
        raise HTTPException(status_code=400, detail="No server is configured yet")

    prefix = re.sub(r"[^A-Za-z0-9._\-]", "", payload.prefix) or "user"
    created: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for index in range(1, payload.count + 1):
        username = f"{prefix}{index}"
        if db.query(User).filter(User.username == username).first():
            skipped.append(username)
            continue
        user = _user_from_payload(UserCreate(
            username=username,
            protocol=payload.protocol,
            network=payload.network,
            security=payload.security,
            data_limit=payload.data_limit,
            expire_days=payload.expire_days,
            max_connections=payload.max_connections,
        ))
        db.add(user)
        db.flush()
        created.append({"id": user.id, "username": user.username,
                        "uuid_key": user.uuid_key, "sub_id": user.sub_id})
    db.commit()

    report = apply_xray_config(db) if created else None
    audit(db, admin, "users_bulk_created", prefix, f"created={len(created)} skipped={len(skipped)}")
    return {"created": created, "count": len(created), "skipped": skipped, "xray": report,
            "message": f"{len(created)} user(s) created"}


@app.get("/api/users/{user_id}")
async def get_user(user_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    user = _get_user_or_404(db, user_id)
    return {
        "user": user.to_dict(),
        "links": build_user_links(db, user),
        "warnings": user_warnings(db, user),
        "subscription": subscription_url_from_db(user.sub_id),
    }


@app.put("/api/users/{user_id}")
async def update_user(
    user_id: str,
    user_data: UserUpdate,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(db, user_id)
    changes: List[str] = []

    if user_data.is_active is not None and user_data.is_active != user.is_active:
        user.is_active = user_data.is_active
        changes.append(f"is_active={user_data.is_active}")
    for field in ("protocol", "network", "security", "method", "fingerprint"):
        value = getattr(user_data, field)
        if value:
            setattr(user, field, value.lower() if field in ("protocol", "network", "security") else value)
            changes.append(f"{field}={value}")
    if user_data.flow is not None and user_data.flow != user.flow:
        user.flow = user_data.flow
        changes.append(f"flow={user.flow or 'none'}")
    if user_data.max_connections is not None:
        user.max_connections = max(1, user_data.max_connections)
        changes.append(f"max_connections={user.max_connections}")
    if user_data.email is not None:
        user.email = user_data.email
        changes.append("email updated")
    if user_data.remark is not None:
        user.remark = user_data.remark
        changes.append("remark updated")
    if user_data.data_limit is not None:
        user.data_limit = user_data.data_limit * GB if user_data.data_limit > 0 else 0
        changes.append(f"data_limit={user_data.data_limit}GB")
    if user_data.add_traffic_gb:
        user.data_used = (user.data_used or 0) + user_data.add_traffic_gb * GB
        changes.append(f"+{user_data.add_traffic_gb}GB used")

    if user_data.expire_date:
        try:
            user.expire_date = datetime.datetime.fromisoformat(user_data.expire_date.replace("Z", ""))
            changes.append(f"expire_date={user.expire_date.date()}")
        except ValueError:
            raise HTTPException(status_code=400, detail="expire_date must be an ISO-8601 date")
    elif user_data.expire_days is not None:
        if user_data.expire_days <= 0:
            user.expire_date = None
            changes.append("expiry removed")
        else:
            user.expire_date = utcnow() + datetime.timedelta(days=user_data.expire_days)
            changes.append(f"expires in {user_data.expire_days} day(s)")

    db.commit()
    db.refresh(user)

    report = apply_xray_config(db)
    audit(db, admin, "user_updated", user.username, ", ".join(changes))
    return {
        "user": user.to_dict(),
        "links": build_user_links(db, user),
        "warnings": user_warnings(db, user),
        "xray": report,
        "changes": changes,
        "message": "User updated successfully",
    }


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    user = _get_user_or_404(db, user_id)
    username = user.username
    db.query(TrafficSnapshot).filter(TrafficSnapshot.user_id == user.id).delete()
    db.delete(user)
    db.commit()
    report = apply_xray_config(db)
    audit(db, admin, "user_deleted", username)
    return {"message": f"User '{username}' deleted", "username": username, "xray": report}


@app.post("/api/users/{user_id}/toggle")
async def toggle_user(user_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    user = _get_user_or_404(db, user_id)
    user.is_active = not bool(user.is_active)
    db.commit()
    report = apply_xray_config(db)
    audit(db, admin, "user_toggled", user.username, f"is_active={user.is_active}")
    return {"user": user.to_dict(), "xray": report,
            "message": "کاربر فعال شد" if user.is_active else "کاربر غیرفعال شد"}


@app.post("/api/users/{user_id}/reset-traffic")
async def reset_traffic(user_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    user = _get_user_or_404(db, user_id)
    user.upload = 0
    user.download = 0
    user.data_used = 0
    if not user.is_active and not user.is_expired():
        user.is_active = True
    db.commit()
    report = apply_xray_config(db)
    audit(db, admin, "traffic_reset", user.username)
    return {"user": user.to_dict(), "xray": report, "message": "Traffic counter reset"}


@app.put("/api/users/{user_id}/traffic")
async def set_traffic(
    user_id: str,
    payload: TrafficUpdate,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    """Manual traffic accounting — also the hook for an external stats collector."""
    user = _get_user_or_404(db, user_id)
    if payload.reset:
        user.upload = user.download = user.data_used = 0
    if payload.upload is not None:
        user.upload = max(0, payload.upload)
    if payload.download is not None:
        user.download = max(0, payload.download)
    if payload.data_used is not None:
        user.data_used = max(0, payload.data_used)
    elif not payload.reset:
        user.data_used = (user.upload or 0) + (user.download or 0)
    db.commit()
    db.refresh(user)
    audit(db, admin, "traffic_updated", user.username, f"up={user.upload} down={user.download}")
    return {"user": user.to_dict(), "message": "Traffic updated"}


@app.post("/api/users/{user_id}/extend")
async def extend_user(
    user_id: str,
    payload: ExtendRequest,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    """Add days to the subscription (negative = subtract, 0 = make it unlimited)."""
    user = _get_user_or_404(db, user_id)
    now = utcnow()
    if payload.days == 0:
        user.expire_date = None
    else:
        base = user.expire_date if (user.expire_date and user.expire_date > now) else now
        user.expire_date = base + datetime.timedelta(days=payload.days)
    if user.expire_date and user.expire_date > now and not user.is_over_quota():
        user.is_active = True
    db.commit()
    report = apply_xray_config(db)
    audit(db, admin, "user_extended", user.username, f"days={payload.days}")
    return {"user": user.to_dict(), "xray": report,
            "message": f"Subscription updated ({payload.days} day(s))"}


@app.post("/api/users/{user_id}/rotate-uuid")
async def rotate_uuid(user_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    user = _get_user_or_404(db, user_id)
    user.uuid_key = str(uuid.uuid4())
    db.commit()
    report = apply_xray_config(db)
    audit(db, admin, "uuid_rotated", user.username, user.uuid_key)
    return {"user": user.to_dict(), "links": build_user_links(db, user), "xray": report,
            "message": "New UUID generated — the previous configs stop working"}


@app.get("/api/users/{user_id}/links")
async def user_links(
    user_id: str,
    server_id: Optional[str] = None,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(db, user_id)
    return {
        "username": user.username,
        "links": build_user_links(db, user, server_id),
        "subscription": subscription_url_from_db(user.sub_id),
    }


@app.get("/api/users/{user_id}/qrcode")
async def user_qrcode(
    user_id: str,
    server_id: Optional[str] = None,
    index: int = Query(0, ge=0),
    content: str = Query("link", pattern="^(link|subscription)$"),
    fmt: str = Query("png", pattern="^(png|svg)$"),
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(db, user_id)
    if content == "subscription":
        data = public_base_url_from_env(user.sub_id)
    else:
        links = build_user_links(db, user, server_id)
        if not links:
            raise HTTPException(status_code=400, detail="No link available for this user")
        data = links[min(index, len(links) - 1)]["link"]

    raw = make_qrcode(data, fmt)
    media = "image/png" if (fmt == "png" and HAS_PIL) else "image/svg+xml"
    return Response(content=raw, media_type=media, headers={"Cache-Control": "no-store"})


def public_base_url_from_env(sub_id: str) -> str:
    """Absolute subscription URL — falls back to a relative path."""
    base = PUBLIC_DOMAIN.rstrip("/")
    if base:
        return f"{base}/sub/{sub_id}"
    return f"/sub/{sub_id}"


@app.get("/api/users/{user_id}/config.json")
async def user_config_json(
    user_id: str,
    server_id: Optional[str] = None,
    index: int = Query(0, ge=0),
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    """Full client JSON, importable in v2rayN / V2Box / Nekoray / Streisand."""
    user = _get_user_or_404(db, user_id)
    servers = active_servers(db)
    if server_id:
        servers = [s for s in servers if s.id == server_id]
    if not servers:
        raise HTTPException(status_code=400, detail="No server configured")
    server = servers[min(index, len(servers) - 1)]
    link = ConfigGenerator.generate_config_link(user, server)
    if not link:
        raise HTTPException(status_code=400, detail="Could not build a link for this protocol")
    return ConfigGenerator.generate_client_json(link, user, server)


@app.get("/api/users/{user_id}/subscription")
async def user_subscription_preview(
    user_id: str,
    request: Request,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(db, user_id)
    links = [item["link"] for item in build_user_links(db, user)]
    return {
        "sub_id": user.sub_id,
        "url": subscription_url_from_db(user.sub_id),
        "absolute_url": f"{public_base_url(request)}/sub/{user.sub_id}",
        "links": links,
        "base64": ConfigGenerator.generate_subscription(links),
        "plain": "\n".join(links),
    }


# ==================== server CRUD ====================
def _get_server_or_404(db: Session, server_id: str) -> ServerConfig:
    server = db.query(ServerConfig).filter(ServerConfig.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@app.get("/api/servers")
async def get_servers(admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    servers = db.query(ServerConfig).order_by(ServerConfig.created_at.asc()).all()
    users = db.query(User).all()
    counts: Dict[str, int] = {
        server.id: sum(1 for u in users if ConfigGenerator.is_compatible(u, server))
        for server in servers
    }
    payload = []
    for server in servers:
        row = server.to_dict()
        row["warnings"] = server_warnings(server)
        row["is_ip"] = is_ip_literal(server.server_address)
        payload.append(row)
    return {
        "servers": payload,
        "total": len(servers),
        "users_by_server": counts,
        "builder_only": BUILDER_ONLY,
        "placeholder_addresses": [
            s.server_name for s in servers
            if str(s.server_address).strip().upper() in ("YOUR_SERVER_IP", "", "LOCALHOST")
        ],
    }


SERVER_PRESETS = [
    {
        "id": "reality-no-domain",
        "label": "REALITY — بدون دامنه",
        "hint": "پیشنهادی وقتی دامنه و گواهی ندارید: فقط IP سرور کافی است.",
        "requires_domain": False,
        "values": {
            "server_name": "VLESS-REALITY-443", "server_port": 443, "protocol": "vless",
            "network": "tcp", "security": "reality", "sni": "www.microsoft.com",
            "path": "/", "inbound_tag": "VLESS-REALITY-443",
            "reality_target": "www.microsoft.com:443",
            "reality_server_names": "www.microsoft.com,www.apple.com",
            "is_enabled": True, "is_default": True,
        },
    },
    {
        "id": "shadowsocks-no-domain",
        "label": "Shadowsocks — بدون دامنه",
        "hint": "ساده و بدون گواهی؛ نیاز به یک این‌باند shadowsocks در config.json دارد.",
        "requires_domain": False,
        "values": {
            "server_name": "SS-2096", "server_port": 2096, "protocol": "shadowsocks",
            "network": "tcp", "security": "none", "method": "chacha20-ietf-poly1305",
            "path": "/", "inbound_tag": "", "is_enabled": True, "is_default": False,
        },
    },
    {
        "id": "vless-ws-tls",
        "label": "VLESS + WebSocket + TLS",
        "hint": "رایج‌ترین حالت — به دامنه و گواهی معتبر نیاز دارد.",
        "requires_domain": True,
        "values": {
            "server_name": "VLESS-WS-8443", "server_port": 8443, "protocol": "vless",
            "network": "ws", "security": "tls", "path": "/v2box-ws",
            "inbound_tag": "VLESS-WS-8443", "is_enabled": True, "is_default": False,
        },
    },
    {
        "id": "vless-grpc-tls",
        "label": "VLESS + gRPC + TLS",
        "hint": "پایداری خوب روی شبکه‌های محدود — به دامنه و گواهی نیاز دارد.",
        "requires_domain": True,
        "values": {
            "server_name": "VLESS-GRPC-2053", "server_port": 2053, "protocol": "vless",
            "network": "grpc", "security": "tls", "service_name": "v2box-grpc",
            "inbound_tag": "VLESS-GRPC-2053", "is_enabled": True, "is_default": False,
        },
    },
    {
        "id": "vmess-ws-tls",
        "label": "VMess + WebSocket + TLS",
        "hint": "سازگار با کلاینت‌های قدیمی‌تر — به دامنه و گواهی نیاز دارد.",
        "requires_domain": True,
        "values": {
            "server_name": "VMESS-WS-2083", "server_port": 2083, "protocol": "vmess",
            "network": "ws", "security": "tls", "path": "/v2box-vmess",
            "inbound_tag": "VMESS-WS-2083", "is_enabled": True, "is_default": False,
        },
    },
    {
        "id": "trojan-tcp-tls",
        "label": "Trojan + TLS",
        "hint": "ترافیک شبیه HTTPS معمولی — به دامنه و گواهی نیاز دارد.",
        "requires_domain": True,
        "values": {
            "server_name": "TROJAN-TCP-2087", "server_port": 2087, "protocol": "trojan",
            "network": "tcp", "security": "tls", "path": "/",
            "inbound_tag": "TROJAN-TCP-2087", "is_enabled": True, "is_default": False,
        },
    },
]


@app.get("/api/servers/presets")
async def server_presets(with_keys: bool = True, admin: str = Depends(verify_token)):
    """Ready-to-use server templates; REALITY ones come with fresh keys."""
    presets = []
    for preset in SERVER_PRESETS:
        values = dict(preset["values"])
        if with_keys and values.get("security") == "reality":
            keys = xray_manager.complete_reality_keys()
            values["reality_public_key"] = keys["public_key"]
            values["reality_private_key"] = keys["private_key"]
            values["reality_short_id"] = keys["short_id"]
        presets.append({
            "id": preset["id"],
            "label": preset["label"],
            "hint": preset["hint"],
            "requires_domain": preset["requires_domain"],
            "values": values,
        })
    return {"presets": presets, "builder_only": BUILDER_ONLY}


@app.get("/api/servers/detect")
async def detect_servers(admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    """Show inbounds present in config.json, marking the ones not yet imported."""
    rows = xray_manager.extract_servers_from_config(XRAY_CONFIG_PATH)
    known = {s.inbound_tag for s in db.query(ServerConfig).all() if s.inbound_tag}
    inbounds = [data for data, _ in rows]
    return {"inbounds": inbounds, "new": [d for d in inbounds if d["inbound_tag"] not in known],
            "known_tags": sorted(known)}


@app.post("/api/servers/import")
async def import_servers(
    address: Optional[str] = Body(None, embed=True),
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    count = import_servers_from_config(db, address)
    audit(db, admin, "servers_imported", str(count))
    return {"imported": count, "message": f"{count} inbound(s) imported from config.json"}


@app.post("/api/servers")
async def create_server(
    payload: ServerCreate,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    if db.query(ServerConfig).filter(ServerConfig.server_name == payload.server_name).first():
        raise HTTPException(status_code=400, detail="A server with this name already exists")

    data = payload.model_dump()
    if data.get("is_default") or db.query(ServerConfig).count() == 0:
        db.query(ServerConfig).update({ServerConfig.is_default: False})
        data["is_default"] = True

    server = ServerConfig(**data)
    if server.security == "reality":
        keys = xray_manager.complete_reality_keys(
            server.reality_public_key, server.reality_private_key, server.reality_short_id
        )
        server.reality_public_key = keys["public_key"]
        server.reality_private_key = keys["private_key"]
        server.reality_short_id = keys["short_id"]

    db.add(server)
    db.commit()
    db.refresh(server)

    report = apply_xray_config(db)
    audit(db, admin, "server_created", server.server_name,
          f"{server.protocol}/{server.network}/{server.security}@{server.server_port}")
    row = server.to_dict()
    row["warnings"] = server_warnings(server)
    return {"server": row, "xray": report, "message": "Server added"}


@app.put("/api/servers/{server_id}")
async def update_server(
    server_id: str,
    payload: ServerUpdate,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    server = _get_server_or_404(db, server_id)
    updates = payload.model_dump(exclude_unset=True)
    updates = {k: v for k, v in updates.items() if v is not None or k in ("is_default", "is_enabled")}

    if updates.get("is_default"):
        db.query(ServerConfig).update({ServerConfig.is_default: False})

    for key, value in updates.items():
        setattr(server, key, value)

    if server.security == "reality":
        keys = xray_manager.complete_reality_keys(
            server.reality_public_key, server.reality_private_key, server.reality_short_id
        )
        server.reality_public_key = keys["public_key"]
        server.reality_private_key = keys["private_key"]
        server.reality_short_id = keys["short_id"]

    db.commit()
    db.refresh(server)
    report = apply_xray_config(db)
    audit(db, admin, "server_updated", server.server_name, ", ".join(updates.keys()))
    row = server.to_dict()
    row["warnings"] = server_warnings(server)
    return {"server": row, "xray": report, "message": "Server updated"}


@app.delete("/api/servers/{server_id}")
async def delete_server(server_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    server = _get_server_or_404(db, server_id)
    if db.query(ServerConfig).count() <= 1:
        raise HTTPException(status_code=400, detail="At least one server must remain")
    was_default = bool(server.is_default)
    name = server.server_name
    db.delete(server)
    db.commit()
    if was_default:
        other = db.query(ServerConfig).first()
        if other:
            other.is_default = True
            db.commit()
    report = apply_xray_config(db)
    audit(db, admin, "server_deleted", name)
    return {"message": f"Server '{name}' deleted", "xray": report}


@app.post("/api/servers/{server_id}/set-default")
async def set_default_server(server_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    server = _get_server_or_404(db, server_id)
    db.query(ServerConfig).update({ServerConfig.is_default: False})
    server.is_default = True
    server.is_enabled = True
    db.commit()
    audit(db, admin, "server_set_default", server.server_name)
    return {"server": server.to_dict(), "message": f"'{server.server_name}' is now the default server"}


@app.post("/api/servers/{server_id}/reality-keys")
async def server_reality_keys(server_id: str, admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    server = _get_server_or_404(db, server_id)
    keys = xray_manager.complete_reality_keys()
    server.reality_public_key = keys["public_key"]
    server.reality_private_key = keys["private_key"]
    server.reality_short_id = keys["short_id"]
    db.commit()
    report = apply_xray_config(db)
    audit(db, admin, "reality_keys_rotated", server.server_name)
    return {
        "server": server.to_dict(),
        "public_key": server.reality_public_key,
        "private_key": server.reality_private_key,
        "short_id": server.reality_short_id,
        "xray": report,
        "message": "New REALITY key pair generated — re-share the configs",
    }


# ==================== xray control ====================
@app.get("/api/xray/status")
async def xray_status(admin: str = Depends(verify_token)):
    if BUILDER_ONLY:
        return {
            "builder_only": True,
            "container": {"available": False, "running": False, "state": "builder-only"},
            "certificate": certs.cert_status(),
            "config": {"ok": False, "inbounds": [], "error": "builder-only mode"},
            "version": "",
            "docker_available": False,
            "config_path": XRAY_CONFIG_PATH,
            "checked_at": utcnow().isoformat(),
        }
    container = xray_manager.container_state()
    return {
        "builder_only": False,
        "container": container,
        "certificate": certs.cert_status(),
        "config": xray_manager.summarize_config(XRAY_CONFIG_PATH),
        "version": xray_manager.xray_version() if container.get("running") else "",
        "docker_available": xray_manager.docker_available(),
        "config_path": XRAY_CONFIG_PATH,
        "checked_at": utcnow().isoformat(),
    }


@app.get("/api/xray/config")
async def get_xray_config(admin: str = Depends(verify_token)):
    try:
        config = xray_manager.load_config(XRAY_CONFIG_PATH)
    except xray_manager.XrayConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"config": config, "path": XRAY_CONFIG_PATH,
            "summary": xray_manager.summarize_config(XRAY_CONFIG_PATH)}


@app.put("/api/xray/config")
async def save_xray_config(
    payload: RawConfigUpdate,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    if BUILDER_ONLY:
        raise HTTPException(status_code=400,
                            detail="حالت کانفیگ‌ساز فعال است — config.json دست‌نخورد می‌ماند")
    config = payload.config
    if "inbounds" not in config or "outbounds" not in config:
        raise HTTPException(status_code=400, detail="config must contain 'inbounds' and 'outbounds'")
    try:
        report = xray_manager.write_config(config, XRAY_CONFIG_PATH)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"could not write config: {exc}")

    test = xray_manager.test_config_in_container()
    restart = xray_manager.restart_xray() if payload.restart else None
    audit(db, admin, "xray_config_saved", XRAY_CONFIG_PATH,
          f"valid={test.get('ok')} restarted={bool(restart and restart.get('ok'))}")
    return {"ok": True, "write": report, "test": test, "restart": restart,
            "message": "config.json saved" + (" and xray restarted" if restart and restart.get("ok") else "")}


@app.post("/api/xray/restart")
async def restart_xray(admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    if BUILDER_ONLY:
        raise HTTPException(status_code=400,
                            detail="حالت کانفیگ‌ساز فعال است — هستهٔ xray مدیریت نمی‌شود")
    result = xray_manager.restart_xray()
    audit(db, admin, "xray_restarted", result.get("container", ""), result.get("message", ""))
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "restart failed"))
    return result


@app.post("/api/xray/test")
async def test_xray(admin: str = Depends(verify_token)):
    result = xray_manager.test_config_in_container()
    try:
        xray_manager.load_config(XRAY_CONFIG_PATH)
        result["json_valid"] = True
    except xray_manager.XrayConfigError as exc:
        result["json_valid"] = False
        result["json_error"] = str(exc)
    return result


@app.post("/api/xray/sync")
async def sync_xray(
    restart: bool = True,
    admin: str = Depends(verify_token),
    db: Session = Depends(get_db),
):
    report = apply_xray_config(db, restart=restart)
    if not report.get("ok"):
        raise HTTPException(status_code=500, detail=report.get("message", "sync failed"))
    audit(db, admin, "xray_synced", "", json.dumps(report.get("inbounds", {}), ensure_ascii=False))
    return report


@app.post("/api/xray/reality-keys")
async def new_reality_keys(admin: str = Depends(verify_token)):
    """A fresh x25519 pair, formatted exactly like `xray x25519`."""
    return xray_manager.complete_reality_keys()


@app.get("/api/xray/logs")
async def xray_logs(lines: int = Query(200, ge=1, le=5000), admin: str = Depends(verify_token)):
    """Tail the xray access/error log (mounted from ./data/xray-log)."""
    candidates = [XRAY_ACCESS_LOG, "/var/log/xray/access.log", "/var/log/xray/error.log"]
    path = next((p for p in candidates if os.path.exists(p)), None)
    if not path:
        return {"ok": False, "path": XRAY_ACCESS_LOG, "lines": [], "count": 0,
                "message": "no xray log mounted (./data/xray-log:/var/log/xray)"}
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            tail = fh.readlines()[-lines:]
    except Exception as exc:
        return {"ok": False, "path": path, "lines": [], "count": 0, "message": str(exc)}
    return {"ok": True, "path": path, "count": len(tail),
            "lines": [line.rstrip("\n") for line in tail]}


@app.get("/api/audit")
async def audit_logs(limit: int = Query(100, ge=1, le=1000),
                     admin: str = Depends(verify_token), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    return {"logs": [r.to_dict() for r in rows], "total": db.query(AuditLog).count()}


# ==================== public subscription endpoints (no auth) ====================
def _resolve_sub_user(db: Session, sub_id: str) -> User:
    user = db.query(User).filter(User.sub_id == sub_id).first()
    if not user:
        user = db.query(User).filter(User.uuid_key == sub_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return user


@app.get("/sub/{sub_id}")
async def public_subscription(
    request: Request,
    sub_id: str,
    json_format: bool = Query(False, alias="json"),
    db: Session = Depends(get_db),
):
    """Base64 subscription body + v2rayNG/V2Box profile headers."""
    user = _resolve_sub_user(db, sub_id)
    links = [item["link"] for item in build_user_links(db, user)]
    if not links:
        raise HTTPException(status_code=404, detail="No active configuration for this subscription")

    if json_format:
        servers = active_servers(db) or db.query(ServerConfig).all()
        return {
            "username": user.username,
            "links": links,
            "configs": [ConfigGenerator.generate_client_json(links[0], user, servers[0])] if servers else [],
        }

    limit = user.data_limit or 0
    body = ConfigGenerator.generate_subscription(links)
    headers = ConfigGenerator.subscription_headers(
        profile_title=f"{user.remark or user.username} | V2Box",
        sub_uri=f"{public_base_url(request)}/sub/{user.sub_id}",
    )
    headers["subscription-userinfo"] = (
        f"upload={user.upload or 0}; download={user.download or 0}; "
        f"total={limit}; expire={int(user.expire_date.timestamp()) if user.expire_date else 0}"
    )
    return PlainTextResponse(body, media_type="text/plain; charset=utf-8", headers=headers)


@app.get("/sub/{sub_id}/links")
async def public_subscription_links(sub_id: str, db: Session = Depends(get_db)):
    """Plain (not base64) list of links — handy for curl/testing."""
    user = _resolve_sub_user(db, sub_id)
    links = [item["link"] for item in build_user_links(db, user)]
    return PlainTextResponse("\n".join(links), media_type="text/plain; charset=utf-8")


@app.get("/sub/{sub_id}/info")
async def public_subscription_info(sub_id: str, request: Request, db: Session = Depends(get_db)):
    """Status page payload for the end user (used by the share page)."""
    user = _resolve_sub_user(db, sub_id)
    now = utcnow()
    limit = user.data_limit or 0
    used = user.data_used or ((user.upload or 0) + (user.download or 0))
    return {
        "username": user.username,
        "status": user.effective_status(now),
        "is_active": user.is_active,
        "protocol": user.protocol,
        "network": user.network,
        "security": user.security,
        "data_limit_human": human_bytes(limit),
        "data_used_human": human_bytes(used),
        "data_remaining_human": human_bytes(max(limit - used, 0)) if limit else "نامحدود",
        "percent_used": round(used / limit * 100, 1) if limit else 0,
        "expire_date": user.expire_date.isoformat() if user.expire_date else None,
        "days_left": (user.expire_date - now).days if user.expire_date else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_connected": user.last_connected.isoformat() if user.last_connected else None,
        "qrcode": f"{public_base_url(request)}/sub/{user.sub_id}/qrcode.png",
        "subscription_url": f"{public_base_url(request)}/sub/{user.sub_id}",
        "links": [{"server": item["server"], "link": item["link"]}
                  for item in build_user_links(db, user)],
    }


@app.get("/sub/{sub_id}/qrcode.png")
async def public_subscription_qrcode(sub_id: str, request: Request, db: Session = Depends(get_db)):
    user = _resolve_sub_user(db, sub_id)
    data = f"{public_base_url(request)}/sub/{user.sub_id}"
    fmt = "png" if HAS_PIL else "svg"
    raw = make_qrcode(data, fmt)
    return Response(content=raw, media_type="image/png" if fmt == "png" else "image/svg+xml",
                    headers={"Cache-Control": "public, max-age=300"})


@app.get("/share/{sub_id}")
async def share_page(sub_id: str, db: Session = Depends(get_db)):
    """Standalone page an admin can send to a client (link + QR + status)."""
    user = _resolve_sub_user(db, sub_id)
    page = os.path.join(FRONTEND_DIR, "share.html")
    if os.path.exists(page):
        with open(page, "r", encoding="utf-8") as fh:
            return Response(content=fh.read(), media_type="text/html; charset=utf-8")
    return PlainTextResponse(f"subscription id: {user.sub_id}\nusername: {user.username}")


# ==================== optional: serve the frontend when running bare =======
if SERVE_FRONTEND and os.path.isdir(FRONTEND_DIR):
    from fastapi.staticfiles import StaticFiles

    # mounted last so /api/* and /sub/* keep priority
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
