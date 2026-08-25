import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { markWork, MAX_WORK_IMAGES, type MarkingResult } from "@/lib/marking";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Camera, Loader2, X, Sparkles, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

interface Props {
  questionId: string;
  marksAvailable: number;
}

export const MarkWork = ({ questionId, marksAvailable }: Props) => {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MarkingResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, MAX_WORK_IMAGES);
    setFiles(next);
    setPreviews((old) => {
      old.forEach((url) => URL.revokeObjectURL(url));
      return next.map((f) => URL.createObjectURL(f));
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeAt = (i: number) => {
    URL.revokeObjectURL(previews[i]);
    setFiles((f) => f.filter((_, n) => n !== i));
    setPreviews((p) => p.filter((_, n) => n !== i));
  };

  const reset = () => {
    previews.forEach((url) => URL.revokeObjectURL(url));
    setFiles([]);
    setPreviews([]);
    setResult(null);
    setFailure(null);
  };

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    setFailure(null);
    try {
      const marked = await markWork(user.id, questionId, files);
      setResult(marked);
      toast.success(`${marked.marksAwarded} / ${marked.marksAvailable} marks`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Marking failed.";
      setFailure(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Get your work marked</CardTitle>
          <CardDescription>
            Photograph your working and have it marked against the official mark scheme,
            part by part.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to={`/auth?redirect=/q/${questionId}`}>Sign in to get marked</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- result ----------------------------------------------------------------
  if (result) {
    const { marking, marksAwarded, marksAvailable: available, percentage } = result;
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Your marks</CardTitle>
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {marksAwarded}
                <span className="text-base font-normal text-muted-foreground">/{available}</span>
              </span>
              <Badge variant={percentage >= 80 ? "default" : percentage >= 50 ? "secondary" : "outline"}>
                {percentage}%
              </Badge>
            </div>
          </div>
          <Progress value={percentage} className="mt-2" />
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {marking.illegible && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Some of your working could not be read</AlertTitle>
              <AlertDescription>
                Try a sharper, better-lit photo taken straight on, then mark it again.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            {marking.parts.map((p, i) => (
              <div key={`${p.label}-${i}`} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">
                      {p.label === "whole" ? "Answer" : `(${p.label})`}
                    </span>
                    {p.mark_codes.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono text-[0.7rem]">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <span className="font-mono text-sm tabular-nums">
                    {p.marks_awarded}/{p.marks_available}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.comment}</p>
              </div>
            ))}
          </div>

          {marking.what_went_well && (
            <div>
              <h4 className="text-sm font-medium">What went well</h4>
              <p className="mt-1 text-sm text-muted-foreground">{marking.what_went_well}</p>
            </div>
          )}

          {marking.errors.length > 0 && (
            <div>
              <h4 className="text-sm font-medium">Where marks were lost</h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                {marking.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-md bg-muted p-3">
            <h4 className="text-sm font-medium">Do this next</h4>
            <p className="mt-1 text-sm">{marking.next_step}</p>
          </div>

          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Mark another attempt
            </Button>
            {result.balance !== null && (
              <span className="text-xs text-muted-foreground">
                {result.balance} credit{result.balance === 1 ? "" : "s"} left
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- submission form -------------------------------------------------------
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Get your work marked</CardTitle>
        <CardDescription>
          Photograph your working. It is marked against the official mark scheme, part by
          part, with method and accuracy marks judged the way an examiner would.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {failure && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Marking did not run</AlertTitle>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}

        {previews.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {previews.map((src, i) => (
              <div key={src} className="group relative">
                <img
                  src={src}
                  alt={`Your working, photo ${i + 1}`}
                  className="aspect-[3/4] w-full rounded-md border object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  disabled={busy}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-1 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy || files.length >= MAX_WORK_IMAGES}
          >
            <Camera className="mr-2 h-4 w-4" />
            {files.length === 0 ? "Add photos" : "Add another"}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || files.length === 0}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {busy ? "Marking…" : `Mark my work (${marksAvailable} marks)`}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {files.length}/{MAX_WORK_IMAGES} photos. Marking takes up to a minute — it reads
          your handwriting against the mark scheme rather than just checking the answer.
        </p>
      </CardContent>
    </Card>
  );
};
