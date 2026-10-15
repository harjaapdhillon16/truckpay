"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Check, ExternalLink, MessageSquare, ShieldAlert, ShieldCheck } from "lucide-react";
import { AppShell, CopyButton, CopyId, ErrorNote, LoadStatusPill, Pill, ScaleBadge } from "@/components/ui";
import { ProofView } from "@/components/proof-view";
import { ApiError, clock, postJson, usePolling } from "@/lib/client";
import { usd } from "@/lib/money";
import type { CompanyLoadView } from "@/server/views";

type View = CompanyLoadView;

export default function LoadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, setData, error } = usePolling<View>(`/loads/${id}`, 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(name: string, path: string, body: unknown = {}) {
    setBusy(name);
    setActionError(null);
    try {
      const result = await postJson<View | { attempt: unknown }>(`/loads/${id}${path}`, body);
      if ("id" in result) setData(result as View);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!data)
    return (
      <AppShell title="Load">
        <p className="text-sm text-muted">{error?.status === 404 ? "This load doesn't exist." : error?.message ?? "Loading…"}</p>
      </AppShell>
    );

  const load = data;
  const fmtUsdc = (atomic: string) => (Number(atomic) / 10 ** load.onChain.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 });

  return (
    <AppShell title={load.number}>
      <div className="detail-heading">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={16} aria-hidden="true" />Loads</Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1>{load.number}</h1>
          <LoadStatusPill status={load.status} />
          {load.mode === "simulated" && <Pill tone="warn">simulated wallet</Pill>}
        </div>
        <p className="mt-2 text-sm text-muted">
          <span className="num font-medium text-ink">{usd(load.rateUsd)}</span> to {load.carrier.name} on delivery at {load.delivery.name}
        </p>
      </div>
      <ScaleBadge />

      <ol className="stepper" aria-label="Load progress">
        {load.steps.map((s, i) => (
          <li key={s.key} className={`step step-${s.state}`} aria-current={s.state === "current" || s.state === "attention" ? "step" : undefined}>
            <span className="step-dot">{s.state === "done" ? <Check size={14} aria-hidden="true" /> : i + 1}</span>
            <span className="step-label">{s.label}</span>
          </li>
        ))}
      </ol>

      {load.failure && load.status === "failed" && (
        <div className="error-banner" role="alert"><span><strong>Needs attention.</strong> {load.failure}</span></div>
      )}

      <div className="load-grid">
        <div className="min-w-0 space-y-6">
          <section className="card stage-card" aria-live="polite">
            <Stage load={load} busy={busy} act={act} fmtUsdc={fmtUsdc} />
          </section>

          {load.proofs.length > 0 && load.status !== "needs_review" && (
            <section className="card stage-card">
              <h2 className="stage-title">Delivery proof</h2>
              <div className="space-y-6">
                {[...load.proofs].reverse().map((p) => <ProofView key={p.id} loadId={load.id} proof={p} />)}
              </div>
            </section>
          )}

          <Activity load={load} />
        </div>

        <aside className="space-y-6">
          <WalletCard load={load} fmtUsdc={fmtUsdc} />
          <DemoControls load={load} busy={busy} act={act} />
          <ErrorNote message={actionError} />
        </aside>
      </div>
    </AppShell>
  );
}

type ActFn = (name: string, path: string, body?: unknown) => Promise<void>;

function Stage({ load, busy, act, fmtUsdc }: { load: View; busy: string | null; act: ActFn; fmtUsdc: (a: string) => string }) {
  switch (load.status) {
    case "wallet_pending":
      return (
        <>
          <h2 className="stage-title">Creating the load wallet</h2>
          <p className="stage-lead">The company key signs two things with Agent Connect: the wallet&apos;s policy, and a grant that lets the load agent pay inside it. The agent never gets the key.</p>
          <IntentList load={load} pending />
        </>
      );
    case "awaiting_funding":
      return <Funding load={load} busy={busy} act={act} fmtUsdc={fmtUsdc} />;
    case "funded":
      return <DriverHandoff load={load} />;
    case "verifying":
      return (
        <>
          <h2 className="stage-title"><span className="pulse-dot" />Verifying delivery</h2>
          <p className="stage-lead">The load agent is checking the driver&apos;s location and reading the BOL. This usually takes a few seconds.</p>
        </>
      );
    case "needs_review":
      return <Review load={load} busy={busy} act={act} />;
    case "paying":
      return (
        <>
          <h2 className="stage-title"><span className="pulse-dot" />Paying {load.carrier.name}</h2>
          <p className="stage-lead">The wallet is sending {usd(load.rateUsd)} to {load.carrier.payoutHint}. Agent Connect operation <CopyId value={load.payment?.correlationId} />.</p>
        </>
      );
    case "paid":
      return (
        <div className="paid-panel">
          <div className="paid-check"><Check size={28} aria-hidden="true" /></div>
          <div>
            <h2 className="stage-title">Carrier paid {usd(load.payment?.amountUsd ?? load.rateUsd)}{load.payment?.test && <Pill tone="warn">test money</Pill>}</h2>
            <p className="stage-lead">
              {fmtUsdc(load.payment?.amountAtomic ?? load.onChain.amountAtomic)} USDC to {load.carrier.payoutHint}
              {load.proofToPayoutSeconds !== null && <> · <strong className="text-ink">{formatSeconds(load.proofToPayoutSeconds)}</strong> from proof to payout</>}
            </p>
            {load.payment?.test && load.payment.policyCheck ? (
              <div className="policy-check">
                <div className="text-sm font-medium">
                  {load.payment.policyCheck.source === "agent_connect_quote" ? "Agent Connect approved this exact payment" : "Allowed by the wallet's signed policy"}
                </div>
                <ul>
                  {load.payment.policyCheck.checks.map((c) => (
                    <li key={c.name} className={c.passed ? "text-money" : "text-danger"}>{c.passed ? "✓" : "✕"} <span className="text-ink">{c.name}</span></li>
                  ))}
                </ul>
                <p className="text-xs text-muted">Test money: the wallet&apos;s real policy checked the payment and no USDC moved.</p>
              </div>
            ) : (
            <dl className="kv mt-4">
              <dt>Agent Connect operation</dt><dd><CopyId value={load.payment?.correlationId} /></dd>
              <dt>Settled</dt><dd>{load.payment?.settledAt ? clock(load.payment.settledAt) : "—"}</dd>
              {load.carrier.payout.kind === "withdraw" && (
                <><dt>Carrier address</dt><dd><a className="text-accent hover:underline" href={`https://basescan.org/address/${load.carrier.payout.address}#tokentxns`} target="_blank" rel="noreferrer">View on Basescan <ExternalLink size={12} className="inline" aria-hidden="true" /></a></dd></>
              )}
            </dl>
            )}
          </div>
        </div>
      );
    case "cancelling":
      return <><h2 className="stage-title"><span className="pulse-dot" />Refunding the company</h2><p className="stage-lead">The wallet is returning its balance to your refund account.</p></>;
    case "cancelled":
      return <><h2 className="stage-title">Cancelled</h2><p className="stage-lead">This load was cancelled{load.payments.some((p) => p.kind === "refund" && p.status === "SUCCESS") ? " and the wallet refunded your account" : ""}.</p></>;
    case "failed":
      return <><h2 className="stage-title">Needs attention</h2><p className="stage-lead">{load.failure ?? "Something went wrong."} Check the activity below; no money moves until this is resolved.</p><IntentList load={load} /></>;
  }
}

function IntentList({ load, pending }: { load: View; pending?: boolean }) {
  const labels: Record<string, string> = { agent_create: "Create wallet with policy", grant_issue: "Grant load agent access" };
  const phaseText: Record<string, string> = { create: "Signing the policy…", await_policy: "Waiting for the policy to apply on-chain…", grant: "Issuing the agent's grant…", deposit: "Getting a deposit address…", ready: "Ready" };
  return (
    <ul className="intent-list">
      {load.ownerIntents.map((i) => (
        <li key={i.correlationId}>
          <span className={i.status === "SUCCESS" ? "text-money" : "text-muted"}>{i.status === "SUCCESS" ? <Check size={16} aria-hidden="true" /> : <span className="pulse-dot" />}</span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{labels[i.type] ?? i.type}</span>
            {i.summary && <small>{i.summary}</small>}
            <span className="intent-id"><CopyId value={i.correlationId} head={10} tail={6} /></span>
          </span>
        </li>
      ))}
      {pending && <li className="text-muted"><span className="pulse-dot" /><span>{phaseText[load.wallet.phase] ?? "Working…"}</span></li>}
    </ul>
  );
}

function Funding({ load, busy, act, fmtUsdc }: { load: View; busy: string | null; act: ActFn; fmtUsdc: (a: string) => string }) {
  const deposit = load.wallet.deposit;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (deposit?.address) QRCode.toDataURL(deposit.address, { margin: 1, width: 220 }).then(setQr);
  }, [deposit?.address]);
  const received = BigInt(load.wallet.balanceAtomic || "0");
  if (load.testMoney)
    return (
      <>
        <h2 className="stage-title">Fund the wallet with test money</h2>
        <p className="stage-lead">
          This wallet, its policy and the agent&apos;s grant are real on Agent Connect. In test-money mode no USDC moves: add {usd(load.rateUsd)} of test funds
          ({fmtUsdc(load.onChain.amountAtomic)} USDC at demo scale), and when the carrier is paid, Agent Connect checks the payment against the policy instead of sending it.
        </p>
        <button className="btn btn-primary mt-4" disabled={busy === "deposit"} onClick={() => act("deposit", "/simulate-deposit")}>Add test funds</button>
      </>
    );
  return (
    <>
      <h2 className="stage-title">Fund the wallet</h2>
      <p className="stage-lead">Send exactly <strong className="num text-ink">{fmtUsdc(load.onChain.amountAtomic)} USDC on Base</strong> ({usd(load.rateUsd)} at demo scale). The load turns Funded on its own when it lands.</p>
      {load.mode === "simulated" ? (
        <button className="btn btn-primary mt-4" disabled={busy === "deposit"} onClick={() => act("deposit", "/simulate-deposit")}>Simulate deposit</button>
      ) : deposit?.address ? (
        <div className="deposit-box">
          {qr && <img src={qr} alt="QR code for the deposit address" className="deposit-qr" />}
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <div className="label">Deposit address · USDC on Base</div>
              <div className="break-all font-mono text-sm">{deposit.address}</div>
              <div className="mt-2"><CopyButton value={deposit.address} label="Copy address" /></div>
            </div>
            {deposit.memo && <div><div className="label">Memo (required)</div><div className="font-mono text-sm">{deposit.memo}</div></div>}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {deposit.minAmountAtomic && <span>Minimum {fmtUsdc(deposit.minAmountAtomic)} USDC</span>}
              {deposit.expiresAt && <span>Address valid until {new Date(deposit.expiresAt).toLocaleString()}</span>}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="pulse-dot" />
              {received > 0n ? `Received ${fmtUsdc(received.toString())} of ${fmtUsdc(load.onChain.amountAtomic)} USDC` : "Watching for your deposit…"}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted"><span className="pulse-dot" /> Getting a deposit address…</p>
      )}
    </>
  );
}

function DriverHandoff({ load }: { load: View }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(load.driverUrl, { margin: 1, width: 220 }).then(setQr);
  }, [load.driverUrl]);
  const sms = `sms:?&body=${encodeURIComponent(`${load.number}: deliver to ${load.delivery.name}. When unloaded, open this link and take a photo of the signed BOL to get paid: ${load.driverUrl}`)}`;
  const rejected = load.proofs.at(-1)?.status === "rejected";
  return (
    <>
      <h2 className="stage-title">Funded. Send the driver their link</h2>
      <p className="stage-lead">
        {usd(load.rateUsd)} is locked in the wallet. The driver needs no app or login: they open the link at the dock and take one photo.
        {rejected && " The last proof was rejected, so the driver can submit again from the same link."}
      </p>
      <div className="deposit-box">
        {qr && <img src={qr} alt="QR code for the driver link" className="deposit-qr" />}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="break-all font-mono text-sm">{load.driverUrl}</div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={load.driverUrl} label="Copy link" />
            <a className="btn" href={sms}><MessageSquare size={16} aria-hidden="true" />Text to driver</a>
            <a className="btn" href={load.driverUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />Open</a>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted"><span className="pulse-dot" />Waiting for delivery proof…</p>
        </div>
      </div>
    </>
  );
}

function Review({ load, busy, act }: { load: View; busy: string | null; act: ActFn }) {
  const proof = [...load.proofs].reverse().find((p) => p.status === "needs_review");
  const [note, setNote] = useState("");
  if (!proof) return null;
  return (
    <>
      <h2 className="stage-title">The agent wants a second look</h2>
      <p className="stage-lead">Approving pays {usd(load.rateUsd)} through the same wallet policy. Rejecting lets the driver submit a new photo.</p>
      <ProofView loadId={load.id} proof={proof} />
      <div className="review-actions">
        <input className="field" placeholder="Note to the driver (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => act("review", `/proofs/${proof.id}/review`, { decision: "approve", note })}>Approve & pay</button>
        <button className="btn btn-danger" disabled={busy !== null} onClick={() => act("review", `/proofs/${proof.id}/review`, { decision: "reject", note })}>Reject</button>
      </div>
    </>
  );
}

function WalletCard({ load, fmtUsdc }: { load: View; fmtUsdc: (a: string) => string }) {
  const w = load.wallet;
  const g = w.guardrails;
  return (
    <section className="card side-card">
      <h2 className="flex items-center gap-2"><ShieldCheck size={18} aria-hidden="true" />Load wallet</h2>
      <div className="balance">
        <div className="text-xs text-muted">Balance</div>
        <div className="num text-2xl font-medium">{fmtUsdc(w.balanceAtomic)} <span className="text-sm text-muted">USDC</span></div>
      </div>
      {g && (
        <>
          <div className="side-subtitle">The wallet only allows</div>
          <ul className="guardrails">
            <li>USDC only, no swaps</li>
            <li>At most {g.perPaymentAtomic ? `${fmtUsdc(g.perPaymentAtomic)} USDC` : "the rate"} per payment</li>
            <li>${g.budgetUsd} total budget{g.maxPerHour ? `, ${g.maxPerHour} payments an hour` : ""}</li>
            {g.destinations.map((d) => (
              <li key={d.value}>Pay <strong>{d.label}</strong><br /><CopyId value={d.value} head={12} tail={6} /></li>
            ))}
          </ul>
        </>
      )}
      <dl className="kv mt-4">
        <dt>Owner (company key)</dt><dd><CopyId value={w.ownerAddress} /></dd>
        <dt>Agent account</dt><dd><CopyId value={w.agentId} /></dd>
        <dt>Load agent grant</dt><dd>{w.hasGrant ? <CopyId value={w.grantId} /> : "—"}</dd>
        <dt>Policy revision</dt><dd>{w.policyRevision ?? "—"}</dd>
      </dl>
      {load.ownerIntents.length > 0 && (
        <>
          <div className="side-subtitle">Signed by the company</div>
          <IntentList load={load} />
        </>
      )}
    </section>
  );
}

function DemoControls({ load, busy, act }: { load: View; busy: string | null; act: ActFn }) {
  const attempts = load.payments.filter((p) => p.kind === "fraud_test");
  const last = attempts.at(-1);
  const canTest = load.wallet.phase === "ready" && load.wallet.hasGrant;
  const canCancel = ["awaiting_funding", "funded", "needs_review"].includes(load.status) || (load.status === "wallet_pending" && !load.wallet.agentId);
  return (
    <section className="card side-card">
      <h2 className="flex items-center gap-2"><ShieldAlert size={18} aria-hidden="true" />Demo controls</h2>
      <p className="mt-1 text-sm text-muted">A spoofed email tells the agent the carrier changed banks. The agent tries to pay the new account.</p>
      <button className="btn btn-danger mt-3 w-full" disabled={!canTest || busy !== null} onClick={() => act("fraud", "/fraud-test")}>
        {busy === "fraud" ? "Trying…" : "Fraud test: pay a different account"}
      </button>
      {last && (
        <div className={`fraud-result ${last.status === "BLOCKED" ? "fraud-blocked" : ""}`} role="status">
          <strong>{last.status === "BLOCKED" ? "Blocked by Agent Connect" : last.status}</strong>
          <code>{last.errorCode}</code>
          <span>{last.errorDetail}</span>
          <small>No money moved. {attempts.length > 1 ? `${attempts.length} attempts blocked.` : ""}</small>
        </div>
      )}
      <div className="side-divider" />
      <button className="btn w-full" disabled={!canCancel || busy !== null} onClick={() => act("cancel", "/cancel")}>
        {busy === "cancel" ? "Cancelling…" : "Cancel load & refund"}
      </button>
      <p className="mt-2 text-xs text-muted">Returns the wallet&apos;s balance to the company. Not possible once the carrier is paid.</p>
    </section>
  );
}

function Activity({ load }: { load: View }) {
  const actor: Record<string, string> = { company: "Company", driver: "Driver", agent: "Load agent", wallet: "Agent Connect", system: "System" };
  return (
    <section className="card stage-card">
      <h2 className="stage-title">Activity</h2>
      <ol className="activity">
        {[...load.events].reverse().map((e) => (
          <li key={e.id} className={`activity-${e.actor} ${e.type.includes("blocked") || e.type === "spoofed_email" ? "activity-alert" : ""}`}>
            <span className="activity-dot" />
            <div>
              <div className="text-sm">{e.title}</div>
              <div className="text-xs text-muted">{actor[e.actor] ?? e.actor} · {clock(e.ts)}{typeof e.detail.code === "string" && <> · <code>{e.detail.code}</code></>}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatSeconds(s: number) {
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)} s` : `${Math.round(s / 60)} min`;
}
