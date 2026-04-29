const FALLBACK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g stroke="#000" fill="none" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"><circle cx="512" cy="512" r="360"/><circle cx="410" cy="460" r="42"/><circle cx="614" cy="460" r="42"/><path d="M380 620 Q512 720 644 620"/><path d="M290 345 Q360 210 430 345"/><path d="M594 345 Q664 210 734 345"/><path d="M220 760 Q512 900 804 760"/></g></svg>';

const FORBIDDEN_PATTERNS = [
  /<\s*script\b/i,
  /<\s*foreignObject\b/i,
  /<\s*image\b/i,
  /<\s*style\b/i,
  /\son[a-z]+\s*=/i,
  /\b(?:href|xlink:href)\s*=/i,
  /url\s*\(/i,
  /<\s*(?:iframe|object|embed|audio|video|canvas|animate|set)\b/i,
];

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
]);

const tagNamePattern = /<\/?\s*([a-zA-Z][\w:-]*)\b/g;

export interface SvgValidationResult {
  ok: boolean;
  svg?: string;
  reason?: string;
}

const hasForbiddenFill = (svg: string): boolean => {
  const fillMatches = svg.match(/\sfill\s*=\s*(['"])(.*?)\1/gi) ?? [];
  return fillMatches.some((match) => !/\sfill\s*=\s*(['"])none\1/i.test(match));
};

const hasUnknownElement = (svg: string): boolean => {
  let match: RegExpExecArray | null;
  while ((match = tagNamePattern.exec(svg)) !== null) {
    const tagName = match[1];
    if (!tagName || !ALLOWED_ELEMENTS.has(tagName.toLowerCase())) {
      return true;
    }
  }
  return false;
};

const normalizeOutlineSvg = (svg: string): string => {
  let output = svg
    .trim()
    .replace(/<\?xml[\s\S]*?\?>/i, '')
    .trim();
  output = output.replace(/\sviewBox\s*=\s*(['"])[^'"]*\1/i, ' viewBox="0 0 1024 1024"');
  output = output.replace(/<svg\b(?![^>]*\sviewBox=)/i, '<svg viewBox="0 0 1024 1024"');
  output = output.replace(/\sstroke\s*=\s*(['"])[^'"]*\1/gi, ' stroke="#000"');
  output = output.replace(/\sfill\s*=\s*(['"])[^'"]*\1/gi, ' fill="none"');
  output = output.replace(/<svg\b(?![^>]*\sxmlns=)/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  output = output.replace(
    /<([a-zA-Z][\w:-]*)(?=[\s/>])(?![^>]*\sstroke=)(?!svg\b)/g,
    '<$1 stroke="#000"',
  );
  output = output.replace(
    /<([a-zA-Z][\w:-]*)(?=[\s/>])(?![^>]*\sfill=)(?!svg\b)/g,
    '<$1 fill="none"',
  );
  return output;
};

export const validateColoringSvg = (svg: string): SvgValidationResult => {
  const trimmed = svg.trim();
  if (!trimmed || !/^<svg[\s>]/i.test(trimmed.replace(/<\?xml[\s\S]*?\?>/i, '').trim())) {
    return { ok: false, reason: 'SVG root is missing.' };
  }

  if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { ok: false, reason: 'SVG includes unsafe elements or attributes.' };
  }

  if (hasUnknownElement(trimmed)) {
    return { ok: false, reason: 'SVG includes unsupported elements.' };
  }

  const normalized = normalizeOutlineSvg(trimmed);
  if (!/\sviewBox\s*=\s*"0 0 1024 1024"/i.test(normalized)) {
    return { ok: false, reason: 'SVG viewBox could not be normalized.' };
  }

  if (hasForbiddenFill(normalized)) {
    return { ok: false, reason: 'SVG includes non-outline fills.' };
  }

  return { ok: true, svg: normalized };
};

export const safeFallbackSvg = (): string => FALLBACK_SVG;
