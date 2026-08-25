import type { Enums } from "@/integrations/supabase/types";

export type ExamSitting = Enums<"exam_sitting">;
export type ImageKind = "qp" | "ms";

export interface ParsedExamFilename {
  year: number;
  sitting: ExamSitting;
  variant: number;
  questionNumber: number;
  kind: ImageKind;
  /** Identifies the question a file belongs to, ignoring qp/ms. */
  key: string;
}

/**
 * Cambridge's official past-paper naming, e.g.
 *
 *   0580_m25_qp_22_q07.jpg   question
 *   0580_m25_ms_22_q07.jpg   mark scheme
 *
 * The underscore between qp|ms and the variant is optional, and the question
 * number may be one or two digits. Anything after the question number (a
 * "-final", a " (1)" from a duplicate download) is ignored.
 */
const FILENAME_RE = /^0580_([msw])(\d{2})_(qp|ms)_?(\d{2})_q(\d{1,2})(?:\D|$)/i;

const SESSIONS: Record<string, ExamSitting> = {
  m: "Feb-March",
  s: "May-June",
  w: "Oct-Nov",
};

/** Extended tier only: 2x is non-calculator, 4x is calculator. */
const EXTENDED_VARIANTS = new Set([21, 22, 23, 41, 42, 43]);

export const questionKey = (
  year: number,
  sitting: ExamSitting,
  variant: number,
  questionNumber: number,
): string => `${year}|${sitting}|${variant}|${questionNumber}`;

export function parseExamFilename(filename: string): ParsedExamFilename | null {
  const base = filename.replace(/\.[^./]+$/, "");
  const m = base.match(FILENAME_RE);
  if (!m) return null;

  const sitting = SESSIONS[m[1].toLowerCase()];
  if (!sitting) return null;

  const variant = parseInt(m[4], 10);
  if (!EXTENDED_VARIANTS.has(variant)) return null;

  const year = 2000 + parseInt(m[2], 10);
  const questionNumber = parseInt(m[5], 10);
  if (!Number.isFinite(questionNumber) || questionNumber < 1) return null;

  return {
    year,
    sitting,
    variant,
    questionNumber,
    kind: m[3].toLowerCase() as ImageKind,
    key: questionKey(year, sitting, variant, questionNumber),
  };
}

/**
 * Deterministic storage path. Re-uploading a corrected crop overwrites the
 * same object rather than accumulating copies, and because the path never
 * changes the public URL stays stable — which is what lets the CDN cache it
 * across every student. (Supabase's Smart CDN invalidates on overwrite,
 * within about a minute.)
 */
export function examImagePath(parsed: ParsedExamFilename, originalName: string): string {
  const ext = (originalName.split(".").pop() || "jpg").toLowerCase();
  const qn = String(parsed.questionNumber).padStart(2, "0");
  return `0580/${parsed.year}/${parsed.sitting}/${parsed.variant}/q${qn}-${parsed.kind}.${ext}`;
}

/** Human-readable reference, e.g. "2025 Feb-March P22 Q7". */
export const examLabel = (p: {
  year: number;
  sitting: ExamSitting;
  variant: number;
  questionNumber: number;
}): string => `${p.year} ${p.sitting} P${p.variant} Q${p.questionNumber}`;
