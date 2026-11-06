from __future__ import annotations
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details or {}


def not_found(what="Item"): return AppError(404, "NOT_FOUND", f"{what} was not found.")
def bad_request(msg, code="BAD_REQUEST"): return AppError(400, code, msg)
def forbidden(msg, code="FORBIDDEN"): return AppError(403, code, msg)


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse({"error": {"code": exc.code, "message": exc.message, "details": exc.details}}, status_code=exc.status)
