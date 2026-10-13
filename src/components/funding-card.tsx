"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { LoadDetailT } from "@/lib/api-types";
import { Pill } from "./ui";

export function FundingCard({ load, busy, act }: { load: LoadDetailT["load"]; busy: string | null; act: (a: string) => void }) {
  const f = load.funding;
  const amount = Number(f.requiredAtomic) / 10 ** f.decimals;
  const deposit = load.wallet.deposit;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (deposit?.address) QRCode.toDataURL(deposit.address, { margin: 1, width: 180 }).then(setQr);
  }, [deposit?.address]);

  return (
    <section className="card border-warn/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Fund the load wallet</h2>
          <p className="mt-1 max-w-lg text-sm text-muted">
            The carrier sees the money is committed before the truck moves. Send exactly the amount below; the wallet shows as funded as soon as it lands.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Send</div>
          <div className="num text-2xl font-medium">
            {amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} {f.symbol}
          </div>
        </div>
      </div>

      {load.mode === "simulated" ? (
        <button className="btn btn-primary mt-4" disabled={busy === "simulate_deposit"} onClick={() => act("simulate_deposit")}>
          Simulate broker deposit
        </button>
      ) : !deposit ? (
        <button className="btn btn-primary mt-4" disabled={busy === "deposit_address"} onClick={() => act("deposit_address")}>
          {busy === "deposit_address" ? "Requesting…" : "Get deposit address"}
        </button>
      ) : (
        <div className="mt-4 flex flex-wrap gap-5 rounded-xl bg-panel-2 p-4">
          {qr && <img src={qr} alt="Deposit address QR code" className="size-[150px] rounded-lg bg-white p-1" />}
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            <div>
              <div className="text-xs text-muted">Deposit address · {f.fundingAsset.split(":")[1]?.split("-")[0] ?? "chain"}</div>
              <div className="mt-1 break-all font-mono text-xs">{deposit.address ?? "Not issued; do not send funds"}</div>
            </div>
            {deposit.memo && (
              <div>
                <div className="text-xs text-muted">Memo (required)</div>
                <div className="font-mono text-xs">{deposit.memo}</div>
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              {deposit.minAmount && <span>Min {Number(deposit.minAmount) / 10 ** f.decimals} {f.symbol}</span>}
              {deposit.expiresAt && <span>Expires {new Date(deposit.expiresAt).toLocaleString()}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={deposit.status === "SUCCESS" ? "money" : "info"} dot>
                {deposit.status.toLowerCase().replace(/_/g, " ")}
              </Pill>
              <button className="btn px-2.5 py-1 text-xs" disabled={busy === "sync"} onClick={() => act("sync")}>
                Check balance
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
