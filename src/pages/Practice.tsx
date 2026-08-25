import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  emptyFilters,
  fetchQuestionBank,
  filterQuestions,
  paperKeyOf,
  paperLabel,
  type QuestionFilters,
} from "@/lib/questionBank";
import { useProgress, CONFIDENCE_LABELS } from "@/hooks/useProgress";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Search, X, Calculator, PenLine, Image as ImageIcon, CheckCircle2 } from "lucide-react";

const Practice = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ["question-bank"],
    queryFn: fetchQuestionBank,
    staleTime: 5 * 60 * 1000,
  });
  const { progress, isLocalOnly, completedCount } = useProgress();
  const [filters, setFilters] = useState<QuestionFilters>(emptyFilters);

  // What the input shows updates instantly; what we filter on lags by a beat.
  // Without this every keystroke re-filters the whole bank and rebuilds the
  // list, which makes typing feel like wading.
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchInput })), 150);
    return () => clearTimeout(t);
  }, [searchInput]);

  const set = <K extends keyof QuestionFilters>(k: K, v: QuestionFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const papers = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.questions.map(paperKeyOf))].sort();
  }, [data]);

  const visible = useMemo(
    () => (data ? filterQuestions(data.questions, filters) : []),
    [data, filters],
  );

  // 347 questions is ~3,500 DOM nodes if they all render at once, which costs
  // far more than the fetch does. Show a screenful and grow on demand.
  const PAGE = 40;
  const [shown, setShown] = useState(PAGE);
  const resultKey = `${filters.topicId}|${filters.calculator}|${filters.paperKey}|${filters.search}`;
  const lastKey = useRef(resultKey);
  if (lastKey.current !== resultKey) {
    lastKey.current = resultKey;
    if (shown !== PAGE) setShown(PAGE);
  }
  const rendered = visible.slice(0, shown);

  // Only offer topics that actually have published questions.
  const topicsWithCounts = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const q of data.questions) {
      if (q.topicId) counts.set(q.topicId, (counts.get(q.topicId) ?? 0) + 1);
    }
    return data.topics
      .filter((t) => counts.has(t.id))
      .map((t) => ({ ...t, count: counts.get(t.id) ?? 0 }));
  }, [data]);

  const filtersActive =
    filters.topicId !== null ||
    filters.calculator !== "all" ||
    filters.paperKey !== null ||
    searchInput.trim() !== "";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Past-paper practice</h1>
            <p className="text-sm text-muted-foreground">
              Questions and mark schemes are free for everyone.
            </p>
          </div>
          {completedCount > 0 && (
            <Badge variant="secondary" className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {completedCount} marked done
            </Badge>
          )}
        </div>

        {isLocalOnly && completedCount > 0 && (
          <Alert>
            <AlertTitle>Progress is saved in this browser only</AlertTitle>
            <AlertDescription>
              <Link to="/auth" className="underline">
                Create an account
              </Link>{" "}
              and your ticks will carry over and sync across devices.
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not load questions</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : String(error)}
            </AlertDescription>
          </Alert>
        )}

        {/* ---- filters ---- */}
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search — try 'trapezium', 'E1.11', or 'recurring decimal'"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={filters.topicId === null ? "default" : "outline"}
              onClick={() => set("topicId", null)}
            >
              All topics
            </Button>
            {topicsWithCounts.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={filters.topicId === t.id ? "default" : "outline"}
                onClick={() => set("topicId", filters.topicId === t.id ? null : t.id)}
              >
                {t.name}
                <span className="ml-1.5 text-xs opacity-70">{t.count}</span>
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["all", "Any paper type"],
                ["no", "Non-calculator"],
                ["yes", "Calculator"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={filters.calculator === value ? "secondary" : "ghost"}
                onClick={() => set("calculator", value)}
              >
                {label}
              </Button>
            ))}

            {papers.length > 1 && (
              <>
                <span className="mx-1 h-4 w-px bg-border" />
                {papers.map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={filters.paperKey === key ? "secondary" : "ghost"}
                    onClick={() => set("paperKey", filters.paperKey === key ? null : key)}
                  >
                    {paperLabel(key)}
                  </Button>
                ))}
              </>
            )}

            {filtersActive && (
              <Button size="sm" variant="ghost" onClick={() => {
                setSearchInput("");
                setFilters(emptyFilters);
              }}>
                <X className="mr-1.5 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* ---- results ---- */}
        {error ? null : isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : data && data.questions.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No questions are published yet.
            </CardContent>
          </Card>
        ) : visible.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-muted-foreground">Nothing matches those filters.</p>
              <Button variant="outline" size="sm" onClick={() => {
                setSearchInput("");
                setFilters(emptyFilters);
              }}>
                Clear filters
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {visible.length} question{visible.length === 1 ? "" : "s"}
              {rendered.length < visible.length && ` · showing ${rendered.length}`}
            </p>
            <ul className="flex flex-col gap-2">
              {rendered.map((q) => {
                const done = progress[q.id];
                return (
                  <li key={q.id}>
                    <Link
                      to={`/q/${q.id}`}
                      className="block rounded-lg border bg-card p-4 transition-colors hover:border-foreground/25 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              {q.reference}
                            </span>
                            {q.calculator ? (
                              <Badge variant="outline" className="gap-1 text-[0.7rem]">
                                <Calculator className="h-3 w-3" />
                                Calculator
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 text-[0.7rem]">
                                <PenLine className="h-3 w-3" />
                                Non-calc
                              </Badge>
                            )}
                            {q.hasDiagram && (
                              <Badge variant="outline" className="gap-1 text-[0.7rem]">
                                <ImageIcon className="h-3 w-3" />
                                Diagram
                              </Badge>
                            )}
                            {done && (
                              <Badge className="gap-1 text-[0.7rem]">
                                <CheckCircle2 className="h-3 w-3" />
                                {CONFIDENCE_LABELS[done]}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1.5 text-sm">
                            {q.summary ??
                              q.parts.map((p) => p.description).join(" · ") ??
                              "Question"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {q.subtopicCodes.map((code) => (
                              <span
                                key={code}
                                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground"
                              >
                                {code}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-sm font-semibold tabular-nums">
                            {q.marks}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            mark{q.marks === 1 ? "" : "s"}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {rendered.length < visible.length && (
              <div className="flex flex-col items-center gap-2 pb-4">
                <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                  Show {Math.min(PAGE, visible.length - rendered.length)} more
                </Button>
                <button
                  type="button"
                  onClick={() => setShown(visible.length)}
                  className="text-xs text-muted-foreground underline underline-offset-2"
                >
                  Show all {visible.length}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Practice;
