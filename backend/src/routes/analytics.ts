/**
 * Governance Analytics API (#322)
 *
 * `/api/v1/analytics` — turnout and participation as a first-class API rather
 * than something every client re-derives from the raw event feed.
 *
 * Authorization is split by blast radius. Per-DAO aggregates describe public
 * governance activity and are readable without a token (rate limited, like the
 * other read endpoints). Cross-DAO totals and the CSV export are operator
 * surfaces — they enumerate the whole platform in one response — so they sit
 * behind `authGuard`.
 *
 * Every handler delegates its arithmetic to `services/analytics.ts`, which
 * aggregates in SQL. No route reduces rows in memory.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  getDaoOverview,
  getParticipationTimeseries,
  getPlatformOverview,
  getProposalTurnout,
  logAnalyticsQuery,
  turnoutToCsv,
} from "../services/analytics.js";
import { authGuard, queryLimiter, validateParams, validateQuery } from "../middleware/index.js";
import { log } from "../services/logger.js";
import type { AsyncHandler } from "../types/index.js";

const router = Router();

/**
 * `validateParams` / `validateQuery` publish their coerced output on the
 * request rather than mutating `req.params` / `req.query`, which are getters
 * under Express 5. These read the validated copies.
 */
function validatedParams<T>(req: Request): T {
  return (req as Request & { validatedParams: T }).validatedParams;
}

function validatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery?: T }).validatedQuery ?? ({} as T);
}

const BASE = "/api/v1/analytics";

// ============================================
// SCHEMAS
// ============================================

const daoIdParams = z.object({
  daoId: z.coerce.number().int().nonnegative(),
});

const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  proposalId: z.coerce.number().int().nonnegative().optional(),
});

/** ISO-8601 instants only — the SQL comparison is lexicographic on the stored ISO string. */
const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"));

const participationQuery = z
  .object({
    interval: z.enum(["hour", "day", "week", "month"]).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .refine(
    (value) => !value.from || !value.to || value.from < value.to,
    { message: "`from` must be earlier than `to`", path: ["from"] },
  );

// ============================================
// HELPERS
// ============================================

/**
 * Run an analytics handler, timing it and mapping failures to a 500.
 *
 * Analytics is a read-only reporting surface: a malformed partition or a
 * missing table must degrade this endpoint alone, never the relay.
 */
async function serve<T>(
  res: Response,
  metric: string,
  daoId: number | null,
  produce: () => Promise<T>,
  countRows: (result: T) => number,
): Promise<Response> {
  const startedAt = process.hrtime.bigint();
  try {
    const result = await produce();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logAnalyticsQuery(metric, daoId, durationMs, countRows(result));
    return res.json(result);
  } catch (error) {
    log("error", "analytics_query_failed", {
      metric,
      daoId,
      error: (error as Error).message,
    });
    return res.status(500).json({ error: "Failed to compute analytics" });
  }
}

// ============================================
// ROUTES
// ============================================

/** Headline counters for one DAO. */
router.get(
  `${BASE}/daos/:daoId/overview`,
  queryLimiter,
  validateParams(daoIdParams),
  (async (req: Request, res: Response) => {
    const { daoId } = validatedParams<{ daoId: number }>(req);
    return serve(res, "dao_overview", daoId, () => getDaoOverview(daoId), () => 1);
  }) as AsyncHandler,
);

/** Per-proposal turnout, newest proposal first. */
router.get(
  `${BASE}/daos/:daoId/turnout`,
  queryLimiter,
  validateParams(daoIdParams),
  validateQuery(paginationQuery),
  (async (req: Request, res: Response) => {
    const { daoId } = validatedParams<{ daoId: number }>(req);
    const query = validatedQuery<z.infer<typeof paginationQuery>>(req);
    return serve(
      res,
      "proposal_turnout",
      daoId,
      () => getProposalTurnout(daoId, query),
      (result) => result.items.length,
    );
  }) as AsyncHandler,
);

/** Participation bucketed over time. */
router.get(
  `${BASE}/daos/:daoId/participation`,
  queryLimiter,
  validateParams(daoIdParams),
  validateQuery(participationQuery),
  (async (req: Request, res: Response) => {
    const { daoId } = validatedParams<{ daoId: number }>(req);
    const query = validatedQuery<z.infer<typeof participationQuery>>(req);
    return serve(
      res,
      "participation",
      daoId,
      async () => ({
        daoId,
        interval: query.interval ?? "day",
        buckets: await getParticipationTimeseries(daoId, query),
      }),
      (result) => result.buckets.length,
    );
  }) as AsyncHandler,
);

/**
 * Turnout as CSV.
 *
 * Operator-scoped: a CSV export is the shape most likely to be pulled in bulk
 * and archived, so it requires a token even though the same numbers are
 * readable page by page from the JSON endpoint.
 */
router.get(
  `${BASE}/daos/:daoId/turnout.csv`,
  queryLimiter,
  authGuard,
  validateParams(daoIdParams),
  validateQuery(paginationQuery),
  (async (req: Request, res: Response) => {
    const { daoId } = validatedParams<{ daoId: number }>(req);
    const query = validatedQuery<z.infer<typeof paginationQuery>>(req);

    try {
      const page = await getProposalTurnout(daoId, query);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="turnout-dao-${daoId}.csv"`,
      );
      return res.send(turnoutToCsv(page.items));
    } catch (error) {
      log("error", "analytics_csv_failed", {
        daoId,
        error: (error as Error).message,
      });
      return res.status(500).json({ error: "Failed to export turnout" });
    }
  }) as AsyncHandler,
);

/** Platform-wide totals across every DAO partition. */
router.get(
  `${BASE}/platform/overview`,
  queryLimiter,
  authGuard,
  (async (_req: Request, res: Response) =>
    serve(res, "platform_overview", null, () => getPlatformOverview(), () => 1)) as AsyncHandler,
);

export default router;
