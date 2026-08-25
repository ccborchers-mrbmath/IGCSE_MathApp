import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Loader2, UploadCloud, RefreshCw } from "lucide-react";
import { AiCostPanel } from "@/components/admin/AiCostPanel";

interface PaperRow {
  year: number;
  sitting: string;
  variant: number;
  total: number;
  withQuestion: number;
  withMarkscheme: number;
  published: number;
}

interface Totals {
  total: number;
  withQuestion: number;
  withMarkscheme: number;
  published: number;
}

const AdminDashboard = () => {
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("questions")
      .select("year, sitting, variant, question_image_path, markscheme_image_path, is_published")
      .order("year")
      .order("variant");

    const grouped = new Map<string, PaperRow>();
    const agg: Totals = { total: 0, withQuestion: 0, withMarkscheme: 0, published: 0 };

    for (const r of data ?? []) {
      const key = `${r.year}|${r.sitting}|${r.variant}`;
      const row =
        grouped.get(key) ??
        {
          year: r.year,
          sitting: r.sitting,
          variant: r.variant,
          total: 0,
          withQuestion: 0,
          withMarkscheme: 0,
          published: 0,
        };
      row.total += 1;
      agg.total += 1;
      if (r.question_image_path) {
        row.withQuestion += 1;
        agg.withQuestion += 1;
      }
      if (r.markscheme_image_path) {
        row.withMarkscheme += 1;
        agg.withMarkscheme += 1;
      }
      if (r.is_published) {
        row.published += 1;
        agg.published += 1;
      }
      grouped.set(key, row);
    }

    setPapers([...grouped.values()]);
    setTotals(agg);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
              Admin
            </p>
            <h1 className="text-3xl font-bold tracking-tight">Question bank</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button asChild>
              <Link to="/admin/upload">
                <UploadCloud className="mr-2 h-4 w-4" />
                Bulk upload
              </Link>
            </Button>
          </div>
        </header>

        {loading || !totals ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading coverage…
          </p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Overall coverage</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {[
                  ["Question images", totals.withQuestion],
                  ["Mark scheme images", totals.withMarkscheme],
                  ["Published to students", totals.published],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{label}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {value as number} / {totals.total} ({pct(value as number, totals.total)}%)
                      </span>
                    </div>
                    <Progress value={pct(value as number, totals.total)} />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">By paper</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-6 py-2 font-medium">Paper</th>
                      <th className="px-3 py-2 font-medium">Questions</th>
                      <th className="px-3 py-2 font-medium">Q images</th>
                      <th className="px-3 py-2 font-medium">MS images</th>
                      <th className="px-6 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {papers.map((p) => {
                      const complete = p.published === p.total;
                      return (
                        <tr key={`${p.year}-${p.sitting}-${p.variant}`} className="border-b last:border-0">
                          <td className="px-6 py-2.5 font-medium">
                            {p.year} {p.sitting} · P{p.variant}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {p.variant < 40 ? "non-calc" : "calculator"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-mono tabular-nums">{p.total}</td>
                          <td className="px-3 py-2.5 font-mono tabular-nums">{p.withQuestion}</td>
                          <td className="px-3 py-2.5 font-mono tabular-nums">{p.withMarkscheme}</td>
                          <td className="px-6 py-2.5">
                            {complete ? (
                              <Badge>Published</Badge>
                            ) : p.withQuestion > 0 ? (
                              <Badge variant="secondary">
                                {p.published}/{p.total} published
                              </Badge>
                            ) : (
                              <Badge variant="outline">Awaiting images</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <AiCostPanel />
          </>
        )}
      </div>
    </main>
  );
};

export default AdminDashboard;
