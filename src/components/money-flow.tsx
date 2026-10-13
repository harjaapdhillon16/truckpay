"use client";

import type { LoadDetailT } from "@/lib/api-types";
import { usd } from "@/lib/money";
import { PAYOUT_LABELS, totalCommittedUsd, type PayoutKind } from "@/lib/types";

type Step = { key: string; event: string; sub: string; payout: string; amount: number | null; state: "done" | "active" | "pending" | "blocked" };

/** The five-event flow from the proposal, filled in from the real payouts. */
export function MoneyFlow({ load, payouts }: { load: LoadDetailT["load"]; payouts: LoadDetailT["payouts"] }) {
  const rc = load.rateCon;
  const total = totalCommittedUsd(rc);
  const funded = !["provisioning", "awaiting_funding", "failed"].includes(load.status);
  const sum = (kind: PayoutKind) => payouts.filter((p) => p.kind === kind && p.status === "SUCCESS").reduce((s, p) => s + p.amountUsd, 0);
  const has = (kind: PayoutKind) => payouts.some((p) => p.kind === kind && !["BLOCKED", "FAILED", "REFUNDED"].includes(p.status));
  const fuelPlanned = (rc.linehaulUsd * rc.fuelAdvancePct) / 100;

  const steps: Step[] = [
    { key: "fund", event: "Load booked", sub: "rate con signed", payout: "Broker → wallet", amount: total, state: funded ? "done" : load.status === "awaiting_funding" ? "active" : "pending" },
    { key: "fuel", event: "Pickup", sub: "GPS in geofence", payout: "Fuel → carrier", amount: has("fuel_advance") ? sum("fuel_advance") || fuelPlanned : fuelPlanned, state: has("fuel_advance") ? (sum("fuel_advance") ? "done" : "active") : funded ? "active" : "pending" },
    { key: "det", event: "Dock wait", sub: `${rc.detention.freeHours} h free`, payout: "Detention → carrier", amount: has("detention") ? sum("detention") : null, state: has("detention") ? (sum("detention") ? "done" : "active") : ["at_delivery", "pod_review", "delivered", "closed"].includes(load.status) ? "active" : "pending" },
    { key: "final", event: "POD verified", sub: "photo · sig · video · GPS", payout: "Final → carrier", amount: has("final") ? sum("final") || rc.linehaulUsd - sum("fuel_advance") : rc.linehaulUsd - fuelPlanned, state: has("final") ? (sum("final") ? "done" : "active") : load.status === "pod_review" ? "blocked" : "pending" },
    { key: "refund", event: "Load closed", sub: "no disputes", payout: "Reserve → broker", amount: has("refund") ? sum("refund") : null, state: has("refund") ? (sum("refund") ? "done" : "active") : load.status === "closed" ? "done" : "pending" },
  ];

  const released = load.ledger.toCarrier + load.ledger.lumper;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-muted">Released to carrier</div>
          <div className="num mt-1 text-3xl font-medium tracking-tight text-money">
            {usd(load.ledger.toCarrier)} <span className="text-base font-normal text-muted">of {usd(rc.linehaulUsd)} linehaul{load.ledger.detention > 0 && ` + ${usd(load.ledger.detention)} detention`}</span>
          </div>
        </div>
        <div className="flex gap-6 text-sm">
          <Figure label="Committed" value={usd(total)} />
          <Figure label="Lumper" value={usd(load.ledger.lumper)} />
          <Figure label="Reserve left" value={usd(load.ledger.reserveLeft)} />
        </div>
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-line">
        <div className="bg-money" style={{ width: `${(load.ledger.toCarrier / total) * 100}%` }} />
        <div className="bg-accent" style={{ width: `${(load.ledger.lumper / total) * 100}%` }} />
        <div className="bg-muted/40" style={{ width: `${(load.ledger.refund / total) * 100}%` }} />
      </div>

      <ol className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-5">
        {steps.map((s) => (
          <li key={s.key} className={`rounded-xl border p-3 ${stateClass(s.state)}`}>
            <div className="text-xs font-medium">{s.event}</div>
            <div className="text-[11px] text-muted">{s.sub}</div>
            <div className="mt-2.5 border-t border-dashed border-line pt-2">
              <div className="num text-sm font-medium">{s.amount === null ? "—" : usd(s.amount)}</div>
              <div className="text-[11px] text-muted">{s.payout}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">
        Anything outside the policy (wrong address, over a cap, no matching event) is blocked by the wallet and sent to a person. {released > 0 && `${PAYOUT_LABELS.final} goes out minutes after the POD is verified.`}
      </p>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function stateClass(state: Step["state"]) {
  switch (state) {
    case "done":
      return "border-transparent bg-money-soft";
    case "active":
      return "border-accent bg-info-soft";
    case "blocked":
      return "border-transparent bg-warn-soft";
    default:
      return "border-line bg-panel-2 opacity-70";
  }
}
