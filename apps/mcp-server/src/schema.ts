import { z } from 'zod';

export const ageBandSchema = z.enum(['4-6', '7-9', '10-12']);
export const personaSchema = z.enum(['robot', 'fairy', 'explorer']);
export const responseSourceSchema = z.enum(['fixture', 'stub', 'local', 'agent']);

export const generationResultMetadataShape = {
  source: responseSourceSchema.optional(),
  providerFallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  correlationId: z.string().optional(),
};

export const parentHistoryEventSchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  tool: z.string(),
  sessionId: z.string(),
  profileId: z.string(),
  ageBand: ageBandSchema,
  status: z.enum(['ok', 'blocked', 'degraded', 'error']),
  blocked: z.boolean().optional(),
  degraded: z.boolean().optional(),
  providerFallback: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  correlationId: z.string().optional(),
  inputLength: z.number().int().nonnegative(),
  outputLength: z.number().int().nonnegative(),
}).strict();

const sessionMetadataSchema = z.object({
  sessionId: z.string().regex(/^kb_session_[A-Za-z0-9_-]{8,80}$/).optional(),
  profileId: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/).optional(),
  ageBand: ageBandSchema.optional(),
  parentAccessToken: z.string().max(256).optional()
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

export const parentProfileCreateSchema = z.object({
  sessionId: z.string().regex(/^kb_session_[A-Za-z0-9_-]{8,80}$/),
  ageBand: ageBandSchema,
  historyEnabled: z.literal(true)
}).strict();

export const parentProfileUpdateSchema = z.object({
  profileId: z.string().regex(/^kb_profile_[A-Za-z0-9_-]{8,80}$/),
  parentAccessToken: z.string().min(24).max(256),
  ageBand: ageBandSchema.optional(),
  historyEnabled: z.boolean().optional()
});

export const parentProfileDeleteSchema = z.object({
  profileId: z.string().regex(/^kb_profile_[A-Za-z0-9_-]{8,80}$/),
  parentAccessToken: z.string().min(24).max(256)
}).strict();

export const parentHistoryListSchema = z.object({
  profileId: z.string().regex(/^kb_profile_[A-Za-z0-9_-]{8,80}$/),
  parentAccessToken: z.string().min(24).max(256),
  sessionId: z.string().regex(/^kb_session_[A-Za-z0-9_-]{8,80}$/).optional(),
  limit: z.number().int().min(1).max(100).optional()
});
