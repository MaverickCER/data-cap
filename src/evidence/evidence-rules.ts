/**
 * Deterministic CI rules evaluated over the one Evidence Model (ADR 0070):
 * the gate between "the analysis ran" and "the build may proceed". A rule set
 * is plain JSON; the evaluator is a pure function of the evidence, so the same
 * evidence and rules always give the same verdict, anywhere.
 *
 * Two principles shape it.
 *
 * - **A gate must fail closed.** A rule that needs analysis which did not run
 *   (no flow, no policy, no observations) is a violation that says so -- never
 *   a pass. A check that succeeds because its input is missing is not a check.
 * - **A misspelled rule must not silently pass.** An unknown key, a wrong type
 *   or an empty rule set is rejected by name when the rules are parsed.
 *
 * Isomorphic: runs in CI, an edge function or a dashboard over a deserialized
 * evidence file.
 */

import type { EvidenceModel } from "../build/evidence-model.js"
import type { EvidenceRef } from "../flow/claims-model.js"
import { analyzeLeastData } from "../flow/least-data.js"

/** The rules a gate can enforce. Each is optional; at least one is required. */
export interface EvidenceRules {
  /** No declared flow policy is violated. */
  readonly noPolicyViolations?: boolean
  /** Every declared flow policy could be decided (none is left `indeterminate`). */
  readonly noIndeterminatePolicies?: boolean
  /** At most this many claims are contradicted by evidence. */
  readonly maxContradictedClaims?: number
  /** The flow analysis left at most this many unknowns (parts of the program it could not follow). */
  readonly maxUnknowns?: number
  /** The flow analysis is complete: nothing was left unfollowed. */
  readonly requireComplete?: boolean
  /** At most this many paths of a sensitive field are never read, forwarded or sent. */
  readonly maxUnusedSensitivePaths?: number
  /** At most this many multi-key fields are sent whole to a client response. */
  readonly maxWholeFieldToClient?: number
  /** Runtime observations were ingested and there is at least one. */
  readonly requireObservations?: boolean
  /** At least this many claims are verified (static or declared, corroborated by an observation). */
  readonly minVerifiedClaims?: number
  /** Each named policy rule (by id) has every one of its claims verified -- held statically and corroborated at runtime. */
  readonly requireVerified?: readonly string[]
}

/** Every rule name the evaluator understands, in the order they are evaluated. */
export const EVIDENCE_RULE_NAMES = [
  "noPolicyViolations",
  "noIndeterminatePolicies",
  "maxContradictedClaims",
  "maxUnknowns",
  "requireComplete",
  "maxUnusedSensitivePaths",
  "maxWholeFieldToClient",
  "requireObservations",
  "minVerifiedClaims",
  "requireVerified",
] as const satisfies readonly (keyof EvidenceRules)[]

/** One reason the gate did not pass. */
export interface EvidenceRuleViolation {
  /** Which rule. */
  readonly rule: (typeof EVIDENCE_RULE_NAMES)[number]
  readonly message: string
  /** The records in the evidence this rests on, for drill-down. */
  readonly evidence: readonly EvidenceRef[]
}

/** The verdict. */
export interface EvidenceRulesResult {
  /** True exactly when there are no violations. */
  readonly ok: boolean
  /** The rules that were evaluated, in order. */
  readonly evaluated: readonly (typeof EVIDENCE_RULE_NAMES)[number][]
  readonly violations: readonly EvidenceRuleViolation[]
}

/** The result of parsing a rules document. */
export type ParsedEvidenceRules =
  | { readonly ok: true; readonly rules: EvidenceRules }
  | { readonly ok: false; readonly errors: readonly string[] }

const BOOLEAN_RULES: ReadonlySet<string> = new Set([
  "noPolicyViolations",
  "noIndeterminatePolicies",
  "requireComplete",
  "requireObservations",
])
const COUNT_RULES: ReadonlySet<string> = new Set([
  "maxContradictedClaims",
  "maxUnknowns",
  "maxUnusedSensitivePaths",
  "maxWholeFieldToClient",
  "minVerifiedClaims",
])

/** Parses a rules document (JSON text), rejecting anything it does not fully understand. */
export function parseEvidenceRules(text: string): ParsedEvidenceRules {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, errors: ["The rules are not valid JSON."] }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, errors: ["The rules must be a JSON object."] }
  }
  const errors: string[] = []
  const rules: Record<string, unknown> = {}
  for (const [name, setting] of Object.entries(value)) {
    if (BOOLEAN_RULES.has(name)) {
      if (typeof setting === "boolean") rules[name] = setting
      else errors.push(`"${name}" must be true or false.`)
    } else if (COUNT_RULES.has(name)) {
      if (typeof setting === "number" && setting % 1 === 0 && setting >= 0) rules[name] = setting
      else errors.push(`"${name}" must be a non-negative whole number.`)
    } else if (name === "requireVerified") {
      if (
        Array.isArray(setting) &&
        setting.length > 0 &&
        setting.every((item) => typeof item === "string" && item.length > 0)
      )
        rules[name] = setting
      else errors.push(`"requireVerified" must be a non-empty array of policy rule ids.`)
    } else {
      errors.push(`"${name}" is not a rule. Rules are: ${EVIDENCE_RULE_NAMES.join(", ")}.`)
    }
  }
  if (errors.length === 0 && Object.keys(rules).length === 0) {
    errors.push(
      `The rules set no rules; a gate with no rules passes everything. Set at least one of: ${EVIDENCE_RULE_NAMES.join(", ")}.`,
    )
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, rules: rules }
}

/** What the evaluator reads from the Evidence Model. */
export type EvidenceRulesInput = Pick<
  EvidenceModel,
  "capability" | "flow" | "policy" | "claims" | "observation" | "computed"
>

/** The ceiling a `max*` rule sets. Only read where that rule is set, so the fallback (no ceiling) is never the answer. */
function ceiling(
  rules: EvidenceRules,
  name:
    "maxContradictedClaims" | "maxUnknowns" | "maxUnusedSensitivePaths" | "maxWholeFieldToClient",
): number {
  return rules[name] ?? Number.POSITIVE_INFINITY
}

/** The floor `minVerifiedClaims` sets. */
function floor(rules: EvidenceRules): number {
  return rules.minVerifiedClaims ?? 0
}

const NOT_COMPUTED = "the flow analysis was not computed; run with --flow-evidence"

type RuleName = (typeof EVIDENCE_RULE_NAMES)[number]

/** What one rule check reads and reports to. */
interface RuleContext {
  readonly evidence: EvidenceRulesInput
  readonly rules: EvidenceRules
  readonly fail: (rule: RuleName, message: string, refs?: readonly EvidenceRef[]) => void
}

/** A rule that needs analysis that did not run is a violation, never a pass. */
function failNotComputed(context: RuleContext, rule: RuleName): void {
  context.fail(rule, `${rule} could not be evaluated: ${NOT_COMPUTED}.`)
}

function checkPolicy(
  context: RuleContext,
  rule: "noPolicyViolations" | "noIndeterminatePolicies",
): void {
  const { policy, flow } = context.evidence
  if (policy === undefined || flow === undefined) {
    if (context.rules[rule]) failNotComputed(context, rule)
    return
  }
  if (!context.rules[rule]) return
  const wanted = rule === "noPolicyViolations" ? "violated" : "indeterminate"
  for (const result of policy.results.filter((item) => item.outcome === wanted)) {
    const where = result.subject === undefined ? "" : ` for ${result.subject}`
    const why = result.reason === undefined ? "" : ` (${result.reason})`
    context.fail(
      rule,
      `Rule ${result.ruleId} is ${wanted}${where}${why}.`,
      result.subject === undefined
        ? []
        : [
            { model: "policy", id: `${result.ruleId}#${result.subject}` },
            ...result.edges.map((id) => ({ model: "flow" as const, id })),
          ],
    )
  }
}

function checkMaxContradictedClaims(context: RuleContext): void {
  const { claims } = context.evidence
  if (claims === undefined) {
    failNotComputed(context, "maxContradictedClaims")
    return
  }
  const bad = claims.claims.filter((claim) => claim.verification === "contradicted")
  if (bad.length > ceiling(context.rules, "maxContradictedClaims")) {
    context.fail(
      "maxContradictedClaims",
      `${bad.length} claim(s) are contradicted by evidence; at most ${context.rules.maxContradictedClaims} allowed: ${bad.map((claim) => claim.statement).join("; ")}.`,
      bad.flatMap((claim) => claim.contradicting),
    )
  }
}

function checkMinVerifiedClaims(context: RuleContext): void {
  const { claims } = context.evidence
  if (claims === undefined) {
    failNotComputed(context, "minVerifiedClaims")
    return
  }
  if (claims.summary.verified < floor(context.rules)) {
    context.fail(
      "minVerifiedClaims",
      `${claims.summary.verified} claim(s) are verified; at least ${context.rules.minVerifiedClaims} required.`,
    )
  }
}

function checkMaxUnknowns(context: RuleContext): void {
  const { flow } = context.evidence
  if (flow === undefined) {
    failNotComputed(context, "maxUnknowns")
    return
  }
  if (flow.unknowns.length > ceiling(context.rules, "maxUnknowns")) {
    context.fail(
      "maxUnknowns",
      `The analysis could not follow ${flow.unknowns.length} place(s); at most ${context.rules.maxUnknowns} allowed.`,
      flow.unknowns.map((unknown) => ({ model: "flow" as const, id: unknown.id })),
    )
  }
}

function checkRequireComplete(context: RuleContext): void {
  const { flow } = context.evidence
  if (flow === undefined) {
    failNotComputed(context, "requireComplete")
    return
  }
  if (context.rules.requireComplete === true && !flow.coverage.complete) {
    context.fail(
      "requireComplete",
      `The flow analysis is not complete: ${flow.coverage.unknowns} unknown(s), ${flow.coverage.functionsUnanalyzed} function(s) not fully analyzed, ${flow.coverage.edgesUnresolved} unresolved edge(s).`,
      flow.unknowns.map((unknown) => ({ model: "flow" as const, id: unknown.id })),
    )
  }
}

function checkMaxUnusedSensitivePaths(context: RuleContext): void {
  const { flow, capability } = context.evidence
  if (flow === undefined) {
    failNotComputed(context, "maxUnusedSensitivePaths")
    return
  }
  const report = analyzeLeastData({ capability, flow })
  const unused = report.unusedPaths.filter((path) => path.sensitivity !== undefined)
  if (unused.length > ceiling(context.rules, "maxUnusedSensitivePaths")) {
    context.fail(
      "maxUnusedSensitivePaths",
      `${unused.length} path(s) of sensitive fields are never used (${unused.map((path) => `${path.field}.${path.path.join(".")}`).join(", ")}); at most ${context.rules.maxUnusedSensitivePaths} allowed.`,
      unused.map((path) => ({ model: "flow" as const, id: path.fieldNode })),
    )
  }
}

function checkMaxWholeFieldToClient(context: RuleContext): void {
  const { flow, capability } = context.evidence
  if (flow === undefined) {
    failNotComputed(context, "maxWholeFieldToClient")
    return
  }
  const report = analyzeLeastData({ capability, flow })
  if (report.wholeFieldToClient.length > ceiling(context.rules, "maxWholeFieldToClient")) {
    context.fail(
      "maxWholeFieldToClient",
      `${report.wholeFieldToClient.length} field(s) are sent whole to a client response; at most ${context.rules.maxWholeFieldToClient} allowed.`,
      report.wholeFieldToClient.flatMap((whole) => [
        { model: "flow" as const, id: whole.fieldNode },
        ...whole.edges.map((id) => ({ model: "flow" as const, id })),
      ]),
    )
  }
}

function checkRequireObservations(context: RuleContext): void {
  if (context.rules.requireObservations !== true) return
  const { observation } = context.evidence
  if (observation === undefined)
    context.fail(
      "requireObservations",
      "No runtime observations were ingested; run with --observations.",
    )
  else if (observation.observations.length === 0)
    context.fail(
      "requireObservations",
      "Runtime observations were ingested but none were recorded.",
    )
}

function checkRequireVerified(context: RuleContext): void {
  const { claims } = context.evidence
  if (claims === undefined) {
    failNotComputed(context, "requireVerified")
    return
  }
  for (const ruleId of new Set(context.rules.requireVerified)) {
    const own = claims.claims.filter(
      (claim) => claim.kind === "policy-holds" && claim.object === ruleId,
    )
    if (own.length === 0) {
      context.fail(
        "requireVerified",
        `Rule ${ruleId} has no claim to verify: it is not declared, or it matched no field.`,
      )
      continue
    }
    for (const claim of own.filter((item) => item.verification !== "verified")) {
      context.fail(
        "requireVerified",
        `Rule ${ruleId} is ${claim.verification} for ${claim.subject}, not verified.`,
        [...claim.supporting, ...claim.contradicting],
      )
    }
  }
}

/** Evaluates `rules` over `evidence`. A rule that needs analysis that did not run is a violation. */
export function evaluateEvidenceRules(
  evidence: EvidenceRulesInput,
  rules: EvidenceRules,
): EvidenceRulesResult {
  const evaluated: RuleName[] = []
  const violations: EvidenceRuleViolation[] = []
  const context: RuleContext = {
    evidence,
    rules,
    fail: (rule, message, refs = []) => {
      violations.push({ rule, message, evidence: refs })
    },
  }
  const checks: Record<RuleName, () => void> = {
    noPolicyViolations: () => {
      checkPolicy(context, "noPolicyViolations")
    },
    noIndeterminatePolicies: () => {
      checkPolicy(context, "noIndeterminatePolicies")
    },
    maxContradictedClaims: () => {
      checkMaxContradictedClaims(context)
    },
    maxUnknowns: () => {
      checkMaxUnknowns(context)
    },
    requireComplete: () => {
      checkRequireComplete(context)
    },
    maxUnusedSensitivePaths: () => {
      checkMaxUnusedSensitivePaths(context)
    },
    maxWholeFieldToClient: () => {
      checkMaxWholeFieldToClient(context)
    },
    requireObservations: () => {
      checkRequireObservations(context)
    },
    minVerifiedClaims: () => {
      checkMinVerifiedClaims(context)
    },
    requireVerified: () => {
      checkRequireVerified(context)
    },
  }

  for (const rule of EVIDENCE_RULE_NAMES) {
    if (rules[rule] === undefined) continue
    evaluated.push(rule)
    checks[rule]()
  }

  return { ok: violations.length === 0, evaluated, violations }
}
