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

export function splitMath(input: string): MathSegment[] {
  const out: MathSegment[] = [];
  if (!input) return out;
  let last = 0;
  for (const m of input.matchAll(DELIMITERS)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ math: false, display: false, text: input.slice(last, at) });
    const display = m[1] !== undefined || m[3] !== undefined;
    out.push({ math: true, display, text: m[1] ?? m[2] ?? m[3] ?? m[4] ?? "" });
    last = at + m[0].length;
  }
  if (last < input.length) out.push({ math: false, display: false, text: input.slice(last) });
  return out;
}
