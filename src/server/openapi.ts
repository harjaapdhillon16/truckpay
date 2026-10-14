/**
 * OpenAPI 3.1 contract for LoadWallet's own API (not Agent Connect's). The UI uses only these
 * endpoints, so any agent harness or TMS can drive the same flow.
 */

const error = { $ref: "#/components/responses/Error" };
const companyAuth = [{ passcode: [] }, { session: [] }];
const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "LoadWallet API",
    version: "1.0.0",
    description:
      "Pay-on-delivery for one truckload. Each load gets an Agent Connect wallet owned by the company; the driver submits proof, the load agent verifies it and the wallet pays the carrier. Errors are `{ error: { code, detail } }`; branch on `code`.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      passcode: { type: "http", scheme: "bearer", description: "The company passcode." },
      session: { type: "apiKey", in: "cookie", name: "lw_session" },
    },
    responses: {
      Error: {
        description: "Refusal or failure",
        content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, detail: { type: "string" } }, required: ["code", "detail"] } } } } },
      },
    },
    schemas: {
      Destination: {
        oneOf: [
          { type: "object", properties: { kind: { const: "transfer" }, account: { type: "string", description: "NEAR Intents account id" } }, required: ["kind", "account"] },
          { type: "object", properties: { kind: { const: "withdraw" }, chain: { const: "base" }, address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, required: ["kind", "chain", "address"] },
        ],
      },
      LoadStatus: {
        type: "string",
        enum: ["wallet_pending", "awaiting_funding", "funded", "verifying", "needs_review", "paying", "paid", "cancelling", "cancelled", "failed"],
      },
      CreateLoad: {
        type: "object",
        required: ["rateUsd", "delivery", "carrier"],
        properties: {
          number: { type: "string", description: "Optional; generated when omitted." },
          rateUsd: { type: "number", description: "Contract dollars. Settles on-chain at the deployment's demo scale." },
          delivery: { type: "object", required: ["name", "address", "lat", "lng"], properties: { name: { type: "string" }, address: { type: "string" }, lat: { type: "number" }, lng: { type: "number" } } },
          carrier: { type: "object", required: ["name", "payout"], properties: { name: { type: "string" }, payout: { $ref: "#/components/schemas/Destination" } } },
        },
      },
      Load: { type: "object", description: "Full company view: status, steps, wallet and guardrails, owner intents, payment, proofs, events." },
      DriverView: {
        type: "object",
        properties: {
          number: { type: "string" },
          amountUsd: { type: "number" },
          state: { type: "string", enum: ["not_ready", "ready", "verifying", "review", "retry", "paying", "paid", "cancelled", "problem"] },
          message: { type: ["string", "null"] },
        },
      },
    },
  },
  paths: {
    "/loads": {
      get: { summary: "List loads", security: companyAuth, responses: { 200: { description: "`{ data: LoadSummary[] }`" }, 401: error } },
      post: {
        summary: "Book a load and start wallet setup",
        description: "Creates the load and, in the background, its Agent Connect wallet (company signs the policy and the load agent's grant) and a deposit address. Accepts `Idempotency-Key`.",
        security: companyAuth,
        parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateLoad" } } } },
        responses: { 201: { description: "The load", content: { "application/json": { schema: { $ref: "#/components/schemas/Load" } } } }, 400: error, 401: error },
      },
    },
    "/loads/{id}": {
      get: { summary: "Get a load (and nudge it forward)", security: companyAuth, parameters: [idParam], responses: { 200: { description: "The load" }, 404: error } },
    },
    "/loads/{id}/deposit-address": {
      post: { summary: "Get the wallet's deposit address", security: companyAuth, parameters: [idParam], responses: { 200: { description: "`{ deposit, amountAtomic }`" }, 409: error } },
    },
    "/loads/{id}/proofs/{proofId}/review": {
      post: {
        summary: "Approve or reject a proof the agent flagged",
        security: companyAuth,
        parameters: [idParam, { name: "proofId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", required: ["decision"], properties: { decision: { enum: ["approve", "reject"] }, note: { type: "string" } } } } } },
        responses: { 200: { description: "The load" }, 409: error },
      },
    },
    "/loads/{id}/cancel": {
      post: { summary: "Cancel an unpaid load and refund the company", security: companyAuth, parameters: [idParam], responses: { 200: { description: "The load" }, 409: error } },
    },
    "/loads/{id}/fraud-test": {
      post: { summary: "Demo: the agent tries to pay a spoofed account; Agent Connect refuses", security: companyAuth, parameters: [idParam], responses: { 200: { description: "`{ attempt: Payment }` with status BLOCKED" }, 403: error } },
    },
    "/loads/{id}/simulate-deposit": {
      post: { summary: "Simulated mode only: fund the wallet", security: companyAuth, parameters: [idParam], responses: { 200: { description: "The load" }, 409: error } },
    },
    "/loads/{id}/files/{name}": {
      get: { summary: "Proof media", security: companyAuth, parameters: [idParam, { name: "name", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "File bytes" }, 404: error } },
    },
    "/driver/{token}": {
      get: {
        summary: "Driver view of their one load",
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Driver view", content: { "application/json": { schema: { $ref: "#/components/schemas/DriverView" } } } }, 404: error },
      },
    },
    "/driver/{token}/proof": {
      post: {
        summary: "Submit delivery proof",
        description: "Verifies location and the BOL, then pays the carrier when approved. Idempotent on `Idempotency-Key`.",
        parameters: [
          { name: "token", in: "path", required: true, schema: { type: "string" } },
          { name: "Idempotency-Key", in: "header", schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["photo", "lat", "lng"],
                properties: {
                  photo: { type: "string", format: "binary", description: "Signed BOL, JPEG ≤ 12 MB" },
                  lat: { type: "number" },
                  lng: { type: "number" },
                  accuracy_m: { type: "number" },
                  video: { type: "string", format: "binary", description: "Optional, ≤ 30 MB" },
                  frame0: { type: "string", format: "binary" },
                  frame1: { type: "string", format: "binary" },
                  frame2: { type: "string", format: "binary" },
                  frame3: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Driver view after verification" }, 400: error, 409: error, 413: error },
      },
    },
    "/health": { get: { summary: "App mode and Agent Connect network status", responses: { 200: { description: "Health" } } } },
    "/session": {
      post: { summary: "Company sign-in with the passcode (sets a cookie)", responses: { 204: { description: "Signed in" }, 401: error } },
      delete: { summary: "Sign out", responses: { 204: { description: "Signed out" } } },
    },
  },
} as const;
