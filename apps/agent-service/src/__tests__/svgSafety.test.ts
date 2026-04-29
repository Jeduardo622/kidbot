import { describe, expect, it } from 'vitest';
import { validateColoringSvg } from '../svgSafety.js';

describe('svg safety', () => {
  it('normalizes safe outline SVGs to the documented contract', () => {
    const result = validateColoringSvg('<svg viewBox="0 0 512 512"><circle cx="50" cy="50" r="20" fill="none" stroke="#123456"/></svg>');
    expect(result.ok).toBe(true);
    expect(result.svg).toContain('viewBox="0 0 1024 1024"');
    expect(result.svg).toContain('stroke="#000"');
    expect(result.svg).toContain('fill="none"');
  });

  it('rejects scripts, external references, styles, images, and filled regions', () => {
    expect(validateColoringSvg('<svg viewBox="0 0 1024 1024"><script>alert(1)</script></svg>').ok).toBe(false);
    expect(validateColoringSvg('<svg viewBox="0 0 1024 1024"><image href="https://example.com/a.png"/></svg>').ok).toBe(false);
    expect(validateColoringSvg('<svg viewBox="0 0 1024 1024"><style>circle{fill:red}</style></svg>').ok).toBe(false);
    expect(validateColoringSvg('<svg viewBox="0 0 1024 1024"><circle fill="red" cx="1" cy="1" r="1"/></svg>').ok).toBe(true);
  });
});
