import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

type OutlineStyle = 'animals' | 'space' | 'underwater' | undefined;

interface ColoringResponse {
  blocked: boolean;
  message?: string;
  svg?: string;
}

type Point = { x: number; y: number };

type Stroke = { color: string; size: number; points: Point[] };

const CANVAS_SIZE = 512;

const renderStrokes = (canvas: HTMLCanvasElement, strokes: Stroke[]) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  for (const stroke of strokes) {
    if (stroke.points.length === 0) {
      continue;
    }
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
};

export const ColoringBook = () => {
  const [scene, setScene] = useState('Joyful treehouse afternoon');
  const [style, setStyle] = useState<OutlineStyle>(undefined);
  const [outline, setOutline] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [brushColor, setBrushColor] = useState('#2563eb');
  const [brushSize, setBrushSize] = useState(6);
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<boolean>(false);
  const currentStrokeRef = useRef<Stroke | null>(null);

  useEffect(() => {
    window.openai?.setWidgetState?.({ tab: 'coloring', scene, style, brushColor, brushSize });
  }, [scene, style, brushColor, brushSize]);

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
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE
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
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'kidbot-coloring.png';
    link.click();
  };

  const fetchOutline = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = (await window.openai?.callTool?.('coloring_outline', { scene, style })) as ColoringResponse | undefined;
      if (!result) {
        throw new Error('Widget bridge unavailable.');
      }
      if (result.blocked) {
        setOutline(undefined);
        setError(result.message ?? 'KidBot paused this outline request.');
      } else {
        setOutline(result.svg);
      }
      setStrokes([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel coloring-book">
      <h2>Coloring Corner</h2>
      <div className="control-row">
        <label htmlFor="scene">Scene</label>
        <input id="scene" value={scene} onChange={(event) => setScene(event.target.value)} />
        <label htmlFor="style">Style</label>
        <select id="style" value={style ?? ''} onChange={(event) => setStyle(event.target.value ? (event.target.value as OutlineStyle) : undefined)}>
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
      <div className="coloring-stage">
        <div className="canvas-wrapper">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
          {outline && <div className="outline" dangerouslySetInnerHTML={{ __html: outline }} />}
        </div>
        <aside className="tools">
          <label htmlFor="color">Color</label>
          <input id="color" type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} />
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
          <button type="button" onClick={handleSave}>
            Save PNG
          </button>
        </aside>
      </div>
    </section>
  );
};
