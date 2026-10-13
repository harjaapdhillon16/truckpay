"use client";

import type { LoadDetailT } from "@/lib/api-types";
import { clock } from "@/lib/client";

const ACTOR_STYLE: Record<string, { label: string; dot: string }> = {
  broker: { label: "Broker", dot: "bg-accent" },
  driver: { label: "Driver", dot: "bg-warn" },
  agent: { label: "Agent", dot: "bg-ink" },
  wallet: { label: "Wallet", dot: "bg-money" },
  system: { label: "System", dot: "bg-muted" },
};

export function Timeline({ events }: { events: LoadDetailT["events"] }) {
  return (
    <section className="card">
      <div className="border-b border-line px-5 py-3">
        <h2 className="font-medium">Timeline</h2>
      </div>
      <ol className="px-5 py-4">
        {[...events].reverse().map((e, i) => {
          const style = ACTOR_STYLE[e.actor] ?? ACTOR_STYLE.system;
          const tone = e.type === "payout_blocked" || e.type === "geofence_failed" || e.type === "spoofed_email" ? "text-danger" : e.type === "payout_settled" ? "text-money" : "";
          return (
            <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
              {i < events.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-line" />}
              <span className={`relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-panel ${style.dot}`} />
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${tone}`}>{e.title}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {style.label} · {clock(e.ts)}
                  {typeof e.detail.code === "string" && <span className="ml-1 font-mono">· {e.detail.code}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
