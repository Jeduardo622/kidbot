interface DrainableServer {
  close(callback: () => void): unknown;
  closeAllConnections(): void;
}

export const createDrain = (
  server: DrainableServer,
  markUnready: () => void,
  cleanup: () => Promise<unknown>,
  timeoutMs = 30_000,
): (() => Promise<void>) => {
  let pending: Promise<void> | undefined;
  return () => {
    if (pending) return pending;
    markUnready();
    pending = new Promise<void>((resolve) => {
      const timer = setTimeout(() => server.closeAllConnections(), timeoutMs);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        void cleanup().then(() => resolve(), () => resolve());
      });
    });
    return pending;
  };
};
