/**
 * Report findings derived from the Policy Model and from what the flow pass
 * could not follow (ADR 0070, ADR 0071). Pure -- no filesystem access.
 *
 * Severity follows the repo's invariants: a violation proven by static or
 * declared evidence is an `error`; one resting on an inferred edge is a
 * `warning` (never an `error` from insufficient evidence); a result the
 * analysis could not decide is a `warning`, so `--strict-flow` makes
 * "we could not prove this rule" block the build, which is the point of
 * declaring a rule at all.
 */

import type { ReportFinding } from "../build/findings.js"
import type { FlowModel, FlowNode, FlowUnknownReason } from "./flow-model.js"
import type { PolicyIndeterminateReason, PolicyModel, PolicyResult } from "./policy-model.js"

function indeterminateText(reason: PolicyIndeterminateReason): string {
  const text: Readonly<Record<PolicyIndeterminateReason, string>> = {
    "rule-matches-nothing": "the rule matches no field, so nothing was checked",
    "trace-incomplete":
      "the flow of the governed data reaches code the analysis could not follow, so the rule could not be proven to hold",
    "handling-not-declared": "a crossing the rule governs declares no handling",
    "boundary-kind-unknown": "a destination the data reaches has no known kind",
  }
  return text[reason]
}

/** A plain-language phrase for why part of the program could not be followed -- shared by findings and text rendering so they cannot disagree. */
export function unknownText(reason: FlowUnknownReason): string {
  const text: Readonly<Record<FlowUnknownReason, string>> = {
    "dynamic-access": "a computed property key on tracked data",
    "unresolved-call": "an unresolved call that receives tracked data",
    "unresolved-import": "an import that could not be resolved",
    "unsupported-construct": "an unsupported construct",
    "missing-source": "source that is not available",
    "unanalyzed-function": "a function the analysis did not complete",
  }
  return text[reason]
}

/** A field node's name is `exportName.field`; splits it, or returns `undefined` for anything that is not a field. */
function fieldParts(
  node: FlowNode | undefined,
): { readonly file: string; readonly exportName: string; readonly field: string } | undefined {
  if (node?.kind !== "field") return undefined
  const [exportName = node.name, ...rest] = node.name.split(".")
  return { file: node.scope, exportName, field: rest.join(".") }
}

function capabilityOf(node: FlowNode | undefined): ReportFinding["capability"] {
  const parts = fieldParts(node)
  return parts === undefined ? undefined : { file: parts.file, exportName: parts.exportName }
}

function fieldKeyOf(node: FlowNode | undefined): readonly string[] | undefined {
  const parts = fieldParts(node)
  return parts === undefined ? undefined : [parts.field]
}

/** The policy result a finding rests on, and the flow edges that justify it (absent for a rule that matched nothing). */
function evidenceOf(result: PolicyResult): ReportFinding["evidence"] {
  if (result.subject === undefined) return undefined
  return [
    { model: "policy", id: `${result.ruleId}#${result.subject}` },
    ...result.edges.map((id) => ({ model: "flow" as const, id })),
  ]
}

function describe(result: PolicyResult, flow: FlowModel): string {
  const subject = flow.nodes.find((node) => node.id === result.subject)
  const boundary = flow.nodes.find((node) => node.id === result.boundary)
  const field = subject === undefined ? "a field" : `field "${subject.name}"`
  const to =
    boundary === undefined
      ? ""
      : ` reaches ${boundary.boundaryKind ?? "boundary"} "${boundary.name}"`
  return `${field}${to}`
}

/** One finding per violated or indeterminate result; satisfied results produce none. */
export function policyFindings(policy: PolicyModel, flow: FlowModel): ReportFinding[] {
  const findings: ReportFinding[] = []
  for (const result of policy.results) {
    if (result.outcome === "satisfied") continue
    const subject = flow.nodes.find((node) => node.id === result.subject)
    const capability = capabilityOf(subject)
    const field = fieldKeyOf(subject)
    const evidence = evidenceOf(result)
    const location = {
      ...(capability === undefined ? {} : { capability }),
      ...(field === undefined ? {} : { field }),
      ...(evidence === undefined ? {} : { evidence }),
    }
    if (result.outcome === "violated") {
      findings.push({
        code: "FLOW_POLICY_VIOLATED",
        family: "flow",
        severity: result.basis === "inferred" ? "warning" : "error",
        message: `Rule "${result.ruleId}" is violated: ${describe(result, flow)} (established as ${result.basis}).`,
        ...location,
      })
    } else {
      const why =
        result.reason === undefined
          ? "the analysis could not decide"
          : indeterminateText(result.reason)
      findings.push({
        code: "FLOW_POLICY_INDETERMINATE",
        family: "flow",
        severity: "warning",
        message: `Rule "${result.ruleId}" could not be decided${result.subject === undefined ? "" : ` for ${describe(result, flow)}`}: ${why}.`,
        ...location,
      })
    }
  }
  return findings
}

/** One `info` finding per explicit unknown in the Flow Model: what the analysis could not follow, and where. */
export function flowAnalysisFindings(flow: FlowModel): ReportFinding[] {
  return flow.unknowns.map((unknown) => ({
    code: "FLOW_ANALYSIS_INCOMPLETE" as const,
    family: "flow" as const,
    severity: "info" as const,
    message: `The flow analysis could not follow ${unknownText(unknown.reason)} at ${unknown.source.file}:${unknown.source.line}:${unknown.source.column}${unknown.detail === undefined ? "" : ` (${unknown.detail})`}; data flows through it are shown as inferred.`,
    source: unknown.source.file,
    position: { line: unknown.source.line, column: unknown.source.column },
    evidence: [{ model: "flow" as const, id: unknown.id }],
  }))
}
