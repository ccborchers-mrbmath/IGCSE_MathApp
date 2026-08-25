import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import {
  examImagePath,
  examLabel,
  parseExamFilename,
  questionKey,
  type ImageKind,
  type ParsedExamFilename,
} from "@/lib/examFilename";

export const EXAM_BUCKET = "exam-images";

/** Matches the bucket's own limits, so we fail fast instead of round-tripping. */
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Uploads run concurrently, but not unboundedly — a folder can be 900 files. */
const CONCURRENCY = 4;

export interface SkippedFile {
  filename: string;
  reason: string;
}

export interface UploadOutcome {
  label: string;
  key: string;
  uploadedQuestion: boolean;
  uploadedMarkscheme: boolean;
  published: boolean;
  error?: string;
}

export interface BulkUploadResult {
  skipped: SkippedFile[];
  outcomes: UploadOutcome[];
  publishedCount: number;
  failedCount: number;
}

interface QuestionRow {
  id: string;
  year: number;
  sitting: string;
  variant: number;
  question_number: number;
  question_image_path: string | null;
  markscheme_image_path: string | null;
  is_published: boolean;
}

type Pair = {
  parsed: ParsedExamFilename;
  qp?: File;
  ms?: File;
};

/** Group the selected files by the question they belong to. */
function groupFiles(files: File[]) {
  const pairs = new Map<string, Pair>();
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const parsed = parseExamFilename(file.name);
    if (!parsed) {
      skipped.push({ filename: file.name, reason: "Name does not match 0580_m25_qp_22_q07" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      skipped.push({ filename: file.name, reason: "Larger than 10 MB" });
      continue;
    }
    if (file.type && !ALLOWED_TYPES.has(file.type)) {
      skipped.push({ filename: file.name, reason: `Unsupported type ${file.type}` });
      continue;
    }

    const entry = pairs.get(parsed.key) ?? { parsed };
    if (parsed.kind === "qp") entry.qp = file;
    else entry.ms = file;
    pairs.set(parsed.key, entry);
  }

  return { pairs, skipped };
}

/** Run tasks with a bounded number in flight. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Attach images to questions that already exist in the bank.
 *
 * The seeded question index is authoritative: this never creates a question.
 * A file whose paper/question is not in the index is reported as unmatched,
 * which is the signal that either the crop is misnamed or the index is
 * missing a row — both worth knowing about rather than silently inserting.
 *
 * A question is published once it has both a question and a mark-scheme
 * image; a question image alone leaves it staged but unpublished.
 */
export async function runBulkUpload(
  files: File[],
  onProgress?: (done: number, total: number, message: string) => void,
): Promise<BulkUploadResult> {
  const { pairs, skipped } = groupFiles(files);

  if (pairs.size === 0) {
    return { skipped, outcomes: [], publishedCount: 0, failedCount: 0 };
  }

  // Look up every referenced question in one round trip.
  const years = [...new Set([...pairs.values()].map((p) => p.parsed.year))];
  const { data: rows, error: fetchError } = await supabase
    .from("questions")
    .select(
      "id, year, sitting, variant, question_number, question_image_path, markscheme_image_path, is_published",
    )
    .in("year", years);

  if (fetchError) throw new Error(`Could not read the question bank: ${fetchError.message}`);

  const byKey = new Map<string, QuestionRow>();
  for (const r of (rows ?? []) as QuestionRow[]) {
    byKey.set(questionKey(r.year, r.sitting as never, r.variant, r.question_number), r);
  }

  const entries = [...pairs.values()];
  let done = 0;

  const tasks = entries.map((entry) => async (): Promise<UploadOutcome> => {
    const label = examLabel(entry.parsed);
    const row = byKey.get(entry.parsed.key);

    const finish = (outcome: UploadOutcome) => {
      done += 1;
      onProgress?.(done, entries.length, `${label} — ${outcome.error ?? "ok"}`);
      return outcome;
    };

    if (!row) {
      return finish({
        label,
        key: entry.parsed.key,
        uploadedQuestion: false,
        uploadedMarkscheme: false,
        published: false,
        error: "No matching question in the bank",
      });
    }

    try {
      const patch: TablesUpdate<"questions"> = {};

      /**
       * The file extension is part of the storage path, so re-uploading the
       * same clip in a different format (a PNG replaced by a JPEG, say)
       * writes a new object instead of overwriting the old one — leaving the
       * previous file orphaned in the bucket, still costing storage but no
       * longer referenced by any question. Remove the superseded object once
       * the replacement is safely in place.
       */
      const putImage = async (file: File, kind: ImageKind, existingPath: string | null) => {
        const path = examImagePath({ ...entry.parsed, kind }, file.name);
        const { error } = await supabase.storage
          .from(EXAM_BUCKET)
          .upload(path, file, { upsert: true, contentType: file.type || undefined });
        if (error) throw error;

        if (existingPath && existingPath !== path) {
          // Best effort: the new image is already stored and the row is about
          // to point at it, so a failed cleanup must not fail the upload.
          await supabase.storage.from(EXAM_BUCKET).remove([existingPath]);
        }
        return path;
      };

      if (entry.qp) {
        patch.question_image_path = await putImage(entry.qp, "qp", row.question_image_path);
      }
      if (entry.ms) {
        patch.markscheme_image_path = await putImage(entry.ms, "ms", row.markscheme_image_path);
      }

      // Publish only once both halves are present — a question without its
      // mark scheme is not useful to a student and cannot be AI-marked.
      const willHaveQuestion = Boolean(patch.question_image_path ?? row.question_image_path);
      const willHaveMarkscheme = Boolean(patch.markscheme_image_path ?? row.markscheme_image_path);
      const publish = willHaveQuestion && willHaveMarkscheme;
      if (publish && !row.is_published) patch.is_published = true;

      const { error: updateError } = await supabase
        .from("questions")
        .update(patch)
        .eq("id", row.id);
      if (updateError) throw updateError;

      return finish({
        label,
        key: entry.parsed.key,
        uploadedQuestion: Boolean(entry.qp),
        uploadedMarkscheme: Boolean(entry.ms),
        published: publish,
      });
    } catch (e) {
      return finish({
        label,
        key: entry.parsed.key,
        uploadedQuestion: false,
        uploadedMarkscheme: false,
        published: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  const outcomes = await pooled(tasks, CONCURRENCY);

  return {
    skipped,
    outcomes,
    publishedCount: outcomes.filter((o) => o.published).length,
    failedCount: outcomes.filter((o) => o.error).length,
  };
}

/** Public URL for an exam image. Stable, unsigned, and CDN-cacheable. */
export function examImageUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(EXAM_BUCKET).getPublicUrl(path).data.publicUrl;
}
