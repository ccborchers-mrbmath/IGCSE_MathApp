import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { logger } from "@/lib/logger";
import type { Enums } from "@/integrations/supabase/types";

export type Confidence = Enums<"self_confidence">;

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  easy: "Easy",
  ok: "OK",
  struggled: "Struggled",
};

const STORAGE_KEY = "igcse.progress.v1";

type ProgressMap = Record<string, Confidence>;

/**
 * Anonymous visitors keep progress in the browser. There is no user row to
 * attach a completion to, and creating anonymous auth users for casual
 * visitors would accumulate permanent rows and count toward monthly actives.
 * The trade-off is that local progress is per-browser — acceptable for a
 * feature that costs nothing to redo, and it gives a real reason to sign up.
 */
function readLocal(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ProgressMap) : {};
  } catch {
    return {};
  }
}

function writeLocal(map: ProgressMap) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private browsing or blocked site data — progress simply isn't persisted.
  }
}

export function useProgress() {
  const { user, loading: authLoading } = useAuth();
  const [progress, setProgress] = useState<ProgressMap>({});
  const [loading, setLoading] = useState(true);
  const migratedFor = useRef<string | null>(null);

  const loadFromDb = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("manual_completions")
      .select("question_id, confidence")
      .eq("user_id", userId);
    if (error) {
      logger.error("Could not load progress", error);
      return {};
    }
    const map: ProgressMap = {};
    for (const r of data ?? []) map[r.question_id] = r.confidence;
    return map;
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setProgress(readLocal());
      setLoading(false);
      return;
    }

    void (async () => {
      setLoading(true);
      const remote = await loadFromDb(user.id);

      // First sign-in on this browser: carry anonymous ticks into the account,
      // then clear them so the two stores cannot drift apart.
      const local = readLocal();
      const pending = Object.entries(local).filter(([qid]) => !(qid in remote));

      if (pending.length > 0 && migratedFor.current !== user.id) {
        migratedFor.current = user.id;
        const { error } = await supabase.from("manual_completions").upsert(
          pending.map(([question_id, confidence]) => ({
            user_id: user.id,
            question_id,
            confidence,
          })),
          { onConflict: "user_id,question_id" },
        );
        if (error) {
          logger.error("Could not migrate local progress", error);
        } else {
          for (const [qid, c] of pending) remote[qid] = c;
          writeLocal({});
        }
      }

      setProgress(remote);
      setLoading(false);
    })();
  }, [user, authLoading, loadFromDb]);

  const setConfidence = useCallback(
    async (questionId: string, confidence: Confidence | null) => {
      // Optimistic: ticking a box should never feel like it waits on a network.
      setProgress((prev) => {
        const next = { ...prev };
        if (confidence === null) delete next[questionId];
        else next[questionId] = confidence;
        if (!user) writeLocal(next);
        return next;
      });

      if (!user) return;

      if (confidence === null) {
        const { error } = await supabase
          .from("manual_completions")
          .delete()
          .eq("user_id", user.id)
          .eq("question_id", questionId);
        if (error) logger.error("Could not clear progress", error);
        return;
      }

      const { error } = await supabase
        .from("manual_completions")
        .upsert(
          { user_id: user.id, question_id: questionId, confidence },
          { onConflict: "user_id,question_id" },
        );
      if (error) logger.error("Could not save progress", error);
    },
    [user],
  );

  return {
    progress,
    loading,
    /** Progress lives only in this browser until the visitor signs in. */
    isLocalOnly: !user,
    completedCount: Object.keys(progress).length,
    setConfidence,
  };
}
