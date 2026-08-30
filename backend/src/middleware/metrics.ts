/**
 * HTTP Request Metrics Middleware
 *
 * Records request count, latency histogram, and body size for every HTTP
 * request, plus the in-flight concurrency gauge that makes relay backpressure
 * visible (#323): a rising in-flight count alongside a widening indexer poll
 * interval is the signature of a pipeline that is shedding rather than
 * queueing.
 */

import type { Request, Response, NextFunction } from "express";
import {
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestSize,
  httpRequestsInFlight,
  httpResponseSize,
} from "../services/metrics.js";
import { normalizeRoute } from "../services/metrics.js";

/**
 * Express middleware that records Prometheus metrics for every request.
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();
  const route = normalizeRoute(req.route?.path || req.path);
  const method = req.method;

  // Track request body size
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > 0) {
    httpRequestSize.observe({ method, route }, contentLength);
  }

  httpRequestsInFlight.inc({ method, route });
  // A client that disconnects mid-flight never reaches res.end, so decrement
  // exactly once from whichever of the two fires first.
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    httpRequestsInFlight.dec({ method, route });
  };
  res.on("close", release);

  // Capture the original end/finish to measure response
  const originalEnd = res.end;
  res.end = function (this: Response, ...args: Parameters<typeof originalEnd>) {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    const status = String(res.statusCode);

    release();
    httpRequestsTotal.inc({ method, route, status });
    httpRequestDuration.observe({ method, route, status }, duration);

    // Track response body size
    const resContentLength = parseInt(
      (res.getHeader("content-length") as string) || "0",
      10,
    );
    if (resContentLength > 0) {
      httpResponseSize.observe({ method, route, status }, resContentLength);
    }

    return originalEnd.apply(this, args);
  } as typeof originalEnd;

  next();
}
