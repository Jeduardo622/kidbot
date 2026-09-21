import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

type DrainResult = 'graceful' | 'forced';

export const isAgentProductionReady = (body: {
  provider?: { mode?: unknown };
  ready?: unknown;
}) => body.ready === true && body.provider?.mode === 'openai';

export const resolveHealthStatus = ({
  nodeEnv,
  productionReady,
  storesReady,
}: {
  nodeEnv: string | undefined;
  productionReady: boolean;
  storesReady: boolean;
}) => nodeEnv === 'production'
  ? { ok: productionReady, status: productionReady ? 200 : 503 }
  : { ok: storesReady, status: storesReady ? 200 : 503 };

export const createDrainGuard = (isDraining: () => boolean) =>
  (_request: Request, response: Response, next: NextFunction) => {
    if (!isDraining()) {
      next();
      return;
    }
    response.status(503).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'service_draining' },
      id: null,
    });
  };

export const createServiceLifecycle = ({
  server,
  closeResources,
  deadlineMs = 10_000,
}: {
  server: Pick<Server, 'close'> & Partial<Pick<Server, 'closeAllConnections' | 'closeIdleConnections'>>;
  closeResources: () => Promise<void>;
  deadlineMs?: number;
}) => {
  let draining = false;
  let shutdownPromise: Promise<DrainResult> | undefined;

  return {
    isDraining: () => draining,
    shutdown: (): Promise<DrainResult> => {
      if (shutdownPromise) return shutdownPromise;
      draining = true;

      shutdownPromise = new Promise<DrainResult>((resolve, reject) => {
        let settled = false;
        const finish = async (result: DrainResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          try {
            await closeResources();
            resolve(result);
          } catch (error) {
            reject(error);
          }
        };
        const deadline = setTimeout(() => {
          server.closeAllConnections?.();
          void finish('forced');
        }, deadlineMs);
        deadline.unref();

        server.close((error?: Error) => {
          if (error) {
            server.closeAllConnections?.();
            void finish('forced');
            return;
          }
          void finish('graceful');
        });
        server.closeIdleConnections?.();
      });

      return shutdownPromise;
    },
  };
};
