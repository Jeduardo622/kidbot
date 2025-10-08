import { z } from 'zod';

export const ageBandSchema = z.enum(['4-6', '7-9', '10-12']);
export const personaSchema = z.enum(['robot', 'fairy', 'explorer']);

export const voiceInputSchema = z.object({
  text: z.string().min(1).max(280),
  persona: personaSchema,
  ageBand: ageBandSchema.optional()
});

export const storyPanelsSchema = z.object({
  theme: z.string().min(3).max(120),
  panels: z.number().int().min(2).max(8),
  ageBand: ageBandSchema.optional()
});

export const coloringOutlineSchema = z.object({
  scene: z.string().min(3).max(120),
  style: z.enum(['animals', 'space', 'underwater']).optional()
});

export const scienceSimSchema = z.object({
  topic: z.string().min(3).max(120),
  ageBand: ageBandSchema.optional()
});
