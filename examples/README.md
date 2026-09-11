# Examples

Three real, standalone npm projects, each depending on the root package via
`"data-cap": "file:../.."`. npm installs a `file:` dependency
pointing at a local directory as a symlink back to that directory (not a
filtered, packed copy), so each example always runs against whatever
`npm run build` at the repo root most recently produced -- run `npm run
build` again after a source change and every already-installed example
picks it up without reinstalling. `npm ci` at the repo root does **not**
install these; CI's `examples` job (`.github/workflows/ci.yml`) does, one at
a time, after building the root package first.

## Three questions, three places to look

This directory answers exactly one question: **"why would I use data-cap?"**
Two other, genuinely different questions are answered elsewhere, on purpose
-- collapsing all three into one flat pile of demos is what this directory
used to be, and why it no longer is:

- **`examples/`** (here) -- a human deciding whether/how to adopt data-cap.
  Three examples, telling one story that grows, rather than three unrelated
  demos or a feature checklist.
- **[`test/integration/`](../test/integration/README.md)** -- "does data-cap
  actually work?" The 16 focused regression fixtures that used to live here,
  each proving one specific mechanism (dedup, cache, retry, subscription
  sharing, path-alias resolution, and so on) against the real, built
  package.
- **`test/core/`, `test/build/`, `test/runtime/`** -- unit tests answering
  "are the individual mechanisms correct?", independent of any end-to-end
  story.

## One system, growing

These three examples are not three unrelated demos at increasing difficulty.
They're the same kind of work-management system, at three real scales, in
the order an organization actually grows into them:

| Tier | Directory | Scale | The question it answers |
| --- | --- | --- | --- |
| 1 | [`application/`](application) -- Task Manager | One developer | Is *my* data access correct? Loading/error/success, optimistic updates, retry, dedup, caching -- the individual-developer feature surface, on one capability. |
| 2 | [`team-service/`](team-service) -- Project Management Service | One team | Do *our* data capabilities compose without silently duplicating work? Capability-per-file ownership, real cross-capability composition that stays analyzable, a real duplicate-network-fetch finding. |
| 3 | [`enterprise-platform/`](enterprise-platform) -- Atlas | An organization | Can we *prove*, to someone who wasn't in the room, what data exists, how it's handled, and where the governance gaps actually are? Three independently-owned capabilities, a real running service, and generated litigation-evidence/audit-prep reports. |

Tier 2 is what Tier 1 becomes once a second developer, and a second
capability, join the picture. Tier 3 is what Tier 2 becomes once that one
team's own service becomes one of several departments' services inside a
real organization -- `examples/team-service/`'s own "project" concept is
exactly `examples/enterprise-platform/`'s `projectsData`, just no longer
the only capability in the room. Each tier keeps the mechanisms the
previous tier earned and adds only what its own scale genuinely needs, not
a checklist of remaining features.

## Not an ORM

Every one of these three examples talks to something real underneath it --
a simulated fetch in Tiers 1-2, a real MongoDB/HTTP/SSE service in Tier 3.
None of that is what data-cap *is*. data-cap has no query language, no
schema migration story, and no opinion about your database -- it sits
**above** whatever you already use to move data, describing the contract
your application code actually depends on:

```
        ┌─────────────────────────────────────────┐
        │   fields / getters / mutators /          │
        │   subscriptions  +  documentData()        │   <- what data-cap is
        │   (the declared contract + governance)    │
        └─────────────────────────────────────────┘
               ▲              ▲              ▲
               │              │              │
        ┌──────┴──────┐┌──────┴──────┐┌──────┴──────┐
        │  fetch/REST ││  MongoDB /  ││  SSE / Socket │      <- implementation
        │  (Tier 1-2) ││  Mongoose   ││  .IO (real-   │         detail, always
        │             ││  (Tier 3)   ││  time, Tier 3)│         swappable
        └─────────────┘└─────────────┘└─────────────┘
```

Swap Tier 3's MongoDB for Postgres, or its native SSE for Socket.IO (see
[`test/integration/subscriptions/socket-io-subscription/`](../test/integration/subscriptions/socket-io-subscription)),
and not one line of any `*.capability.ts` file changes -- every example's
own `src/server/`/backend module is deliberately isolated for exactly this
reason (see each example's own README). Reading these examples as "how do I
fetch data" undersells them; the actual subject is the declared contract
above the fetch, and what that contract makes provable.

## Generated documentation, not synthetic goldens

Every example commits real, `data-cap`-generated documentation --
`docs/DATA.md`, `docs/OWNERSHIP.md`, `docs/flow/*.mmd`, `docs/data.evidence.json`
(the composed `EvidenceModel`, ADR 0050/0054 -- the same one everything else
is a projection of), and (Tier 3 only) `reports/litigation-evidence.md`/
`audit-prep.md`, which read that same evidence model directly rather than
re-deriving it -- alongside its source. Two independent, complementary
regression signals, per example:

```sh
npm start   # real node:assert/strict checks against the actual built package
npm run check  # verifies the committed docs/reports above match a fresh generation
```

`npm start`'s own assertions catch a behavioral regression that trips an
`assert`; `npm run check` catches a *silent* change to what data-cap itself
generates -- an endpoint's `handling` quietly dropped, a field's
consumption status quietly flipping -- that wouldn't otherwise trip
anything. When you intentionally change observed behavior, regenerate every
installed example's committed output with:

```sh
npm run examples:update-golden
```

This is a human-invoked step, deliberately **not** part of `npm run
verify`/CI -- review the diff before committing it. The same script also
regenerates every `test/integration/` fixture's golden `output.json`
(those 16 mechanism-level fixtures are a different, synthetic-summary
convention on purpose -- see `test/integration/README.md` -- since they
exist to prove one mechanism in isolation, not to model a realistic,
reader-facing generated-docs workflow).

## Running one yourself

```sh
cd ../..            # repo root
npm run build
cd examples/<name>
npm install
npm start
```

## Client vs. server

data-cap is framework- and environment-independent -- the same `buildData`/
`createDataStore` pair (or the batteries-included `createData`) runs
identically in a browser tab talking to a REST API and in a Node server
process talking to a database. `application/` and `team-service/` are
**Client**-side (in-memory-simulated network); `enterprise-platform/` is a
real, running **Server** with a real embedded MongoDB, because Tier 3's
point is specifically to show data-cap operating inside a full service, not
another simulated fetch.

## Index

| Example | Side | Demonstrates |
| --- | --- | --- |
| [`application`](application) | Client | The batteries-included `createData` (`data-cap/runtime`) -- fields/getters/mutators/subscriptions declared together via a shared, type-checked schema; dedup, optimistic mutation + `withRetry`, request cancellation, caching |
| [`team-service`](team-service) | Client | Capability-per-file ownership; `projectData` composing `memberData` directly for a real, proven cross-capability dependency; `assignmentsData` independently duplicating the same endpoint, caught by `DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES`; identity-stable array reconciliation via `createDataStore` |
| [`enterprise-platform`](enterprise-platform) | Server | Atlas -- a real TanStack Start + MongoDB/Mongoose service with three independently-owned capabilities (`identityData`/`projectsData`/`billingData`), declared per-endpoint `handling` (plaintext/masked/redacted/hashed/encrypted) feeding a real field-lifecycle table, and two generated reports (`litigation-evidence`, `audit-prep`) plus a real `--strict-docs`/`--strict-flow` CI guard proven against a synthetic gap |

See [`test/integration/README.md`](../test/integration/README.md) for the
16 mechanism-level fixtures, and each example's own README for its full
walkthrough.
