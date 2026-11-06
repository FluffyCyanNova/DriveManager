"""Resumable uploads and streaming downloads via the Drive REST API."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Callable, Iterator

import requests

from app.integrations.google_drive.client import DriveApiError, DriveClient
from app.integrations.google_drive.files import FILE_FIELDS

UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
DRIVE_URL = "https://www.googleapis.com/drive/v3/files"

EXPORT_FORMATS = {
    "pdf": ("application/pdf", ".pdf"),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
    "pptx": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
    "txt": ("text/plain", ".txt"),
    "csv": ("text/csv", ".csv"),
}


class TransientUploadError(Exception):
    pass


class SessionExpired(Exception):
    pass


def _api_error(resp: requests.Response) -> DriveApiError:
    reason, message = "unknown", resp.text[:300]
    try:
        err = resp.json()["error"]
        message = err.get("message", message)
        reason = (err.get("errors") or [{}])[0].get("reason", reason)
    except Exception:
        pass
    return DriveApiError(resp.status_code, reason, message)


def start_session(c: DriveClient, *, name: str, size: int, mime: str, parent_id: str | None, job_id: str) -> str:
    c.refresh_if_needed()
    meta = {"name": name, "appProperties": {"drivemanager_job_id": job_id}}
    if parent_id:
        meta["parents"] = [parent_id]
    headers = {"Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime,
               "X-Upload-Content-Length": str(size)}
    r = c.session().post(UPLOAD_URL, params={"uploadType": "resumable", "supportsAllDrives": "true", "fields": FILE_FIELDS},
                         data=json.dumps(meta), headers=headers, timeout=60)
    if r.status_code in (429, 500, 502, 503, 504):
        raise TransientUploadError(f"HTTP {r.status_code} starting upload")
    if r.status_code != 200 or "Location" not in r.headers:
        raise _api_error(r)
    return r.headers["Location"]


def query_status(c: DriveClient, uri: str, size: int) -> tuple[str, int, dict | None]:
    """Returns ('complete', size, file_json) or ('partial', bytes_received, None). Raises SessionExpired."""
    c.refresh_if_needed()
    r = c.session().put(uri, headers={"Content-Range": f"bytes */{size}", "Content-Length": "0"}, timeout=60)
    if r.status_code in (200, 201):
        return "complete", size, r.json()
    if r.status_code == 308:
        rng = r.headers.get("Range")
        return "partial", (int(rng.split("-")[1]) + 1 if rng else 0), None
    if r.status_code in (404, 410):
        raise SessionExpired()
    if r.status_code in (429, 500, 502, 503, 504):
        raise TransientUploadError(f"HTTP {r.status_code} querying upload status")
    raise _api_error(r)


def send_chunk(c: DriveClient, uri: str, data: bytes, start: int, total: int) -> tuple[bool, int, dict | None]:
    """PUT one chunk. Returns (done, bytes_received_total, file_json)."""
    c.refresh_if_needed()
    if total == 0:
        r = c.session().put(uri, data=b"", headers={"Content-Length": "0"}, timeout=120)
    else:
        end = start + len(data) - 1
        r = c.session().put(uri, data=data, headers={"Content-Range": f"bytes {start}-{end}/{total}",
                                                     "Content-Length": str(len(data))}, timeout=300)
    if r.status_code in (200, 201):
        return True, total, r.json()
    if r.status_code == 308:
        rng = r.headers.get("Range")
        return False, (int(rng.split("-")[1]) + 1 if rng else 0), None
    if r.status_code in (404, 410):
        raise SessionExpired()
    if r.status_code in (429, 500, 502, 503, 504):
        raise TransientUploadError(f"HTTP {r.status_code} while uploading")
    raise _api_error(r)


def cancel_session(c: DriveClient, uri: str) -> None:
    try:
        c.refresh_if_needed()
        c.session().delete(uri, timeout=30)   # Google answers 499 on success
    except Exception:
        pass


@dataclass
class DownloadStream:
    response: requests.Response
    filename: str
    mime: str
    size: int | None

    def iter(self, chunk: int = 1024 * 256) -> Iterator[bytes]:
        try:
            yield from self.response.iter_content(chunk_size=chunk)
        finally:
            self.response.close()


def open_download(c: DriveClient, file_meta: dict, export_format: str | None) -> DownloadStream:
    c.refresh_if_needed()
    mime = file_meta["mimeType"]
    name = file_meta["name"]
    fid = file_meta["id"]
    if mime.startswith("application/vnd.google-apps."):
        fmt = export_format or ("xlsx" if mime.endswith("spreadsheet") else "pptx" if mime.endswith("presentation") else "docx")
        if fmt not in EXPORT_FORMATS:
            raise DriveApiError(400, "badExportFormat", f"Unsupported export format '{fmt}'.")
        em, ext = EXPORT_FORMATS[fmt]
        r = c.session().get(f"{DRIVE_URL}/{fid}/export", params={"mimeType": em}, stream=True, timeout=120)
        out_name, out_mime, size = (name if name.lower().endswith(ext) else name + ext), em, None
    else:
        r = c.session().get(f"{DRIVE_URL}/{fid}", params={"alt": "media", "supportsAllDrives": "true"}, stream=True, timeout=120)
        out_name, out_mime = name, mime
        size = int(file_meta["size"]) if file_meta.get("size") else None
    if r.status_code != 200:
        err = _api_error(r)
        r.close()
        raise err
    return DownloadStream(r, out_name, out_mime, size)
