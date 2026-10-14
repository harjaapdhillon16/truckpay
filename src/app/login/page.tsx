"use client";

import { useState } from "react";
import { Logo, ErrorNote } from "@/components/ui";
import { ApiError, api } from "@/lib/client";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next?.startsWith("/") ? next : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form onSubmit={submit} className="card login-card">
        <Logo />
        <h1>LoadWallet</h1>
        <p>Company console. Drivers don&apos;t need this; they use the link you send them.</p>
        <label className="block">
          <span className="label">Company passcode</span>
          <input className="field" type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoFocus required />
        </label>
        <ErrorNote message={error} />
        <button className="btn btn-primary w-full" disabled={busy || !passcode}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main>
  );
}
