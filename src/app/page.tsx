"use client";

import Link from "next/link";
import { ArrowRight, Plus, Truck } from "lucide-react";
import { AppShell, ErrorNote, LoadStatusPill, ScaleBadge } from "@/components/ui";
import type { CompanyLoadSummary } from "@/server/views";
import { timeAgo, usePolling } from "@/lib/client";
import { usd } from "@/lib/money";

export default function LoadsPage() {
  const { data, error } = usePolling<{ data: CompanyLoadSummary[] }>("/loads", 4000);
  const loads = data?.data ?? [];
  const attention = loads.filter((l) => l.needsAttention).length;

  return (
    <AppShell title="All loads">
      <div className="page-heading">
        <div>
          <h1>Loads</h1>
          <p>Each load gets its own Agent Connect wallet. Fund it, send the driver link, and the carrier is paid the moment delivery is proven.</p>
        </div>
        <Link href="/loads/new" className="btn btn-primary"><Plus size={18} aria-hidden="true" />New load</Link>
      </div>
      <ScaleBadge />
      <ErrorNote message={error?.status === 401 ? null : error?.message} />

      <section className="card loads-card">
        <div className="loads-heading">
          <div>
            <h2>All loads</h2>
            <p>{data ? `${loads.length} load${loads.length === 1 ? "" : "s"}${attention ? ` · ${attention} need${attention === 1 ? "s" : ""} you` : ""}` : "Loading…"}</p>
          </div>
          <span className="live-label"><span className="status-dot" />Live</span>
        </div>
        {data && loads.length === 0 ? (
          <div className="table-empty">
            <Truck size={28} aria-hidden="true" />
            <h3>No loads yet</h3>
            <p>Create a load to get a dedicated wallet, a deposit address and a driver link.</p>
            <Link href="/loads/new" className="btn btn-primary"><Plus size={18} aria-hidden="true" />New load</Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="loads-table">
              <thead>
                <tr>
                  <th>Load</th>
                  <th>Deliver to</th>
                  <th>Carrier</th>
                  <th className="amount-cell">Rate</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {loads.map((load) => (
                  <tr key={load.id} className={load.needsAttention ? "row-attention" : undefined}>
                    <td>
                      <Link href={`/loads/${load.id}`} className="load-reference">{load.number}</Link>
                      {load.mode === "simulated" && <small>simulated</small>}
                    </td>
                    <td><span className="carrier-name">{load.deliveryName}</span><small>{load.deliveryAddress}</small></td>
                    <td><span className="carrier-name">{load.carrierName}</span></td>
                    <td className="amount-cell num">{usd(load.rateUsd)}</td>
                    <td><LoadStatusPill status={load.status} /></td>
                    <td className="updated-cell">{timeAgo(load.updatedAt)}</td>
                    <td><Link href={`/loads/${load.id}`} className="row-open" aria-label={`Open ${load.number}`}><ArrowRight size={18} aria-hidden="true" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
