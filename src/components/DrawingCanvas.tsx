import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Pen, Eraser, Undo2, Redo2, Trash2, Plus, AlertTriangle, Lasso, BoxSelect } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ERASER_WIDTH,
  PEN_WIDTH,
  groupBounds,
  paintInk,
  paintStroke,
  pointInBounds,
  rectFrom,
  strokeInPolygon,
  strokeInRect,
  translateStrokes,
  type Bounds,
  type Pt,
  type Stroke,
} from "@/lib/inking";
import {
  buttonPageY,
  findAnswerLines,
  gapTotal,
  imageBands,
  openRoom,
  type AnswerLine,
  type Gap,
} from "@/lib/answerSpace";
import { toast } from "sonner";

/**
 * Write an answer directly onto the question, the way a student writes on the
 * paper itself.
 *
 * Three stacked surfaces:
 *   background — white, the question image (cut into bands around any room
 *                opened above an answer line), and the divider under it
 *   ink        — every committed stroke, on transparency
 *   overlay    — the live stroke and the selection UI, cleared every frame
 *
 * Ink is separate from the background so an eraser can cut into ink with
 * destination-out without touching the question. The overlay is separate from
 * ink so the in-progress stroke and the marching-ants selection can be redrawn
 * at pointer rate without repainting the committed work underneath.
 */

/** Claude downsamples to ~1568px on the long edge, so exporting much beyond
 *  that spends bytes on detail the marker will never see. */
const MAX_LONG_EDGE = 1600;

/** Blank working room under the question, as a share of its height. */
const EXTRA_SHARE = 0.3;

/** Room opened above an answer line, as a share of the page width: about
 *  five lines of handwriting. */
const INSERT_SHARE = 0.2;

/** Past this the added room shrinks the handwriting more than the room helps. */
const MAX_TOTAL_HEIGHT = 3200;
const TOO_TALL = "More space would shrink your handwriting too much to mark reliably.";

/** A fingertip tap is quick; a palm settles and stays. */
const LONG_PRESS_MS = 500;

type Tool = "pen" | "eraser" | "lasso" | "rect";

// A real nib and a real eraser, so the pointer says what the tool will do.
// Hotspots are set to the drawing tip, not the centre of the glyph.
const PEN_CURSOR =
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'><path d='M3.8 18.1 L13.3 7.9 A2.2 2.2 0 0 1 16.1 10.7 L5.9 20.2 Z' fill='white'/><path d='M2 22 L3.8 18.1 L5.9 20.2 Z' fill='black'/></svg>") 2 22, crosshair`;
const ERASER_CURSOR =
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24' fill='%23fde68a' stroke='%23111827' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'><path d='M20 20H9L3.5 14.5a2 2 0 0 1 0-2.8L12.7 2.5a2 2 0 0 1 2.8 0l6 6a2 2 0 0 1 0 2.8L13 19'/><path d='M18 13.3 10.7 6'/></svg>") 4 24, crosshair`;

/**
 * White page, then the question in bands, each pushed down by the room opened
 * above it. Shared by the screen and the export so the marker sees exactly the
 * page the student wrote on.
 */
function paintQuestion(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  size: { w: number; imgH: number },
  gaps: Gap[],
  pageH: number,
) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size.w, pageH);
  const ky = img.naturalHeight / size.imgH;
  for (const b of imageBands(gaps, size.imgH)) {
    ctx.drawImage(img, 0, b.srcY * ky, img.naturalWidth, b.srcH * ky, 0, b.dstY, size.w, b.srcH);
  }
}

/**
 * Find the answer lines by reading the question's own pixels. Runs once per
 * question, in a few tens of milliseconds. Should the image be unreadable,
 * the canvas simply offers no buttons — never an error.
 */
function answerLines(img: HTMLImageElement, w: number, h: number): AnswerLine[] {
  try {
    const probe = document.createElement("canvas");
    probe.width = w;
    probe.height = h;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    // A tall question is shrunk to fit; high-quality scaling keeps the thin
    // strokes — an arrow over "PQ" — that the detector steps over.
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return findAnswerLines(ctx.getImageData(0, 0, w, h));
  } catch {
    return [];
  }
}

/** Everything undo can take back: the ink, and the room it is written in. */
interface Snapshot {
  strokes: Stroke[];
  gaps: Gap[];
  extraBlocks: number;
}

export interface DrawingCanvasHandle {
  exportBlob: () => Promise<Blob | null>;
  hasInk: () => boolean;
}

interface Props {
  questionImageUrl: string | null;
  onInkChange?: (hasInk: boolean) => void;
  disabled?: boolean;
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(
  ({ questionImageUrl, onInkChange, disabled }, ref) => {
    const wrapRef = useRef<HTMLDivElement>(null);
    const bgRef = useRef<HTMLCanvasElement>(null);
    const inkRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);

    const [strokes, setStrokes] = useState<Stroke[]>([]);
    const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
    const [redoStack, setRedoStack] = useState<Snapshot[]>([]);
    const [selected, setSelected] = useState<number[]>([]);
    const [tool, setTool] = useState<Tool>("pen");
    const [extraBlocks, setExtraBlocks] = useState(1);
    const [gaps, setGaps] = useState<Gap[]>([]);
    /** The answer lines found in the question, each with a + to open room above it. */
    const [lines, setLines] = useState<AnswerLine[]>([]);
    const [size, setSize] = useState<{ w: number; imgH: number } | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [cssWidth, setCssWidth] = useState(0);

    // Live, per-frame state lives in refs: a React render per pointer sample
    // is the single biggest source of input lag on a tablet.
    const live = useRef<Stroke | null>(null);
    /** Which kind of pointer started the in-progress stroke. */
    const liveFrom = useRef<string | null>(null);
    const lasso = useRef<Pt[] | null>(null);
    const marquee = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
    const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
    const activePointer = useRef<number | null>(null);
    const raf = useRef<number | null>(null);
    const nextId = useRef(1);

    /**
     * Palm rejection and scrolling.
     *
     * `penSeen` latches once a stylus has been seen *at all*, including a
     * hover — an active pen reports hover long before the nib lands, which is
     * the only way to reject a palm that touches down first.
     * `penDown` is the stronger, momentary signal: while the nib is on the
     * glass, no touch is ever ink.
     */
    const penSeen = useRef(false);
    const penDown = useRef(false);
    const [usingPen, setUsingPen] = useState(false);

    /** The press in progress on a + button, so a palm or a scroll is not taken for a tap. */
    const tap = useRef<{ stray: boolean; touch: boolean; at: number } | null>(null);
    /**
     * The + a mouse or stylus is over. Tracked by pointer type rather than
     * :hover, which a touchscreen leaves stuck on the last thing tapped.
     */
    const [previewing, setPreviewing] = useState<number | null>(null);

    /** Live touch contacts, so a second finger can be told from the first. */
    const touches = useRef<Map<number, { x: number; y: number }>>(new Map());
    /** Last centroid of the panning contacts, in client coordinates. */
    const panFrom = useRef<{ x: number; y: number } | null>(null);

    const selectedSet = useMemo(() => new Set(selected), [selected]);
    const selectionBounds = useMemo(
      () => (selected.length ? groupBounds(strokes.filter((s) => selectedSet.has(s.id))) : null),
      [selected, selectedSet, strokes],
    );

    // ---- load the question image ------------------------------------------
    // Fetched as a blob rather than assigned to img.src: a cross-origin image
    // taints the canvas and makes toBlob() throw, whatever CORS headers the CDN
    // sends. A blob URL is same-origin by construction.
    useEffect(() => {
      if (!questionImageUrl) {
        setStatus("error");
        return;
      }
      let objectUrl: string | null = null;
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch(questionImageUrl);
          if (!res.ok) throw new Error(String(res.status));
          objectUrl = URL.createObjectURL(await res.blob());
          const img = new Image();
          img.src = objectUrl;
          await img.decode();
          if (cancelled) return;
          const scale = Math.min(1, MAX_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * scale);
          const imgH = Math.round(img.naturalHeight * scale);
          imageRef.current = img;
          setLines(answerLines(img, w, imgH));
          setSize({ w, imgH });
          setStatus("ready");
        } catch {
          if (!cancelled) setStatus("error");
        }
      })();
      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }, [questionImageUrl]);

    // ---- geometry ------------------------------------------------------------
    const extraH = size ? Math.round(size.imgH * EXTRA_SHARE) : 0;
    const insertH = size ? Math.round(size.w * INSERT_SHARE) : 0;
    /** Bottom of the question on the page, below any room opened inside it. */
    const questionBottom = size ? size.imgH + gapTotal(gaps) : 0;
    const pageH = questionBottom + extraH * extraBlocks;
    const logicalH = Math.min(pageH, MAX_TOTAL_HEIGHT);
    const logicalW = size?.w ?? 0;
    const canGrow = size ? pageH + extraH <= MAX_TOTAL_HEIGHT : false;
    const canInsert = size ? pageH + insertH <= MAX_TOTAL_HEIGHT : false;

    // Track the displayed width so the backing store can be sized in device
    // pixels. Rendering at logical size and letting CSS scale it up is the
    // difference between crisp ink and soft ink on every retina screen.
    useEffect(() => {
      const el = wrapRef.current;
      if (!el) return;
      const ro = new ResizeObserver(([entry]) => setCssWidth(entry.contentRect.width));
      ro.observe(el);
      setCssWidth(el.getBoundingClientRect().width);
      return () => ro.disconnect();
    }, [status]);

    const dpr = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 3);
    const renderScale = logicalW > 0 && cssWidth > 0 ? (cssWidth * dpr) / logicalW : 1;

    const sizeCanvas = useCallback(
      (c: HTMLCanvasElement | null) => {
        if (!c || !logicalW) return null;
        const w = Math.round(logicalW * renderScale);
        const h = Math.round(logicalH * renderScale);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const ctx = c.getContext("2d");
        if (!ctx) return null;
        ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
        return ctx;
      },
      [logicalW, logicalH, renderScale],
    );

    // ---- background ----------------------------------------------------------
    useEffect(() => {
      if (status !== "ready" || !size) return;
      const ctx = sizeCanvas(bgRef.current);
      const img = imageRef.current;
      if (!ctx || !img) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.clearRect(0, 0, logicalW, logicalH);
      paintQuestion(ctx, img, size, gaps, logicalH);
      if (logicalH > questionBottom) {
        ctx.strokeStyle = "rgba(15,36,56,0.13)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, questionBottom + 0.5);
        ctx.lineTo(logicalW, questionBottom + 0.5);
        ctx.stroke();
      }
    }, [status, size, sizeCanvas, logicalW, logicalH, gaps, questionBottom]);

    // ---- committed ink -------------------------------------------------------
    const repaintInk = useCallback(() => {
      const ctx = sizeCanvas(inkRef.current);
      if (!ctx) return;
      ctx.clearRect(0, 0, logicalW, logicalH);
      // Strokes being dragged are drawn on the overlay instead, so they can
      // follow the pointer without repainting this layer every frame.
      const held = drag.current;
      paintInk(ctx, held ? strokes.filter((s) => !selectedSet.has(s.id)) : strokes);
    }, [sizeCanvas, logicalW, logicalH, strokes, selectedSet]);

    useEffect(() => {
      if (status === "ready") repaintInk();
    }, [status, repaintInk]);

    useEffect(() => {
      onInkChange?.(strokes.some((s) => s.tool === "pen"));
    }, [strokes, onInkChange]);

    // ---- overlay: live stroke + selection ------------------------------------
    const paintOverlay = useCallback(() => {
      raf.current = null;
      const ctx = sizeCanvas(overlayRef.current);
      if (!ctx) return;
      ctx.clearRect(0, 0, logicalW, logicalH);

      const held = drag.current;
      if (held) {
        ctx.save();
        ctx.translate(held.dx, held.dy);
        for (const s of strokes) if (selectedSet.has(s.id)) paintStroke(ctx, s);
        ctx.restore();
      }

      const l = live.current;
      // An eraser preview cannot be shown here — destination-out on an empty
      // overlay would erase nothing visible — so it is committed straight to
      // the ink layer as it moves instead.
      if (l && l.tool === "pen") paintStroke(ctx, l, true);

      if (lasso.current && lasso.current.length > 1) {
        ctx.save();
        ctx.strokeStyle = "rgba(29,111,208,0.9)";
        ctx.fillStyle = "rgba(29,111,208,0.08)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(lasso.current[0].x, lasso.current[0].y);
        for (const p of lasso.current.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      if (marquee.current) {
        const r = rectFrom(marquee.current.x0, marquee.current.y0, marquee.current.x1, marquee.current.y1);
        ctx.save();
        ctx.strokeStyle = "rgba(29,111,208,0.9)";
        ctx.fillStyle = "rgba(29,111,208,0.08)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.restore();
      }

      if (selectionBounds && !lasso.current && !marquee.current) {
        const b = selectionBounds;
        const off = held ?? { dx: 0, dy: 0 };
        ctx.save();
        ctx.strokeStyle = "rgba(29,111,208,0.95)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x + off.dx - 4, b.y + off.dy - 4, b.w + 8, b.h + 8);
        ctx.restore();
      }
    }, [sizeCanvas, logicalW, logicalH, strokes, selectedSet, selectionBounds]);

    const scheduleOverlay = useCallback(() => {
      if (raf.current === null) raf.current = requestAnimationFrame(paintOverlay);
    }, [paintOverlay]);

    useEffect(() => {
      if (status === "ready") scheduleOverlay();
    }, [status, scheduleOverlay]);

    // ---- history --------------------------------------------------------------
    // Opening room moves ink, so the room is part of every snapshot: undoing
    // a stroke must never put it back on a page laid out differently.
    // Kept in refs so `commit` does not need the state in its dependency list,
    // which would rebuild every pointer handler on every stroke.
    const strokesRef = useRef<Stroke[]>([]);
    strokesRef.current = strokes;
    const roomRef = useRef({ gaps, extraBlocks });
    roomRef.current = { gaps, extraBlocks };

    const snapshot = (): Snapshot => ({ strokes: strokesRef.current, ...roomRef.current });
    const restore = (s: Snapshot) => {
      setStrokes(s.strokes);
      setGaps(s.gaps);
      setExtraBlocks(s.extraBlocks);
      setSelected([]);
    };

    const commit = useCallback((next: Stroke[], room?: Partial<Omit<Snapshot, "strokes">>) => {
      const before: Snapshot = { strokes: strokesRef.current, ...roomRef.current };
      setUndoStack((u) => [...u, before]);
      setRedoStack([]);
      setStrokes(next);
      if (room?.gaps) setGaps(room.gaps);
      if (room?.extraBlocks !== undefined) setExtraBlocks(room.extraBlocks);
    }, []);

    const undo = () => {
      if (!undoStack.length) return;
      setRedoStack((r) => [...r, snapshot()]);
      restore(undoStack[undoStack.length - 1]);
      setUndoStack(undoStack.slice(0, -1));
    };
    const redo = () => {
      if (!redoStack.length) return;
      setUndoStack((u) => [...u, snapshot()]);
      restore(redoStack[redoStack.length - 1]);
      setRedoStack(redoStack.slice(0, -1));
    };

    /**
     * Open room just above an answer line. The printed page below the cut and
     * the answer written on it move down together; the working above stays.
     */
    const insertSpace = (line: AnswerLine) => {
      if (!canInsert) return;
      const opened = openRoom(strokesRef.current, roomRef.current.gaps, line, insertH);
      commit(opened.strokes, { gaps: opened.gaps });
    };
    const clearAll = () => {
      if (!strokes.length) return;
      commit([]);
      setSelected([]);
    };
    const deleteSelection = useCallback(() => {
      if (!selected.length) return;
      const gone = new Set(selected);
      commit(strokesRef.current.filter((s) => !gone.has(s.id)));
      setSelected([]);
    }, [selected, commit]);

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (selected.length) {
            e.preventDefault();
            deleteSelection();
          }
        } else if (e.key === "Escape") {
          setSelected([]);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [selected, deleteSelection]);

    useEffect(() => {
      if (tool === "pen" || tool === "eraser") setSelected([]);
    }, [tool]);

    // ---- pointer ---------------------------------------------------------------
    const toLogical = (clientX: number, clientY: number) => {
      const c = overlayRef.current!;
      const r = c.getBoundingClientRect();
      return {
        x: ((clientX - r.left) / r.width) * logicalW,
        y: ((clientY - r.top) / r.height) * logicalH,
      };
    };

    const pressureOf = (e: { pointerType: string; pressure: number }) =>
      e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;

    /**
     * A palm spreads far wider than a fingertip. Browsers that do not measure
     * the contact report 1 (or 0), so the test only fires on a real reading.
     */
    const PALM_CONTACT_PX = 45;
    const looksLikePalm = (e: { width?: number; height?: number }) =>
      (e.width ?? 0) > PALM_CONTACT_PX || (e.height ?? 0) > PALM_CONTACT_PX;

    /** Should this touch be ignored for drawing? */
    const rejectTouch = (e: React.PointerEvent) =>
      e.pointerType === "touch" &&
      (penSeen.current || penDown.current || looksLikePalm(e));

    /**
     * Abandon the in-progress stroke, but only if a finger started it.
     *
     * The guard is the whole point: a palm landing while the nib is already
     * writing must not take the pen's stroke down with it. Without the check
     * this discarded whichever stroke was live — which, mid-word, is the
     * student's.
     */
    const dropStrayTouchStroke = () => {
      if (liveFrom.current !== "touch" || !live.current) return;
      live.current = null;
      liveFrom.current = null;
      scheduleOverlay();
    };

    const armPen = () => {
      if (penSeen.current) return;
      penSeen.current = true;
      setUsingPen(true);
      // A palm may already be drawing when the nib arrives.
      dropStrayTouchStroke();
    };

    const centroid = () => {
      const pts = [...touches.current.values()];
      if (!pts.length) return null;
      const x = pts.reduce((t, q) => t + q.x, 0) / pts.length;
      const y = pts.reduce((t, q) => t + q.y, 0) / pts.length;
      return { x, y };
    };

    /** Scroll the page by hand, since touch-action can no longer do it. */
    const panBy = (dx: number, dy: number) => {
      const scroller = document.scrollingElement ?? document.documentElement;
      scroller.scrollLeft -= dx;
      scroller.scrollTop -= dy;
    };

    /*
     * Fingers are counted on the way down, in the capture phase of the whole
     * stack, so a finger that lands on a + button still counts towards a
     * two-finger scroll. Counting them on the canvas alone would leave a
     * scroll with one finger on a button drawing a line instead.
     */
    const trackTouchDown = (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size < 2) return;
      // Two fingers always means scroll, never draw — and if the first finger
      // had started a stroke or pressed a +, that was the beginning of this
      // gesture rather than an answer, so discard it.
      dropStrayTouchStroke();
      if (tap.current) tap.current.stray = true;
      panFrom.current = centroid();
    };
    const trackTouchMove = (e: React.PointerEvent) => {
      if (e.pointerType !== "touch" || !touches.current.has(e.pointerId)) return;
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!panFrom.current) return;
      const c = centroid();
      if (c) {
        panBy(c.x - panFrom.current.x, c.y - panFrom.current.y);
        panFrom.current = c;
      }
    };
    const trackTouchUp = (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touches.current.delete(e.pointerId);
      panFrom.current = touches.current.size ? centroid() : null;
    };

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled || status !== "ready") return;
      if (e.pointerType === "pen") {
        armPen();
        penDown.current = true;
      }

      if (e.pointerType === "touch") {
        // Already a scroll: this is a second finger.
        if (panFrom.current) return;
        if (rejectTouch(e)) {
          dropStrayTouchStroke();
          // A finger is only ever a scroll once a stylus is in use, so a
          // single one pans too. Without this, touch-action: none would leave
          // a tablet unable to scroll the page over the canvas at all.
          if (penSeen.current || penDown.current) panFrom.current = centroid();
          return;
        }
      }

      if (e.pointerType === "mouse" && e.button !== 0) return;

      // Capture can throw for a pointer the browser no longer owns. Losing the
      // capture is survivable; losing the stroke is not.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* draw uncaptured */
      }
      activePointer.current = e.pointerId;
      const { x, y } = toLogical(e.clientX, e.clientY);

      if (tool === "lasso" || tool === "rect") {
        // Starting inside an existing selection means "move it", not "start a
        // new one" — the same gesture every drawing app uses.
        if (selectionBounds && pointInBounds(x, y, selectionBounds)) {
          drag.current = { x, y, dx: 0, dy: 0 };
          repaintInk();
          scheduleOverlay();
          return;
        }
        setSelected([]);
        if (tool === "lasso") lasso.current = [{ x, y, p: 0.5 }];
        else marquee.current = { x0: x, y0: y, x1: x, y1: y };
        scheduleOverlay();
        return;
      }

      const stroke: Stroke = {
        id: nextId.current++,
        tool: tool === "eraser" ? "eraser" : "pen",
        width: tool === "eraser" ? ERASER_WIDTH : PEN_WIDTH,
        points: [{ x, y, p: pressureOf(e) }],
      };
      live.current = stroke;
      liveFrom.current = e.pointerType;
      scheduleOverlay();
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Hover counts: an active stylus announces itself before it lands, and
      // that is the only warning a palm resting first will ever give.
      if (e.pointerType === "pen") armPen();

      // A scroll is moved by trackTouchMove.
      if (e.pointerType === "touch" && panFrom.current) return;

      if (activePointer.current !== e.pointerId || rejectTouch(e)) return;
      const { x, y } = toLogical(e.clientX, e.clientY);

      if (drag.current) {
        drag.current = { ...drag.current, dx: x - drag.current.x, dy: y - drag.current.y };
        scheduleOverlay();
        return;
      }
      if (lasso.current) {
        lasso.current.push({ x, y, p: 0.5 });
        scheduleOverlay();
        return;
      }
      if (marquee.current) {
        marquee.current = { ...marquee.current, x1: x, y1: y };
        scheduleOverlay();
        return;
      }

      const stroke = live.current;
      if (!stroke) return;
      // Coalesced samples carry everything the browser batched between frames.
      // A stylus reports far faster than the display refreshes, and using only
      // the latest event shows up as straight-line corners in fast writing.
      const batch =
        typeof e.nativeEvent.getCoalescedEvents === "function"
          ? e.nativeEvent.getCoalescedEvents()
          : [];
      const events = batch.length ? batch : [e.nativeEvent];
      for (const ev of events) {
        const pt = toLogical(ev.clientX, ev.clientY);
        stroke.points.push({
          x: pt.x,
          y: pt.y,
          p: pressureOf({ pointerType: ev.pointerType || e.pointerType, pressure: ev.pressure }),
        });
      }

      if (stroke.tool === "eraser") {
        // destination-out has nothing to bite on over on the overlay, so the
        // eraser is applied to the ink layer as it travels.
        const ctx = sizeCanvas(inkRef.current);
        if (ctx) paintStroke(ctx, stroke, true);
      }
      scheduleOverlay();
    };

    const endPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "pen") penDown.current = false;
      if (activePointer.current !== e.pointerId) return;
      activePointer.current = null;

      if (drag.current) {
        const { dx, dy } = drag.current;
        drag.current = null;
        if (dx || dy) commit(translateStrokes(strokesRef.current, selectedSet, dx, dy));
        else repaintInk();
        scheduleOverlay();
        return;
      }

      if (lasso.current) {
        const poly = lasso.current;
        lasso.current = null;
        if (poly.length > 2) {
          setSelected(strokes.filter((s) => strokeInPolygon(s, poly)).map((s) => s.id));
        }
        scheduleOverlay();
        return;
      }

      if (marquee.current) {
        const m = marquee.current;
        marquee.current = null;
        const r: Bounds = rectFrom(m.x0, m.y0, m.x1, m.y1);
        if (r.w > 3 && r.h > 3) {
          setSelected(strokes.filter((s) => strokeInRect(s, r)).map((s) => s.id));
        }
        scheduleOverlay();
        return;
      }

      const stroke = live.current;
      live.current = null;
      liveFrom.current = null;
      if (stroke && stroke.points.length) commit([...strokesRef.current, stroke]);
      scheduleOverlay();
    };

    // ---- export ----------------------------------------------------------------
    useImperativeHandle(ref, () => ({
      hasInk: () => strokesRef.current.some((s) => s.tool === "pen"),
      exportBlob: async () => {
        const img = imageRef.current;
        if (!img || !strokesRef.current.some((s) => s.tool === "pen")) return null;

        // Rendered fresh at logical resolution rather than reusing the on-screen
        // canvases: those are sized for whatever the display happens to be, and
        // the marker should always get the same, predictable image.
        const ink = document.createElement("canvas");
        ink.width = logicalW;
        ink.height = logicalH;
        const ictx = ink.getContext("2d");
        if (!ictx) return null;
        paintInk(ictx, strokesRef.current);

        const out = document.createElement("canvas");
        out.width = logicalW;
        out.height = logicalH;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.imageSmoothingQuality = "high";
        if (size) paintQuestion(ctx, img, size, roomRef.current.gaps, logicalH);
        ctx.drawImage(ink, 0, 0);

        return new Promise<Blob | null>((resolve) =>
          // JPEG, not PNG: the background is a photograph of a printed page,
          // which PNG stores badly. 0.92 keeps the ink edges clean.
          out.toBlob((b) => resolve(b), "image/jpeg", 0.92),
        );
      },
    }));

    if (status === "loading") return <Skeleton className="h-[28rem] w-full rounded-lg" />;
    if (status === "error") {
      return (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not load the question to write on</AlertTitle>
          <AlertDescription>
            Use the Photo tab to upload a picture of your working instead.
          </AlertDescription>
        </Alert>
      );
    }

    const inked = strokes.some((s) => s.tool === "pen");

    // Neighbouring parts can sit closer than a + is tall at phone width. A
    // crowded + steps sideways, unless the one above it already has.
    const steppedButtons: boolean[] = [];
    lines.forEach((line, i) => {
      const cssY = (buttonPageY(gaps, line) * cssWidth) / logicalW;
      const prevY = i > 0 ? (buttonPageY(gaps, lines[i - 1]) * cssWidth) / logicalW : -Infinity;
      steppedButtons.push(cssY - prevY < 32 && !steppedButtons[i - 1]);
    });
    const cursor =
      tool === "pen" ? PEN_CURSOR : tool === "eraser" ? ERASER_CURSOR : "crosshair";

    const toolButton = (t: Tool, Icon: typeof Pen, label: string) => (
      <button
        key={t}
        type="button"
        onClick={() => setTool(t)}
        aria-pressed={tool === t}
        title={label}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 text-xs",
          tool === t ? "bg-primary text-primary-foreground" : "hover:bg-accent/10",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
    );

    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex divide-x overflow-hidden rounded-md border">
            {toolButton("pen", Pen, "Pen")}
            {toolButton("eraser", Eraser, "Eraser")}
            {toolButton("lasso", Lasso, "Lasso")}
            {toolButton("rect", BoxSelect, "Select")}
          </div>

          <Button variant="outline" size="sm" onClick={undo} disabled={!undoStack.length}>
            <Undo2 className="h-3.5 w-3.5" />
            <span className="sr-only">Undo</span>
          </Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={!redoStack.length}>
            <Redo2 className="h-3.5 w-3.5" />
            <span className="sr-only">Redo</span>
          </Button>

          {selected.length > 0 && (
            <Button variant="outline" size="sm" onClick={deleteSelection}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete {selected.length}
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={clearAll} disabled={!strokes.length}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => commit(strokesRef.current, { extraBlocks: extraBlocks + 1 })}
            disabled={!canGrow}
            title={canGrow ? "Add room below the question" : TOO_TALL}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add space
          </Button>
        </div>

        <div
          ref={wrapRef}
          className="relative w-full overflow-hidden rounded-lg border bg-white"
          onPointerDownCapture={trackTouchDown}
          onPointerMoveCapture={trackTouchMove}
          onPointerUpCapture={trackTouchUp}
          onPointerCancelCapture={trackTouchUp}
        >
          <canvas ref={bgRef} className="block w-full" style={{ aspectRatio: `${logicalW} / ${logicalH}` }} />
          <canvas ref={inkRef} className="pointer-events-none absolute inset-0 block h-full w-full" />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 block h-full w-full"
            // Never anything but "none". touch-action governs pen as well as
            // touch, so a scrolling value here lets the browser claim a
            // stylus stroke as a page drag — which is exactly what "pan-y"
            // did. Scrolling is handled in JS instead: two fingers always
            // pan, and one finger pans too once a stylus is in use.
            style={{ touchAction: "none", cursor, userSelect: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={endPointer}
          />

          {lines.map((line, i) => {
            const stepped = steppedButtons[i];
            const lit = previewing === line.top && canInsert;
            return (
              <div
                key={line.top}
                className="pointer-events-none absolute inset-x-0"
                style={{ top: `${(buttonPageY(gaps, line) / logicalH) * 100}%` }}
              >
                <button
                  type="button"
                  aria-label="Add working space above this answer line"
                  title={canInsert ? "Add working space here" : TOO_TALL}
                  // Disabled outright only while marking, when the canvas ignores
                  // input too. At the height cap it stays pressable so a tap
                  // explains itself instead of falling through as ink.
                  disabled={disabled}
                  aria-disabled={!canInsert}
                  onPointerEnter={(e) => {
                    if (e.pointerType !== "touch") setPreviewing(line.top);
                  }}
                  onPointerLeave={() => setPreviewing(null)}
                  onPointerDown={(e) => {
                    tap.current = {
                      // The nib on the glass, a palm-sized contact, or another
                      // finger already down (a scroll) is never a tap.
                      stray:
                        e.pointerType === "touch" &&
                        (penDown.current || looksLikePalm(e) || touches.current.size >= 2),
                      touch: e.pointerType === "touch",
                      at: e.timeStamp,
                    };
                  }}
                  onClick={(e) => {
                    const t = tap.current;
                    tap.current = null;
                    // A keyboard press has no pointer behind it (detail 0).
                    const fromPointer = e.detail > 0;
                    // A tapped button keeps focus, and the next key pressed
                    // anywhere would light its focus ring; only the keyboard
                    // should leave it focused.
                    if (fromPointer) e.currentTarget.blur();
                    // A touch held long once a stylus is in use is a palm that
                    // settled on the margin, not a fingertip.
                    if (
                      fromPointer &&
                      t &&
                      (t.stray || (t.touch && penSeen.current && e.timeStamp - t.at > LONG_PRESS_MS))
                    ) {
                      return;
                    }
                    if (!canInsert) {
                      toast(TOO_TALL);
                      return;
                    }
                    insertSpace(line);
                  }}
                  // As on the canvas: a press here is never claimed by the
                  // browser as a page drag.
                  style={{ touchAction: "none" }}
                  className={cn(
                    "peer pointer-events-auto absolute top-0 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-dashed shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
                    stepped ? "left-9" : "left-1",
                    !canInsert
                      ? "cursor-not-allowed border-muted-foreground/40 bg-white/90 text-muted-foreground/60"
                      : lit
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-primary/70 bg-white/90 text-primary",
                  )}
                >
                  <Plus className="h-4 w-4" />
                </button>
                {/* Where the room opens, shown before it does. */}
                {canInsert && (
                  <div
                    className={cn(
                      "absolute right-2 top-0 border-t border-dashed border-primary/60 transition-opacity peer-focus-visible:opacity-100",
                      stepped ? "left-[4.25rem]" : "left-9",
                      lit ? "opacity-100" : "opacity-0",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {selected.length > 0
            ? `${selected.length} stroke${selected.length === 1 ? "" : "s"} selected — drag to move, or press Delete.`
            : tool === "lasso"
              ? "Draw a loop around the working you want to move or delete."
              : tool === "rect"
                ? "Drag a box around the working you want to move or delete."
                : (usingPen
                    ? "Stylus in use — rest your hand on the screen, and swipe with a finger to scroll."
                    : "Write with a stylus, finger or mouse. Swipe with two fingers to scroll.") +
                  (lines.length ? " Tap + beside an answer line for more room." : "")}
        </p>
      </div>
    );
  },
);
DrawingCanvas.displayName = "DrawingCanvas";
