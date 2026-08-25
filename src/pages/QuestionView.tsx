import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchQuestionBank } from "@/lib/questionBank";
import { useProgress, CONFIDENCE_LABELS, type Confidence } from "@/hooks/useProgress";
import { AppHeader } from "@/components/AppHeader";
import { MarkWork } from "@/components/MarkWork";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  PenLine,
  Eye,
  EyeOff,
  CheckCircle2,
} from "lucide-react";

const CONFIDENCES: Confidence[] = ["easy", "ok", "struggled"];

const QuestionView = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["question-bank"],
    queryFn: fetchQuestionBank,
    staleTime: 5 * 60 * 1000,
  });
  const { progress, setConfidence, isLocalOnly } = useProgress();
  const [showMarkscheme, setShowMarkscheme] = useState(false);

  const { question, prev, next } = useMemo(() => {
    if (!data || !id) return { question: null, prev: null, next: null };
    const i = data.questions.findIndex((q) => q.id === id);
    if (i === -1) return { question: null, prev: null, next: null };
    return {
      question: data.questions[i],
      prev: i > 0 ? data.questions[i - 1] : null,
      next: i < data.questions.length - 1 ? data.questions[i + 1] : null,
    };
  }, [data, id]);

  const topic = question?.topicId ? data?.topicsById.get(question.topicId) : null;
  const done = question ? progress[question.id] : undefined;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96 w-full" />
        </main>
      </div>
    );
  }

  // Without this the skeleton above would show indefinitely on a failed load,
  // which reads as a hung page rather than a problem the reader can act on.
  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8">
          <Alert variant="destructive">
            <AlertTitle>Could not load this question</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : String(error)}
            </AlertDescription>
          </Alert>
          <Button asChild variant="outline" className="self-start">
            <Link to="/">Back to practice</Link>
          </Button>
        </main>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto flex max-w-4xl flex-col items-center gap-4 px-6 py-16 text-center">
          <h1 className="text-2xl font-bold">Question not found</h1>
          <p className="text-muted-foreground">
            It may not be published yet, or the link may be out of date.
          </p>
          <Button asChild>
            <Link to="/">Back to practice</Link>
          </Button>
        </main>
      </div>
    );
  }

  // Revealing the mark scheme is per-question: moving on must re-hide it.
  const goTo = (questionId: string) => {
    setShowMarkscheme(false);
    navigate(`/q/${questionId}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-8">
        <Button asChild variant="ghost" size="sm" className="-ml-3 self-start">
          <Link to="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All questions
          </Link>
        </Button>

        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{question.reference}</span>
            {question.calculator ? (
              <Badge variant="outline" className="gap-1">
                <Calculator className="h-3 w-3" />
                Calculator
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <PenLine className="h-3 w-3" />
                Non-calculator
              </Badge>
            )}
            <Badge variant="secondary">
              {question.marks} mark{question.marks === 1 ? "" : "s"}
            </Badge>
            {topic && <Badge variant="outline">{topic.name}</Badge>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {question.subtopicCodes.map((code) => {
              const sub = data?.subtopicsByCode.get(code);
              return (
                <span
                  key={code}
                  className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  <span className="font-mono">{code}</span>
                  {sub ? ` ${sub.title}` : ""}
                </span>
              );
            })}
          </div>
        </header>

        {/* ---- the question ---- */}
        {question.questionImageUrl ? (
          <img
            src={question.questionImageUrl}
            alt={`Question ${question.questionNumber}`}
            className="w-full rounded-lg border bg-white"
            loading="eager"
          />
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No question image available.
            </CardContent>
          </Card>
        )}

        {question.parts.length > 1 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Parts</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1.5 text-sm">
                {question.parts.map((p) => (
                  <li key={p.position} className="flex gap-3">
                    <span className="w-12 shrink-0 font-mono text-muted-foreground">
                      {p.label ?? "—"}
                    </span>
                    <span className="flex-1">{p.description}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                      [{p.marks}]
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* ---- mark scheme ---- */}
        <div className="flex flex-col gap-3">
          <Button
            variant={showMarkscheme ? "outline" : "default"}
            onClick={() => setShowMarkscheme((s) => !s)}
            className="self-start"
          >
            {showMarkscheme ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" />
                Hide mark scheme
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" />
                Show mark scheme
              </>
            )}
          </Button>

          {showMarkscheme &&
            (question.markschemeImageUrl ? (
              <img
                src={question.markschemeImageUrl}
                alt={`Mark scheme for question ${question.questionNumber}`}
                className="w-full rounded-lg border bg-white"
              />
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No mark scheme image available.
                </CardContent>
              </Card>
            ))}
        </div>

        <Separator />

        {/* ---- AI marking ---- */}
        <MarkWork questionId={question.id} marksAvailable={question.marks} />

        <Separator />

        {/* ---- self-assessment ---- */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">How did you find it?</span>
            {done && <CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
          </div>
          <div className="flex flex-wrap gap-2">
            {CONFIDENCES.map((c) => (
              <Button
                key={c}
                size="sm"
                variant={done === c ? "default" : "outline"}
                onClick={() => void setConfidence(question.id, done === c ? null : c)}
              >
                {CONFIDENCE_LABELS[c]}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {isLocalOnly
              ? "Saved in this browser. Sign in to sync across devices."
              : "Saved to your account."}
          </p>
        </div>

        <Separator />

        <nav className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={!prev}
            onClick={() => prev && goTo(prev.id)}
            className="flex-1 sm:flex-none"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!next}
            onClick={() => next && goTo(next.id)}
            className="flex-1 sm:flex-none"
          >
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </nav>
      </main>
    </div>
  );
};

export default QuestionView;
