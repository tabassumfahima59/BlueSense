"""AquaGuard API — FastAPI application (modular monolith).

Run:  uvicorn app.main:app --reload --port 8000   (from backend/)
OpenAPI: /api/openapi.json   Docs: /api/docs
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from .routers import (
    command_center,
    copilot,
    explorer,
    health,
    irrigation,
    prediction_lab,
    regions,
    sources,
    water_budget,
    water_flow,
    what_if,
)
from .settings import get_settings

settings = get_settings()
log = logging.getLogger("aquaguard.startup")


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Startup: (1) bootstrap seed when the database is missing; (2) apply pending migrations to an existing
    database (verified backup first; a failed migration is rolled back and stops startup rather than serving a
    half-migrated database); (3) start the sync scheduler when enabled. Shutdown: stop the scheduler."""
    app_log = logging.getLogger("aquaguard")
    if not app_log.handlers:  # uvicorn configures only its own loggers; show sync/migration/seed messages too
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        app_log.addHandler(handler)
        app_log.setLevel(logging.INFO)
    if settings.bootstrap_on_startup and not settings.db_path.exists():
        from .db import seed

        seed.bootstrap_if_missing(settings)
    if settings.migrate_on_startup and settings.db_path.exists():
        from .db import migrate

        report = migrate.migrate(settings.db_path, backup=True, backup_dir=settings.backup_dir)
        if report.applied:
            log.info("applied migrations %s (backup: %s)", report.applied, report.backup_path)
    from .sync import scheduler

    scheduler.start(settings)
    try:
        yield
    finally:
        scheduler.stop()


app = FastAPI(
    title="AquaGuard API",
    version=health.VERSION,
    description="AI-Powered Water Intelligence, Prediction & Resource Optimization Platform (prototype). "
                "Every numeric field is a Measure with provenance. Decision support only.",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url=None,
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"],
                   allow_headers=["Content-Type"], allow_credentials=False)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    msg = "; ".join(f"{'.'.join(str(x) for x in e['loc'] if x != 'body')}: {e['msg']}" for e in exc.errors())
    return JSONResponse(status_code=422, content={"detail": f"Invalid request — {msg}"})


@app.exception_handler(KeyError)
async def key_error_handler(_: Request, exc: KeyError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"Not found: {exc}"})


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET" and response.status_code == 200 and request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "public, max-age=300")
    return response


for r in (health, regions, sources, command_center, explorer, prediction_lab, water_flow, water_budget, what_if,
          irrigation, copilot):
    app.include_router(r.router, prefix="/api")
