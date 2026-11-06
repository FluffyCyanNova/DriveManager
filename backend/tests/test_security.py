from app.core.encryption import decrypt, encrypt
from app.core.logging import redact


def test_encrypt_roundtrip_is_not_plaintext():
    t = encrypt("1//refresh-token-value")
    assert "refresh" not in t and decrypt(t) == "1//refresh-token-value"


def test_log_redaction():
    line = ("GET /auth/google/callback?code=4/0AbC&state=xyz HTTP/1.1 Authorization: Bearer ya29.a0AfH6SMB-secret "
            "refresh_token=1//0gAAAAAAAAAAAAAAAAAAAAAAAAAAAA client_secret=GOCSPX-abc")
    out = redact(line)
    for leaked in ("4/0AbC", "xyz", "ya29.a0AfH6SMB", "GOCSPX-abc", "0gAAAAAAAA"):
        assert leaked not in out
