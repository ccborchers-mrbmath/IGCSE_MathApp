import { useEffect, useState } from "react";
import { splitMath } from "@/lib/mathText";

/**
 * Render marking feedback with its mathematics properly typeset.
 *
 * The model is asked to wrap every expression in \( … \) (or \[ … \] when it
 * deserves its own line). This splits the text on those delimiters and hands
 * the maths to KaTeX, leaving the prose as ordinary text nodes.
 *
 * KaTeX is loaded on demand rather than bundled into the question page: it is
 * around 80 kB gzipped plus fonts, and only a student who has actually paid
 * for a marking ever sees any of it. Until it arrives the text renders with
 * the delimiters stripped, so nothing jumps and no raw "\(" is ever shown.
 */

type Renderer = (tex: string, displayMode: boolean) => string;

let rendererPromise: Promise<Renderer> | null = null;

/** Loaded once per session and shared by every piece of feedback on the page. */
function loadRenderer(): Promise<Renderer> {
  if (!rendererPromise) {
    rendererPromise = Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
      ([katex]) =>
        (tex: string, displayMode: boolean) =>
          katex.default.renderToString(tex, {
            displayMode,
            // Never let a malformed expression blank the feedback: KaTeX shows
            // the offending source in red and the rest of the sentence stands.
            throwOnError: false,
            // trust:false is what makes it safe to put this in innerHTML — it
            // disables \href, \htmlClass and friends, so KaTeX can only ever
            // emit its own markup from the model's text.
            trust: false,
            strict: false,
            output: "html",
          }),
    );
  }
  return rendererPromise;
}

export const MathText = ({ children, className }: { children: string; className?: string }) => {
  const [render, setRender] = useState<Renderer | null>(null);
  const segments = splitMath(children ?? "");
  const hasMath = segments.some((s) => s.math);

  useEffect(() => {
    if (!hasMath) return;
    let alive = true;
    // setState with a function argument would call it, so wrap it.
    void loadRenderer().then((r) => alive && setRender(() => r));
    return () => {
      alive = false;
    };
  }, [hasMath]);

  if (!hasMath) return <span className={className}>{children}</span>;

  return (
    <span className={className}>
      {segments.map((s, i) => {
        if (!s.math) return <span key={i}>{s.text}</span>;
        if (!render) {
          // Pre-load fallback: the source without its delimiters reads as
          // ordinary maths, which is better than a flash of markup.
          return <span key={i}>{s.text}</span>;
        }
        return (
          <span
            key={i}
            className={s.display ? "my-1 block overflow-x-auto" : undefined}
            // KaTeX's own markup, from KaTeX's own escaping — see trust:false.
            dangerouslySetInnerHTML={{ __html: render(s.text, s.display) }}
          />
        );
      })}
    </span>
  );
};
