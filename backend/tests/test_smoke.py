"""End-to-end smoke tests for the V2Box panel backend.

Runs against a throw-away SQLite database and a *copy* of xray/config.json so
the repository files are never modified.

    python tests/test_smoke.py          # no dependencies beyond requirements.txt
    pytest tests/test_smoke.py -q       # if you prefer pytest
"""

import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

WORKDIR = tempfile.mkdtemp(prefix="v2box-test-")
os.environ.update({
    "SECRET_KEY": "test-secret-key",
    "DATABASE_URL": f"sqlite:///{WORKDIR}/test.db",
    "XRAY_CONFIG_PATH": f"{WORKDIR}/config.json",
    "XRAY_BACKUP_DIR": f"{WORKDIR}/backup",
    "CERT_DIR": f"{WORKDIR}/certs",
    "ADMIN_USERNAME": "admin",
    "ADMIN_PASSWORD": "admin123",
    "SEED_DEMO_DATA": "true",
    "SIMULATE_TRAFFIC": "false",
    "SYNC_INTERVAL": "3600",
    "PUBLIC_DOMAIN": "https://vpn.example.com",
    "SERVE_FRONTEND": "false",
})
shutil.copy(os.path.join(ROOT, "xray", "config.json"), os.environ["XRAY_CONFIG_PATH"])

from fastapi.testclient import TestClient  # noqa: E402

import app as backend  # noqa: E402

FAILURES = []


def check(condition, message):
    if condition:
        print(f"  ✓ {message}")
    else:
        print(f"  ✗ {message}")
        FAILURES.append(message)


def login(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_health_and_auth(client):
    print("\n[health & auth]")
    res = client.get("/api/health")
    check(res.status_code == 200 and res.json()["status"] == "ok", "GET /api/health")

    check(client.get("/api/users").status_code == 401, "unauthenticated /api/users -> 401")
    check(client.get("/api/users", headers={"Authorization": "Bearer nonsense"}).status_code == 401,
          "invalid token -> 401")

    bad = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    check(bad.status_code == 401, "wrong password -> 401")

    headers = login(client)
    me = client.get("/api/auth/me", headers=headers)
    check(me.status_code == 200 and me.json()["username"] == "admin", "GET /api/auth/me")

    meta = client.get("/api/meta", headers=headers).json()
    check("vless" in meta["protocols"] and meta["demo_mode"] is True, "GET /api/meta")
    return headers


def test_bootstrap(client, headers):
    print("\n[bootstrap: servers imported from config.json + sample users]")
    servers = client.get("/api/servers", headers=headers).json()
    check(servers["total"] == 5, f"5 inbounds imported as servers (got {servers['total']})")
    defaults = [s for s in servers["servers"] if s["is_default"]]
    check(len(defaults) == 1, "exactly one default server")
    check(defaults and defaults[0]["network"] == "ws" and defaults[0]["security"] == "tls",
          "default server is the vless/ws/tls inbound")

    users = client.get("/api/users?limit=100", headers=headers).json()
    expected = len(backend.SAMPLE_USERS)
    check(users["total"] == expected, f"{expected} sample users seeded (got {users['total']})")
    dash = client.get("/api/dashboard", headers=headers).json()
    check(dash["total_users"] == expected and dash["total_servers"] == 5, "dashboard counters")
    check(dash["expired_users"] >= 1 and dash["active_users"] >= 5,
          f"sample data covers several statuses (expired={dash['expired_users']}, active={dash['active_users']})")
    check(len(dash["traffic_chart"]) >= 7, f"7 days of traffic history seeded ({len(dash['traffic_chart'])} day(s))")
    check(dash["xray"]["config_ok"] is True, "config.json parses and summarises")
    return servers["servers"], users["users"]


def test_links_are_compatible(client, headers, servers, users):
    print("\n[link generation only for matching inbounds]")
    by_name = {s["server_name"]: s for s in servers}
    ws_server = by_name["VLESS-WS-8443"]
    reality_server = by_name["VLESS-REALITY-443"]

    ali = next(u for u in users if u["protocol"] == "vless" and u["network"] == "ws")
    links = client.get(f"/api/users/{ali['id']}/links", headers=headers).json()["links"]
    check(len(links) == 1 and links[0]["server"] == "VLESS-WS-8443",
          f"vless/ws user gets exactly the ws inbound ({len(links)} link(s))")
    link = links[0]["link"]
    check(link.startswith("vless://") and "type=ws" in link and "path=%2Fv2box-ws" in link,
          "vless link carries the right transport + path")

    sara = next(u for u in users if u["security"] == "reality")
    rlinks = client.get(f"/api/users/{sara['id']}/links", headers=headers).json()["links"]
    check(len(rlinks) == 1 and rlinks[0]["server"] == "VLESS-REALITY-443",
          "reality user only matches the reality inbound")
    rlink = rlinks[0]["link"]
    check("security=reality" in rlink and "pbk=" in rlink and "sid=" in rlink and "flow=xtls-rprx-vision" in rlink,
          "reality link has pbk/sid/flow")

    reza = next(u for u in users if u["protocol"] == "vmess")
    vlinks = client.get(f"/api/users/{reza['id']}/links", headers=headers).json()["links"]
    check(len(vlinks) == 1 and vlinks[0]["link"].startswith("vmess://"), "vmess link generated")
    import base64
    payload = json.loads(base64.b64decode(vlinks[0]["link"].split("vmess://")[1]).decode())
    check(payload["net"] == "ws" and payload["tls"] == "tls" and payload["port"] == "2083",
          "vmess base64 payload is well formed")

    mina = next(u for u in users if u["protocol"] == "trojan")
    tlinks = client.get(f"/api/users/{mina['id']}/links", headers=headers).json()["links"]
    check(len(tlinks) == 1 and tlinks[0]["link"].startswith("trojan://") and ":2087?" in tlinks[0]["link"],
          "trojan link generated for the trojan inbound")

    # explicit server filter + non-matching combination
    only = client.get(f"/api/users/{ali['id']}/links?server_id={reality_server['id']}", headers=headers).json()
    check(len(only["links"]) == 0, "asking for an incompatible server returns no link")
    check(ws_server["protocol"] == "vless", "sanity: ws server is vless")


def test_user_crud_and_xray_config(client, headers):
    print("\n[user CRUD + config.json sync]")
    created = client.post("/api/users", headers=headers, json={
        "username": "qa-user", "protocol": "vless", "network": "ws", "security": "tls",
        "data_limit": 10, "expire_days": 7, "max_connections": 3, "remark": "QA User",
    })
    check(created.status_code == 200, "POST /api/users")
    user = created.json()["user"]
    uid = user["id"]
    check(user["data_limit"] == 10 * 1024 ** 3, "data_limit stored in bytes")
    check(user["days_left"] in (6, 7), "expire date computed")
    check(isinstance(created.json()["warnings"], list), "compatibility warnings are returned")

    mismatch = client.post("/api/users", headers=headers, json={
        "username": "qa-mismatch", "protocol": "trojan", "network": "grpc", "security": "reality",
    }).json()
    check(any("سازگار نیست" in w for w in mismatch["warnings"]),
          "a user matching no inbound gets a warning")
    check(len(mismatch["links"]) == 0, "no link is produced for an impossible combination")
    client.delete(f"/api/users/{mismatch['id']}", headers=headers)

    dup = client.post("/api/users", headers=headers, json={"username": "qa-user"})
    check(dup.status_code == 400, "duplicate username rejected")
    invalid = client.post("/api/users", headers=headers, json={"username": "bad user!", "protocol": "nope"})
    check(invalid.status_code == 422, "invalid username/protocol rejected (422)")

    config = json.loads(open(os.environ["XRAY_CONFIG_PATH"]).read())
    ws_inbound = next(i for i in config["inbounds"] if i["tag"] == "VLESS-WS-8443")
    emails = [c["email"] for c in ws_inbound["settings"]["clients"]]
    check("qa-user.VLESS-WS-8443" in emails, f"user pushed into the ws inbound ({emails})")
    grpc_inbound = next(i for i in config["inbounds"] if i["tag"] == "VLESS-GRPC-2053")
    grpc_emails = [c["email"] for c in grpc_inbound["settings"]["clients"]]
    check("qa-user.VLESS-GRPC-2053" not in grpc_emails, "user NOT leaked into the grpc inbound")

    upd = client.put(f"/api/users/{uid}", headers=headers, json={"data_limit": 20, "expire_days": 30, "is_active": False})
    check(upd.status_code == 200 and upd.json()["user"]["is_active"] is False, "PUT /api/users/{id} disables")
    config = json.loads(open(os.environ["XRAY_CONFIG_PATH"]).read())
    ws_inbound = next(i for i in config["inbounds"] if i["tag"] == "VLESS-WS-8443")
    check("qa-user.VLESS-WS-8443" not in [c["email"] for c in ws_inbound["settings"]["clients"]],
          "disabled user removed from config.json")

    client.post(f"/api/users/{uid}/toggle", headers=headers)
    client.post(f"/api/users/{uid}/extend", headers=headers, json={"days": 15})
    reset = client.post(f"/api/users/{uid}/reset-traffic", headers=headers).json()
    check(reset["user"]["data_used"] == 0, "reset-traffic zeroes the counters")

    traffic = client.put(f"/api/users/{uid}/traffic", headers=headers,
                         json={"upload": 1000, "download": 2000}).json()
    check(traffic["user"]["data_used"] == 3000, "manual traffic accounting")

    rotated = client.post(f"/api/users/{uid}/rotate-uuid", headers=headers).json()
    check(rotated["user"]["uuid_key"] != user["uuid_key"], "rotate-uuid changes the key")

    qr = client.get(f"/api/users/{uid}/qrcode?fmt=png", headers=headers)
    check(qr.status_code == 200 and qr.content[:8] == b"\x89PNG\r\n\x1a\n", "QR code PNG generated")
    svg = client.get(f"/api/users/{uid}/qrcode?fmt=svg&content=subscription", headers=headers)
    check(svg.status_code == 200 and b"<svg" in svg.content, "QR code SVG generated")

    client_json = client.get(f"/api/users/{uid}/config.json", headers=headers).json()
    check(client_json["outbounds"][0]["protocol"] == "vless"
          and client_json["outbounds"][0]["streamSettings"]["network"] == "ws",
          "client JSON config is importable")

    bulk = client.post("/api/users/bulk", headers=headers, json={
        "prefix": "qa", "count": 3, "protocol": "vless", "network": "ws", "security": "tls",
        "expire_days": 30, "data_limit": 5}).json()
    check(bulk["count"] == 3 and len(bulk["created"]) == 3, "bulk creation")

    deleted = client.delete(f"/api/users/{uid}", headers=headers)
    check(deleted.status_code == 200, "DELETE /api/users/{id}")
    check(client.get(f"/api/users/{uid}", headers=headers).status_code == 404, "deleted user is gone")
    return uid


def test_public_subscription(client, headers):
    print("\n[public subscription endpoints]")
    users = client.get("/api/users?search=ali.rezaei", headers=headers).json()["users"]
    user = users[0]
    sub_id = user["sub_id"]

    res = client.get(f"/sub/{sub_id}")
    check(res.status_code == 200, "GET /sub/{sub_id} needs no auth")
    import base64
    body = base64.b64decode(res.text).decode()
    check(body.startswith("vless://"), "subscription body is base64 of the links")
    check(res.headers.get("profile-title", "").startswith("base64:"), "profile-title header present")
    check("subscription-userinfo" in res.headers, "subscription-userinfo header present")

    plain = client.get(f"/sub/{sub_id}/links")
    check(plain.status_code == 200 and plain.text.startswith("vless://"), "/sub/{id}/links plaintext")

    info = client.get(f"/sub/{sub_id}/info").json()
    check(info["username"] == "ali.rezaei" and "qrcode" in info, "/sub/{id}/info")

    png = client.get(f"/sub/{sub_id}/qrcode.png")
    check(png.status_code == 200 and (png.content[:8] == b"\x89PNG\r\n\x1a\n" or b"<svg" in png.content),
          "/sub/{id}/qrcode.png")

    share = client.get(f"/share/{sub_id}")
    check(share.status_code == 200 and "کانفیگ" in share.text, "/share/{id} page")

    check(client.get("/sub/does-not-exist").status_code == 404, "unknown subscription -> 404")


def test_servers_and_xray_control(client, headers):
    print("\n[servers + xray control]")
    created = client.post("/api/servers", headers=headers, json={
        "server_name": "QA-Server", "server_address": "qa.example.com", "server_port": 2096,
        "protocol": "vless", "network": "ws", "security": "tls", "sni": "qa.example.com",
        "path": "/qa", "inbound_tag": "QA-NOT-IN-CONFIG",
    })
    check(created.status_code == 200, "POST /api/servers")
    sid = created.json()["server"]["id"]

    upd = client.put(f"/api/servers/{sid}", headers=headers, json={"server_address": "qa2.example.com", "path": "/qa2"})
    check(upd.json()["server"]["server_address"] == "qa2.example.com", "PUT /api/servers/{id}")

    default = client.post(f"/api/servers/{sid}/set-default", headers=headers).json()
    check(default["server"]["is_default"] is True, "set-default works")

    reality = client.post("/api/servers", headers=headers, json={
        "server_name": "QA-Reality", "server_address": "r.example.com", "server_port": 443,
        "protocol": "vless", "network": "tcp", "security": "reality",
    }).json()["server"]
    check(bool(reality["reality_public_key"]) and bool(reality["has_private_key"]) and len(reality["reality_short_id"]) == 8,
          "reality keys auto-generated on creation")

    keys = client.post(f"/api/servers/{reality['id']}/reality-keys", headers=headers).json()
    check(keys["public_key"] != reality["reality_public_key"], "reality key rotation")

    keypair = client.post("/api/xray/reality-keys", headers=headers).json()
    check(len(keypair["private_key"]) >= 40 and len(keypair["public_key"]) >= 40, "standalone keypair endpoint")

    status = client.get("/api/xray/status", headers=headers).json()
    check(status["config"]["ok"] is True and status["docker_available"] is False,
          "xray status (docker unavailable in tests)")

    cfg = client.get("/api/xray/config", headers=headers).json()
    check(len(cfg["config"]["inbounds"]) >= 5, "raw config readable")

    broken = dict(cfg["config"])
    broken.pop("outbounds")
    check(client.put("/api/xray/config", headers=headers,
                     json={"config": broken, "restart": False}).status_code == 400,
          "invalid config rejected")

    saved = client.put("/api/xray/config", headers=headers, json={"config": cfg["config"], "restart": False})
    check(saved.status_code == 200 and saved.json()["ok"] is True, "valid config saved")
    check(os.path.isdir(os.environ["XRAY_BACKUP_DIR"]), "backup folder created")

    sync = client.post("/api/xray/sync?restart=false", headers=headers).json()
    check(sync["ok"] is True and "inbounds" in sync, "POST /api/xray/sync")

    test_res = client.post("/api/xray/test", headers=headers).json()
    check(test_res["json_valid"] is True, "config json validity check")

    logs = client.get("/api/xray/logs?lines=10", headers=headers).json()
    check("lines" in logs, "log tail endpoint")

    check(client.delete(f"/api/servers/{sid}", headers=headers).status_code == 200, "DELETE /api/servers/{id}")

    audit = client.get("/api/audit?limit=50", headers=headers).json()
    actions = {row["action"] for row in audit["logs"]}
    check("user_created" in actions and "server_created" in actions, "audit log recorded actions")


def test_password_change(client, headers):
    print("\n[password change]")
    wrong = client.post("/api/auth/change-password", headers=headers,
                        json={"current_password": "nope", "new_password": "newpass123"})
    check(wrong.status_code == 400, "wrong current password rejected")
    ok = client.post("/api/auth/change-password", headers=headers,
                     json={"current_password": "admin123", "new_password": "newpass123"})
    check(ok.status_code == 200, "password changed")
    check(client.post("/api/auth/login", json={"username": "admin", "password": "newpass123"}).status_code == 200,
          "login with the new password")
    check(client.post("/api/auth/login", json={"username": "admin", "password": "admin123"}).status_code == 401,
          "old password no longer works")
    new_headers = {
        "Authorization": "Bearer " + client.post(
            "/api/auth/login", json={"username": "admin", "password": "newpass123"}
        ).json()["access_token"]
    }
    revert = client.post("/api/auth/change-password", headers=new_headers,
                         json={"current_password": "newpass123", "new_password": "admin123"})
    check(revert.status_code == 200, "password can be changed again")


def test_certificates():
    print("\n[certificate bootstrap]")
    import certs
    cert_dir = os.environ["CERT_DIR"]
    # bootstrap() already created one during app startup
    check(os.path.exists(os.path.join(cert_dir, "fullchain.pem"))
          and os.path.exists(os.path.join(cert_dir, "privkey.pem")),
          "bootstrap created a self-signed certificate")
    status = certs.ensure_cert(cert_dir=cert_dir)
    check(status["created"] is False, "existing certificate is kept")
    info = certs.cert_status(cert_dir)
    check(info["exists"] and info["not_after"] and info["self_signed"] is True,
          "certificate metadata readable")

    fresh = os.path.join(cert_dir, "fresh")
    created = certs.ensure_cert(common_name="vpn.example.com", cert_dir=fresh)
    check(created["created"] is True and os.path.exists(fresh + "/fullchain.pem"),
          "a missing certificate is generated on demand")
    mode = oct(os.stat(os.path.join(fresh, "privkey.pem")).st_mode)[-3:]
    check(mode == "600", f"private key is 0600 (got {mode})")


def main():
    with TestClient(backend.app) as client:
        headers = test_health_and_auth(client)
        servers, users = test_bootstrap(client, headers)
        test_links_are_compatible(client, headers, servers, users)
        test_user_crud_and_xray_config(client, headers)
        test_public_subscription(client, headers)
        test_servers_and_xray_control(client, headers)
        test_password_change(client, headers)
        test_certificates()

    shutil.rmtree(WORKDIR, ignore_errors=True)
    print("\n" + "=" * 56)
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s)")
        for item in FAILURES:
            print(f"  - {item}")
        sys.exit(1)
    print("ALL CHECKS PASSED")
    print("=" * 56)


if __name__ == "__main__":
    main()
