"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Clock3, MapPin, RotateCcw, Video } from "lucide-react";
import { Logo } from "@/components/ui";
import { ApiError, api, idempotencyKey, usePolling } from "@/lib/client";
import { distanceMeters, formatDistance } from "@/lib/geo";
import { compressImage, currentPosition, extractFrames } from "@/lib/media";
import { usd } from "@/lib/money";
import type { DriverView } from "@/server/views";

type Position = { lat: number; lng: number; accuracyM: number };
const PHASES = ["Uploading photo", "Checking location", "Reading your BOL", "Paying the carrier"] as const;

export default function DriverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, setData, error } = usePolling<DriverView>(`/driver/${token}`, 3000);

  if (!data)
    return (
      <Shell>
        <p className="driver-muted">{error?.status === 404 ? "This link isn't valid. Ask your dispatcher for a new one." : error ? error.message : "Loading your delivery…"}</p>
      </Shell>
    );

  return (
    <Shell number={data.number}>
      <section className="driver-trip">
        <div className="driver-amount num">{usd(data.amountUsd)}</div>
        <div className="driver-muted">for {data.carrierName}</div>
        <div className="driver-stop"><MapPin size={18} aria-hidden="true" /><div><strong>{data.delivery.name}</strong><span>{data.delivery.address}</span></div></div>
      </section>
      <Body data={data} token={token} onUpdate={setData} />
      <details className="driver-how">
        <summary>How payment works</summary>
        <p>Your dispatcher locked this load&apos;s payment in its own USDC wallet on NEAR Intents (Agent Connect) before you drove. When your photo and location check out, the wallet pays {data.carrierName}&apos;s registered account directly. It can&apos;t pay anyone else.</p>
      </details>
    </Shell>
  );
}

function Shell({ children, number }: { children: React.ReactNode; number?: string }) {
  return (
    <main className="driver-shell">
      <header className="driver-header"><Logo /><span>LoadWallet</span>{number && <span className="driver-ref">{number}</span>}</header>
      {children}
    </main>
  );
}

function Body({ data, token, onUpdate }: { data: DriverView; token: string; onUpdate: (d: DriverView) => void }) {
  switch (data.state) {
    case "not_ready":
      return <Notice icon={<Clock3 size={28} aria-hidden="true" />} title="Not funded yet" text="Your dispatcher hasn't locked the payment for this load yet. Keep this link; it will be ready when they do." />;
    case "verifying":
    case "paying":
      return <Notice icon={<span className="driver-spinner" />} title={data.state === "paying" ? "Paying…" : "Checking your delivery…"} text="This takes a few seconds. You can keep this page open." />;
    case "review":
      return <Notice icon={<Clock3 size={28} aria-hidden="true" />} title="Sent to your dispatcher" text="They're taking a quick look at your photo. You'll see Paid here as soon as they approve." />;
    case "paid":
      return (
        <section className="driver-paid" role="status">
          <span className="driver-paid-check"><Check size={36} aria-hidden="true" /></span>
          <h1>Paid {usd(data.payment?.amountUsd ?? data.amountUsd)}</h1>
          <p>to {data.carrierName} · {data.payment?.destinationHint}</p>
          {data.payment?.test && <p className="driver-muted">Test money: approved by the wallet, no real funds moved.</p>}
          {data.payment?.settledAt && <p className="driver-muted">{new Date(data.payment.settledAt).toLocaleString()}</p>}
        </section>
      );
    case "cancelled":
      return <Notice title="This load was cancelled" text="Your dispatcher cancelled it. Call them if that's a surprise." />;
    case "problem":
      return <Notice title="Your dispatcher needs to check something" text="Payment is paused. Call your dispatcher." />;
    default:
      return <Capture data={data} token={token} onUpdate={onUpdate} />;
  }
}

function Notice({ icon, title, text }: { icon?: React.ReactNode; title: string; text: string }) {
  return (
    <section className="driver-notice" role="status">
      {icon}
      <h1>{title}</h1>
      <p>{text}</p>
    </section>
  );
}

function Capture({ data, token, onUpdate }: { data: DriverView; token: string; onUpdate: (d: DriverView) => void }) {
  const [photo, setPhoto] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [phase, setPhase] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const [key] = useState(idempotencyKey);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function locate() {
    setGpsError(null);
    currentPosition().then(setPosition, (e: Error) => setGpsError(e.message));
  }

  function openCamera() {
    // Ask for location in the same tap, so the driver only answers one prompt.
    if (!position) locate();
    photoInput.current?.click();
  }

  async function submit() {
    if (!photo) return;
    setError(null);
    let pos = position;
    try {
      setPhase(0);
      if (!pos) {
        pos = await currentPosition();
        setPosition(pos);
      }
      const form = new FormData();
      form.set("lat", String(pos.lat));
      form.set("lng", String(pos.lng));
      form.set("accuracy_m", String(Math.round(pos.accuracyM)));
      form.set("photo", await compressImage(photo), "bol.jpg");
      if (video) {
        form.set("video", video, video.name || "unload.mp4");
        const frames = await extractFrames(video, 4).catch(() => []);
        frames.forEach((f, i) => form.set(`frame${i}`, f, `frame${i}.jpg`));
      }
      // Walk the progress labels while the agent works; the response decides the outcome.
      const timer = setInterval(() => setPhase((p) => (p === null ? 0 : Math.min(p + 1, PHASES.length - 1))), 2200);
      try {
        const result = await api<DriverView>(`/driver/${token}/proof`, { method: "POST", body: form, headers: { "idempotency-key": key } });
        onUpdate(result);
        if (result.state === "retry") {
          setPhoto(null);
          setVideo(null);
        }
      } finally {
        clearInterval(timer);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setPhase(null);
    }
  }

  const busy = phase !== null;

  return (
    <section className="driver-capture">
      {data.state === "retry" && data.message && <div className="driver-retry" role="alert">{data.message}</div>}

      {!photo ? (
        <>
          <button className="driver-primary" onClick={openCamera}>
            <Camera size={28} aria-hidden="true" />
            Take photo of signed BOL
          </button>
          <p className="driver-muted driver-center">At the dock, once you&apos;re unloaded. Make sure the signature is in the shot.</p>
        </>
      ) : (
        <>
          <figure className="driver-preview">
            {preview && <img src={preview} alt="Your BOL photo" />}
            <button className="driver-link" onClick={() => photoInput.current?.click()} disabled={busy}><RotateCcw size={16} aria-hidden="true" />Retake</button>
          </figure>

          <button className="driver-secondary" onClick={() => videoInput.current?.click()} disabled={busy}>
            <Video size={20} aria-hidden="true" />
            {video ? `Video added (${(video.size / 1024 / 1024).toFixed(1)} MB) · change` : "Add a 10-second unload video (optional)"}
          </button>

          <button className="driver-primary" onClick={submit} disabled={busy}>
            {busy ? <><span className="driver-spinner" />{PHASES[phase!]}…</> : <>Submit & get paid</>}
          </button>
        </>
      )}

      <p className="driver-gps">
        <MapPin size={14} aria-hidden="true" />
        {position
          ? `Location ready · ${formatDistance(distanceMeters(position, data.delivery))} from ${data.delivery.name}`
          : gpsError
            ? <span>{gpsError} <button className="driver-link-inline" onClick={locate}>Try again</button></span>
            : "We'll check your location when you take the photo."}
      </p>
      {error && <div className="driver-error" role="alert">{error}</div>}

      <input ref={photoInput} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto(f); e.target.value = ""; }} />
      <input ref={videoInput} type="file" accept="video/*" capture="environment" className="sr-only" onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        if (f.size > 30 * 1024 * 1024) setError("That video is over 30 MB. Record 10 seconds or less.");
        else setVideo(f);
      }} />
    </section>
  );
}

