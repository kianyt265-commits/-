"""Database models for the V2Box panel.

Everything runs on SQLAlchemy 2.x.  The default database is a SQLite file
inside ./data so the whole panel survives a container restart.
"""

import os
import uuid
import datetime

from sqlalchemy import (
    create_engine,
    Column,
    String,
    Integer,
    Boolean,
    DateTime,
    BigInteger,
    Text,
)
from sqlalchemy.orm import declarative_base, sessionmaker

# docker-compose points DATABASE_URL at /app/data/v2box.db
_default_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "v2box.db")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{_default_db}")

# make sure the folder exists before sqlite tries to open the file
def _ensure_sqlite_dir(url: str) -> None:
    if not url.startswith("sqlite"):
        return
    path = url.split("sqlite:///", 1)[-1]
    if not path or path in (":memory:", ""):
        return
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)


_ensure_sqlite_dir(DATABASE_URL)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def new_uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    """A single client / subscription owner."""

    __tablename__ = "users"

    id = Column(String, primary_key=True, default=new_uuid)
    username = Column(String, unique=True, index=True, nullable=False)
    uuid_key = Column(String, unique=True, default=new_uuid)
    # public, unguessable id used in the subscription url (/sub/<sub_id>)
    sub_id = Column(String, unique=True, index=True, default=lambda: uuid.uuid4().hex)
    email = Column(String, nullable=True)
    remark = Column(String, nullable=True)

    # --- protocol settings -------------------------------------------------
    protocol = Column(String, default="vless")   # vless, vmess, trojan, shadowsocks
    network = Column(String, default="ws")       # ws, tcp, grpc, h2
    security = Column(String, default="tls")     # tls, reality, none
    flow = Column(String, default="")            # xtls-rprx-vision for reality
    method = Column(String, default="chacha20-ietf-poly1305")  # shadowsocks cipher
    fingerprint = Column(String, default="chrome")

    # --- limits ------------------------------------------------------------
    data_limit = Column(BigInteger, default=0)   # 0 = unlimited (bytes)
    data_used = Column(BigInteger, default=0)
    expire_date = Column(DateTime, nullable=True)
    max_connections = Column(Integer, default=2)

    # --- status ------------------------------------------------------------
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_connected = Column(DateTime, nullable=True)

    # --- traffic -----------------------------------------------------------
    upload = Column(BigInteger, default=0)
    download = Column(BigInteger, default=0)

    def remaining_bytes(self) -> int:
        if not self.data_limit:
            return -1  # unlimited
        return max(self.data_limit - (self.data_used or 0), 0)

    def is_expired(self, now=None) -> bool:
        now = now or datetime.datetime.utcnow()
        return bool(self.expire_date and self.expire_date < now)

    def is_over_quota(self) -> bool:
        return bool(self.data_limit and (self.data_used or 0) >= self.data_limit)

    def effective_status(self, now=None) -> str:
        """active | expired | limited | disabled"""
        now = now or datetime.datetime.utcnow()
        if not self.is_active:
            return "disabled"
        if self.is_expired(now):
            return "expired"
        if self.is_over_quota():
            return "limited"
        return "active"

    def to_dict(self, now=None) -> dict:
        now = now or datetime.datetime.utcnow()
        limit = self.data_limit or 0
        used = self.data_used or ((self.upload or 0) + (self.download or 0))
        days_left = None
        if self.expire_date:
            days_left = (self.expire_date - now).days
        return {
            "id": self.id,
            "username": self.username,
            "uuid_key": self.uuid_key,
            "sub_id": self.sub_id,
            "email": self.email,
            "remark": self.remark,
            "protocol": self.protocol,
            "network": self.network,
            "security": self.security,
            "flow": self.flow,
            "method": self.method,
            "fingerprint": self.fingerprint,
            "data_limit": limit,
            "data_used": used,
            "data_remaining": max(limit - used, 0) if limit else -1,
            "upload": self.upload or 0,
            "download": self.download or 0,
            "expire_date": self.expire_date.isoformat() if self.expire_date else None,
            "days_left": days_left,
            "max_connections": self.max_connections,
            "is_active": self.is_active,
            "status": self.effective_status(now),
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_connected": self.last_connected.isoformat() if self.last_connected else None,
        }


class ServerConfig(Base):
    """An inbound endpoint (address/port/transport) that links are built for."""

    __tablename__ = "server_configs"

    id = Column(String, primary_key=True, default=new_uuid)
    server_name = Column(String, nullable=False)
    server_address = Column(String, nullable=False)
    server_port = Column(Integer, default=443)
    protocol = Column(String, default="vless")
    network = Column(String, default="ws")
    security = Column(String, default="tls")
    sni = Column(String, default="")
    path = Column(String, default="/")
    service_name = Column(String, default="")       # gRPC
    host = Column(String, default="")               # ws/h2 host header
    fingerprint = Column(String, default="chrome")
    reality_public_key = Column(String, default="")
    reality_private_key = Column(String, default="")  # kept to (re)build config.json
    reality_short_id = Column(String, default="")
    reality_target = Column(String, default="www.microsoft.com:443")
    reality_server_names = Column(Text, default="")   # comma separated
    inbound_tag = Column(String, default="")          # tag inside xray config.json
    method = Column(String, default="chacha20-ietf-poly1305")
    is_enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "server_name": self.server_name,
            "server_address": self.server_address,
            "server_port": self.server_port,
            "protocol": self.protocol,
            "network": self.network,
            "security": self.security,
            "sni": self.sni,
            "path": self.path,
            "host": self.host,
            "service_name": self.service_name,
            "fingerprint": self.fingerprint,
            "method": self.method,
            "reality_public_key": self.reality_public_key,
            "reality_short_id": self.reality_short_id,
            "reality_target": self.reality_target,
            "reality_server_names": self.reality_server_names,
            "has_private_key": bool(self.reality_private_key),
            "inbound_tag": self.inbound_tag,
            "is_enabled": self.is_enabled,
            "is_default": self.is_default,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Admin(Base):
    __tablename__ = "admins"

    id = Column(String, primary_key=True, default=new_uuid)
    username = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_superadmin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    last_login = Column(DateTime, nullable=True)


class TrafficSnapshot(Base):
    """Hourly traffic sample, used by the dashboard charts."""

    __tablename__ = "traffic_snapshots"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, index=True, nullable=False)
    bucket = Column(DateTime, index=True, nullable=False)  # truncated to the hour
    upload = Column(BigInteger, default=0)
    download = Column(BigInteger, default=0)

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "bucket": self.bucket.isoformat() if self.bucket else None,
            "upload": self.upload or 0,
            "download": self.download or 0,
        }


class AuditLog(Base):
    """Who did what inside the panel."""

    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    actor = Column(String, default="system")
    action = Column(String, nullable=False)
    target = Column(String, nullable=True)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "actor": self.actor,
            "action": self.action,
            "target": self.target,
            "detail": self.detail,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
