import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";

interface UsageRow {
  cost_usd: number;
  credits_charged: number;
  billing: string;
  outcome: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  duration_ms: number | null;
}

const usd = (n: number) => `$${n.toFixed(n < 0.01 ? 5 : 4)}`;

export const AiCostPanel = () => {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Must stay a single string literal: supabase-js infers the row shape from
    // it at compile time, and a concatenated expression degrades to untyped.
    const { data, error } = await supabase
      .from("ai_usage")
      .select(
        "cost_usd, credits_charged, billing, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, duration_ms",
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setError(error.message);
    else setRows(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Could not load AI cost</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!rows) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading AI cost…
        </CardContent>
      </Card>
    );
  }

  const spend = rows.reduce((t, r) => t + Number(r.cost_usd), 0);
  const ok = rows.filter((r) => r.outcome === "ok");
  const okSpend = ok.reduce((t, r) => t + Number(r.cost_usd), 0);

  // The number that decides the markup: what a *successful* marking costs.
  const perMarking = ok.length ? okSpend / ok.length : 0;

  // Spend that earned nothing — refusals, unreadable responses and API errors
  // are refunded to the student but still billed by Anthropic.
  const wasted = rows.filter((r) => r.billing === "refunded");
  const wastedSpend = wasted.reduce((t, r) => t + Number(r.cost_usd), 0);

  // Admin testing is free to the tester and not free to the business.
  const bypass = rows.filter((r) => r.billing === "admin_bypass");
  const bypassSpend = bypass.reduce((t, r) => t + Number(r.cost_usd), 0);

  const cacheReads = rows.reduce((t, r) => t + r.cache_read_tokens, 0);
  const cacheWrites = rows.reduce((t, r) => t + r.cache_write_tokens, 0);
  const cacheRate =
    cacheReads + cacheWrites > 0
      ? Math.round((cacheReads / (cacheReads + cacheWrites)) * 100)
      : null;

  const durations = ok.map((r) => r.duration_ms).filter((d): d is number => d !== null);
  const medianMs = durations.length
    ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]
    : null;

  const stat = (label: string, value: string, hint?: string) => (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">AI cost</CardTitle>
          <Badge variant="outline">
            {rows.length} call{rows.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <CardDescription>
          What the model actually costs, independent of what anyone was charged. The
          markup is priced on these numbers.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No AI calls recorded yet. Mark a piece of work and the cost will appear here.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {stat("Cost per marking", usd(perMarking), `${ok.length} successful`)}
              {stat("Total spend", usd(spend), "last 500 calls")}
              {stat(
                "Refunded but billed",
                usd(wastedSpend),
                `${wasted.length} call${wasted.length === 1 ? "" : "s"} earned nothing`,
              )}
              {stat(
                "Admin testing",
                usd(bypassSpend),
                `${bypass.length} call${bypass.length === 1 ? "" : "s"}, charged to nobody`,
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {stat(
                "Cache hit rate",
                cacheRate === null ? "—" : `${cacheRate}%`,
                "reads vs writes — low means the rubric prefix keeps re-caching",
              )}
              {stat(
                "Median time",
                medianMs === null ? "—" : `${(medianMs / 1000).toFixed(1)}s`,
                "successful markings",
              )}
              {stat(
                "Tokens in / out",
                `${rows.reduce((t, r) => t + r.input_tokens, 0).toLocaleString()} / ${rows
                  .reduce((t, r) => t + r.output_tokens, 0)
                  .toLocaleString()}`,
              )}
            </div>

            {wasted.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{usd(wastedSpend)} of spend was refunded to students</AlertTitle>
                <AlertDescription>
                  Refusals, unreadable responses and API errors return the student's credit
                  but are still billed by Anthropic. This is margin loss, and it belongs in
                  the price.
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
