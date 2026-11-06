import { Loader2, Lock } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { api } from "@/services/api";
import { errText } from "@/components/Common";
import { useAuth } from "@/stores/auth";

export default function Login() {
  const set = useAuth((s) => s.set);
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await api.post<{ username: string; csrf_token: string }>("/api/auth/login", { username, password });
      set({ status: "in", username: r.username, csrf: r.csrf_token });
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border bg-card p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <div><h1 className="text-xl font-semibold tracking-tight">DriveManager</h1><p className="text-sm text-muted-foreground">Sign in to your private drive hub</p></div>
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="u">Username</Label><Input id="u" autoComplete="username" autoFocus required value={username} onChange={(e) => setU(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="p">Password</Label><Input id="p" type="password" autoComplete="current-password" required value={password} onChange={(e) => setP(e.target.value)} /></div>
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}Sign in</Button>
        </div>
      </form>
    </div>
  );
}
