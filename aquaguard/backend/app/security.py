"""Server-side authorisation for privileged (admin) endpoints.

Use as a FastAPI dependency::

    @router.post("/sync/{source}", dependencies=[Depends(require_admin)])

Rules
* The client sends ``Authorization: Bearer <ADMIN_TOKEN>``.
* No ``ADMIN_TOKEN`` configured on the server → 503 (admin operations ``not_configured``); nothing is ever accepted.
* Missing or malformed header → 401 with ``WWW-Authenticate: Bearer``.
* Wrong token → 403.
* Comparison is constant-time (``hmac.compare_digest``).
* The token value is never logged and never echoed in responses.
* CORS (``main.py``) allows only ``Content-Type`` from the frontend origin, so browsers cannot send the
  ``Authorization`` header cross-origin; the frontend never holds the admin token.
"""
from __future__ import annotations

import hmac
import logging

from fastapi import Header, HTTPException, Request

from .settings import get_settings

log = logging.getLogger("aquaguard.security")


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def require_admin(request: Request, authorization: str | None = Header(default=None)) -> None:
    configured = get_settings().admin_token
    expected = configured.get_secret_value() if configured else ""
    if not expected:
        log.warning("admin endpoint %s called but ADMIN_TOKEN is not configured", request.url.path)
        raise HTTPException(status_code=503, detail={"status": "not_configured",
                                                     "message": "Admin operations are not configured on this server."})
    if not authorization:
        log.info("admin auth missing for %s from %s", request.url.path, _client(request))
        raise HTTPException(status_code=401, detail="Missing admin credentials.",
                            headers={"WWW-Authenticate": "Bearer"})
    scheme, _, token = authorization.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        log.info("malformed admin auth header for %s from %s", request.url.path, _client(request))
        raise HTTPException(status_code=401, detail="Malformed admin credentials.",
                            headers={"WWW-Authenticate": "Bearer"})
    if not hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8")):
        log.warning("invalid admin token for %s from %s", request.url.path, _client(request))
        raise HTTPException(status_code=403, detail="Invalid admin credentials.")
