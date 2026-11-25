"""Serve Mallard at a host-selected prefix, with a same-origin SQL assistant."""

import asyncio
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from . import assistant
from .auth import GitHubLogin

PACKAGE = Path(__file__).parent
STATIC = (
    PACKAGE / "static" if (PACKAGE / "static").is_dir() else PACKAGE.parent / "dist"
)
UI = PACKAGE / "ui"
MAX_INPUT_BYTES = 96 * 1024


def explorer_html() -> str:
    source = (STATIC / "index.html").read_text(encoding="utf-8")
    source = re.sub(
        r"<!-- sites-only -->.*?<!-- /sites-only -->", "", source, flags=re.DOTALL
    )
    trigger = '<button id="cloud-assistant" class="button assistant-trigger" aria-haspopup="dialog"><i data-icon="sparkles"></i>Ask Copilot</button>'
    source, count = re.subn(
        r'<template id="pages-copilot-link">.*?</template>',
        trigger,
        source,
        flags=re.DOTALL,
    )
    if count != 1:
        raise ValueError("Missing Mallard assistant placement")
    source = source.replace(
        "</head>",
        '<link rel="stylesheet" href="./sql-assistant.css"><script type="module" src="./cloud-assets/assistant.js"></script></head>',
    )
    return source.replace(
        "</body>", (UI / "assistant.html").read_text(encoding="utf-8") + "</body>"
    )


def create_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    auth = GitHubLogin()
    slot = asyncio.Semaphore(1)
    html = explorer_html()

    @app.middleware("http")
    async def headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        if "/auth/" in request.url.path or "/api/" in request.url.path:
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/", response_class=HTMLResponse)
    @app.get("/index.html", response_class=HTMLResponse)
    async def workspace():
        return html

    @app.get("/api/session")
    async def session(request: Request):
        return {
            "available": auth.available,
            "login": auth.read(request, "session").get("login"),
        }

    app.add_api_route("/auth/github", auth.begin, methods=["GET"])
    app.add_api_route("/auth/github/callback", auth.callback, methods=["GET"])
    app.add_api_route("/api/logout", auth.logout, methods=["POST"])

    @app.post("/api/draft")
    async def draft(request: Request):
        auth.same_origin(request)
        session = auth.read(request, "session")
        if not session:
            raise HTTPException(401, "Sign in with GitHub to ask Copilot.")
        if (
            request.headers.get("content-type", "").split(";", 1)[0].strip()
            != "application/json"
        ):
            raise HTTPException(415, "Send the question and table schemas as JSON.")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_INPUT_BYTES:
                raise HTTPException(413, "Choose fewer tables or columns.")
            body.extend(chunk)
        try:
            payload = assistant.DraftRequest.model_validate_json(body)
        except ValidationError:
            raise HTTPException(
                422,
                "Enter a question and choose up to 32 table schemas with up to 512 columns each.",
            ) from None
        if slot.locked():
            raise HTTPException(
                429,
                "Mallard is drafting another query. Try again in a moment.",
                headers={"Retry-After": "5"},
            )
        async with slot:
            try:
                async with asyncio.timeout(85):
                    return await assistant.generate_draft(session["token"], payload)
            except TimeoutError:
                raise HTTPException(
                    504, "Copilot took too long. Your question is still here to retry."
                ) from None
            except (assistant.CopilotFailure, ValueError, OSError) as error:
                status = getattr(error, "status", None)
                if status == 2:
                    raise HTTPException(
                        403,
                        "GitHub could not authorize this request. Check your Copilot access and sign in again.",
                    ) from None
                if status == 3:
                    raise HTTPException(
                        429,
                        "Your Copilot allowance or rate limit was reached. Try again later.",
                    ) from None
                raise HTTPException(
                    502,
                    "Copilot could not create a draft. Check your Copilot access and try again.",
                ) from None

    app.mount("/cloud-assets", StaticFiles(directory=UI), name="assistant-assets")
    app.mount("/", StaticFiles(directory=STATIC), name="explorer-assets")
    return app
