# Spec: Delivery-proof payout demo on Agent Connect

Status: implemented and deployed (see Implementation Notes) · Owner: Prime Depth Labs · Date: 2026-10-14

This spec narrows LoadWallet to one demo: a company escrows a load's payment in an Agent Connect wallet, the driver proves delivery with one photo, and an agent verifies it and pays the carrier in seconds. It replaces the wider prototype (fuel advance, detention, lumper, reserve, dashboards), which is now out of scope.

Decisions were settled in a grilling session (two rounds) with the product owner. They are recorded under **Implementation Decisions**.

## Glossary

| Term | Meaning |
|---|---|
| **Company** | The broker running LoadWallet. It books loads, funds them and is the **owner** of every load wallet. |
| **Carrier** | The trucking company that gets paid. It has one verified **payout account**. |
| **Driver** | The person delivering the load. They use only the **driver link** and never log in. |
| **Load** | One shipment with a rate, a delivery stop, a carrier and a driver link. |
| **Load wallet** | One Agent Connect agent account per load, holding the load's rate in USDC under a **policy**. |
| **Owner** | Whoever signs a load wallet's policy and grants. Here it is the company, through a server-held EVM key ("company-as-owner"). |
| **Policy** | The rules Agent Connect enforces on a load wallet: asset, actions, allowed destinations, caps, budget. |
| **Grant** | A revocable credential (`ngt_…` token) that lets the **load agent** spend inside the policy. One per load wallet. |
| **Load agent** | The backend process that verifies proof and asks the wallet to pay. It holds a grant, never the owner key. |
| **Proof** | What the driver submits: a BOL photo, GPS and an optional short video. It produces a **verdict**. |
| **Verdict** | `approve`, `needs_review` or `reject`, built from rule checks plus the AI review. |
| **Payment** | The single payout of the load rate to the carrier. **Refund** is the reverse path to the company on cancel. |
| **Demo scale** | The factor between contract dollars and on-chain USDC (1:1000 means a $2,500 load settles as 2.50 USDC). |

## Problem Statement

Carriers wait 30–60 days to get paid for a delivered load because a person has to check the paperwork. Small carriers float fuel and payroll, or sell their invoices at a discount. Brokers who want to pay faster have to fund quick-pay from their own balance sheet and still check every proof of delivery by hand. Fraudsters exploit this with spoofed "our bank details changed" emails that redirect payments.

We also need to show NEAR, in a short video and a live link, that **Agent Connect** makes this safe to automate: an agent can release money on its own, without holding keys or prompting anyone to sign, because the wallet itself refuses anything outside the policy. The current prototype tells that story with too many moving parts. A viewer can't see the Agent Connect workflow for all the payout types, dashboards and simulation controls, and the driver flow has five steps where one would do.

## Solution

One load, one payment, one proof.

1. **Book.** The company enters a load: rate, delivery stop and the carrier's payout account. LoadWallet creates a dedicated Agent Connect wallet for it. The company key signs the wallet policy and a grant for the load agent, and the load page shows exactly what was signed.
2. **Fund.** The load page shows a deposit address (with QR code) for the exact USDC amount. When the deposit lands, the load shows **Funded**, and the carrier can see the money is committed before the truck moves.
3. **Deliver.** The driver opens a link from a text or QR code, with no login and no app. They take one photo of the signed BOL. GPS is captured automatically, and a 10-second unload video is optional. They tap **Submit**.
4. **Verify and pay.** The load agent checks the GPS against the delivery stop and has Claude read the BOL (and video frames). If everything matches, it asks the wallet to pay the carrier, and the driver sees **Paid** within seconds. If the agent is unsure, the proof goes to the company for one-tap Approve or Reject.
5. **Prove the guardrails.** On the load page, a **Fraud test** button makes the agent try to pay a "new bank account". Agent Connect refuses with `policy_destination_denied`, and the refusal shows on screen.
6. **Cancel.** If a load never delivers, the company can cancel it and the wallet refunds the company's account (the only other allowed destination).

The UI is a thin client over a small, documented REST API, so another agent harness (or a TMS) could drive the same flow. All Agent Connect calls happen in one server-side module. Browsers never see the partner API key, grant tokens or the owner key.

The app runs live on Agent Connect (mainnet, real USDC at demo scale) and is deployed on Cloudflare Workers.

## User Stories

### Company: setup and booking

1. As a company operator, I want to create a load with just the rate, delivery stop, carrier name and carrier payout account, so that booking takes under a minute.
2. As a company operator, I want the load number generated for me, so that I don't have to invent one.
3. As a company operator, I want to pick the delivery stop from a short preset list or use my current location, so that I can demo the flow from wherever I am and still pass a real GPS check.
4. As a company operator, I want our refund account to be preconfigured, so that I never type it per load and can't mistype it.
5. As a company operator, I want the carrier payout account validated before I submit (NEAR Intents account or Base address format), so that a typo can't lock money to a wrong destination.
6. As a company operator, I want to see the on-chain amount next to the contract amount (with a "Demo scale" badge), so that the demo stays honest about how much USDC moves.

### Company: the Agent Connect workflow, made visible

7. As a company operator, I want the load page to show a stepper (Wallet created → Funded → Proof → Paid), so that I always know what happens next.
8. As a company operator, I want to see that the wallet policy was signed by the company key, with Agent Connect's own summary of the policy, so that I trust what the agent is allowed to do.
9. As a company operator, I want the policy shown in plain words (USDC only, pay only the carrier or refund us, at most the load rate, at most N payouts per hour), so that a non-crypto viewer understands the guardrails.
10. As a company operator, I want to see that the load agent holds a grant and not our key, so that I know a compromised agent can't exceed the policy.
11. As a company operator, I want wallet setup progress (creating wallet, policy applying, grant issued) with plain status text, so that a slow on-chain step doesn't look like a hang.
12. As a company operator, I want wallet setup to resume by itself if the server restarts mid-setup, so that I never end up with a stuck load or a duplicate wallet.

### Company: funding

13. As a company operator, I want a deposit address with a QR code and the exact amount to send, so that I can fund from any Base wallet or exchange in one scan.
14. As a company operator, I want the load to switch to **Funded** automatically when the deposit arrives, so that I don't have to refresh or confirm anything.
15. As a company operator, I want to see the deposit's expiry and minimum, so that I don't send funds to an expired address.
16. As a developer running locally without funds, I want a "Simulate deposit" control that appears only in simulated mode, so that I can test the flow without moving USDC.

### Company: driver handoff

17. As a company operator, I want a driver link with Copy, QR code and "Text to driver" buttons, so that I can hand it over in whichever way is fastest.
18. As a company operator, I want the driver link to work only for its own load, so that a leaked link can't touch other loads.

### Driver

19. As a driver, I want to open the link and immediately see where to deliver and how much is waiting, so that I know the money is real before I unload.
20. As a driver, I want one big button that opens my camera to photograph the signed BOL, so that I don't hunt through menus.
21. As a driver, I want my location captured automatically when I take the photo, so that I don't have to grant or tap anything extra beyond the browser prompt.
22. As a driver, I want to optionally add a short unload video, so that I can strengthen my proof when the freight looks unusual.
23. As a driver, I want to see my photo before submitting and retake it if it's blurry, so that I don't get rejected for a bad picture.
24. As a driver, I want clear progress after submitting (Uploading → Checking location → Reading BOL → Paying), so that I know it's working.
25. As a driver, I want to see **Paid** with the amount and the last four characters of the carrier account, so that I can tell my dispatcher it's done.
26. As a driver, I want a plain-language reason when proof fails ("You're 4.2 km from the delivery. Move to the dock and retake."), so that I can fix it myself.
27. As a driver, I want "Sent to dispatcher for a quick check" when the agent is unsure, instead of a rejection, so that I'm not blamed for an unclear photo.
28. As a driver, I want submitting twice (double tap, flaky signal) never to pay twice, so that the carrier is never overpaid and later clawed back.
29. As a driver, I want the page to work on a phone in sunlight with large text and buttons, so that I can use it at a loading dock.
30. As a driver on a weak connection, I want large photos compressed on my phone before upload, so that submitting doesn't time out.

### Load agent and verification

31. As the company, I want the agent to reject proof whose GPS is outside the delivery geofence, so that money is only released at the real stop.
32. As the company, I want the agent to reject proof submitted before the wallet is funded, so that nothing is promised that isn't escrowed.
33. As the company, I want Claude to check that the BOL photo is a delivery document consistent with this load (load number or consignee), shows a receiver signature or stamp, and doesn't look recycled or edited, so that a random photo doesn't release payment.
34. As the company, I want video frames, when present, checked for an unloading scene with no visible damage or shortage, so that disputes surface before payment.
35. As the company, I want any AI uncertainty to route to me instead of paying, so that a person makes the call on unclear money.
36. As the company, I want each verdict to list its checks with pass/fail and one-line notes, so that I can see why the agent decided what it did.
37. As the company, I want to approve or reject a flagged proof with one tap (and an optional note), so that clearing exceptions takes seconds.
38. As the company, I want an approval to release payment through the same wallet policy, so that a human override can't bypass the guardrails either.
39. As the company, I want a rejected proof to let the driver resubmit, so that a bad photo doesn't kill the load.

### Payment and wallet guardrails

40. As the carrier, I want the full load rate paid to my verified account as soon as proof is approved, so that I'm paid in minutes, not weeks.
41. As the company, I want to see the payment's Agent Connect operation id, status and time from proof to payout, so that I can audit it and quote the speed.
42. As the company, I want an uncertain payment outcome to keep being tracked under its original id, never re-sent, so that the carrier is never paid twice.
43. As a demo presenter, I want a Fraud test button that makes the agent try to pay a different account, so that viewers see Agent Connect refuse it.
44. As a demo presenter, I want the refusal shown with its error code and plain explanation on the load page, so that it's obvious the wallet, not our code, blocked it.
45. As the company, I want the fraud test to move no money and to be disabled outside demo deployments, so that it can't be misused.
46. As the company, I want to cancel an unpaid load and have the wallet refund our account, so that escrowed funds never get stranded.
47. As the company, I want cancel to be impossible once the carrier is paid, so that a mistake can't claw back a completed payment.

### Loads list

48. As a company operator, I want a single list of loads with status, lane, rate and last update, so that I can find any load fast.
49. As a company operator, I want loads that need me (awaiting funding, needs review, failed) visually flagged in the list, so that exceptions don't hide.

### API consumers (harness, TMS)

50. As an integrator, I want a documented REST API (OpenAPI) for every company and driver action the UI performs, so that an agent harness or TMS can drive the same flow.
51. As an integrator, I want stable error codes on every refusal, so that I can branch on them instead of on messages.
52. As an integrator, I want create and submit calls to be idempotent, so that retries are safe.
53. As a security reviewer, I want the partner API key, grant tokens and owner key to stay server-side, so that no browser, log or prompt ever contains them.

### Operations

54. As an operator, I want the app on a public HTTPS URL, so that drivers' phones allow camera and GPS.
55. As an operator, I want in-flight wallet setups, deposits and payments advanced in the background every minute, so that progress continues even when nobody has the page open.
56. As an operator, I want a status indicator for Agent Connect health (from its network endpoint), so that an outage is visible before a demo.

## Implementation Decisions

### Scope cuts (from the current prototype)

- **Removed:** fuel advance, detention, lumper, accessorial reserve, multi-step driver check-ins, the signature pad, receiver name, the demo-GPS toggle, the over-cap fraud attempt, the overview dashboard with metrics and charts, and the Payments, Review queue and Guide pages, plus CSV export.
- **Kept and simplified:** wallet provisioning, deposit, proof verification, broker review, the single redirect fraud test, and cancel-and-refund.
- **Screens:** exactly three. **Loads** (list plus New load), **Load** (stepper plus wallet/guardrails panel) and **Driver** (single-screen proof).

### Agent Connect usage

- **Owner model: company-as-owner.** One dedicated company EVM key, held as a deployment secret, is the owner of every load wallet. It signs `agent_create` and `grant_issue` (EIP-712) automatically, with no human click. The load page records the owner address, the intent correlation ids and `preview.summary` for each signed intent. A user-owned key (passkey/MetaMask) is a follow-up.
- **One load wallet per load.** Created with `external_user_id` = the load id. A wallet is usable only once `GET policy` shows `APPLIED` with `provider_policy_synced: true`.
- **Policy per load.** Sent complete, never partial:
  - `actions`: only what the two destinations need (`transfer` for NEAR Intents accounts, `withdraw` for chain addresses)
  - `assets`: USDC on Base only
  - `limits.per_transaction`: the load rate in atomic units
  - `destinations`: `only` [carrier payout account, company refund account]
  - `budget.daily_usd` and `monthly_usd`: the on-chain rate plus 2% price headroom
  - `max_actions_per_hour`: 6
  - `timelock_ms`: 0, and `owner_approval`: false
- **One grant per load wallet.** Labeled with the load number, expiring 14 days after the delivery appointment (≤365 days). The token is encrypted at rest with a deployment secret and never leaves the server.
- **Funding:** `POST deposit` with `origin_asset` = USDC on Base and no fixed amount. The load is **Funded** when the wallet balance ≥ the on-chain rate. One deposit address per load; treasury auto-funding is a follow-up (see Further Notes).
- **Payment:** a single `transfer` or `withdraw` of the full rate to the carrier destination under the grant. The idempotency key is derived from the payment record id, persisted before sending, and reused on every retry.
- **Status rules** (from the Agent API skill):
  - Never re-send under a new key unless the code is a documented pre-dispatch refusal.
  - `UNCERTAIN`: keep polling the same id.
  - `NEEDS_REVIEW`: stop, flag the load and show `details.reason`.
- **Refusal handling:** branch only on `errors[0].code`. Policy refusals (`policy_destination_denied`, `policy_denied`, `spend_budget_exceeded`, `policy_action_denied`) are stored as **Blocked by policy** with the code and the API's detail.
- **Health:** read `GET /v1/network` for the status indicator. When `custody` or `one_click` is down, show it and defer dispatch.
- **Base URL:** configurable. The demo targets `https://api.demo.agentsonintents.com`. The SDK default is the production host.

### Module boundaries

- **Wallet gateway** (server only): the only module that imports the Agent Connect SDK. Interface: provision a load wallet (resumable), issue a deposit address, read balance, send a payment, read operation status, read network health. It has two adapters behind the same interface:
  - **live**: the Agent Connect SDK
  - **simulated**: the same policy checks and error codes, for tests and keyless local dev

  The adapter is selected by configuration, never by the UI.
- **Load agent** (server only): owns the load state machine and the payment rule. It calls the verifier and the wallet gateway, and contains no HTTP or UI code.
- **Verifier** (server only): rule checks (geofence, GPS accuracy, photo present, funded) plus Claude vision review of the BOL photo and up to 4 video frames, returning a verdict with checks. Model `claude-opus-5-5` with structured JSON output and server-side refusal fallback. Any refusal, parse failure or timeout becomes `needs_review`, never `approve`.
- **Store** (server only): loads, owner intents, payments, proofs and events in D1. Proof files go in R2.
- **HTTP API v1**: route handlers that validate input, check the caller's scope (company session or driver token), call the load agent and serialize views. No business logic.
- **UI**: React pages that call only HTTP API v1. No server imports beyond types. Any UI-only formatting lives in the UI.

### Load state machine

Taken from the prototype and simplified:

```ts
type LoadStatus =
  | "wallet_pending"   // agent_create → policy APPLIED → grant_issue (resumable)
  | "awaiting_funding" // deposit address issued; waiting for balance ≥ rate
  | "funded"           // driver link live; waiting for proof
  | "verifying"        // proof stored; verdict in progress
  | "needs_review"     // agent unsure; company must approve or reject
  | "paying"           // payment sent; following Agent Connect status
  | "paid"             // terminal: carrier paid
  | "cancelling"       // refund sent to company
  | "cancelled"        // terminal: refunded
  | "failed";          // wallet setup or payment ended FAILED / NEEDS_REVIEW; needs an operator

// Allowed transitions
// wallet_pending → awaiting_funding | failed
// awaiting_funding → funded | cancelling
// funded → verifying | cancelling
// verifying → paying (approve) | needs_review | funded (reject: driver may resubmit)
// needs_review → paying (company approves) | funded (company rejects)
// paying → paid | failed
// cancelling → cancelled | failed
```

- A proof can be submitted only in `funded`. A second submit while `verifying`/`paying`/`paid` returns the existing proof, and payment is created at most once per load.
- The fraud test is allowed in any funded state. It never changes the load status. It records a blocked payment attempt and an event.

### HTTP API v1 (contract)

Resource-oriented. JSON in and out, except proof upload (multipart). Every error is `{ error: { code, detail } }` with a stable snake_case code. Published as an OpenAPI 3.1 document at a well-known path under the API.

Company scope:

- `POST /loads`: create a load (`rate_usd`, `delivery` {name, address, lat, lng}, `carrier` {name, payout destination}, optional `load_number`). Returns `201` with the load and starts wallet setup. Accepts `Idempotency-Key`.
- `GET /loads`: list loads, newest first.
- `GET /loads/{id}`: load view: status, stepper state, wallet (agent id, owner address, grant present, policy in plain fields, signed-intent records), deposit, balance, payment, proofs with verdicts, events, driver link.
- `POST /loads/{id}/deposit-address`: issue (or return the existing) deposit address.
- `POST /loads/{id}/proofs/{proof_id}/review`: `{ decision: approve | reject, note? }`. Only valid in `needs_review`.
- `POST /loads/{id}/cancel`: refund to the company. Only before payment.
- `POST /loads/{id}/fraud-test`: demo-only. Returns the blocked attempt. Disabled unless the deployment enables demo features.
- `GET /loads/{id}/files/{file}`: proof media, company scope only.
- `GET /health`: app plus Agent Connect network status and mode (live/simulated).

Driver scope (capability URL; the token is the credential and maps to exactly one load):

- `GET /driver/{token}`: delivery stop, amount, funded flag, current proof status and payment status. No wallet internals.
- `POST /driver/{token}/proof`: multipart `photo` (required, JPEG ≤ 12 MB after on-device compression), `lat`, `lng`, `accuracy_m`, optional `video` (≤ 30 MB) and `frame0..3`. Returns the proof and its status. Idempotent on `Idempotency-Key`.

Simulated mode only: `POST /loads/{id}/simulate-deposit`.

The UI uses only these endpoints. The previous single "actions" switch endpoint is retired.

### Hosting: Cloudflare Workers

- Next.js (16.4) on Workers through the OpenNext Cloudflare adapter (1.20.x supports Next ≥16.3.8), Node.js compatibility enabled. Follow the Next 16 docs bundled in the repo (per AGENTS.md) for route handler conventions.
- **Data:** D1 for relational state (same schema shape as today's SQLite) and R2 for proof photos, videos and frames. The local filesystem and the in-process SQLite driver are retired.
- **Secrets** (Workers secrets, never in code or D1): the Agent Connect partner key, the Anthropic key, the company owner EVM private key, and the grant-token sealing key. Config vars: API base URL, payout asset, demo scale, company refund destination, and the demo-features flag.
- **No long-lived background loops.** Every in-flight process (wallet setup, deposit, payment, cancel, verification) is a resumable step function that advances one non-blocking step at a time. It runs from three places:
  1. right after the triggering request (`waitUntil`)
  2. whenever a load or driver view is read
  3. from a cron trigger every minute for every non-terminal load

  Steps are idempotent through stored correlation ids and idempotency keys, so overlapping runs are safe.
- **Verification** runs inside the proof submit request when possible (the driver waits on "Reading BOL"). If it doesn't finish in time, the proof stays `verifying` and the cron completes it. The driver page keeps polling.

### UX specifics

- **Driver:** large text, one primary action at a time, camera-first file input, and GPS requested in the same tap as the camera.
  - The photo is compressed on the device to ≤1600 px JPEG, and the video is limited to 30 s / 30 MB.
  - Progress states map to the load states.
  - Copy is plain English (Spanish is a follow-up).
  - It never shows crypto terms. "USDC", "wallet" and "Agent Connect" appear only in a small "How payment works" disclosure.
- **Company load page:** a five-step stepper (Wallet → Funded → Driver link → Proof → Paid) with the current step expanded.
  - The side panel shows the balance, guardrails in plain words, and signed-intent records with ids.
  - The Fraud test and Cancel buttons sit in a "Demo controls" card.
  - Every Agent Connect id is copyable.
- **Demo scale:** a persistent badge ("Demo scale 1:1000 · $2,500 = 2.50 USDC") on the company screens. The driver sees contract dollars only.

## Testing Decisions

- **One seam: HTTP API v1.** Tests drive the API exactly as the UI and an external harness would, with the wallet gateway in its **simulated** adapter and the verifier's AI step replaced by a fixture that returns a chosen verdict. They run in the Workers runtime locally, with local D1 and R2.
- **Good tests check external behavior only:** response codes, error codes, load status, payment records and events. They never check internal function calls.
- **Cases:**
  1. Happy path: create → wallet ready → simulate deposit → funded → proof inside the geofence with AI approve → paid exactly once.
  2. Proof outside the geofence → rejected with distance in the detail → resubmit inside → paid.
  3. AI `needs_review` → company approve → paid. And company reject → back to funded.
  4. Double proof submit and repeated `Idempotency-Key` → one payment.
  5. Fraud test → `policy_destination_denied`, no balance change, status unchanged.
  6. Cancel before payment → refunded. Cancel after payment → `409`.
  7. A payment reported `UNCERTAIN` by the adapter → no second send, and the status resolves on a later step.
  8. Proof before funding → refused with `wallet_not_funded`.
  9. Driver token scope: a token for load A cannot read or act on load B.
- **Live smoke check** (opt-in script, not CI): with real keys, create one wallet, wait for policy `APPLIED`, issue a grant, request a deposit address, then read balance and network. Moves no funds.
- **Prior art:** none in the repo yet (the prototype was verified by hand and curl). These are the first tests.

## Out of Scope

- Fuel advance, detention, lumper, accessorial reserve, partial or multiple payouts per load.
- Owner keys held by a person (passkey, MetaMask), KMS/HSM signing, multi-approver owner actions.
- Treasury auto-funding of load wallets.
- USD off-ramp (USDC → ACH/RTP), carrier KYC/KYB, FMCSA checks.
- ELD/telematics integrations (Samsara, Motive) and continuous tracking.
- Driver accounts, driver app, offline mode, SMS sending through a provider (the "Text to driver" button uses the phone's own SMS app), and Spanish copy.
- Multi-company tenancy, roles, the overview analytics dashboard, payments ledger page, CSV export, and an MCP server.
- Disputes (damage/shortage holds) and partial releases.

## Further Notes

### Blockers before a live demo

1. ~~Agent Connect partner key~~ Resolved: an Agent API key (`naa_…`) from the Agent API partner dashboard (partners.demo.agentsonintents.com). The general NEAR Intents dashboard only issues 1Click/Solver/Explorer/AML/Shield keys, none of which work here.
2. ~~Cloudflare account access~~ Resolved: deployed with D1 `loadwallet-db` and R2 `loadwallet-proofs`.
3. ~~Company owner key and refund account~~ Resolved: generated by `npm run demo:keys`, held in `.env.local` and Workers secrets.
4. **Demo funds (open):** 2.50 USDC on Base per demo run at 1:1000 scale, sent by a person from a wallet or exchange to the load's deposit address.
5. **Key hygiene (open):** the Anthropic and Agent API keys were shared in a chat transcript. Rotate both after the demo and store the new ones only as Workers secrets.

### Company console access

- Resolved: the company screens and company API require a shared **company passcode** (a session cookie from the sign-in screen, or `Authorization: Bearer <passcode>` for API clients). The driver link and driver API stay public, scoped by their token. Cloudflare Access (email allow-list) can be layered on top later without code changes.

### Follow-ups (not in this demo)

- Treasury account that auto-funds each load wallet. This needs a design around Agent Connect's 10-minute policy-edit cooldown per account.
- User-owned owner key (passkey) so the company signs in the browser.
- An agent-harness/MCP tool surface over HTTP API v1.

### Demo script (target: under 2 minutes)

1. Create a load ($2,500, "Use my current location" for delivery, carrier payout account). The wallet is created, and the policy appears as signed by the company.
2. Scan the deposit QR and send 2.50 USDC. The load turns **Funded**.
3. Open the driver link on a phone, photograph the signed BOL and submit. The driver sees **Paid $2,500** within seconds, and the company page shows the payment and the time from proof to payout.
4. Press **Fraud test**. Agent Connect refuses with `policy_destination_denied`, and nothing moves.

## Implementation Notes (2026-10-14)

What changed from the decisions above while building, and why:

- **Exact-amount deposits.** An open-amount deposit address for USDC on Base has a 150 USDC minimum, far above a 2.50 USDC demo load. Each wallet now requests an exact-amount deposit equal to the on-chain rate, whose minimum equals the amount.
- **Default carrier payout is a NEAR Intents transfer.** It is instant, with no bridge fee and no minimum, which matches "paid in seconds". USDC-on-Base withdrawals remain available per load; they take minutes, and the network fee comes out of the payment.
- **Fraud test available once the wallet is ready**, before funding. Verified live: Agent Connect refuses the spoofed destination with `policy_destination_denied` before checking balance.
- **API field names are camelCase** in LoadWallet's own API (e.g. `rateUsd`). Agent Connect's own snake_case stays inside the wallet gateway.
- **Next.js pinned to 16.3.8.** Next 16.4 fails on Workers with OpenNext 1.20.x (`Unexpected loadManifest(preview-props.json)`, opennextjs-cloudflare#1448). Unpin when that fix ships.
- **Workers fetch adapter.** The Agent SDK requests `credentials: "omit"` and `redirect: "error"`, which Workers' fetch doesn't implement. The live gateway passes the SDK a fetch that drops the first and refuses redirects itself.
- **Tests run in Node, not the Workers runtime.** They use node:sqlite behind the same D1 interface, an in-memory bucket, the simulated gateway and a fixture verifier, all through the HTTP API v1 handlers. The live smoke check was run by hand against mainnet: wallet setup, grant, deposit address and the policy refusal, with no funds moved.
- **AI review effort is `low`.** The driver waits on it; one live review of a synthetic BOL took about 11 s. When the evidence is weak, the model routes to the company rather than paying.
