import { supabase } from "@/integrations/supabase/client";
import { examImageUrl } from "@/lib/bulkUpload";
import type { Enums } from "@/integrations/supabase/types";

export type ExamSitting = Enums<"exam_sitting">;
export type Dependency = Enums<"question_dependency">;

export interface Topic {
  id: string;
  sectionNumber: number;
  name: string;
}

export interface Subtopic {
  id: string;
  topicId: string;
  code: string;
  title: string;
  position: number;
}

export interface QuestionPart {
  label: string | null;
  description: string;
  marks: number;
  position: number;
}

export interface Question {
  id: string;
  year: number;
  sitting: ExamSitting;
  variant: number;
  paper: number;
  calculator: boolean;
  questionNumber: number;
  marks: number;
  summary: string | null;
  hasDiagram: boolean;
  dependency: Dependency;
  topicId: string | null;
  questionImageUrl: string | null;
  markschemeImageUrl: string | null;
  parts: QuestionPart[];
  subtopicCodes: string[];
  /** "2025 Feb-March · P22 · Q7" */
  reference: string;
}

export interface QuestionBank {
  topics: Topic[];
  subtopics: Subtopic[];
  questions: Question[];
  subtopicsByCode: Map<string, Subtopic>;
  topicsById: Map<string, Topic>;
}

/**
 * Loaded as four flat queries and joined here rather than with nested
 * PostgREST embeds. The whole published bank is a few hundred rows, so the
 * saving from server-side embedding is negligible, and flat selects keep the
 * failure modes obvious — a broken embed alias fails at runtime in a way a
 * type checker cannot catch.
 */
export async function fetchQuestionBank(): Promise<QuestionBank> {
  const [topicsRes, subtopicsRes, questionsRes] = await Promise.all([
    supabase.from("topics").select("id, section_number, name").order("section_number"),
    supabase.from("subtopics").select("id, topic_id, code, title, position"),
    supabase
      .from("questions")
      // Must stay a single string literal: supabase-js infers the row shape
      // from it at compile time, and a concatenated expression degrades to an
      // untyped result.
      .select(
        "id, year, sitting, variant, paper, calculator, question_number, marks, summary, has_diagram, dependency, primary_topic_id, question_image_path, markscheme_image_path",
      )
      .eq("is_published", true)
      .order("year")
      .order("variant")
      .order("question_number"),
  ]);

  // Supabase returns a PostgrestError object, not an Error instance, so
  // rethrowing it directly renders as "[object Object]" wherever a component
  // stringifies it. Wrap it once here so every caller gets a real message.
  const raise = (what: string, e: { message: string; hint?: string | null }): never => {
    throw new Error(`${what}: ${e.message}${e.hint ? ` (${e.hint})` : ""}`);
  };

  if (topicsRes.error) raise("Could not load topics", topicsRes.error);
  if (subtopicsRes.error) raise("Could not load subtopics", subtopicsRes.error);
  if (questionsRes.error) raise("Could not load questions", questionsRes.error);

  const questionIds = (questionsRes.data ?? []).map((q) => q.id);

  // Parts and subtopic links are only fetched for questions we can actually
  // see; RLS would filter them anyway, but this keeps the payload honest.
  const [partsRes, linksRes] = await Promise.all([
    questionIds.length
      ? supabase
          .from("question_parts")
          .select("question_id, label, description, marks, position")
          .in("question_id", questionIds)
          .order("position")
      : Promise.resolve({ data: [], error: null } as const),
    questionIds.length
      ? supabase
          .from("question_subtopics")
          .select("question_id, subtopic_id, is_primary")
          .in("question_id", questionIds)
      : Promise.resolve({ data: [], error: null } as const),
  ]);

  if (partsRes.error) raise("Could not load question parts", partsRes.error);
  if (linksRes.error) raise("Could not load subtopic links", linksRes.error);

  const topics: Topic[] = (topicsRes.data ?? []).map((t) => ({
    id: t.id,
    sectionNumber: t.section_number,
    name: t.name,
  }));

  const subtopics: Subtopic[] = (subtopicsRes.data ?? []).map((s) => ({
    id: s.id,
    topicId: s.topic_id,
    code: s.code,
    title: s.title,
    position: s.position,
  }));

  const subtopicsById = new Map(subtopics.map((s) => [s.id, s]));

  const partsByQuestion = new Map<string, QuestionPart[]>();
  for (const p of partsRes.data ?? []) {
    const list = partsByQuestion.get(p.question_id) ?? [];
    list.push({ label: p.label, description: p.description, marks: p.marks, position: p.position });
    partsByQuestion.set(p.question_id, list);
  }

  // Primary subtopic first, then the rest in syllabus order.
  const codesByQuestion = new Map<string, string[]>();
  for (const l of linksRes.data ?? []) {
    const sub = subtopicsById.get(l.subtopic_id);
    if (!sub) continue;
    const list = codesByQuestion.get(l.question_id) ?? [];
    if (l.is_primary) list.unshift(sub.code);
    else list.push(sub.code);
    codesByQuestion.set(l.question_id, list);
  }

  const questions: Question[] = (questionsRes.data ?? []).map((q) => ({
    id: q.id,
    year: q.year,
    sitting: q.sitting,
    variant: q.variant,
    paper: q.paper ?? Math.floor(q.variant / 10),
    calculator: q.calculator ?? q.variant >= 40,
    questionNumber: q.question_number,
    marks: q.marks,
    summary: q.summary,
    hasDiagram: q.has_diagram,
    dependency: q.dependency,
    topicId: q.primary_topic_id,
    questionImageUrl: examImageUrl(q.question_image_path),
    markschemeImageUrl: examImageUrl(q.markscheme_image_path),
    parts: (partsByQuestion.get(q.id) ?? []).sort((a, b) => a.position - b.position),
    subtopicCodes: codesByQuestion.get(q.id) ?? [],
    reference: `${q.year} ${q.sitting} · P${q.variant} · Q${q.question_number}`,
  }));

  return {
    topics,
    subtopics,
    questions,
    subtopicsByCode: new Map(subtopics.map((s) => [s.code, s])),
    topicsById: new Map(topics.map((t) => [t.id, t])),
  };
}

export interface QuestionFilters {
  topicId: string | null;
  calculator: "all" | "yes" | "no";
  paperKey: string | null; // "2025|Feb-March|22"
  search: string;
}

export const emptyFilters: QuestionFilters = {
  topicId: null,
  calculator: "all",
  paperKey: null,
  search: "",
};

export const paperKeyOf = (q: Question) => `${q.year}|${q.sitting}|${q.variant}`;

export const paperLabel = (key: string) => {
  const [year, sitting, variant] = key.split("|");
  return `${year} ${sitting} · P${variant}`;
};

/** Match against the summary, part descriptions, syllabus codes and reference. */
function matchesSearch(q: Question, needle: string): boolean {
  const haystack = [
    q.summary ?? "",
    q.reference,
    ...q.subtopicCodes,
    ...q.parts.map((p) => p.description),
  ]
    .join(" ")
    .toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

export function filterQuestions(questions: Question[], f: QuestionFilters): Question[] {
  return questions.filter((q) => {
    if (f.topicId && q.topicId !== f.topicId) return false;
    if (f.calculator === "yes" && !q.calculator) return false;
    if (f.calculator === "no" && q.calculator) return false;
    if (f.paperKey && paperKeyOf(q) !== f.paperKey) return false;
    if (f.search.trim() && !matchesSearch(q, f.search.trim())) return false;
    return true;
  });
}
