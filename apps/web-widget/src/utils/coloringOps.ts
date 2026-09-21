/**
 * Pure drawing model for the coloring canvas: an ordered list of operations
 * replayed onto a 2D context. Keeping it pure lets fills and export share
 * one code path and be unit tested without a browser canvas.
 */
export type Point = { x: number; y: number };

export interface StrokeOp {
  kind: 'stroke';
  color: string;
  size: number;
  points: Point[];
  /** Eraser strokes clear paint instead of adding it. */
  erase?: boolean;
}

export interface FillOp {
  kind: 'fill';
  color: string;
  x: number;
  y: number;
}

export type ColoringOp = StrokeOp | FillOp;

export const CANVAS_SIZE = 512;

/** Kid-friendly swatches. First entry is the default brush color. */
export const PALETTE: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Sky blue', hex: '#2563eb' },
  { name: 'Cherry red', hex: '#dc2626' },
  { name: 'Sunny yellow', hex: '#facc15' },
  { name: 'Grass green', hex: '#16a34a' },
  { name: 'Tangerine', hex: '#f97316' },
  { name: 'Grape', hex: '#7c3aed' },
  { name: 'Bubblegum', hex: '#ec4899' },
  { name: 'Aqua', hex: '#06b6d4' },
  { name: 'Chocolate', hex: '#92400e' },
  { name: 'Peach', hex: '#fdba74' },
  { name: 'Charcoal', hex: '#334155' },
  { name: 'Snow', hex: '#ffffff' },
];

export const drawStrokeSegment = (
  ctx: CanvasRenderingContext2D,
  op: StrokeOp,
  from: Point,
  to: Point,
): void => {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = op.erase ? '#000000' : op.color;
  ctx.lineWidth = op.size;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
};

export const drawStroke = (ctx: CanvasRenderingContext2D, op: StrokeOp): void => {
  const start = op.points[0];
  if (!start) return;
  if (op.points.length === 1) {
    drawStrokeSegment(ctx, op, start, start);
    return;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = op.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = op.erase ? '#000000' : op.color;
  ctx.lineWidth = op.size;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (const point of op.points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
};

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const parsed = Number.parseInt(value, 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
};

/**
 * Flood fill on raw RGBA pixels. `barrier` is an optional alpha mask (one
 * byte per pixel) from the rasterized outline: any pixel where the outline
 * is drawn stops the fill, so paint stays inside the lines. Returns the
 * number of pixels changed.
 */
export const floodFillPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  color: string,
  barrier?: Uint8ClampedArray,
  barrierThreshold = 40,
): number => {
  const x0 = Math.floor(startX);
  const y0 = Math.floor(startY);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return 0;
  const startIndex = (y0 * width + x0) * 4;
  if (barrier && (barrier[y0 * width + x0] ?? 0) >= barrierThreshold) return 0;

  const [fr, fg, fb] = hexToRgb(color);
  const target = [
    pixels[startIndex] ?? 0,
    pixels[startIndex + 1] ?? 0,
    pixels[startIndex + 2] ?? 0,
    pixels[startIndex + 3] ?? 0,
  ];
  if (target[0] === fr && target[1] === fg && target[2] === fb && target[3] === 255) return 0;

  const matches = (index: number) =>
    pixels[index] === target[0] &&
    pixels[index + 1] === target[1] &&
    pixels[index + 2] === target[2] &&
    pixels[index + 3] === target[3];

  const visited = new Uint8Array(width * height);
  const stack: number[] = [y0 * width + x0];
  let changed = 0;
  while (stack.length > 0) {
    const pixel = stack.pop() as number;
    if (visited[pixel]) continue;
    visited[pixel] = 1;
    if (barrier && (barrier[pixel] ?? 0) >= barrierThreshold) continue;
    const index = pixel * 4;
    if (!matches(index)) continue;
    pixels[index] = fr;
    pixels[index + 1] = fg;
    pixels[index + 2] = fb;
    pixels[index + 3] = 255;
    changed += 1;
    const x = pixel % width;
    const y = (pixel - x) / width;
    if (x > 0) stack.push(pixel - 1);
    if (x < width - 1) stack.push(pixel + 1);
    if (y > 0) stack.push(pixel - width);
    if (y < height - 1) stack.push(pixel + width);
  }
  return changed;
};

export const applyFill = (
  ctx: CanvasRenderingContext2D,
  op: FillOp,
  barrier?: Uint8ClampedArray,
): void => {
  const width = ctx.canvas?.width ?? CANVAS_SIZE;
  const height = ctx.canvas?.height ?? CANVAS_SIZE;
  if (typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return;
  const image = ctx.getImageData(0, 0, width, height);
  const changed = floodFillPixels(image.data, width, height, op.x, op.y, op.color, barrier);
  if (changed > 0) ctx.putImageData(image, 0, 0);
};

/** Clear the context and replay every op in order. */
export const replayOps = (
  ctx: CanvasRenderingContext2D,
  ops: readonly ColoringOp[],
  barrier?: Uint8ClampedArray,
): void => {
  ctx.clearRect(0, 0, ctx.canvas?.width ?? CANVAS_SIZE, ctx.canvas?.height ?? CANVAS_SIZE);
  for (const op of ops) {
    if (op.kind === 'stroke') drawStroke(ctx, op);
    else applyFill(ctx, op, barrier);
  }
};

/** Alpha channel of an RGBA buffer, one byte per pixel. */
export const alphaMask = (pixels: Uint8ClampedArray): Uint8ClampedArray => {
  const mask = new Uint8ClampedArray(pixels.length / 4);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = pixels[index * 4 + 3] ?? 0;
  }
  return mask;
};
