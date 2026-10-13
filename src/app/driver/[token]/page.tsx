"use client";

import { use, useRef, useState } from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/signature-pad";
import { ErrorNote, Logo, PayoutStatusPill, Pill } from "@/components/ui";
import type { DriverViewT } from "@/lib/api-types";
import { api, clock, usePolling } from "@/lib/client";
import { formatDistance, nearby } from "@/lib/geo";
import { compressImage, currentPosition, extractFrames } from "@/lib/media";
import { usd } from "@/lib/money";
import { PAYOUT_LABELS } from "@/lib/types";

type StepKey = "pickup_checkin" | "delivery_arrive" | "delivery_depart" | "lumper" | "pod";

export default function DriverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, setData, error } = usePolling<DriverViewT>(`/api/driver/${token}`, 4000);
  const [demoGps, setDemoGps] = useState(true);
  const [busy, setBusy] = useState<StepKey | null>(null);
  const [stepError, setStepError] = useState<{ step: StepKey; message: string } | null>(null);
  const [dwell, setDwell] = useState(3.5);

  if (!data)
    return (
      <Shell>
        <p className="py-16 text-center text-sm text-muted">{error ?? "Loading your load…"}</p>
      </Shell>
    );

  const rc = data.rateCon;
  const proofs = data.proofs;
  const lastOf = (kind: string) => [...proofs].reverse().find((p) => p.kind === kind);
  const passed = (kind: string) => proofs.some((p) => p.kind === kind && p.decision === "approve");
  const paidToMe = data.payouts.filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amountUsd, 0);

  async function where(stop: "pickup" | "delivery") {
    if (demoGps) return { ...nearby(stop === "pickup" ? rc.pickup : rc.delivery), simulated: true };
    return { ...(await currentPosition()), simulated: false };
  }

  async function submit(step: StepKey, build: (form: FormData) => Promise<void>) {
    setBusy(step);
    setStepError(null);
    try {
      const form = new FormData();
      form.set("action", step);
      await build(form);
      setData(await api<DriverViewT>(`/api/driver/${token}`, { method: "POST", body: form }));
    } catch (e) {
      setStepError({ step, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const checkin = (step: "pickup_checkin" | "delivery_arrive" | "delivery_depart") =>
    submit(step, async (form) => {
      const pos = await where(step === "pickup_checkin" ? "pickup" : "delivery");
      form.set("lat", String(pos.lat));
      form.set("lng", String(pos.lng));
      form.set("simulated", String(pos.simulated));
      if (step === "delivery_depart" && demoGps) form.set("dwellHours", String(dwell));
    });

  const errFor = (step: StepKey) => (stepError?.step === step ? stepError.message : null);

  return (
    <Shell refLabel={data.ref}>
      <section className={`rounded-2xl p-4 ${data.funded ? "bg-money-soft" : "bg-warn-soft"}`}>
        <div className={`text-sm font-medium ${data.funded ? "text-money" : "text-warn"}`}>
          {data.funded ? "Money for this load is locked in its wallet" : "Waiting for the broker to fund this load"}
        </div>
        <div className="mt-1 text-sm">
          {rc.pickup.name} → {rc.delivery.name}
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {rc.commodity} · {rc.carrierName}
        </div>
      </section>

      <section className="card mt-4 p-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs text-muted">Paid to you so far</div>
            <div className="num mt-1 text-3xl font-medium text-money">{usd(paidToMe)}</div>
          </div>
          <div className="text-right text-xs text-muted">
            of {usd(rc.linehaulUsd)} linehaul
            <br />+ detention if you wait
          </div>
        </div>
        {data.payouts.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-line pt-3">
            {[...data.payouts].reverse().map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {PAYOUT_LABELS[p.kind as keyof typeof PAYOUT_LABELS]}
                  <span className="block text-xs text-muted">
                    {p.destination} · {clock(p.createdAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="num font-medium">{usd(p.amountUsd)}</span>
                  <PayoutStatusPill status={p.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <label className="mt-4 flex items-start gap-3 rounded-xl border border-line bg-panel p-3 text-sm">
        <input type="checkbox" className="mt-0.5" checked={demoGps} onChange={(e) => setDemoGps(e.target.checked)} />
        <span>
          <span className="font-medium">Demo GPS</span>
          <span className="block text-xs text-muted">Places you at each stop. Turn off to send your phone&apos;s real location (it will fail the geofence unless you are there).</span>
        </span>
      </label>

      <ol className="mt-4 space-y-3">
        <Step
          n={1}
          title={`Check in at pickup`}
          sub={`${rc.pickup.name} · releases ${rc.fuelAdvancePct}% fuel advance (${usd((rc.linehaulUsd * rc.fuelAdvancePct) / 100)})`}
          done={passed("pickup_checkin")}
          proof={lastOf("pickup_checkin")}
          locked={!data.funded}
        >
          <button className="btn btn-primary w-full" disabled={busy !== null || !data.funded} onClick={() => checkin("pickup_checkin")}>
            {busy === "pickup_checkin" ? "Checking location…" : "I'm at pickup"}
          </button>
          <ErrorNote message={errFor("pickup_checkin")} />
        </Step>

        <Step
          n={2}
          title="Arrived at receiver"
          sub={`${rc.delivery.name} · starts the detention clock (${rc.detention.freeHours} h free)`}
          done={passed("delivery_arrive")}
          proof={lastOf("delivery_arrive")}
          locked={!passed("pickup_checkin")}
        >
          <button className="btn btn-primary w-full" disabled={busy !== null} onClick={() => checkin("delivery_arrive")}>
            {busy === "delivery_arrive" ? "Checking location…" : "I'm at the receiver"}
          </button>
          <ErrorNote message={errFor("delivery_arrive")} />
        </Step>

        <Step
          n={3}
          title="Unloading finished"
          sub={`Detention $${rc.detention.ratePerHourUsd}/h after ${rc.detention.freeHours} h, up to ${usd(rc.detention.capUsd)}`}
          done={passed("delivery_depart")}
          proof={lastOf("delivery_depart")}
          locked={!passed("delivery_arrive")}
        >
          {demoGps && (
            <label className="block">
              <span className="label">Demo clock: hours at the dock</span>
              <input className="field num" type="number" step={0.5} min={0} max={24} value={dwell} onChange={(e) => setDwell(Number(e.target.value))} />
            </label>
          )}
          <button className="btn btn-primary w-full" disabled={busy !== null} onClick={() => checkin("delivery_depart")}>
            {busy === "delivery_depart" ? "Calculating detention…" : "Unloading is done"}
          </button>
          <ErrorNote message={errFor("delivery_depart")} />
        </Step>

        {rc.hasLumper && (
          <LumperStep
            busy={busy}
            locked={!passed("delivery_arrive")}
            cap={rc.lumperCapUsd}
            proof={lastOf("lumper_receipt")}
            error={errFor("lumper")}
            onSubmit={(amount, photo) =>
              submit("lumper", async (form) => {
                form.set("amountUsd", String(amount));
                if (photo) form.set("photo", await compressImage(photo), "receipt.jpg");
                const pos = await where("delivery");
                form.set("lat", String(pos.lat));
                form.set("lng", String(pos.lng));
                form.set("simulated", String(pos.simulated));
              })
            }
          />
        )}

        <PodStep
          busy={busy}
          locked={!passed("delivery_arrive")}
          done={passed("pod")}
          proof={lastOf("pod")}
          error={errFor("pod")}
          finalUsd={rc.linehaulUsd - data.ledger.fuel}
          onSubmit={(input) =>
            submit("pod", async (form) => {
              form.set("receiverName", input.receiverName);
              form.set("photo", await compressImage(input.photo), "pod.jpg");
              form.set("signature", input.signature, "signature.png");
              form.set("video", input.video, input.video.name || "video.mp4");
              const frames = await extractFrames(input.video, 4);
              frames.forEach((f, i) => form.set(`frame${i}`, f, `frame${i}.jpg`));
              const pos = await where("delivery");
              form.set("lat", String(pos.lat));
              form.set("lng", String(pos.lng));
              form.set("simulated", String(pos.simulated));
            })
          }
        />
      </ol>
      <p className="mt-6 pb-8 text-center text-xs text-muted">
        Payouts go only to {rc.payoutLabel}. Nobody can change that account by email or phone.
      </p>
    </Shell>
  );
}

function Shell({ children, refLabel }: { children: React.ReactNode; refLabel?: string }) {
  return (
    <div className="driver-page mx-auto w-full max-w-md flex-1 px-4">
      <header className="flex items-center gap-2 py-4">
        <Logo />
        <span className="font-medium">LoadWallet Driver</span>
        {refLabel && <span className="ml-auto font-mono text-sm text-muted">{refLabel}</span>}
      </header>
      {children}
    </div>
  );
}

type ProofT = DriverViewT["proofs"][number] | undefined;

function Step({ n, title, sub, done, proof, locked, children }: { n: number; title: string; sub: string; done: boolean; proof: ProofT; locked?: boolean; children?: React.ReactNode }) {
  return (
    <li className={`card p-4 ${locked && !done ? "opacity-60" : ""}`}>
      <div className="flex gap-3">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${done ? "bg-money text-white" : "bg-panel-2 text-muted"}`}>
          {done ? "✓" : n}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted">{sub}</div>
          {proof && <ProofResult proof={proof} />}
          {!done && !locked && <div className="mt-3 space-y-2">{children}</div>}
        </div>
      </div>
    </li>
  );
}

function ProofResult({ proof }: { proof: NonNullable<ProofT> }) {
  const tone = proof.decision === "approve" ? "money" : proof.decision === "reject" ? "danger" : proof.decision ? "warn" : "info";
  return (
    <div className="mt-2 rounded-lg bg-panel-2 px-2.5 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Pill tone={tone}>{proof.decision === "approve" ? "verified" : proof.decision === "reject" ? "rejected" : proof.decision ? "sent to broker" : "verifying"}</Pill>
        {proof.distanceM !== null && <span className="text-muted">{formatDistance(proof.distanceM)} from stop</span>}
      </div>
      {proof.summary && <p className="mt-1 text-muted">{proof.summary}</p>}
    </div>
  );
}

function LumperStep({ busy, locked, cap, proof, error, onSubmit }: { busy: StepKey | null; locked: boolean; cap: number; proof: ProofT; error: string | null; onSubmit: (amount: number, photo: File | null) => void }) {
  const [amount, setAmount] = useState(180);
  const [photo, setPhoto] = useState<File | null>(null);
  return (
    <Step n={4} title="Lumper receipt (if any)" sub={`Paid straight to the lumper service, up to ${usd(cap)}`} done={proof?.decision === "approve"} proof={proof} locked={locked}>
      <label className="block">
        <span className="label">Amount on receipt ($)</span>
        <input className="field num" type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </label>
      <FilePick label="Photo of the receipt" accept="image/*" file={photo} onFile={setPhoto} />
      <button className="btn w-full" disabled={busy !== null || !photo} onClick={() => onSubmit(amount, photo)}>
        {busy === "lumper" ? "Verifying receipt…" : "Submit lumper receipt"}
      </button>
      <ErrorNote message={error} />
    </Step>
  );
}

function PodStep({
  busy,
  locked,
  done,
  proof,
  error,
  finalUsd,
  onSubmit,
}: {
  busy: StepKey | null;
  locked: boolean;
  done: boolean;
  proof: ProofT;
  error: string | null;
  finalUsd: number;
  onSubmit: (input: { receiverName: string; photo: File; signature: Blob; video: File }) => void;
}) {
  const sig = useRef<SignaturePadHandle>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [signed, setSigned] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const ready = photo && video && signed && receiverName.trim().length > 1;
  const waitingOnBroker = proof && proof.decision && proof.decision !== "approve";

  return (
    <Step n={5} title="Proof of delivery" sub={`Signed BOL photo, receiver signature, unload video · releases ${usd(finalUsd)}`} done={done} proof={proof} locked={locked}>
      {waitingOnBroker && <p className="text-xs text-warn">The agent sent your last POD to the broker. You can upload a clearer one below.</p>}
      <FilePick label="Photo of the signed BOL" accept="image/*" file={photo} onFile={setPhoto} />
      <FilePick label="Short video of the unloaded trailer (under 30 s)" accept="video/*" file={video} onFile={(f) => {
        setLocalError(f && f.size > 45 * 1024 * 1024 ? "That video is over 45 MB. Record a shorter clip." : null);
        setVideo(f && f.size <= 45 * 1024 * 1024 ? f : null);
      }} />
      <label className="block">
        <span className="label">Receiver name</span>
        <input className="field" value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="Printed name of the person signing" />
      </label>
      <SignaturePad ref={sig} onChange={(empty) => setSigned(!empty)} />
      <button
        className="btn btn-primary w-full"
        disabled={busy !== null || !ready}
        onClick={async () => {
          const signature = await sig.current?.toBlob();
          if (!signature || !photo || !video) return;
          onSubmit({ receiverName, photo, signature, video });
        }}
      >
        {busy === "pod" ? "Agent is verifying your POD…" : "Submit POD & get paid"}
      </button>
      <ErrorNote message={localError ?? error} />
    </Step>
  );
}

function FilePick({ label, accept, capture, file, onFile }: { label: string; accept: string; capture?: "environment" | "user"; file: File | null; onFile: (f: File | null) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-panel-2 px-3 py-2.5 text-sm">
        <span className="btn px-2.5 py-1 text-xs">{file ? "Replace" : "Choose"}</span>
        <span className="truncate text-muted">{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "Camera or library"}</span>
      </span>
      <input type="file" className="sr-only" accept={accept} capture={capture} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}
