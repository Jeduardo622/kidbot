import type { AgeBand } from './sessionContext.js';

/**
 * How the widget adapts to the locked age band. The server already uses the
 * band for moderation thresholds and vocabulary; this is the client side of
 * the same model: bigger type and targets for early learners, fewer knobs,
 * and topic suggestions pitched at the band.
 */
export interface AgeBandPresentation {
  /** Attribute value applied to the widget root for CSS scaling. */
  scale: 'large' | 'medium' | 'default';
  /** Hide fine-grained controls (panel counts, brush sliders, free-text topics). */
  simplified: boolean;
  /** Default number of comic panels. */
  defaultPanels: number;
  /** Default brush size in canvas pixels. */
  brushSize: number;
  /** Science topic suggestions for the band. */
  scienceTopics: readonly string[];
  /** Short child-facing description of the band, for the empty states. */
  greeting: string;
}

const presentations: Record<AgeBand, AgeBandPresentation> = {
  '4-6': {
    scale: 'large',
    simplified: true,
    defaultPanels: 3,
    brushSize: 14,
    scienceTopics: ['Float or sink', 'Magnets', 'Shadows', 'Mixing colors'],
    greeting: 'Tap a big button to start!',
  },
  '7-9': {
    scale: 'medium',
    simplified: false,
    defaultPanels: 4,
    brushSize: 8,
    scienceTopics: ['Buoyancy', 'Magnetism', 'Rainbows', 'Plant Growth', 'Static electricity', 'Baking soda volcano'],
    greeting: 'Pick an idea or type your own.',
  },
  '10-12': {
    scale: 'default',
    simplified: false,
    defaultPanels: 4,
    brushSize: 6,
    scienceTopics: ['Density and buoyancy', 'Electromagnets', 'Light refraction', 'Photosynthesis', 'Chemical reactions', 'Air pressure'],
    greeting: 'Try a question of your own.',
  },
};

export const ageBandPresentation = (ageBand: AgeBand): AgeBandPresentation =>
  presentations[ageBand] ?? presentations['7-9'];
