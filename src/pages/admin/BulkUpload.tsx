import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { runBulkUpload, type BulkUploadResult } from "@/lib/bulkUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Loader2, UploadCloud, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const BulkUpload = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<BulkUploadResult | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    setBusy(true);
    setResult(null);
    setLog([`Reading ${files.length} file(s)…`]);
    setProgress({ done: 0, total: 0 });

    try {
      const res = await runBulkUpload(files, (done, total, message) => {
        setProgress({ done, total });
        setLog((l) => [...l.slice(-200), message]);
      });
      setResult(res);

      if (res.failedCount > 0) {
        toast.warning(`${res.publishedCount} published, ${res.failedCount} failed`);
      } else if (res.outcomes.length > 0) {
        toast.success(`${res.publishedCount} question(s) published`);
      } else {
        toast.error("No files matched the naming convention");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
      setLog((l) => [...l, `FAILED: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const staged = result?.outcomes.filter((o) => !o.error && !o.published) ?? [];
  const failed = result?.outcomes.filter((o) => o.error) ?? [];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
        <Button asChild variant="ghost" size="sm" className="self-start -ml-3">
          <Link to="/admin">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Question bank
          </Link>
        </Button>

        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Bulk upload</h1>
          <p className="max-w-prose text-muted-foreground">
            Select your clipped images. Metadata is read from each filename and matched
            against the question index — nothing needs typing in.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Naming</CardTitle>
            <CardDescription>Files that don&rsquo;t match this pattern are skipped.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="rounded-md border bg-muted/40 p-3 font-mono text-sm">
              <div>0580_m25_qp_22_q07.jpg &nbsp;&larr; question</div>
              <div>0580_m25_ms_22_q07.jpg &nbsp;&larr; mark scheme</div>
            </div>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              <li>
                <span className="font-mono">m</span> = Feb&ndash;March,{" "}
                <span className="font-mono">s</span> = May&ndash;June,{" "}
                <span className="font-mono">w</span> = Oct&ndash;Nov
              </li>
              <li>
                Extended variants: <span className="font-mono">21 22 23</span> non-calculator,{" "}
                <span className="font-mono">41 42 43</span> calculator
              </li>
              <li>A question is published once both its images are present</li>
              <li>Re-uploading a corrected crop replaces the old one</li>
            </ul>
          </CardContent>
        </Card>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button size="lg" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <UploadCloud className="mr-2 h-4 w-4" />
          )}
          {busy ? "Uploading…" : "Choose images"}
        </Button>

        {busy && progress.total > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Uploading</span>
              <span className="font-mono tabular-nums">
                {progress.done} / {progress.total}
              </span>
            </div>
            <Progress value={Math.round((progress.done / progress.total) * 100)} />
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {result.publishedCount} published
              </Badge>
              {staged.length > 0 && (
                <Badge variant="secondary">{staged.length} awaiting mark scheme</Badge>
              )}
              {result.skipped.length > 0 && (
                <Badge variant="outline">{result.skipped.length} skipped</Badge>
              )}
              {failed.length > 0 && <Badge variant="destructive">{failed.length} failed</Badge>}
            </div>

            {failed.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Some questions did not upload</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {failed.slice(0, 12).map((f) => (
                      <li key={f.key}>
                        <span className="font-medium">{f.label}</span> — {f.error}
                      </li>
                    ))}
                    {failed.length > 12 && <li>…and {failed.length - 12} more</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {result.skipped.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Skipped files</AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {result.skipped.slice(0, 12).map((s) => (
                      <li key={s.filename}>
                        <span className="font-mono text-xs">{s.filename}</span> — {s.reason}
                      </li>
                    ))}
                    {result.skipped.length > 12 && (
                      <li>…and {result.skipped.length - 12} more</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {staged.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Staged, not yet published</CardTitle>
                  <CardDescription>
                    These have one image but not both, so students cannot see them yet.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col gap-1 text-sm">
                    {staged.slice(0, 20).map((o) => (
                      <li key={o.key} className="flex justify-between gap-4">
                        <span>{o.label}</span>
                        <span className="text-muted-foreground">
                          {o.uploadedQuestion ? "question only" : "mark scheme only"}
                        </span>
                      </li>
                    ))}
                    {staged.length > 20 && (
                      <li className="text-muted-foreground">…and {staged.length - 20} more</li>
                    )}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {log.length > 0 && (
          <details className="rounded-md border">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
              Activity log
            </summary>
            <pre className="max-h-72 overflow-auto border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {log.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </main>
  );
};

export default BulkUpload;
