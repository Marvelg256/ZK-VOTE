/**
 * Request Logging Middleware
 *
 * Provides request context and structured logging for all requests.
 * Supports PII redaction via the enhanced logger.
 */

import type { Request, Response, NextFunction } from "express";

// Extend Express Request to include ctx
declare global {
  namespace Express {
    interface Request {
      ctx?: string;
      traceId?: string;
      spanId?: string;
    }
  }
}
import crypto from "crypto";
// import { config } from "../config.js"; // Unused - kept for reference
import { log, hashIp, getRedactionPolicy } from "../services/logger.js";
import {
  createSpanContext,
  formatTraceparent,
  parseTraceparent,
  runWithSpanContext,
  type SpanContext,
} from "../services/tracing.js";

/**
 * Parses an inbound W3C `traceparent` header (version-traceid-parentid-flags,
 * https://www.w3.org/TR/trace-context/#traceparent-header) and returns its
 * trace ID, or `undefined` if the header is absent or malformed.
 */
export function parseIncomingTraceId(
  header: string | undefined,
): string | undefined {
  return parseTraceparent(header)?.traceId;
}

/**
 * Request logging middleware
 * Adds context ID and logs request start/end
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ctx = crypto.randomBytes(6).toString("hex");
  req.ctx = ctx;

  // W3C Trace Context (#141): continue an inbound trace ID when present so
  // this request can be correlated across services, otherwise start a new
  // trace. The span ID always identifies this hop.
  //
  // The context is also installed as ambient for the rest of the chain (#321),
  // which is what lets a database write or a Soroban RPC call opened deep
  // inside a handler attach itself to this request's trace without every
  // intervening signature having to carry a context argument.
  const inbound = parseTraceparent(req.get("traceparent"));
  const spanContext: SpanContext = createSpanContext(inbound);
  req.traceId = spanContext.traceId;
  req.spanId = spanContext.spanId;
  res.setHeader("traceparent", formatTraceparent(spanContext));

  // Build IP meta based on configuration
  const policy = getRedactionPolicy();
  let ipMeta: Record<string, string> = {};

  if (policy.showClientIp === "plain") {
    ipMeta = { ip: req.ip || "" };
  } else if (policy.showClientIp === "hash") {
    ipMeta = { ipHash: hashIp(req.ip) };
  }
  // If "none", ipMeta stays empty

  // Build body meta (only log body keys, not values)
  const bodyMeta = policy.showBodyKeysOnly
    ? { bodyKeys: Object.keys(req.body || {}) }
    : {};

  log("info", "request_start", {
    ctx,
    traceId: spanContext.traceId,
    path: req.path,
    method: req.method,
    ...ipMeta,
    ...bodyMeta,
  });

  // Log request end on finish
  res.on("finish", () => {
    log("info", "request_end", {
      ctx,
      traceId: spanContext.traceId,
      path: req.path,
      status: res.statusCode,
    });
  });

  runWithSpanContext(spanContext, next);
}

/**
 * Error logging middleware with redaction
 * Logs errors without exposing sensitive data
 */
export function errorLogger(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ctx = req.ctx || "unknown";
  const isProduction = process.env.NODE_ENV === "production";

  // Log the error with redaction
  log("error", "request_error", {
    ctx,
    traceId: req.traceId,
    path: req.path,
    method: req.method,
    error: err.message,
    // In production, don't log stack traces
    ...(isProduction ? {} : { stack: err.stack }),
  });

  next(err);
}
