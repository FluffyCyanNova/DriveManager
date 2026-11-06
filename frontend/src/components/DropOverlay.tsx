import { CloudUpload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useVirtualPaths } from "@/components/UploadForm";
import { useAccounts } from "@/hooks/queries";
import { toast } from "@/stores/ui";
import { useUploads } from "@/stores/uploads";
import { useMask } from "@/utils/privacy";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

/**
 * Drag files from your computer anywhere over DriveManager: the window shows "Drop files to upload" with the destination,
 * and dropping opens the Upload dialog with the files attached (nothing starts until Upload is pressed). Not on the
 * Uploads page, which has its own drop area, and not while the Upload dialog is open. Folders are skipped with a note.
 */
export function DropOverlay() {
  const m = useMask();
  const loc = useLocation();
  const accounts = useAccounts();
  const vpaths = useVirtualPaths();
  const context = useUploads((s) => s.context);
  const dialogOpen = useUploads((s) => s.dialog.open);
  const openDialog = useUploads((s) => s.openDialog);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const enabled = loc.pathname !== "/uploads" && !dialogOpen;

  useEffect(() => {
    if (!enabled) { setOver(false); depth.current = 0; return; }
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); };
    const overFn = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0; setOver(false);
      const dt = e.dataTransfer!;
      // A dropped folder shows up as an entry with isDirectory; browsers can't reliably hand over its contents.
      const items = Array.from(dt.items ?? []);
      const folders = items.filter((i) => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory).length;
      const files = items.length
        ? items.filter((i) => i.kind === "file" && !i.webkitGetAsEntry?.()?.isDirectory).map((i) => i.getAsFile()).filter((f): f is File => !!f)
        : Array.from(dt.files);
      if (folders) toast.info(`Folders can't be uploaded here. Select the files inside instead.${files.length ? " The other files were added." : ""}`);
      if (files.length) openDialog(undefined, files);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { depth.current = 0; setOver(false); } };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", overFn);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("dragenter", enter); window.removeEventListener("dragover", overFn);
      window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); window.removeEventListener("keydown", esc);
    };
  }, [enabled, openDialog]);

  if (!over || !enabled) return null;
  const active = (accounts.data ?? []).filter((a) => a.status === "ACTIVE");
  const acc = active.find((a) => a.id === context.accountId) ?? active[0];
  const where = context.folder && acc ? `to ${m.file(context.folder.name)} (${m.email(acc.email)})` : acc ? `to My Drive of ${m.email(acc.email)}` : "Connect an account first";
  const vpath = context.virtualFolderId ? vpaths.find((v) => v.id === context.virtualFolderId)?.path : null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm" aria-hidden>
      <div className="flex w-full max-w-xl flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-card/90 px-8 py-14 text-center shadow-2xl">
        <CloudUpload className="h-12 w-12 text-primary" />
        <p className="text-xl font-semibold">Drop files to upload</p>
        <p className="text-sm text-muted-foreground">{where}{vpath ? `, also added to virtual folder ${vpath}` : ""}</p>
        <p className="text-xs text-muted-foreground">You can review the destination before anything is uploaded.</p>
      </div>
    </div>
  );
}
