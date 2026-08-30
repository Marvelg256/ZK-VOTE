# ZK-VOTE Multi-Issue Program — Living Build / Handoff Document

**Program:** Issues #325 (XL), #326 (L), #358 (L), #369 (S) — executed in that
deliberate order (small/isolated first, so later issues build on hardened
foundations).

**Repo:** fork `Ay-obami/ZK-VOTE`, upstream `ZK-VOTE/ZK-VOTE`.
**Working dir:** `/home/ayobami/stellar-issues/ZK-VOTE` (clean clone of `main`
@ `746e98fa` at program start).

**Commit policy:** small, reviewable commits per milestone. Do NOT push until
explicit confirmation per checkpoint. Check in with the user at the end of
each of the four issues.

---

## Execution order & rationale (from program spec)

1. **#369** (S, ~3d) — parity tests for the Soroban BE conversion scripts.
   Correctness here underpins #325's on-chain claim acceptance test (an
   endianness bug would fail on-chain verification for the wrong reason).
2. **#358** (L, 1-2wk) — backend service-layer DI refactor, BEFORE #325's
   relayer route is written against the old pattern.
3. **#326** (L, 2wk) — generate TS bindings for the 5 advanced contracts;
   wire Threshold/Bridge panels. Needed context for #325's frontend.
4. **#325** (XL, 3wk) — Anonymous Vote-to-Earn full stack (circuit, on-chain
   claim + treasury, relayer route on #358's new DI pattern, UI on #326's
   bindings, sybil/THREAT_MODEL extension).

---

## Status board

| Issue | Status | Branch | Notes |
|-------|--------|--------|-------|
| #369 | DONE — awaiting review/commit | `feat/369-soroban-be-parity-tests` | 21 new tests, fixed vectors, CI step, mutation-verified |
| #358 | TODO | — | ... |
| #326 | TODO | — | ZK-091: NO reference found in repo (see below) |
| #325 | TODO | — | `circuits/claim.circom` ALREADY EXISTS in repo |

---

## Issue #369 — Soroban BE conversion parity tests

**Scope:** `circuits/convert_proof_to_soroban_be.js`,
`circuits/convert_vkey_to_soroban_be.js`, `circuits/conversion-utils.js`,
`circuits/conversion-utils.test.js`, CI wiring (`.github/workflows/ci.yml`).

### What the scripts do (read in full)
- Both take snarkjs JSON and emit big-endian Soroban/CAP-74 byte layout.
- **G1** → `be32(X) || be32(Y)` (64 bytes). snarkjs is already big-endian, so
  NO byte reversal.
- **G2** → `be32(X.c1) || be32(X.c0) || be32(Y.c1) || be32(Y.c0)` (128 bytes).
  snarkjs stores G2 as `[[c0, c1], [c0, c1]]`, so the script swaps within
  each coordinate pair (imaginary first). Per-limb, not whole-buffer.
- `convert_proof_to_soroban_be.js` writes `proof_soroban_be.json` next to the
  proof file. `convert_vkey_to_soroban_be.js` writes
  `build/verification_key_soroban.json` + `frontend/src/lib/verification_key_soroban.json`.
- **Known quirk (pre-existing, NOT caused by us):** `scripts/compile-circuits.sh`
  redirects the *stdout* of `convert_vkey_to_soroban_be.js` to
  `$BUILD_DIR/verification_key_soroban.json`, but the script's own
  `fs.writeFileSync` already writes the JSON. The redirect captures the log
  banner, not pure JSON. The artifact written by the script itself is correct;
  the shell redirect pollutes a second copy. Note for later; not blocking #369.

### Existing test surface (at start)
- `conversion-utils.js` — extracted utils: `toBE32ByteHex`, `convertG1Point`,
  `convertG2Point`, `convertProofToSoroban`, `convertVKeyToSoroban`,
  `reverseHexBytes`.
- `conversion-utils.test.js` — unit tests for those utils (synthetic values),
  NO round-trip to snarkjs, NO real-circuit vectors, does not exercise the two
  CLI scripts themselves.
- `circuits/utils/proof_to_soroban.js` + `vkey_to_soroban.js` — a *different*,
  older conversion implementation (byte-array output). Used by
  `circuits/utils/test/proof_converter.test.js` (node:test; excluded from
  jest via `jest.config.js` `/utils/test/` ignore).
  NOTE: `utils/proof_to_soroban.js` has the SAME endianness/swap logic but is
  NOT the code path #369 covers. Out of scope unless drift is found.

### Known-good fixtures available in-repo (real circuit runs)
- `contracts/zkvote-groth16/tests/comment_v2_real_proof.rs` — real
  comment_v2.circom proof + VK in Soroban BE hex, VERIFIED ON-CHAIN via the
  production BN254 pairing path. The conversion was done by these exact
  scripts. → the anchor vector for #369.
- `frontend/public/circuits/verification_key.json` (snarkjs decimal) +
  `frontend/public/circuits/verification_key_soroban.json` (converted) — a
  full snarkjs→Soroban fixed vector pair for the vote circuit VK.

### Work items / milestones (updating as I go)
- [x] M1: Reverse-conversion helpers in `conversion-utils.js`
      (soroban→snarkjs decode) to enable true round-trip tests.
      Added: `beHexToBigInt`, `sorobanG1ToSnarkjs`, `sorobanG2ToSnarkjs`,
      `sorobanProofToSnarkjs`, `sorobanVKeyToSnarkjs`.
- [x] M2: Parity test suite with round-trip + real-vector fixtures.
      NEW `circuits/soroban_be_parity.test.js` (14 tests) +
      `circuits/parity-fixtures.js` (comment_v2 proof/VK/public signals from
      the on-chain-verified Rust fixture; vote VK snarkjs+Soroban pair from
      frontend/public/circuits).
- [x] M3: CLI black-box tests — NEW `circuits/soroban_be_cli.test.js` (4 tests)
      spawns the real scripts against temp fixtures. To make the vkey script
      hermetic, `convert_vkey_to_soroban_be.js` gained an optional 3rd arg
      (output path); default behavior unchanged. Both CLI scripts refactored
      to use `conversion-utils.js` (previously duplicated the conversion
      logic inline).
- [x] M4: CI wiring — `npm run test:parity` script added; explicit
      "Run Soroban BE conversion parity tests (#369)" step added to the
      `circuits` job in `.github/workflows/ci.yml` (the new files are also
      picked up by the existing `npm test` jest run).
- [x] M5: Mutation checks — (a) forced little-endian byte order in
      `toBE32ByteHex`: 6 parity tests failed; (b) forced a *symmetric* G2
      real/imaginary limb-swap omission in BOTH encode and decode: the 3
      fixed-vector tests failed while all round-trip tests still passed,
      proving the fixed vectors catch the exact class of bug a pure
      round-trip suite would miss. Both reverted; suite green again.

### Verified at milestone close
- `npx jest soroban_be_parity soroban_be_cli conversion-utils` → 17 + existing
  util suite all PASS.
- Full `npx jest` (circuits) → my suites PASS; `comment_v2.test.js` FAILS on
  main REGARDLESS of #369 (see below).

### PRE-EXISTING issue found (NOT part of #369, do not fix in this branch)
- `comment_v2.test.js` and `vote_v2.test.js` fail on clean `main`:
  1. `DOMAIN_TAG is the exact same constant...` — the test regexes each
     `.circom` for `var DOMAIN_TAG = <digits>;`, but committed
     `comment_v2.circom`/`vote_v2.circom` do NOT contain that line
     (only `vote.circom` and `comment.circom` do).
  2. `Signal blindingFactor not found` — the test builds inputs with a
     `blindingFactor` and `commitment = Poseidon(DOMAIN_TAG, secret, salt,
     blindingFactor)`, but the committed `comment_v2.circom` uses the OLD
     scheme `commitment = Poseidon(secret, salt)` (2-input Poseidon, no
     DOMAIN_TAG). #349's fix (commit db2c4dc3) evidently restored the
     template line but the circuit files drifted again.
  - Impact: `npm test` in the circuits CI job is ALREADY red on main.
    Flag to maintainers; track separately. Relevant later for #325 (claims
    will mirror the voting/comment commitment scheme) and #326.




---

## Issue #358 — Backend service-layer DI (not started)

Key repo facts for the future session:
- `backend/src/services/*` exists; `index.ts`/`config.ts` at `backend/src/`.
- CI backend job sets `RELAYER_TEST_MODE=true`, a `SCZAN...` test secret, and
  placeholder contract IDs — test env pattern to reuse.
- Need to read `backend/src/services/*` in full, map globals/singletons,
  design interfaces, introduce composition root.

---

## Issue #326 — Advanced contract TS bindings (not started)

- Five contracts: `contracts/token`, `threshold-crypto`, `circuit-registry`,
  `vdf`, `bridge`.
- **ZK-091 dependency: searched the whole repo (1007 commits, 3065 files) —
  NO reference found.** Also ran a broad grep for the string `ZK-091`; zero
  hits in code, comments, docs, or commit messages. Conclusion: treat ZK-091
  as a *deferred/external ticket reference*. The real gate is
  `cargo test -p threshold-crypto` — run it when #326 starts and document the
  actual failure (if any) instead of guessing at ZK-091's content.
- Frontend panels to wire: `frontend/src/.../ThresholdPanel.tsx`,
  `BridgePanel.tsx`. `config/contracts` holds deployed addresses
  (`.deployed-contracts`, `.deployed-contracts-futurenet` at repo root).

---

## Issue #325 — Vote-to-Earn (not started)

- **`circuits/claim.circom` ALREADY EXISTS** (3833 bytes, at repo head).
  Must read it before assuming it needs writing from scratch — 4a may be
  partially/fully designed already.
- `contracts/rewards` and `contracts/token` exist in `contracts/`.
- Existing vote circuit nullifier pattern: `H(secret, daoId, proposalId)`;
  on-chain storage keyed by `(dao_id, proposal_id, nullifier)` (per
  THREAT_MODEL.md). Mirror this for claim, do not invent a new scheme.

---

## Environment notes (important)

- `node v22.23.2`, `npm 10.9.8`. npm registry reachable but FLAPPY — retry
  `npm install` if it fails; first attempt timed out, second succeeded.
- Terminal output capture is unreliable in this session; use
  `cmd > /tmp/x.log 2>&1; echo done > /tmp/x.done` and then `read_files` on
  the log. Do not rely on inline stdout.
- No `node_modules` anywhere for ZK-VOTE yet (circuits/frontend/backend all
  need fresh `npm install`). Other workspace repos' node_modules do NOT
  contain jest/snarkjs/circomlib.
- Rust toolchain: check `rustup toolchain list` before contract work
  (`rust-toolchain.toml` pins the version).
