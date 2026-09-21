import { describe, expect, it } from 'vitest';
import { alphaMask, floodFillPixels } from './coloringOps.js';

const blank = (width: number, height: number) => new Uint8ClampedArray(width * height * 4);

const pixelAt = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const index = (y * width + x) * 4;
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
};

describe('floodFillPixels', () => {
  it('fills a connected transparent region with the color', () => {
    const pixels = blank(4, 4);
    const changed = floodFillPixels(pixels, 4, 4, 1, 1, '#ff0000');
    expect(changed).toBe(16);
    expect(pixelAt(pixels, 4, 3, 3)).toEqual([255, 0, 0, 255]);
  });

  it('stops at outline pixels so paint stays inside the lines', () => {
    const width = 5;
    const height = 5;
    const pixels = blank(width, height);
    // Vertical outline down column 2 splits the canvas in two.
    const barrier = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y += 1) barrier[y * width + 2] = 255;

    const changed = floodFillPixels(pixels, width, height, 0, 0, '#00ff00', barrier);
    expect(changed).toBe(10);
    expect(pixelAt(pixels, width, 1, 4)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(pixels, width, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(pixels, width, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('does nothing when clicking on the outline itself or off canvas', () => {
    const pixels = blank(3, 3);
    const barrier = new Uint8ClampedArray(9);
    barrier[4] = 200;
    expect(floodFillPixels(pixels, 3, 3, 1, 1, '#0000ff', barrier)).toBe(0);
    expect(floodFillPixels(pixels, 3, 3, -1, 0, '#0000ff')).toBe(0);
    expect(floodFillPixels(pixels, 3, 3, 3, 3, '#0000ff')).toBe(0);
  });

  it('only replaces pixels matching the clicked color', () => {
    const pixels = blank(3, 1);
    pixels.set([255, 255, 0, 255], 4); // middle pixel is yellow
    const changed = floodFillPixels(pixels, 3, 1, 0, 0, '#0000ff');
    expect(changed).toBe(1);
    expect(pixelAt(pixels, 3, 1, 0)).toEqual([255, 255, 0, 255]);
    expect(pixelAt(pixels, 3, 2, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('alphaMask', () => {
  it('extracts one alpha byte per pixel', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 7]);
    expect(Array.from(alphaMask(pixels))).toEqual([0, 255, 7]);
  });
});
