"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, LocateFixed, MapPin, ShieldCheck } from "lucide-react";
import { AppShell, ErrorNote, useHealth } from "@/components/ui";
import { ApiError, idempotencyKey, postJson } from "@/lib/client";
import type { Destination } from "@/lib/domain";
import { STOP_PRESETS } from "@/lib/geo";
import { currentPosition } from "@/lib/media";
import { usd } from "@/lib/money";

type StopChoice = { kind: "preset"; index: number } | { kind: "here"; lat: number; lng: number; accuracyM: number };

export default function NewLoadPage() {
  const router = useRouter();
  const health = useHealth();
  const [rate, setRate] = useState(2500);
  const [stop, setStop] = useState<StopChoice>({ kind: "preset", index: 1 });
  const [stopName, setStopName] = useState(STOP_PRESETS[1].name);
  const [carrierName, setCarrierName] = useState("Swift Lane Trucking");
  const [payoutKindChoice, setPayoutKind] = useState<Destination["kind"]>("transfer");
  const testMoney = Boolean(health?.testMoney && health.mode === "live");
  const payoutKind: Destination["kind"] = testMoney ? "withdraw" : payoutKindChoice;
  // null until edited: demo deployments prefill the company-controlled demo carrier account.
  const [payoutInput, setPayout] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(idempotencyKey);

  const payout = payoutInput ?? (payoutKind === "transfer" ? health?.demoCarrier?.near : health?.demoCarrier?.base) ?? "";

  const scale = health?.scale ?? 0.001;
  const radiusKm = ((health?.geofenceMeters ?? 1000) / 1000).toFixed(1);
  const payoutValid = payoutKind === "withdraw" ? /^0x[0-9a-fA-F]{40}$/.test(payout.trim()) : /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(payout.trim());

  async function useMyLocation() {
    setLocating(true);
    setError(null);
    try {
      const here = await currentPosition();
      setStop({ kind: "here", ...here });
      setStopName("Demo dock (my location)");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const preset = stop.kind === "preset" ? STOP_PRESETS[stop.index] : null;
    const delivery = preset
      ? { name: stopName || preset.name, address: preset.address, lat: preset.lat, lng: preset.lng }
      : { name: stopName || "Demo dock", address: `GPS ${stop.kind === "here" ? `${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}` : ""}`, lat: (stop as { lat: number }).lat, lng: (stop as { lng: number }).lng };
    const payoutDestination: Destination = payoutKind === "withdraw" ? { kind: "withdraw", chain: "base", address: payout.trim() } : { kind: "transfer", account: payout.trim() };
    try {
      const load = await postJson<{ id: string }>("/loads", { rateUsd: rate, delivery, carrier: { name: carrierName, payout: payoutDestination } }, { "idempotency-key": key });
      router.push(`/loads/${load.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <AppShell title="New load">
      <div className="booking-heading">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><ArrowLeft size={16} aria-hidden="true" />Loads</Link>
        <h1>New load</h1>
        <p className="mt-2 text-muted">Four fields. The rest (wallet, policy, deposit address, driver link) is created for you.</p>
      </div>

      <form onSubmit={submit} className="new-load-grid">
        <div className="card form-card">
          <label className="block">
            <span className="label">Rate</span>
            <div className="money-input">
              <span>$</span>
              <input className="field num" type="number" min={1} step={1} value={rate} onChange={(e) => setRate(Number(e.target.value))} required />
            </div>
          </label>

          <fieldset>
            <legend className="label">Deliver to</legend>
            <div className="stop-choice">
              <select
                className="field"
                aria-label="Delivery stop"
                value={stop.kind === "preset" ? stop.index : "here"}
                onChange={(e) => {
                  if (e.target.value === "here") return;
                  const index = Number(e.target.value);
                  setStop({ kind: "preset", index });
                  setStopName(STOP_PRESETS[index].name);
                }}
              >
                {stop.kind === "here" && <option value="here">My current location</option>}
                {STOP_PRESETS.map((s, i) => (
                  <option key={s.name} value={i}>{s.name}, {s.address.split(",").slice(-2).join(",").trim()}</option>
                ))}
              </select>
              <button type="button" className="btn" onClick={useMyLocation} disabled={locating}>
                <LocateFixed size={16} aria-hidden="true" />{locating ? "Locating…" : "Use my location"}
              </button>
            </div>
            <p className="field-hint">
              <MapPin size={14} aria-hidden="true" />
              {stop.kind === "here"
                ? `Pinned to where you are (±${Math.round(stop.accuracyM)} m). A phone within ${radiusKm} km of here passes the delivery check.`
                : `Proof only counts within ${radiusKm} km of ${STOP_PRESETS[stop.index].address}. Recording somewhere else? Use your location.`}
            </p>
            <label className="mt-3 block">
              <span className="label">Stop name (shown to the driver)</span>
              <input className="field" value={stopName} onChange={(e) => setStopName(e.target.value)} required maxLength={80} />
            </label>
          </fieldset>

          <label className="block">
            <span className="label">Carrier</span>
            <input className="field" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} required maxLength={80} />
          </label>

          <fieldset>
            <legend className="label">Carrier payout account</legend>
            {testMoney ? (
              <p className="field-hint mt-0">Test money: payouts go to a Base address, so Agent Connect can check each payment against the policy without moving funds.</p>
            ) : (
              <div className="segmented" role="radiogroup" aria-label="Payout type">
                <button type="button" role="radio" aria-checked={payoutKind === "transfer"} onClick={() => { setPayoutKind("transfer"); setPayout(null); }}>NEAR Intents account</button>
                <button type="button" role="radio" aria-checked={payoutKind === "withdraw"} onClick={() => { setPayoutKind("withdraw"); setPayout(null); }}>USDC on Base</button>
              </div>
            )}
            <input
              className="field mt-2 font-mono"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder={payoutKind === "withdraw" ? "0x… Base address" : "carrier.near"}
              aria-invalid={payout.length > 0 && !payoutValid}
              required
            />
            <p className="field-hint">{payoutKind === "transfer" ? "Paid inside NEAR Intents in seconds, with no bridge fee." : "Bridged to Base: takes minutes and the network fee comes out of the payment."} The wallet can only ever pay this account or refund you.</p>
          </fieldset>
        </div>

        <aside className="card summary-card">
          <div className="text-xs text-muted">Escrowed in the load wallet</div>
          <div className="num summary-amount">{usd(rate || 0)}</div>
          <div className="text-xs text-muted">
            Settles as <span className="num font-medium text-ink">{((rate || 0) * scale).toFixed(2)} USDC</span>
            {scale !== 1 && ` (demo scale 1:${Math.round(1 / scale).toLocaleString()})`}
          </div>
          <ol className="next-steps">
            <li><span><strong>Wallet created.</strong> The company key signs its policy and the load agent&apos;s grant.</span></li>
            <li><span><strong>You fund it.</strong> {testMoney ? "Add test funds: no real USDC moves." : "Scan the deposit QR and send the amount above."}</span></li>
            <li><span><strong>Driver submits proof.</strong> One photo of the signed BOL at the dock.</span></li>
            <li><span><strong>Carrier is paid.</strong> Within seconds of the proof being verified.</span></li>
          </ol>
          <div className="guardrail-note"><ShieldCheck size={16} aria-hidden="true" />The policy allows only USDC, only the carrier or your refund account, and never more than the rate.</div>
          <ErrorNote message={error} />
          <button className="btn btn-primary w-full" disabled={busy || !payoutValid || !rate || !carrierName}>{busy ? "Creating…" : "Create load & wallet"}</button>
        </aside>
      </form>
    </AppShell>
  );
}
