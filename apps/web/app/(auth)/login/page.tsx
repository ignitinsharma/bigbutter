"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";

export default function Login() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function safeNext(v: string | null): string {
  // Allow only same-origin absolute paths (blocks open redirects).
  if (v && v.startsWith("/") && !v.startsWith("//")) return v;
  return "/notes";
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const next = safeNext(useSearchParams().get("next"));
  const go = async () => {
    setBusy(true); setErr("");
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      location.href = next;
    } catch (e: unknown) {
      setErr((e as { status?: number })?.status === 401
        ? "Invalid email or password."
        : "Could not reach the server. Is the API running?");
    } finally { setBusy(false); }
  };
  return (
    <main className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="anim-enter w-full max-w-sm rounded bg-card border border-line p-7">
        <h1 className="font-serif text-3xl">Everything you said</h1>
        <p className="text-sm text-muted mt-1 mb-5">Type it or say it — filed, tagged, connected.</p>
        <input className="field w-full text-sm bg-card border border-line rounded px-3 py-2 mb-3 placeholder:text-faint"
          placeholder="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className="field w-full text-sm bg-card border border-line rounded px-3 py-2 mb-4 placeholder:text-faint"
          placeholder="password" type="password" value={password}
          onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} />
        {err && <p className="text-sm mb-3" style={{ color: "#8C4426" }}>{err}</p>}
        <button onClick={go} disabled={busy || !email || !password}
          className="btn-press w-full rounded text-sm font-medium px-4 py-2 bg-ink text-card disabled:opacity-40">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </main>
  );
}
