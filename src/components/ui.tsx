"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Check, ChevronRight, Copy, FileCode2, LogOut, Moon, ShieldCheck, Sun, Truck } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { type LoadStatus, STATUS_LABELS } from "@/lib/domain";
import { api, usePolling } from "@/lib/client";

type Tone = "neutral" | "money" | "warn" | "danger" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted border-line",
  money: "bg-money-soft text-money border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-accent border-transparent",
};

export function Pill({ tone = "neutral", children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const LOAD_TONES: Record<LoadStatus, Tone> = {
  wallet_pending: "info",
  awaiting_funding: "warn",
  funded: "info",
  verifying: "info",
  needs_review: "warn",
  paying: "info",
  paid: "money",
  cancelling: "neutral",
  cancelled: "neutral",
  failed: "danger",
};

export function LoadStatusPill({ status }: { status: LoadStatus }) {
  return (
    <Pill tone={LOAD_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Pill>
  );
}

export type Health = { ok: boolean; mode: "live" | "simulated"; network: string | null; scale: number; aiReview: string | null; demoCarrier: { near: string | null; base: string | null } | null; geofenceMeters: number; owner: string; testMoney: boolean };

export function useHealth() {
  return usePolling<Health>("/health", 60_000).data;
}

function ConnectionBadge() {
  const health = useHealth();
  if (!health) return <Pill>Connecting…</Pill>;
  if (health.mode === "simulated") return <Pill tone="warn" dot>Simulated wallet</Pill>;
  if (health.testMoney) return <Pill tone={health.ok ? "money" : "warn"} dot>Agent Connect · test money</Pill>;
  return (
    <Pill tone={health.ok ? "money" : "warn"} dot>
      {health.ok ? `Agent Connect · ${health.network}` : "Agent Connect degraded"}
    </Pill>
  );
}

export function ScaleBadge() {
  const health = useHealth();
  if (health?.testMoney && health.mode === "live")
    return (
      <span className="scale-badge" title="Wallets, policies, grants and refusals are real on Agent Connect. Deposits are simulated and payouts are approved by Agent Connect without moving funds.">
        Test money · real Agent Connect wallets, no real USDC moves
      </span>
    );
  if (!health || health.scale === 1) return null;
  const ratio = Math.round(1 / health.scale).toLocaleString();
  return (
    <span className="scale-badge" title="Contract dollars settle on-chain at this ratio so the demo moves real USDC in small amounts.">
      Demo scale 1:{ratio} · $2,500 = {(2500 * health.scale).toFixed(2)} USDC
    </span>
  );
}

function subscribeAppearance(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function AppShell({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const dark = useSyncExternalStore(subscribeAppearance, () => document.documentElement.dataset.theme === "dark", () => false);
  function toggleTheme() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("loadwallet-theme", next ? "dark" : "light");
  }
  async function signOut() {
    await api("/session", { method: "DELETE" }).catch(() => undefined);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload clears pollers
    window.location.assign("/login");
  }
  const onLoads = pathname === "/" || pathname.startsWith("/loads");
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <aside className="app-sidebar">
        <Link href="/" className="brand"><Logo /><span>LoadWallet<span className="brand-sub">Pay on delivery</span></span></Link>
        <nav aria-label="Main navigation" className="mt-10">
          <Link href="/" className={`nav-item ${onLoads ? "nav-active" : ""}`} aria-current={onLoads ? "page" : undefined}>
            <Truck size={20} strokeWidth={1.75} aria-hidden="true" />Loads
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="nav-item"><FileCode2 size={18} aria-hidden="true" />API (OpenAPI)<ChevronRight size={16} aria-hidden="true" className="ml-auto" /></a>
          <div className="connection-note"><ShieldCheck size={20} strokeWidth={1.75} aria-hidden="true" /><div>Every payout is checked by its wallet&apos;s policy<small>NEAR Intents · Agent Connect</small></div></div>
        </div>
      </aside>
      <header className="app-header">
        <div className="mobile-brand"><Link href="/" aria-label="LoadWallet home"><Logo /></Link></div>
        <div className="breadcrumb"><span>Loads</span><ChevronRight size={14} aria-hidden="true" /><span>{title}</span></div>
        <div className="header-actions">
          <ConnectionBadge />
          {actions}
          <Button variant="ghost" onClick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>{dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Button>
          <Button variant="ghost" onClick={signOut} aria-label="Sign out"><LogOut size={18} aria-hidden="true" /></Button>
        </div>
      </header>
      <main id="main-content" className="dashboard-page">{children}</main>
    </>
  );
}

export function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" fill="var(--accent)" />
      <path d="M6 9.5h9v7H6zM15 12h3.2l1.8 2.3v2.2H15z" fill="none" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="9" cy="17.6" r="1.4" fill="var(--accent-ink)" />
      <circle cx="17.4" cy="17.6" r="1.4" fill="var(--accent-ink)" />
    </svg>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** A monospace id that copies on click. */
export function CopyId({ value, head = 8, tail = 6 }: { value: string | null | undefined; head?: number; tail?: number }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">—</span>;
  const shortValue = value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
  return (
    <button
      type="button"
      title={copied ? "Copied" : `Copy ${value}`}
      className="copy-id"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "copied" : shortValue}
    </button>
  );
}

/** OpenStreetMap embed centred on a point, with a marker. */
export function MapEmbed({ lat, lng, height = 180, zoom = 0.01 }: { lat: number; lng: number; height?: number; zoom?: number }) {
  const bbox = [lng - zoom, lat - zoom * 0.6, lng + zoom, lat + zoom * 0.6].join(",");
  return (
    <div>
      <iframe
        title="Map"
        className="w-full rounded-lg border border-line bg-panel-2"
        style={{ height }}
        loading="lazy"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`}
      />
      <a className="mt-1 inline-block text-xs text-accent hover:underline" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">
        Open in Maps ↗
      </a>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{message}</div>;
}
