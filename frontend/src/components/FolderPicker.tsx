import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, HardDrive, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/Common";
import { api } from "@/services/api";
import type { FilePage, SharedDrive } from "@/types";
import { cn } from "@/utils/cn";
import { useMask } from "@/utils/privacy";

export interface PickedFolder { id: string | null; name: string }
interface Crumb { id: string | null; name: string }

/** Browse one account's folders (My Drive or its shared drives) and pick a destination. id=null means My Drive root. */
export function FolderPicker({ accountId, onPick, onCancel, label = "Select this folder" }: {
  accountId: string; onPick: (f: PickedFolder) => void; onCancel?: () => void; label?: string;
}) {
  const [space, setSpace] = useState<"my" | "shared">("my");
  const [stack, setStack] = useState<Crumb[]>([]);
  const m = useMask();
  const current = stack[stack.length - 1];

  const drives = useQuery({ queryKey: ["drives", accountId], queryFn: () => api.get<SharedDrive[]>(`/api/drives/${accountId}`), enabled: space === "shared" && stack.length === 0 });
  const folders = useQuery({
    queryKey: ["files", "picker", accountId, space, current?.id],
    enabled: !(space === "shared" && stack.length === 0),
    queryFn: () => {
      const p = new URLSearchParams({ account_id: accountId, folders_only: "true", page_size: "500" });
      if (current?.id) p.set("parent_id", current.id); else p.set("location", "my_drive");
      return api.get<FilePage>(`/api/files?${p}`);
    },
  });

  const switchSpace = (s: "my" | "shared") => { setSpace(s); setStack([]); };
  const atSharedRoot = space === "shared" && stack.length === 0;
  const loading = atSharedRoot ? drives.isLoading : folders.isLoading;
  const rows: { id: string; name: string; canAdd: boolean }[] = atSharedRoot
    ? (drives.data ?? []).map((d) => ({ id: d.id, name: d.name, canAdd: true }))
    : (folders.data?.items ?? []).map((f) => ({ id: f.google_file_id, name: f.name, canAdd: f.can.add_children }));
  const selectable = space === "my" || stack.length > 0;
  const pickedName = current ? current.name : "My Drive";

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {([["my", "My Drive", HardDrive], ["shared", "Shared drives", Users]] as const).map(([k, t, Icon]) => (
          <Button key={k} size="sm" variant={space === k ? "default" : "outline"} onClick={() => switchSpace(k)}><Icon className="h-3.5 w-3.5" />{t}</Button>
        ))}
      </div>
      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-sm">
        <button className="rounded px-1 hover:bg-accent" onClick={() => setStack([])}>{space === "my" ? "My Drive" : "Shared drives"}</button>
        {stack.map((c, i) => (
          <span key={`${c.id}-${i}`} className="flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button className="rounded px-1 hover:bg-accent" onClick={() => setStack(stack.slice(0, i + 1))}>{m.file(c.name)}</button></span>
        ))}
      </nav>
      <div className="h-56 overflow-y-auto rounded-md border">
        {loading ? <Spinner /> : rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{atSharedRoot ? "No shared drives on this account." : "No sub-folders here."}</p> : (
          <ul>{rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => setStack([...stack, { id: r.id, name: r.name }])} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent", !r.canAdd && "opacity-60")}>
                <Folder className="h-4 w-4 shrink-0 text-primary" /><span className="truncate">{m.file(r.name)}</span>{!r.canAdd && <span className="ml-auto text-xs text-muted-foreground">read-only</span>}
              </button>
            </li>))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{selectable ? <>Destination: <b>{pickedName}</b></> : "Open a shared drive to choose it"}</span>
        <div className="flex gap-2">
          {onCancel && <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" disabled={!selectable} onClick={() => onPick({ id: current?.id ?? null, name: pickedName })}>{label}</Button>
        </div>
      </div>
    </div>
  );
}
