"""Browser notifications with the standard Web Push protocol (RFC 8030/8291/8292).

Our own implementation: the message is encrypted for the browser (aes128gcm) and signed
with our VAPID key, then posted to the browser maker's push endpoint. No third-party account.
"""

from __future__ import annotations

import base64
import json
import os
import time
from urllib.parse import urlsplit

import jwt
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def _raw_public(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def new_vapid_keys() -> tuple[str, str]:
    """(public, private) as base64url: the public key goes to browsers, the private stays on the server."""
    key = ec.generate_private_key(ec.SECP256R1())
    return b64u(_raw_public(key)), b64u(key.private_numbers().private_value.to_bytes(32, "big"))


def encrypt(payload: bytes, p256dh: str, auth: str, *, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """RFC 8291 message encryption, one record, aes128gcm content coding."""
    ua_public = unb64u(p256dh)
    auth_secret = unb64u(auth)
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_public = _raw_public(server_key)
    salt = salt or os.urandom(16)
    shared = server_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public))
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    header = salt + (4096).to_bytes(4, "big") + bytes([len(as_public)]) + as_public
    return header + body


def vapid_headers(endpoint: str, public_key: str, private_key: str, subject: str) -> dict[str, str]:
    """RFC 8292: prove the push comes from us, so only our server can message our subscribers."""
    parts = urlsplit(endpoint)
    private_value = int.from_bytes(unb64u(private_key), "big")
    key = ec.derive_private_key(private_value, ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    token = jwt.encode({"aud": f"{parts.scheme}://{parts.netloc}", "exp": int(time.time()) + 12 * 3600, "sub": subject},
                       pem, algorithm="ES256")
    return {"Authorization": f"vapid t={token}, k={public_key}"}


def build_request(endpoint: str, p256dh: str, auth: str, message: dict, public_key: str, private_key: str,
                  subject: str) -> tuple[dict[str, str], bytes]:
    body = encrypt(json.dumps(message).encode(), p256dh, auth)
    headers = {"Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "high",
               **vapid_headers(endpoint, public_key, private_key, subject)}
    return headers, body
