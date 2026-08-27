import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Pen, Eraser, Undo2, Redo2, Trash2, Plus, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Draw an answer directly onto the question, the way a student writes on the
 * paper itself.
 *
 * The question image is a locked background layer on its own canvas; ink goes
 * on a transparent canvas stacked above it. Keeping them apart means undo and
 * clear never have to redraw the photograph, and the export can flatten them
 * onto a white base in one pass.
 */

/** Claude downsamples to ~1568px on the long edge, so exporting much beyond
 *  that spends bytes on detail the marker will never see. */
const MAX_LONG_EDGE = 1600;

/** Ink width in canvas pixels at full pen pressure. */
const BASE_WIDTH = 3.2;

/** How much blank working room appears under the question, as a share of the
 *  question's own height. Cambridge answers often need more room than the
 *  paper leaves, and a student cannot turn the page here. */
const EXTRA_SHARE = 0.3;

/** Stop growing before the long edge costs more legibility than the extra room
 *  is worth — every added pixel of height shrinks the whole image on Claude's
 *  side, including the handwriting. */
const MAX_TOTAL_HEIGHT = 3200;

interface Point {
  x: number;
  y: number;
  w: number;
}
interface Stroke {
  points: Point[];
}

export interface DrawingCanvasHandle {
  /** Flattened question + ink as a JPEG, or null if nothing has been drawn. */
  exportBlob: () => Promise<Blob | null>;
  hasInk: () => boolean;
}

interface Props {
  questionImageUrl: string | null;
  /** Fires whenever the ink changes, so the parent can enable its submit button. */
  onInkChange?: (hasInk: boolean) => void;
  disabled?: boolean;
}

type Tool = "pen" | "eraser";

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(
  ({ questionImageUrl, onInkChange, disabled }, ref) => {
    const bgRef = useRef<HTMLCanvasElement>(null);
    const inkRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);

    const strokes = useRef<Stroke[]>([]);
    const redo = useRef<Stroke[]>([]);
    const current = useRef<Stroke | null>(null);
    const drawingPointer = useRef<number | null>(null);

    /**
     * Palm rejection. Once a stylus has been seen we stop treating touch as
     * drawing — a hand resting on an iPad is a touch, not an answer. Touch then
     * scrolls the page instead, which is why touch-action changes with it.
     */
    const penSeen = useRef(false);
    const [usingPen, setUsingPen] = useState(false);

    const [tool, setTool] = useState<Tool>("pen");
    const [extraBlocks, setExtraBlocks] = useState(1);
    const [size, setSize] = useState<{ w: number; h: number; imgH: number } | null>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [, forceRender] = useState(0);

    const bump = useCallback(() => {
      forceRender((n) => n + 1);
      onInkChange?.(strokes.current.length > 0);
    }, [onInkChange]);

    // ---- load the question image ------------------------------------------
    // Fetched as a blob rather than assigned straight to img.src: a cross
    // origin image taints the canvas and makes toBlob() throw, and a blob URL
    // is same-origin by construction so the export always works regardless of
    // what CORS headers the CDN sends.
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
          if (!res.ok) throw new Error(`image request failed (${res.status})`);
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);

          const img = new Image();
          img.src = objectUrl;
          await img.decode();
          if (cancelled) return;

          const scale = Math.min(1, MAX_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.round(img.naturalWidth * scale);
          const imgH = Math.round(img.naturalHeight * scale);
          imageRef.current = img;
          setSize({ w, h: imgH, imgH });
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

    // ---- size the canvases and paint the background ------------------------
    const extraH = size ? Math.round(size.imgH * EXTRA_SHARE) : 0;
    const totalH = size ? Math.min(size.imgH + extraH * extraBlocks, MAX_TOTAL_HEIGHT) : 0;
    const canGrow = size ? size.imgH + extraH * (extraBlocks + 1) <= MAX_TOTAL_HEIGHT : false;

    const redrawInk = useCallback(() => {
      const ink = inkRef.current;
      if (!ink) return;
      const ctx = ink.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, ink.width, ink.height);
      for (const s of strokes.current) drawStroke(ctx, s);
    }, []);

    useEffect(() => {
      if (!size) return;
      const bg = bgRef.current;
      const ink = inkRef.current;
      const img = imageRef.current;
      if (!bg || !ink || !img) return;

      bg.width = size.w;
      bg.height = totalH;
      ink.width = size.w;
      ink.height = totalH;

      const ctx = bg.getContext("2d");
      if (ctx) {
        // White under everything: the working area below the question must be
        // paper, and a transparent JPEG would flatten to black.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, size.w, totalH);
        ctx.drawImage(img, 0, 0, size.w, size.imgH);
        if (totalH > size.imgH) {
          ctx.strokeStyle = "rgba(15,36,56,0.13)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, size.imgH + 0.5);
          ctx.lineTo(size.w, size.imgH + 0.5);
          ctx.stroke();
        }
      }
      redrawInk();
    }, [size, totalH, redrawInk]);

    // ---- pointer handling ---------------------------------------------------
    const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const c = inkRef.current!;
      const r = c.getBoundingClientRect();
      const scale = c.width / r.width;
      return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale };
    };

    const widthFor = (e: { pointerType: string; pressure: number }) => {
      if (e.pointerType !== "pen") return BASE_WIDTH;
      // Browsers report 0 when a pen gives no pressure reading; 0.5 is the
      // neutral default the spec suggests for that case.
      const p = e.pressure > 0 ? e.pressure : 0.5;
      return BASE_WIDTH * (0.35 + 1.1 * p);
    };

    /** True when this event should be ignored as a resting palm. */
    const isPalm = (pointerType: string) => penSeen.current && pointerType === "touch";

    const eraseAt = (x: number, y: number) => {
      const R = 14;
      const before = strokes.current.length;
      strokes.current = strokes.current.filter(
        (s) => !s.points.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < R * R),
      );
      if (strokes.current.length !== before) {
        redo.current = [];
        redrawInk();
        bump();
      }
    };

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled || status !== "ready") return;
      if (e.pointerType === "pen" && !penSeen.current) {
        penSeen.current = true;
        setUsingPen(true);
      }
      if (isPalm(e.pointerType)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      // Capture keeps the stroke attached to this canvas if the pointer wanders
      // outside it mid-letter. It can throw for a pointer the browser no longer
      // owns, and an exception here would abandon the stroke before it starts —
      // losing the capture is survivable, losing the stroke is not.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* draw without capture */
      }
      drawingPointer.current = e.pointerId;
      const { x, y } = toCanvas(e);

      if (tool === "eraser") {
        eraseAt(x, y);
        return;
      }
      current.current = { points: [{ x, y, w: widthFor(e) }] };
      redo.current = [];
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (drawingPointer.current !== e.pointerId) return;
      if (isPalm(e.pointerType)) return;

      if (tool === "eraser") {
        const { x, y } = toCanvas(e);
        eraseAt(x, y);
        return;
      }
      const stroke = current.current;
      const ctx = inkRef.current?.getContext("2d");
      if (!stroke || !ctx) return;

      // Coalesced events carry the samples the browser batched between frames.
      // A stylus reports far faster than the display refreshes, and using only
      // the latest event throws that resolution away, which shows up as
      // straight-line corners in fast handwriting.
      const events =
        typeof e.nativeEvent.getCoalescedEvents === "function"
          ? e.nativeEvent.getCoalescedEvents()
          : [e.nativeEvent];

      for (const ev of events.length ? events : [e.nativeEvent]) {
        const c = inkRef.current!;
        const r = c.getBoundingClientRect();
        const scale = c.width / r.width;
        const pt: Point = {
          x: (ev.clientX - r.left) * scale,
          y: (ev.clientY - r.top) * scale,
          w: widthFor({ pointerType: ev.pointerType || e.pointerType, pressure: ev.pressure }),
        };
        stroke.points.push(pt);
      }
      // Repaint just this stroke rather than the whole layer.
      drawStroke(ctx, stroke);
    };

    const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (drawingPointer.current !== e.pointerId) return;
      drawingPointer.current = null;
      const stroke = current.current;
      current.current = null;
      if (stroke && stroke.points.length) {
        strokes.current.push(stroke);
        redrawInk();
        bump();
      }
    };

    // ---- actions -------------------------------------------------------------
    const undo = () => {
      const s = strokes.current.pop();
      if (!s) return;
      redo.current.push(s);
      redrawInk();
      bump();
    };
    const redoLast = () => {
      const s = redo.current.pop();
      if (!s) return;
      strokes.current.push(s);
      redrawInk();
      bump();
    };
    const clear = () => {
      if (!strokes.current.length) return;
      strokes.current = [];
      redo.current = [];
      redrawInk();
      bump();
    };

    useImperativeHandle(ref, () => ({
      hasInk: () => strokes.current.length > 0,
      exportBlob: async () => {
        const bg = bgRef.current;
        const ink = inkRef.current;
        if (!bg || !ink || !strokes.current.length) return null;

        const out = document.createElement("canvas");
        out.width = bg.width;
        out.height = bg.height;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(bg, 0, 0);
        ctx.drawImage(ink, 0, 0);

        return new Promise<Blob | null>((resolve) =>
          // JPEG rather than PNG: the background is a photograph of a printed
          // page, which PNG stores badly. 0.92 keeps ink edges clean.
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

    const hasInk = strokes.current.length > 0;

    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => setTool("pen")}
              aria-pressed={tool === "pen"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs",
                tool === "pen" ? "bg-primary text-primary-foreground" : "hover:bg-accent/10",
              )}
            >
              <Pen className="h-3.5 w-3.5" />
              Pen
            </button>
            <button
              type="button"
              onClick={() => setTool("eraser")}
              aria-pressed={tool === "eraser"}
              className={cn(
                "flex items-center gap-1.5 border-l px-3 py-1.5 text-xs",
                tool === "eraser" ? "bg-primary text-primary-foreground" : "hover:bg-accent/10",
              )}
            >
              <Eraser className="h-3.5 w-3.5" />
              Eraser
            </button>
          </div>

          <Button variant="outline" size="sm" onClick={undo} disabled={!hasInk}>
            <Undo2 className="h-3.5 w-3.5" />
            <span className="sr-only">Undo</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={redoLast}
            disabled={redo.current.length === 0}
          >
            <Redo2 className="h-3.5 w-3.5" />
            <span className="sr-only">Redo</span>
          </Button>
          <Button variant="outline" size="sm" onClick={clear} disabled={!hasInk}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExtraBlocks((n) => n + 1)}
            disabled={!canGrow}
            title={canGrow ? undefined : "Any more space would shrink your handwriting too much to mark reliably."}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add space
          </Button>
        </div>

        <div className="relative w-full overflow-hidden rounded-lg border bg-white">
          <canvas ref={bgRef} className="block w-full" />
          <canvas
            ref={inkRef}
            className="absolute inset-0 block w-full"
            // Before a stylus is seen, a finger draws, so the canvas must
            // swallow touch gestures. Once one is seen a finger is only ever
            // used to scroll, so give the gesture back to the page.
            style={{ touchAction: usingPen ? "pan-y" : "none", cursor: "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onPointerLeave={endStroke}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          {usingPen
            ? "Stylus detected — your palm is ignored and a finger scrolls the page."
            : "Write with a stylus, finger or mouse. A stylus gives the best results."}
        </p>
      </div>
    );
  },
);
DrawingCanvas.displayName = "DrawingCanvas";

/**
 * Paint one stroke. Segments are drawn individually so the width can follow
 * pen pressure along the stroke, with midpoint smoothing so fast handwriting
 * does not come out as a chain of visible straight lines.
 */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points;
  if (!pts.length) return;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#101828";

  if (pts.length === 1) {
    ctx.beginPath();
    ctx.fillStyle = "#101828";
    ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    ctx.beginPath();
    ctx.lineWidth = (a.w + b.w) / 2;
    if (i === 1) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2);
    } else {
      const prev = pts[i - 2];
      ctx.moveTo((prev.x + a.x) / 2, (prev.y + a.y) / 2);
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    ctx.stroke();
  }
}
