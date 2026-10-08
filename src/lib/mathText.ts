/**
 * Split marking feedback into prose and mathematics.
 *
 * The model is asked to wrap every expression in \( … \), or \[ … \] when it
 * deserves its own line. Dollar delimiters are accepted too, purely as a
 * safety net for when it reaches for them out of habit.
 */

export interface MathSegment {
  math: boolean;
  display: boolean;
  text: string;
}

/**
 * Order matters: the display forms are tried before their inline
 * counterparts, or "$$" would be read as an empty "$…$". Single-dollar is last
 * and refuses to span a newline, so a stray currency symbol cannot swallow a
 * paragraph.
 */
const DELIMITERS =
  /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/** The same, without the dollar forms. */
const ESCAPED_ONLY = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;

/**
 * The marker sometimes escapes its LaTeX twice, so `\(\pi\)` arrives as
 * `\\(\\pi\\)` — in practice in what_went_well and next_step, never yet in a
 * part comment. Read as it stands, the delimiter is found one backslash late:
 * a stray "\" is left in the prose and KaTeX is handed `\\pi\`, which it
 * shows as red source. A doubled delimiter means nothing in prose, so a span
 * opened by one has every backslash pair inside it halved.
 */
const DOUBLED = /\\\\\[([\s\S]+?)\\\\\]|\\\\\(([\s\S]+?)\\\\\)/g;

const undouble = (input: string) =>
  input.replace(DOUBLED, (_, display: string | undefined, inline: string | undefined) => {
    const tex = (display ?? inline ?? "").replace(/\\\\/g, "\\");
    return display !== undefined ? `\\[${tex}\\]` : `\\(${tex}\\)`;
  });

/**
 * `dollars: false` for text that is not written by the marker. The question
 * index contains prices — "divide $90 in the ratio 2:3" — and two of those
 * joined into one card would otherwise be read as one inline expression.
 */
export function splitMath(raw: string, dollars = true): MathSegment[] {
  const out: MathSegment[] = [];
  if (!raw) return out;
  const input = undouble(raw);
  const re = dollars ? DELIMITERS : ESCAPED_ONLY;
  let last = 0;
  for (const m of input.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ math: false, display: false, text: input.slice(last, at) });
    const display = m[1] !== undefined || m[3] !== undefined;
    out.push({ math: true, display, text: m[1] ?? m[2] ?? m[3] ?? m[4] ?? "" });
    last = at + m[0].length;
  }
  if (last < input.length) out.push({ math: false, display: false, text: input.slice(last) });
  return out;
}
