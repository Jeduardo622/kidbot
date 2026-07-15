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

const isCommonResult = (value: ToolResultRecord): value is CommonToolResult =>
  typeof value.blocked === 'boolean' &&
  (value.degraded === undefined || value.degraded === true) &&
  isOptionalString(value.message);

const isFailureResult = (value: ToolResultRecord): boolean =>
  (value.blocked === true && typeof value.message === 'string') ||
  (value.blocked === false && value.degraded === true && typeof value.message === 'string');

export const isVoiceResult: ResultValidator<VoiceResult> = (value): value is VoiceResult => {
  if (!isCommonResult(value)) return false;
  if (isFailureResult(value)) return true;
  return (
    value.blocked === false &&
    (value.persona === 'robot' || value.persona === 'fairy' || value.persona === 'explorer') &&
    typeof value.text === 'string' &&
    isOptionalString(value.ssml)
  );
};

const isStoryPanel = (value: unknown): value is StoryPanel => {
  const panel = readRecord(value);
  return Boolean(
    panel &&
      typeof panel.title === 'string' &&
      typeof panel.caption === 'string' &&
      typeof panel.imagePrompt === 'string' &&
      (panel.imageUrl === null || typeof panel.imageUrl === 'string'),
  );
};

export const isStoryResult: ResultValidator<StoryResult> = (value): value is StoryResult => {
  if (!isCommonResult(value)) return false;
  if (isFailureResult(value)) return true;
  return (
    value.blocked === false &&
    Array.isArray(value.panels) &&
    value.panels.every(isStoryPanel) &&
    isOptionalString(value.theme)
  );
};

export const isColoringResult: ResultValidator<ColoringResult> = (value): value is ColoringResult => {
  if (!isCommonResult(value)) return false;
  if (isFailureResult(value)) return true;
  return value.blocked === false && typeof value.svg === 'string';
};

const isPrediction = (value: unknown): boolean => {
  const prediction = readRecord(value);
  return Boolean(
    prediction &&
      typeof prediction.question === 'string' &&
      isStringArray(prediction.choices) &&
      Number.isInteger(prediction.answerIndex) &&
      (prediction.answerIndex as number) >= 0,
  );
};

export const isScienceResult: ResultValidator<ScienceResult> = (value): value is ScienceResult => {
  if (!isCommonResult(value)) return false;
  if (isFailureResult(value)) return true;
  return (
    value.blocked === false &&
    typeof value.title === 'string' &&
    typeof value.objective === 'string' &&
    isStringArray(value.materials) &&
    isStringArray(value.steps) &&
    (value.prediction === undefined || isPrediction(value.prediction)) &&
    isOptionalString(value.explanation) &&
    isOptionalString(value.supervision)
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
  const message = envelope.structuredContent.message;
  return typeof message === 'string' && /expired|not found|unauthori[sz]ed|invalid (?:access )?token|access denied/i.test(message);
};
