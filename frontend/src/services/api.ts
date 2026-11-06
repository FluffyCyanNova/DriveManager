import { useAuth } from "@/stores/auth";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (method !== "GET") { const c = useAuth.getState().csrf; if (c) headers["X-CSRF-Token"] = c; }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the DriveManager server. Check that it is running.");
  }
  if (res.status === 401 && !url.includes("/auth/login") && !url.includes("/auth/session")) useAuth.getState().set({ status: "out" });
  if (!res.ok) {
    let code = "ERROR", msg = `Request failed (${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error) { code = j.error.code; msg = j.error.message; }
      else if (Array.isArray(j?.detail)) { code = "VALIDATION"; msg = "Some values are invalid: " + j.detail.map((d: { loc: string[]; msg: string }) => `${d.loc.slice(1).join(".")} ${d.msg}`).join("; "); }
    } catch { /* non-JSON error */ }
    throw new ApiError(res.status, code, msg);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>("PATCH", url, body),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
  /** Multipart upload with progress (bytes sent to the DriveManager server, before Google). */
  upload: <T>(url: string, form: FormData, onProgress: (sent: number, total: number) => void, signal?: AbortSignal) =>
    new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.withCredentials = true;
      const c = useAuth.getState().csrf;
      if (c) xhr.setRequestHeader("X-CSRF-Token", c);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
      xhr.onerror = () => reject(new ApiError(0, "NETWORK", "The connection to the server dropped while sending the file."));
      xhr.onabort = () => reject(new ApiError(0, "ABORTED", "Cancelled."));
      xhr.onload = () => {
        let j: any = null;
        try { j = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(j as T);
        else reject(new ApiError(xhr.status, j?.error?.code ?? "ERROR", j?.error?.message ?? `Upload failed (${xhr.status}).`));
      };
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(form);
    }),
};

export function downloadUrl(accountId: string, fileId: string, format?: string): string {
  return `/api/files/${accountId}/${fileId}/download${format ? `?format=${format}` : ""}`;
}
