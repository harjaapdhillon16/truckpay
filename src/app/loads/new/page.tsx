"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppHeader, ErrorNote } from "@/components/ui";
import { Button } from "@/components/arc/button/button";
import { ShieldCheck } from "lucide-react";
import type { StatusT } from "@/lib/api-types";
import { api, postJson } from "@/lib/client";
import { STOP_PRESETS } from "@/lib/geo";
import { usd } from "@/lib/money";
import type { PayoutDestination, RateCon } from "@/lib/types";

const CHAINS = [
  { id: "base", label: "Base" },
  { id: "eth", label: "Ethereum" },
  { id: "arb", label: "Arbitrum" },
  { id: "sol", label: "Solana" },
  { id: "near", label: "NEAR" },
];

function localInput(offsetHours: number) {
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Form = {
  loadNumber: string;
  equipment: string;
  commodity: string;
  pickupIdx: number;
  pickupAppt: string;
  deliveryIdx: number;
  deliveryAppt: string;
  carrierName: string;
  mcNumber: string;
  driverName: string;
  carrierPayout: PayoutDestination;
  useLumper: boolean;
  lumper: PayoutDestination;
  brokerRefund: PayoutDestination;
  linehaulUsd: number;
  accessorialReserveUsd: number;
  fuelAdvancePct: number;
  freeHours: number;
  ratePerHourUsd: number;
  detentionCapUsd: number;
  lumperCapUsd: number;
  geofenceMeters: number;
  deliveryWindowHours: number;
};

const simulatedDefaults = (ready = false): Form => ({
  loadNumber: ready ? `LD-${Math.floor(10000 + Math.random() * 89999)}` : "",
  equipment: "53' dry van",
  commodity: "Packaged dry groceries, 22 pallets",
  pickupIdx: 0,
  pickupAppt: ready ? localInput(2) : "",
  deliveryIdx: 1,
  deliveryAppt: ready ? localInput(26) : "",
  carrierName: "Swift Lane Trucking LLC",
  mcNumber: "MC-884213",
  driverName: "Marcus Reyes",
  carrierPayout: { kind: "transfer", label: "Swift Lane Trucking · verified payout", address: "swiftlane-trucking.near" },
  useLumper: true,
  lumper: { kind: "transfer", label: "Capstone Lumper Services", address: "capstone-lumper.near" },
  brokerRefund: { kind: "transfer", label: "Broker treasury", address: "acme-brokerage.near" },
  linehaulUsd: 2500,
  accessorialReserveUsd: 400,
  fuelAdvancePct: 30,
  freeHours: 2,
  ratePerHourUsd: 50,
  detentionCapUsd: 300,
  lumperCapUsd: 250,
  geofenceMeters: 1500,
  deliveryWindowHours: 72,
});

export default function NewLoad() {
  const router = useRouter();
  const [status, setStatus] = useState<StatusT | null>(null);
  const [form, setForm] = useState<Form>(() => simulatedDefaults());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<StatusT>("/api/status").then((s) => {
      if (cancelled) return;
      setStatus(s);
      const defaults = simulatedDefaults(true);
      // Live payouts require accounts supplied by the broker.
      setForm(s.mode === "live" ? {
        ...defaults,
        carrierPayout: { ...defaults.carrierPayout, address: "" },
        brokerRefund: { ...defaults.brokerRefund, address: "" },
        lumper: { ...defaults.lumper, address: "" },
        useLumper: false,
      } : defaults);
    }).catch(() => { if (!cancelled) setError("Couldn’t check the wallet connection. Reload this page to try again."); });
    return () => { cancelled = true; };
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const total = form.linehaulUsd + form.accessorialReserveUsd;
  const scale = status?.settlementScale ?? 0.001;
  const live = status?.mode === "live";

  function buildRateCon(): RateCon {
    const pickup = STOP_PRESETS[form.pickupIdx];
    const delivery = STOP_PRESETS[form.deliveryIdx];
    return {
      loadNumber: form.loadNumber,
      equipment: form.equipment,
      commodity: form.commodity,
      pickup: { ...pickup, appointment: new Date(form.pickupAppt).toISOString() },
      delivery: { ...delivery, appointment: new Date(form.deliveryAppt).toISOString() },
      carrier: { name: form.carrierName, mcNumber: form.mcNumber, driverName: form.driverName, payout: form.carrierPayout },
      lumperService: form.useLumper ? form.lumper : null,
      brokerRefund: form.brokerRefund,
      linehaulUsd: form.linehaulUsd,
      accessorialReserveUsd: form.accessorialReserveUsd,
      fuelAdvancePct: form.fuelAdvancePct,
      detention: { freeHours: form.freeHours, ratePerHourUsd: form.ratePerHourUsd, capUsd: form.detentionCapUsd },
      lumperCapUsd: form.lumperCapUsd,
      geofenceMeters: form.geofenceMeters,
      deliveryWindowHours: form.deliveryWindowHours,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { id } = await postJson<{ id: string }>("/api/loads", buildRateCon());
      router.push(`/loads/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main id="main-content" className="booking-heading mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Link href="/" className="text-sm text-muted hover:text-ink">
          ← Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">Book a load</h1>
        <p className="mt-1 text-sm text-muted">The rate confirmation becomes the wallet&apos;s policy and the agent&apos;s rulebook.</p>

        <form onSubmit={submit} className="booking-form mt-8 grid gap-8 xl:grid-cols-[1fr_340px]">
          <fieldset disabled={!status || submitting} className="min-w-0 space-y-8">
            <Section title="Load">
              <div className="grid gap-3 sm:grid-cols-3">
                <Text label="Load number" value={form.loadNumber} onChange={(v) => set("loadNumber", v)} />
                <Text label="Equipment" value={form.equipment} onChange={(v) => set("equipment", v)} />
                <Text label="Commodity" value={form.commodity} onChange={(v) => set("commodity", v)} />
              </div>
            </Section>

            <Section title="Lane">
              <div className="grid gap-3 sm:grid-cols-2">
                <StopPicker label="Pickup" idx={form.pickupIdx} onIdx={(i) => set("pickupIdx", i)} appt={form.pickupAppt} onAppt={(v) => set("pickupAppt", v)} />
                <StopPicker label="Delivery" idx={form.deliveryIdx} onIdx={(i) => set("deliveryIdx", i)} appt={form.deliveryAppt} onAppt={(v) => set("deliveryAppt", v)} />
              </div>
            </Section>

            <Section title="Carrier" note="Payouts can only ever go to this verified account.">
              <div className="grid gap-3 sm:grid-cols-3">
                <Text label="Carrier" value={form.carrierName} onChange={(v) => set("carrierName", v)} />
                <Text label="MC number" value={form.mcNumber} onChange={(v) => set("mcNumber", v)} />
                <Text label="Driver" value={form.driverName} onChange={(v) => set("driverName", v)} />
              </div>
              <DestinationInput value={form.carrierPayout} onChange={(v) => set("carrierPayout", v)} live={live} />
            </Section>

            <Section title="Other allowed destinations">
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-sm font-medium">Broker refund address</div>
                  <DestinationInput value={form.brokerRefund} onChange={(v) => set("brokerRefund", v)} live={live} />
                </div>
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={form.useLumper} onChange={(e) => set("useLumper", e.target.checked)} />
                    Approved lumper service at the receiver
                  </label>
                  {form.useLumper && <DestinationInput value={form.lumper} onChange={(v) => set("lumper", v)} live={live} />}
                </div>
              </div>
            </Section>

            <Section title="Money terms">
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <Num label="Linehaul ($)" value={form.linehaulUsd} onChange={(v) => set("linehaulUsd", v)} />
                <Num label="Accessorial reserve ($)" value={form.accessorialReserveUsd} onChange={(v) => set("accessorialReserveUsd", v)} />
                <Num label="Fuel advance (%)" value={form.fuelAdvancePct} onChange={(v) => set("fuelAdvancePct", v)} />
                <Num label="Geofence radius (m)" value={form.geofenceMeters} onChange={(v) => set("geofenceMeters", v)} />
                <Num label="Detention free hours" value={form.freeHours} onChange={(v) => set("freeHours", v)} step={0.5} />
                <Num label="Detention $/hour" value={form.ratePerHourUsd} onChange={(v) => set("ratePerHourUsd", v)} />
                <Num label="Detention cap ($)" value={form.detentionCapUsd} onChange={(v) => set("detentionCapUsd", v)} />
                <Num label="Lumper cap ($)" value={form.lumperCapUsd} onChange={(v) => set("lumperCapUsd", v)} />
              </div>
            </Section>
          </fieldset>

          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <div className="card booking-summary p-5">
              <h2 className="flex items-center gap-2 font-medium"><ShieldCheck size={18} aria-hidden="true" />Wallet funding</h2>
              <div className="num mt-2 text-3xl font-medium tracking-tight">{usd(total)}</div>
              <div className="mt-1 text-sm text-muted">
                {usd(form.linehaulUsd)} linehaul + {usd(form.accessorialReserveUsd)} reserve
              </div>
              <div className="mt-3 rounded-lg bg-panel-2 px-3 py-2 text-xs text-muted">
                Settles on-chain as <span className="num font-medium text-ink">{(total * scale).toFixed(2)} {status?.assetSymbol ?? "USDC"}</span>
                {scale !== 1 && <> (demo scale 1:{Math.round(1 / scale).toLocaleString()})</>}
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                <Rule label="Fuel advance at pickup" value={usd((form.linehaulUsd * form.fuelAdvancePct) / 100)} />
                <Rule label="Detention after free time" value={`$${form.ratePerHourUsd}/h · max ${usd(form.detentionCapUsd)}`} />
                {form.useLumper && <Rule label="Lumper, paid to service" value={`max ${usd(form.lumperCapUsd)}`} />}
                <Rule label="Final on verified POD" value={usd(form.linehaulUsd - (form.linehaulUsd * form.fuelAdvancePct) / 100)} />
                <Rule label="Leftover reserve" value="back to broker" />
              </ul>
              <ErrorNote message={error} />
              <Button variant="primary" type="submit" className="mt-6 w-full" loading={submitting} disabled={!status}>
                {submitting ? "Creating wallet…" : !status ? "Checking connection…" : "Book load & create wallet"}
              </Button>
              <p className="mt-3 text-xs text-muted">
                {live
                  ? "Live: the broker key signs the policy and the agent's grant, then you fund a real deposit address on mainnet."
                  : "Simulated: no API key is set, so the wallet and its policy checks run locally."}
              </p>
            </div>
          </aside>
        </form>
      </main>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-medium">{title}</h2>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="num text-right font-medium">{value}</span>
    </li>
  );
}

function Text({ label, value, onChange, placeholder, required = true }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field" value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field num" type="number" min={0} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function StopPicker({ label, idx, onIdx, appt, onAppt }: { label: string; idx: number; onIdx: (i: number) => void; appt: string; onAppt: (v: string) => void }) {
  const stop = STOP_PRESETS[idx];
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-xs text-muted mb-2">{label}</div>
      <select className="field" value={idx} onChange={(e) => onIdx(Number(e.target.value))}>
        {STOP_PRESETS.map((s, i) => (
          <option key={s.name} value={i}>
            {s.name}
          </option>
        ))}
      </select>
      <div className="mt-1.5 text-xs text-muted">{stop.address}</div>
      <label className="mt-3 block">
        <span className="label">Appointment</span>
        <input className="field" type="datetime-local" value={appt} onChange={(e) => onAppt(e.target.value)} required />
      </label>
    </div>
  );
}

function DestinationInput({ value, onChange, live }: { value: PayoutDestination; onChange: (v: PayoutDestination) => void; live: boolean }) {
  return (
    <div className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[150px_1fr_1fr]">
      <label className="block">
        <span className="label">Paid by</span>
        <select
          className="field"
          value={value.kind}
          onChange={(e) =>
            onChange(
              e.target.value === "transfer"
                ? { kind: "transfer", label: value.label, address: value.address }
                : { kind: "withdraw", label: value.label, address: value.address, chain: "base", memo: null },
            )
          }
        >
          <option value="transfer">Intents transfer</option>
          <option value="withdraw">Chain withdrawal</option>
        </select>
      </label>
      <Text label="Label" value={value.label} onChange={(label) => onChange({ ...value, label })} />
      <div className="flex gap-2">
        {value.kind === "withdraw" && (
          <label className="block w-28 shrink-0">
            <span className="label">Chain</span>
            <select className="field" value={value.chain} onChange={(e) => onChange({ ...value, chain: e.target.value })}>
              {CHAINS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="min-w-0 flex-1">
          <Text
            label={value.kind === "transfer" ? "NEAR Intents account" : "Address"}
            value={value.address}
            placeholder={live ? (value.kind === "transfer" ? "your-account.near" : "0x… you control") : undefined}
            onChange={(address) => onChange({ ...value, address })}
          />
        </div>
      </div>
    </div>
  );
}
