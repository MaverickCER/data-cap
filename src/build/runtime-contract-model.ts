/**
 * `data-cap`'s Runtime Contract Model (ADR 0050) -- the one canonical
 * model with no `env-cap` equivalent, because `env-cap` has no runtime
 * package at all. A versioned, hand-maintained description of `data-cap`'s
 * own documented execution guarantees (concurrency, subscription sharing,
 * dedup, atomic commit, cache/retry contracts), each fact cross-referenced
 * to the ADR that governs it.
 *
 * Architecturally different from the other six models: it describes the
 * `data-cap` package itself, not a specific consumer's capability files, so
 * it's versioned to the package's own version -- `buildRuntimeContractModel()`
 * takes no consumer-project argument at all, and is identical for every
 * caller on the same `data-cap` version. A future Evidence Model composing
 * this alongside the six project-varying models must treat it as a static
 * append, never a diffable "changed since last run" input -- there is no
 * "previous run" for this model in the sense the other six have one.
 */

import { PACKAGE_VERSION } from "./package-version.js"

/** Bump only when a reader could misinterpret the shape -- same discipline every other model's schema-version constant already documents. */
export const RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION = 1

/** One documented runtime guarantee, traced to the ADR that governs it. */
export interface RuntimePolicyFact {
  /** A short, stable identifier for this fact (e.g. `"getter-concurrency"`). */
  readonly key: string
  /** Human-readable statement of the guarantee. */
  readonly statement: string
  /** The ADR number (e.g. `"0024"`) that governs this fact -- always a real file under `specs/decisions/`. */
  readonly governingAdr: string
  /** The source file that implements this guarantee, root-relative. */
  readonly module: string
}

/** `data-cap`'s Runtime Contract Model: the package's own documented execution guarantees. */
export interface RuntimeContractModel {
  /** Always `RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION
  /** The `data-cap` package version this model describes -- read from `package.json`, the same way `cli/json.ts`'s `TOOL_VERSION` is. */
  readonly packageVersion: string
  /** Every documented runtime policy fact. */
  readonly policies: readonly RuntimePolicyFact[]
}

/**
 * The catalogue itself. Built inside a function (not a module-level `const`)
 * so each fact's wording is a normal, test-attributable value rather than a
 * load-time constant Stryker's coverage analysis cannot pin.
 */
function runtimePolicyFacts(): readonly RuntimePolicyFact[] {
  return [
    {
      key: "getter-concurrency",
      statement:
        "A getter's response is discarded if a newer call to the same operation has since started, regardless of completion order (stale-response discard by start order, not completion order).",
      governingAdr: "0024",
      module: "src/runtime/capability.ts",
    },
    {
      key: "mutator-concurrency",
      statement:
        "A mutator's response always commits, even if a newer call to the same operation started after it -- whichever call completes last in real time wins, deliberately unlike a getter's start-order discard.",
      governingAdr: "0025",
      module: "src/runtime/capability.ts",
    },
    {
      key: "subscription-sharing",
      statement:
        "Concurrent subscribers to the same `subscribe` function identity share one underlying transport connection, ref-counted; the transport tears down only once every subscriber has released, and a late joiner immediately learns the current connection status.",
      governingAdr: "0026",
      module: "src/runtime/coordinator.ts",
    },
    {
      key: "subscription-disconnect-isolation",
      statement:
        "A subscription's own disconnect/teardown never mutates `fields` -- only an incoming event, processed through the operation's `processor`, can.",
      governingAdr: "0029",
      module: "src/runtime/coordinator.ts",
    },
    {
      key: "coordinator-dedup-key",
      statement:
        "Concurrent calls share one in-flight execution only when both the called function's own identity and their canonicalized params match -- never structural/behavioral equality, and never merely the same operation name.",
      governingAdr: "0028",
      module: "src/runtime/coordinator.ts",
    },
    {
      key: "atomic-commit",
      statement:
        "`fields` and `info` are always committed and published as one atomic snapshot -- no code path may update them independently or in separate ticks; a consumer never observes a stale pairing of the two.",
      governingAdr: "0008",
      module: "src/runtime/store.ts",
    },
    {
      key: "authoritative-pending-projection",
      statement:
        "Every observable state is `project(authoritativeState, pendingTransitions)`, recomputed fresh on every read, never cached -- authoritative and optimistic-pending state are stored separately and only ever folded together for observation.",
      governingAdr: "0021",
      module: "src/runtime/store.ts",
    },
    {
      key: "no-automatic-rollback",
      statement:
        "A failed mutation never automatically reverts a previously-committed value and never invents conflict resolution between concurrent writers -- recovery is always the caller's own responsibility.",
      governingAdr: "0023",
      module: "src/runtime/store.ts",
    },
    {
      key: "data-status-state-machine",
      statement:
        "A field's `status` is one of exactly `idle`/`loading`/`success`/`error`/`retrying` -- `retrying` is reserved for a recovering-after-failure attempt, distinct from a field's first-ever `loading` attempt.",
      governingAdr: "0016",
      module: "src/core/types.ts",
    },
    {
      key: "data-error-latest-only",
      statement:
        "A field's `error` is always the single latest error from its establishing operation, never a history/array -- it clears on the next successful establishing operation unless a still-newer operation has since set a different one.",
      governingAdr: "0015",
      module: "src/core/types.ts",
    },
    {
      key: "cache-contract",
      statement:
        "The optional `./runtime/cache` module caches a complete `DataState` (`fields` + `info`) as one atomic unit, never `fields` alone and never a raw, unvalidated response -- a bounded, least-recently-used-eviction cache keyed by an opaque caller-computed string.",
      governingAdr: "0035",
      module: "src/runtime/cache.ts",
    },
    {
      key: "retry-contract",
      statement:
        "The optional `./runtime/retry` module is opt-in and abort-aware: it never retries automatically, never retries past the caller's own `AbortSignal`, never exceeds `maxAttempts`, and never assumes a mutation is idempotent -- the caller's own `shouldRetry` predicate decides what's worth retrying.",
      governingAdr: "0036",
      module: "src/runtime/retry.ts",
    },
  ]
}

/**
 * Builds `data-cap`'s Runtime Contract Model. Takes no consumer-project
 * argument -- unlike the other six models, this one describes the
 * `data-cap` package itself, and is identical for every caller on the same
 * package version.
 */
export function buildRuntimeContractModel(): RuntimeContractModel {
  return {
    schemaVersion: RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION,
    packageVersion: PACKAGE_VERSION,
    policies: runtimePolicyFacts(),
  }
}
