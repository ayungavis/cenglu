/**
 * HTTP framework middleware for automatic request logging and context propagation
 *
 * These middleware automatically:
 * - Generate or extract correlation IDs
 * - Log incoming requests and outgoing responses
 * - Set up AsyncLocalStorage context for the request
 * - Attach a child logger to the request object
 *
 * @example
 * // Express
 * import express from "express";
 * import { createLogger } from "cenglu";
 * import { expressMiddleware } from "cenglu/middleware";
 *
 * const app = express();
 * const logger = createLogger({ service: "api" });
 *
 * app.use(expressMiddleware(logger));
 *
 * app.get("/users", (req, res) => {
 *   req.logger.info("Fetching users"); // Includes request context
 *   res.json([]);
 * });
 */

// biome-ignore lint/performance/noBarrelFile: organized exports
export * from "./express";
export * from "./fastify";
export * from "./http";
export * from "./koa";
