import { describe, expect, it } from 'vitest';
import { sanitizeSvgOutline } from './svgSanitizer.js';

describe('sanitizeSvgOutline', () => {
  it('keeps benign kid-safe SVG outlines', () => {
    const safeSvg =
      '<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><g stroke="#111827" fill="none"><circle cx="256" cy="256" r="128" /><path d="M128 300 Q256 420 384 300" /></g></svg>';

    expect(sanitizeSvgOutline(safeSvg)).toContain('<svg');
  });

  it('rejects script tags', () => {
    const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="20" cy="20" r="10"/></svg>';
    expect(sanitizeSvgOutline(unsafeSvg)).toBeUndefined();
  });

  it('rejects event-handler attributes', () => {
    const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="10" onclick="alert(1)" /></svg>';
    expect(sanitizeSvgOutline(unsafeSvg)).toBeUndefined();
  });

  it('rejects href and javascript protocols', () => {
    const unsafeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text x="10" y="10">hi</text></a></svg>';
    expect(sanitizeSvgOutline(unsafeSvg)).toBeUndefined();
  });
});
