"""Request body size limit (Phase 8B).

Starlette spools an uploaded file to disk in full before the route runs, so the receipt route's
own size check came after the whole upload was received. This refuses an oversized body with
413 up front (Content-Length) or as soon as a streamed body passes the limit.
"""

from fastapi import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.errors import problem_response

# Multipart framing and the client_id field around the photo.
UPLOAD_OVERHEAD_BYTES = 64 * 1024
UPLOAD_PATHS = {("POST", "/api/v1/receipts")}

TOO_LARGE = "The request is too large."


class BodyTooLarge(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=413, detail=TOO_LARGE)


def limit_for(method: str, path: str) -> int:
    if (method, path.rstrip("/")) in UPLOAD_PATHS:
        return settings.receipt_max_bytes + UPLOAD_OVERHEAD_BYTES
    return settings.request_max_bytes


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = limit_for(scope["method"], scope["path"])
        declared = next((v for k, v in scope["headers"] if k == b"content-length"), None)
        if declared is not None:
            try:
                too_large = int(declared) > limit
            except ValueError:
                too_large = False  # the server rejects a malformed length itself
            if too_large:
                response = problem_response(413, "payload-too-large", TOO_LARGE)
                await response(scope, receive, send)
                return

        received = 0

        async def counted() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Raised inside body parsing: FastAPI re-raises HTTPExceptions, and the
                    # error handler turns it into a 413 problem response.
                    raise BodyTooLarge()
            return message

        await self.app(scope, counted, send)
