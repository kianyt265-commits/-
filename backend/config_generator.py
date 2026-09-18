"""Build V2Ray/V2Box compatible share links, client JSON configs and
base64 subscription payloads.

Supported protocols : vless · vmess · trojan · shadowsocks
Supported transports: tcp · ws · grpc · h2 (httpupgrade)
Supported security  : none · tls · reality
"""

import base64
import json
import urllib.parse
from typing import Any, Dict, List, Optional

GB = 1024 ** 3


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def _qs(params: Dict[str, Any]) -> str:
    """urlencode but keep empty values out of the link."""
    clean = {k: v for k, v in params.items() if v not in (None, "")}
    return urllib.parse.urlencode(clean)


def _b64url(raw: str) -> str:
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def human_bytes(value: Optional[int]) -> str:
    if not value or value < 0:
        return "نامحدود"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} TB"


# --------------------------------------------------------------------------
# generator
# --------------------------------------------------------------------------
class ConfigGenerator:
    """Generate V2Box/V2Ray compatible configs and share links."""

    # ------------------------------------------------------------- VLESS --
    @staticmethod
    def generate_vless_link(
        uuid_key: str,
        address: str,
        port: int,
        remark: str,
        network: str = "ws",
        security: str = "tls",
        sni: str = "",
        path: str = "/",
        flow: str = "",
        fingerprint: str = "chrome",
        reality_public_key: str = "",
        reality_short_id: str = "",
        service_name: str = "",
        host: str = "",
        alpn: str = "h2,http/1.1",
        encryption: str = "none",
    ) -> str:
        params: Dict[str, Any] = {"type": network, "security": security}

        if encryption and encryption != "none":
            params["encryption"] = encryption

        if flow:
            params["flow"] = flow

        if security == "tls":
            params["sni"] = sni or address
            params["fp"] = fingerprint
            if alpn:
                params["alpn"] = alpn
        elif security == "reality":
            params["sni"] = sni or address
            params["fp"] = fingerprint
            params["pbk"] = reality_public_key
            params["sid"] = reality_short_id
            params["spx"] = "/"

        ws_host = host or (sni if security in ("tls", "reality") else "") or address

        if network in ("ws", "httpupgrade"):
            params["path"] = path or "/"
            params["host"] = ws_host
        elif network == "grpc":
            params["serviceName"] = service_name or "grpc"
            params["mode"] = "gun"
        elif network in ("tcp", "raw"):
            params["headerType"] = "none"
        elif network in ("h2", "http"):
            params["path"] = path or "/"
            params["host"] = ws_host

        return f"vless://{uuid_key}@{address}:{port}?{_qs(params)}#{urllib.parse.quote(remark)}"

    # ------------------------------------------------------------- VMess --
    @staticmethod
    def generate_vmess_link(
        uuid_key: str,
        address: str,
        port: int,
        remark: str,
        network: str = "ws",
        security: str = "tls",
        sni: str = "",
        path: str = "/",
        host: str = "",
        fingerprint: str = "chrome",
        alpn: str = "h2,http/1.1",
        service_name: str = "",
    ) -> str:
        net = "tcp" if network in ("raw", "tcp") else network
        ws_host = host or (sni if security == "tls" else "")

        config: Dict[str, Any] = {
            "v": "2",
            "ps": remark,
            "add": address,
            "port": str(port),
            "id": uuid_key,
            "aid": "0",
            "scy": "auto",
            "net": net,
            "type": "none",
            "host": ws_host or "",
            "path": path if net in ("ws", "h2", "httpupgrade") else "",
            "tls": "tls" if security == "tls" else "",
            "sni": sni or address if security == "tls" else "",
            "alpn": alpn if security == "tls" else "",
            "fp": fingerprint if security == "tls" else "",
        }
        if net == "grpc":
            config["path"] = service_name or "grpc"
        raw = json.dumps(config, separators=(",", ":"), ensure_ascii=False)
        # vmess links use plain (unpadded-url-safe) standard base64
        return "vmess://" + base64.b64encode(raw.encode()).decode()

    # ------------------------------------------------------------ Trojan --
    @staticmethod
    def generate_trojan_link(
        password: str,
        address: str,
        port: int,
        remark: str,
        network: str = "ws",
        security: str = "tls",
        sni: str = "",
        path: str = "/",
        host: str = "",
        fingerprint: str = "chrome",
        alpn: str = "h2,http/1.1",
        service_name: str = "",
        flow: str = "",
    ) -> str:
        params: Dict[str, Any] = {
            "type": network,
            "security": security,
            "sni": sni or address,
            "fp": fingerprint,
            "alpn": alpn,
        }
        if flow:
            params["flow"] = flow

        ws_host = host or sni or address
        if network in ("ws", "httpupgrade"):
            params["path"] = path or "/"
            params["host"] = ws_host
        elif network == "grpc":
            params["serviceName"] = service_name or "trojan-grpc"
            params["mode"] = "gun"
        elif network in ("tcp", "raw"):
            params["headerType"] = "none"
        elif network in ("h2", "http"):
            params["path"] = path or "/"
            params["host"] = ws_host

        return f"trojan://{password}@{address}:{port}?{_qs(params)}#{urllib.parse.quote(remark)}"

    # ------------------------------------------------------- Shadowsocks --
    @staticmethod
    def generate_shadowsocks_link(
        password: str,
        address: str,
        port: int,
        remark: str,
        method: str = "chacha20-ietf-poly1305",
        plugin: str = "",
        plugin_opts: str = "",
    ) -> str:
        userinfo = base64.urlsafe_b64encode(f"{method}:{password}".encode()).decode().rstrip("=")
        params: Dict[str, Any] = {}
        if plugin:
            params["plugin"] = f"{plugin};{plugin_opts}" if plugin_opts else plugin
        query = f"?{_qs(params)}" if params else ""
        return f"ss://{userinfo}@{address}:{port}{query}#{urllib.parse.quote(remark)}"

    # ------------------------------------------------------ subscriptions --
    @staticmethod
    def generate_subscription(
        links: List[str],
        profile_title: str = "V2Box Panel",
        update_interval: int = 12,
        extra_base64: Optional[List[str]] = None,
    ) -> str:
        """base64 subscription body (+ v2box/v2rayNG hint lines)."""
        payload = "\n".join(links)
        if extra_base64:
            payload = "\n".join(extra_base64 + [payload])
        encoded = base64.b64encode(payload.encode()).decode()
        return encoded

    @staticmethod
    def subscription_headers(
        profile_title: str = "V2Box Panel",
        update_interval: int = 12,
        sub_uri: str = "",
    ) -> Dict[str, str]:
        title = base64.b64encode(profile_title.encode()).decode()
        uri = base64.b64encode(sub_uri.encode()).decode() if sub_uri else ""
        headers = {
            "profile-title": f"base64:{title}",
            "profile-update-interval": str(update_interval),
            "content-disposition": 'attachment; filename="v2box-sub.txt"',
            "subscription-userinfo": "",
        }
        if uri:
            headers["profile-web-page-url"] = sub_uri
        return headers

    # ----------------------------------------------------- client JSON ---
    @staticmethod
    def generate_client_json(link: str, user: Any, server: Any) -> Dict[str, Any]:
        """Full v2rayN / V2Box importable JSON built from a share link."""
        parsed = urllib.parse.urlparse(link)
        protocol = parsed.scheme
        q = urllib.parse.parse_qs(parsed.query)
        one = lambda k, d="": (q.get(k, [d])[0] if q.get(k) else d)

        address = parsed.hostname or server.server_address
        port = int(parsed.port or server.server_port)
        network = one("type", "tcp")
        security = one("security", "none") or "none"
        remark = urllib.parse.unquote(parsed.fragment or user.username)

        outbound: Dict[str, Any] = {
            "protocol": protocol,
            "settings": {"vnext": [{"address": address, "port": port, "users": []}]},
            "streamSettings": {
                "network": network,
                "security": security,
                "sockopt": {"tcpFastOpen": False, "acceptProxyProtocol": False},
            },
            "mux": {"enabled": False, "concurrency": 8},
            "tag": remark,
        }

        credentials = parsed.username or ""
        if protocol == "shadowsocks":
            method, _, pw = urllib.parse.unquote(credentials).partition(":")
            if not pw:  # ss://base64(method:pass)@host:port
                decoded = base64.urlsafe_b64decode(credentials + "==").decode()
                method, _, pw = decoded.partition(":")
            outbound["settings"] = {
                "servers": [{"address": address, "port": port, "method": method, "password": pw}]
            }
            outbound["settings"].pop("vnext", None)
        else:
            user_obj: Dict[str, Any] = {"id": urllib.parse.unquote(credentials), "level": 0}
            if protocol == "vless":
                user_obj["encryption"] = one("encryption", "none")
                if one("flow"):
                    user_obj["flow"] = one("flow")
            elif protocol == "vmess":
                user_obj["alterId"] = 0
                user_obj["security"] = one("scy", "auto") or "auto"
            outbound["settings"]["vnext"][0]["users"] = [user_obj]

        stream = outbound["streamSettings"]
        if network in ("ws", "httpupgrade"):
            stream["wsSettings"] = {"path": one("path", "/"), "headers": {"Host": one("host", "")}}
        elif network == "grpc":
            stream["grpcSettings"] = {
                "serviceName": one("serviceName", "grpc"),
                "multiMode": one("mode", "gun") == "multi",
            }
        elif network in ("h2", "http"):
            stream["httpSettings"] = {"path": one("path", "/"), "host": [one("host", address)]}
        elif network in ("tcp", "raw"):
            stream["tcpSettings"] = {
                "header": {"type": one("headerType", "none") or "none"}
            }

        if security == "tls":
            stream["tlsSettings"] = {
                "serverName": one("sni", address),
                "alpn": (one("alpn") or "").split(",") if one("alpn") else [],
                "fingerprint": one("fp", "chrome"),
                "allowInsecure": False,
            }
        elif security == "reality":
            stream["realitySettings"] = {
                "show": False,
                "fingerprint": one("fp", "chrome"),
                "serverName": one("sni", address),
                "publicKey": one("pbk", ""),
                "shortId": one("sid", ""),
                "spiderX": one("spx", "/"),
            }

        return {
            "remarks": remark,
            "log": {"loglevel": "warning"},
            "dns": {"hosts": {}, "servers": ["1.1.1.1", "8.8.8.8"]},
            "inbounds": [
                {
                    "listen": "127.0.0.1",
                    "port": 10808,
                    "protocol": "socks",
                    "settings": {"auth": "noauth", "udp": True, "userLevel": 8},
                    "sniffing": {"enabled": True, "destOverride": ["http", "tls"]},
                    "tag": "socks",
                },
                {
                    "listen": "127.0.0.1",
                    "port": 10809,
                    "protocol": "http",
                    "settings": {"userLevel": 8},
                    "tag": "http",
                },
            ],
            "outbounds": [outbound],
            "routing": {
                "domainStrategy": "IPIfNonMatch",
                "rules": [
                    {
                        "type": "field",
                        "ip": ["geoip:private"],
                        "outboundTag": "block",
                    }
                ],
            },
        }

    # --------------------------------------------------------- dispatcher --
    @staticmethod
    def generate_config_link(user: Any, server: Any) -> str:
        """Generate the link matching the user/server protocol pair."""
        remark = user.remark or f"{server.server_name}-{user.username}"
        protocol = (user.protocol or server.protocol or "vless").lower()
        network = user.network or server.network or "ws"
        security = user.security or server.security or "tls"
        sni = server.sni or ""
        path = server.path or "/"
        host = server.host or ""
        fp = user.fingerprint or server.fingerprint or "chrome"

        if protocol == "vless":
            return ConfigGenerator.generate_vless_link(
                uuid_key=user.uuid_key,
                address=server.server_address,
                port=server.server_port,
                remark=remark,
                network=network,
                security=security,
                sni=sni,
                path=path,
                host=host,
                flow=user.flow or "",
                fingerprint=fp,
                reality_public_key=server.reality_public_key,
                reality_short_id=server.reality_short_id,
                service_name=server.service_name,
            )

        if protocol == "vmess":
            return ConfigGenerator.generate_vmess_link(
                uuid_key=user.uuid_key,
                address=server.server_address,
                port=server.server_port,
                remark=remark,
                network=network,
                security=security,
                sni=sni,
                path=path,
                host=host,
                fingerprint=fp,
                service_name=server.service_name,
            )

        if protocol == "trojan":
            return ConfigGenerator.generate_trojan_link(
                password=user.uuid_key,
                address=server.server_address,
                port=server.server_port,
                remark=remark,
                network=network,
                security=security,
                sni=sni,
                path=path,
                host=host,
                fingerprint=fp,
                service_name=server.service_name,
                flow=user.flow or "",
            )

        if protocol in ("shadowsocks", "ss"):
            return ConfigGenerator.generate_shadowsocks_link(
                password=user.uuid_key,
                address=server.server_address,
                port=server.server_port,
                remark=remark,
                method=user.method or server.method or "chacha20-ietf-poly1305",
            )

        return ""

    # ---------------------------------------------------- compatibility ---
    _NETWORK_ALIASES = {"raw": "tcp", "tcp": "tcp", "http": "h2", "h2": "h2",
                        "ws": "ws", "grpc": "grpc", "httpupgrade": "httpupgrade"}

    @staticmethod
    def is_compatible(user: Any, server: Any) -> bool:
        """A user's config only works on a server (inbound) with the same
        protocol + transport + security layer."""
        if (user.protocol or "").lower() != (server.protocol or "").lower():
            return False
        aliases = ConfigGenerator._NETWORK_ALIASES
        if aliases.get((user.network or "").lower()) != aliases.get((server.network or "").lower()):
            return False
        user_sec = (getattr(user, "security", None) or "tls").lower()
        server_sec = (server.security or "none").lower()
        if user_sec != server_sec:
            return False
        if server_sec == "reality" and not server.reality_public_key:
            return False
        return True

    @staticmethod
    def generate_all_links(user: Any, servers: List[Any], only_compatible: bool = True) -> List[Dict[str, str]]:
        """One link per compatible server for a given user."""
        out: List[Dict[str, str]] = []
        for server in servers:
            if only_compatible and not ConfigGenerator.is_compatible(user, server):
                continue
            link = ConfigGenerator.generate_config_link(user, server)
            if not link:
                continue
            out.append(
                {
                    "server": server.server_name,
                    "server_id": server.id,
                    "protocol": (user.protocol or server.protocol or "vless").lower(),
                    "remark": urllib.parse.unquote(link.split("#")[-1]) if "#" in link else user.username,
                    "link": link,
                }
            )
        return out
