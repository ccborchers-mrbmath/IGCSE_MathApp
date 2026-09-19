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
 * `dollars: false` for text that is not written by the marker. The question
 * index contains prices — "divide $90 in the ratio 2:3" — and two of those
 * joined into one card would otherwise be read as one inline expression.
 */
export function splitMath(input: string, dollars = true): MathSegment[] {
  const out: MathSegment[] = [];
  if (!input) return out;
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
