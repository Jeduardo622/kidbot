import { GenerationTimeoutError, ProviderUnavailableError } from './provider.js';

export const runBoundedRequest = async <T>(
  operation: (signal: AbortSignal) => Promise<T> | T,
  outerSignal: AbortSignal,
  timeoutMs: number,
): Promise<T> => {
  if (outerSignal.aborted) throw new ProviderUnavailableError('Request cancelled');
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, outerSignal]);
  const timer = setTimeout(() => controller.abort(new GenerationTimeoutError()), timeoutMs);
  timer.unref();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason instanceof GenerationTimeoutError
      ? signal.reason : new ProviderUnavailableError('Request cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(signal)), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    // Also abort on failure: parallel image workers must not keep storing output.
    controller.abort();
  }
};
