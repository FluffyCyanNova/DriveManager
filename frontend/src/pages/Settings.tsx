import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, FolderOpen, Pin, PinOff, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AccountChip, onError, PageHeader, Spinner } from "@/components/Common";
import { FolderPicker } from "@/components/FolderPicker";
import { NAV_ITEMS, useSidebar, useSidebarWidth } from "@/components/SidebarNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { useAccounts, useHealth, useRuntime } from "@/hooks/queries";
import { api } from "@/services/api";
import { toast } from "@/stores/ui";
import type { AllocationSettings, Rule } from "@/types";
import { ago, bytes } from "@/utils/format";
import { useMask } from "@/utils/privacy";

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const rid = () => Math.random().toString(36).slice(2, 12);
type Target = { kind: "rule"; id: string; accountId: string } | { kind: "default"; accountId: string } | null;

export default function SettingsPage() {
  const m = useMask();
  const qc = useQueryClient();
  const accounts = useAccounts();
  const runtime = useRuntime();
  const health = useHealth();
  const saved = useQuery({ queryKey: ["settings", "allocation"], queryFn: () => api.get<AllocationSettings>("/api/settings/allocation") });
  const [draft, setDraft] = useState<AllocationSettings | null>(null);
  const [target, setTarget] = useState<Target>(null);
  useEffect(() => { if (saved.data && !draft) setDraft(saved.data); }, [saved.data, draft]);

  const save = useMutation({ mutationFn: (v: AllocationSettings) => api.put<AllocationSettings>("/api/settings/allocation", v), onSuccess: (r) => { setDraft(r); qc.setQueryData(["settings", "allocation"], r); toast.success("Upload routing saved."); }, onError });
  if (!draft || !accounts.data) return <Spinner />;
  const accs = accounts.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.data);
  const order = [...draft.priority.filter((id) => accs.some((a) => a.id === id)), ...accs.map((a) => a.id).filter((id) => !draft.priority.includes(id))];
  const move = (i: number, d: -1 | 1) => { const o = [...order]; [o[i], o[i + d]] = [o[i + d], o[i]]; setDraft({ ...draft, priority: o }); };
  const setRule = (id: string, p: Partial<Rule>) => setDraft({ ...draft, rules: draft.rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const email = (id: string) => m.email(accs.find((a) => a.id === id)?.email) ?? "removed account";

  return (
    <>
      <PageHeader title="Settings" actions={dirty ? <Button onClick={() => save.mutate({ ...draft, priority: order })} disabled={save.isPending}><Save className="h-4 w-4" />Save routing changes</Button> : undefined} />
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>Automatic upload routing</CardTitle><CardDescription>Used when you upload with “Automatic”. Rules are checked top to bottom; if none match, accounts are tried in priority order. A file always goes to one account whole, and a matching rule never silently falls back to a different account.</CardDescription></CardHeader>
          <CardContent className="space-y-6">
            <div className="max-w-xs space-y-1.5"><Label htmlFor="margin">Keep this much free (MB) per account</Label>
              <Input id="margin" type="number" min={0} value={draft.safety_margin_mb} onChange={(e) => setDraft({ ...draft, safety_margin_mb: Math.max(0, +e.target.value || 0) })} />
              <p className="text-xs text-muted-foreground">Accounts with less room than the file plus this margin are skipped.</p></div>

            <div><h3 className="mb-2 text-sm font-semibold">Account priority and default folders</h3>
              <ul className="divide-y rounded-md border">{order.map((id, i) => (
                <li key={id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-5 text-muted-foreground">{i + 1}</span><div className="min-w-0 flex-1"><AccountChip id={id} email={email(id)} />
                    <p className="text-xs text-muted-foreground">{accs.find((a) => a.id === id)?.quota?.free != null ? `${bytes(accs.find((a) => a.id === id)!.quota!.free)} free` : "No limit reported"}</p></div>
                  <Button size="sm" variant="outline" onClick={() => setTarget({ kind: "default", accountId: id })}><FolderOpen className="h-3.5 w-3.5" />{draft.account_defaults[id]?.folder_name ?? "My Drive root"}</Button>
                  <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button></li>))}</ul></div>

            <div><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Routing rules</h3>
              <Button size="sm" variant="outline" disabled={accs.length === 0} onClick={() => setDraft({ ...draft, rules: [...draft.rules, { id: rid(), name: "New rule", enabled: true, account_id: accs[0].id, folder_id: null, folder_name: null, extensions: [], mime_prefixes: [], name_contains: null }] })}><Plus className="h-3.5 w-3.5" />Add rule</Button></div>
              {draft.rules.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No rules. Example: send all videos (<code>video/</code>) to the account with the most space.</p> : (
                <ul className="space-y-3">{draft.rules.map((r) => (
                  <li key={r.id} className="space-y-3 rounded-md border p-3.5">
                    <div className="flex flex-wrap items-center gap-3"><Input aria-label="Rule name" className="max-w-56" value={r.name} onChange={(e) => setRule(r.id, { name: e.target.value })} />
                      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={r.enabled} onChange={(e) => setRule(r.id, { enabled: e.target.checked })} />Enabled</label>
                      <Button size="icon" variant="ghost" className="ml-auto text-destructive" aria-label="Delete rule" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((x) => x.id !== r.id) })}><Trash2 className="h-4 w-4" /></Button></div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1"><Label className="text-xs text-muted-foreground">File extensions</Label><Input placeholder=".mp4, .mkv" value={r.extensions.join(", ")} onChange={(e) => setRule(r.id, { extensions: csv(e.target.value) })} /></div>
                      <div className="space-y-1"><Label className="text-xs text-muted-foreground">Type prefixes</Label><Input placeholder="video/, image/" value={r.mime_prefixes.join(", ")} onChange={(e) => setRule(r.id, { mime_prefixes: csv(e.target.value) })} /></div>
                      <div className="space-y-1"><Label className="text-xs text-muted-foreground">Name contains</Label><Input placeholder="invoice" value={r.name_contains ?? ""} onChange={(e) => setRule(r.id, { name_contains: e.target.value || null })} /></div></div>
                    <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-muted-foreground">Send matching files to</span>
                      <Select aria-label="Target account" className="w-60" value={r.account_id} onChange={(e) => setRule(r.id, { account_id: e.target.value, folder_id: null, folder_name: null })}>{accs.map((a) => <option key={a.id} value={a.id}>{m.email(a.email)}</option>)}</Select>
                      <Button size="sm" variant="outline" onClick={() => setTarget({ kind: "rule", id: r.id, accountId: r.account_id })}><FolderOpen className="h-3.5 w-3.5" />{r.folder_name ?? "My Drive root"}</Button></div>
                    {!r.extensions.length && !r.mime_prefixes.length && !r.name_contains && <p className="text-xs text-warning">This rule has no conditions yet, so it won't match anything.</p>}
                  </li>))}</ul>)}</div>
          </CardContent>
        </Card>

        <SidebarCard />
        <PasswordCard />

        <Card><CardHeader><CardTitle>System</CardTitle><CardDescription>Read-only. These come from your <code>.env</code> file; change them there and run <code>docker compose up -d</code>.</CardDescription></CardHeader>
          <CardContent><dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row k="Version" v={runtime.data?.version} />
            <Row k="Background worker" v={health.data ? (health.data.worker.alive ? <Badge tone="success">Running</Badge> : <Badge tone="danger">Not responding</Badge>) : "…"} />
            <Row k="Worker last seen" v={ago(health.data?.worker.last_seen)} />
            <Row k="Encryption key" v={health.data ? (health.data.encryption_key_ok ? <Badge tone="success">Matches database</Badge> : <Badge tone="danger">Mismatch</Badge>) : "…"} />
            <Row k="Google sign-in" v={runtime.data?.google_configured ? <Badge tone="success">Configured</Badge> : <Badge tone="warning">Not configured</Badge>} />
            <Row k="OAuth redirect URI" v={<code className="break-all text-xs">{runtime.data?.redirect_uri}</code>} />
            <Row k="Sync every" v={`${runtime.data?.sync_interval_minutes} min`} />
            <Row k="Storage refresh every" v={`${runtime.data?.quota_refresh_interval_minutes} min`} />
            <Row k="Parallel uploads" v={runtime.data?.upload_concurrency} />
            <Row k="Upload chunk size" v={`${runtime.data?.upload_chunk_mb} MB`} />
            <Row k="Free staging disk" v={bytes(health.data?.staging_free_bytes)} />
            <Row k="Failed uploads kept for" v={`${runtime.data?.staging_retention_hours} h`} />
          </dl></CardContent></Card>
      </div>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)} title="Choose folder" description={target ? `Folder in ${email(target.accountId)}` : ""}>
        {target && <FolderPicker accountId={target.accountId} onCancel={() => setTarget(null)} onPick={(f) => {
          const val = { folder_id: f.id, folder_name: f.id ? f.name : null };
          if (target.kind === "rule") setRule(target.id, val); else setDraft({ ...draft, account_defaults: { ...draft.account_defaults, [target.accountId]: val } });
          setTarget(null);
        }} />}
      </Dialog>
    </>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3 border-b py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>;

function PasswordCard() {
  const [cur, setCur] = useState(""), [next, setNext] = useState(""), [again, setAgain] = useState("");
  const m = useMutation({ mutationFn: () => api.post("/api/auth/change-password", { current_password: cur, new_password: next }), onSuccess: () => { toast.success("Password changed. Other browsers were signed out."); setCur(""); setNext(""); setAgain(""); }, onError });
  const submit = (e: FormEvent) => { e.preventDefault(); if (next !== again) { toast.error("The new passwords don't match."); return; } m.mutate(); };
  return (
    <Card><CardHeader><CardTitle>Change password</CardTitle><CardDescription>At least 10 characters. A long passphrase is best.</CardDescription></CardHeader>
      <CardContent><form onSubmit={submit} className="grid max-w-md gap-3">
        <div className="space-y-1"><Label htmlFor="cp">Current password</Label><Input id="cp" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="np">New password</Label><Input id="np" type="password" autoComplete="new-password" minLength={10} required value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="np2">Repeat new password</Label><Input id="np2" type="password" autoComplete="new-password" minLength={10} required value={again} onChange={(e) => setAgain(e.target.value)} /></div>
        <div><Button type="submit" disabled={m.isPending}>Change password</Button></div></form></CardContent></Card>
  );
}

function SidebarCard() {
  const sb = useSidebar();
  const rowFor = (key: string, pinned: boolean, i: number, n: number) => {
    const it = NAV_ITEMS[key];
    const Icon = it.icon;
    return (
      <li key={key} className="flex items-center gap-2 px-3 py-2 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{it.label}</span>
        <Button size="icon" variant="ghost" aria-label={`Move ${it.label} up`} disabled={i === 0 || sb.saving} onClick={() => sb.step(key, -1)}><ArrowUp className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={`Move ${it.label} down`} disabled={i === n - 1 || sb.saving} onClick={() => sb.step(key, 1)}><ArrowDown className="h-4 w-4" /></Button>
        <Button size="sm" variant={pinned ? "secondary" : "ghost"} className="w-24" disabled={sb.saving} onClick={() => sb.togglePin(key)}>
          {pinned ? <><PinOff className="h-3.5 w-3.5" />Unpin</> : <><Pin className="h-3.5 w-3.5" />Pin</>}</Button>
      </li>);
  };
  return (
    <Card><CardHeader><CardTitle>Sidebar</CardTitle>
      <CardDescription>Pinned items stay in a group at the top and can't be dragged. Reorder the rest by dragging them in the sidebar (Alt + ↑/↓ on the keyboard) or with the arrows here, which also work on phones. Long-press or right-click a sidebar item to pin it. Saved on the server, so it's the same on every device.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinned</h3>
            <ul className="divide-y rounded-md border">{sb.pinned.length ? sb.pinned.map((k, i) => rowFor(k, true, i, sb.pinned.length)) : <li className="px-3 py-2 text-sm text-muted-foreground">Nothing pinned.</li>}</ul></div>
          <div><h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Others</h3>
            <ul className="divide-y rounded-md border">{sb.unpinned.map((k, i) => rowFor(k, false, i, sb.unpinned.length))}</ul></div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={sb.reset.isPending} onClick={() => sb.reset.mutate(undefined, { onSuccess: () => { useSidebarWidth.getState().reset(); toast.success("Sidebar reset to the default order, pins and width."); } })}>Reset order, pins and width</Button>
          <span className="text-sm text-muted-foreground">{sb.state.customized ? "Custom layout in use." : "Default layout (Dashboard pinned)."}</span>
        </div>
      </CardContent></Card>
  );
}
