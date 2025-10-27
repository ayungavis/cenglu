import { randomUUID } from "node:crypto";
import type {
  MiddlewareOptions,
  Request,
  Response,
} from "../types/middleware.type";

/**
 *
 */
export function fastifyPlugin<
  Req extends Request = any,
  Res extends Response = any,
  next extends () => void = () => void,
>(fastify: any, options: MiddlewareOptions<Req, Res>, done: () => void) {
  const {
    logger,
    logRequests = true,
    logResponses = true,
    includeHeaders = false,
    includeBody = false,
    correlationIdHeader = "x-correlation-id",
    generateCorrelationId = randomUUID,
    skip,
  } = options;
  
  
}
