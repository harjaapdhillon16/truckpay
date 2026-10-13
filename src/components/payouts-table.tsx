"use client";

import type { LoadDetailT } from "@/lib/api-types";
import { clock, short } from "@/lib/client";
import { usd } from "@/lib/money";
import { PAYOUT_LABELS } from "@/lib/types";
import { PayoutStatusPill } from "./ui";

export function PayoutsTable({ payouts, symbol, decimals }: { payouts: LoadDetailT["payouts"]; symbol: string; decimals: number }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-medium">Payouts</h2>
        <span className="text-xs text-muted">Every request the agent sent to the wallet</span>
      </div>
      {payouts.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">No payouts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-5 py-2 font-medium">Payout</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Wallet result</th>
                <th className="px-5 py-2 font-medium">Operation</th>
              </tr>
            </thead>
            <tbody>
              {[...payouts].reverse().map((p) => (
                <tr key={p.id} className={`border-t border-line align-top ${p.status === "BLOCKED" ? "bg-danger-soft/40" : ""}`}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{PAYOUT_LABELS[p.kind]}</div>
                    <div className="text-xs text-muted">{clock(p.createdAt)}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div>{p.destination.label}</div>
                    <div className="font-mono text-xs text-muted">{short(p.destination.address, 12, 6)}</div>
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    <div className="font-medium">{usd(p.amountUsd)}</div>
                    <div className="text-xs text-muted">
                      {(Number(p.amountAtomic) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })} {symbol}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <PayoutStatusPill status={p.status} />
                    {p.errorCode && <div className="mt-1 font-mono text-xs text-danger">{p.errorCode}</div>}
                    {p.errorDetail && <div className="mt-0.5 max-w-[220px] text-xs text-muted">{p.errorDetail}</div>}
                    {p.settledAt && p.status === "SUCCESS" && (
                      <div className="mt-1 text-xs text-muted">in {Math.max(0.1, (Date.parse(p.settledAt) - Date.parse(p.createdAt)) / 1000).toFixed(1)} s</div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 font-mono text-xs text-muted">{short(p.correlationId, 10, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
