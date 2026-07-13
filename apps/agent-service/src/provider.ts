import OpenAI from 'openai';

export interface TextGenerationRequest {
  task: 'voice' | 'story' | 'coloring' | 'science';
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ImageGenerationRequest {
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536';
}

export interface ProviderModerationResult {
  blocked: boolean;
  reason?: string;
}

export interface ModelProvider {
  generateText(request: TextGenerationRequest, signal?: AbortSignal): Promise<string>;
  generateImage?(request: ImageGenerationRequest, signal?: AbortSignal): Promise<string>;
  moderateText(text: string, signal?: AbortSignal): Promise<ProviderModerationResult>;
}

export const bindProviderSignal = (
  provider: ModelProvider,
  signal: AbortSignal,
): ModelProvider => ({
  generateText: (request) => provider.generateText(request, signal),
  ...(provider.generateImage
    ? { generateImage: (request: ImageGenerationRequest) => provider.generateImage!(request, signal) }
    : {}),
  moderateText: (text) => provider.moderateText(text, signal),
});

export type ProviderFallbackReason =
  | 'moderation_failure'
  | 'generation_timeout'
  | 'malformed_output'
  | 'unsafe_output'
  | 'provider_unavailable';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly reason: ProviderFallbackReason,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ModerationFailureError extends ProviderError {
  constructor(message = 'Provider moderation failed') {
    super(message, 'moderation_failure');
  }
}

export class GenerationTimeoutError extends ProviderError {
  constructor(message = 'Provider generation timed out') {
    super(message, 'generation_timeout');
  }
}

export class MalformedOutputError extends ProviderError {
  constructor(message = 'Provider returned malformed output') {
    super(message, 'malformed_output');
  }
}

export class UnsafeOutputError extends ProviderError {
  constructor(message = 'Provider returned unsafe output') {
    super(message, 'unsafe_output');
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(message = 'Provider unavailable') {
    super(message, 'provider_unavailable');
  }
}

export interface ProviderFailurePolicy {
  allowFallback: boolean;
}

type ProviderFailurePolicyEnv = Partial<
  Record<'NODE_ENV' | 'KIDBOT_LOCAL_DEV' | 'PROVIDER_FAILURE_POLICY', string>
>;

export const parseProviderFailurePolicy = (
  env: ProviderFailurePolicyEnv,
): ProviderFailurePolicy => {
  const explicit = env.PROVIDER_FAILURE_POLICY?.trim().toLowerCase();
  if (explicit && explicit !== 'fallback' && explicit !== '503') {
    throw new Error('PROVIDER_FAILURE_POLICY must be fallback or 503.');
  }

  if (explicit === 'fallback') {
    return { allowFallback: true };
  }
  if (explicit === '503') {
    return { allowFallback: false };
  }

  return { allowFallback: env.NODE_ENV !== 'production' || env.KIDBOT_LOCAL_DEV === '1' };
};

export const classifyProviderError = (error: unknown): ProviderFallbackReason => {
  if (error instanceof ProviderError) {
    return error.reason;
  }
  return 'provider_unavailable';
};

export interface ProviderRetryOptions {
  timeoutMs: number;
  retries: number;
}

export const withProviderRetry = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  { timeoutMs, retries }: ProviderRetryOptions,
  outerSignal?: AbortSignal,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (outerSignal?.aborted) {
      throw new ProviderUnavailableError('Provider request cancelled');
    }
    const timeoutController = new AbortController();
    const timer = setTimeout(
      () => timeoutController.abort(new GenerationTimeoutError()),
      timeoutMs,
    );
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, timeoutController.signal])
      : timeoutController.signal;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return await Promise.race([operation(signal), aborted]);
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new GenerationTimeoutError();
      }
      if (outerSignal?.aborted) {
        throw new ProviderUnavailableError('Provider request cancelled');
      }
      if (error instanceof ProviderError) {
        throw error;
      }
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ProviderUnavailableError(summarizeProviderError(lastError));
};

const summarizeProviderError = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 160);
  }
  return 'Unknown provider error';
};

export const safeProviderErrorSummary = summarizeProviderError;

export const createOpenAIProvider = (apiKey: string | undefined): ModelProvider | undefined => {
  if (!apiKey?.trim()) {
    return undefined;
  }

  const client = new OpenAI({ apiKey });
  const generationModel = process.env.KIDBOT_OPENAI_MODEL ?? 'gpt-4o-mini';
  const imageModel = process.env.KIDBOT_OPENAI_IMAGE_MODEL ?? 'gpt-image-2';
  const moderationModel = process.env.KIDBOT_OPENAI_MODERATION_MODEL ?? 'omni-moderation-latest';
  const timeoutMs = Number(process.env.PROVIDER_TIMEOUT_MS ?? 15_000);
  const retries = Number(process.env.PROVIDER_RETRIES ?? 1);

  return {
    async generateText(request, outerSignal) {
      const response = await withProviderRetry(
        (signal) =>
          client.chat.completions.create({
            model: generationModel,
            temperature: request.temperature ?? 0.4,
            max_tokens: request.maxTokens ?? 700,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
          }, { signal }),
        { timeoutMs, retries },
        outerSignal,
      );

      return response.choices[0]?.message?.content?.trim() ?? '';
    },
    async generateImage(request, outerSignal) {
      const response = await withProviderRetry(
        (signal) =>
          client.images.generate({
            model: imageModel,
            prompt: request.prompt,
            n: 1,
            size: request.size ?? '1024x1024',
            quality: 'low',
            output_format: 'png',
          }, { signal }),
        { timeoutMs, retries },
        outerSignal,
      );

      const base64 = response.data?.[0]?.b64_json?.trim();
      if (!base64) {
        throw new MalformedOutputError('Provider image output did not include base64 data');
      }

      return base64;
    },
    async moderateText(text, outerSignal) {
      if (!text.trim()) {
        return { blocked: false };
      }

      let response;
      try {
        response = await withProviderRetry(
          (signal) => client.moderations.create(
            { model: moderationModel, input: text },
            { signal },
          ),
          {
            timeoutMs,
            retries,
          },
          outerSignal,
        );
      } catch (error) {
        throw error instanceof ProviderError
          ? new ModerationFailureError(error.message)
          : new ModerationFailureError();
      }

      const result = response.results[0];
      return {
        blocked: Boolean(result?.flagged),
        reason: result?.flagged ? 'Provider moderation flagged the content.' : undefined,
      };
    },
  };
};
