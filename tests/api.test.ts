import { beforeEach, describe, expect, it } from "vitest";
import * as loads from "@/app/api/v1/loads/route";
import * as load from "@/app/api/v1/loads/[id]/route";
import * as cancel from "@/app/api/v1/loads/[id]/cancel/route";
import * as fraud from "@/app/api/v1/loads/[id]/fraud-test/route";
import * as review from "@/app/api/v1/loads/[id]/proofs/[proofId]/review/route";
import * as simulateDeposit from "@/app/api/v1/loads/[id]/simulate-deposit/route";
import * as driver from "@/app/api/v1/driver/[token]/route";
import * as proof from "@/app/api/v1/driver/[token]/proof/route";
import { simulator } from "@/server/gateway/simulated";
import { CARRIER, DELIVERY, call, proofForm, setup } from "./support/harness";

type Harness = ReturnType<typeof setup>;
let h: Harness;

const AT_DOCK = { lat: DELIVERY.lat + 0.001, lng: DELIVERY.lng };
const FAR_AWAY = { lat: DELIVERY.lat + 0.04, lng: DELIVERY.lng };

async function fundedLoad() {
  const created = await call(loads.POST as never, { json: { rateUsd: 2500, delivery: DELIVERY, carrier: CARRIER } });
  expect(created.status).toBe(201);
  await h.settle();
  const id = created.body.id as string;
  const ready = await call(load.GET as never, { params: { id } });
  expect(ready.body.status).toBe("awaiting_funding");
  const funded = await call(simulateDeposit.POST as never, { params: { id } });
  expect(funded.body.status).toBe("funded");
  const token = new URL(funded.body.driverUrl).pathname.split("/").pop()!;
  return { id, token };
}

const getLoad = async (id: string) => (await call(load.GET as never, { params: { id } })).body;

beforeEach(() => {
  h = setup();
});

describe("delivery-proof payout", () => {
  it("pays the carrier exactly once after a proof inside the geofence is approved", async () => {
    const { id, token } = await fundedLoad();
    const before = await getLoad(id);
    expect(before.wallet.hasGrant).toBe(true);
    expect(before.wallet.guardrails.destinations).toHaveLength(2);
    expect(before.ownerIntents.map((i: { type: string }) => i.type)).toEqual(["agent_create", "grant_issue"]);

    const submitted = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK) });
    expect(submitted.status).toBe(200);
    expect(submitted.body.state).toBe("paid");
    expect(submitted.body.payment.amountUsd).toBe(2500);

    const after = await getLoad(id);
    expect(after.status).toBe("paid");
    expect(after.payments.filter((p: { kind: string }) => p.kind === "payment")).toHaveLength(1);
    expect(after.payment.amountAtomic).toBe("2500000");
    expect(after.wallet.balanceAtomic).toBe("0");
  });

  it("rejects a proof outside the geofence, then pays when the driver resubmits at the dock", async () => {
    const { id, token } = await fundedLoad();
    const far = await call(proof.POST as never, { params: { token }, form: proofForm(FAR_AWAY) });
    expect(far.body.state).toBe("retry");
    expect(far.body.message).toMatch(/from Lone Star Grocers/);
    expect((await getLoad(id)).status).toBe("funded");

    const near = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK) });
    expect(near.body.state).toBe("paid");
  });

  it("routes an unsure verdict to the company; approval pays, rejection lets the driver resubmit", async () => {
    h.setAiVerdict({ decision: "needs_review", summary: "Load number is not legible." });
    const { id, token } = await fundedLoad();
    const flagged = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK) });
    expect(flagged.body.state).toBe("review");

    const pending = await getLoad(id);
    expect(pending.status).toBe("needs_review");
    const proofId = pending.proofs[0].id;
    const rejected = await call(review.POST as never, { params: { id, proofId }, json: { decision: "reject", note: "Photo too dark" } });
    expect(rejected.body.status).toBe("funded");
    expect((await call(driver.GET as never, { params: { token } })).body.state).toBe("retry");

    await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK) });
    const secondProof = (await getLoad(id)).proofs[1].id;
    const approved = await call(review.POST as never, { params: { id, proofId: secondProof }, json: { decision: "approve" } });
    expect(approved.body.status).toBe("paid");
  });

  it("never pays twice for a double submit or a repeated idempotency key", async () => {
    const { id, token } = await fundedLoad();
    const headers = { "idempotency-key": "tap-1" };
    const first = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK), headers });
    const again = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK), headers });
    const third = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK) });
    expect([first.body.state, again.body.state, third.body.state]).toEqual(["paid", "paid", "paid"]);
    const after = await getLoad(id);
    expect(after.proofs).toHaveLength(1);
    expect(after.payments.filter((p: { kind: string }) => p.kind === "payment")).toHaveLength(1);
  });

  it("refuses proof before the wallet is funded", async () => {
    const created = await call(loads.POST as never, { json: { rateUsd: 2500, delivery: DELIVERY, carrier: CARRIER } });
    await h.settle();
    const token = new URL(created.body.driverUrl).pathname.split("/").pop()!;
    const res = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("wallet_not_funded");
  });
});

describe("wallet guardrails", () => {
  it("fraud test is refused by the wallet policy and moves nothing", async () => {
    const { id } = await fundedLoad();
    const res = await call(fraud.POST as never, { params: { id } });
    expect(res.body.attempt.status).toBe("BLOCKED");
    expect(res.body.attempt.errorCode).toBe("policy_destination_denied");
    const after = await getLoad(id);
    expect(after.status).toBe("funded");
    expect(after.wallet.balanceAtomic).toBe("2500000");
  });

  it("cancel refunds the company before payment and is refused after", async () => {
    const first = await fundedLoad();
    const cancelled = await call(cancel.POST as never, { params: { id: first.id } });
    expect(cancelled.body.status).toBe("cancelled");
    expect(cancelled.body.payments.find((p: { kind: string }) => p.kind === "refund").destination.account).toBe("acme-refunds.near");

    const second = await fundedLoad();
    await call(proof.POST as never, { params: { token: second.token }, form: proofForm(AT_DOCK) });
    const refused = await call(cancel.POST as never, { params: { id: second.id } });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("not_cancellable");
  });

  it("keeps following an UNCERTAIN payment under its original id instead of re-sending", async () => {
    const { id, token } = await fundedLoad();
    simulator.failNextSendWith("UNCERTAIN");
    const submitted = await call(proof.POST as never, { params: { token }, form: proofForm(AT_DOCK) });
    expect(submitted.body.state).toBe("paying");
    const paying = await getLoad(id);
    const correlationId = paying.payment.correlationId;
    await h.settle();
    expect((await getLoad(id)).status).toBe("paying");

    simulator.resolve(correlationId, "SUCCESS");
    await getLoad(id);
    await h.settle();
    const done = await getLoad(id);
    expect(done.status).toBe("paid");
    expect(done.payments.filter((p: { kind: string }) => p.kind === "payment")).toHaveLength(1);
    expect(done.payment.correlationId).toBe(correlationId);
  });
});

describe("access", () => {
  it("a driver token opens only its own load", async () => {
    const a = await fundedLoad();
    const b = await fundedLoad();
    const view = await call(driver.GET as never, { params: { token: a.token } });
    expect(view.body.number).toBe((await getLoad(a.id)).number);
    expect(view.body.number).not.toBe((await getLoad(b.id)).number);
    expect(JSON.stringify(view.body)).not.toMatch(/agentId|grant|wallet/);
    const bogus = await call(driver.GET as never, { params: { token: "nope" } });
    expect(bogus.status).toBe(404);
  });

  it("company endpoints need the passcode when one is configured", async () => {
    h = setup({ COMPANY_PASSCODE: "let-me-in" });
    expect((await call(loads.GET as never)).status).toBe(401);
    const ok = await call(loads.GET as never, { headers: { authorization: "Bearer let-me-in" } });
    expect(ok.status).toBe(200);
  });
});
