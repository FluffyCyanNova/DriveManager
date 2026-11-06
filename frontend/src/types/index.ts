export interface Quota { usage: number; limit: number | null; usage_in_drive: number; usage_in_trash: number; free: number | null; taken_at: string }
export interface Account {
  id: string; email: string; display_name: string | null; status: "ACTIVE" | "NEEDS_REAUTH"; status_detail: string | null;
  initial_scan_complete: boolean; last_sync_at: string | null; last_quota_at: string | null; created_at: string;
  quota: Quota | null; syncing: boolean; files_indexed: number;
  shared_drives?: { id: string; name: string }[];
  last_sync_job?: { state: string; kind: string; files_processed: number; error: string | null; finished_at: string | null } | null;
}
export interface FileCaps { rename: boolean; trash: boolean; delete: boolean; download: boolean; add_children: boolean; move: boolean; untrash: boolean; share: boolean }
export interface DriveItem {
  id: string; account_id: string; account_email: string | null; google_file_id: string; name: string; mime_type: string; is_folder: boolean;
  size: number | null; modified_time: string | null; created_time: string | null; trashed: boolean; location: string; owner_email: string | null;
  owned_by_me: boolean; web_view_link: string | null; drive_id: string | null; shortcut_target_id: string | null; parent?: { id: string; name: string } | null; can: FileCaps;
}
export interface FilePage { items: DriveItem[]; total: number; page: number; page_size: number }
export interface SharedDrive { id: string; name: string; account_id: string; account_email: string }
export interface UploadJob {
  id: string; filename: string; size: number; mime_type: string; mode: "MANUAL" | "AUTO"; state: string; account_id: string | null;
  account_email: string | null; destination_folder_id: string | null; destination_folder_name: string | null; destination_path?: string | null; virtual_folder_id: string | null; bytes_uploaded: number;
  progress: number; google_file_id: string | null; error_code: string | null; error_message: string | null; allocation_reason: string | null;
  attempts: number; cancel_requested: boolean; created_at: string; finished_at: string | null; retryable: boolean;
}
export interface ActivityItem { id: number; type: string; account_id: string | null; account_email: string | null; file_name: string | null; google_file_id: string | null; details: Record<string, unknown> | null; created_at: string }
export interface VFolder { id: string; parent_id: string | null; name: string; item_count: number; created_at: string }
export interface VItem { item_id: string; account_id: string; account_email: string | null; google_file_id: string; status: "ok" | "missing" | "trashed" | "inaccessible"; name: string | null; mime_type: string | null; file: DriveItem | null }
export interface Rule { id: string; name: string; enabled: boolean; account_id: string; folder_id: string | null; folder_name: string | null; extensions: string[]; mime_prefixes: string[]; name_contains: string | null }
export interface AllocationSettings { safety_margin_mb: number; priority: string[]; rules: Rule[]; account_defaults: Record<string, { folder_id: string | null; folder_name: string | null }> }
export interface Runtime { version: string; commit?: string | null; build_date?: string | null; sync_interval_minutes: number; quota_refresh_interval_minutes: number; upload_concurrency: number; upload_chunk_mb: number; staging_retention_hours: number; session_ttl_hours: number; google_configured: boolean; redirect_uri: string; tls_cookie_secure: boolean; timezone: string }
export interface Health { version: string; database: string; worker: { enabled: boolean; alive: boolean; last_seen: string | null }; google_configured: boolean; redirect_uri: string; encryption_key_ok: boolean; staging_free_bytes: number | null }
export interface Analytics {
  by_type: { type: string; files: number; bytes: number }[];
  per_account: { account_id: string; email: string; files: number; indexed_bytes: number; quota: Quota | null }[];
  largest: DriveItem[]; uploads_per_day: { day: string; count: number; bytes: number }[];
}
export interface HistoryPoint { account_id: string; email: string; taken_at: string; usage: number; limit: number | null }
export type ShareRole = "reader" | "commenter" | "writer";
export interface SharePerson { id: string; type: string; role: string; email: string | null; name: string | null; domain: string | null; pending_owner: boolean }
export interface Sharing { file_id: string; name: string; is_folder: boolean; web_view_link: string | null; can_share: boolean; link: ShareRole | null; people: SharePerson[]; failed?: { email: string; message: string }[] }
