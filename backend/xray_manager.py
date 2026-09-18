"""Bridge between the panel database and the running xray-core container.

Responsibilities
----------------
* read / validate / atomically write  xray/config.json
* push every active user into the matching inbound as a `clients[]` entry
* keep streamSettings (ws path, grpc serviceName, tls sni, reality keys) in
  sync with the ServerConfig rows edited from the panel
* restart / test the xray container (docker SDK, `docker` CLI fallback)
* generate REALITY x25519 key pairs (pure python, no xray binary needed)

Everything degrades gracefully: if the docker socket is not mounted (for
example while developing on a laptop) the manager still writes the config
file and simply reports that the restart could not be performed.
"""

import base64
import copy
import datetime
import json
import os
import shutil
import stat
import subprocess
import tempfile
from typing import Any, Dict, List, Optional, Tuple

from config_generator import ConfigGenerator

# a user only belongs to a server (inbound) with the same protocol+transport+security
_compat = ConfigGenerator.is_compatible

XRAY_CONFIG_PATH = os.getenv("XRAY_CONFIG_PATH", "./xray/config.json")
XRAY_CONTAINER = os.getenv("XRAY_CONTAINER_NAME", "xray-core")
# backups live inside the persisted ./data volume by default
CONFIG_BACKUP_DIR = os.getenv("XRAY_BACKUP_DIR", "./data/xray-backup")
MAX_BACKUPS = 10


# --------------------------------------------------------------------------
# REALITY key pair (x25519) — same format as `xray x25519`
# --------------------------------------------------------------------------
def _b64url_raw(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _from_b64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def derive_public_key(private_key: str) -> str:
    """xray only stores the REALITY *private* key server side — the public key
    used in client links is derived from it (x25519)."""
    if not private_key:
        return ""
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

        raw = _from_b64url(private_key.strip())
        if len(raw) != 32:
            return ""
        priv = X25519PrivateKey.from_private_bytes(raw)
        pub = priv.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        return _b64url_raw(pub)
    except Exception:
        return ""


def generate_reality_keypair() -> Dict[str, str]:
    """Return {'private_key': ..., 'public_key': ...} in xray base64url form."""
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey

        private = X25519PrivateKey.generate()
        priv_raw = private.private_bytes(
            serialization.Encoding.Raw,
            serialization.PrivateFormat.Raw,
            serialization.NoEncryption(),
        )
        pub_raw = private.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        return {
            "private_key": _b64url_raw(priv_raw),
            "public_key": _b64url_raw(pub_raw),
        }
    except Exception:  # pragma: no cover - cryptography always present
        import secrets

        priv = secrets.token_bytes(32)
        return {"private_key": _b64url_raw(priv), "public_key": _b64url_raw(secrets.token_bytes(32))}


def generate_short_id() -> str:
    import secrets

    return secrets.token_hex(4)  # 8 hex chars, like `xray` expects


def complete_reality_keys(public_key: str = "", private_key: str = "",
                          short_id: str = "") -> Dict[str, str]:
    """Fill in whatever is missing: derive the public key, or create a pair."""
    public_key = (public_key or "").strip()
    private_key = (private_key or "").strip()
    if private_key and not public_key:
        public_key = derive_public_key(private_key)
    if not private_key and not public_key:
        pair = generate_reality_keypair()
        private_key, public_key = pair["private_key"], pair["public_key"]
    # if only the public key is known we keep it — xray needs the private key
    # to be supplied separately (see the REALITY panel in the UI)
    return {
        "public_key": public_key,
        "private_key": private_key,
        "short_id": (short_id or "").strip() or generate_short_id(),
    }


# --------------------------------------------------------------------------
# docker helpers
# --------------------------------------------------------------------------
def _docker_client():
    try:
        import docker  # type: ignore

        return docker.from_env()
    except Exception:
        return None


def docker_available() -> bool:
    return _docker_client() is not None


def container_state(name: str = XRAY_CONTAINER) -> Dict[str, Any]:
    """Best effort container inspection."""
    client = _docker_client()
    if client:
        try:
            c = client.containers.get(name)
            c.reload()
            return {
                "available": True,
                "source": "docker-sdk",
                "name": c.name,
                "state": c.status,
                "running": c.status == "running",
                "started_at": (c.attrs.get("State") or {}).get("StartedAt"),
                "image": (c.attrs.get("Config") or {}).get("Image"),
            }
        except Exception as exc:
            return {"available": False, "source": "docker-sdk", "error": str(exc), "running": False}
    try:
        out = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Status}}", name],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0:
            state = out.stdout.strip()
            return {
                "available": True, "source": "docker-cli", "name": name,
                "state": state, "running": state == "running",
            }
    except Exception as exc:
        return {"available": False, "source": "none", "error": str(exc), "running": False}
    return {"available": False, "source": "none", "running": False,
            "error": "docker socket is not reachable from the backend"}


def restart_xray(name: str = XRAY_CONTAINER, timeout: int = 40) -> Dict[str, Any]:
    """Restart xray so the freshly written config.json is applied."""
    started = datetime.datetime.utcnow()
    client = _docker_client()
    if client:
        try:
            c = client.containers.get(name)
            c.restart(timeout=15)
            return {
                "ok": True, "method": "docker-sdk", "container": name,
                "message": f"container {name} restarted",
                "elapsed_ms": int((datetime.datetime.utcnow() - started).total_seconds() * 1000),
            }
        except Exception as exc:
            return {"ok": False, "method": "docker-sdk", "container": name, "message": str(exc)}
    try:
        out = subprocess.run(["docker", "restart", name], capture_output=True, text=True, timeout=timeout)
        if out.returncode == 0:
            return {"ok": True, "method": "docker-cli", "container": name, "message": out.stdout.strip()}
        return {"ok": False, "method": "docker-cli", "container": name,
                "message": (out.stderr or out.stdout).strip()}
    except FileNotFoundError:
        return {"ok": False, "method": "none", "container": name,
                "message": "docker is not available inside the backend container "
                           "(mount /var/run/docker.sock)"}
    except Exception as exc:
        return {"ok": False, "method": "none", "container": name, "message": str(exc)}


def test_config_in_container(path_in_container: str = "/etc/xray/config.json",
                               name: str = XRAY_CONTAINER) -> Dict[str, Any]:
    """Run `xray -test -c config.json` inside the xray container."""
    client = _docker_client()
    cmd = ["xray", "-test", "-config", path_in_container]
    if client:
        try:
            c = client.containers.get(name)
            exit_code, output = c.exec_run(cmd)
            text = output.decode(errors="replace") if isinstance(output, bytes) else str(output)
            return {"ok": exit_code == 0, "method": "docker-sdk", "output": text.strip()[-2000:]}
        except Exception as exc:
            return {"ok": False, "method": "docker-sdk", "output": str(exc)}
    try:
        out = subprocess.run(["docker", "exec", name, *cmd], capture_output=True, text=True, timeout=30)
        text = (out.stdout + out.stderr).strip()
        return {"ok": out.returncode == 0, "method": "docker-cli", "output": text[-2000:]}
    except Exception as exc:
        return {"ok": False, "method": "none", "output": str(exc)}


def xray_version(name: str = XRAY_CONTAINER) -> str:
    client = _docker_client()
    if client:
        try:
            c = client.containers.get(name)
            code, out = c.exec_run(["xray", "version"])
            text = out.decode(errors="replace") if isinstance(out, bytes) else str(out)
            return text.strip().splitlines()[0] if text.strip() else ""
        except Exception:
            return ""
    try:
        out = subprocess.run(["docker", "exec", name, "xray", "version"],
                             capture_output=True, text=True, timeout=20)
        return out.stdout.strip().splitlines()[0] if out.stdout.strip() else ""
    except Exception:
        return ""


# --------------------------------------------------------------------------
# config file handling
# --------------------------------------------------------------------------
class XrayConfigError(Exception):
    pass


def load_config(path: str = XRAY_CONFIG_PATH) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError as exc:
        raise XrayConfigError(f"config file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise XrayConfigError(f"config file is not valid JSON: {exc}") from exc


def write_config(config: Dict[str, Any], path: str = XRAY_CONFIG_PATH) -> Dict[str, Any]:
    """Validate -> backup -> atomic write. Returns a small report."""
    text = json.dumps(config, indent=2, ensure_ascii=False)
    json.loads(text)  # sanity check

    folder = os.path.dirname(os.path.abspath(path)) or "."
    os.makedirs(folder, exist_ok=True)

    backup_name = None
    original_mode = None
    if os.path.exists(path):
        original_mode = stat.S_IMODE(os.stat(path).st_mode)
        os.makedirs(CONFIG_BACKUP_DIR, exist_ok=True)
        stamp = datetime.datetime.utcnow().strftime("%Y%m%d-%H%M%S")
        backup_name = os.path.join(CONFIG_BACKUP_DIR, f"config-{stamp}.json")
        shutil.copy2(path, backup_name)
        _prune_backups()

    # Preferred: write to a temp file in the same folder then rename (atomic).
    # A docker single-file bind mount refuses rename-over, so fall back to an
    # in-place write there (the backup above keeps us safe either way).
    fd, tmp = tempfile.mkstemp(prefix=".config-", suffix=".json", dir=folder)
    method = "atomic"
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        try:
            os.replace(tmp, path)
        except OSError:
            method = "in-place"
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text + "\n")
                fh.flush()
                os.fsync(fh.fileno())
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    # mkstemp creates 0600 files; keep whatever mode the config had before
    try:
        os.chmod(path, original_mode if original_mode is not None else 0o644)
    except OSError:
        pass

    return {"ok": True, "path": path, "backup": backup_name, "bytes": len(text), "method": method}


def _prune_backups() -> None:
    try:
        files = sorted(
            (os.path.join(CONFIG_BACKUP_DIR, f) for f in os.listdir(CONFIG_BACKUP_DIR)
             if f.startswith("config-") and f.endswith(".json")),
            key=os.path.getmtime, reverse=True,
        )
        for old in files[MAX_BACKUPS:]:
            os.remove(old)
    except Exception:
        pass


# --------------------------------------------------------------------------
# inbound / client mapping
# --------------------------------------------------------------------------
PROTOCOL_ALIASES = {
    "shadowsocks": "shadowsocks", "ss": "shadowsocks",
    "vless": "vless", "vmess": "vmess", "trojan": "trojan",
}
NETWORK_ALIASES = {"raw": "tcp", "http": "h2", "httpupgrade": "httpupgrade", "ws": "ws",
                   "tcp": "tcp", "grpc": "grpc", "h2": "h2"}


def _norm(value: Optional[str], table: Dict[str, str]) -> str:
    return table.get((value or "").lower(), (value or "").lower())


def client_email(username: str, tag: str) -> str:
    """xray requires globally unique emails — used as the stats key."""
    return f"{username}.{tag}" if tag else username


def build_client(user, tag: str, protocol: str) -> Optional[Dict[str, Any]]:
    """Convert a DB user row into an xray `clients[]` entry."""
    proto = _norm(protocol or user.protocol, PROTOCOL_ALIASES)
    email = client_email(user.username, tag)
    flow = (user.flow or "").strip()

    if proto == "vless":
        client: Dict[str, Any] = {"id": user.uuid_key, "email": email, "level": 0}
        if flow:
            client["flow"] = flow
        return client
    if proto == "vmess":
        return {"id": user.uuid_key, "email": email, "level": 0, "security": "auto"}
    if proto == "trojan":
        client = {"password": user.uuid_key, "email": email, "level": 0}
        if flow:
            client["flow"] = flow
        return client
    if proto == "shadowsocks":
        return {
            "method": user.method or "chacha20-ietf-poly1305",
            "password": user.uuid_key,
            "email": email,
            "level": 0,
        }
    return None


def _server_matches_inbound(server, inbound: Dict[str, Any]) -> bool:
    """Does this ServerConfig row describe this inbound?"""
    tag = (inbound.get("tag") or "").strip()
    if server.inbound_tag and tag:
        return server.inbound_tag == tag
    proto = _norm(inbound.get("protocol"), PROTOCOL_ALIASES)
    if proto and _norm(server.protocol, PROTOCOL_ALIASES) != proto:
        return False
    port = int(inbound.get("port") or 0)
    if port and int(server.server_port or 0) != port:
        return False
    stream = inbound.get("streamSettings") or {}
    net = _norm(stream.get("network"), NETWORK_ALIASES)
    if net and _norm(server.network, NETWORK_ALIASES) != net:
        return False
    return True


def _user_matches_inbound(user, inbound: Dict[str, Any]) -> bool:
    proto = _norm(inbound.get("protocol"), PROTOCOL_ALIASES)
    up = _norm(user.protocol, PROTOCOL_ALIASES)
    if proto in ("vless", "vmess", "trojan") and up != proto:
        return False
    stream = inbound.get("streamSettings") or {}
    net = _norm(stream.get("network"), NETWORK_ALIASES)
    un = _norm(user.network, NETWORK_ALIASES)
    if net and un and net != un:
        return False
    security = _norm(stream.get("security"), {"reality": "reality", "tls": "tls", "none": "none"})
    usec = _norm(user.security, {"reality": "reality", "tls": "tls", "none": "none"})
    if security in ("tls", "reality") and usec and usec != security:
        return False
    return True


def apply_stream_settings(inbound: Dict[str, Any], server) -> Dict[str, Any]:
    """Mirror the panel's ServerConfig fields into the inbound's streamSettings."""
    stream = inbound.setdefault("streamSettings", {})
    network = _norm(server.network, NETWORK_ALIASES)
    stream["network"] = network
    stream["security"] = (server.security or "none").lower()

    ws_host = server.host or server.sni or server.server_address
    if network in ("ws", "httpupgrade"):
        stream["wsSettings"] = {"path": server.path or "/", "headers": {"Host": ws_host}}
    elif network == "grpc":
        stream["grpcSettings"] = {"serviceName": server.service_name or "grpc"}
    elif network in ("h2", "http"):
        stream["httpSettings"] = {"path": server.path or "/", "host": [ws_host]}
    elif network == "tcp":
        stream.setdefault("tcpSettings", {})["header"] = {"type": "none"}

    if stream["security"] == "tls":
        tls = stream.setdefault("tlsSettings", {})
        tls["serverName"] = server.sni or server.server_address
        tls["alpn"] = ["h2", "http/1.1"]
        tls["minVersion"] = tls.get("minVersion", "1.2")
        tls["certificates"] = tls.get("certificates") or [
            {
                "certificateFile": "/etc/xray/certs/fullchain.pem",
                "keyFile": "/etc/xray/certs/privkey.pem",
            }
        ]
    elif stream["security"] == "reality":
        reality = stream.setdefault("realitySettings", {})
        reality["show"] = False
        reality["dest"] = server.reality_target or "www.microsoft.com:443"
        reality["xver"] = reality.get("xver", 0)
        names = [n.strip() for n in (server.reality_server_names or "").split(",") if n.strip()]
        reality["serverNames"] = names or [server.sni or "www.microsoft.com"]
        if server.reality_private_key:
            reality["privateKey"] = server.reality_private_key
        # publicKey belongs to the *client* side; keep it only if it was
        # already present in the file (xray ignores it on a server inbound)
        reality["shortIds"] = [server.reality_short_id] if server.reality_short_id else [""]
        reality["fingerprint"] = server.fingerprint or "chrome"
        reality["maxTimeDiff"] = reality.get("maxTimeDiff", 0)
    else:
        stream.pop("tlsSettings", None)
        stream.pop("realitySettings", None)

    return inbound


def sync_config(users: List[Any], servers: List[Any],
                path: str = XRAY_CONFIG_PATH) -> Dict[str, Any]:
    """Rewrite the `clients` of every inbound from the database.

    Only users that are active, not expired and not over quota are pushed.
    Returns a report: {'changed': bool, 'inbounds': {...}, 'skipped': n}
    """
    config = load_config(path)
    original = copy.deepcopy(config)
    now = datetime.datetime.utcnow()

    usable_users = [
        u for u in users
        if u.is_active and not u.is_expired(now) and not u.is_over_quota()
    ]
    skipped = len(users) - len(usable_users)

    enabled_servers = [s for s in servers if getattr(s, "is_enabled", True)]
    report: Dict[str, Any] = {}
    matched_ids = set()

    for inbound in config.get("inbounds", []):
        if str(inbound.get("protocol", "")).lower() in ("dokodemo-door", "socks", "http"):
            continue
        tag = inbound.get("tag") or f"inbound-{inbound.get('port')}"
        server = next((s for s in enabled_servers if _server_matches_inbound(s, inbound)), None)
        if server:
            matched_ids.add(server.id)
            apply_stream_settings(inbound, server)
            inbound["port"] = int(server.server_port or inbound.get("port") or 443)

        inbound["tag"] = tag
        proto = _norm(inbound.get("protocol"), PROTOCOL_ALIASES)

        # only users that really fit this inbound may be pushed into it,
        # otherwise xray would accept connections it cannot serve
        if server:
            candidates = [u for u in usable_users if _compat(u, server)]
        else:
            candidates = [u for u in usable_users if _user_matches_inbound(u, inbound)]

        clients: List[Dict[str, Any]] = []
        seen = set()
        for user in candidates:
            client = build_client(user, tag, proto or user.protocol)
            if not client or client.get("email") in seen:
                continue
            seen.add(client["email"])
            clients.append(client)

        settings = inbound.setdefault("settings", {})
        if proto in ("vless", "vmess", "trojan", "shadowsocks"):
            settings["clients"] = clients
        report[tag] = {
            "protocol": proto,
            "port": inbound.get("port"),
            "clients": len(clients),
            "server": server.server_name if server else None,
        }

    # remember which inbound each server row belongs to (so links stay correct)
    for inbound in config.get("inbounds", []):
        tag = inbound.get("tag") or ""
        for server in servers:
            if not server.inbound_tag and tag and _server_matches_inbound(server, inbound):
                server.inbound_tag = tag

    changed = json.dumps(config, sort_keys=True) != json.dumps(original, sort_keys=True)
    if changed:
        write_config(config, path)

    # users that fit no enabled server at all -> nothing can serve them
    unmatched = [
        u.username for u in usable_users
        if not any(_compat(u, s) for s in enabled_servers)
    ]

    return {
        "ok": True,
        "changed": changed,
        "pushed_users": len(usable_users),
        "skipped_users": skipped,
        "servers_matched": len(matched_ids),
        "unmatched_users": unmatched,
        "inbounds": report,
        "path": path,
    }


def summarize_config(path: str = XRAY_CONFIG_PATH) -> Dict[str, Any]:
    """Compact view of the live xray config for the panel UI."""
    try:
        config = load_config(path)
    except XrayConfigError as exc:
        return {"ok": False, "error": str(exc), "inbounds": []}

    inbounds = []
    for inbound in config.get("inbounds", []):
        stream = inbound.get("streamSettings") or {}
        settings = inbound.get("settings") or {}
        reality = stream.get("realitySettings") or {}
        inbounds.append(
            {
                "tag": inbound.get("tag", ""),
                "protocol": inbound.get("protocol", ""),
                "port": inbound.get("port"),
                "listen": inbound.get("listen", "0.0.0.0"),
                "network": stream.get("network", "tcp"),
                "security": stream.get("security", "none"),
                "sni": (stream.get("tlsSettings") or {}).get("serverName", ""),
                "path": ((stream.get("wsSettings") or {}).get("path", "")),
                "service_name": (stream.get("grpcSettings") or {}).get("serviceName", ""),
                "clients": len(settings.get("clients") or settings.get("accounts") or []),
                "reality_public_key": reality.get("publicKey", "")
                or derive_public_key(reality.get("privateKey", "")),
                "reality_short_ids": reality.get("shortIds", []),
                "reality_dest": reality.get("dest", ""),
            }
        )
    return {
        "ok": True,
        "loglevel": (config.get("log") or {}).get("loglevel", "warning"),
        "api_enabled": "api" in config,
        "stats_enabled": "stats" in config,  # `"stats": {}` still enables it
        "inbounds": inbounds,
        "inbound_count": len(inbounds),
        "outbound_count": len(config.get("outbounds", [])),
    }


def extract_servers_from_config(path: str = XRAY_CONFIG_PATH) -> List[Tuple[Dict[str, Any], Any]]:
    """(dict of ServerConfig kwargs, inbound) pairs, used for auto-detection."""
    try:
        config = load_config(path)
    except XrayConfigError:
        return []
    out: List[Tuple[Dict[str, Any], Any]] = []
    for inbound in config.get("inbounds", []):
        proto = _norm(inbound.get("protocol"), PROTOCOL_ALIASES)
        if proto not in ("vless", "vmess", "trojan", "shadowsocks"):
            continue
        stream = inbound.get("streamSettings") or {}
        security = (stream.get("security") or "none").lower()
        reality = stream.get("realitySettings") or {}
        tls = stream.get("tlsSettings") or {}
        network = _norm(stream.get("network"), NETWORK_ALIASES)
        public_key = reality.get("publicKey", "") or derive_public_key(reality.get("privateKey", ""))
        short_ids = reality.get("shortIds") or [""]
        out.append((
            {
                "server_name": inbound.get("tag") or f"{proto}-{inbound.get('port')}",
                "server_port": int(inbound.get("port") or 443),
                "protocol": proto,
                "network": network,
                "security": security,
                "sni": tls.get("serverName", "") or (reality.get("serverNames") or [""])[0],
                "path": (stream.get("wsSettings") or {}).get("path", "/") or "/",
                "service_name": (stream.get("grpcSettings") or {}).get("serviceName", ""),
                "host": ((stream.get("wsSettings") or {}).get("headers") or {}).get("Host", ""),
                "reality_public_key": public_key,
                "reality_private_key": reality.get("privateKey", ""),
                "reality_short_id": short_ids[0] if short_ids else "",
                "reality_target": reality.get("dest", ""),
                "reality_server_names": ",".join(reality.get("serverNames") or []),
                "inbound_tag": inbound.get("tag", ""),
            },
            inbound,
        ))
    return out
