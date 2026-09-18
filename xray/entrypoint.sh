#!/bin/sh
# ==============================================================
#  xray-core entrypoint for the V2Box panel
#
#  * creates the log folder
#  * generates a self-signed certificate when ./certs is empty
#    (replace it with a real certificate for production!)
#  * validates config.json before starting
#  * exec's xray with the arguments given by docker-compose
# ==============================================================
set -e

CERT_DIR="/etc/xray/certs"
CONFIG="/etc/xray/config.json"
SNI="${SNI:-v2box.local}"

mkdir -p /var/log/xray "$CERT_DIR"

# ------------------------------------------------------------ certificate --
if [ ! -s "$CERT_DIR/fullchain.pem" ] || [ ! -s "$CERT_DIR/privkey.pem" ]; then
    if command -v openssl >/dev/null 2>&1; then
        echo "[entrypoint] no certificate found - creating a self-signed one for $SNI"
        openssl ecparam -genkey -name prime256v1 -noout -out "$CERT_DIR/privkey.pem" 2>/dev/null
        openssl req -new -x509 -nodes \
            -key "$CERT_DIR/privkey.pem" \
            -out "$CERT_DIR/fullchain.pem" \
            -days 825 \
            -subj "/CN=${SNI}/O=V2Box Panel" \
            -addext "subjectAltName=DNS:${SNI},DNS:localhost" >/dev/null 2>&1
        chmod 600 "$CERT_DIR/privkey.pem"
        echo "[entrypoint] certificate written to $CERT_DIR"
    else
        echo "[entrypoint] WARNING: openssl not available and no certificate present."
        echo "[entrypoint]          TLS inbounds will fail to start until you mount one"
        echo "[entrypoint]          into $CERT_DIR (fullchain.pem + privkey.pem)."
    fi
fi

# ---------------------------------------------------------------- validate --
if [ -f "$CONFIG" ] && command -v xray >/dev/null 2>&1; then
    if ! xray -test -config "$CONFIG" >/tmp/xray-test.log 2>&1; then
        echo "[entrypoint] WARNING: config.json failed validation:"
        cat /tmp/xray-test.log
        echo "[entrypoint] starting anyway - fix the config from the panel."
    fi
fi

echo "[entrypoint] starting xray $*"
exec xray "$@"
