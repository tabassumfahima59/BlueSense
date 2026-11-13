"""API errors with stable codes (P3). Clients get ``{"detail": <short message>, "code": <code>}``; internal details
(exceptions, SQL, paths, URLs) go only to the logs."""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("aquaguard.api")

CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
         409: "conflict", 422: "invalid_request", 429: "rate_limited", 500: "internal_error",
         503: "unavailable"}


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, detail: str, headers: dict[str, str] | None = None):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.code = code


def install(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = getattr(exc, "code", None) or CODES.get(exc.status_code, "error")
        if isinstance(exc.detail, dict):  # e.g. require_admin's not_configured body
            body = {**exc.detail, "code": exc.detail.get("code", code)}
        else:
            body = {"detail": exc.detail, "code": code}
        return JSONResponse(status_code=exc.status_code, content=body, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        msg = "; ".join(f"{'.'.join(str(x) for x in e['loc'] if x != 'body')}: {e['msg']}" for e in exc.errors())
        return JSONResponse(status_code=422, content={"detail": f"Invalid request — {msg}", "code": "invalid_request"})

    @app.exception_handler(KeyError)
    async def key_error(_: Request, exc: KeyError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": f"Not found: {exc}", "code": "not_found"})

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error.", "code": "internal_error"})
