"use client";

import type { Proof } from "@/lib/domain";
import { clock } from "@/lib/client";
import { formatDistance } from "@/lib/geo";
import { MapEmbed, Pill } from "./ui";

const STATUS: Record<Proof["status"], { label: string; tone: "info" | "money" | "warn" | "danger" }> = {
  verifying: { label: "Verifying", tone: "info" },
  approved: { label: "Verified", tone: "money" },
  needs_review: { label: "Needs your review", tone: "warn" },
  rejected: { label: "Rejected", tone: "danger" },
};

export function ProofView({ loadId, proof }: { loadId: string; proof: Proof }) {
  const file = (name: string) => `/api/v1/loads/${loadId}/files/${name}`;
  const v = proof.verdict;
  const s = STATUS[proof.status];
  return (
    <div className="proof-view">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={s.tone} dot>{s.label}</Pill>
        <span className="text-xs text-muted">
          Submitted {clock(proof.createdAt)} · {formatDistance(proof.distanceM)} from the stop{proof.accuracyM ? ` (GPS ±${Math.round(proof.accuracyM)} m)` : ""}
        </span>
      </div>
      {v && <p className="mt-2 text-sm">{v.summary}</p>}
      {proof.reviewNote && <p className="mt-1 text-sm text-muted">Company note: {proof.reviewNote}</p>}

      <div className="proof-media">
        {proof.files.photo && (
          <figure>
            <a href={file(proof.files.photo)} target="_blank" rel="noreferrer">
              <img src={file(proof.files.photo)} alt="Signed bill of lading submitted by the driver" />
            </a>
            <figcaption>Signed BOL</figcaption>
          </figure>
        )}
        {proof.files.video && (
          <figure>
            <video src={file(proof.files.video)} controls playsInline preload="metadata" />
            <figcaption>Unload video</figcaption>
          </figure>
        )}
        <figure>
          <MapEmbed lat={proof.lat} lng={proof.lng} height={176} />
          <figcaption>Driver GPS</figcaption>
        </figure>
      </div>

      {v && (
        <div className="proof-checks">
          <Checks title="Rule checks" checks={v.checks} />
          {v.ai ? (
            <Checks title={`AI review · ${v.ai.model} · ${Math.round(v.ai.confidence * 100)}% sure`} checks={v.ai.checks} />
          ) : (
            v.aiSkippedReason && <p className="text-xs text-muted">AI review: {v.aiSkippedReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Checks({ title, checks }: { title: string; checks: { name: string; passed: boolean; note: string }[] }) {
  if (!checks.length) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-muted">{title}</div>
      <ul className="space-y-1.5">
        {checks.map((c, i) => (
          <li key={`${c.name}-${i}`} className="flex gap-2 text-sm">
            <span className={c.passed ? "text-money" : "text-danger"} aria-label={c.passed ? "passed" : "failed"}>{c.passed ? "✓" : "✕"}</span>
            <span><span className="font-medium">{c.name}</span> <span className="text-muted">{c.note}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
