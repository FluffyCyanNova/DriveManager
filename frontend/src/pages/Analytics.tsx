import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, PageHeader, Spinner } from "@/components/Common";
import { FileIcon } from "@/components/FileBits";
import { AccountChip } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { api } from "@/services/api";
import type { Analytics as AnalyticsData, HistoryPoint } from "@/types";
import { accountColor } from "@/utils/accountColor";
import { bytes } from "@/utils/format";

const GB = 1024 ** 3;
const tip = { contentStyle: { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 } };
const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 12, tickLine: false } as const;
const TYPE_LABEL: Record<string, string> = { image: "Images", video: "Video", audio: "Audio", pdf: "PDF", document: "Documents", spreadsheet: "Spreadsheets", presentation: "Presentations", archive: "Archives", other: "Other" };

export default function Analytics() {
  const [days, setDays] = useState(30);
  const a = useQuery({ queryKey: ["analytics"], queryFn: () => api.get<AnalyticsData>("/api/analytics/summary") });
  const h = useQuery({ queryKey: ["analytics", "history", days], queryFn: () => api.get<HistoryPoint[]>(`/api/storage/history?days=${days}`) });
  if (a.isLoading) return <Spinner />;
  const data = a.data;
  if (!data || data.per_account.length === 0) return (<><PageHeader title="Analytics" /><Card><EmptyState title="No data yet">Connect an account and let the first scan finish.</EmptyState></Card></>);

  // history: one row per timestamp, one column per account
  const emails = Array.from(new Set((h.data ?? []).map((p) => p.email)));
  const idByEmail = Object.fromEntries((h.data ?? []).map((p) => [p.email, p.account_id]));
  const rows = new Map<string, Record<string, number | string>>();
  (h.data ?? []).forEach((p) => { const k = p.taken_at; const r = rows.get(k) ?? { t: k }; r[p.email] = +(p.usage / GB).toFixed(3); rows.set(k, r); });
  const hist = Array.from(rows.values());
  const fmtT = (t: string) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const perAcc = data.per_account.map((p) => ({ name: p.email.split("@")[0], used: +((p.quota?.usage ?? 0) / GB).toFixed(2), limit: p.quota?.limit ? +(p.quota.limit / GB).toFixed(2) : null, id: p.account_id }));
  const types = data.by_type.map((t) => ({ name: TYPE_LABEL[t.type] ?? t.type, GB: +(t.bytes / GB).toFixed(3), files: t.files }));
  const uploads = data.uploads_per_day.map((u) => ({ day: u.day.slice(5), GB: +(u.bytes / GB).toFixed(3), files: u.count }));

  return (
    <>
      <PageHeader title="Analytics" description="Based on the metadata index. Quota figures come straight from Google." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2"><CardContent className="pt-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Storage used over time (GB)</h2>
            <Select aria-label="Range" className="w-32" value={days} onChange={(e) => setDays(+e.target.value)}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></Select></div>
          {hist.length < 2 ? <p className="py-10 text-center text-sm text-muted-foreground">History builds up as quotas are refreshed. Check back after a few readings.</p> : (
            <div className="h-64"><ResponsiveContainer><LineChart data={hist}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="t" tickFormatter={fmtT} {...axis} /><YAxis {...axis} width={44} /><Tooltip {...tip} labelFormatter={(t) => new Date(String(t)).toLocaleString()} /><Legend />
              {emails.map((e) => <Line key={e} type="monotone" dataKey={e} stroke={accountColor(idByEmail[e], 45)} dot={false} strokeWidth={2} connectNulls />)}</LineChart></ResponsiveContainer></div>)}
        </CardContent></Card>

        <Card><CardContent className="pt-5"><h2 className="mb-3 font-semibold">Accounts compared (GB)</h2>
          <div className="h-60"><ResponsiveContainer><BarChart data={perAcc}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="name" {...axis} /><YAxis {...axis} width={44} /><Tooltip {...tip} /><Legend />
            <Bar dataKey="used" name="Used" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /><Bar dataKey="limit" name="Limit" fill="hsl(var(--muted-foreground) / 0.35)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          <p className="mt-2 text-xs text-muted-foreground">Each account has its own limit. They are shown side by side, not added together.</p></CardContent></Card>

        <Card><CardContent className="pt-5"><h2 className="mb-3 font-semibold">What's taking space (indexed files)</h2>
          {types.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No indexed files yet.</p> : <div className="h-60"><ResponsiveContainer><BarChart data={types} layout="vertical" margin={{ left: 24 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis type="number" {...axis} /><YAxis type="category" dataKey="name" {...axis} width={90} /><Tooltip {...tip} formatter={(v, _n, p) => [`${v} GB · ${(p.payload as { files: number }).files.toLocaleString()} files`, ""]} /><Bar dataKey="GB" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>}</CardContent></Card>

        <Card className="lg:col-span-2"><CardContent className="pt-5"><h2 className="mb-3 font-semibold">Uploads through DriveManager, last 30 days (GB)</h2>
          {uploads.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No completed uploads yet.</p> : <div className="h-52"><ResponsiveContainer><BarChart data={uploads}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" {...axis} /><YAxis {...axis} width={44} /><Tooltip {...tip} /><Bar dataKey="GB" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</CardContent></Card>

        <Card className="lg:col-span-2 overflow-hidden"><CardContent className="pb-2 pt-5"><h2 className="mb-1 font-semibold">Largest files</h2></CardContent>
          {data.largest.length === 0 ? <p className="px-5 pb-6 text-sm text-muted-foreground">Nothing indexed yet.</p> : (
            <ul className="divide-y">{data.largest.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><FileIcon mime={f.mime_type} /><span className="min-w-0 flex-1 truncate">{f.name}</span><span className="hidden md:block"><AccountChip id={f.account_id} email={f.account_email} /></span><span className="w-20 text-right text-muted-foreground">{bytes(f.size)}</span></li>))}</ul>)}
        </Card>
      </div>
    </>
  );
}
