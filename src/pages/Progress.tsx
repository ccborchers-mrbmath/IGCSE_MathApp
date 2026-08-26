import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchQuestionBank } from "@/lib/questionBank";
import {
  BAND_LABEL,
  BAND_ORDER,
  SORTS,
  bandForQuestion,
  buildProgress,
  countBands,
  nextQuestion,
  questionPct,
  sortQuestions,
  type Band,
  type ProgressRow,
  type QuestionSort,
} from "@/lib/progress";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// One place where a band becomes classes, so the row, the tile and the summary
// can never drift apart.
const STRIPE: Record<Band, string> = {
  g: "bg-band-g-bar",
  a: "bg-band-a-bar",
  r: "bg-band-r-bar",
  u: "bg-band-u-bar",
  e: "",
};
const SCORE: Record<Band, string> = {
  g: "text-band-g-fg bg-band-g-bg",
  a: "text-band-a-fg bg-band-a-bg",
  r: "text-band-r-fg bg-band-r-bg",
  u: "text-band-u-fg bg-band-u-bg",
  e: "text-band-e-fg border border-dashed border-band-e-bar",
};
const TILE: Record<Band, string> = {
  g: "bg-band-g-bg text-band-g-fg",
  a: "bg-band-a-bg text-band-a-fg",
  r: "bg-band-r-bg text-band-r-fg",
  u: "bg-band-u-bg text-band-u-fg",
  e: "",
};
const STAT_N: Record<Band, string> = {
  g: "text-band-g-fg",
  a: "text-band-a-fg",
  r: "text-band-r-fg",
  u: "text-band-u-fg",
  e: "text-band-e-fg",
};

async function fetchAttempts(userId: string) {
  const { data, error } = await supabase
    .from("student_attempts")
    .select("question_id, marks_awarded, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load your attempts: ${error.message}`);
  return (data ?? []).map((a) => ({
    questionId: a.question_id,
    marksAwarded: Number(a.marks_awarded ?? 0),
    at: new Date(a.created_at).getTime(),
  }));
}

const Progress = () => {
  const { user } = useAuth();

  const bankQ = useQuery({
    queryKey: ["question-bank"],
    queryFn: fetchQuestionBank,
    staleTime: 5 * 60 * 1000,
  });
  const attemptsQ = useQuery({
    queryKey: ["attempts", user?.id],
    queryFn: () => fetchAttempts(user!.id),
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const [filter, setFilter] = useState<Band | null>(null);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [hideUnattempted, setHideUnattempted] = useState(false);
  const [sort, setSort] = useState<QuestionSort>("ref");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const sections = useMemo(
    () => (bankQ.data ? buildProgress(bankQ.data, attemptsQ.data ?? []) : []),
    [bankQ.data, attemptsQ.data],
  );
  const counts = useMemo(() => countBands(sections), [sections]);

  const isVisible = (r: ProgressRow) => {
    if (filter) return r.band === filter;
    if (needsOnly) return r.band === "r" || r.band === "a" || r.band === "u";
    return true;
  };

  const anyOpen = Object.values(open).some(Boolean);
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  const shownRows = sections.reduce((n, s) => n + s.rows.filter(isVisible).length, 0);
  const totalQuestions = bankQ.data?.questions.length ?? 0;

  const clearFilters = () => {
    setFilter(null);
    setNeedsOnly(false);
  };

  if (bankQ.isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  if (bankQ.error) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-7xl px-6 py-8">
          <Alert variant="destructive">
            <AlertTitle>Could not load your progress</AlertTitle>
            <AlertDescription>
              {bankQ.error instanceof Error ? bankQ.error.message : String(bankQ.error)}
            </AlertDescription>
          </Alert>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-6 py-8 pb-16">
        <h1 className="text-2xl font-bold tracking-tight">Your progress</h1>
        <p className="mt-1 max-w-[74ch] text-sm text-muted-foreground">
          Every subtopic in the Extended syllabus. The colour is the judgement; open a
          subtopic to see the questions it rests on and pick your next one.
        </p>

        {!user && (
          <Alert className="mt-4">
            <AlertTitle>You are not signed in</AlertTitle>
            <AlertDescription>
              This grid is built from marked attempts.{" "}
              <Link to="/auth?redirect=/progress" className="underline">
                Sign in
              </Link>{" "}
              to see your own, or browse the syllabus coverage below.
            </AlertDescription>
          </Alert>
        )}

        {/* ---- summary ---- */}
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          {BAND_ORDER.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={filter === b}
              onClick={() => {
                setFilter((f) => (f === b ? null : b));
                setNeedsOnly(false);
              }}
              className={cn(
                "rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-muted-foreground",
                filter === b && "border-primary ring-2 ring-primary/20",
              )}
            >
              <div className={cn("text-2xl font-semibold tabular-nums leading-tight", STAT_N[b])}>
                {counts[b]}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{BAND_LABEL[b]}</div>
            </button>
          ))}
        </div>

        {/* ---- toolbar ---- */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
          <label className="flex cursor-pointer select-none items-center gap-2 rounded-md border bg-card px-3 py-1.5">
            <Checkbox
              checked={needsOnly}
              onCheckedChange={(v) => {
                setNeedsOnly(v === true);
                if (v === true) setFilter(null);
              }}
            />
            Show only what needs work
          </label>

          <span className="text-muted-foreground/70">Order questions by</span>
          <span className="inline-flex overflow-hidden rounded-md border bg-card">
            {SORTS.map(([value, label], i) => (
              <button
                key={value}
                type="button"
                aria-pressed={sort === value}
                onClick={() => setSort(value)}
                className={cn(
                  "px-2.5 py-1.5 text-xs",
                  i > 0 && "border-l",
                  sort === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent/10",
                )}
              >
                {label}
              </button>
            ))}
          </span>

          <label className="flex cursor-pointer select-none items-center gap-2 rounded-md border bg-card px-3 py-1.5">
            <Checkbox
              checked={hideUnattempted}
              onCheckedChange={(v) => setHideUnattempted(v === true)}
            />
            Hide unattempted
          </label>

          <button
            type="button"
            onClick={() => {
              if (anyOpen) setOpen({});
              else {
                const all: Record<string, boolean> = {};
                for (const s of sections) {
                  for (const r of s.rows) if (r.band !== "e") all[r.code] = true;
                }
                setOpen(all);
              }
            }}
            className="text-primary underline"
          >
            {anyOpen ? "Close all" : "Open all"}
          </button>

          <span className="text-muted-foreground/70">
            {filter ? (
              <>
                · {BAND_LABEL[filter].toLowerCase()} only{" "}
                <button type="button" onClick={clearFilters} className="text-primary underline">
                  show all
                </button>
              </>
            ) : needsOnly ? (
              <>
                · hiding secure{" "}
                <button type="button" onClick={clearFilters} className="text-primary underline">
                  show all
                </button>
              </>
            ) : (
              `· ${totalRows} subtopics, ${totalQuestions} questions`
            )}
          </span>
        </div>

        {/* ---- the grid ----
            CSS multi-column rather than a fixed section-to-column map: it
            balances the columns by height on its own and keeps reading order
            top-to-bottom, so no resize listener is needed. */}
        {shownRows === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">Nothing matches that filter.</p>
        ) : (
          <div className="mt-4 gap-3.5 [column-fill:balance] lg:columns-2 xl:columns-3">
            {sections.map((section) => {
              const rows = section.rows.filter(isVisible);
              if (!rows.length) return null;
              const c = countBands([section]);
              const tot = section.rows.length;

              return (
                <section
                  key={section.number}
                  className="mb-3.5 break-inside-avoid overflow-hidden rounded-lg border bg-card shadow-sm"
                >
                  <header className="border-b px-3 pb-2.5 pt-3">
                    <div className="flex items-baseline justify-between gap-2.5">
                      <h2 className="text-sm font-semibold">
                        {section.number}. {section.name}
                      </h2>
                      <span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                        {rows.length}
                        {rows.length !== tot && ` of ${tot}`}
                      </span>
                    </div>
                    {/* Composition of the whole section, not just the filtered rows,
                        so the bar does not change shape as you filter. */}
                    <div className="mt-2 flex h-[5px] overflow-hidden rounded-sm bg-muted">
                      {BAND_ORDER.map((b) =>
                        c[b] ? (
                          <i
                            key={b}
                            className={cn("block h-full", STRIPE[b] || "bg-band-e-bar")}
                            style={{ width: `${(100 * c[b]) / tot}%` }}
                          />
                        ) : null,
                      )}
                    </div>
                  </header>

                  {rows.map((row, i) => (
                    <SubtopicRow
                      key={row.code}
                      row={row}
                      first={i === 0}
                      open={!!open[row.code]}
                      sort={sort}
                      hideUnattempted={hideUnattempted}
                      onToggle={() =>
                        setOpen((o) => ({ ...o, [row.code]: !o[row.code] }))
                      }
                    />
                  ))}
                </section>
              );
            })}
          </div>
        )}

        <Legend />
      </main>
    </div>
  );
};

interface RowProps {
  row: ProgressRow;
  first: boolean;
  open: boolean;
  sort: QuestionSort;
  hideUnattempted: boolean;
  onToggle: () => void;
}

const SubtopicRow = ({ row, first, open, sort, hideUnattempted, onToggle }: RowProps) => {
  const empty = row.band === "e";
  const score = empty ? "none" : row.band === "u" ? "—" : `${Math.round((100 * row.got) / row.poss)}%`;

  return (
    <div className={cn(!first && "border-t", open && "bg-accent/5")}>
      <button
        type="button"
        disabled={empty}
        aria-expanded={empty ? undefined : open}
        onClick={empty ? undefined : onToggle}
        className={cn(
          "flex w-full items-center gap-2 pr-2.5 text-left",
          "min-h-[34px]",
          !empty && "cursor-pointer hover:bg-accent/10",
          empty && "cursor-default",
        )}
      >
        <span
          className={cn("w-1 self-stretch", STRIPE[row.band])}
          style={
            empty
              ? {
                  backgroundImage:
                    "repeating-linear-gradient(135deg, hsl(var(--band-e-bar)) 0 3px, transparent 3px 6px)",
                }
              : undefined
          }
        />
        <span
          className={cn(
            "w-11 shrink-0 font-mono text-[11px]",
            empty ? "text-band-e-fg" : "text-muted-foreground",
          )}
        >
          {row.code}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12.5px]",
            empty ? "text-band-e-fg" : row.band === "u" && "text-muted-foreground",
          )}
        >
          {row.title}
        </span>
        {!empty && (
          <span className="whitespace-nowrap font-mono text-[10px] tabular-nums text-muted-foreground">
            {row.qDone}/{row.qTotal}
          </span>
        )}
        <span
          className={cn(
            "whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
            SCORE[row.band],
          )}
        >
          {score}
        </span>
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            empty && "invisible",
          )}
        />
      </button>

      {open && !empty && (
        <QuestionPanel row={row} sort={sort} hideUnattempted={hideUnattempted} />
      )}
    </div>
  );
};

const QuestionPanel = ({
  row,
  sort,
  hideUnattempted,
}: {
  row: ProgressRow;
  sort: QuestionSort;
  hideUnattempted: boolean;
}) => {
  const next = nextQuestion(row);
  const list = sortQuestions(row.questions, sort).filter(
    (q) => !(hideUnattempted && q.got === null),
  );

  return (
    <div className="border-t bg-muted/40 px-3 pb-3 pt-2.5">
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        <span>
          <b className="font-semibold text-foreground/80">{row.qDone}</b> of{" "}
          <b className="font-semibold text-foreground/80">{row.qTotal}</b> questions attempted
        </span>
        {row.poss > 0 && (
          <span>
            <b className="font-semibold text-foreground/80">{row.got}</b> of{" "}
            <b className="font-semibold text-foreground/80">{row.poss}</b> marks earned
          </span>
        )}
        <span>
          <b className="font-semibold text-foreground/80">{row.marksAvail}</b> marks available in
          total
        </span>
      </div>

      {list.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">
          No attempted questions on this subtopic yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((q) => {
            const b = bandForQuestion(q);
            const isNext = next !== null && q.id === next.id;
            const parts = q.label.split(" ");
            return (
              <Link
                key={`${q.id}-${q.label}`}
                to={`/q/${q.id}`}
                title={[
                  q.label,
                  `${q.totalMarks} mark${q.totalMarks === 1 ? "" : "s"}`,
                  q.multi ? `also ${q.otherCodes.join(", ")} — marks split evenly` : null,
                  q.got === null ? "not attempted" : `scored ${q.got}/${q.marks} on this code`,
                  q.calculator ? null : "non-calculator",
                  q.hasDiagram ? "has diagram" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                className={cn(
                  "relative w-20 rounded-md border border-transparent px-1 pb-1.5 pt-2 text-center transition-transform hover:-translate-y-px hover:shadow",
                  TILE[b],
                  isNext && "border-primary ring-2 ring-primary/20",
                )}
              >
                <div className="text-[13px] font-semibold leading-tight tabular-nums">
                  {q.got === null ? "—" : `${questionPct(q)}%`}
                </div>
                <div className="mt-0.5 font-mono text-[9px] leading-tight opacity-80">
                  {parts.slice(0, 3).join(" ")}
                  <br />
                  {parts[3]}
                </div>
                {isNext && (
                  <span className="absolute right-1 top-0.5 text-[8px] font-bold text-primary">
                    NEXT
                  </span>
                )}
                {q.multi && (
                  <span
                    className="absolute left-1 top-1 h-1 w-1 rounded-full bg-current opacity-50"
                    aria-hidden
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

const Legend = () => (
  <div className="mt-6 rounded-lg border bg-card p-4 shadow-sm">
    <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      How to read this
    </h3>
    <ul className="grid list-none grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-x-5 gap-y-2 p-0">
      {[
        ["g", <><b>80%+</b> of attempted marks</>],
        ["a", <><b>50–79%</b></>],
        ["r", <><b>Under 50%</b></>],
        ["u", <><b>Not attempted</b> — questions exist, none tried</>],
        ["e", <><b>No questions yet</b> — nothing in the bank covers this code</>],
      ].map(([b, text]) => (
        <li key={b as string} className="grid grid-cols-[14px_1fr] items-start gap-2.5 text-xs text-muted-foreground">
          <span
            className={cn("mt-0.5 h-3.5 w-3.5 rounded-sm", STRIPE[b as Band])}
            style={
              b === "e"
                ? {
                    backgroundImage:
                      "repeating-linear-gradient(135deg, hsl(var(--band-e-bar)) 0 3px, transparent 3px 6px)",
                    border: "1px dashed hsl(var(--band-e-bar))",
                  }
                : undefined
            }
          />
          <div>{text}</div>
        </li>
      ))}
    </ul>
    <p className="mt-3 border-t pt-2.5 text-xs text-muted-foreground">
      The count beside each score (<span className="font-mono">3/17</span>) is questions attempted
      out of questions available — a subtopic resting on one question shows it.{" "}
      <b>NEXT</b> marks the suggested question: the first unattempted one, or the weakest attempt
      if all are done. A <b>•</b> on a tile means the question also carries another syllabus code,
      so its marks are <b>split evenly</b> between them — the syllabus index tags whole questions,
      not individual parts, so there is no basis for a finer split.
    </p>
  </div>
);

export default Progress;
