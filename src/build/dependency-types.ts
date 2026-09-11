/**
 * The relationship vocabulary for an in-repo consumer's connection to a
 * capability -- split out from `findings.ts` so the Phase-C2-equivalent
 * static rules (exclusive-group/structural-duplication/ownership checks)
 * never need to import anything from the (heavier, file-tree-scanning)
 * usage-scan module that actually produces `DependencyEdge`s.
 *
 * A bare "A depends on B" edge collapses several genuinely distinct
 * relationships a consumer can have with a capability -- this vocabulary
 * keeps them apart instead of flattening them into one undifferentiated
 * dependency graph.
 */

import type { SourcePosition } from "./source-position.js"

export type DependencyRelationship =
  | "imports" // consumer file imports the capability, no further resolved usage
  | "reads-field" // consumer reads a specific field path
  | "calls-getter"
  | "calls-mutator"
  | "calls-subscription"

/**
 * A statically-proven connection from one consuming file to a capability
 * (or a specific field/operation on it). Unlike the declared metadata in
 * `core/document.ts` (`source`, `credentials`, `endpoints`), every
 * `DependencyEdge` is derived by AST analysis, never author-declared -- see
 * AGENTS.md's declared-vs-proven invariant. Produced by the usage-scan
 * pass (`scan-dependencies.ts`), not by this module.
 */
export interface DependencyEdge {
  /** Which kind of connection this is -- see `DependencyRelationship`. */
  readonly relationship: DependencyRelationship
  /** The consuming file, as a root-relative POSIX path (OUT-01, see `display-path.ts`). */
  readonly from: string
  /** What this edge connects to. */
  readonly to: {
    /** The capability being consumed. */
    readonly capability: {
      /** Root-relative POSIX path of the file declaring the capability -- the same value `CapabilityNode.file` publishes. */
      readonly file: string
      /** The binding name the capability is exported as. */
      readonly exportName: string
    }
    /** The specific field path being read, when `relationship` is `"reads-field"`. */
    readonly field?: readonly string[]
    /** The specific operation name being called, when `relationship` is `"calls-getter"`/`"calls-mutator"`/`"calls-subscription"`. */
    readonly operation?: string
  }
  /** Whether the consumer reference itself was unambiguously resolved -- see the usage-scan pass for what each value means. */
  readonly resolution: "resolved" | "unresolved-consumer" | "indeterminate"
  /** Position of the access site in `from` (file already known via `from`), when this edge originates from a specific identifier reference (every relationship except the file-level `"imports"` fallback edge scan-dependencies.ts synthesizes for a consumer with no further resolved usage). */
  readonly position: SourcePosition | undefined
}
