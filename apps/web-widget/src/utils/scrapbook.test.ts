import { describe, expect, it } from 'vitest';
import { SCRAPBOOK_LIMIT, addScrapbookItem, removeScrapbookItem } from './scrapbook.js';

describe('scrapbook', () => {
  const now = () => '2026-09-21T12:00:00.000Z';

  it('adds newest first with an id and timestamp', () => {
    const first = addScrapbookItem([], { kind: 'story', title: 'Turtle', panels: [] }, now);
    const second = addScrapbookItem(
      first,
      { kind: 'coloring', title: 'Cat', pngDataUrl: 'data:image/png;base64,x' },
      now,
    );
    expect(second.map((item) => item.title)).toEqual(['Cat', 'Turtle']);
    expect(second[0]?.id).toMatch(/^kb_item_/);
    expect(second[0]?.createdAt).toBe('2026-09-21T12:00:00.000Z');
    expect(second[0]?.id).not.toBe(second[1]?.id);
  });

  it('caps the list so a long session cannot grow forever', () => {
    let items = addScrapbookItem([], { kind: 'story', title: 'Story 0', panels: [] }, now);
    for (let index = 1; index <= SCRAPBOOK_LIMIT + 3; index += 1) {
      items = addScrapbookItem(items, { kind: 'story', title: `Story ${index}`, panels: [] }, now);
    }
    expect(items).toHaveLength(SCRAPBOOK_LIMIT);
    expect(items[0]?.title).toBe(`Story ${SCRAPBOOK_LIMIT + 3}`);
  });

  it('removes by id without touching the rest', () => {
    const items = addScrapbookItem(
      addScrapbookItem([], { kind: 'story', title: 'A', panels: [] }, now),
      { kind: 'experiment', title: 'B', prediction: 'floats', wasCorrect: true, explanation: 'air' },
      now,
    );
    const target = items[1]?.id ?? '';
    expect(removeScrapbookItem(items, target).map((item) => item.title)).toEqual(['B']);
  });
});
