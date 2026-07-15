export type ToolResultRecord = Record<string, unknown>;

export type Persona = 'robot' | 'fairy' | 'explorer';

export interface CommonToolResult extends ToolResultRecord {
  blocked: boolean;
  degraded?: boolean;
  message?: string;
}

export interface VoiceResult extends CommonToolResult {
  persona?: Persona;
  text?: string;
  ssml?: string;
}

export interface StoryPanel {
  title: string;
  caption: string;
  imagePrompt: string;
  imageUrl: string | null;
}

export interface StoryResult extends CommonToolResult {
  panels?: StoryPanel[];
  theme?: string;
}

export interface ColoringResult extends CommonToolResult {
  svg?: string;
}

export interface ScienceResult extends CommonToolResult {
  title?: string;
  objective?: string;
  materials?: string[];
  steps?: string[];
  prediction?: { question: string; choices: string[]; answerIndex: number };
  explanation?: string;
  supervision?: string;
}

type ResultValidator<T extends ToolResultRecord> = (value: ToolResultRecord) => value is T;

const INVALID_RESULT_MESSAGE = 'Kidbot returned an invalid result. Please try again.';
const TOOL_ERROR_MESSAGE = 'Kidbot could not complete this request. Please try again.';
const requestControlCodes = new Set([
  'rate_limited',
  'concurrency_limited',
  'request_timeout',
]);

const readRecord = (value: unknown): ToolResultRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ToolResultRecord)
    : undefined;

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const hasExactKeys = (value: ToolResultRecord, allowed: readonly string[]): boolean => {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
};

const generationMetadataKeys = [
  'source',
  'providerFallback',
  'fallbackReason',
  'correlationId',
  'message',
] as const;

const hasValidGenerationMetadata = (value: ToolResultRecord): boolean =>
  (value.source === undefined ||
    value.source === 'fixture' ||
    value.source === 'stub' ||
    value.source === 'local' ||
    value.source === 'agent') &&
  (value.providerFallback === undefined || typeof value.providerFallback === 'boolean') &&
  isOptionalString(value.fallbackReason) &&
  isOptionalString(value.correlationId) &&
  isOptionalString(value.message);

const isBlockedFailure = (value: ToolResultRecord): boolean =>
  hasExactKeys(value, ['blocked', 'message']) &&
  value.blocked === true &&
  typeof value.message === 'string';

const isDegradedFailure = (value: ToolResultRecord): boolean =>
  hasExactKeys(value, ['blocked', 'degraded', 'message', 'fallbackReason', 'correlationId']) &&
  value.blocked === false &&
  value.degraded === true &&
  typeof value.message === 'string' &&
  isOptionalString(value.fallbackReason) &&
  isOptionalString(value.correlationId);

const isRequestControlFailure = (value: ToolResultRecord): boolean =>
  hasExactKeys(value, ['error', 'code', 'retryAfter']) &&
  value.error === true &&
  typeof value.code === 'string' &&
  requestControlCodes.has(value.code) &&
  (value.retryAfter === undefined ||
    (typeof value.retryAfter === 'number' &&
      Number.isInteger(value.retryAfter) &&
      value.retryAfter > 0));

const isGenerationFailure = (value: ToolResultRecord): boolean =>
  isBlockedFailure(value) || isDegradedFailure(value) || isRequestControlFailure(value);

export const isVoiceResult: ResultValidator<VoiceResult> = (value): value is VoiceResult => {
  if (isGenerationFailure(value)) return true;
  return (
    hasExactKeys(value, ['blocked', 'persona', 'text', 'ssml', ...generationMetadataKeys]) &&
    value.blocked === false &&
    (value.persona === 'robot' || value.persona === 'fairy' || value.persona === 'explorer') &&
    typeof value.text === 'string' &&
    isOptionalString(value.ssml) &&
    hasValidGenerationMetadata(value)
  );
};

const isStoryPanel = (value: unknown): value is StoryPanel => {
  const panel = readRecord(value);
  return Boolean(
    panel &&
      hasExactKeys(panel, ['title', 'caption', 'imagePrompt', 'imageUrl']) &&
      typeof panel.title === 'string' &&
      typeof panel.caption === 'string' &&
      typeof panel.imagePrompt === 'string' &&
      (panel.imageUrl === null || typeof panel.imageUrl === 'string'),
  );
};

export const isStoryResult: ResultValidator<StoryResult> = (value): value is StoryResult => {
  if (isGenerationFailure(value)) return true;
  return (
    hasExactKeys(value, ['blocked', 'theme', 'panels', ...generationMetadataKeys]) &&
    value.blocked === false &&
    Array.isArray(value.panels) &&
    value.panels.every(isStoryPanel) &&
    typeof value.theme === 'string' &&
    hasValidGenerationMetadata(value)
  );
};

export const isColoringResult: ResultValidator<ColoringResult> = (value): value is ColoringResult => {
  if (isGenerationFailure(value)) return true;
  return (
    hasExactKeys(value, ['blocked', 'svg', ...generationMetadataKeys]) &&
    value.blocked === false &&
    typeof value.svg === 'string' &&
    hasValidGenerationMetadata(value)
  );
};

const isPrediction = (value: unknown): boolean => {
  const prediction = readRecord(value);
  return Boolean(
    prediction &&
      hasExactKeys(prediction, ['question', 'choices', 'answerIndex']) &&
      typeof prediction.question === 'string' &&
      isStringArray(prediction.choices) &&
      Number.isInteger(prediction.answerIndex) &&
      (prediction.answerIndex as number) >= 0 &&
      (prediction.answerIndex as number) < (prediction.choices as unknown[]).length,
  );
};

export const isScienceResult: ResultValidator<ScienceResult> = (value): value is ScienceResult => {
  if (isGenerationFailure(value)) return true;
  return (
    hasExactKeys(value, [
      'blocked',
      'title',
      'objective',
      'materials',
      'steps',
      'prediction',
      'explanation',
      'supervision',
      'topic',
      ...generationMetadataKeys,
    ]) &&
    value.blocked === false &&
    typeof value.title === 'string' &&
    typeof value.objective === 'string' &&
    isStringArray(value.materials) &&
    isStringArray(value.steps) &&
    isPrediction(value.prediction) &&
    typeof value.explanation === 'string' &&
    typeof value.supervision === 'string' &&
    typeof value.topic === 'string' &&
    hasValidGenerationMetadata(value)
  );
};

const requestControlMessage = (value: ToolResultRecord): string | undefined => {
  if (
    value.error !== true ||
    typeof value.code !== 'string' ||
    !requestControlCodes.has(value.code)
  ) {
    return undefined;
  }
  if (value.code === 'request_timeout') {
    return 'This request timed out. Please try again.';
  }
  if (value.code === 'concurrency_limited') {
    return 'Kidbot is busy with another request. Please try again shortly.';
  }
  return typeof value.retryAfter === 'number' && Number.isInteger(value.retryAfter) && value.retryAfter > 0
    ? `Too many requests. Try again in ${value.retryAfter} seconds.`
    : 'Too many requests. Please try again shortly.';
};

export const readToolEnvelope = (value: unknown) => {
  const envelope = readRecord(value);
  const structuredContent = readRecord(envelope?.structuredContent);
  if (!structuredContent) {
    throw new Error('Widget bridge returned an invalid result.');
  }
  return {
    isError: envelope?.isError === true,
    meta: readRecord(envelope?._meta),
    structuredContent,
  };
};

export const readStructuredContent = <T extends ToolResultRecord>(
  value: unknown,
  validate: ResultValidator<T>,
): T => {
  const envelope = readToolEnvelope(value);
  const controlMessage = requestControlMessage(envelope.structuredContent);
  if (controlMessage) throw new Error(controlMessage);
  if (envelope.isError) throw new Error(TOOL_ERROR_MESSAGE);
  if (!validate(envelope.structuredContent)) throw new Error(INVALID_RESULT_MESSAGE);
  return envelope.structuredContent;
};

export const isStaleParentCredentialFailure = (value: unknown): boolean => {
  const envelope = readToolEnvelope(value);
  if (!envelope.isError) return false;
  return envelope.structuredContent.error === true &&
    envelope.structuredContent.code === 'invalid_parent_access';
};
