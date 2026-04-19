from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .models.result import ErrorEnvelope
from .routers import health, scenarios, simulate, sites, terrain
from .services.data_loader import DataNotReadyError
from .settings import get_settings

logger = logging.getLogger("seismo")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Seismic Viability API",
        version="0.1.0",
        description="Conceptual screening only — not licensed engineering software.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(scenarios.router)
    app.include_router(sites.router)
    app.include_router(simulate.router)
    app.include_router(terrain.router)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "not_ready" if exc.status_code == 503 else None
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorEnvelope(error=str(exc.detail), code=code).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=ErrorEnvelope(error="Invalid request body", code="validation").model_dump()
            | {"details": exc.errors()},
        )

    @app.exception_handler(DataNotReadyError)
    async def data_not_ready_handler(_: Request, exc: DataNotReadyError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content=ErrorEnvelope(error=str(exc), code="not_ready").model_dump(),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error: %s", exc)
        return JSONResponse(
            status_code=500,
            content=ErrorEnvelope(error="Internal server error", code="internal").model_dump(),
        )

    return app


app = create_app()
