import { useCallback, useEffect, useRef, useState } from 'react';
import { degradedMessage, errorMessage, unavailableMessageFromError } from './degradation.js';
import { readStructuredContent, type CommonToolResult, type ToolResultRecord } from './toolResult.js';

type ResultValidator<T extends ToolResultRecord> = (value: ToolResultRecord) => value is T;

export interface ToolCallState {
  /** A request is in flight. */
  loading: boolean;
  /** Child-safe error copy, or undefined. */
  error: string | undefined;
  /** Provider-unavailable copy (degraded service), or undefined. */
  unavailable: string | undefined;
}

export type ToolCallOutcome<T> =
  | { kind: 'ok'; result: T }
  | { kind: 'blocked'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'stale' };

export interface UseToolCall<T extends CommonToolResult> extends ToolCallState {
  /**
   * Call the tool. Resolves with the outcome; never throws. A result that
   * arrives after a newer call started, or after unmount, resolves `stale`
   * and leaves state untouched.
   */
  run: (input: Record<string, unknown>) => Promise<ToolCallOutcome<T>>;
  /** Clear error and unavailable copy. */
  reset: () => void;
  /** Invalidate any in-flight request so its result is ignored. */
  cancel: () => void;
}

/**
 * Shared orchestration for every child-facing tool call: loading flag,
 * degraded-vs-blocked-vs-error classification, child-safe error copy, and
 * stale-result protection. Components keep their own result state and decide
 * what a blocked outcome looks like for their activity.
 */
export const useToolCall = <T extends CommonToolResult>(
  toolName: string,
  validate: ResultValidator<T>,
  options: { blockedFallback?: string } = {},
): UseToolCall<T> => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [unavailable, setUnavailable] = useState<string | undefined>();
  const versionRef = useRef(0);
  const mountedRef = useRef(true);
  const blockedFallback = options.blockedFallback ?? 'Kidbot paused this request.';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      versionRef.current += 1;
    };
  }, []);

  const cancel = useCallback(() => {
    versionRef.current += 1;
    setLoading(false);
  }, []);

  const reset = useCallback(() => {
    setError(undefined);
    setUnavailable(undefined);
  }, []);

  const run = useCallback(
    async (input: Record<string, unknown>): Promise<ToolCallOutcome<T>> => {
      const version = ++versionRef.current;
      setLoading(true);
      setError(undefined);
      setUnavailable(undefined);
      const isCurrent = () => mountedRef.current && version === versionRef.current;
      try {
        const result = readStructuredContent(
          await window.openai?.callTool?.(toolName, input),
          validate,
        );
        if (!isCurrent()) return { kind: 'stale' };
        const unavailableMessage = degradedMessage(result);
        if (unavailableMessage) {
          setUnavailable(unavailableMessage);
          return { kind: 'unavailable', message: unavailableMessage };
        }
        if (result.blocked) {
          return { kind: 'blocked', message: result.message ?? blockedFallback };
        }
        return { kind: 'ok', result };
      } catch (err) {
        if (!isCurrent()) return { kind: 'stale' };
        const unavailableMessage = unavailableMessageFromError(err);
        if (unavailableMessage) {
          setUnavailable(unavailableMessage);
          return { kind: 'unavailable', message: unavailableMessage };
        }
        const message = errorMessage(err);
        setError(message);
        return { kind: 'error', message };
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [blockedFallback, toolName, validate],
  );

  return { cancel, error, loading, reset, run, unavailable };
};
