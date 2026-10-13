"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ErrorNote, AppHeader, LoadStatusPill, Pill } from "@/components/ui";
import { FundingCard } from "@/components/funding-card";
import { MoneyFlow } from "@/components/money-flow";
import { PolicyCard } from "@/components/policy-card";
import { ProofCard } from "@/components/proof-card";
import { Timeline } from "@/components/timeline";
import { PayoutsTable } from "@/components/payouts-table";
import type { LoadDetailT } from "@/lib/api-types";
import { postJson, short, usePolling } from "@/lib/client";
import { distanceMeters } from "@/lib/geo";

export default function LoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, setData, error } = usePolling<LoadDetailT>(`/api/loads/${id}`, 3000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setActionError(null);
    try {
      setData(await postJson<LoadDetailT>(`/api/loads/${id}/actions`, { action, ...extra }));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!data)
    return (
      <>
        <AppHeader />
        <main id="main-content" className="detail-heading mx-auto w-full max-w-7xl px-4 py-10 text-sm text-muted sm:px-6">{error ?? "Loading…"}</main>
      </>
    );

  const { load, events, payouts, proofs } = data;
  const rc = load.rateCon;
  const funded = !["provisioning", "awaiting_funding", "failed"].includes(load.status);
  const miles = Math.round(distanceMeters(rc.pickup, rc.delivery) / 1609.34);

  return (
    <>
      <AppHeader />
      <main id="main-content" className="detail-heading mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Link href="/" className="text-sm text-muted hover:text-ink">
          ← Dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-medium tracking-tight">{load.ref}</h1>
              <LoadStatusPill status={load.status} />
              {load.mode === "simulated" && <Pill tone="warn">simulated wallet</Pill>}
            </div>
            <p className="mt-1 text-sm text-muted">
              {rc.pickup.name} → {rc.delivery.name} · ~{miles.toLocaleString()} mi · {rc.equipment} · {rc.carrier.name} ({rc.carrier.mcNumber})
            </p>
          </div>
          <DriverLink url={load.driverUrl} />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            <MoneyFlow load={load} payouts={payouts} />

            {(load.status === "provisioning" || load.status === "failed") && <ProvisioningCard load={load} busy={busy} act={act} />}
            {load.status === "awaiting_funding" && <FundingCard load={load} busy={busy} act={act} />}

            <section className="card">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <h2 className="font-medium">Proof from the driver</h2>
                <span className="text-xs text-muted">Verified by the load agent before any payout</span>
              </div>
              {proofs.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">
                  {funded ? "Waiting for the driver to check in at pickup. Send them the driver link." : "Proof uploads open once the wallet is funded."}
                </p>
              ) : (
                <div className="divide-y divide-line">
                  {[...proofs].reverse().map((proof) => (
                    <ProofCard key={proof.id} loadId={load.id} proof={proof} rateCon={rc} busy={busy} onReview={(decision, note) => act("review", { proofId: proof.id, decision, note })} />
                  ))}
                </div>
              )}
            </section>

            <PayoutsTable payouts={payouts} symbol={load.funding.symbol} decimals={load.funding.decimals} />
            <Timeline events={events} />
          </div>

          <aside className="space-y-6">
            <WalletCard load={load} busy={busy} act={act} />
            <PolicyCard load={load} />
            <FraudLab funded={funded} busy={busy} act={act} closed={load.status === "closed"} />
            <ErrorNote message={actionError} />
          </aside>
        </div>
      </main>
    </>
  );
}

function DriverLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="driver-link flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3">
      <div className="min-w-0">
        <div className="text-xs text-muted">Driver link</div>
        <div className="max-w-[260px] truncate font-mono text-xs">{url}</div>
      </div>
      <button
        className="btn"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <a className="btn btn-primary" href={url} target="_blank" rel="noreferrer">
        Open
      </a>
    </div>
  );
}

function ProvisioningCard({ load, busy, act }: { load: LoadDetailT["load"]; busy: string | null; act: (a: string) => void }) {
  const w = load.wallet;
  const stalled = load.status === "failed" || !load.provisioningActive;
  return (
    <section className="card p-5">
      <h2 className="font-medium">{load.status === "failed" ? "Wallet creation failed" : "Creating the load wallet"}</h2>
      <p className="mt-1 text-sm text-muted">
        The broker signs two things once: the wallet&apos;s policy, and a grant that lets the load agent spend inside it. No root key ever reaches the agent.
      </p>
      <ol className="mt-4 space-y-2 text-sm">
        {(w.intents ?? []).map((i) => (
          <li key={i.correlationId} className="flex items-center justify-between gap-3 rounded-lg bg-panel-2 px-3 py-2">
            <span>{i.step}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted">{short(i.correlationId, 10, 4)}</span>
              <Pill tone={i.status === "SUCCESS" ? "money" : i.status === "FAILED" ? "danger" : "info"}>{i.status.toLowerCase().replace(/_/g, " ")}</Pill>
            </span>
          </li>
        ))}
        {load.status === "provisioning" && (
          <li className="flex items-center gap-2 px-3 py-2 text-muted">
            <span className="size-2 animate-pulse rounded-full bg-accent" /> {w.provisioningStep ?? "Starting"}…
          </li>
        )}
      </ol>
      {w.provisioningError && <div className="mt-3"><ErrorNote message={w.provisioningError} /></div>}
      {stalled && (
        <button className="btn mt-3" disabled={busy === "retry_provisioning"} onClick={() => act("retry_provisioning")}>
          Retry wallet setup
        </button>
      )}
    </section>
  );
}

function WalletCard({ load, busy, act }: { load: LoadDetailT["load"]; busy: string | null; act: (a: string) => void }) {
  const w = load.wallet;
  const f = load.funding;
  const balance = w.balanceAtomic ? Number(w.balanceAtomic) / 10 ** f.decimals : 0;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Load wallet</h2>
        {load.mode === "live" && w.agentId && (
          <button className="btn px-2.5 py-1 text-xs" disabled={busy === "sync"} onClick={() => act("sync")}>
            Refresh
          </button>
        )}
      </div>
      <div className="mt-3 rounded-xl bg-panel-2 p-3">
        <div className="text-xs text-muted">Balance</div>
        <div className="num mt-1 text-2xl font-medium">
          {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} <span className="text-base text-muted">{f.symbol}</span>
        </div>
        <div className="num text-xs text-muted">
          ≈ ${(balance / f.scale).toLocaleString(undefined, { maximumFractionDigits: 2 })} contract value
          {f.scale !== 1 && ` · scale 1:${Math.round(1 / f.scale).toLocaleString()}`}
        </div>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        <Row k="Agent account" v={<span className="font-mono text-xs">{short(w.agentId, 8, 6)}</span>} />
        <Row k="Wallet (NEAR)" v={<span className="font-mono text-xs">{short(w.nearAccountId, 10, 6)}</span>} />
        <Row k="Owner (broker key)" v={<span className="font-mono text-xs">{short(w.ownerAddress, 6, 4)}</span>} />
        <Row k="Agent grant" v={w.hasGrant ? <span className="font-mono text-xs">{short(w.grantId, 8, 4)}</span> : "—"} />
        <Row k="Policy revision" v={w.policyRevision ?? "—"} />
      </dl>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}

function FraudLab({ funded, busy, act, closed }: { funded: boolean; busy: string | null; act: (a: string, extra?: Record<string, unknown>) => void; closed: boolean }) {
  return (
    <section className="card p-5">
      <h2 className="font-medium">Close out</h2>
      <p className="mt-1 text-sm text-muted">Returns whatever is left in the wallet to the broker&apos;s refund address.</p>
      <button className="btn mt-3 w-full" disabled={!funded || closed || busy === "close"} onClick={() => act("close")}>
        {busy === "close" ? "Refunding…" : closed ? "Load closed" : "Close load & refund reserve"}
      </button>

      <div className="mt-6 border-t border-line pt-5">
        <h2 className="font-medium">Fraud test</h2>
        <p className="mt-1 text-sm text-muted">
          Pretend the agent is fooled or compromised. These calls really go to the wallet; the policy, not our code, refuses them.
        </p>
        <div className="mt-3 grid gap-2">
          <button className="btn btn-danger" disabled={!funded || busy !== null} onClick={() => act("fraud_redirect")}>
            {busy === "fraud_redirect" ? "Attempting…" : "Spoofed email: pay a “new” bank account"}
          </button>
          <button className="btn btn-danger" disabled={!funded || busy !== null} onClick={() => act("overcap")}>
            {busy === "overcap" ? "Attempting…" : "Drain: pay the carrier 3× the load"}
          </button>
        </div>
      </div>
    </section>
  );
}

