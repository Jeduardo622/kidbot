import type { StoryPanel } from './toolResult.js';

/**
 * Session scrapbook: things the child made, kept in React memory for the
 * life of the widget so switching tabs or starting a new activity never
 * loses them. Nothing here is written to host widget state or the server;
 * generated images are public Supabase URLs with a 24 hour expiry, and
 * colorings are PNG data URLs the child can download.
 */
export interface ScrapbookStory {
  kind: 'story';
  id: string;
  createdAt: string;
  title: string;
  panels: StoryPanel[];
}

export interface ScrapbookColoring {
  kind: 'coloring';
  id: string;
  createdAt: string;
  title: string;
  /** PNG data URL of outline plus paint composited on white. */
  pngDataUrl: string;
}

export interface ScrapbookExperiment {
  kind: 'experiment';
  id: string;
  createdAt: string;
  title: string;
  prediction: string;
  wasCorrect: boolean;
  explanation: string;
  observation?: string;
}

export type ScrapbookItem = ScrapbookStory | ScrapbookColoring | ScrapbookExperiment;

export type ScrapbookDraft =
  | Omit<ScrapbookStory, 'id' | 'createdAt'>
  | Omit<ScrapbookColoring, 'id' | 'createdAt'>
  | Omit<ScrapbookExperiment, 'id' | 'createdAt'>;

export const SCRAPBOOK_LIMIT = 24;

export const createScrapbookId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && 'randomUUID' in cryptoApi) {
    return `kb_item_${cryptoApi.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `kb_item_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
};

/** Newest first, capped so a long session cannot grow without bound. */
export const addScrapbookItem = (
  items: readonly ScrapbookItem[],
  draft: ScrapbookDraft,
  now: () => string = () => new Date().toISOString(),
): ScrapbookItem[] => {
  const item = { ...draft, id: createScrapbookId(), createdAt: now() } as ScrapbookItem;
  return [item, ...items].slice(0, SCRAPBOOK_LIMIT);
};

export const removeScrapbookItem = (
  items: readonly ScrapbookItem[],
  id: string,
): ScrapbookItem[] => items.filter((item) => item.id !== id);

export const scrapbookKindLabel: Record<ScrapbookItem['kind'], string> = {
  coloring: 'Coloring page',
  experiment: 'Experiment',
  story: 'Story',
};
