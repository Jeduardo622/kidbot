export type ToolResultRecord = Record<string, unknown>;

const readRecord = (value: unknown): ToolResultRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as ToolResultRecord)
    : undefined;

export const readToolEnvelope = (value: unknown) => {
  const envelope = readRecord(value);
  const structuredContent = readRecord(envelope?.structuredContent);
  if (!structuredContent) {
    throw new Error('Widget bridge returned an invalid result.');
  }
  return { meta: readRecord(envelope?._meta), structuredContent };
};

export const readStructuredContent = <T extends ToolResultRecord>(value: unknown): T =>
  readToolEnvelope(value).structuredContent as T;
