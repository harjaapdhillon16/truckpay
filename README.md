# LoadWallet: pay-on-delivery load wallets on Agent Connect

The carrier gets paid when the truck is unloaded, not 30–60 days later.

Each booked load gets its own **Agent Connect** wallet (NEAR Intents Agent API). The broker funds it at booking and signs its policy once. A load agent then pays the carrier as the driver proves each step from their phone:

| Event | Proof | Payout |
|---|---|---|
| Pickup | GPS inside the pickup geofence | 30% fuel advance → carrier |
| Dock wait | arrival and departure timestamps at the receiver | detention after free time → carrier |
| Lumper | receipt photo, read by the agent | lumper fee → approved lumper service |
| Delivery | signed BOL photo, receiver signature, unload video, GPS | final payment → carrier |
| Close | broker closes the load | unused reserve → broker |

The agent holds only a **grant token**, never the broker's key. Destinations, asset, per-payment cap and USD budget live in the wallet policy. A spoofed "new bank details" email or a compromised agent can't move money anywhere else. The **Fraud test** buttons send these attacks to the wallet so you can watch it refuse them.

## Run it

```bash
npm install
```

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Open http://localhost:3000 and click **Book a load**. The form is prefilled with the Chicago → Dallas example from the proposal.

The app works with **no keys** at all:

- **No `NEAR_INTENTS_AGENT_API_KEY`:** the wallet is simulated. The local engine applies the same policy checks and returns the same error codes as Agent Connect (`policy_destination_denied`, `policy_denied`, `spend_budget_exceeded`, …).
- **No `ANTHROPIC_API_KEY`:** the agent runs only the rule checks (geofence, required files, caps). With a key, Claude also reads the BOL, signature, lumper receipt and video frames before releasing money. If anything is unclear, the agent sends the POD to the broker instead of paying.

## Going live on Agent Connect (mainnet, real USDC)

1. Create an API key in the partner dashboard and set `NEAR_INTENTS_AGENT_API_KEY` in `.env.local`.
2. Optional: set `BROKER_OWNER_EVM_PRIVATE_KEY` to a dedicated key with no funds. If you leave it empty, one is generated into `./data` on first run. This key is the wallet **owner**. It signs each load's policy and the agent's grant (EIP-712). Agent Connect derives the owner's NEAR account from it and sponsors the gas.
3. Restart. The header shows **Agent Connect live · mainnet**.
4. Book a load. **Use payout accounts you control** (NEAR Intents accounts or chain addresses). Live mode won't prefill them.
5. The wallet setup signs two owner intents (`agent_create`, then `grant_issue`) and waits for the policy to apply on-chain.
6. Click **Get deposit address** and send the amount shown (USDC on Base by default). The load is marked **funded** once the balance arrives.

`SETTLEMENT_SCALE=0.001` keeps real-money tests small: a $2,500 load settles as 2.50 USDC. Set it to `1` for full-size loads.

## Demo script (3 minutes)

1. **Book** a Chicago → Dallas load. The wallet is created and the policy appears under Guardrails. **Fund** it with $2,900.
2. Open the **driver link** (on a phone, or in a narrow window) and tap **I'm at pickup**. The wallet pays the **$750 fuel advance**.
3. Tap **I'm at the receiver**, set the demo clock to 3.5 h and tap **Unloading is done**. The wallet pays **$75 detention** (1.5 billable h × $50).
4. Upload the **POD**: a BOL photo, the receiver's signature and a short video. The agent verifies them and the wallet pays the **final $1,750** within seconds.
5. Back on the dashboard, click **Spoofed email: pay a "new" bank account**. The wallet returns `policy_destination_denied` and the attempt shows as **Blocked by policy**.
6. Click **Close load & refund reserve**. The unused **$325** returns to the broker.

Turning off **Demo GPS** on the driver page sends the phone's real location. The check-in is rejected unless you're actually at the stop.

To open the driver link on a real phone, expose the dev server (for example `cloudflared tunnel --url http://localhost:3000`) and set `PUBLIC_URL` to the tunnel URL. Browsers only allow GPS on HTTPS.

## How it fits together

```
Broker dashboard ──book──▶ API ──agent_create + policy (broker signs)──▶ Agent Connect wallet
                                └─grant_issue (broker signs)──▶ grant token (sealed, server-side)
Driver phone ──GPS / photos / video──▶ Load agent ──rules + Claude vision──▶ transfer / withdraw
                                                                          (with grant token)
                                         wallet policy accepts or refuses ◀───────┘
```

| Path | What it is |
|---|---|
| `src/lib/policy.ts` | Rate confirmation → Agent Connect policy (asset, destinations, caps, budget) |
| `src/lib/wallet.ts` | Agent Connect client: provisioning, deposits, payouts, status follow-up; simulated engine |
| `src/lib/agent.ts` | The load agent: fuel advance, detention, lumper, final, close-out, fraud tests |
| `src/lib/verifier.ts` | Rule checks plus Claude vision review of POD, signature, receipt and video frames |
| `src/app/loads/[id]` | Broker view: money flow, wallet, guardrails, proofs, payouts, timeline |
| `src/app/driver/[token]` | Driver view: check-ins, lumper receipt, POD capture with signature pad |

State lives in `./data` (SQLite + uploads). Delete the folder to start over.

### Demo shortcuts (not production)

- The broker's owner key signs on the server. In production it stays in the broker's own wallet (MetaMask or passkey), and the backend only relays the payload to sign.
- Driver links are bearer URLs, and proof files have no auth.
- USD off-ramp (USDC → ACH/RTP) isn't wired yet. Payouts land in the carrier's NEAR Intents account or chain address.

## Interface

The broker workspace uses public components from [Arc UI](https://uiarc.dev): metric cards, animated counters, donut charts, segmented controls, search fields and buttons. Their source lives in `src/components/arc`, with the upstream MIT license preserved. `components.json` configures the public `@uiarc` registry for future additions.

Shared theme tokens and responsive layout rules are in `src/app/globals.css`. The saved light/dark preference applies to both broker and driver screens. Tailwind runs through `@tailwindcss/postcss`, which preserves Arc's CSS module exports.

Dashboard metrics and review actions use the existing APIs. Sidebar navigation and load-status tabs open dedicated dashboard routes (`/loads`, `/loads/active`, `/loads/completed`, `/payments`, `/review` and `/guide`). Search and sorting update the current page’s table locally; CSV exports contain the currently visible loads. Demo wallets remain explicitly marked as simulated.
