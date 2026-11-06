import { create } from "zustand";
import { queryClient } from "@/services/queryClient";
import { ApiError, api } from "@/services/api";
import type { UploadJob } from "@/types";

/**
 * Uploads started in this browser session. Files are first sent to the DriveManager server (tracked here), after which
 * the server's upload job takes over (tracked by job id). Kept outside any page so uploads continue while you navigate.
 */
export interface Dest {
  mode: "MANUAL" | "AUTO";
  accountId: string;
  folder: { id: string; name: string } | null;
  virtualFolderId: string;
}
export interface LocalItem {
  key: string;
  file: File;
  dest: Dest;
  sent: number;
  status: "waiting" | "sending" | "error" | "sent";
  error?: string;
  jobId?: string;
}
/** What the upload dialog starts with (from where the user clicked "Upload files"). */
export interface UploadPrefill { accountId?: string; folder?: { id: string; name: string } | null; virtualFolderId?: string }

interface UploadsState {
  items: LocalItem[];
  panelOpen: boolean;
  panelCollapsed: boolean;
  dialog: { open: boolean; prefill: UploadPrefill };
  /** Where the user is browsing (set by the Files / Virtual folders pages); "Upload files" starts from here. */
  context: UploadPrefill;
  setContext: (c: UploadPrefill) => void;
  enqueue: (files: File[], dest: Dest) => void;
  resend: (key: string) => void;
  /** A server job was retried (possibly elsewhere); keep it in the panel. */
  track: (job: UploadJob) => void;
  openDialog: (prefill?: UploadPrefill) => void;
  closeDialog: () => void;
  setCollapsed: (v: boolean) => void;
  closePanel: () => void;
}

let running = 0;
const MAX_PARALLEL = 2;
let seq = 0;

export const useUploads = create<UploadsState>((set, get) => {
  const patch = (key: string, p: Partial<LocalItem>) => set({ items: get().items.map((x) => (x.key === key ? { ...x, ...p } : x)) });
  const pump = () => {
    while (running < MAX_PARALLEL) {
      const it = get().items.find((x) => x.status === "waiting");
      if (!it) return;
      running++;
      patch(it.key, { status: "sending", sent: 0, error: undefined });
      const form = new FormData();
      form.append("mode", it.dest.mode);
      if (it.dest.mode === "MANUAL") form.append("account_id", it.dest.accountId);
      if (it.dest.folder?.id) { form.append("folder_id", it.dest.folder.id); form.append("folder_name", it.dest.folder.name); }
      if (it.dest.virtualFolderId) form.append("virtual_folder_id", it.dest.virtualFolderId);
      form.append("file", it.file);
      api.upload<UploadJob>("/api/uploads", form, (sent) => patch(it.key, { sent }))
        .then((job) => { patch(it.key, { status: "sent", sent: it.file.size, jobId: job.id }); queryClient.invalidateQueries({ queryKey: ["uploads"] }); })
        .catch((e) => patch(it.key, { status: "error", error: e instanceof ApiError ? e.message : "Sending the file to the server failed." }))
        .finally(() => { running--; pump(); });
    }
  };
  return {
    items: [],
    panelOpen: false,
    panelCollapsed: typeof window !== "undefined" && window.innerWidth < 768,   // phones start collapsed
    dialog: { open: false, prefill: {} },
    context: {},
    setContext: (c) => set({ context: c }),
    enqueue: (files, dest) => {
      if (!files.length) return;
      const added = files.map((file) => ({ key: `u${++seq}`, file, dest, sent: 0, status: "waiting" as const }));
      set({ items: [...get().items, ...added], panelOpen: true });
      pump();
    },
    resend: (key) => { patch(key, { status: "waiting", error: undefined, sent: 0 }); set({ panelOpen: true }); pump(); },
    track: (job) => {
      if (get().items.some((x) => x.jobId === job.id)) return;
      set({ items: [...get().items, { key: `u${++seq}`, file: new File([], job.filename), dest: { mode: job.mode, accountId: job.account_id ?? "", folder: null, virtualFolderId: "" }, sent: job.size, status: "sent", jobId: job.id }], panelOpen: true });
    },
    openDialog: (prefill) => set({ dialog: { open: true, prefill: prefill ?? get().context } }),
    closeDialog: () => set({ dialog: { ...get().dialog, open: false } }),
    setCollapsed: (v) => set({ panelCollapsed: v }),
    // Closing hides the panel and forgets finished items; anything still in progress keeps going and reappears with the next upload.
    closePanel: () => set({ panelOpen: false, items: get().items.filter((x) => x.status === "waiting" || x.status === "sending") }),
  };
});
