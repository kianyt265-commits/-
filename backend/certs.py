"""Self-signed certificate bootstrap.

xray refuses to start a TLS inbound when the certificate files are missing,
so the panel makes sure `./certs/fullchain.pem` + `privkey.pem` exist before
the core boots.  Replace them with a real (Let's Encrypt) certificate for
production use — see README → «TLS و دامنه».
"""

import datetime
import ipaddress
import os
from typing import Dict, List, Optional

CERT_DIR = os.getenv("CERT_DIR", "./certs")
FULLCHAIN = os.path.join(CERT_DIR, "fullchain.pem")
PRIVKEY = os.path.join(CERT_DIR, "privkey.pem")


def cert_status(cert_dir: str = CERT_DIR) -> Dict[str, object]:
    fullchain = os.path.join(cert_dir, "fullchain.pem")
    privkey = os.path.join(cert_dir, "privkey.pem")
    info: Dict[str, object] = {
        "dir": cert_dir,
        "fullchain": os.path.abspath(fullchain),
        "privkey": os.path.abspath(privkey),
        "exists": os.path.exists(fullchain) and os.path.exists(privkey),
        "self_signed": True,
        "not_after": None,
        "subject": None,
    }
    if info["exists"]:
        try:
            from cryptography import x509
            from cryptography.hazmat.backends import default_backend

            with open(fullchain, "rb") as fh:
                cert = x509.load_pem_x509_certificate(fh.read(), default_backend())
            # cryptography >= 42 exposes the tz-aware attribute
            not_after = getattr(cert, "not_valid_after_utc", None)
            if not_after is None:
                import datetime as _dt

                not_after = cert.not_valid_after.replace(tzinfo=_dt.timezone.utc)
            info["not_after"] = not_after.isoformat()
            info["subject"] = cert.subject.rfc4514_string()
            info["self_signed"] = cert.subject == cert.issuer
        except Exception as exc:  # pragma: no cover
            info["error"] = str(exc)
    return info


def ensure_cert(common_name: Optional[str] = None,
                san_hosts: Optional[List[str]] = None,
                cert_dir: str = CERT_DIR,
                days: int = 825) -> Dict[str, object]:
    """Create a self-signed ECDSA certificate if none exists yet."""
    os.makedirs(cert_dir, exist_ok=True)
    fullchain = os.path.join(cert_dir, "fullchain.pem")
    privkey = os.path.join(cert_dir, "privkey.pem")

    if os.path.exists(fullchain) and os.path.getsize(fullchain) > 0 \
            and os.path.exists(privkey) and os.path.getsize(privkey) > 0:
        status = cert_status(cert_dir)
        status["created"] = False
        return status

    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID

    cn = common_name or os.getenv("PUBLIC_DOMAIN", "").replace("https://", "").replace("http://", "").split("/")[0]
    cn = cn or "v2box.local"

    key = ec.generate_private_key(ec.SECP256R1(), default_backend())
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, cn),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "V2Box Panel"),
    ])

    alt_names: List[x509.GeneralName] = [x509.DNSName(cn), x509.DNSName("localhost")]
    for host in (san_hosts or []):
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(host)))
        except ValueError:
            alt_names.append(x509.DNSName(host))

    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=days))
        .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256(), default_backend())
    )

    with open(privkey, "wb") as fh:
        fh.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ))
    os.chmod(privkey, 0o600)
    with open(fullchain, "wb") as fh:
        fh.write(cert.public_bytes(serialization.Encoding.PEM))

    status = cert_status(cert_dir)
    status["created"] = True
    return status
