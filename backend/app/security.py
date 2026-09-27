"""Password hashing (scrypt, standard library) and JWT tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import UTC, datetime, timedelta

import jwt

_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_b64, digest_b64 = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    digest = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64), n=_N, r=_R, p=_P)
    return hmac.compare_digest(digest, base64.b64decode(digest_b64))


def create_token(subject: str, secret: str, minutes: int, kind: str = "access", **claims) -> str:
    now = datetime.now(UTC)
    payload = {"sub": subject, "kind": kind, "iat": now, "exp": now + timedelta(minutes=minutes), **claims}
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str, secret: str, kind: str = "access") -> dict:
    payload = jwt.decode(token, secret, algorithms=["HS256"])
    if payload.get("kind") != kind:
        raise jwt.InvalidTokenError("wrong token kind")
    return payload


def table_token(table_id: int, secret: str) -> str:
    """Long-lived signed token printed in a table's QR code."""
    return create_token(str(table_id), secret, minutes=60 * 24 * 365 * 5, kind="table")
