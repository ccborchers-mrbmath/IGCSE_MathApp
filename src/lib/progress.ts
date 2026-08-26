import type { Question, QuestionBank, Subtopic, Topic } from "@/lib/questionBank";

export type Band = "g" | "a" | "r" | "u" | "e";

export const BAND_LABEL: Record<Band, string> = {
  g: "Secure",
  a: "Nearly there",
  r: "Needs work",
  u: "Not attempted",
  e: "No questions yet",
};

/** Summary tiles read worst-first: what needs doing comes before what is done. */
export const BAND_ORDER: Band[] = ["r", "a", "g", "u", "e"];

export interface ProgressQuestion {
  id: string;
  label: string;
  /** Marks of this question attributed to the subtopic it is listed under. */
  marks: number;
  /** Marks the whole question carries, across every code it is tagged with. */
  totalMarks: number;
  /** True when the question is tagged with more than one syllabus code. */
  multi: boolean;
  otherCodes: string[];
  calculator: boolean;
  hasDiagram: boolean;
  /** Marks earned on this code, or null if never marked. */
  got: number | null;
  /** Epoch ms of the attempt used, for the "Recent" sort. */
  at: number | null;
}

export interface ProgressRow {
  code: string;
  title: string;
  section: number;
  sectionName: string;
  questions: ProgressQuestion[];
  /** Questions in the bank carrying this code. */
  qTotal: number;
  /** Of those, how many have been marked. */
  qDone: number;
  /** Marks earned, and marks that were on offer in the questions actually attempted. */
  got: number;
  poss: number;
  /**
   * Every mark this code could yield if all its questions were done. Rounded
   * to a whole mark: the split produces fractions, and "23 marks available"
   * is a truer thing to tell a student than "22.5".
   */
  marksAvail: number;
  band: Band;
}

export interface ProgressSection {
  number: number;
  name: string;
  rows: ProgressRow[];
}

/** One marked attempt per question — the caller passes the most recent. */
export interface AttemptSummary {
  questionId: string;
  marksAwarded: number;
  at: number;
}

/**
 * Band a subtopic by the share of *attempted* marks earned, never by coverage.
 *
 * Judging a subtopic on all its available marks would mean a student who
 * answered one question perfectly still saw red, which reads as a verdict on
 * them rather than on how much of the bank they have worked through. Coverage
 * is a separate number (qDone/qTotal) shown alongside.
 */
export function bandFor(got: number, poss: number, qDone: number, qTotal: number): Band {
  if (qTotal === 0) return "e";
  if (qDone === 0 || poss === 0) return "u";
  const p = got / poss;
  return p >= 0.8 ? "g" : p >= 0.5 ? "a" : "r";
}

export function bandForQuestion(q: ProgressQuestion): Band {
  if (q.got === null) return "u";
  const p = q.marks > 0 ? q.got / q.marks : 0;
  return p >= 0.8 ? "g" : p >= 0.5 ? "a" : "r";
}

export const questionPct = (q: ProgressQuestion): number =>
  q.marks > 0 && q.got !== null ? Math.round((100 * q.got) / q.marks) : 0;

/** "25 M/J P22 Q8" — compact enough for a tile two lines high. */
const SITTING_SHORT: Record<string, string> = {
  "Feb-March": "F/M",
  "May-June": "M/J",
  "Oct-Nov": "O/N",
};

export const questionLabel = (q: Question): string =>
  `${String(q.year).slice(2)} ${SITTING_SHORT[q.sitting] ?? q.sitting} P${q.variant} Q${q.questionNumber}`;

/** Round to one decimal without dragging float noise into the display. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Build the per-subtopic view of a student's progress.
 *
 * Mark attribution: a question tagged with more than one syllabus code has its
 * marks split evenly between them. The database records subtopic links per
 * *question*, not per part, so there is no basis for any finer division — the
 * index says a question tests E2.2 and E2.5, not which two of its five marks
 * belong to each. An even split keeps the totals honest (attributed marks sum
 * back to the paper totals) at the cost of assuming equal weight; attributing
 * the full marks to every code instead would double-count, and make a
 * subtopic's "marks available" exceed what the papers actually offer.
 */
export function buildProgress(bank: QuestionBank, attempts: AttemptSummary[]): ProgressSection[] {
  const latest = new Map<string, AttemptSummary>();
  for (const a of attempts) {
    const prev = latest.get(a.questionId);
    if (!prev || a.at > prev.at) latest.set(a.questionId, a);
  }

  const byCode = new Map<string, ProgressQuestion[]>();
  for (const sub of bank.subtopics) byCode.set(sub.code, []);

  for (const q of bank.questions) {
    const codes = q.subtopicCodes;
    if (codes.length === 0) continue;
    const share = q.marks / codes.length;
    const attempt = latest.get(q.id);

    for (const code of codes) {
      const list = byCode.get(code);
      if (!list) continue; // a link to a code outside the syllabus tree
      list.push({
        id: q.id,
        label: questionLabel(q),
        marks: r1(share),
        totalMarks: q.marks,
        multi: codes.length > 1,
        otherCodes: codes.filter((c) => c !== code),
        calculator: q.calculator,
        hasDiagram: q.hasDiagram,
        // The attempt is against the whole question, so the marks earned are
        // split on the same basis as the marks available. Guard the divide:
        // a zero-mark question would otherwise yield Infinity * 0 = NaN and
        // poison every total it touches.
        got: attempt ? (q.marks > 0 ? r1((attempt.marksAwarded / q.marks) * share) : 0) : null,
        at: attempt ? attempt.at : null,
      });
    }
  }

  const topicById = new Map<string, Topic>(bank.topics.map((t) => [t.id, t]));
  const sections = new Map<number, ProgressSection>();

  const ordered = [...bank.subtopics].sort((a, b) => a.position - b.position);
  for (const sub of ordered) {
    const topic = topicById.get(sub.topicId);
    const questions = byCode.get(sub.code) ?? [];

    let got = 0;
    let poss = 0;
    let qDone = 0;
    let marksAvail = 0;
    for (const q of questions) {
      marksAvail += q.marks;
      if (q.got !== null) {
        got += q.got;
        poss += q.marks;
        qDone += 1;
      }
    }

    const row: ProgressRow = {
      code: sub.code,
      title: sub.title,
      section: topic?.sectionNumber ?? 0,
      sectionName: topic?.name ?? "Other",
      questions,
      qTotal: questions.length,
      qDone,
      got: r1(got),
      poss: r1(poss),
      marksAvail: Math.round(marksAvail),
      band: bandFor(got, poss, qDone, questions.length),
    };

    const key = row.section;
    if (!sections.has(key)) {
      sections.set(key, { number: key, name: row.sectionName, rows: [] });
    }
    sections.get(key)!.rows.push(row);
  }

  return [...sections.values()].sort((a, b) => a.number - b.number);
}

export function countBands(sections: ProgressSection[]): Record<Band, number> {
  const c: Record<Band, number> = { g: 0, a: 0, r: 0, u: 0, e: 0 };
  for (const s of sections) for (const r of s.rows) c[r.band] += 1;
  return c;
}

export type QuestionSort = "ref" | "recent" | "weak" | "todo";

export const SORTS: [QuestionSort, string][] = [
  ["ref", "Reference"],
  ["recent", "Recent"],
  ["weak", "Weakest"],
  ["todo", "To do"],
];

export function sortQuestions(list: ProgressQuestion[], sort: QuestionSort): ProgressQuestion[] {
  if (sort === "ref") return list;
  const a = [...list];
  // Unattempted questions have no score and no date, so they sort last in every
  // order except "to do", where they are the whole point.
  if (sort === "recent") {
    return a.sort((x, y) => (x.at === null ? 1 : y.at === null ? -1 : y.at - x.at));
  }
  if (sort === "weak") {
    return a.sort((x, y) =>
      x.got === null ? 1 : y.got === null ? -1 : questionPct(x) - questionPct(y),
    );
  }
  return a.sort((x, y) => {
    const xu = x.got === null ? 0 : 1;
    const yu = y.got === null ? 0 : 1;
    return xu !== yu ? xu - yu : questionPct(x) - questionPct(y);
  });
}

/** The suggested question: first unattempted, else the weakest attempt. */
export function nextQuestion(row: ProgressRow): ProgressQuestion | null {
  const untried = row.questions.find((q) => q.got === null);
  if (untried) return untried;
  const attempted = row.questions.filter((q) => q.got !== null);
  if (!attempted.length) return null;
  return [...attempted].sort((x, y) => questionPct(x) - questionPct(y))[0];
}

export type { Subtopic };
