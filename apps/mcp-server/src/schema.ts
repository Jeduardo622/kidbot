import { z } from 'zod';

export const ageBandSchema = z.enum(['4-6', '7-9', '10-12']);
export const personaSchema = z.enum(['robot', 'fairy', 'explorer']);

const sessionMetadataSchema = z.object({
  sessionId: z.string().regex(/^kb_session_[A-Za-z0-9_-]{8,80}$/).optional(),
  profileId: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/).optional(),
  ageBand: ageBandSchema.optional()
});

export const voiceInputSchema = z.object({
  text: z.string().min(1).max(280),
  persona: personaSchema,
}).merge(sessionMetadataSchema);

export const storyPanelsSchema = z.object({
  theme: z.string().min(3).max(120),
  panels: z.number().int().min(2).max(8),
}).merge(sessionMetadataSchema);

export const coloringOutlineSchema = z.object({
  scene: z.string().min(3).max(120),
  style: z.enum(['animals', 'space', 'underwater']).optional()
}).merge(sessionMetadataSchema);

export const scienceSimSchema = z.object({
  topic: z.string().min(3).max(120),
}).merge(sessionMetadataSchema);
