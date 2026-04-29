import { moderate, moderateAsync, safeSystemPrompt } from '../guardrails.js';
import { MalformedOutputError, UnsafeOutputError, type ModelProvider } from '../provider.js';
import { safeFallbackSvg, validateColoringSvg } from '../svgSafety.js';
import type { ColoringRequest, ColoringResponse } from '../types.js';

const svgTemplate = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <g fill="none" stroke="#000" stroke-width="14" stroke-linecap="round" stroke-linejoin="round">
    <rect x="96" y="96" width="832" height="832" rx="72" ry="72" />
    <path d="M192 720 C280 560, 400 400, 512 400 C624 400, 744 560, 832 720" />
    <circle cx="392" cy="440" r="56" />
    <circle cx="632" cy="440" r="56" />
    <path d="M352 600 Q512 720 672 600" />
    <path d="M260 318 Q340 190 424 318" />
    <path d="M600 318 Q684 190 764 318" />
    <path d="M220 810 Q512 940 804 810" />
  </g>
</svg>`;

const extractSvg = (text: string): string => {
  const match = text.match(/<svg[\s\S]*<\/svg>/i);
  return match?.[0] ?? text;
};

const generateColoringOutlineWithProvider = async (
  request: ColoringRequest,
  provider: ModelProvider,
): Promise<ColoringResponse> => {
  const sceneModeration = await moderateAsync(request.scene, provider);
  if (sceneModeration.blocked) {
    return { blocked: true, message: sceneModeration.message };
  }

  const raw = await provider.generateText({
    task: 'coloring',
    system: safeSystemPrompt,
    user: [
      'Return only one inline SVG coloring page.',
      'Required: <svg viewBox="0 0 1024 1024">, black strokes, fill="none", simple large regions.',
      'No text, styles, scripts, foreignObject, images, links, event handlers, gradients, colors, or filled shapes.',
      `Scene: ${request.scene}`,
      request.style ? `Style: ${request.style}` : '',
    ].join('\n'),
    maxTokens: 900,
    temperature: 0.35,
  });
  const validated = validateColoringSvg(extractSvg(raw));
  if (!validated.ok || !validated.svg) {
    throw new MalformedOutputError('Provider coloring output did not contain a safe SVG');
  }

  const outputModeration = await moderateAsync(validated.svg, provider);
  if (outputModeration.blocked) {
    throw new UnsafeOutputError(outputModeration.message);
  }

  return {
    blocked: false,
    svg: validated.svg,
  };
};

export function generateColoringOutline(request: ColoringRequest): ColoringResponse;
export function generateColoringOutline(
  request: ColoringRequest,
  provider: ModelProvider,
): Promise<ColoringResponse>;
export function generateColoringOutline(
  request: ColoringRequest,
  provider?: ModelProvider,
): ColoringResponse | Promise<ColoringResponse> {
  if (provider) {
    return generateColoringOutlineWithProvider(request, provider);
  }

  const sceneModeration = moderate(request.scene);
  if (sceneModeration.blocked) {
    return { blocked: true, message: sceneModeration.message };
  }

  const svg = svgTemplate();
  const validated = validateColoringSvg(svg);
  const safeSvg = validated.svg ?? safeFallbackSvg();
  const svgModeration = moderate(safeSvg);
  if (svgModeration.blocked) {
    return { blocked: true, message: svgModeration.message };
  }

  return {
    blocked: false,
    svg: safeSvg,
  };
}
