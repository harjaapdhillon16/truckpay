"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { ArrowUpRight, ChevronRight, CircleHelp, ClipboardCheck, LayoutDashboard, Moon, Sun, Truck, Wallet, ShieldCheck } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import type { StatusT } from "@/lib/api-types";
import { usePolling } from "@/lib/client";
import { STATUS_LABELS, type LoadStatus } from "@/lib/types";
import { dashboardLabel, dashboardSection } from "@/lib/navigation";

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
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const LOAD_TONES: Record<LoadStatus, Tone> = {
  provisioning: "info",
  awaiting_funding: "warn",
  funded: "info",
  at_pickup: "info",
  in_transit: "info",
  at_delivery: "info",
  pod_review: "warn",
  delivered: "money",
  closed: "neutral",
  failed: "danger",
};

export function LoadStatusPill({ status }: { status: LoadStatus }) {
  return (
    <Pill tone={LOAD_TONES[status]} dot>
      {STATUS_LABELS[status]}
    </Pill>
  );
}

export function PayoutStatusPill({ status }: { status: string }) {
  const tone: Tone =
    status === "SUCCESS" ? "money" : status === "BLOCKED" ? "danger" : status === "FAILED" || status === "REFUNDED" ? "danger" : "info";
  const label =
    status === "SUCCESS" ? "Paid" : status === "BLOCKED" ? "Blocked by policy" : status === "PREPARED" || status === "SUBMITTING" ? "Sending" : status.toLowerCase().replace(/_/g, " ");
  return <Pill tone={tone}>{label}</Pill>;
}

export function ModeBadge() {
  const { data } = usePolling<StatusT>("/api/status", 60_000);
  if (!data) return <Pill>Connecting…</Pill>;
  if (data.mode === "live") {
    const ok = data.network?.status.overall === "operational";
    return (
      <Pill tone={data.error ? "danger" : ok ? "money" : "warn"} dot>
        {data.error ? `Agent Connect error: ${data.error.code}` : `Connected · ${data.network?.network ?? "mainnet"}`}
      </Pill>
    );
  }
  return (
    <Pill tone="warn" dot>
      Demo mode
    </Pill>
  );
}

function subscribeAppearance(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function AppHeader({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const dark = useSyncExternalStore(subscribeAppearance, () => document.documentElement.dataset.theme === "dark", () => false);
  function toggleTheme() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("loadwallet-theme", next ? "dark" : "light");
  }
  const nav = [
    { href: "/", label: "Overview", icon: LayoutDashboard },
    { href: "/loads", label: "All loads", icon: Truck },
    { href: "/payments", label: "Payments", icon: Wallet },
    { href: "/review", label: "Review queue", icon: ClipboardCheck },
  ];
  const current = dashboardLabel(pathname);
  const section = dashboardSection(pathname);
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <aside className="app-sidebar">
        <Link href="/" className="brand"><Logo /><span>LoadWallet<span className="brand-sub">Freight payment workspace</span></span></Link>
        <div className="workspace-name"><span className="workspace-avatar">B</span><div>Broker workspace<small>Pay on delivery</small></div><ShieldCheck size={16} aria-hidden="true" /></div>
        <nav aria-label="Main navigation">
          {nav.map(({ href, label, icon: Icon }) => {
            const selected = section === href;
            return <Link key={href} href={href} className={`nav-item ${selected ? "nav-active" : ""}`} aria-current={selected ? "page" : undefined}><Icon size={20} strokeWidth={1.75} aria-hidden="true" />{label}</Link>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/guide" className={`nav-item ${pathname === "/guide" ? "nav-active" : ""}`} aria-current={pathname === "/guide" ? "page" : undefined}><CircleHelp size={18} aria-hidden="true" />How it works<ChevronRight size={16} aria-hidden="true" /></Link>
          <div className="connection-note"><ShieldCheck size={20} strokeWidth={1.75} aria-hidden="true" /><div>Protected by policy<small>Powered by NEAR Intents</small></div><ArrowUpRight size={14} aria-hidden="true" /></div>
        </div>
      </aside>
      <header className="app-header">
        <div className="mobile-brand"><Link href="/" aria-label="LoadWallet home"><Logo /></Link></div>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} aria-hidden="true" /><span>{current}</span></div>
        <div className="header-actions"><ModeBadge /><Button variant="ghost" onClick={toggleTheme} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>{dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</Button>{children}<span className="header-avatar" title="Broker workspace">B</span></div>
      </header>
      <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={section === href ? "page" : undefined}><Icon size={18} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
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

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "money" | "danger" }) {
  const color = tone === "money" ? "text-money" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="card p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`num mt-1.5 text-2xl font-medium tracking-tight ${color}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** OpenStreetMap embed centred on a point, with a marker. No API key, no JS bundle. */
export function MapEmbed({ lat, lng, height = 180, zoom = 0.012 }: { lat: number; lng: number; height?: number; zoom?: number }) {
  const bbox = [lng - zoom, lat - zoom * 0.6, lng + zoom, lat + zoom * 0.6].join(",");
  return (
    <div>
      <iframe
        title="map"
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

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{message}</div>;
}
