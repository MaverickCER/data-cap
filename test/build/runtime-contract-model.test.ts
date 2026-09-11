import { existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION,
  buildRuntimeContractModel,
} from "../../src/build/runtime-contract-model.js"
import { PACKAGE_VERSION } from "../../src/build/package-version.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const decisionsDir = path.resolve(here, "../../specs/decisions")

describe("buildRuntimeContractModel", () => {
  it("stamps schemaVersion and the real package version", () => {
    const model = buildRuntimeContractModel()
    expect(model.schemaVersion).toBe(1)
    expect(RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION).toBe(1)
    expect(model.schemaVersion).toBe(RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION)
    expect(model.packageVersion).toBe(PACKAGE_VERSION)
    expect(model.packageVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("carries the full, verbatim policy catalogue (pins every fact's exact wording)", () => {
    expect(buildRuntimeContractModel().policies).toMatchInlineSnapshot(`
      [
        {
          "governingAdr": "0024",
          "key": "getter-concurrency",
          "module": "src/runtime/capability.ts",
          "statement": "A getter's response is discarded if a newer call to the same operation has since started, regardless of completion order (stale-response discard by start order, not completion order).",
        },
        {
          "governingAdr": "0025",
          "key": "mutator-concurrency",
          "module": "src/runtime/capability.ts",
          "statement": "A mutator's response always commits, even if a newer call to the same operation started after it -- whichever call completes last in real time wins, deliberately unlike a getter's start-order discard.",
        },
        {
          "governingAdr": "0026",
          "key": "subscription-sharing",
          "module": "src/runtime/coordinator.ts",
          "statement": "Concurrent subscribers to the same \`subscribe\` function identity share one underlying transport connection, ref-counted; the transport tears down only once every subscriber has released, and a late joiner immediately learns the current connection status.",
        },
        {
          "governingAdr": "0029",
          "key": "subscription-disconnect-isolation",
          "module": "src/runtime/coordinator.ts",
          "statement": "A subscription's own disconnect/teardown never mutates \`fields\` -- only an incoming event, processed through the operation's \`processor\`, can.",
        },
        {
          "governingAdr": "0028",
          "key": "coordinator-dedup-key",
          "module": "src/runtime/coordinator.ts",
          "statement": "Concurrent calls share one in-flight execution only when both the called function's own identity and their canonicalized params match -- never structural/behavioral equality, and never merely the same operation name.",
        },
        {
          "governingAdr": "0008",
          "key": "atomic-commit",
          "module": "src/runtime/store.ts",
          "statement": "\`fields\` and \`info\` are always committed and published as one atomic snapshot -- no code path may update them independently or in separate ticks; a consumer never observes a stale pairing of the two.",
        },
        {
          "governingAdr": "0021",
          "key": "authoritative-pending-projection",
          "module": "src/runtime/store.ts",
          "statement": "Every observable state is \`project(authoritativeState, pendingTransitions)\`, recomputed fresh on every read, never cached -- authoritative and optimistic-pending state are stored separately and only ever folded together for observation.",
        },
        {
          "governingAdr": "0023",
          "key": "no-automatic-rollback",
          "module": "src/runtime/store.ts",
          "statement": "A failed mutation never automatically reverts a previously-committed value and never invents conflict resolution between concurrent writers -- recovery is always the caller's own responsibility.",
        },
        {
          "governingAdr": "0016",
          "key": "data-status-state-machine",
          "module": "src/core/types.ts",
          "statement": "A field's \`status\` is one of exactly \`idle\`/\`loading\`/\`success\`/\`error\`/\`retrying\` -- \`retrying\` is reserved for a recovering-after-failure attempt, distinct from a field's first-ever \`loading\` attempt.",
        },
        {
          "governingAdr": "0015",
          "key": "data-error-latest-only",
          "module": "src/core/types.ts",
          "statement": "A field's \`error\` is always the single latest error from its establishing operation, never a history/array -- it clears on the next successful establishing operation unless a still-newer operation has since set a different one.",
        },
        {
          "governingAdr": "0035",
          "key": "cache-contract",
          "module": "src/runtime/cache.ts",
          "statement": "The optional \`./runtime/cache\` module caches a complete \`DataState\` (\`fields\` + \`info\`) as one atomic unit, never \`fields\` alone and never a raw, unvalidated response -- a bounded, least-recently-used-eviction cache keyed by an opaque caller-computed string.",
        },
        {
          "governingAdr": "0036",
          "key": "retry-contract",
          "module": "src/runtime/retry.ts",
          "statement": "The optional \`./runtime/retry\` module is opt-in and abort-aware: it never retries automatically, never retries past the caller's own \`AbortSignal\`, never exceeds \`maxAttempts\`, and never assumes a mutation is idempotent -- the caller's own \`shouldRetry\` predicate decides what's worth retrying.",
        },
      ]
    `)
  })

  it("returns the same policies array shape on every call -- package-level, not per-project", () => {
    const a = buildRuntimeContractModel()
    const b = buildRuntimeContractModel()
    expect(a.policies).toEqual(b.policies)
    expect(a.packageVersion).toBe(b.packageVersion)
  })

  it("declares at least one policy fact", () => {
    expect(buildRuntimeContractModel().policies.length).toBeGreaterThan(0)
  })

  it("every policy has a unique key", () => {
    const keys = buildRuntimeContractModel().policies.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("every governingAdr resolves to a real file under specs/decisions/ (catches ADR renumbering drift)", () => {
    const decisionFiles = readdirSync(decisionsDir)
    for (const policy of buildRuntimeContractModel().policies) {
      const match = decisionFiles.find((f) => f.startsWith(`${policy.governingAdr}-`))
      expect(
        match,
        `policy "${policy.key}" claims ADR ${policy.governingAdr}, but no file under specs/decisions/ starts with "${policy.governingAdr}-"`,
      ).toBeDefined()
    }
  })

  it("every referenced module file actually exists in the repository", () => {
    const projectRoot = path.resolve(here, "../..")
    for (const policy of buildRuntimeContractModel().policies) {
      expect(
        existsSync(path.join(projectRoot, policy.module)),
        `policy "${policy.key}" references module "${policy.module}", which does not exist`,
      ).toBe(true)
    }
  })
})
