"""Web Push: the browser side decrypts what we send (RFC 8291) and the VAPID signature checks out."""

import json

import jwt
import pytest

pytest.importorskip("cryptography")

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.services import webpush as wp


def hkdf(salt, ikm, info, n):
    return HKDF(algorithm=hashes.SHA256(), length=n, salt=salt, info=info).derive(ikm)


def browser_decrypt(body: bytes, ua_key: ec.EllipticCurvePrivateKey, auth: bytes) -> bytes:
    salt, rs, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
    as_public = body[21:21 + idlen]
    assert rs == 4096 and idlen == 65
    ua_public = ua_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = ua_key.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    ikm = hkdf(auth, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, body[21 + idlen:], None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


def test_browser_can_read_our_message():
    ua_key = ec.generate_private_key(ec.SECP256R1())
    auth = b"0123456789abcdef"
    p256dh = wp.b64u(ua_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    msg = {"title": "Booking confirmed", "body": "Table 2 for 4, Fri 5pm", "url": "/booking/40"}
    pub, priv = wp.new_vapid_keys()
    headers, body = wp.build_request("https://fcm.googleapis.com/fcm/send/abc", p256dh, wp.b64u(auth), msg, pub, priv,
                                     "mailto:hello@purevegi.co.uk")
    assert json.loads(browser_decrypt(body, ua_key, auth)) == msg
    assert headers["Content-Encoding"] == "aes128gcm"

    # VAPID: signed with our private key, for the push service's origin.
    token = headers["Authorization"].split("t=")[1].split(",")[0]
    assert headers["Authorization"].endswith(f"k={pub}")
    point = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), wp.unb64u(pub))
    claims = jwt.decode(token, point, algorithms=["ES256"], audience="https://fcm.googleapis.com")
    assert claims["sub"] == "mailto:hello@purevegi.co.uk"


def test_matches_rfc_8291_example():
    """The worked example in RFC 8291 Appendix A, byte for byte."""
    as_key = ec.derive_private_key(int.from_bytes(wp.unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"), ec.SECP256R1())
    body = wp.encrypt(b"When I grow up, I want to be a watermelon",
                      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
                      "BTBZMqHH6r4Tts7J_aSIgg", salt=wp.unb64u("DGv6ra1nlYgDCS1FRnbzlw"), server_key=as_key)
    assert wp.b64u(body) == (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQ"
        "pu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
