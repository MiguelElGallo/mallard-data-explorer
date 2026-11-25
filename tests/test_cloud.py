import base64
import hashlib
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from mallard_cloud import assistant, auth
from mallard_cloud.app import create_app

ORIGIN = "https://mallard.test"
BASE = "/mallard/"
SAMPLE = {
    "question": "Count flights",
    "tables": [{"name": "flights", "columns": [{"name": "origin", "type": "VARCHAR"}]}],
}


@pytest.fixture
def client(monkeypatch):
    for key, value in {
        "PUBLIC_URL": ORIGIN + BASE,
        "SESSION_KEY": Fernet.generate_key().decode(),
        "GITHUB_CLIENT_ID": "test-client",
        "GITHUB_CLIENT_SECRET": "test-only",
    }.items():
        monkeypatch.setenv("MALLARD_" + key, value)
    host = FastAPI()
    host.mount("/mallard", create_app())
    return TestClient(host, base_url=ORIGIN, follow_redirects=False)


def sign_in(client, monkeypatch, login="alice"):
    begin = client.get(BASE + "auth/github")
    params = parse_qs(urlsplit(begin.headers["location"]).query)
    assert params["redirect_uri"] == [ORIGIN + BASE + "auth/github/callback"]
    assert begin.status_code == 302 and params["code_challenge_method"] == ["S256"]
    token = f"fictional-{login}-token"

    def github(req):
        if req.url.path == "/login/oauth/access_token":
            form = parse_qs(req.content.decode())
            digest = hashlib.sha256(form["code_verifier"][0].encode()).digest()
            assert (
                base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
                == params["code_challenge"][0]
            )
            return httpx.Response(200, json={"access_token": token, "expires_in": 300})
        assert (
            req.url.path == "/user"
            and req.headers["Authorization"] == "Bearer " + token
        )
        return httpx.Response(200, json={"login": login})

    native = httpx.AsyncClient
    with monkeypatch.context() as patch:
        patch.setattr(
            auth.httpx,
            "AsyncClient",
            lambda **kw: native(transport=httpx.MockTransport(github), **kw),
        )
        callback = client.get(
            BASE + "auth/github/callback",
            params={"state": params["state"][0], "code": "test-code"},
        )
    assert callback.status_code == 200
    cookies = callback.headers["set-cookie"]
    assert all(
        flag in cookies
        for flag in ["Path=/mallard/", "HttpOnly", "Secure", "SameSite=lax"]
    )
    assert token not in cookies and token not in callback.text
    return token


def test_mount_and_anonymous(client):
    assert client.get(BASE + "api/session").json() == {"available": True, "login": None}
    index = client.get(BASE)
    assert index.text == client.get(BASE + "index.html").text
    assert "cloud-assistant" in index.text and "Copy prompt" not in index.text
    assert client.get(BASE + "cloud-assets/assistant.js").is_success
    assert client.get(BASE + "samples/flights.parquet").is_success
    assert (
        client.post(
            BASE + "api/draft", headers={"Origin": ORIGIN}, json=SAMPLE
        ).status_code
        == 401
    )
    assert (
        client.get(BASE + "auth/github/callback?state=other&code=invalid").status_code
        == 400
    )


def test_consent_and_isolation(client, monkeypatch):
    alice = sign_in(client, monkeypatch)
    second = TestClient(client.app, base_url=ORIGIN, follow_redirects=False)
    bob = sign_in(second, monkeypatch, "bob")
    actual = []

    async def draft(token, payload):
        actual.append((token, payload.model_dump()))
        return assistant.Draft(kind="sql", text="SELECT count(*) FROM flights")

    monkeypatch.setattr(assistant, "generate_draft", draft)
    for visitor, name in [(client, "alice"), (second, "bob")]:
        status = visitor.get(BASE + "api/session")
        assert (
            status.headers["cache-control"] == "no-store"
            and status.json()["login"] == name
        )
        response = visitor.post(
            BASE + "api/draft", headers={"Origin": ORIGIN}, json=SAMPLE
        )
        assert response.is_success and response.json()["kind"] == "sql"
    assert actual == [(alice, SAMPLE), (bob, SAMPLE)]
    assert (
        client.post(
            BASE + "api/logout", headers={"Origin": "https://other.test"}
        ).status_code
        == 403
    )
    native = httpx.AsyncClient

    def revoke(req):
        assert (
            req.method == "DELETE" and req.url.path == "/applications/test-client/token"
        )
        return httpx.Response(204)

    monkeypatch.setattr(
        auth.httpx,
        "AsyncClient",
        lambda **kw: native(transport=httpx.MockTransport(revoke), **kw),
    )
    assert (
        client.post(BASE + "api/logout", headers={"Origin": ORIGIN}).status_code == 204
    )
    assert client.get(BASE + "api/session").json()["login"] is None
    assert second.get(BASE + "api/session").json()["login"] == "bob"


def test_strict_input_and_limits(client, monkeypatch):
    sign_in(client, monkeypatch)
    url = BASE + "api/draft"
    assert (
        client.post(
            url, json=SAMPLE, headers={"Origin": "https://other.test"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            url, json=SAMPLE | {"rows": ["private row"]}, headers={"Origin": ORIGIN}
        ).status_code
        == 422
    )
    assert (
        client.post(
            url, data={"question": "hello"}, headers={"Origin": ORIGIN}
        ).status_code
        == 415
    )
    assert (
        client.post(
            url,
            content=b" " * 99_000,
            headers={"Origin": ORIGIN, "Content-Type": "application/json"},
        ).status_code
        == 413
    )
    client.cookies.clear()
    client.cookies.set(
        "__Secure-mallard_session", "tampered", domain="mallard.test", path=BASE
    )
    assert client.post(url, json=SAMPLE, headers={"Origin": ORIGIN}).status_code == 401
