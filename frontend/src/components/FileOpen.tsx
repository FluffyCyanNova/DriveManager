import { Download, ExternalLink } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { download, FileIcon } from "@/components/FileBits";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { DriveItem } from "@/types";
import { bytes } from "@/utils/format";

type Choice = "download" | "drive";

/** "Don't ask again" for the file-click prompt. Kept in memory only, so a page reload asks again. */
const useOpenChoice = create<{ choice: Choice | null; remember: (c: Choice | null) => void }>((set) => ({
  choice: null,
  remember: (choice) => set({ choice }),
}));

const canDownload = (it: DriveItem) => !it.is_folder && it.can.download && !it.trashed;
const canOpen = (it: DriveItem) => !!it.web_view_link;

/**
 * What happens when a file's name is clicked: ask "Download or open in Google Drive?", or repeat the remembered answer.
 * If the remembered action isn't possible for this file (e.g. downloading is blocked), it falls back to the other one,
 * and asks if neither works. `exportFile` opens the export-format dialog for Google Docs/Sheets/Slides.
 */
export function useFileOpener(exportFile: (it: DriveItem) => void) {
  const choice = useOpenChoice((s) => s.choice);
  const [asking, setAsking] = useState<DriveItem | null>(null);
  const run = (it: DriveItem, c: Choice) => {
    if (c === "download") download(it, () => exportFile(it));
    else window.open(it.web_view_link!, "_blank", "noopener");
  };
  const openFile = (it: DriveItem) => {
    const options: Choice[] = [...(canDownload(it) ? ["download" as const] : []), ...(canOpen(it) ? ["drive" as const] : [])];
    if (choice && options.includes(choice)) return run(it, choice);
    if (choice && options.length === 1) return run(it, options[0]);
    setAsking(it);
  };
  const dialog = <FileOpenDialog item={asking} onClose={() => setAsking(null)} onChoose={(it, c) => { setAsking(null); run(it, c); }} />;
  return { openFile, dialog };
}

function FileOpenDialog({ item, onClose, onChoose }: { item: DriveItem | null; onClose: () => void; onChoose: (it: DriveItem, c: Choice) => void }) {
  const remember = useOpenChoice((s) => s.remember);
  const [dontAsk, setDontAsk] = useState(false);
  const pick = (c: Choice) => { if (!item) return; if (dontAsk) remember(c); setDontAsk(false); onChoose(item, c); };
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) { setDontAsk(false); onClose(); } }} title="Open file"
      description="Download a copy, or open the file in Google Drive in a new tab.">
      {item && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm">
            <FileIcon mime={item.mime_type} />
            <span className="min-w-0 flex-1 truncate font-medium" title={item.name}>{item.name}</span>
            {item.size != null && <span className="shrink-0 text-muted-foreground">{bytes(item.size)}</span>}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" disabled={!canDownload(item)} onClick={() => pick("download")} autoFocus>
              <Download className="h-4 w-4" />Download</Button>
            <Button disabled={!canOpen(item)} onClick={() => pick("drive")}>
              <ExternalLink className="h-4 w-4" />Open in Google Drive</Button>
          </div>
          {!canDownload(item) && <p className="text-xs text-muted-foreground">{item.trashed ? "Restore the file to download it." : "Google doesn't allow downloading this file with this account."}</p>}
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            Don't ask again until I reload the page
          </label>
        </div>
      )}
    </Dialog>
  );
}
