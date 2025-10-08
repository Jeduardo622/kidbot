import { z } from 'zod';

export const ageBandValues = ['4-6', '7-9', '10-12'] as const;
export type AgeBand = (typeof ageBandValues)[number];

export const personaValues = ['robot', 'fairy', 'explorer'] as const;
export type Persona = (typeof personaValues)[number];

export const voiceRequestSchema = z.object({
  text: z.string().min(1).max(280),
  persona: z.enum(personaValues),
  ageBand: z.enum(ageBandValues).optional()
});

export type VoiceRequest = z.infer<typeof voiceRequestSchema>;

export const storyRequestSchema = z.object({
  theme: z.string().min(3).max(120),
  panels: z.number().int().min(2).max(8),
  ageBand: z.enum(ageBandValues).optional()
});

export type StoryRequest = z.infer<typeof storyRequestSchema>;

export const coloringRequestSchema = z.object({
  scene: z.string().min(3).max(120),
  style: z.enum(['animals', 'space', 'underwater']).optional()
});

export type ColoringRequest = z.infer<typeof coloringRequestSchema>;

export const scienceRequestSchema = z.object({
  topic: z.string().min(3).max(120),
  ageBand: z.enum(ageBandValues).optional()
});

export type ScienceRequest = z.infer<typeof scienceRequestSchema>;

export type ResponseSource = 'stub' | 'local' | 'agent';

export interface VoiceResponse {
  blocked: boolean;
  persona?: Persona;
  text?: string;
  ssml?: string;
  message?: string;
  source?: ResponseSource;
}

export interface StoryPanel {
  title: string;
  caption: string;
  imagePrompt: string;
  imageUrl: string | null;
}

export interface StoryResponse {
  blocked: boolean;
  theme?: string;
  panels?: StoryPanel[];
  message?: string;
  source?: ResponseSource;
}

export interface ColoringResponse {
  blocked: boolean;
  svg?: string;
  message?: string;
  source?: ResponseSource;
}

export interface SciencePrediction {
  question: string;
  choices: string[];
  answerIndex: number;
}

export interface ScienceResponse {
  blocked: boolean;
  title?: string;
  objective?: string;
  materials?: string[];
  steps?: string[];
  prediction?: SciencePrediction;
  explanation?: string;
  supervision?: string;
  message?: string;
  topic?: string;
  source?: ResponseSource;
}
