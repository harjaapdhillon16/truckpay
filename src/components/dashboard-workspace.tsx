"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleCheck, ClipboardCheck, Clock3, Fuel, MapPin, Plus, RefreshCw, ShieldCheck, Truck, Wallet } from "lucide-react";
import { AppHeader, LoadStatusPill } from "@/components/ui";
import { Button } from "@/components/arc/button/button";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { DonutChart } from "@/components/arc/donut-chart/donut-chart";
import { SearchField } from "@/components/arc/search-field/search-field";
import { LOAD_VIEWS, type DashboardView, type LoadFilter } from "@/lib/navigation";
import type { LoadsListT } from "@/lib/api-types";
import { timeAgo, usePolling } from "@/lib/client";
import { usd } from "@/lib/money";
import { STATUS_LABELS, totalCommittedUsd } from "@/lib/types";

const attentionStatuses = new Set(["awaiting_funding", "pod_review", "failed"]);
const doneStatuses = new Set(["delivered", "closed"]);

export function DashboardWorkspace({ view = "overview", filter = "all" }: { view?: DashboardView; filter?: LoadFilter }) {
  const { data, error, refresh } = usePolling<LoadsListT>("/api/loads", 4000);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const [exported, setExported] = useState(false);
  const loads = useMemo(() => data?.loads ?? [], [data]);
  const completed = loads.filter((load) => doneStatuses.has(load.status)).length;
  const attention = loads.filter((load) => attentionStatuses.has(load.status));
  const active = loads.filter((load) => !doneStatuses.has(load.status)).length;
  const committed = data?.stats.committed ?? 0;
  const paid = data?.stats.toCarriers ?? 0;
  const toLumpers = loads.reduce((sum, load) => sum + load.ledger.lumper, 0);
  const refunded = loads.reduce((sum, load) => sum + load.ledger.refund, 0);
  const matchingCount = filter === "active" ? active : filter === "paid" ? completed : filter === "attention" ? attention.length : loads.length;
  const heading = view === "payments" ? "Payments" : view === "review" ? "Review queue" : view === "loads" ? filter === "active" ? "Active loads" : filter === "paid" ? "Completed loads" : "All loads" : "Your operations, at a glance.";
  const description = view === "payments" ? "Follow funds from your load wallets to their approved destinations." : view === "review" ? "Resolve funding, delivery proof and wallet setup issues." : view === "loads" ? "Find your loads and follow their progress from booking to delivery." : "Track every load. Know where your money stands.";
  const visible = useMemo(() => {
    const term = query.toLowerCase().trim();
    return loads.filter((load) => {
      const matches = !term || [load.ref, load.rateCon.carrier.name, load.rateCon.pickup.address, load.rateCon.delivery.address, STATUS_LABELS[load.status]].some((value) => value.toLowerCase().includes(term));
      return matches && (filter === "all" || (filter === "active" && !doneStatuses.has(load.status)) || (filter === "paid" && doneStatuses.has(load.status)) || (filter === "attention" && attentionStatuses.has(load.status)));
    }).sort((a, b) => sort === "amount" ? totalCommittedUsd(b.rateCon) - totalCommittedUsd(a.rateCon) : sort === "reference" ? a.ref.localeCompare(b.ref) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [loads, query, filter, sort]);

  function exportLoads() {
    const rows = [["Load", "Pickup", "Delivery", "Carrier", "Status", "Committed USD", "Released USD"], ...visible.map((load) => [load.ref, load.rateCon.pickup.address, load.rateCon.delivery.address, load.rateCon.carrier.name, STATUS_LABELS[load.status], String(totalCommittedUsd(load.rateCon)), String(load.ledger.toCarrier + load.ledger.lumper)])];
    const csv = rows.map((row) => row.map((cell) => `"${(/^[=+@\-\t\r]/.test(cell) ? "'" : "") + cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a"); link.href = url; link.download = "loadwallet-loads.csv"; link.click(); URL.revokeObjectURL(url);
    setExported(true); setTimeout(() => setExported(false), 2000);
  }

  return (
    <>
      <AppHeader />
      <main id="main-content" className="dashboard-page">
        <div className="page-heading">
          <div><h1>{heading}</h1><p>{description}</p></div>
          <Link href="/loads/new" className="btn btn-primary"><Plus size={18} aria-hidden="true" />Book a load</Link>
        </div>

        <section className="metrics-grid" aria-label="Load and payment metrics" aria-busy={!data && !error}>
          {!data && !error ? Array.from({ length: 4 }, (_, i) => <div className="card metric-skeleton" key={i}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>) : <>
            {view === "payments" ? <>
              <MetricCard label="Held in wallets" value={committed} context="USD · Funded, awaiting release" />
              <MetricCard label="Paid to carriers" value={paid} context="USD · Fuel, detention and final" />
              <MetricCard label="Paid to services" value={toLumpers} context="USD · Verified lumper receipts" />
              <MetricCard label="Returned to broker" value={refunded} context="USD · Unused reserves refunded" />
            </> : view === "review" ? <>
              <MetricCard label="Needs attention" value={attention.length} context="Loads requiring your next step" />
              <MetricCard label="Awaiting funding" value={loads.filter(l => l.status === "awaiting_funding").length} context="Wallets ready for a deposit" />
              <MetricCard label="Delivery reviews" value={loads.filter(l => l.status === "pod_review").length} context="Proof awaiting broker review" />
              <MetricCard label="Wallet setup issues" value={loads.filter(l => l.status === "failed").length} context="Wallet creation needs a retry" />
            </> : <>
            <MetricCard label="Active loads" value={active} context={`${loads.length} total · ${completed} completed`} />
            <MetricCard label="Committed in wallets" value={committed} context="USD · Funded, awaiting release" />
            <MetricCard label="Paid to carriers" value={paid} context="USD · Fuel, detention and final" />
            <MetricCard label="Policy blocks" value={data?.stats.blocked ?? 0} context="Out-of-policy attempts refused" />
            </>}
          </>}
        </section>

        {error && <div className="error-banner" role="alert"><span>Couldn’t load your workspace. {error}</span><Button variant="secondary" onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />Try again</Button></div>}

        {(view === "overview" || view === "payments" || view === "review") && <div className={view === "overview" ? "overview-grid" : "dashboard-detail-grid"}>
          {view !== "review" && (
          <section className="card payment-overview" id="payments" aria-labelledby="payments-title">
            <div className="section-heading"><div><h2 id="payments-title">Payment overview</h2><p>A clear picture of your load funds.</p></div><Wallet size={20} className="text-muted" strokeWidth={1.75} aria-hidden="true" /></div>
            <DonutChart label="Load funds by destination" totalLabel="Tracked funds" size={184} thickness={16} formatValue={usd} legendAction="select" groupBelow={0} emptyLabel={data ? "No funds yet" : "Loading funds"} data={[
              { key: "wallets", label: "Held in wallets", value: committed, color: "var(--accent)" },
              { key: "carriers", label: "Paid to carriers", value: paid, color: "var(--success)" },
              { key: "lumpers", label: "Paid to services", value: toLumpers, color: "var(--series-2)" },
              { key: "refunds", label: "Returned to broker", value: refunded, color: "var(--text-muted)" },
            ]} />
            <div className="section-footnote"><ShieldCheck size={15} aria-hidden="true" /><span>Funds move only to policy-approved destinations.</span></div>
          </section>

          )}
          {view !== "payments" && (<section className="card attention-card" id="attention" aria-labelledby="attention-title">
            <div className="section-heading"><div><h2 id="attention-title">Needs your attention <span className="count-badge">{attention.length}</span></h2><p>Your next steps, all in one place.</p></div><ClipboardCheck size={20} className="text-muted" strokeWidth={1.75} aria-hidden="true" /></div>
            {!data && !error ? <div className="attention-loading"><span className="skeleton" /><span className="skeleton" /></div> : attention.length ? <div className="action-list">{(view === "review" ? attention : attention.slice(0, 3)).map((load) => <Link key={load.id} href={`/loads/${load.id}`} className="action-row"><span className={load.status === "failed" ? "text-danger" : "text-warn"}>{load.status === "awaiting_funding" ? <Wallet size={20} aria-hidden="true" /> : <ClipboardCheck size={20} aria-hidden="true" />}</span><span><span className="action-title">{load.status === "awaiting_funding" ? "Fund the load wallet" : load.status === "failed" ? "Retry wallet setup" : "Review delivery proof"}</span><small>{load.ref} · {load.rateCon.carrier.name}</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>)}</div> : <div className="all-clear"><CircleCheck size={28} strokeWidth={1.5} aria-hidden="true" /><div><h3>{error ? "Workspace unavailable" : "You’re all caught up"}</h3><p>{error ? "Retry to see loads needing attention." : "We’ll flag funding and proof reviews here."}</p></div></div>}
            {view === "overview" && <Link href="/review" className="section-text-link">View review queue<ArrowRight size={16} aria-hidden="true" /></Link>}
          </section>)}
        </div>}

        {view === "payments" && <PaymentActivity loads={loads} loading={!data && !error} />}

        {view !== "payments" && <section className="card loads-card" id="loads" aria-labelledby="loads-title">
          <div className="loads-heading"><div><h2 id="loads-title">{view === "review" ? "Loads needing attention" : view === "loads" ? heading : "Load activity"} <span className="count-badge">{matchingCount}</span></h2><p>From booking to the last dollar paid.</p></div><span className="live-label"><span className={error ? "status-dot status-offline" : "status-dot"} />{error ? "Connection interrupted" : data ? "Updates live" : "Connecting"}</span></div>
          <div className="loads-toolbar"><nav className="dashboard-tabs" aria-label="Load views">{LOAD_VIEWS.map(tab => <Link key={tab.href} href={tab.href} className="dashboard-tab" aria-current={view !== "overview" && filter === tab.filter ? "page" : undefined}>{tab.label}</Link>)}</nav><div className="toolbar-search"><SearchField label="Search loads" placeholder="Reference, carrier or city" value={query} onValueChange={setQuery} /></div></div>
          <div className="table-scroll" aria-busy={!data && !error}>
            <table className="loads-table"><caption className="sr-only">Loads, routes, carriers and payment progress</caption><thead><tr><th scope="col">Load reference</th><th scope="col">Route</th><th scope="col">Carrier</th><th scope="col">Status</th><th scope="col" className="amount-cell">Committed</th><th scope="col">Payment progress</th><th scope="col" className="amount-cell">Updated</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead><tbody>
              {!data && !error ? Array.from({ length: 3 }, (_, i) => <tr key={i} className="skeleton-row">{Array.from({ length: 8 }, (_, j) => <td key={j}><span className="skeleton" /></td>)}</tr>) : visible.map((load) => {
                const total = totalCommittedUsd(load.rateCon); const released = load.ledger.toCarrier + load.ledger.lumper; const pct = total > 0 ? Math.min(100, Math.max(0, released / total * 100)) : 0;
                return <tr key={load.id}><td><Link href={`/loads/${load.id}`} className="load-reference">{load.ref}</Link><small>{load.rateCon.equipment}{load.mode === "simulated" ? " · Demo" : ""}</small></td><td><div className="route-cell"><span><span className="route-dot" />{city(load.rateCon.pickup.address)}</span><span><MapPin size={12} aria-hidden="true" />{city(load.rateCon.delivery.address)}</span></div></td><td><span className="carrier-name" title={load.rateCon.carrier.name}>{load.rateCon.carrier.name}</span><small>{load.rateCon.carrier.mcNumber}</small></td><td><LoadStatusPill status={load.status} /></td><td className="amount-cell num">{usd(total)}</td><td><div className="payment-cell"><div><span className="num">{usd(released)}</span><span>{Math.round(pct)}%</span></div><div className="progress-track" role="progressbar" aria-label={`${load.ref} funds released`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div></div></td><td className="amount-cell updated-cell">{timeAgo(load.updatedAt)}</td><td><Link href={`/loads/${load.id}`} className="row-open" aria-label={`View ${load.ref}`}><ArrowUpRight size={18} aria-hidden="true" /></Link></td></tr>;
              })}
            </tbody></table>
          </div>
          {data && visible.length === 0 && <div className="table-empty"><Truck size={32} strokeWidth={1.5} aria-hidden="true" /><h3>{loads.length === 0 ? "Your next load starts here" : "No matching loads"}</h3><p>{loads.length === 0 ? "Book your first load to create a dedicated wallet and track every payment." : "Try a different reference, carrier or status."}</p>{loads.length === 0 ? <Link href="/loads/new" className="empty-link">Book your first load<ArrowRight size={16} aria-hidden="true" /></Link> : <div className="empty-actions">{query && <Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>}{filter !== "all" && <Link href="/loads" className="btn">View all loads</Link>}</div>}</div>}
          <div className="table-footer"><span aria-live="polite">Showing {visible.length} of {matchingCount} loads</span><div className="table-footer-actions"><label className="sort-label">Sort by <span><select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort loads"><option value="updated">Last updated</option><option value="amount">Highest amount</option><option value="reference">Load reference</option></select><ChevronDown size={14} aria-hidden="true" /></span></label><Button variant="ghost" onClick={exportLoads} disabled={!visible.length}>{exported ? <Check size={16} aria-hidden="true" /> : <ArrowDownToLine size={16} aria-hidden="true" />}{exported ? "Exported" : "Export CSV"}</Button></div></div>
        </section>}

        {view === "overview" && <section className="how-payments-work" aria-labelledby="flow-title"><div><h2 id="flow-title">Built for the road. Settled on delivery.</h2><p>One wallet per load. Every payment backed by proof.</p></div><div className="flow-stages"><span><Wallet size={18} aria-hidden="true" />Fund at booking</span><ArrowRight size={14} aria-hidden="true" /><span><Fuel size={18} aria-hidden="true" />Advance at pickup</span><ArrowRight size={14} aria-hidden="true" /><span><ShieldCheck size={18} aria-hidden="true" />Verify the delivery</span><ArrowRight size={14} aria-hidden="true" /><span><Clock3 size={18} aria-hidden="true" />Release payment</span></div></section>}
        <footer className="page-footer"><span>LoadWallet · Pay on delivery</span><span><ShieldCheck size={14} aria-hidden="true" />Wallet policy enforced</span></footer>
      </main>
    </>
  );
}

function city(address: string) {
  const parts = address.split(",").map((part) => part.trim());
  return parts.length >= 3 ? `${parts.at(-2)}, ${parts.at(-1)?.split(" ")[0]}` : address;
}

function PaymentActivity({ loads, loading }: { loads: LoadsListT["loads"]; loading: boolean }) {
  return (
    <section className="card loads-card" aria-labelledby="payment-activity-title">
      <div className="loads-heading"><div><h2 id="payment-activity-title">Payments by load</h2><p>Carrier payments, service fees and reserve refunds in USD.</p></div></div>
      <div className="table-scroll" aria-busy={loading}>
        <table className="loads-table"><caption className="sr-only">Payment totals grouped by load</caption>
          <thead><tr><th scope="col">Load reference</th><th scope="col">Carrier</th><th scope="col" className="amount-cell">Fuel advance</th><th scope="col" className="amount-cell">Detention</th><th scope="col" className="amount-cell">Final payment</th><th scope="col" className="amount-cell">Services</th><th scope="col" className="amount-cell">Refunded</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
          <tbody>{loading ? Array.from({ length: 3 }, (_, i) => <tr key={i} className="skeleton-row">{Array.from({ length: 8 }, (_, j) => <td key={j}><span className="skeleton" /></td>)}</tr>) : loads.map(load => <tr key={load.id}>
            <td><Link href={`/loads/${load.id}`} className="load-reference">{load.ref}</Link><small><LoadStatusPill status={load.status} /></small></td>
            <td><span className="carrier-name" title={load.rateCon.carrier.name}>{load.rateCon.carrier.name}</span></td>
            {[load.ledger.fuel, load.ledger.detention, load.ledger.final, load.ledger.lumper, load.ledger.refund].map((amount, index) => <td key={index} className="amount-cell num">{usd(amount)}</td>)}
            <td><Link href={`/loads/${load.id}`} className="row-open" aria-label={`View payments for ${load.ref}`}><ArrowUpRight size={18} aria-hidden="true" /></Link></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!loading && loads.length === 0 && <div className="table-empty"><Wallet size={32} strokeWidth={1.5} aria-hidden="true" /><h3>No payments yet</h3><p>Book and fund a load to start tracking its payments.</p><Link href="/loads/new" className="empty-link">Book a load<ArrowRight size={16} aria-hidden="true" /></Link></div>}
    </section>
  );
}
