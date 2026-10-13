import Link from "next/link";
import { AppHeader } from "@/components/ui";

export const metadata = { title: "How it works · LoadWallet" };

export default function GuidePage() {
  return <><AppHeader /><main id="main-content" className="dashboard-page">
    <div className="page-heading"><div><h1>How it works</h1><p>One wallet per load. Every payment backed by proof.</p></div><Link href="/loads/new" className="btn btn-primary">Book a load</Link></div>
    <div className="guide-steps">
      <section className="card"><h2>1. Book and fund a load</h2><p>Enter the route, carrier, approved payout accounts and money terms. The rate confirmation becomes the wallet policy. Fund the wallet from the load detail page so the driver can begin.</p></section>
      <section className="card"><h2>2. Share the driver link</h2><p>Open the load details and copy the driver link. The driver uses it to check in at pickup and delivery. A verified pickup releases the agreed fuel advance.</p></section>
      <section className="card"><h2>3. Verify the work</h2><p>Arrival and departure check-ins establish dock wait time. The driver submits any lumper receipt and delivery proof: a signed BOL photo, receiver signature and unload video. Proof that needs your decision appears in the review queue.</p><Link href="/review" className="empty-link">Open review queue</Link></section>
      <section className="card"><h2>4. Settle and close</h2><p>Approved proof triggers payment to the policy-approved accounts. Track the totals on the payments page, then close the load to refund the unused reserve to the broker.</p><Link href="/payments" className="empty-link">View payments</Link></section>
      <section className="card"><h2>Try it in demo mode</h2><p>When no Agent Connect API key is configured, wallets and policy checks run locally. Fund a load with the simulated deposit button and use Demo GPS on the driver screen to walk through its stops.</p></section>
    </div>
  </main></>;
}
