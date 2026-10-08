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

/** An answer line found in the question image, with the blank paper above it. */
export interface AnswerLine {
  /** First printed row of the line — "x =", "[4]", a unit — in the image. */
  top: number;
  /** Blank image rows directly above it. A cut may fall anywhere in them. */
  room: number;
  /** Where the + sits, and where the room opens when no ink is in the way. */
  cut: number;
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

/** Where the gap above an image row starts on the page — the row itself if there is none. */
function pageTopOf(gaps: Gap[], imageY: number): number {
  let y = imageY;
  for (const g of gaps) if (g.at < imageY) y += g.h;
  return y;
}

/**
 * The image row to cut at so that new room opens at a page row. A page row
 * inside an existing gap widens that gap.
 */
function fromPageY(gaps: Gap[], pageY: number): number {
  let acc = 0;
  for (const g of gaps) {
    if (pageY < g.at + acc) break;
    if (pageY < g.at + acc + g.h) return g.at;
    acc += g.h;
  }
  return pageY - acc;
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

/** Where the + for a line sits on the page: always the same height above its print. */
export const buttonPageY = (gaps: Gap[], line: AnswerLine) =>
  toPageY(gaps, line.top) - (line.top - line.cut);

interface Extent {
  x0: number;
  x1: number;
  /** Rows the rendered ink covers, padded so the ribbon's edge is inside. */
  y0: number;
  y1: number;
}

function extentOf(s: Stroke): Extent | null {
  if (!s.points.length) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of s.points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  // perfect-freehand's ribbon reaches at most 1.24 widths from the centre
  // line (size 1.6w, thinning 0.55, full stylus pressure), caps included.
  // Padding by exactly that keeps a real gap between lines of writing clear.
  const pad = Math.ceil(s.width * 1.25);
  return { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad };
}

/**
 * Group strokes that must never be parted: the strokes of one character —
 * a fraction's numerator, bar and denominator, the dot over a recurring
 * digit, a 5's flag, a decimal point — and the characters of one line.
 *
 * Parts of a character are near each other relative to their size, so two
 * strokes join when the gap between them is small next to the taller one.
 * Words on a line share most of their height and sit a few character-heights
 * apart at most. An eraser joins the ink it overlaps, so it is never parted
 * from what it rubbed out.
 */
function inkUnits(ext: (Extent | null)[]): number[] {
  const parent = ext.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ext.length; i++) {
    const a = ext[i];
    if (!a) continue;
    for (let j = i + 1; j < ext.length; j++) {
      const b = ext[j];
      if (!b) continue;
      const ha = a.y1 - a.y0;
      const hb = b.y1 - b.y0;
      const gapX = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      const gapY = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      const near = Math.min(24, Math.max(6, 0.4 * Math.max(ha, hb)));
      const parts = gapX <= near && gapY <= near;
      const sameLine = -gapY >= Math.min(ha, hb) * 0.5 && gapX <= Math.max(ha, hb) * 3;
      if (parts || sameLine) parent[find(i)] = find(j);
    }
  }
  return ext.map((_, i) => find(i));
}

/**
 * Open `h` of room above an answer line, without tearing anything written.
 *
 * The room can open at any row of blank paper above the line, so it opens at
 * one that no group of writing crosses: at the + if that row is clear, else
 * at the nearest clear row below it, else above. Every character and every
 * line of writing is then wholly above the cut or wholly below it.
 *
 * Only when writing covers every blank row must the cut cross some. Then each
 * group it crosses moves or stays whole: with the line if it reaches down to
 * the line's print — it is the answer — otherwise by which side its middle is
 * on. Everything the cut does not cross goes with the print under it.
 */
export function openRoom(
  strokes: Stroke[],
  gaps: Gap[],
  line: AnswerLine,
  h: number,
): { strokes: Stroke[]; gaps: Gap[] } {
  const ext = strokes.map(extentOf);
  const bandTop = pageTopOf(gaps, line.top - line.room);
  const printTop = toPageY(gaps, line.top);
  const bandBottom = printTop - 1;
  const preferred = Math.min(bandBottom, Math.max(bandTop, buttonPageY(gaps, line)));

  // Grouping spans the whole page: a line of working that starts over the
  // question text is still one line. It chains only through writing that is
  // close together, so ink drawn elsewhere — a graph above — stays separate.
  const unit = inkUnits(ext);
  const span = new Map<number, { y0: number; y1: number }>();
  ext.forEach((e, i) => {
    if (!e) return;
    const u = span.get(unit[i]);
    span.set(unit[i], u ? { y0: Math.min(u.y0, e.y0), y1: Math.max(u.y1, e.y1) } : { y0: e.y0, y1: e.y1 });
  });
  const spans = [...span.values()];
  const clear = (y: number) => spans.every((u) => y < u.y0 || y > u.y1);

  let cut: number | null = null;
  for (let y = preferred; y <= bandBottom && cut === null; y++) if (clear(y)) cut = y;
  for (let y = preferred - 1; y >= bandTop && cut === null; y--) if (clear(y)) cut = y;

  let moves: (i: number) => boolean;
  if (cut !== null) {
    const y = cut;
    moves = (i) => ext[i] !== null && ext[i]!.y0 > y;
  } else {
    const y = preferred;
    cut = y;
    const decided = new Map<number, boolean>();
    for (const [id, u] of span) {
      if (u.y0 <= y && u.y1 >= y) decided.set(id, u.y1 >= printTop || (u.y0 + u.y1) / 2 >= y);
    }
    moves = (i) => {
      const e = ext[i];
      if (!e) return false;
      return decided.get(unit[i]) ?? e.y0 > y;
    };
  }

  return {
    strokes: strokes.map((s, i) =>
      moves(i) ? { ...s, points: s.points.map((p) => ({ ...p, y: p.y + h })) } : s,
    ),
    gaps: insertGap(gaps, fromPageY(gaps, cut), h),
  };
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
 * Find the answer lines worth a + : each one with blank paper above it, or
 * the first line of a stacked group.
 *
 * Every threshold is a share of the page width, since the stored scans are
 * not all the same resolution. The proportions come from Cambridge's layout:
 * a leader dot is about 0.2% of the width and repeats every 0.5%.
 */
export function findAnswerLines(px: Pixels): AnswerLine[] {
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

  const stackGap = W * 0.07;
  const descender = Math.round(W * 0.008);
  const reach = Math.round(W * 0.02);

  /** Is anything printed on this row at all, however faint? */
  const rowPrinted = (y: number) => {
    const off = y * W;
    for (let x = 0; x < W; x++) if (lum[off + x] < PRINT) return true;
    return false;
  };

  /**
   * Top of the printed text on an answer line — "x =", "[4]", a unit — or
   * null when no blank paper is found above it. Gaps of a few rows inside the
   * text are stepped over: an arrow over "OA", a bar over x̄, the two halves
   * of a fraction all belong to the line.
   *
   * Null is what keeps a cut out of a diagram or a table: a leader drawn
   * beside a figure has print on every row above it, and there is no row
   * where the page can be parted without splitting the figure.
   */
  const bridge = Math.max(3, Math.round(W * 0.004));
  const textTop = (l: Line): number | null => {
    const limit = Math.max(0, Math.round(l.y - W * 0.035));
    let y = l.y;
    for (;;) {
      if (y - 1 < limit) return null;
      if (rowPrinted(y - 1)) {
        y--;
        continue;
      }
      // Measure the whole blank run, even past the limit: a short run that
      // the limit happens to cut through is still a gap inside one object.
      let blank = 1;
      while (blank < bridge && y - 1 - blank >= 0 && !rowPrinted(y - 1 - blank)) blank++;
      if (blank < bridge && y - 1 - blank >= 0) {
        y -= blank;
        continue;
      }
      return y;
    }
  };

  /**
   * Does the print carry on straight under the line? An answer line's own
   * text stops within a descender or two — "y", "[2]", the "dx" of dy/dx. A
   * table's rules and a figure's edges run on well past that, and a leader
   * among them has nowhere to cut that would not split them.
   */
  const continuesBelow = (l: Line) => {
    let y = l.bottom + descender + 1;
    if (y >= H || !rowPrinted(y)) return false;
    while (y + 1 < H && rowPrinted(y + 1)) y++;
    return y - l.bottom > descender * 2;
  };

  /** Blank rows directly above an image row. */
  const blankAbove = (y: number) => {
    let n = 0;
    while (y - n - 1 >= 0 && !rowPrinted(y - n - 1)) n++;
    return n;
  };

  /**
   * Does anything follow the dots on the line's own rows — a mark like "[2]",
   * or a unit? Either closes an answer, so the next line is a new part.
   */
  const closed = (l: Line, top: number) => {
    const end = Math.max(...l.spans.map(([, x1]) => x1)) + maxDot * 2;
    for (let y = top; y <= Math.min(H - 1, l.bottom + descender); y++) {
      const off = y * W;
      for (let x = end; x < W; x++) if (lum[off + x] < INK) return true;
    }
    return false;
  };

  // Lines a hand's breadth apart with nothing printed between them are one
  // answer written over several lines; offer room above the first only.
  const answers: AnswerLine[] = [];
  let prev: { line: Line; top: number } | null = null;
  for (const l of isolated) {
    const top = continuesBelow(l) ? null : textTop(l);
    if (top === null) {
      prev = null;
      continue;
    }
    let stacked = false;
    if (prev && l.y - prev.line.bottom < stackGap && !closed(prev.line, prev.top)) {
      stacked = true;
      // Skip the line's own descenders — "y", a bracket — which hang below
      // the dots without being anything printed in between.
      for (let y = prev.line.bottom + descender; y < top; y++) {
        if (rowPrinted(y)) {
          stacked = false;
          break;
        }
      }
    }
    prev = { line: l, top };
    if (stacked) continue;

    // The + sits in the blank paper above the text: a line of text up, or
    // halfway into a narrower gap. It never sits on print.
    const room = blankAbove(top);
    if (room < 2) continue;
    answers.push({ top, room, cut: top - Math.min(reach, Math.floor(room / 2)) });
  }
  return answers;
}
