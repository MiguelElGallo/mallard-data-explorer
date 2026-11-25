"""Generate SQL drafts with the requesting visitor's Copilot authorization."""

import asyncio
import json
import os
import signal
import sys
from functools import lru_cache
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


Identifier = Annotated[str, StringConstraints(min_length=1, max_length=512)]


class Column(StrictModel):
    name: Identifier
    type: Identifier


class Table(StrictModel):
    name: Identifier
    columns: list[Column] = Field(max_length=512)


class DraftRequest(StrictModel):
    question: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
    ]
    tables: list[Table] = Field(max_length=32)


class Draft(StrictModel):
    kind: Literal["sql", "clarification"]
    text: str


class CopilotFailure(Exception):
    def __init__(self, status):
        super().__init__(status)
        self.status = status


@lru_cache(maxsize=1)
def runtime_cache():
    return TemporaryDirectory(prefix="mallard-copilot-runtime-")


async def generate_draft(token: str, request: DraftRequest) -> Draft:
    # Keep runtime downloads, provider diagnostics, and user credentials outside the web process.
    cache = os.getenv("COPILOT_CLI_EXTRACT_DIR") or runtime_cache().name
    with TemporaryDirectory(prefix="mallard-worker-") as home:
        env = {
            "HOME": home,
            "TMPDIR": home,
            "LANG": "C.UTF-8",
            "PATH": os.defpath,
            "PYTHONPATH": str(Path(__file__).resolve().parent.parent),
            "COPILOT_CLI_EXTRACT_DIR": cache,
        }
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "mallard_cloud.worker",
            cwd=home,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=(os.name == "posix"),
        )
        try:
            output, _ = await proc.communicate(
                json.dumps({"token": token, "request": request.model_dump()}).encode()
            )
        finally:
            if proc.returncode is None:
                try:
                    if os.name == "posix":
                        os.killpg(proc.pid, signal.SIGKILL)
                    else:
                        proc.kill()
                except ProcessLookupError:
                    pass
                await proc.wait()
        if proc.returncode == 4:
            raise TimeoutError
        if proc.returncode:
            raise CopilotFailure(proc.returncode)
        return Draft.model_validate_json(output)
