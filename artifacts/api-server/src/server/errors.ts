/**
 * RFC 9457 problem+json error helpers.
 * All error responses from the API go through here.
 */
import { randomUUID } from "crypto";
import type { Request, Response } from "express";

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string | null;
  instance?: string | null;
  trace_id: string;
  errors?: Array<{ pointer: string; message: string }>;
}

const PROBLEM_BASE = "https://frontoffice.example/probs";

export function problem(
  res: Response,
  status: number,
  title: string,
  opts: {
    type?: string;
    detail?: string;
    instance?: string;
    trace_id?: string;
    errors?: Array<{ pointer: string; message: string }>;
  } = {}
): void {
  const trace_id = opts.trace_id ?? randomUUID();
  const body: ProblemDetail = {
    type: opts.type ?? `${PROBLEM_BASE}/${status}`,
    title,
    status,
    detail: opts.detail ?? null,
    instance: opts.instance ?? null,
    trace_id,
    ...(opts.errors ? { errors: opts.errors } : {}),
  };
  res
    .status(status)
    .setHeader("Content-Type", "application/problem+json")
    .json(body);
}

export function notFound(res: Response, detail?: string): void {
  problem(res, 404, "Not Found", { detail });
}

export function forbidden(res: Response, detail?: string): void {
  problem(res, 403, "Forbidden", { detail });
}

export function unauthorized(res: Response, detail?: string): void {
  problem(res, 401, "Unauthorized", { detail });
}

export function badRequest(
  res: Response,
  detail?: string,
  errors?: Array<{ pointer: string; message: string }>
): void {
  problem(res, 400, "Bad Request", { detail, errors });
}

export function conflict(res: Response, detail?: string): void {
  problem(res, 409, "Conflict", { detail });
}

export function unprocessable(res: Response, detail?: string): void {
  problem(res, 422, "Unprocessable Entity", { detail });
}

export function tooManyRequests(
  res: Response,
  retryAfterSecs: number,
  detail?: string
): void {
  res.setHeader("Retry-After", String(retryAfterSecs));
  problem(res, 429, "Too Many Requests", { detail });
}

/**
 * Attach a trace_id to every response from the request logger.
 */
export function injectTraceId(req: Request): string {
  const id =
    (req.headers["x-trace-id"] as string | undefined) ?? randomUUID();
  // @ts-expect-error – pino-http sets req.id; we augment it
  req.id = id;
  return id;
}
