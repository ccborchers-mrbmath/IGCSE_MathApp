/**
 * Working room inserted into the question itself, just above an answer line.
 *
 * The question image is cut into horizontal bands and a blank gap is opened
 * between two of them. Everything below the cut — the rest of the printed
 * page and the ink written on it — moves down; everything above stays put.
 * That is the only way to give a part more room without the student's answer
 * drifting off the line it was written on.
 *
 * Where to cut is read from the image: Cambridge prints every answer line as
 * a dotted leader ("x = ........ [4]"), and a run of evenly pitched, tiny,
 * isolated dots is distinctive enough to find without any metadata.
 */

import type { Stroke } from "@/lib/inking";

/** A blank band opened in the question image. */
export interface Gap {
  /** Where the image is cut, as a y in the (scaled) question image. */
  at: number;
  /** Height of the blank band, in page units. */
  h: number;
}

/** Total height of every inserted band. */
export const gapTotal = (gaps: Gap[]) => gaps.reduce((t, g) => t + g.h, 0);

/**
 * Where an image row lands on the page. A row at the cut itself sits *below*
 * the gap, since the gap is opened above it.
 */
export function toPageY(gaps: Gap[], imageY: number): number {
  let y = imageY;
  for (const g of gaps) if (g.at <= imageY) y += g.h;
  return y;
}

/** Open (or widen) a gap at an image row. Never mutates, so undo stays valid. */
export function insertGap(gaps: Gap[], at: number, h: number): Gap[] {
  const found = gaps.some((g) => g.at === at);
  const next = found ? gaps.map((g) => (g.at === at ? { ...g, h: g.h + h } : g)) : [...gaps, { at, h }];
  return next.sort((a, b) => a.at - b.at);
}

export interface Band {
  /** Top of the slice in the question image. */
  srcY: number;
  srcH: number;
  /** Where the slice is drawn on the page. */
  dstY: number;
}

/** The question image as the slices to draw, each pushed down by the gaps above it. */
export function imageBands(gaps: Gap[], imgH: number): Band[] {
  const cuts = [...new Set(gaps.map((g) => g.at).filter((a) => a > 0 && a < imgH))].sort((a, b) => a - b);
  const edges = [0, ...cuts, imgH];
  const bands: Band[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const srcY = edges[i];
    bands.push({ srcY, srcH: edges[i + 1] - srcY, dstY: toPageY(gaps, srcY) });
  }
  return bands;
}

/**
 * Move every stroke that belongs below a cut.
 *
 * A stroke belongs to whichever side its vertical midpoint is on. Handwriting
 * on an answer line rises well above the printed text, so a stroke that pokes
 * over the cut is still part of the answer and must travel with the line —
 * leaving it behind would split "2.3" from the dots it was written on. Working
 * written above the cut has its midpoint above it, so it never moves.
 */
export function shiftStrokesBelow(strokes: Stroke[], pageY: number, dy: number): Stroke[] {
  return strokes.map((s) => {
    if (!s.points.length) return s;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of s.points) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if ((minY + maxY) / 2 < pageY) return s;
    return { ...s, points: s.points.map((p) => ({ ...p, y: p.y + dy })) };
  });
}

// ------------------------------------------------------------ detection --

/** Anything with the shape of `ImageData`, so the detector runs outside a browser too. */
export interface Pixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** Darker than this counts as a printed dot. Leader dots bottom out near black. */
const INK = 160;
/** Darker than this counts as any print at all, however faint — grid lines included. */
const PRINT = 200;

/**
 * Find the places to offer more room: one cut just above each answer line,
 * or above the first line of a stacked group, as a y in the image.
 *
 * Every threshold is a share of the page width, since the stored scans are
 * not all the same resolution. The proportions come from Cambridge's layout:
 * a leader dot is about 0.2% of the width and repeats every 0.5%.
 */
export function findAnswerCuts(px: Pixels): number[] {
  const { width: W, height: H, data } = px;
  if (W < 200 || H < 20) return [];

  const lum = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
    // Unpainted (transparent) pixels are paper, not print.
    const a = data[i + 3] / 255;
    lum[j] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * a + 255 * (1 - a);
  }
  const dark = (x: number, y: number) => lum[y * W + x] < INK;

  const maxDot = Math.max(2, Math.round(W * 0.0042));
  const minPitch = W * 0.0028;
  const maxPitch = W * 0.0085;
  const minDots = 12;

  /** Vertical extent of the dark pixels in one column, through row y. */
  const columnRun = (x: number, y: number, limit: number) => {
    let n = 1;
    for (let k = y - 1; k >= 0 && dark(x, k) && n <= limit; k--) n++;
    for (let k = y + 1; k < H && dark(x, k) && n <= limit; k++) n++;
    return n;
  };

  type Span = [number, number];

  /** Every chain of leader dots on one row, as x-spans. */
  const leaderOn = (y: number): Span[] => {
    const centres: number[] = [];
    let x = 0;
    while (x < W) {
      if (!dark(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < W && dark(x, y)) x++;
      const len = x - start;
      // A dot is small in both directions. Letter strokes and rules are not:
      // a vertical stroke runs far past the dot height, a rule past its width.
      if (len <= maxDot) {
        const cx = start + (len >> 1);
        if (columnRun(cx, y, maxDot + 1) <= maxDot) centres.push(cx);
      }
    }
    const spans: Span[] = [];
    if (centres.length < minDots) return spans;

    // Chains of dots at a steady pitch. Text can produce a few small, evenly
    // spaced marks; it does not produce a dozen of them in a row.
    let i = 0;
    while (i < centres.length - 1) {
      const pitch = centres[i + 1] - centres[i];
      if (pitch < minPitch || pitch > maxPitch) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < centres.length) {
        const g = centres[j + 1] - centres[j];
        if (Math.abs(g - pitch) > Math.max(1.5, pitch * 0.35)) break;
        j++;
      }
      if (j - i + 1 >= minDots) spans.push([centres[i], centres[j]]);
      i = j + 1;
    }
    return spans;
  };

  // Rows carrying a leader, merged where the dots span two or three rows.
  interface Line {
    y: number;
    bottom: number;
    spans: Span[];
  }
  const found: Line[] = [];
  let open: Line | null = null;
  for (let y = 1; y < H - 1; y++) {
    const spans = leaderOn(y);
    if (!spans.length) continue;
    if (open && y - open.bottom <= maxDot) {
      open.bottom = y;
      open.spans.push(...spans);
    } else {
      open = { y, bottom: y, spans };
      found.push(open);
    }
  }

  // A dotted grid line looks just like a leader along its own row. What gives
  // it away is the grid's vertical lines running into it, from both sides
  // inside the grid and from one side along its border. Nothing printed ever
  // touches a leader: the space over it is where the student writes.
  const touched = (l: Line) => {
    const reach = Math.max(2, Math.round(W * 0.0035));
    const seen = new Uint8Array(W);
    let columns = 0;
    let hits = 0;
    for (const [x0, x1] of l.spans) {
      for (let x = x0; x <= x1; x++) {
        if (seen[x]) continue;
        seen[x] = 1;
        columns++;
        // Two pixels clear of the dots, so their own anti-aliased edge and
        // JPEG halo do not count.
        let hit = false;
        for (let k = 2; k <= reach + 1 && !hit; k++) {
          const up = l.y - k;
          const down = l.bottom + k;
          hit = (up >= 0 && lum[up * W + x] < PRINT) || (down < H && lum[down * W + x] < PRINT);
        }
        if (hit) hits++;
      }
    }
    return hits > Math.max(3, columns * 0.01);
  };
  const lines = found.filter((l) => !touched(l));

  // A dotted grid is also a stack of dotted rows a few pixels apart. Real
  // answer lines are never that close, so anything in such a stack goes.
  const gridPitch = W * 0.025;
  const isolated = lines.filter(
    (l, i) =>
      !(i > 0 && l.y - lines[i - 1].y < gridPitch) &&
      !(i < lines.length - 1 && lines[i + 1].y - l.y < gridPitch),
  );

  const rowInked = (y: number) => {
    const off = y * W;
    for (let x = 0; x < W; x++) if (lum[off + x] < INK) return true;
    return false;
  };

  /** Top of the printed text on an answer line: "x =", "[4]", a unit. */
  const textTop = (l: Line) => {
    const limit = Math.max(0, Math.round(l.y - W * 0.035));
    let y = l.y;
    while (y - 1 >= limit && rowInked(y - 1)) y--;
    return y;
  };

  // Lines a hand's breadth apart with nothing printed between them are one
  // answer written over several lines; offer room above the first only.
  const stackGap = W * 0.07;
  const descender = Math.round(W * 0.008);
  const cuts: number[] = [];
  let prev: Line | null = null;
  for (const l of isolated) {
    const top = textTop(l);
    let stacked = false;
    if (prev && l.y - prev.bottom < stackGap) {
      stacked = true;
      // Skip the line's own descenders — "y", a bracket, "[2]" — which hang
      // below the dots without being anything printed in between.
      for (let y = prev.bottom + descender; y < top; y++) {
        if (rowInked(y)) {
          stacked = false;
          break;
        }
      }
    }
    prev = l;
    if (stacked) continue;

    // Cut in the blank space above the text, never through print: as far up
    // as a line of text, or halfway into a narrower gap.
    const reach = Math.round(W * 0.02);
    let blank = 0;
    while (blank < reach * 2 && top - blank - 1 >= 0 && !rowInked(top - blank - 1)) blank++;
    const cut = top - Math.min(reach, Math.floor(blank / 2));
    if (cut > 0) cuts.push(cut);
  }
  return cuts;
}
