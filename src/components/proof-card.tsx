"use client";

import { useState } from "react";
import type { LoadDetailT } from "@/lib/api-types";
import { clock } from "@/lib/client";
import { formatDistance } from "@/lib/geo";
import type { RateCon } from "@/lib/types";
import { MapEmbed, Pill } from "./ui";

type ProofT = LoadDetailT["proofs"][number];

const KIND_LABEL: Record<string, string> = {
  pickup_checkin: "Pickup check-in",
  delivery_arrive: "Arrived at receiver",
  delivery_depart: "Unloading finished",
  lumper_receipt: "Lumper receipt",
  pod: "Proof of delivery",
};

export function ProofCard({
  loadId,
  proof,
  rateCon,
  busy,
  onReview,
}: {
  loadId: string;
  proof: ProofT;
  rateCon: RateCon;
  busy: string | null;
  onReview: (decision: "approve" | "reject", note: string) => void;
}) {
  const [open, setOpen] = useState(proof.kind === "pod" || proof.kind === "lumper_receipt");
  const [note, setNote] = useState("");
  const v = proof.verdict;
  const file = (name: string) => `/api/files/${loadId}/${name}`;
  const needsReview = proof.kind === "pod" && v && v.decision !== "approve" && !v.reviewedBy;
  const data = proof.data as Record<string, unknown>;

  return (
    <article className="px-5 py-4">
      <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="font-medium">{KIND_LABEL[proof.kind] ?? proof.kind}</span>
        {v && (
          <Pill tone={v.decision === "approve" ? "money" : v.decision === "reject" ? "danger" : "warn"}>
            {v.decision === "approve" ? "verified" : v.decision === "reject" ? "rejected" : "needs review"}
            {v.reviewedBy ? " by broker" : ""}
          </Pill>
        )}
        {!v && <Pill tone="info">verifying…</Pill>}
        {proof.simulatedLocation && <Pill>demo GPS</Pill>}
        <span className="ml-auto text-xs text-muted">
          {proof.distanceM !== null && `${formatDistance(proof.distanceM)} from stop · `}
          {clock(proof.createdAt)}
        </span>
      </button>
      {v && <p className="mt-1.5 text-sm text-muted">{v.summary}</p>}

      {open && (
        <div className="mt-3 space-y-4">
          {(proof.files.photo || proof.files.signature || proof.files.video) && (
            <div className="grid gap-3 sm:grid-cols-3">
              {proof.files.photo && (
                <Media label={proof.kind === "pod" ? "Signed BOL" : "Receipt"}>
                  <a href={file(proof.files.photo)} target="_blank" rel="noreferrer">
                    <img src={file(proof.files.photo)} alt="" className="h-40 w-full rounded-lg border border-line object-cover" />
                  </a>
                </Media>
              )}
              {proof.files.signature && (
                <Media label={`Receiver signature${data.receiverName ? ` · ${data.receiverName}` : ""}`}>
                  <img src={file(proof.files.signature)} alt="" className="h-40 w-full rounded-lg border border-line bg-white object-contain" />
                </Media>
              )}
              {proof.files.video && (
                <Media label="Unload video">
                  <video src={file(proof.files.video)} controls playsInline className="h-40 w-full rounded-lg border border-line bg-black object-contain" />
                </Media>
              )}
            </div>
          )}
          {proof.files.frames && proof.files.frames.length > 0 && (
            <Media label="Frames the agent analysed">
              <div className="flex gap-2 overflow-x-auto">
                {proof.files.frames.map((f) => (
                  <img key={f} src={file(f)} alt="" className="h-20 rounded-md border border-line" />
                ))}
              </div>
            </Media>
          )}

          {proof.kind === "delivery_depart" && typeof data.dwellHours === "number" && (
            <p className="text-sm">
              Dwell at receiver: <span className="num font-medium">{data.dwellHours.toFixed(1)} h</span>
              {data.dwellSimulated ? <span className="text-muted"> (demo clock; real elapsed {Number(data.actualDwellHours).toFixed(2)} h)</span> : null}
            </p>
          )}
          {proof.kind === "lumper_receipt" && typeof data.claimedUsd === "number" && (
            <p className="text-sm">
              Claimed: <span className="num font-medium">${data.claimedUsd.toFixed(2)}</span> · cap ${rateCon.lumperCapUsd}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {v && (
              <div className="space-y-3">
                <Checks title="Rule checks" checks={v.checks} />
                {v.ai ? (
                  <Checks title={`AI review · ${v.ai.model} · ${Math.round(v.ai.confidence * 100)}% confident`} checks={v.ai.checks} />
                ) : (
                  v.aiSkippedReason && <p className="text-xs text-muted">AI review: {v.aiSkippedReason}</p>
                )}
              </div>
            )}
            {proof.lat !== null && proof.lng !== null && (
              <Media label={`Driver GPS · ${proof.lat.toFixed(4)}, ${proof.lng.toFixed(4)}`}>
                <MapEmbed lat={proof.lat} lng={proof.lng} height={170} />
              </Media>
            )}
          </div>

          {needsReview && (
            <div className="rounded-xl bg-warn-soft p-3">
              <div className="text-sm font-medium text-warn">The agent routed this POD to you</div>
              <p className="mt-0.5 text-xs text-muted">Approving releases the final payment through the same wallet policy.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input className="field max-w-xs flex-1" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn btn-primary" disabled={busy === "review"} onClick={() => onReview("approve", note)}>
                  Approve & pay
                </button>
                <button className="btn btn-danger" disabled={busy === "review"} onClick={() => onReview("reject", note)}>
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Media({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs text-muted">{label}</div>
      {children}
    </div>
  );
}

function Checks({ title, checks }: { title: string; checks: { name: string; passed: boolean; note: string }[] }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted">{title}</div>
      <ul className="space-y-1.5">
        {checks.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex gap-2 text-sm">
            <span className={`mt-0.5 shrink-0 ${c.passed ? "text-money" : "text-danger"}`}>{c.passed ? "✓" : "✕"}</span>
            <span>
              <span className="font-medium">{c.name}</span> <span className="text-muted">· {c.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
