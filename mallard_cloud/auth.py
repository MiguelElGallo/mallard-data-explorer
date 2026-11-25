"""GitHub web authorization for a single visitor, scoped to this mount."""

import base64
import hashlib
import html
import json
import os
import secrets
import time
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse


class GitHubLogin:
    def __init__(self):
        self.client_id = os.getenv("MALLARD_GITHUB_CLIENT_ID", "")
        self.client_secret = os.getenv("MALLARD_GITHUB_CLIENT_SECRET", "")
        self.url = os.getenv("MALLARD_PUBLIC_URL", "").rstrip("/")
        address = urlsplit(self.url)
        self.origin = f"{address.scheme}://{address.netloc}"
        self.path = address.path.rstrip("/") + "/"
        self.secure = address.scheme == "https"
        self.cipher = None
        key = os.getenv("MALLARD_SESSION_KEY")
        valid_url = self.secure or (
            address.scheme == "http"
            and address.hostname in {"localhost", "127.0.0.1", "::1"}
        )
        if (
            key
            and valid_url
            and address.hostname
            and not (
                address.username
                or address.password
                or address.query
                or address.fragment
            )
        ):
            try:
                self.cipher = Fernet(key)
            except ValueError:
                pass

    @property
    def available(self):
        return bool(self.cipher and self.client_id and self.client_secret)

    def cookie_name(self, purpose):
        return ("__Secure-" if self.secure else "") + "mallard_" + purpose

    def read(self, request, purpose):
        value = request.cookies.get(self.cookie_name(purpose))
        if not self.available or not value:
            return {}
        try:
            data = json.loads(self.cipher.decrypt(value.encode("ascii"), ttl=3600))
            if data["purpose"] == purpose and data["until"] > time.time():
                return data
        except (InvalidToken, ValueError, KeyError, UnicodeError):
            pass
        return {}

    def write(self, response, purpose, seconds, **values):
        values.update(purpose=purpose, until=int(time.time()) + seconds)
        value = self.cipher.encrypt(json.dumps(values).encode()).decode("ascii")
        response.set_cookie(
            self.cookie_name(purpose),
            value,
            max_age=seconds,
            path=self.path,
            secure=self.secure,
            httponly=True,
            samesite="lax",
        )

    def clear(self, response, purpose):
        response.delete_cookie(
            self.cookie_name(purpose),
            path=self.path,
            secure=self.secure,
            httponly=True,
            samesite="lax",
        )

    def same_origin(self, request):
        if not self.available:
            raise HTTPException(503, "GitHub sign-in is awaiting configuration.")
        if request.headers.get("origin") != self.origin:
            raise HTTPException(403, "Open Mallard to make this request.")

    def begin(self):
        if not self.available:
            raise HTTPException(503, "GitHub sign-in is awaiting configuration.")
        state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.url + "/auth/github/callback",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        response = RedirectResponse(
            "https://github.com/login/oauth/authorize?" + urlencode(params),
            status_code=302,
        )
        self.write(response, "flow", 600, state=state, verifier=verifier)
        return response

    async def callback(self, request: Request):
        flow = self.read(request, "flow")
        state, code = (
            request.query_params.get("state", ""),
            request.query_params.get("code", ""),
        )
        if (
            not flow
            or not state.isascii()
            or not secrets.compare_digest(flow["state"], state)
            or not code
            or len(code) > 512
        ):
            return self.finish_page(False)
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                reply = await client.post(
                    "https://github.com/login/oauth/access_token",
                    headers={"Accept": "application/json"},
                    data={
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "code": code,
                        "redirect_uri": self.url + "/auth/github/callback",
                        "code_verifier": flow["verifier"],
                    },
                )
                reply.raise_for_status()
                credentials = reply.json()
                token = credentials["access_token"]
                user = await client.get(
                    "https://api.github.com/user",
                    headers={
                        "Authorization": "Bearer " + token,
                        "Accept": "application/vnd.github+json",
                    },
                )
                user.raise_for_status()
                login = user.json()["login"]
                ttl = min(3600, int(credentials.get("expires_in", 3600)))
                if ttl <= 0 or not isinstance(login, str) or not login:
                    return self.finish_page(False)
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return self.finish_page(False)
        response = self.finish_page(True)
        self.write(response, "session", ttl, token=token, login=login)
        return response

    def finish_page(self, success):
        title = (
            "You’re signed in to Mallard"
            if success
            else "GitHub sign-in did not finish"
        )
        note = (
            "Return to your Mallard tab to ask Copilot."
            if success
            else "Return to your Mallard tab to try again."
        )
        script = (
            '<script>try { new BroadcastChannel("mallard-login").postMessage("signed-in"); } catch {} window.close();</script>'
            if success
            else ""
        )
        response = HTMLResponse(
            f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            f'<title>{title}</title><link rel="stylesheet" href="{html.escape(self.path)}styles.css">'
            f'<main style="padding:2rem"><h1>{title}</h1><p>{note}</p><a href="{html.escape(self.path)}">Open Mallard</a></main>{script}</html>',
            status_code=200 if success else 400,
        )
        self.clear(response, "flow")
        return response

    async def logout(self, request: Request):
        self.same_origin(request)
        session = self.read(request, "session")
        if session:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    await client.request(
                        "DELETE",
                        f"https://api.github.com/applications/{self.client_id}/token",
                        auth=(self.client_id, self.client_secret),
                        json={"access_token": session["token"]},
                    )
            except httpx.HTTPError:
                pass  # The local session still ends if GitHub is unavailable.
        response = Response(status_code=204)
        self.clear(response, "session")
        self.clear(response, "flow")
        return response
