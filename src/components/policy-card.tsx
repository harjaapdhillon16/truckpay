"use client";

import type { Policy } from "@near-intents-agent-api/sdk";
import type { LoadDetailT } from "@/lib/api-types";
import { short } from "@/lib/client";
import { usd } from "@/lib/money";

export function PolicyCard({ load }: { load: LoadDetailT["load"] }) {
  const policy = load.wallet.policy as Policy | undefined;
  const rc = load.rateCon;
  const f = load.funding;
  if (!policy) return null;
  const perTx = Object.values(policy.limits.per_transaction ?? {})[0];

  return (
    <section className="card p-5">
      <h2 className="font-medium">Guardrails</h2>
      <p className="mt-1 text-xs text-muted">Signed by the broker. The agent can only ask; the wallet decides.</p>

      <div className="text-xs text-muted mt-4">Enforced by the Agent Connect wallet</div>
      <ul className="mt-2 space-y-2 text-sm">
        <Item k="Actions" v={policy.actions.join(" + ")} />
        <Item k="Asset" v={f.symbol + " only"} />
        <Item k="Per payment" v={perTx ? `≤ ${(Number(perTx) / 10 ** f.decimals).toLocaleString()} ${f.symbol}` : "—"} />
        <Item k="USD budget" v={policy.budget.daily_usd ? `$${policy.budget.daily_usd} on-chain` : "uncapped"} />
        <Item k="Rate limit" v={policy.max_actions_per_hour ? `${policy.max_actions_per_hour} payouts / hour` : "—"} />
      </ul>
      <div className="mt-3 text-xs font-medium text-muted">Allowed destinations ({policy.destinations.mode})</div>
      <ul className="mt-1.5 space-y-1.5">
        {policy.destinations.list.map((d) => {
          const label = [rc.carrier.payout, rc.brokerRefund, rc.lumperService].find((x) => x && x.address.toLowerCase() === d.address.toLowerCase())?.label;
          return (
            <li key={`${d.action}-${d.address}`} className="rounded-lg bg-panel-2 px-2.5 py-1.5 text-xs">
              <div className="font-medium">{label ?? "Destination"}</div>
              <div className="font-mono text-muted">
                {d.action === "withdraw" ? `${d.chain}:` : "intents:"}
                {short(d.address, 14, 6)}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="text-xs text-muted mt-5">Enforced by the load agent, inside those caps</div>
      <ul className="mt-2 space-y-2 text-sm">
        <Item k="Fuel advance" v={`${rc.fuelAdvancePct}% once, after pickup geofence`} />
        <Item k="Detention" v={`$${rc.detention.ratePerHourUsd}/h after ${rc.detention.freeHours} h, max ${usd(rc.detention.capUsd)}`} />
        <Item k="Lumper" v={rc.lumperService ? `≤ ${usd(rc.lumperCapUsd)}, receipt verified` : "not allowed"} />
        <Item k="Final" v="POD photo + signature + video + delivery GPS" />
        <Item k="Geofence" v={`${(rc.geofenceMeters / 1000).toFixed(1)} km`} />
      </ul>
    </section>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-muted">{k}</span>
      <span className="text-right">{v}</span>
    </li>
  );
}
