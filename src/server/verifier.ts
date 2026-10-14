import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { Check, Load, Verdict } from "@/lib/domain";
import { formatDistance } from "@/lib/geo";
import { appConfig, secrets } from "./config";

/**
 * Decides whether a delivery proof releases the payment. Rule checks always run; Claude reads the
 * BOL photo and video frames on top. Only "rules pass and the model approves" pays. Anything the
 * model can't confirm (or any failure to ask it) goes to the company, never straight to payment.
 */

export type Image = { data: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/webp" };

export type AiReview = {
  decision: "approve" | "needs_review" | "reject";
  confidence: number;
  summary: string;
  checks: Check[];
};

type AiReviewer = (input: { load: Load; distanceM: number; photo: Image; frames: Image[] }) => Promise<AiReview>;

let reviewerOverride: AiReviewer | null = null;

/** Tests only: replace the model call with a fixture. */
export function setAiReviewerForTests(reviewer: AiReviewer | null) {
  reviewerOverride = reviewer;
}

const AiResult = z.object({
  decision: z.enum(["approve", "reject", "needs_review"]),
  confidence: z.number(),
  summary: z.string(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), note: z.string() })),
});

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "confidence", "summary", "checks"],
  properties: {
    decision: { type: "string", enum: ["approve", "reject", "needs_review"] },
    confidence: { type: "number", description: "0 to 1" },
    summary: { type: "string", description: "One sentence a dispatcher can read at a glance." },
    checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "passed", "note"],
        properties: { name: { type: "string" }, passed: { type: "boolean" }, note: { type: "string" } },
      },
    },
  },
} as const;

const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const SYSTEM = `You check delivery paperwork for a load-payment agent. A company escrowed one truckload's payment; your verdict decides whether it is released to the carrier right now, with no human.

Approve only when the evidence clearly supports the delivery. Use "needs_review" when anything is unreadable, missing, ambiguous or inconsistent, so a dispatcher can look. Use "reject" only for clear mismatches or signs of fraud (a different load, an edited or recycled image, an unrelated photo). Never assume what you cannot see. Keep check names to 2-5 words and notes to one short sentence.`;

const claudeReviewer: AiReviewer = async ({ load, distanceM, photo, frames }) => {
  const config = await appConfig();
  const client = new Anthropic({ apiKey: await secrets.anthropicKey() });
  const image = (img: Image): BetaContentBlockParam => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: Buffer.from(img.data).toString("base64") },
  });
  const content: BetaContentBlockParam[] = [
    { type: "text", text: "Photo of the signed bill of lading / delivery receipt:" },
    image(photo),
    ...frames.flatMap((f, i): BetaContentBlockParam[] => [{ type: "text", text: `Unloading video, frame ${i + 1} of ${frames.length}:` }, image(f)]),
    {
      type: "text",
      text: `Claim: load ${load.number} was delivered to ${load.delivery.name} (${load.delivery.address}) for carrier ${load.carrier.name}. The driver's phone GPS was ${formatDistance(distanceM)} from the delivery stop when they submitted.

Check only what you can see:
1. The photo shows a bill of lading, delivery receipt or proof-of-delivery document (not an unrelated picture).
2. It carries a receiver signature, initials or stamp.
3. Any load, BOL, PO or reference number, or consignee name, that is legible does not contradict load ${load.number} or ${load.delivery.name}. If none is legible, say so; that alone is not a reason to reject.
4. ${frames.length ? "The video frames show an unloading or delivered-freight scene with no obvious damage." : "No video was provided; skip this check."}
5. Nothing suggests the image is recycled, edited or a screen photo.

Approve if 1, 2, 3 and 5 hold (and 4 when frames exist).`,
    },
  ];
  const useFallback = FALLBACK_MODELS.has(config.verifierModel);
  const response = await client.beta.messages.create({
    model: config.verifierModel,
    max_tokens: 4000,
    system: SYSTEM,
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal")
    return { decision: "needs_review", confidence: 0, summary: "The model declined to assess these images.", checks: [] };
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("verifier returned no text");
  return AiResult.parse(JSON.parse(text.text));
};

export async function verifyDelivery(input: {
  load: Load;
  distanceM: number;
  accuracyM: number | null;
  photo: Image | null;
  frames: Image[];
}): Promise<Verdict> {
  const { load } = input;
  const radius = load.delivery.radiusM;
  const inside = input.distanceM <= radius;
  const checks: Check[] = [
    {
      name: "At the delivery stop",
      passed: inside,
      note: `${formatDistance(input.distanceM)} from ${load.delivery.name} (limit ${formatDistance(radius)})${input.accuracyM ? `, GPS ±${Math.round(input.accuracyM)} m` : ""}.`,
    },
    { name: "BOL photo attached", passed: Boolean(input.photo), note: input.photo ? "Photo received." : "No photo." },
  ];

  if (!inside)
    return {
      decision: "reject",
      summary: `Submitted ${formatDistance(input.distanceM)} from the delivery stop.`,
      driverMessage: `You're ${formatDistance(input.distanceM)} from ${load.delivery.name}. Move to the dock and submit again.`,
      checks,
      ai: null,
      aiSkippedReason: "Location check failed first",
    };
  if (!input.photo)
    return { decision: "reject", summary: "No BOL photo.", driverMessage: "Take a photo of the signed BOL and submit again.", checks, ai: null, aiSkippedReason: "No photo" };

  const config = await appConfig();
  const reviewer = reviewerOverride ?? (config.aiEnabled ? claudeReviewer : null);
  if (!reviewer)
    return {
      decision: "needs_review",
      summary: "Location and photo check out. AI review is not configured, so a person must confirm.",
      driverMessage: "Sent to your dispatcher for a quick check.",
      checks,
      ai: null,
      aiSkippedReason: "ANTHROPIC_API_KEY is not set",
    };

  let ai: AiReview;
  try {
    ai = await reviewer({ load, distanceM: input.distanceM, photo: input.photo, frames: input.frames });
  } catch (error) {
    return {
      decision: "needs_review",
      summary: "AI review could not finish, so a person must confirm.",
      driverMessage: "Sent to your dispatcher for a quick check.",
      checks,
      ai: null,
      aiSkippedReason: error instanceof Error ? error.message : String(error),
    };
  }

  const decision = ai.decision === "approve" ? "approve" : ai.decision === "reject" ? "reject" : "needs_review";
  return {
    decision,
    summary: ai.summary,
    driverMessage:
      decision === "approve"
        ? "Delivery verified."
        : decision === "reject"
          ? `The BOL photo didn't check out: ${ai.summary} Retake it and submit again.`
          : "Sent to your dispatcher for a quick check.",
    checks,
    ai: { model: config.verifierModel, decision: ai.decision, confidence: ai.confidence, summary: ai.summary, checks: ai.checks },
  };
}
