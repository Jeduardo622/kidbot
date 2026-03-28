const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'clipPath',
  'mask',
  'title',
  'desc'
]);

const ALLOWED_ATTRS = new Set([
  'xmlns',
  'viewbox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'opacity',
  'transform',
  'preserveaspectratio',
  'id',
  'class',
  'role',
  'aria-hidden',
  'clip-path',
  'mask'
]);

const DISALLOWED_PATTERN =
  /<\s*(script|foreignObject|iframe|object|embed|link|style|img|image|video|audio|a)\b|on[a-z]+\s*=|javascript:|data:text\/html|xlink:href|href\s*=/i;

const stripXmlPrefix = (value: string): string => value.replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '');

export const sanitizeSvgOutline = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = stripXmlPrefix(value.trim());
  if (!trimmed || trimmed.length > 100_000) {
    return undefined;
  }

  if (DISALLOWED_PATTERN.test(trimmed)) {
    return undefined;
  }

  if (!/^<svg\b[\s\S]*<\/svg>\s*$/i.test(trimmed)) {
    return undefined;
  }

  const tagRegex = /<\s*(\/?)\s*([a-zA-Z][\w:-]*)\b([^>]*)>/g;
  let match: RegExpExecArray | null = tagRegex.exec(trimmed);
  while (match) {
    const isClosing = match[1] === '/';
    const tagName = match[2].toLowerCase();
    const attrs = match[3] ?? '';

    if (!ALLOWED_TAGS.has(tagName)) {
      return undefined;
    }

    if (!isClosing && attrs) {
      const attrRegex = /([a-zA-Z_:][\w:.-]*)\s*=\s*(".*?"|'.*?'|[^\s"'>]+)/g;
      let attrMatch: RegExpExecArray | null = attrRegex.exec(attrs);
      while (attrMatch) {
        const attrName = attrMatch[1].toLowerCase();
        const attrValueRaw = attrMatch[2] ?? '';
        const attrValue = attrValueRaw.replace(/^['"]|['"]$/g, '').trim();

        if (!ALLOWED_ATTRS.has(attrName)) {
          return undefined;
        }

        if (/^on/i.test(attrName) || /javascript:|data:text\/html/i.test(attrValue)) {
          return undefined;
        }

        attrMatch = attrRegex.exec(attrs);
      }
    }

    match = tagRegex.exec(trimmed);
  }

  return trimmed;
};
