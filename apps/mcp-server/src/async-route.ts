import type { Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (
  request: Request,
  response: Response,
) => Promise<unknown>;

export const asyncRoute = (handler: AsyncRequestHandler): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };
