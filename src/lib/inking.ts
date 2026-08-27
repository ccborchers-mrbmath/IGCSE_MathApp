import { getStroke } from "perfect-freehand";

/**
 * Stroke model and rendering, shared by the live canvas and the export.
 *
 * The quality of the ink comes from three things, in order of how much they
 * matter:
 *
 *  1. Strokes are filled outlines, not stroked polylines. `perfect-freehand`
 *     turns the sample points into a closed ribbon whose width varies along
 *     its length, which the canvas then anti-aliases as a single filled shape.
 *     Drawing segment-by-segment instead leaves visible joins and a hard,
 *     uniform edge — that is what made the first version look flat.
 *  2. The backing store is sized in device pixels. A canvas rendered at CSS
 *     resolution and scaled up is soft on every phone and tablet made in the
 *     last decade.
 *  3. Pressure when the stylus reports it, simulated pressure when it does
 *     not, so a mouse or a cheap stylus still gets natural thick-and-thin
 *     rather than a dead uniform line.
 */

export interface Pt {
  x: number;
  y: number;
  /** Normalised pressure 0..1. 0.5 when the device reports none. */
  p: number;
}

export type StrokeTool = "pen" | "eraser";

export interface Stroke {
  id: number;
  tool: StrokeTool;
  width: number;
  points: Pt[];
}

export const PEN_WIDTH = 3;
export const ERASER_WIDTH = 22;
export const INK_COLOR = "#101828";

/** Did this stroke arrive with real pressure readings, or a flat default? */
const hasRealPressure = (points: Pt[]) => points.some((p) => Math.abs(p.p - 0.5) > 0.001);

/**
 * Paint one stroke. `live` leaves the end of an in-progress stroke open so it
 * does not visibly re-taper on every frame while the student is still writing.
 */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, live = false) {
  if (s.points.length === 0) return;

  const pressure = hasRealPressure(s.points);
  const input = s.points.map((p) => [p.x, p.y, pressure ? p.p : 0.5] as [number, number, number]);

  const outline = getStroke(input, {
    size: s.width * 1.6,
    // Thin more aggressively when the pressure is real; a simulated signal is
    // noisier and over-thinning it reads as a wobble rather than as weight.
    thinning: pressure ? 0.55 : 0.35,
    smoothing: 0.6,
    streamline: 0.45,
    easing: (t) => t,
    simulatePressure: !pressure,
    last: !live,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  });
  if (outline.length < 2) return;

  ctx.save();
  // An eraser cuts a hole in the ink layer rather than painting over it. That
  // is the whole reason ink lives on its own canvas: erasing must never touch
  // the question underneath.
  ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
  ctx.fillStyle = s.tool === "eraser" ? "rgba(0,0,0,1)" : INK_COLOR;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Paint every committed stroke, in order, onto a transparent ink surface. */
export function paintInk(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  for (const s of strokes) paintStroke(ctx, s);
}

// ---------------------------------------------------------------- geometry --

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function strokeBounds(s: Stroke): Bounds | null {
  if (!s.points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = s.width;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function groupBounds(strokes: Stroke[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const s of strokes) {
    const b = strokeBounds(s);
    if (!b) continue;
    any = true;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return any ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

/** Even-odd point-in-polygon. */
export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Is this stroke captured by a lasso?
 *
 * Either its centre lies inside, or most of its samples do. Requiring every
 * point would make it impossible to grab a long sweep whose tail pokes out;
 * accepting any single point would grab a neighbour the student only clipped.
 */
export function strokeInPolygon(s: Stroke, poly: Pt[]): boolean {
  if (!s.points.length || poly.length < 3) return false;
  const b = strokeBounds(s);
  if (b && pointInPolygon(b.x + b.w / 2, b.y + b.h / 2, poly)) return true;
  let inside = 0;
  for (const p of s.points) if (pointInPolygon(p.x, p.y, poly)) inside++;
  return inside * 2 > s.points.length;
}

export function strokeInRect(s: Stroke, r: Bounds): boolean {
  if (!s.points.length) return false;
  const poly: Pt[] = [
    { x: r.x, y: r.y, p: 0.5 },
    { x: r.x + r.w, y: r.y, p: 0.5 },
    { x: r.x + r.w, y: r.y + r.h, p: 0.5 },
    { x: r.x, y: r.y + r.h, p: 0.5 },
  ];
  return strokeInPolygon(s, poly);
}

export const rectFrom = (x0: number, y0: number, x1: number, y1: number): Bounds => ({
  x: Math.min(x0, x1),
  y: Math.min(y0, y1),
  w: Math.abs(x1 - x0),
  h: Math.abs(y1 - y0),
});

export const pointInBounds = (x: number, y: number, b: Bounds): boolean =>
  x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

/** Move strokes without mutating them, so undo snapshots stay valid. */
export function translateStrokes(strokes: Stroke[], ids: Set<number>, dx: number, dy: number): Stroke[] {
  if (!dx && !dy) return strokes;
  return strokes.map((s) =>
    ids.has(s.id)
      ? { ...s, points: s.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
      : s,
  );
}
