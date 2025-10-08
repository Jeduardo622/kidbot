import { moderate } from '../guardrails.js';
import type { ColoringRequest, ColoringResponse } from '../types.js';

const svgTemplate = (scene: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="16" y="16" width="480" height="480" rx="32" ry="32" fill="none" stroke="#111827" stroke-width="4" />
  <path d="M96 360 C140 280, 200 200, 256 200 C312 200, 372 280, 416 360" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="196" cy="220" r="28" fill="none" stroke="#111827" stroke-width="4" />
  <circle cx="316" cy="220" r="28" fill="none" stroke="#111827" stroke-width="4" />
  <path d="M176 300 Q256 360 336 300" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" />
  <text x="50%" y="470" text-anchor="middle" font-family="'Comic Sans MS', 'Comic Neue', sans-serif" font-size="20" fill="#111827">${scene}</text>
</svg>`;

export const generateColoringOutline = (request: ColoringRequest): ColoringResponse => {
  const sceneModeration = moderate(request.scene);
  if (sceneModeration.blocked) {
    return { blocked: true, message: sceneModeration.message };
  }

  const svg = svgTemplate(request.scene.toUpperCase());
  const svgModeration = moderate(svg);
  if (svgModeration.blocked) {
    return { blocked: true, message: svgModeration.message };
  }

  return {
    blocked: false,
    svg
  };
};
