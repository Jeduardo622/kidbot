import { MalformedOutputError } from './provider.js';

export const extractJson = (text: string): unknown => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new MalformedOutputError('Empty model output');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        throw new MalformedOutputError('Model fenced JSON was malformed');
      }
    }

    const firstObject = trimmed.indexOf('{');
    const lastObject = trimmed.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(trimmed.slice(firstObject, lastObject + 1));
      } catch {
        throw new MalformedOutputError('Model JSON fragment was malformed');
      }
    }

    throw new MalformedOutputError('Model output did not contain JSON');
  }
};

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const cleanText = (value: unknown, fallback: string, maxLength = 220): string => {
  const text = typeof value === 'string' ? value.trim() : fallback;
  const normalized = text.replace(/\s+/g, ' ').slice(0, maxLength).trim();
  return normalized || fallback;
};

export const cleanTextArray = (
  value: unknown,
  fallback: string[],
  maxItems: number,
  maxLength = 120,
): string[] => {
  const source = Array.isArray(value) ? value : fallback;
  const cleaned = source
    .map((item, index) =>
      cleanText(item, fallback[index] ?? fallback[0] ?? 'Explore safely.', maxLength),
    )
    .filter(Boolean)
    .slice(0, maxItems);
  return cleaned.length > 0 ? cleaned : fallback.slice(0, maxItems);
};
