import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, Link2, Lock, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { onError, Spinner } from "@/components/Common";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { DriveItem, ShareRole, Sharing } from "@/types";
import { useMask } from "@/utils/privacy";

const ROLE_LABEL: Record<ShareRole, string> = { reader: "Viewer", commenter: "Commenter", writer: "Editor" };
const base = (it: { account_id: string; google_file_id: string }) => `/api/files/${it.account_id}/${it.google_file_id}/sharing`;

/** Copy text to the clipboard, also on plain-http LAN addresses where navigator.clipboard is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* fall back */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { ta.remove(); }
}

/** "Copy link": copies the Google Drive link and says who can actually open it. */
export async function copyLink(it: DriveItem) {
  if (!it.web_view_link) { toast.error("Google didn't provide a link for this item."); return; }
  let who = "";
  try {
    const s = await api.get<Sharing>(base(it));
    who = s.link ? ` Anyone with the link can ${s.link === "writer" ? "edit" : s.link === "commenter" ? "comment" : "view"}.` : " Only people with access can open it.";
  } catch { /* the link is still useful without the access summary */ }
  if (await copyText(it.web_view_link)) toast.success(`Link copied.${who}`);
  else toast.error("Couldn't copy to the clipboard. Use Open in Google Drive and copy the address there.");
}

/** Share… dialog: general access (Restricted / Anyone with the link) and specific people. */
export function ShareDialog({ item, onClose }: { item: DriveItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const m = useMask();
  const key = ["sharing", item?.account_id, item?.google_file_id];
  const q = useQuery({ queryKey: key, enabled: !!item, queryFn: () => api.get<Sharing>(base(item!)) });
  const set = (s: Sharing) => qc.setQueryData(key, s);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<ShareRole>("reader");
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState("");

  const link = useMutation({ mutationFn: (r: ShareRole | null) => api.put<Sharing>(`${base(item!)}/link`, { role: r }), onSuccess: set, onError });
  const add = useMutation({
    mutationFn: () => api.post<Sharing>(`${base(item!)}/people`, { emails: emails.split(/[\s,;]+/).filter(Boolean), role, notify, message: notify ? message : null }),
    onSuccess: (s) => {
      set(s);
      if (s.failed?.length) {
        toast.error(s.failed.map((f) => `${f.email}: ${f.message}`).join(" "));
        setEmails(s.failed.map((f) => f.email).join(", "));   // keep only the ones that need attention
      } else { setEmails(""); setMessage(""); toast.success("Shared."); }
    },
    onError,
  });
  const change = useMutation({ mutationFn: (v: { id: string; role: ShareRole }) => api.patch<Sharing>(`${base(item!)}/people/${v.id}`, { role: v.role }), onSuccess: set, onError });
  const remove = useMutation({ mutationFn: (id: string) => api.del<Sharing>(`${base(item!)}/people/${id}`), onSuccess: set, onError });

  const s = q.data;
  const busy = link.isPending || add.isPending || change.isPending || remove.isPending;
  const close = () => { setEmails(""); setMessage(""); onClose(); };
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && close()} title={`Share “${item?.name ?? ""}”`} className="max-w-lg"
      description={s && !s.can_share ? "Google doesn't allow this account to change sharing for this item. You can still see who has access." : "Changes apply in Google Drive right away."}>
      {q.isLoading || !s ? <Spinner /> : (
        <div className="space-y-5">
          {/* General access */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">General access</h3>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">{s.link ? <Globe2 className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1">
                <Select aria-label="General access" className="h-8 w-auto border-0 bg-transparent px-0 font-medium" disabled={!s.can_share || busy}
                  value={s.link ? "anyone" : "restricted"} onChange={(e) => link.mutate(e.target.value === "anyone" ? "reader" : null)}>
                  <option value="restricted">Restricted</option><option value="anyone">Anyone with the link</option></Select>
                <p className="text-xs text-muted-foreground">{s.link ? "Anyone on the internet with the link can open it. It isn't searchable." : "Only people added below can open it."}</p>
              </div>
              {s.link && <Select aria-label="Link role" className="h-8 w-auto" disabled={!s.can_share || busy} value={s.link} onChange={(e) => link.mutate(e.target.value as ShareRole)}>
                {(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>}
            </div>
          </section>

          {/* Add people */}
          {s.can_share && (
            <section className="space-y-2">
              <Label htmlFor="share-emails">Add people</Label>
              <div className="flex gap-2">
                <Input id="share-emails" placeholder="name@example.com, another@example.com" value={emails} onChange={(e) => setEmails(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && emails.trim()) add.mutate(); }} />
                <Select aria-label="Role for new people" className="w-auto" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
                  {(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />Notify people (Google sends them an email)</label>
              {notify && <textarea aria-label="Message" rows={2} maxLength={2000} placeholder="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-md border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground" />}
              <div className="flex justify-end"><Button size="sm" disabled={!emails.trim() || busy} onClick={() => add.mutate()}><UserPlus className="h-3.5 w-3.5" />Share</Button></div>
            </section>
          )}

          {/* People with access */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">People with access</h3>
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
              {s.people.map((p) => {
                const label = p.type === "domain" ? `Everyone at ${p.domain}` : p.type === "anyone" ? "Anyone" : m.email(p.email) ?? "Unknown";
                return (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1"><p className="truncate">{label}</p>{p.name && !m.hide && p.type === "user" && <p className="truncate text-xs text-muted-foreground">{p.name}</p>}</div>
                    {p.role === "owner" ? <span className="text-xs text-muted-foreground">Owner</span> : (
                      <>
                        <Select aria-label={`Role for ${label}`} className="h-8 w-auto" disabled={!s.can_share || busy || !(p.role in ROLE_LABEL)} value={p.role}
                          onChange={(e) => change.mutate({ id: p.id, role: e.target.value as ShareRole })}>
                          {!(p.role in ROLE_LABEL) && <option value={p.role}>{p.role}</option>}
                          {(Object.keys(ROLE_LABEL) as ShareRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select>
                        {s.can_share && <Button size="icon" variant="ghost" aria-label={`Remove ${label}`} disabled={busy} onClick={() => remove.mutate(p.id)}><X className="h-4 w-4" /></Button>}
                      </>)}
                  </li>);
              })}
            </ul>
          </section>

          <div className="flex justify-between gap-2">
            <Button variant="outline" disabled={!item?.web_view_link} onClick={() => item && copyLink(item)}><Link2 className="h-4 w-4" />Copy link</Button>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
