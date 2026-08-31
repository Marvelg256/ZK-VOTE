/**
 * OpenAPI Specification for ZKVote Backend
 * Documents all routes including audit and remediation for accountability.
 * Scope: middleware/audit.ts, routes/*, openapi.ts
 */

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "ZKVote Relayer API",
    version: "1.0.0",
    description: "Anonymous voting relayer with full audit trail and incident response",
  },
  servers: [{ url: "http://localhost:3001", description: "Local" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      relayerAuth: { type: "apiKey", in: "header", name: "X-Relayer-Auth" },
    },
    schemas: {
      VoteRequest: {
        type: "object",
        required: ["daoId", "proposalId", "choice", "nullifier", "root", "proof"],
        properties: {
          daoId: { type: "integer" },
          proposalId: { type: "integer" },
          choice: { type: "boolean" },
          nullifier: { type: "string", description: "BN254 field element hex < modulus (redacted in audit)" },
          root: { type: "string", description: "Merkle root hex (redacted in audit)" },
          proof: { type: "object", description: "Groth16 proof (redacted in audit)", properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "string" } } },
        },
      },
      AuditEntry: {
        type: "object",
        properties: {
          id: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          requestId: { type: "string" },
          method: { type: "string" },
          path: { type: "string" },
          action: { type: "string" },
          actor: { type: "string", description: "Hashed actor identifier (PII redacted)" },
          statusCode: { type: "integer" },
          immutable: { type: "boolean", enum: [true] },
        },
      },
      DaoOverview: {
        type: "object",
        description: "Headline governance counters for one DAO (#322)",
        properties: {
          daoId: { type: "integer" },
          memberCount: { type: "integer", description: "Turnout denominator" },
          proposalsCreated: { type: "integer" },
          proposalsClosed: { type: "integer" },
          proposalsWithVotes: { type: "integer" },
          votesCast: { type: "integer" },
          membersJoined: { type: "integer" },
          membersLeft: { type: "integer" },
          totalEvents: { type: "integer" },
          firstEventAt: { type: "string", format: "date-time", nullable: true },
          lastEventAt: { type: "string", format: "date-time", nullable: true },
          averageVotesPerProposal: { type: "number", nullable: true },
          proposalParticipationRate: { type: "number", nullable: true },
        },
      },
      ProposalTurnout: {
        type: "object",
        description: "Turnout for a single proposal",
        properties: {
          daoId: { type: "integer" },
          proposalId: { type: "integer" },
          createdAt: { type: "string", format: "date-time", nullable: true },
          closedAt: { type: "string", format: "date-time", nullable: true },
          votesCast: { type: "integer" },
          eligibleVoters: { type: "integer" },
          turnoutRatio: { type: "number", nullable: true, description: "votesCast / eligibleVoters" },
          firstVoteAt: { type: "string", format: "date-time", nullable: true },
          lastVoteAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      ProposalTurnoutPage: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/ProposalTurnout" } },
          total: { type: "integer" },
          limit: { type: "integer" },
          offset: { type: "integer" },
        },
      },
      ParticipationBucket: {
        type: "object",
        description: "Participation aggregated into one time bucket",
        properties: {
          bucket: { type: "string", description: "strftime-formatted bucket key" },
          votesCast: { type: "integer" },
          proposalsCreated: { type: "integer" },
          activeProposals: { type: "integer" },
          membersJoined: { type: "integer" },
        },
      },
      ParticipationSeries: {
        type: "object",
        properties: {
          daoId: { type: "integer" },
          interval: { type: "string", enum: ["hour", "day", "week", "month"] },
          buckets: { type: "array", items: { $ref: "#/components/schemas/ParticipationBucket" } },
        },
      },
      PlatformOverview: {
        type: "object",
        description: "Cross-DAO totals aggregated over every event partition",
        properties: {
          daoCount: { type: "integer" },
          proposalsCreated: { type: "integer" },
          votesCast: { type: "integer" },
          totalEvents: { type: "integer" },
          firstEventAt: { type: "string", format: "date-time", nullable: true },
          lastEventAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      RemediationAction: {
        type: "object",
        required: ["action", "target", "reason", "idempotencyKey"],
        properties: {
          action: { type: "string", enum: ["freeze_dao", "unfreeze_dao", "pause_voting", "resume_voting", "revoke_member", "restore_member", "emergency_pause", "emergency_resume", "rotate_vk", "quarantine_proposal"] },
          target: { type: "string", description: "DAO or proposal identifier" },
          reason: { type: "string", minLength: 5 },
          idempotencyKey: { type: "string", minLength: 8, description: "Replay protection - duplicate keys return 409" },
          metadata: { type: "object", additionalProperties: true },
        },
      },
    },
  },
  paths: {
    "/vote": {
      post: {
        summary: "Submit anonymous vote (audited)",
        security: [{ relayerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/VoteRequest" } } } },
        responses: { "200": { description: "Vote submitted" }, "401": { description: "Unauthorized" } },
        "x-audited": true,
        "x-redacted-fields": ["nullifier", "root", "proof"],
      },
    },
    "/comment/anonymous": {
      post: {
        summary: "Anonymous comment (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
        "x-redacted-fields": ["nullifier", "root", "proof"],
      },
    },
    "/comment/edit": {
      post: {
        summary: "Edit comment (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/comment/delete": {
      post: {
        summary: "Delete comment (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/bridge/vote": {
      post: {
        summary: "Bridge vote (audited)",
        "x-audited": true,
        "x-redacted-fields": ["nullifier", "voteRoot", "sbtRoot", "proof"],
      },
    },
    "/bridge/relay": {
      post: {
        summary: "Manual relay (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/ipfs/image": {
      post: {
        summary: "Upload image (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/ipfs/metadata": {
      post: {
        summary: "Upload metadata (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/daos/sync": {
      post: {
        summary: "Sync DAOs (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/events": {
      post: {
        summary: "Manual event (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/events/notify": {
      post: {
        summary: "Notify event (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/remediation/action": {
      post: {
        summary: "Structured remediation action (append-only, authz, replay-safe)",
        security: [{ relayerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/RemediationAction" } } } },
        responses: { "201": { description: "Recorded" }, "409": { description: "Duplicate idempotencyKey" }, "401": { description: "Unauthorized" } },
        "x-audited": true,
        "x-append-only": true,
        "x-replay-safe": true,
      },
    },
    "/remediation/log": {
      get: {
        summary: "Query remediation log",
        security: [{ relayerAuth: [] }],
        parameters: [{ name: "action", in: "query", schema: { type: "string" } }, { name: "target", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer" } }, { name: "offset", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "Log entries" } },
      },
    },
    "/audit/logs": {
      get: {
        summary: "Query audit logs (redacted, authz)",
        security: [{ relayerAuth: [] }],
        parameters: [{ name: "action", in: "query", schema: { type: "string" } }, { name: "actor", in: "query", schema: { type: "string" } }, { name: "method", in: "query", schema: { type: "string" } }, { name: "from", in: "query", schema: { type: "string", format: "date-time" } }, { name: "to", in: "query", schema: { type: "string", format: "date-time" } }, { name: "limit", in: "query", schema: { type: "integer" } }, { name: "offset", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "Audit entries" } },
        "x-redacted": true,
      },
    },
    "/audit/export": {
      get: {
        summary: "Export audit logs (json/csv)",
        security: [{ relayerAuth: [] }],
        parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } }],
        responses: { "200": { description: "Exported logs" } },
      },
    },
    "/audit/stats": {
      get: {
        summary: "Audit statistics",
        security: [{ relayerAuth: [] }],
        responses: { "200": { description: "Stats" } },
      },
    },
    "/api/v1/analytics/daos/{daoId}/overview": {
      get: {
        tags: ["analytics"],
        summary: "Governance counters for one DAO",
        description: "Aggregated in SQL over the DAO event partition. Public read.",
        security: [],
        parameters: [{ name: "daoId", in: "path", required: true, schema: { type: "integer", minimum: 0 } }],
        responses: {
          "200": { description: "Overview", content: { "application/json": { schema: { $ref: "#/components/schemas/DaoOverview" } } } },
          "400": { description: "Invalid DAO ID" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/v1/analytics/daos/{daoId}/turnout": {
      get: {
        tags: ["analytics"],
        summary: "Per-proposal turnout for one DAO",
        security: [],
        parameters: [
          { name: "daoId", in: "path", required: true, schema: { type: "integer", minimum: 0 } },
          { name: "proposalId", in: "query", schema: { type: "integer", minimum: 0 }, description: "Restrict to one proposal" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          "200": { description: "Turnout page", content: { "application/json": { schema: { $ref: "#/components/schemas/ProposalTurnoutPage" } } } },
          "400": { description: "Invalid parameters" },
        },
      },
    },
    "/api/v1/analytics/daos/{daoId}/participation": {
      get: {
        tags: ["analytics"],
        summary: "Participation time series for one DAO",
        security: [],
        parameters: [
          { name: "daoId", in: "path", required: true, schema: { type: "integer", minimum: 0 } },
          { name: "interval", in: "query", schema: { type: "string", enum: ["hour", "day", "week", "month"], default: "day" } },
          { name: "from", in: "query", schema: { type: "string" }, description: "Inclusive ISO-8601 lower bound" },
          { name: "to", in: "query", schema: { type: "string" }, description: "Exclusive ISO-8601 upper bound" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 365 } },
        ],
        responses: {
          "200": { description: "Series", content: { "application/json": { schema: { $ref: "#/components/schemas/ParticipationSeries" } } } },
          "400": { description: "Invalid parameters" },
        },
      },
    },
    "/api/v1/analytics/daos/{daoId}/turnout.csv": {
      get: {
        tags: ["analytics"],
        summary: "Turnout export (CSV, authz)",
        description: "Operator surface: bulk export requires a relayer token.",
        security: [{ relayerAuth: [] }],
        parameters: [
          { name: "daoId", in: "path", required: true, schema: { type: "integer", minimum: 0 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          "200": { description: "CSV export", content: { "text/csv": { schema: { type: "string" } } } },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/api/v1/analytics/platform/overview": {
      get: {
        tags: ["analytics"],
        summary: "Cross-DAO platform totals (authz)",
        security: [{ relayerAuth: [] }],
        responses: {
          "200": { description: "Platform overview", content: { "application/json": { schema: { $ref: "#/components/schemas/PlatformOverview" } } } },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
  "x-audit": {
    description: "All mutating routes are audited with PII redaction. 100% coverage via global auditMiddleware.",
    mutatingRoutes: [
      "POST /vote",
      "POST /comment/anonymous",
      "POST /comment/edit",
      "POST /comment/delete",
      "POST /bridge/vote",
      "POST /bridge/relay",
      "POST /ipfs/image",
      "POST /ipfs/metadata",
      "POST /daos/sync",
      "POST /events",
      "POST /events/notify",
      "POST /remediation/action",
    ],
    redaction: "proof, nullifier, root, commitment, secret, token, password, jwt always redacted",
    immutable: "audit logs and remediation logs are append-only, no update/delete APIs",
    replaySafe: "remediation uses idempotencyKey; duplicates return 409",
  },
} as const;

export default openApiSpec;
