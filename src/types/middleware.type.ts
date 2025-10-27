import type { Logger } from "../logger";

export interface MiddlewareOptions<Req, Res> {
  logger: Logger;
  options: {
    logRequests?: boolean;
    logResponses?: boolean;
    includeHeaders?: boolean;
    includeBody?: boolean;
    correlationIdHeader?: string;
    generateCorrelationId?: () => string;
    skip?: (req: Req, res: Res) => boolean;
  };
}

export type RequestHeaders = Record<string, string | string[] | undefined>;

export type Request = {
  headers?: RequestHeaders;
  correlationid?: string | string[];
  method?:
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE"
    | "PATCH"
    | "OPTIONS"
    | "HEAD"
    | string;
  query?: Record<string, string | string[] | undefined>;
  body?: any;
  url?: string;
  path?: string;
  ip?: string;
  connection?: {
    remoteAddress?: string;
  };
  logger?: Logger;
};

export type Response = {
  setHeader?: (name: string, value: string | string[]) => void;
  statusCode?: number;
  send?: (data: any) => Response;
};
