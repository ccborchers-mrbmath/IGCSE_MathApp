import Anthropic from "npm:@anthropic-ai/sdk@0.68.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });


/**
 * Marks a student's handwritten work against the official Cambridge mark
 * scheme for one question.
 *
 * Revenue is a markup on AI calls, so the credit ledger is charged before the
 * model is called, never after — a failed deduction must cost nothing.
 */

const MODEL = "claude-opus-5";

/** One marking call. Fractional costs are supported by the ledger. */
const MARKING_COST = 1;

// ---------------------------------------------------------------- schema --
// A strict tool rather than output_config.format: strict tool use guarantees
// the input validates against this schema exactly, and needs no SDK helper
// subpath. tool_choice stays "auto" so adaptive thinking remains available —
// with one tool available and the instruction below, the model always calls it.

const MARKING_TOOL = {
  name: "record_marking",
  description:
    "Record the marks awarded for this question, part by part, with feedback for the student.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      marks_awarded: { type: "integer", description: "Total marks earned across all parts." },
      marks_available: { type: "integer", description: "Total marks the question carries." },
      parts: {
        type: "array",
        description: "One entry per part, in the order printed on the paper.",
        items: {
          type: "object",
          properties: {
            label: {
              type: "string",
              description: "Part label exactly as printed, e.g. 'a', 'b(ii)'. Use 'whole' for a single-part question.",
            },
            marks_available: { type: "integer" },
            marks_awarded: { type: "integer" },
            mark_codes: {
              type: "array",
              items: { type: "string" },
              description: "Cambridge codes actually earned, e.g. ['M1','A1']. Empty if none.",
            },
            comment: {
              type: "string",
              description: "One or two sentences: what earned or lost the marks, citing the mark scheme.",
            },
          },
          required: ["label", "marks_available", "marks_awarded", "mark_codes", "comment"],
          additionalProperties: false,
        },
      },
      errors: {
        type: "array",
        items: { type: "string" },
        description: "Short phrases naming each distinct error, e.g. 'sign error when expanding'.",
      },
      what_went_well: {
        type: "string",
        description: "Specific, not generic praise. Empty string if nothing did.",
      },
      next_step: { type: "string", description: "The single most useful thing to do next." },
      illegible: {
        type: "boolean",
        description: "True only if the work could not be read well enough to mark fairly.",
      },
    },
    required: [
      "marks_awarded",
      "marks_available",
      "parts",
      "errors",
      "what_went_well",
      "next_step",
      "illegible",
    ],
    additionalProperties: false,
  },
};

interface PartMark {
  label: string;
  marks_available: number;
  marks_awarded: number;
  mark_codes: string[];
  comment: string;
}

interface Marking {
  marks_awarded: number;
  marks_available: number;
  parts: PartMark[];
  errors: string[];
  what_went_well: string;
  next_step: string;
  illegible: boolean;
}

// ------------------------------------------------------------ marking rubric --
// Kept as a frozen constant so it forms a stable cache prefix: the syllabus
// and marking conventions never vary per request, so after the first call the
// input is served from cache at a fraction of the price.
const SYSTEM_PROMPT = `You are an experienced Cambridge IGCSE Mathematics (0580) Extended examiner. You mark a student's handwritten work against the official mark scheme for one past-paper question.

You will be given, in order:
1. The question paper image.
2. The official mark scheme image.
3. One or more photographs of the student's handwritten working.

## How to mark

Apply the mark scheme as written. It is the authority — not your own preferred method, and not your own recalculation. If the student reaches the mark scheme's answer by a valid alternative method, award the marks; Cambridge mark schemes accept correct alternatives even when unlisted.

Cambridge mark types, which you must respect:
- **M** — method. Earned for a correct method with correct substitution, even if the arithmetic that follows is wrong.
- **A** — accuracy. Depends on the associated M mark. Never award an A mark whose M mark was not earned.
- **B** — independent. Awarded for a correct answer or statement on its own, with no method required.
- **FT / √** — follow through. If the mark scheme allows follow through, award marks for work that is correct given the student's own earlier (wrong) value. This matters: a single early slip should not cost every mark that follows.
- **SC** — special case, awarded only where the mark scheme names it.
- **AG** — answer given. The answer is printed in the question, so the marks are for the derivation. Be strict: a student who writes down the given answer without working earns nothing.
- **ISW** — ignore subsequent working. Once a correct answer appears, later incorrect simplification does not lose the mark.
- **CWO** — correct working only, so no follow through is permitted for that mark.

Accuracy conventions: unless the question says otherwise, accept answers correct to 3 significant figures, or exact. Accept equivalent forms — an unsimplified fraction, a decimal equal to the required value, a differently but equivalently arranged expression. Do not penalise a missing unit unless the mark scheme requires it.

## Being fair

Mark what is actually on the page, not what you assume the student meant. Where handwriting is genuinely ambiguous, read it in the way most favourable to the student, exactly as an examiner would. If the work is too unclear to mark fairly, set illegible to true, award 0, and say what you could not read — do not guess a score.

If the photographs show working for only some parts, mark those parts and award 0 for the parts with no attempt, noting the absence in the comment rather than treating it as an error.

Never award more marks than a part carries, and never award a negative number. The marks you award per part must sum to your total.

## Writing feedback

Write to the student, in second person, plainly. Name the specific mathematical error — "you subtracted instead of adding when collecting like terms" — not a vague label like "arithmetic error". If the student lost an A mark but kept the M mark, say so, because knowing the method was right matters.

what_went_well must be specific or empty. Never invent praise.

next_step is one thing, the highest-leverage one: the concept to revisit, or the habit to change. Not a list.`;

// ------------------------------------------------------------------ helpers --

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const mediaTypeFor = (path: string): "image/jpeg" | "image/png" | "image/webp" => {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
};

/**
 * Student work lives in a private bucket, so it is fetched with the service
 * role and inlined as base64. Exam images are in the public bucket and are
 * passed by URL instead — no download, no encoding, and the CDN serves them.
 */
async function workImageBlock(path: string) {
  const { data, error } = await admin.storage.from("student-work").download(path);
  if (error || !data) throw new Error(`Could not read your uploaded work (${path})`);

  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return {
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: mediaTypeFor(path),
      data: btoa(binary),
    },
  };
}

// --------------------------------------------------------------- handler --

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!Deno.env.get("ANTHROPIC_API_KEY")) {
      return json({ error: "Marking is not configured yet." }, 503);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await admin.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) return json({ error: "Please sign in." }, 401);
    const userId = claims.claims.sub as string;

    const { questionId, workImagePaths } = await req.json();
    if (typeof questionId !== "string" || !Array.isArray(workImagePaths) || workImagePaths.length === 0) {
      return json({ error: "A question and at least one photo of your work are required." }, 400);
    }
    if (workImagePaths.length > 8) {
      return json({ error: "Please upload at most 8 photos." }, 400);
    }
    // A user may only ever submit work from their own folder.
    if (!workImagePaths.every((p: unknown) => typeof p === "string" && p.startsWith(`${userId}/`))) {
      return json({ error: "Those files do not belong to you." }, 403);
    }

    // ---- the question and its mark scheme -----------------------------------
    const { data: question, error: qError } = await admin
      .from("questions")
      .select(
        "id, year, sitting, variant, question_number, marks, is_published, question_image_path, markscheme_image_path",
      )
      .eq("id", questionId)
      .single();

    if (qError || !question) return json({ error: "Question not found." }, 404);
    if (!question.is_published) return json({ error: "That question is not available yet." }, 403);
    if (!question.question_image_path || !question.markscheme_image_path) {
      return json({ error: "That question has no mark scheme yet, so it cannot be marked." }, 409);
    }

    const { data: parts } = await admin
      .from("question_parts")
      .select("label, description, marks, position")
      .eq("question_id", questionId)
      .order("position");

    const publicUrl = (p: string) =>
      admin.storage.from("exam-images").getPublicUrl(p).data.publicUrl;

    // ---- charge before calling the model ------------------------------------
    // Deducting first means a model failure costs the student nothing only if
    // we refund; see the catch below.
    const { data: deduction, error: deductError } = await admin.rpc("deduct_credits", {
      _user_id: userId,
      _base_cost: MARKING_COST,
      _reason: "ai_marking",
      _metadata: { question_id: questionId, model: MODEL },
    });

    if (deductError) return json({ error: "Could not check your credit balance." }, 500);
    const result = deduction as { allowed: boolean; reason: string; new_balance: number | null };
    if (!result.allowed) {
      return json(
        { error: "You have no marking credits left.", reason: result.reason, balance: result.new_balance },
        402,
      );
    }

    const refund = async () => {
      await admin.rpc("grant_credits", {
        _user_id: userId,
        _amount: MARKING_COST,
        _reason: "refund_failed_marking",
        _metadata: { question_id: questionId },
      });
    };

    // ---- mark it ------------------------------------------------------------
    try {
      const workBlocks = await Promise.all(workImagePaths.map(workImageBlock));

      const partsBrief = (parts ?? []).length
        ? (parts ?? [])
            .map((p) => `- ${p.label ?? "whole"} [${p.marks}]: ${p.description}`)
            .join("\n")
        : `- whole [${question.marks}]`;

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: {
          // Correctness matters more here than latency: a wrong mark erodes
          // trust in the whole product.
          effort: "high",
        },
        tools: [MARKING_TOOL],
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            // Frozen prefix — every marking call reuses it.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "The question paper:" },
              { type: "image", source: { type: "url", url: publicUrl(question.question_image_path) } },
              { type: "text", text: "The official mark scheme:" },
              { type: "image", source: { type: "url", url: publicUrl(question.markscheme_image_path) } },
              { type: "text", text: "The student's handwritten work:" },
              ...workBlocks,
              {
                type: "text",
                text:
                  `Mark this attempt at ${question.year} ${question.sitting} Paper ${question.variant} ` +
                  `Question ${question.question_number}, worth ${question.marks} marks in total.\n\n` +
                  `Parts and their mark allocations:\n${partsBrief}\n\n` +
                  `Award marks part by part, then record your marking with the ` +
                  `record_marking tool — always call it, and call it exactly once. ` +
                  `marks_available must match the allocations above, and your per-part ` +
                  `awards must sum to marks_awarded.`,
              },
            ],
          },
        ],
      });

      if (response.stop_reason === "refusal") {
        await refund();
        return json({ error: "Marking was declined for this submission." }, 422);
      }

      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === MARKING_TOOL.name,
      );
      if (!toolUse) {
        await refund();
        return json({ error: "Marking came back in an unreadable form. Please try again." }, 502);
      }
      // strict:true guarantees this validates against MARKING_TOOL's schema.
      const marking = toolUse.input as unknown as Marking;

      // Trust the mark scheme's total over the model's arithmetic.
      const available = question.marks;
      const awarded = Math.max(0, Math.min(marking.marks_awarded, available));
      const percentage = available > 0 ? Math.round((awarded / available) * 1000) / 10 : 0;

      const { data: attempt, error: attemptError } = await admin
        .from("student_attempts")
        .insert({
          user_id: userId,
          question_id: questionId,
          attempted: true,
          marks_awarded: awarded,
          percentage_attained: percentage,
          mark_breakdown: marking as unknown as Record<string, unknown>,
          ai_feedback: marking.next_step,
          nature_of_errors: marking.errors.join("; ") || null,
          work_image_paths: workImagePaths,
        })
        .select("id")
        .single();

      if (attemptError) {
        // The marking itself succeeded and was paid for; return it rather than
        // losing the student's result over a write failure.
        console.error("Could not save attempt", attemptError);
      }

      return json({
        attemptId: attempt?.id ?? null,
        marksAwarded: awarded,
        marksAvailable: available,
        percentage,
        marking,
        balance: result.new_balance,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      });
    } catch (modelError) {
      await refund();
      console.error("Marking failed", modelError);
      const message =
        modelError instanceof Anthropic.APIError
          ? `The marking service returned ${modelError.status}.`
          : modelError instanceof Error
            ? modelError.message
            : "Marking failed.";
      return json({ error: `${message} Your credit has been returned.` }, 502);
    }
  } catch (e) {
    console.error("Unhandled error", e);
    return json({ error: "Something went wrong." }, 500);
  }
});
