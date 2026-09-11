# enterprise-platform -- Atlas

**Tier 3: "How do we prove our data architecture, at organizational scale,
to someone who wasn't in the room?"** Atlas, an internal work-management
platform three departments actually use -- the same "project" concept
`examples/team-service/` tracks for one team, scaled up: `identityData`
(platform-security), `projectsData` (engineering-ops), and `billingData`
(finance-team, `confidential`) are three independently-owned capabilities
against one real running service, not three toy demos. The domain question
shifts again, from Tier 2's "how do teams compose capabilities" to "how do
we generate the documentation an org actually needs -- for litigation
review, for audit prep, and for a CI gate that blocks a real governance
gap before it ships."

## Three departments, one platform

`identityData`, `projectsData`, and `billingData` are declared in three
separate files, each with its own `owner`. Nothing in `data-cap` enforces a
department boundary -- ownership is a governance fact `documentData()`
records for the generated reports below, not an access-control mechanism
`createData` itself provides (same as every other example's own ownership
story). `src/server/` is one real backend behind all three (MongoDB via
`mongodb-memory-server`, hand-rolled `scrypt` session auth, native SSE,
Zod validation, Resend-with-console-fallback email, pino logging) --
deliberately the same "real infrastructure, kept an implementation detail"
choice `examples/team-service/`'s own README makes, just with three
capabilities pointed at it instead of one.

## Field lifecycle: declared handling at every endpoint a field crosses

New this tier: `DataFlowEndpoint` can declare `handling`
(`plaintext`/`masked`/`redacted`/`hashed`/`encrypted`) alongside its `url`.
`billingData.invoices` declares `handling: "encrypted"` on every endpoint it
crosses; `identityData.currentUser` declares `"plaintext"` on its single
read endpoint. `reports/litigation-evidence.ts` reads this straight off
each field's own `writtenBy` operations and renders it as a real lifecycle
table -- which operation, which direction, which endpoint, what handling
was declared there. **Declared, never independently verified** -- the same
discipline `protections`/`retention`/every other governance fact in this
vocabulary already follows; a missing `handling` on a sensitive field's
boundary-crossing endpoint is exactly what
`SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING` (`--strict-flow`) exists to
catch, demonstrated for real in `main-headless.ts`'s own guard section
below.

## Two generated reports, one honest gap

`src/server/legacy-compliance-sync.ts` is a small, deliberately-unchanged
"pre-existing" utility that reads both `billingData.invoices` and
`identityData.currentUser` via a runtime-computed field name -- exactly
the kind of access `src/build/dependency-graph.ts` can prove happens, but
can't statically attribute to one specific field. `billing.capability.ts`'s
own `evidence.fields.invoices.dynamicAccess` citation names the exact
line, so `reports/litigation-evidence.ts` resolves `invoices` to
`"declared-dynamic"`. **`identity.capability.ts` has no matching citation**
-- `currentUser` resolves to `"indeterminate"` instead: a real,
undisclosed gap, not a mistake either report papers over.
`main-headless.ts` asserts both outcomes for real, every run.

`reports/audit-prep.ts` is the companion rollup: a governance-declaration
completeness matrix across all three capabilities and every
declared-sensitive field (owner/sensitivity/purpose/legal basis/data
residency/audit-required/protections/retention, plus the new
handling-declared fraction), on top of `projectAuditEvidence`'s existing
ownership/finding-count rollup.

## One shared source, cached and fingerprint-verified

Both report scripts above read `getEvidence()` (`reports/evidence-cache.ts`)
-- the same `EvidenceModel` `npm run docs`'s own `--evidence
docs/data.evidence.json` flag writes (ADR 0054), committed as its own real
artifact. Neither script re-runs discovery/linking/scanning on every
invocation the way an earlier version of this example did: `getEvidence()`
hashes the raw contents of every file under `src/**` (a cheap glob walk +
`sha256`, never a parse) and only serves the committed
`docs/data.evidence.json` when that hash matches the one recorded
alongside it. A hash of *output* can't do this cheaply -- recomputing it
would mean re-running the exact analysis being skipped -- so the check is
over raw source bytes plus the installed `data-cap` version, both readable
without a single AST node built. On a mismatch (or a missing cache) it
falls back to a real `computeDataArtifacts()` call and says so out loud,
never silently. "Every report comes from the same source of truth" is a
provable fact about this code (one shared cache, one fallback path) -- not
a claim this README makes on its own.

## The CI-configuration guard, proven against a real gap

`npm run guard` runs `data-cap --strict-docs` against Atlas's own,
fully-documented capabilities -- and passes cleanly, because there's
nothing for it to catch here. That alone doesn't prove the guard *works*,
only that nothing's currently broken -- so `main-headless.ts`'s own final
section builds a small synthetic capability in a real temp directory (no
declared `owner`, a sensitive field with an undeclared-`handling`
boundary-crossing endpoint) and asserts `generateDataArtifacts()` genuinely
throws `DataProjectGenerationError` under `--strict-docs` and, separately,
under `--strict-flow` -- the same function `npm run guard`'s own CLI
invocation calls, proven to actually block what it claims to block.

## Run it

```sh
npm install
npm start
```

`npm start` is headless: boots a real embedded MongoDB
(`mongodb-memory-server`) and a real HTTP+SSE server in-process, runs real
`node:assert/strict` checks against the actual built `@maverickcer/data-cap`
package -- including generating both reports and proving the CI guard --
for real, every run.

```sh
npm run dev
```

Boots the real, interactive TanStack Start app (the same HTTP+SSE handler,
registered as Vite dev-server middleware) for browser-based verification --
additive, not exercised by `npm start`/CI. Register an account, open a
project, issue an invoice, and dispute it to see the live SSE sync.

## What it proves

- Three independently-owned capabilities (`identityData`/`projectsData`/
  `billingData`) against one real running service, each with its own
  `documentData()` governance declarations.
- A field's declared `handling` at every endpoint it crosses renders as a
  real, source-grounded lifecycle table in `reports/litigation-evidence.ts`
  -- never a claim of actual encryption/redaction, only what was declared.
- The same uncited-dynamic-access utility produces two different, honest
  outcomes for two different fields (`"declared-dynamic"` vs.
  `"indeterminate"`) depending only on whether a citation exists --
  demonstrated against the real source, not asserted in prose.
- `--strict-docs`/`--strict-flow` genuinely block a real governance gap
  (`DataProjectGenerationError`), proven against a synthetic fixture built
  fresh every run, not just documented as a flag that exists.
- Two subscribers to the same project's invoices share one real SSE
  connection -- proven against the server's own subscriber count, not
  client-side `.info` (an array field's own subscription status isn't
  meaningful -- see `billing.capability.ts`'s own comment).

## Generated reports

```sh
npm run docs     # regenerate manifest/DATA.md/OWNERSHIP.md/flow diagrams/data.evidence.json
npm run reports  # regenerate reports/litigation-evidence.{md,json} and audit-prep.{md,json}
npm run check    # verify every committed artifact above matches a fresh generation (no write)
npm run guard    # data-cap --strict-docs against Atlas's own capabilities (passes cleanly)
```

`docs/data.evidence.json` (written by `npm run docs`'s own `--evidence` flag)
is the composed `EvidenceModel` (ADR 0050/0054) both report scripts above
read directly, via `computeDataArtifacts()` -- see "One shared source, not
two independently-assembled pipelines" above.

See [`specs/generated-artifacts.md`](../../specs/generated-artifacts.md)
for what every generated artifact does and doesn't claim, and
[`specs/decisions/0050-fact-model-architecture.md`](../../specs/decisions/0050-fact-model-architecture.md)
through
[`0053`](../../specs/decisions/0053-developer-declared-dynamic-access-citations.md),
and
[`0054`](../../specs/decisions/0054-evidence-model-as-orchestrator-backbone.md)
for the design history behind both report generators.

## Where to go next

- [`../application/`](../application) -- the first tier: one capability,
  the full individual-developer feature surface, no composition yet.
- [`../team-service/`](../team-service) -- the second tier: capability
  composition and a duplicate-endpoint finding, within one team.
- [`../../test/integration/subscriptions/socket-io-subscription/`](../../test/integration/subscriptions/socket-io-subscription)
  -- the same "wire a real transport into `acquireSubscription`" pattern,
  for Socket.IO instead of SSE.
