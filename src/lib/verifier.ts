import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { config } from "./config";
import { formatDistance } from "./geo";
import type { Check, RateCon, Verdict } from "./types";

/**
 * The verifier behind every payout. Deterministic checks (geofence, required files, caps) always
 * run; Claude reads the documents and video frames on top. A payout needs both to pass. Anything
 * the model cannot confirm goes to the broker as an exception instead of being paid.
 */

export type Image = { data: Buffer; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };

const AiResult = z.object({
  decision: z.enum(["approve", "reject", "needs_review"]),
  confidence: z.number(),
  summary: z.string(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), note: z.string() })),
  extracted_amount_usd: z.number().nullable(),
  extracted_reference: z.string().nullable(),
});
type AiResult = z.infer<typeof AiResult>;

const AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "confidence", "summary", "checks", "extracted_amount_usd", "extracted_reference"],
  properties: {
    decision: { type: "string", enum: ["approve", "reject", "needs_review"] },
    confidence: { type: "number", description: "0 to 1" },
    summary: { type: "string", description: "One or two sentences a dispatcher can read at a glance." },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "passed", "note"],
        properties: { name: { type: "string" }, passed: { type: "boolean" }, note: { type: "string" } },
      },
    },
    extracted_amount_usd: { type: ["number", "null"], description: "Total on a receipt, if any." },
    extracted_reference: { type: ["string", "null"], description: "Load, BOL, PO or PRO number read from the document." },
  },
} as const;

/** Models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const SYSTEM = `You verify freight paperwork for a load-payment agent. A broker escrowed money for one truckload; your verdict decides whether part of it is released to the carrier right now, without a human.

Approve only when the evidence clearly supports the claim. Use "needs_review" when something is unreadable, missing, ambiguous or inconsistent, so a person can look. Use "reject" only for clear mismatches or signs of fraud (wrong load, edited or recycled images, a different facility, empty trailer on a delivery claim). Never assume facts you cannot see. Keep check names short (3 to 6 words) and notes to one sentence.`;

async function askClaude(images: { label: string; image: Image }[], task: string): Promise<AiResult> {
  const client = new Anthropic();
  const content: BetaContentBlockParam[] = [];
  for (const { label, image } of images) {
    content.push({ type: "text", text: label });
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mediaType, data: image.data.toString("base64") },
    });
  }
  content.push({ type: "text", text: task });

  const useFallback = FALLBACK_MODELS.has(config.verifierModel);
  const response = await client.beta.messages.create({
    model: config.verifierModel,
    max_tokens: 16000,
    system: SYSTEM,
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort: "medium", format: { type: "json_schema", schema: AI_SCHEMA } },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    return {
      decision: "needs_review",
      confidence: 0,
      summary: "The model declined to assess these images; routing to a person.",
      checks: [],
      extracted_amount_usd: null,
      extracted_reference: null,
    };
  }
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("verifier returned no text");
  return AiResult.parse(JSON.parse(text.text));
}

function combine(checks: Check[], ai: AiResult | null, aiError?: string): Verdict {
  const failedHard = checks.filter((c) => !c.passed);
  let decision: Verdict["decision"];
  let summary: string;
  if (failedHard.length > 0) {
    decision = failedHard.some((c) => c.name === "Inside geofence") ? "reject" : "needs_review";
    summary = `Rule check failed: ${failedHard.map((c) => c.name.toLowerCase()).join(", ")}.`;
  } else if (ai) {
    // A model "reject" still goes to a person: a human makes the call on disputed money.
    decision = ai.decision === "approve" ? "approve" : "needs_review";
    summary = ai.summary;
  } else {
    decision = "approve";
    summary = "All rule checks passed. AI document review was not run.";
  }
  return {
    decision,
    summary,
    checks,
    ai: ai
      ? { model: config.verifierModel, decision: ai.decision, confidence: ai.confidence, summary: ai.summary, checks: ai.checks }
      : null,
    aiSkippedReason: ai ? undefined : aiError ?? "ANTHROPIC_API_KEY is not set",
  };
}

async function tryAi(run: () => Promise<AiResult>): Promise<{ ai: AiResult | null; error?: string }> {
  if (!config.anthropicConfigured) return { ai: null };
  try {
    return { ai: await run() };
  } catch (error) {
    return { ai: null, error: `AI review failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function geofenceCheck(distanceM: number, radiusM: number, simulated: boolean): Check {
  return {
    name: "Inside geofence",
    passed: distanceM <= radiusM,
    note: `${formatDistance(distanceM)} from the stop (limit ${formatDistance(radiusM)})${simulated ? ", demo GPS" : ""}.`,
  };
}

export async function verifyPod(input: {
  rateCon: RateCon;
  distanceM: number;
  simulatedLocation: boolean;
  receiverName: string;
  photo: Image | null;
  signature: Image | null;
  frames: Image[];
  hasVideo: boolean;
}): Promise<Verdict> {
  const rc = input.rateCon;
  const checks: Check[] = [
    geofenceCheck(input.distanceM, rc.geofenceMeters, input.simulatedLocation),
    { name: "POD photo attached", passed: Boolean(input.photo), note: input.photo ? "Signed BOL photo received." : "No POD photo." },
    {
      name: "Receiver signed",
      passed: Boolean(input.signature) && input.receiverName.trim().length > 1,
      note: input.signature ? `Signed by ${input.receiverName || "unnamed receiver"}.` : "No receiver signature.",
    },
    {
      name: "Unload video attached",
      passed: input.hasVideo && input.frames.length > 0,
      note: input.hasVideo ? `${input.frames.length} frames extracted for review.` : "No walkaround video.",
    },
  ];

  const { ai, error } = await tryAi(() =>
    askClaude(
      [
        ...(input.photo ? [{ label: "Proof-of-delivery photo (signed bill of lading):", image: input.photo }] : []),
        ...(input.signature ? [{ label: `Receiver signature captured on the driver's phone (receiver: ${input.receiverName}):`, image: input.signature }] : []),
        ...input.frames.map((image, i) => ({ label: `Unloading video, frame ${i + 1} of ${input.frames.length}:`, image })),
      ],
      `Claim: load ${rc.loadNumber} (${rc.commodity}, ${rc.equipment}) was delivered to ${rc.delivery.name}, ${rc.delivery.address}, and unloaded. The driver's phone GPS put them ${formatDistance(input.distanceM)} from the receiver.

Check, using only what you can see:
1. The POD photo shows a bill of lading or delivery receipt, and any load/BOL/PO number on it is consistent with ${rc.loadNumber} (if no number is legible, say so).
2. The document shows a receiver signature or stamp, and the captured signature looks like a real signature rather than a blank or a scribble line.
3. The video frames show a delivery/unloading scene (dock, trailer, freight) consistent with the commodity, with no visible damage or shortage.
4. Nothing suggests the images were recycled, edited, or taken somewhere else.

Approve if 1 to 4 hold. In this demo, images may be staged; still judge them on what they show.`,
    ),
  );
  return combine(checks, ai, error);
}

export async function verifyLumperReceipt(input: {
  rateCon: RateCon;
  claimedUsd: number;
  photo: Image | null;
}): Promise<Verdict & { approvedUsd: number }> {
  const rc = input.rateCon;
  const checks: Check[] = [
    { name: "Receipt photo attached", passed: Boolean(input.photo), note: input.photo ? "Receipt received." : "No receipt photo." },
    {
      name: "Within lumper cap",
      passed: input.claimedUsd > 0 && input.claimedUsd <= rc.lumperCapUsd,
      note: `Claimed $${input.claimedUsd.toFixed(2)}; rate confirmation caps lumper at $${rc.lumperCapUsd.toFixed(2)}.`,
    },
    {
      name: "Approved lumper service",
      passed: Boolean(rc.lumperService),
      note: rc.lumperService ? `Pays ${rc.lumperService.label} directly.` : "No lumper service is approved on this load.",
    },
  ];
  const { ai, error } = await tryAi(() =>
    askClaude(
      input.photo ? [{ label: "Lumper (unloading service) receipt:", image: input.photo }] : [],
      `The driver claims a lumper (unloading) fee of $${input.claimedUsd.toFixed(2)} at ${rc.delivery.name} for load ${rc.loadNumber}. Read the receipt: does it show an unloading/lumper service charge, and does its total match the claimed amount within $1? Put the receipt total in extracted_amount_usd.`,
    ),
  );
  const verdict = combine(checks, ai, error);
  if (ai?.extracted_amount_usd != null && Math.abs(ai.extracted_amount_usd - input.claimedUsd) > 1) {
    verdict.decision = "needs_review";
    verdict.summary = `Receipt shows $${ai.extracted_amount_usd.toFixed(2)}, driver claimed $${input.claimedUsd.toFixed(2)}.`;
  }
  return { ...verdict, approvedUsd: Math.min(input.claimedUsd, rc.lumperCapUsd) };
}
