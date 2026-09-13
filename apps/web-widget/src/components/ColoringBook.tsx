import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useEffect, useRef, useState } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { sanitizeSvgOutline } from '../utils/svgSanitizer.js';
import { buildAnnouncementState } from '../utils/announcementState.js';
import {
  degradedMessage,
  errorMessage,
  unavailableMessageFromError,
} from '../utils/degradation.js';
import { defaultSessionContext, type SessionContext } from '../utils/sessionContext.js';
import { isColoringResult, readStructuredContent } from '../utils/toolResult.js';

type OutlineStyle = 'animals' | 'space' | 'underwater' | undefined;

type Point = { x: number; y: number };

type Stroke = { color: string; size: number; points: Point[] };

const CANVAS_SIZE = 512;
const KEYBOARD_STEP = 12;

const drawStrokes = (ctx: CanvasRenderingContext2D, strokes: Stroke[]) => {
  ctx.lineCap = 'round';
  for (const stroke of strokes) {
    if (stroke.points.length === 0) {
      continue;
    }
    const start = stroke.points[0];
    if (!start) {
      continue;
    }
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (const point of stroke.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
};

const renderStrokes = (canvas: HTMLCanvasElement, strokes: Stroke[]) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawStrokes(ctx, strokes);
};

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

interface ColoringBookProps {
  sessionContext?: SessionContext;
}

export const ColoringBook = ({ sessionContext = defaultSessionContext }: ColoringBookProps) => {
  const [scene, setScene] = useState('Joyful treehouse afternoon');
  const [style, setStyle] = useState<OutlineStyle>(undefined);
  const [outline, setOutline] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const [brushColor, setBrushColor] = useState('#2563eb');
  const [brushSize, setBrushSize] = useState(6);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [saveStatus, setSaveStatus] = useState<
    { kind: 'error' | 'pending' | 'success'; message: string } | undefined
  >();
  const announcement = buildAnnouncementState({
    loading,
    loadingMessage: 'Kidbot is drawing your coloring outline.',
    errorMessage: error,
    urgentMessage: unavailable,
    readyMessage: outline ? 'Coloring outline ready.' : '',
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<boolean>(false);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const keyboardCursorRef = useRef<Point>({ x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 });

  useEffect(() => {
    if (canvasRef.current) {
      renderStrokes(canvasRef.current, strokes);
    }
  }, [strokes]);

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
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const start = pointerPosition(event.nativeEvent);
    const newStroke: Stroke = { color: brushColor, size: brushSize, points: [start] };
    currentStrokeRef.current = newStroke;
    setStrokes((prev) => [...prev, newStroke]);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !currentStrokeRef.current) {
      return;
    }
    const point = pointerPosition(event.nativeEvent);
    currentStrokeRef.current.points.push(point);
    setStrokes((prev) => [...prev.slice(0, -1), currentStrokeRef.current as Stroke]);
  };

  const endStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    currentStrokeRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };

  const handleUndo = () => {
    setStrokes((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setStrokes([]);
    keyboardCursorRef.current = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
  };

  const handleKeyboardDraw = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
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
    setStrokes((prev) => [...prev, { color: brushColor, size: brushSize, points: [start, end] }]);
    setSaveStatus(undefined);
  };

  const handleSave = async () => {
    if (saveStatus?.kind === 'pending') return;
    setSaveStatus({ kind: 'pending', message: 'Preparing coloring page…' });
    try {
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = CANVAS_SIZE;
      exportCanvas.height = CANVAS_SIZE;
      const exportContext = exportCanvas.getContext('2d');
      if (!exportContext) throw new Error('Canvas export is unavailable.');
      exportContext.fillStyle = '#ffffff';
      exportContext.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      drawStrokes(exportContext, strokes);
      if (outline) {
        const outlineImage = await loadOutlineImage(outline);
        exportContext.drawImage(outlineImage, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }
      const link = document.createElement('a');
      link.href = exportCanvas.toDataURL('image/png');
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

  const fetchOutline = async () => {
    setLoading(true);
    setError(undefined);
    setUnavailable(undefined);
    setOutline(undefined);
    try {
      const result = readStructuredContent(await window.openai?.callTool?.('coloring_outline', {
        ...sessionContext,
        scene,
        style,
      }), isColoringResult);
      const unavailableMessage = degradedMessage(result);
      if (unavailableMessage) {
        setOutline(undefined);
        setUnavailable(unavailableMessage);
      } else if (result.blocked) {
        setOutline(undefined);
        setError(result.message ?? 'Kidbot paused this outline request.');
      } else {
        const sanitized = sanitizeSvgOutline(result.svg);
        if (!sanitized) {
          setOutline(undefined);
          setError('Kidbot removed an unsafe outline. Try a different scene.');
        } else {
          setOutline(sanitized);
        }
      }
      setStrokes([]);
      keyboardCursorRef.current = { x: CANVAS_SIZE / 2, y: CANVAS_SIZE / 2 };
      setSaveStatus(undefined);
    } catch (err) {
      setOutline(undefined);
      const unavailableMessage = unavailableMessageFromError(err);
      if (unavailableMessage) {
        setUnavailable(unavailableMessage);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel coloring-book" aria-busy={loading}>
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
            setStyle(event.target.value ? (event.target.value as OutlineStyle) : undefined)
          }
        >
          <option value="">Any</option>
          <option value="animals">Animals</option>
          <option value="space">Space</option>
          <option value="underwater">Underwater</option>
        </select>
        <button type="button" onClick={fetchOutline} disabled={loading}>
          {loading ? 'Drawing...' : 'Get Outline'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {unavailable && <p className="degraded">{unavailable}</p>}
      <div className="coloring-stage">
        <div className="canvas-wrapper">
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
          </p>
          <label htmlFor="color">Color</label>
          <input
            id="color"
            type="color"
            value={brushColor}
            onChange={(event) => setBrushColor(event.target.value)}
          />
          <label htmlFor="brush">Brush</label>
          <input
            id="brush"
            type="range"
            min={2}
            max={20}
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
          <button type="button" onClick={handleUndo} disabled={strokes.length === 0}>
            Undo
          </button>
          <button type="button" onClick={handleClear} disabled={strokes.length === 0}>
            Clear
          </button>
          <button
            type="button"
            disabled={saveStatus?.kind === 'pending' || (!outline && strokes.length === 0)}
            onClick={() => void handleSave()}
          >
            {saveStatus?.kind === 'pending' ? 'Preparing PNG…' : 'Save PNG'}
          </button>
          {saveStatus && (
            <p
              className={`save-status ${saveStatus.kind}`}
              role={saveStatus.kind === 'error' ? 'alert' : 'status'}
            >
              {saveStatus.message}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
};
