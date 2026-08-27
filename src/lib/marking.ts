import { supabase } from "@/integrations/supabase/client";

export const WORK_BUCKET = "student-work";
export const MAX_WORK_IMAGES = 8;
const MAX_BYTES = 10 * 1024 * 1024;

export interface PartMark {
  label: string;
  marks_available: number;
  marks_awarded: number;
  mark_codes: string[];
  comment: string;
}

export interface Marking {
  marks_awarded: number;
  marks_available: number;
  parts: PartMark[];
  errors: string[];
  what_went_well: string;
  next_step: string;
  illegible: boolean;
}

export interface MarkingResult {
  attemptId: string | null;
  marksAwarded: number;
  marksAvailable: number;
  percentage: number;
  marking: Marking;
  balance: number | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

/**
 * Upload one photo of the student's work.
 *
 * The path must begin with the user's id: the storage policy on student-work
 * checks the first folder segment against auth.uid(), so this is not merely a
 * convention — a path shaped any other way is rejected by the database.
 */
async function uploadWorkImage(
  userId: string,
  questionId: string,
  file: File,
  index: number,
): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error(`"${file.name}" is larger than 10 MB.`);

  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/${questionId}/${Date.now()}-${index}.${ext}`;

  const { error } = await supabase.storage
    .from(WORK_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(`Could not upload "${file.name}": ${error.message}`);

  return path;
}

/**
 * Upload the work, then ask the edge function to mark it. The function charges
 * the credit ledger itself and refunds if the model call fails, so the client
 * never has to reason about billing.
 */
export async function markWork(
  userId: string,
  questionId: string,
  files: File[],
): Promise<MarkingResult> {
  if (files.length === 0) throw new Error("Add your working before asking for marks.");
  if (files.length > MAX_WORK_IMAGES) {
    throw new Error(`Please add at most ${MAX_WORK_IMAGES} photos.`);
  }

  const workImagePaths = await Promise.all(
    files.map((file, i) => uploadWorkImage(userId, questionId, file, i)),
  );

  const { data, error } = await supabase.functions.invoke<MarkingResult | { error: string }>(
    "mark-work",
    { body: { questionId, workImagePaths } },
  );

  // A non-2xx from the function surfaces here; its JSON body carries the
  // human-readable reason, which is more useful than "Edge Function returned
  // a non-2xx status code".
  if (error) {
    let detail = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body?.error) detail = body.error as string;
      } catch {
        // Keep the original message.
      }
    }
    throw new Error(detail);
  }

  if (!data || "error" in data) {
    throw new Error((data as { error?: string })?.error ?? "Marking failed.");
  }
  return data;
}

/**
 * Wrap a canvas export as a File. The storage path takes its extension from
 * the file name, and the edge function derives the media type it sends to the
 * model from that same extension — so a blob with no name would be uploaded as
 * ".jpg" by luck rather than by intent.
 */
export function drawnAnswerFile(blob: Blob): File {
  return new File([blob], `drawn-answer-${Date.now()}.jpg`, { type: "image/jpeg" });
}

/** The signed-in user's current credit balance, or null if they have no row yet. */
export async function fetchCreditBalance(userId: string): Promise<number | null> {
  const { data } = await supabase
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? Number(data.balance) : null;
}
