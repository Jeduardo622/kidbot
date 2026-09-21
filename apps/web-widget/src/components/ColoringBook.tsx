import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { sanitizeSvgOutline } from '../utils/svgSanitizer.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import {
  CANVAS_SIZE,
  PALETTE,
  alphaMask,
  drawStrokeSegment,
  replayOps,
  type ColoringOp,
  type Point,
  type StrokeOp,
} from '../utils/coloringOps.js';
import type { ScrapbookDraft } from '../utils/scrapbook.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import { starterOutlinesFor, type StarterStyle } from '../utils/starterOutlines.js';
import { isColoringResult, type ColoringResult } from '../utils/toolResult.js';
import { useToolCall } from '../utils/useToolCall.js';

type OutlineStyle = StarterStyle | undefined;
type Tool = 'brush' | 'fill' | 'eraser';

const KEYBOARD_STEP = 12;

const loadOutlineImage = (svg: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const release = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      release();
      resolve(image);
    };
    image.onerror = () => {
      release();
      reject(new Error('Coloring outline could not be loaded for export.'));
    };
    image.src = objectUrl;
  });

/** Rasterize the outline once so bucket fills can stop at its lines. */
const buildBarrier = async (svg: string): Promise<Uint8ClampedArray | undefined> => {
  try {
    const image = await loadOutlineImage(svg);
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.getImageData !== 'function') return undefined;
    ctx.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    return alphaMask(ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data);
  } catch {
    return undefined;
  }
};

interface ColoringBookProps {
  sessionContext?: SessionContext;
  onSaveToScrapbook?: (draft: ScrapbookDraft) => void;
}

export const ColoringBook = ({
  sessionContext = defaultSessionContext,
  onSaveToScrapbook,
}: ColoringBookProps) => {
  const [scene, setScene] = useState('Joyful treehouse afternoon');
  const [style, setStyle] = useState<OutlineStyle>(undefined);
  const [outline, setOutline] = useState<string | undefined>();
  const [outlineTitle, setOutlineTitle] = useState<string>('My coloring page');
  const [blocked, setBlocked] = useState<string | undefined>();
  const [brushColor, setBrushColor] = useState(PALETTE[0]?.hex ?? '#2563eb');
  const [brushSize, setBrushSize] = useState(8);
  const [activeTool, setActiveTool] = useState<Tool>('brush');
  const [ops, setOps] = useState<ColoringOp[]>([]);
  const [saveStatus, setSaveStatus] = useState<
    { kind: 'error' | 'pending' | 'success'; message: string } | undefined
  >();
  const [scrapbookStatus, setScrapbookStatus] = useState<string | undefined>();
  const tool = useToolCall<ColoringResult>('coloring_outline', isColoringResult, {
    blockedFallback: 'Kidbot paused this outline request.',
  });
  const announcement = buildAnnouncementState({
    loading: tool.loading,
    loadingMessage: 'Kidbot is drawing your coloring outline.',
    errorMessage: tool.error,
    urgentMessage: tool.unavailable ?? blocked,
    readyMessage: outline ? 'Coloring outline ready.' : '',
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<boolean>(false);
  const currentStrokeRef = useRef<StrokeOp | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const keyboardCursorRef = useRef<Point>({ x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 });
  const barrierRef = useRef<Uint8ClampedArray | undefined>(undefined);
  const opsRef = useRef<ColoringOp[]>([]);
  opsRef.current = ops;

  const context = () => canvasRef.current?.getContext('2d') ?? undefined;

  const rerender = useCallback((nextOps: readonly ColoringOp[]) => {
    const ctx = context();
    if (ctx) replayOps(ctx, nextOps, barrierRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    barrierRef.current = undefined;
    if (outline) {
      void buildBarrier(outline).then((mask) => {
        if (cancelled) return;
        barrierRef.current = mask;
        rerender(opsRef.current);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [outline, rerender]);

  const commitOps = (updater: (prev: ColoringOp[]) => ColoringOp[]) => {
    setOps((prev) => {
      const next = updater(prev);
      rerender(next);
      return next;
    });
    setSaveStatus(undefined);
    setScrapbookStatus(undefined);
  };

  const pointerPosition = (event: PointerEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const point = pointerPosition(event.nativeEvent);
    if (activeTool === 'fill') {
      commitOps((prev) => [...prev, { kind: 'fill', color: brushColor, x: point.x, y: point.y }]);
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const stroke: StrokeOp = {
      kind: 'stroke',
      color: brushColor,
      size: activeTool === 'eraser' ? brushSize * 2 : brushSize,
      points: [point],
      ...(activeTool === 'eraser' ? { erase: true } : {}),
    };
    currentStrokeRef.current = stroke;
    lastPointRef.current = point;
    const ctx = context();
    if (ctx) drawStrokeSegment(ctx, stroke, point, point);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const stroke = currentStrokeRef.current;
    const last = lastPointRef.current;
    if (!drawingRef.current || !stroke || !last) {
      return;
    }
    const point = pointerPosition(event.nativeEvent);
    stroke.points.push(point);
    lastPointRef.current = point;
    const ctx = context();
    if (ctx) drawStrokeSegment(ctx, stroke, last, point);
  };

  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    const stroke = currentStrokeRef.current;
    currentStrokeRef.current = null;
    lastPointRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (stroke) {
      setOps((prev) => [...prev, { ...stroke, points: [...stroke.points] }]);
      setSaveStatus(undefined);
      setScrapbookStatus(undefined);
    }
  };

  const handleUndo = () => commitOps((prev) => prev.slice(0, -1));

  const handleClear = () => {
    commitOps(() => []);
    keyboardCursorRef.current = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
  };

  const handleKeyboardDraw = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      if (activeTool === 'fill') {
        event.preventDefault();
        const cursor = keyboardCursorRef.current;
        commitOps((prev) => [...prev, { kind: 'fill', color: brushColor, x: cursor.x, y: cursor.y }]);
      }
      return;
    }
    const movement: Record<string, Point> = {
      ArrowDown: { x: 0, y: KEYBOARD_STEP },
      ArrowLeft: { x: -KEYBOARD_STEP, y: 0 },
      ArrowRight: { x: KEYBOARD_STEP, y: 0 },
      ArrowUp: { x: 0, y: -KEYBOARD_STEP },
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    const start = keyboardCursorRef.current;
    const end = {
      x: Math.max(0, Math.min(CANVAS_SIZE, start.x + delta.x)),
      y: Math.max(0, Math.min(CANVAS_SIZE, start.y + delta.y)),
    };
    keyboardCursorRef.current = end;
    if (activeTool === 'fill') return;
    commitOps((prev) => [
      ...prev,
      {
        kind: 'stroke',
        color: brushColor,
        size: activeTool === 'eraser' ? brushSize * 2 : brushSize,
        points: [start, end],
        ...(activeTool === 'eraser' ? { erase: true } : {}),
      },
    ]);
  };

  const composePng = async (): Promise<string> => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = CANVAS_SIZE;
    exportCanvas.height = CANVAS_SIZE;
    const exportContext = exportCanvas.getContext('2d');
    if (!exportContext) throw new Error('Canvas export is unavailable.');
    exportContext.fillStyle = '#ffffff';
    exportContext.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    // Paint is replayed onto a transparent layer first so eraser strokes and
    // fills behave exactly as on screen, then composited over white.
    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = CANVAS_SIZE;
    paintCanvas.height = CANVAS_SIZE;
    const paintContext = paintCanvas.getContext('2d');
    if (paintContext) {
      replayOps(paintContext, ops, barrierRef.current);
      exportContext.drawImage(paintCanvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    if (outline) {
      const outlineImage = await loadOutlineImage(outline);
      exportContext.drawImage(outlineImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    }
    return exportCanvas.toDataURL('image/png');
  };

  const handleSave = async () => {
    if (saveStatus?.kind === 'pending') return;
    setSaveStatus({ kind: 'pending', message: 'Preparing coloring page…' });
    try {
      const link = document.createElement('a');
      link.href = await composePng();
      link.download = 'kidbot-coloring.png';
      link.click();
      setSaveStatus({ kind: 'success', message: 'Coloring page saved.' });
    } catch {
      setSaveStatus({
        kind: 'error',
        message: 'Coloring page could not be saved. Please try again.',
      });
    }
  };

  const handleScrapbook = async () => {
    if (!onSaveToScrapbook) return;
    try {
      const pngDataUrl = await composePng();
      onSaveToScrapbook({ kind: 'coloring', title: outlineTitle, pngDataUrl });
      setScrapbookStatus('Saved to My Creations.');
    } catch {
      setScrapbookStatus('Could not save this page. Please try again.');
    }
  };

  const applyStarter = (svg: string, title: string) => {
    const sanitized = sanitizeSvgOutline(svg);
    if (!sanitized) return;
    tool.reset();
    setBlocked(undefined);
    setOutline(sanitized);
    setOutlineTitle(title);
    commitOps(() => []);
    keyboardCursorRef.current = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
  };

  const fetchOutline = async () => {
    setBlocked(undefined);
    setOutline(undefined);
    const outcome = await tool.run({ ...sessionContext, scene, style });
    if (outcome.kind === 'ok') {
      const sanitized = sanitizeSvgOutline(outcome.result.svg);
      if (!sanitized) {
        setOutline(undefined);
        setBlocked('Kidbot removed an unsafe outline. Try a different scene.');
      } else {
        setOutline(sanitized);
        setOutlineTitle(scene.trim() || 'My coloring page');
      }
      commitOps(() => []);
      keyboardCursorRef.current = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
    } else if (outcome.kind === 'blocked') {
      setOutline(undefined);
      setBlocked(outcome.message);
    } else if (outcome.kind !== 'stale') {
      setOutline(undefined);
    }
  };

  const starters = starterOutlinesFor(style);
  const hasWork = ops.length > 0;

  return (
    <section className="panel coloring-book" aria-busy={tool.loading}>
      <h2>Coloring Corner</h2>
      <LiveRegion message={announcement.message} isAlert={announcement.isAlert} />
      <div className="control-row">
        <label htmlFor="scene">Scene</label>
        <input id="scene" value={scene} onChange={(event) => setScene(event.target.value)} />
        <label htmlFor="style">Style</label>
        <select
          id="style"
          value={style ?? ''}
          onChange={(event) =>
            setStyle(event.target.value ? (event.target.value as StarterStyle) : undefined)
          }
        >
          <option value="">Any</option>
          <option value="animals">Animals</option>
          <option value="space">Space</option>
          <option value="underwater">Underwater</option>
        </select>
        <button type="button" onClick={() => void fetchOutline()} disabled={tool.loading}>
          {tool.loading ? 'Drawing...' : 'Get Outline'}
        </button>
      </div>
      <div className="starter-row" role="group" aria-label="Starter pages">
        <span className="starter-label">Start right away:</span>
        {starters.map((starter) => (
          <button
            key={starter.id}
            type="button"
            className="chip"
            onClick={() => applyStarter(starter.svg, starter.title)}
          >
            {starter.title}
          </button>
        ))}
      </div>
      {tool.error && <p className="error">{tool.error}</p>}
      {tool.unavailable && <p className="degraded">{tool.unavailable}</p>}
      {blocked && <p className="blocked">{blocked}</p>}
      <div className="coloring-stage">
        <div className={`canvas-wrapper tool-${activeTool}`}>
          <canvas
            aria-describedby="coloring-canvas-instructions"
            aria-label="Coloring canvas"
            ref={canvasRef}
            tabIndex={0}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            onKeyDown={handleKeyboardDraw}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
          {outline && <div className="outline" dangerouslySetInnerHTML={{ __html: outline }} />}
        </div>
        <aside className="tools">
          <p id="coloring-canvas-instructions">
            Use arrow keys to draw from the center of the canvas.
            {activeTool === 'fill' ? ' Press Space to fill where the cursor is.' : ''}
          </p>
          <div className="tool-picker" role="group" aria-label="Tool">
            {(['brush', 'fill', 'eraser'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`chip ${activeTool === option ? 'selected' : ''}`}
                aria-pressed={activeTool === option}
                onClick={() => setActiveTool(option)}
              >
                {option === 'brush' ? '🖌️ Brush' : option === 'fill' ? '🪣 Fill' : '🧽 Eraser'}
              </button>
            ))}
          </div>
          <div className="palette" role="group" aria-label="Color">
            {PALETTE.map((swatch) => (
              <button
                key={swatch.hex}
                type="button"
                className={`swatch ${brushColor === swatch.hex ? 'selected' : ''}`}
                style={{ background: swatch.hex }}
                aria-label={swatch.name}
                aria-pressed={brushColor === swatch.hex}
                onClick={() => setBrushColor(swatch.hex)}
              />
            ))}
          </div>
          <label htmlFor="color">More colors</label>
          <input
            id="color"
            type="color"
            value={brushColor}
            onChange={(event) => setBrushColor(event.target.value)}
          />
          <label htmlFor="brush">Brush size</label>
          <input
            id="brush"
            type="range"
            min={2}
            max={24}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
          <button type="button" onClick={handleUndo} disabled={!hasWork}>
            Undo
          </button>
          <button type="button" onClick={handleClear} disabled={!hasWork}>
            Clear
          </button>
          <button
            type="button"
            disabled={saveStatus?.kind === 'pending' || (!outline && !hasWork)}
            onClick={() => void handleSave()}
          >
            {saveStatus?.kind === 'pending' ? 'Preparing PNG…' : 'Save PNG'}
          </button>
          {onSaveToScrapbook && (
            <button
              type="button"
              disabled={!outline && !hasWork}
              onClick={() => void handleScrapbook()}
            >
              Save to My Creations
            </button>
          )}
          {saveStatus && (
            <p
              className={`save-status ${saveStatus.kind}`}
              role={saveStatus.kind === 'error' ? 'alert' : 'status'}
            >
              {saveStatus.message}
            </p>
          )}
          {scrapbookStatus && (
            <p className="save-status success" role="status">
              {scrapbookStatus}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
};
