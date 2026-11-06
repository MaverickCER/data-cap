/**
 * `data-cap`'s Policy Model (ADR 0070, ADR 0071) -- declared data-flow rules
 * and their evaluation against the Flow Model. A rule says which fields it
 * applies to (by classification or exact field) and what it requires of
 * every boundary those fields reach: kinds that are forbidden, an allow-list
 * of kinds, and/or a required handling at the crossing.
 *
 * Evaluation never over-claims. A rule that matches no field is reported
 * `indeterminate` (a typo'd rule must not pass silently); a trace that
 * crosses an `unknown` fact adds an `indeterminate` result alongside any
 * other outcome (the real flow may reach further than the graph shows); a
 * crossing with no declared handling is `indeterminate` against a
 * required-handling rule, never `violated` or `satisfied`. Each result
 * records the weakest epistemic status along its path as its `basis`, so a
 * violation resting on an inferred edge says so.
 *
 * Pure -- no filesystem access. Generalizes `flow-graph.ts`'s single
 * `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY` check into declared rules.
 */

import { compareById, FlowModelError } from "./flow-model.js"
import type {
  FlowBoundaryKind,
  FlowHandling,
  FlowModel,
  FlowNode,
  FlowStatus,
} from "./flow-model.js"
import { flowPathTo, traceFlow, weakestStatus } from "./flow-projections.js"
import type { CapabilityInventory } from "../build/inventory.js"

/** Bump only when a reader could misinterpret the shape. */
export const POLICY_MODEL_SCHEMA_VERSION = 1

/** Which fields a rule applies to; every supplied criterion must match, and at least one is required. */
export interface FlowPolicyAppliesTo {
  /** Exact match against a field node's `classification`. */
  readonly classification?: string | undefined
  /** Exact match against a field node's `name` (for example `User.email`). */
  readonly field?: string | undefined
  /** Restricts the rule to fields declared in this file (a root-relative path); never sufficient on its own. */
  readonly scope?: string | undefined
  /** Narrows the rule to one path inside each matching field (for example `["passwordHash"]`): only flow of that path, or of the whole field, counts. */
  readonly path?: readonly string[] | undefined
}

/** One declared data-flow rule. At least one constraint must be set. */
export interface FlowPolicyRule {
  /** Unique, stable identifier. */
  readonly id: string
  /** Which fields this rule governs. */
  readonly appliesTo: FlowPolicyAppliesTo
  /** Boundary kinds the governed fields must never reach. */
  readonly forbidDestinations?: readonly FlowBoundaryKind[] | undefined
  /** If set, the only boundary kinds the governed fields may reach. */
  readonly allowedDestinations?: readonly FlowBoundaryKind[] | undefined
  /** Handling that exempts a crossing from `forbidDestinations`/`allowedDestinations`. */
  readonly allowedHandling?: readonly FlowHandling[] | undefined
  /** If set, every boundary crossing of a governed field must declare one of these handlings. */
  readonly requireHandling?: readonly FlowHandling[] | undefined
  /** Free-text rationale, carried through verbatim. */
  readonly description?: string | undefined
}

/** How a rule fared against one field (and, when relevant, one boundary). */
export type PolicyOutcome = "satisfied" | "violated" | "indeterminate"

/** Why a result is `indeterminate`. */
export type PolicyIndeterminateReason =
  "rule-matches-nothing" | "trace-incomplete" | "handling-not-declared" | "boundary-kind-unknown"

/** One evaluation result. */
export interface PolicyResult {
  readonly ruleId: string
  /** Id of the field node the rule was evaluated for; absent only for `rule-matches-nothing`. */
  readonly subject?: string
  /** Id of the boundary node this result concerns; absent when none was reached or the result is about the trace as a whole. */
  readonly boundary?: string
  readonly outcome: PolicyOutcome
  /** Present exactly when `outcome` is `indeterminate`. */
  readonly reason?: PolicyIndeterminateReason
  /** The weakest epistemic status of the edges the result rests on (`unknown` for an indeterminate result). */
  readonly basis: FlowStatus
  /** Ids of the edges on the path that justifies this result. */
  readonly edges: readonly string[]
}

/** Counts by outcome. */
export interface PolicySummary {
  readonly satisfied: number
  readonly violated: number
  readonly indeterminate: number
}

/** `data-cap`'s Policy Model. */
export interface PolicyModel {
  /** Always `POLICY_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof POLICY_MODEL_SCHEMA_VERSION
  /** The declared rules, ordered by id. */
  readonly rules: readonly FlowPolicyRule[]
  /** Every evaluation result, ordered by rule, subject, boundary. */
  readonly results: readonly PolicyResult[]
  /** Counts by outcome. */
  readonly summary: PolicySummary
}

function validate(rules: readonly FlowPolicyRule[]): void {
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new FlowModelError(`Duplicate policy rule id "${rule.id}".`)
    seen.add(rule.id)
    if (rule.appliesTo.classification === undefined && rule.appliesTo.field === undefined) {
      throw new FlowModelError(
        `Policy rule "${rule.id}" must set appliesTo.classification or appliesTo.field.`,
      )
    }
    if (rule.appliesTo.path?.length === 0) {
      throw new FlowModelError(
        `Policy rule "${rule.id}" has an empty appliesTo.path; omit it to govern the whole field.`,
      )
    }
    const constrains =
      (rule.forbidDestinations?.length ?? 0) > 0 ||
      rule.allowedDestinations !== undefined ||
      rule.requireHandling !== undefined
    if (!constrains) {
      throw new FlowModelError(
        `Policy rule "${rule.id}" does not constrain anything: set forbidDestinations, allowedDestinations or requireHandling.`,
      )
    }
  }
}

function matches(node: FlowNode, appliesTo: FlowPolicyAppliesTo): boolean {
  if (node.kind !== "field") return false
  if (appliesTo.classification !== undefined && node.classification !== appliesTo.classification) {
    return false
  }
  if (appliesTo.field !== undefined && node.name !== appliesTo.field) return false
  if (appliesTo.scope !== undefined && node.scope !== appliesTo.scope) return false
  return true
}

/** The verdict of one rule against one crossing. */
export interface PolicyVerdict {
  readonly outcome: PolicyOutcome
  readonly reason?: PolicyIndeterminateReason
}

function outcomeRank(outcome: PolicyOutcome): number {
  const rank: Readonly<Record<PolicyOutcome, number>> = {
    satisfied: 0,
    indeterminate: 1,
    violated: 2,
  }
  return rank[outcome]
}

/**
 * Judges one rule against one boundary crossing, given the boundary's kind
 * (`undefined` when unknown) and the declared handling of each edge that
 * crosses into it (`undefined` for an edge that declares none). Shared by
 * static evaluation and by the Claims Model's check of observed crossings.
 * Returns `undefined` when the rule does not concern this boundary.
 */
export function judgeCrossing(
  rule: FlowPolicyRule,
  kind: FlowBoundaryKind | undefined,
  handlings: readonly (FlowHandling | undefined)[],
): PolicyVerdict | undefined {
  const verdicts: PolicyVerdict[] = []
  const kindRules =
    (rule.forbidDestinations?.length ?? 0) > 0 || rule.allowedDestinations !== undefined

  if (kindRules) {
    if (kind === undefined) {
      verdicts.push({ outcome: "indeterminate", reason: "boundary-kind-unknown" })
    } else {
      const forbidden = rule.forbidDestinations?.includes(kind) === true
      const outsideAllowList =
        rule.allowedDestinations !== undefined && !rule.allowedDestinations.includes(kind)
      if (forbidden || rule.allowedDestinations !== undefined) {
        const { allowedHandling } = rule
        const exempt =
          allowedHandling !== undefined &&
          handlings.length > 0 &&
          handlings.every(
            (handling) => handling !== undefined && allowedHandling.includes(handling),
          )
        verdicts.push({
          outcome: (forbidden || outsideAllowList) && !exempt ? "violated" : "satisfied",
        })
      }
    }
  }

  if (rule.requireHandling !== undefined) {
    const required = rule.requireHandling
    if (handlings.some((handling) => handling !== undefined && !required.includes(handling))) {
      verdicts.push({ outcome: "violated" })
    } else if (handlings.some((handling) => handling === undefined)) {
      verdicts.push({ outcome: "indeterminate", reason: "handling-not-declared" })
    } else {
      verdicts.push({ outcome: "satisfied" })
    }
  }

  if (verdicts.length === 0) return undefined
  return verdicts.reduce((worst, next) =>
    outcomeRank(next.outcome) > outcomeRank(worst.outcome) ? next : worst,
  )
}

function evaluateField(flow: FlowModel, rule: FlowPolicyRule, subject: FlowNode): PolicyResult[] {
  const trace = traceFlow(flow, subject.id, "downstream", { path: rule.appliesTo.path })
  const results: PolicyResult[] = []

  for (const boundary of trace.nodes.filter((node) => node.kind === "boundary")) {
    const crossing = trace.edges.filter((edge) => edge.to === boundary.id)
    const verdict = judgeCrossing(
      rule,
      boundary.boundaryKind,
      crossing.map((edge) => edge.handling),
    )
    if (verdict === undefined) continue
    const path = flowPathTo(trace, subject.id, boundary.id)
    results.push({
      ruleId: rule.id,
      subject: subject.id,
      boundary: boundary.id,
      outcome: verdict.outcome,
      ...(verdict.reason === undefined ? {} : { reason: verdict.reason }),
      basis:
        verdict.outcome === "indeterminate"
          ? "unknown"
          : weakestStatus(path.map((edge) => edge.status)),
      edges: path.map((edge) => edge.id),
    })
  }

  // Results are ordered by rule, subject, boundary: a result about the trace as a whole has no boundary, so it comes
  // before the per-boundary ones.
  if (!trace.complete) {
    return [
      {
        ruleId: rule.id,
        subject: subject.id,
        outcome: "indeterminate",
        reason: "trace-incomplete",
        basis: "unknown",
        edges: [],
      },
      ...results,
    ]
  }
  if (results.length === 0) {
    return [
      {
        ruleId: rule.id,
        subject: subject.id,
        outcome: "satisfied",
        basis: weakestStatus(trace.edges.map((edge) => edge.status)),
        edges: [],
      },
    ]
  }
  return results
}

/** Validates `rules` and evaluates every one against `flow`. */
export function buildPolicyModel(flow: FlowModel, rules: readonly FlowPolicyRule[]): PolicyModel {
  validate(rules)
  const ordered = [...rules].sort(compareById)
  const results: PolicyResult[] = []

  for (const rule of ordered) {
    const subjects = flow.nodes.filter((node) => matches(node, rule.appliesTo))
    if (subjects.length === 0) {
      results.push({
        ruleId: rule.id,
        outcome: "indeterminate",
        reason: "rule-matches-nothing",
        basis: "unknown",
        edges: [],
      })
      continue
    }
    for (const subject of subjects) results.push(...evaluateField(flow, rule, subject))
  }

  return {
    schemaVersion: POLICY_MODEL_SCHEMA_VERSION,
    rules: ordered,
    results,
    summary: {
      satisfied: results.filter((r) => r.outcome === "satisfied").length,
      violated: results.filter((r) => r.outcome === "violated").length,
      indeterminate: results.filter((r) => r.outcome === "indeterminate").length,
    },
  }
}

/**
 * Gathers every active capability's declared `flowPolicy` (ADR 0070) into
 * rules for `buildPolicyModel`. Each rule is scoped to the capability that
 * declared it (`appliesTo.scope` is its file; `appliesTo.field` is qualified
 * with its export name) and its id is namespaced (`exportName/id`), so two
 * capabilities can reuse a name and a rule can never govern another
 * capability's fields.
 */
export function collectFlowPolicyRules(inventory: CapabilityInventory): readonly FlowPolicyRule[] {
  const rules: FlowPolicyRule[] = []
  for (const capability of inventory.capabilities) {
    if (!capability.active) continue
    for (const declared of capability.docs?.flowPolicy ?? []) {
      const { appliesTo } = declared
      rules.push({
        id: `${capability.exportName}/${declared.id}`,
        appliesTo: {
          ...(appliesTo.classification === undefined
            ? {}
            : { classification: appliesTo.classification }),
          ...(appliesTo.field === undefined
            ? {}
            : { field: `${capability.exportName}.${appliesTo.field}` }),
          ...(appliesTo.path === undefined ? {} : { path: appliesTo.path }),
          scope: capability.file,
        },
        ...(declared.description === undefined ? {} : { description: declared.description }),
        ...(declared.forbidDestinations === undefined
          ? {}
          : { forbidDestinations: declared.forbidDestinations }),
        ...(declared.allowedDestinations === undefined
          ? {}
          : { allowedDestinations: declared.allowedDestinations }),
        ...(declared.allowedHandling === undefined
          ? {}
          : { allowedHandling: declared.allowedHandling }),
        ...(declared.requireHandling === undefined
          ? {}
          : { requireHandling: declared.requireHandling }),
      })
    }
  }
  return rules
}
