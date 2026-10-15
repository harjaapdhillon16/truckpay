# LoadWallet: pay-on-delivery on Agent Connect

A company escrows one truckload's payment in its own **Agent Connect** wallet (NEAR Intents Agent API). The driver takes one photo of the signed BOL at the dock. The load agent checks GPS, has Claude read the BOL, and the wallet pays the carrier in seconds. The wallet's policy, signed once by the company key, refuses anything else: other accounts, other assets, more than the rate.

Spec: [docs/specs/delivery-proof-demo.md](docs/specs/delivery-proof-demo.md) · API: `/api/v1/openapi.json`

Live: https://loadwallet.zerostack.workers.dev (open, no passcode; set `COMPANY_PASSCODE` to require one)

## Test money (default)

Agent Connect has no testnet, so the demo runs with `TEST_MONEY=true`:
- **Real on Agent Connect:** the wallets, policies, grants and the fraud-test refusal.
- **No USDC moves:** **Add test funds** replaces the deposit, and each payout is approved by Agent Connect's own no-money quote.

Set `TEST_MONEY=false` in `wrangler.jsonc` to move real funds.

## The flow

1. **New load:** enter the rate, delivery stop, carrier and payout account. A wallet is created; the company key signs its policy and a grant for the load agent.
2. **Fund:** scan the deposit QR and send the exact USDC on Base. The load turns **Funded** by itself.
3. **Driver:** opens the link (no app, no login), taps **Take photo of signed BOL**, then **Submit**. GPS is captured automatically.
4. **Paid:** if the location and BOL check out, the wallet pays the carrier. If the agent is unsure, you get **Approve & pay / Reject**.
5. **Fraud test:** the agent tries to pay a "new bank account". Agent Connect refuses with `policy_destination_denied`.

## Run locally

```bash
npm install
```

```bash
npm run demo:keys
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

`npm run demo:keys` writes the company owner key, the refund and demo carrier accounts and the grant sealing key into `.dev.vars`. It never overwrites existing values. Add `NEAR_INTENTS_AGENT_API_KEY` (an `naa_…` key from the Agent API partner dashboard) and `ANTHROPIC_API_KEY`.

Keep secrets in `.dev.vars`, never `.env.local`: `next build` bundles `.env*` files into the Worker.

Without an Agent Connect key the wallet is simulated: same policy checks, same error codes, and a **Simulate deposit** button. To force simulation with a key set, use `AGENT_CONNECT_MODE=simulated`.

## Test

```bash
npm test
```

The tests drive the HTTP API v1 the way the UI does: a happy path, a geofence reject and resubmit, review approve and reject, a double submit, the fraud test, cancel, an uncertain payment, and driver-link scope. They run on node:sqlite, an in-memory bucket, the simulated wallet and a fixture verdict.

## Deploy (Cloudflare Workers)

```bash
npm run db:migrate:remote
```

```bash
npm run deploy
```

- **Secrets** (set with `wrangler secret put` or `wrangler secret bulk`): `NEAR_INTENTS_AGENT_API_KEY`, `ANTHROPIC_API_KEY`, `COMPANY_OWNER_EVM_PRIVATE_KEY`, `GRANT_SEALING_KEY` and `TICK_SECRET`, plus `COMPANY_PASSCODE` only if you want the company screens behind a passcode.
- **Vars** live in `wrangler.jsonc`: API URL, payout asset, demo scale, refund and demo carrier accounts.
- **Cron:** a one-minute trigger advances wallet setups, deposits and payments nobody is watching.

## Layout

| Path | What it is |
|---|---|
| `src/server/gateway/` | The only code that talks to Agent Connect (`live`), plus the local `simulated` stand-in |
| `src/server/agent.ts` | The load agent: state machine, verification, payment, cancel, fraud test |
| `src/server/verifier.ts` | Rule checks plus Claude vision review of the BOL and video frames |
| `src/server/policy.ts` | Load → Agent Connect policy |
| `src/app/api/v1/` | REST API v1 (company scope and driver scope) |
| `src/app/` | Three screens (Loads, Load, Driver) and sign-in |

## Notes

- Mainnet, real USDC. `SETTLEMENT_SCALE=0.001` settles a $2,500 load as 2.50 USDC.
- Next.js is pinned to 16.3.8 until [opennextjs-cloudflare#1448](https://github.com/opennextjs/opennextjs-cloudflare/issues/1448) ships.
