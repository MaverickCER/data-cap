# enterprise-platform: Atlas

**Tier 3: "How do we show our data architecture, at organizational scale, to someone who wasn't in the room?"**

Atlas is an internal work-management platform used by three departments. It scales up the "project" concept that `examples/team-service/` tracks for one team. Three capabilities, each owned by a different team, sit in front of one running service:

| Capability     | Owner              | Notes          |
| -------------- | ------------------ | -------------- |
| `identityData` | platform-security  |                |
| `projectsData` | engineering-ops    |                |
| `billingData`  | finance-team       | `confidential` |

Tier 2 asked how teams compose capabilities. This tier asks how to generate the documentation a reviewer needs, and a CI gate that blocks a governance gap before it ships.

## Run it

Build the package first: `npm run build` at the repository root. Then, in this directory, run `npm install` and:

| Command           | Exit code | Look for                                                                                |
| ----------------- | --------- | --------------------------------------------------------------------------------------- |
| `npm start`       | 0         | `enterprise-platform: all assertions passed.`                                           |
| `npm run docs`    | 0         | `Wrote evidence model:` followed by the `docs/data.evidence.json` path                  |
| `npm run reports` | 0         | `Data-handling record written for` and `Audit-prep report written for`                  |
| `npm run check`   | 0         | `[generate-docs check] manifest/docs/ownership/flow/evidence artifacts are up to date.` |
| `npm run guard`   | 0         | `Wrote evidence model:`; Atlas's own capabilities pass `--strict-docs`                  |

`npm start` is headless. It starts an embedded MongoDB (`mongodb-memory-server`) and an HTTP and SSE server in the same process. It then runs `node:assert/strict` checks against the built `data-cap`, generates both reports and exercises the CI guard. A failed assertion exits 1. `npm run check` exits 1 and lists each stale file.

CI's `examples` job runs `npm run typecheck` here, then `npm start` and `npm run check` through `test/examples/enterprise-platform.test.ts`. `test/examples/enterprise-platform-reports.test.ts` and `enterprise-platform-ropa.test.ts` test the report scripts in the same job. `npm run guard` and `npm run dev` are not run in CI. That job does not block a merge.

`npm run dev` starts the interactive TanStack Start app, with the same HTTP and SSE handler as Vite middleware. Register an account, open a project, issue an invoice and dispute it to see the live SSE sync.

## Three departments, one platform

Each capability is declared in its own file, with its own `owner`. `data-cap` enforces no department boundary. Ownership is a fact `documentData()` records for the reports; it is not access control.

`src/server/` is one backend behind all three. It uses MongoDB through `mongodb-memory-server`, `scrypt` session auth, native SSE, Zod validation, Resend email with a console fallback, and pino logging. As in `examples/team-service/`, that infrastructure is an implementation detail behind the capabilities.

## Declared handling at every endpoint a field crosses

A `DataFlowEndpoint` can declare `handling` next to its `url`: `plaintext`, `masked`, `redacted`, `hashed` or `encrypted`. `billingData.invoices` declares `encrypted` on every endpoint it crosses. `identityData.currentUser` declares `plaintext` on its one read endpoint.

`reports/data-handling-record.ts` reads this from each field's `writtenBy` operations. It renders a lifecycle table: operation, direction, endpoint and declared handling. The handling is declared, never verified, like every other governance fact.

A sensitive field with no `handling` on a boundary-crossing endpoint raises `SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING`, and `--strict-flow` makes it an error. `main-headless.ts`'s guard section checks that.

## Two generated reports, one visible gap

`src/server/legacy-compliance-sync.ts` stands for an older utility nobody changed. It reads `billingData.invoices` and `identityData.currentUser` through a field name computed at runtime. `src/build/dependency-graph.ts` sees that access but cannot attribute it to one field.

`billing.capability.ts` cites the line in `evidence.fields.invoices.dynamicAccess`. So `reports/data-handling-record.ts` resolves `invoices` to `"declared-dynamic"`. `identity.capability.ts` has no such citation, so `currentUser` resolves to `"indeterminate"`. The report shows that gap instead of hiding it, and `main-headless.ts` asserts both outcomes.

`reports/audit-prep.ts` is the companion rollup. It is a completeness matrix: which governance declarations exist, not whether they are right. It covers all three capabilities and every declared-sensitive field. The columns are owner, sensitivity, purpose, legal basis, data residency, audit-required, protections, retention and the handling-declared fraction. It adds `projectAuditEvidence`'s ownership and finding-count rollup.

## One shared source, cached and fingerprint-checked

Both report scripts read `getEvidence()` from `reports/evidence-cache.ts`. That returns the `EvidenceModel` that `npm run docs` writes to `docs/data.evidence.json` ([ADR 0054](../../specs/decisions/0054-evidence-model-as-orchestrator-backbone.md)).

Neither script re-runs discovery on each call. `getEvidence()` hashes the raw bytes of every file under `src/**` with `sha256`, without parsing. It serves the committed file only when that hash and the installed `data-cap` version match the recorded ones. On a mismatch or a missing cache it calls `computeDataArtifacts()` and prints that it did.

## The CI-configuration guard

`npm run guard` runs `data-cap --strict-docs` against Atlas's own capabilities, which are fully documented, so it passes. A pass alone does not show the guard can fail.

So `main-headless.ts` ends by building a small synthetic capability in a temporary directory. It has no `owner`, and a sensitive field crosses an endpoint with no declared `handling`. The script asserts that `generateDataArtifacts()` throws `DataProjectGenerationError` under `--strict-docs`, and again under `--strict-flow`. `npm run guard` calls the same function through the CLI.

## What it checks

`npm start` asserts each of these:

- Three capabilities with separate owners run against one service, each with its own `documentData()` declarations.
- Each field's declared `handling` renders as a lifecycle table in `reports/data-handling-record.ts`. The table shows what was declared, never actual encryption or redaction.
- The same uncited dynamic-access utility gives `"declared-dynamic"` for the cited field and `"indeterminate"` for the uncited one.
- `--strict-docs` and `--strict-flow` each make generation throw `DataProjectGenerationError` on a synthetic fixture built on every run.
- Two subscribers to one project's invoices share one SSE connection, counted on the server. An array field's subscription status in `.info` is not meaningful here; see `billing.capability.ts`.

## Generated reports

`npm run docs` writes the manifest, `docs/DATA.md`, `docs/OWNERSHIP.md`, the flow diagrams and `docs/data.evidence.json`. `npm run reports` writes `reports/data-handling-record.{md,json}` and `reports/audit-prep.{md,json}`. Like every generated artifact, they can support a review; they do not establish compliance.

Both report scripts read `docs/data.evidence.json` through the cache above. [`specs/generated-artifacts.md`](../../specs/generated-artifacts.md) says what each artifact does and does not claim. The design history is in [ADR 0050](../../specs/decisions/0050-fact-model-architecture.md) through [ADR 0053](../../specs/decisions/0053-developer-declared-dynamic-access-citations.md), and [ADR 0054](../../specs/decisions/0054-evidence-model-as-orchestrator-backbone.md).

## Where to go next

- [`../application/`](../application): the first tier, one capability with the whole single-developer feature set.
- [`../team-service/`](../team-service): the second tier, composition and a duplicate-endpoint finding within one team.
- [`../../test/integration/subscriptions/socket-io-subscription/`](../../test/integration/subscriptions/socket-io-subscription): the same transport pattern with Socket.IO instead of SSE.
