// biome-ignore-all lint: it's an example code
import type Logger from "cenglu";

declare global {
  namespace Express {
    interface Request {
      logger?: Logger;
      correlationId?: string;
      requestId?: string;
      startTime?: number;
    }

    interface Response {
      // extend Response here if you add fields to `res`
    }
  }
}
