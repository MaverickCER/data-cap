/**
 * `data-cap`'s Claims Model (ADR 0070, ADR 0071) -- statements the evidence
 * makes, each with the evidence that supports it, the evidence that
 * contradicts it, the scope it covers, and a verification status derived
 * from how static facts, policy results and runtime observations line up.
 *
 * Three claim kinds:
 *
 * - `field-reaches-boundary`: a field's data reaches a boundary. Established
 *   by the Flow Model (static/declared/inferred paths) and/or by an
 *   observation. A path resting on an `unknown` edge makes no claim.
 * - `field-sourced-from-boundary`: a field's data is declared to come from a
 *   boundary (a database, an API). Declared, so `verified` only when the field
 *   is also observed there; an observation at a declared source is the field
 *   being read, never a contradiction of the static flow.
 * - `policy-holds`: a declared rule holds for a field. Judged statically by
 *   the Policy Model and re-judged against observed crossings.
 *
 * Verification (never collapsed, ADR 0071):
 *   `verified`      a static/declared/inferred fact corroborated by an observation
 *   `inferred`      rests on an inferred edge and was not observed
 *   `unobserved`    static/declared and no observation covers it (or none were run)
 *   `contradicted`  an observation conflicts with a complete static trace, a
 *                   static evaluation found a violation, or an observation
 *                   violates a statically satisfied rule
 *   `observed-only` seen at runtime with no static counterpart, and the static
 *                   trace was incomplete so no contradiction can be asserted
 *   `indeterminate` the policy could not be decided
 *
 * Pure -- no filesystem access.
 */

import { compareById } from "./flow-model.js"
import type { FlowModel, FlowNode, FlowStatus } from "./flow-model.js"
import { flowPathTo, pathsRelated, traceFlow, weakestStatus } from "./flow-projections.js"
import { subpathWithin } from "./observation-model.js"
import type { Observation, ObservationModel } from "./observation-model.js"
import { judgeCrossing } from "./policy-model.js"
import type { PolicyModel, PolicyResult } from "./policy-model.js"

/** Bump only when a reader could misinterpret the shape. */
export const CLAIMS_MODEL_SCHEMA_VERSION = 1

/** What a claim asserts. */
export type ClaimKind = "field-reaches-boundary" | "field-sourced-from-boundary" | "policy-holds"

/** How the evidence lines up for a claim. */
export type ClaimVerification =
  "verified" | "inferred" | "unobserved" | "contradicted" | "observed-only" | "indeterminate"

/** Which sub-model of the Evidence Model a piece of evidence lives in. */
export type EvidenceRefModel = "flow" | "policy" | "observation"

/** A pointer to one record inside the Evidence Model. */
export interface EvidenceRef {
  readonly model: EvidenceRefModel
  /** Flow node/edge id, observation id, or `ruleId#fieldNodeId` for a policy result group. */
  readonly id: string
}

/** What a claim covers and how completely. */
export interface ClaimScope {
  /** Every observation scope that contributed to the claim, sorted; empty when none were run or none matched. */
  readonly observationScopes: readonly string[]
  /** False when the static trace behind the claim touched an `unknown` fact: the real picture may be larger. */
  readonly traceComplete: boolean
}

/** One claim. */
export interface Claim {
  /** Content-addressed. */
  readonly id: string
  readonly kind: ClaimKind
  /** Human-readable statement, derived from the structured fields and never parsed. */
  readonly statement: string
  /** Capability-qualified dotted field name. */
  readonly subject: string
  /** Boundary name (`field-reaches-boundary`) or rule id (`policy-holds`). */
  readonly object: string
  /** Epistemic status of the underlying fact: the weakest status along the static path, or `observed` for an observation-only claim. */
  readonly status: FlowStatus
  readonly verification: ClaimVerification
  readonly scope: ClaimScope
  readonly supporting: readonly EvidenceRef[]
  readonly contradicting: readonly EvidenceRef[]
  /** Which sub-models this claim was derived from. */
  readonly derivedFrom: readonly EvidenceRefModel[]
}

/** Claim counts by verification status. */
export type ClaimsSummary = Readonly<Record<ClaimVerification, number>>

/** `data-cap`'s Claims Model. */
export interface ClaimsModel {
  /** Always `CLAIMS_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof CLAIMS_MODEL_SCHEMA_VERSION
  /** Every claim, ordered by id. */
  readonly claims: readonly Claim[]
  readonly summary: ClaimsSummary
}

/** What `buildClaimsModel` reads. `flow` is required; the others contribute only when supplied. */
export interface ClaimsModelInputs {
  readonly flow: FlowModel
  readonly policy?: PolicyModel | undefined
  readonly observation?: ObservationModel | undefined
}

/** The statuses of facts a field is said to reach a boundary by -- everything but `observed` and `unknown`. */
function reachStatuses(): readonly FlowStatus[] {
  return ["static", "declared", "inferred"]
}

function boundaryMatches(observation: Observation, boundary: FlowNode): boolean {
  return (
    observation.boundary.name === boundary.name &&
    (boundary.boundaryKind === undefined || observation.boundary.kind === boundary.boundaryKind)
  )
}

function scopesOf(observations: readonly Observation[]): readonly string[] {
  return [...new Set(observations.map((observation) => observation.scope))].sort()
}

function observationRefs(observations: readonly Observation[]): EvidenceRef[] {
  return observations.map((observation) => ({ model: "observation" as const, id: observation.id }))
}

function derivedFromOf(inputs: ClaimsModelInputs, includePolicy: boolean): EvidenceRefModel[] {
  const models: EvidenceRefModel[] = ["flow"]
  if (includePolicy) models.push("policy")
  if (inputs.observation !== undefined) models.push("observation")
  return models
}

/** The observations about one field, each with the nodes the static flow reaches along the very path observed. */
function observationsAbout(
  flow: FlowModel,
  field: FlowNode,
  observations: readonly Observation[],
): { readonly observation: Observation; readonly reachable: ReadonlySet<string> }[] {
  return observations.flatMap((observation) => {
    const inside = subpathWithin(field.name, observation.field)
    if (inside === undefined) return []
    const traced = traceFlow(flow, field.id, "downstream", {
      statuses: reachStatuses(),
      path: inside,
    })
    return [{ observation, reachable: new Set(traced.nodes.map((node) => node.id)) }]
  })
}

function reachVerification(
  matching: readonly Observation[],
  status: FlowStatus,
): ClaimVerification {
  if (matching.length > 0) return "verified"
  return status === "inferred" ? "inferred" : "unobserved"
}

function fieldReachClaims(
  inputs: ClaimsModelInputs,
  observations: readonly Observation[],
  covered: Set<string>,
): Claim[] {
  const { flow } = inputs
  const claims: Claim[] = []

  for (const field of flow.nodes.filter((node) => node.kind === "field")) {
    const full = traceFlow(flow, field.id, "downstream")
    const reach = traceFlow(flow, field.id, "downstream", { statuses: reachStatuses() })
    const about = observationsAbout(flow, field, observations)

    for (const boundary of reach.nodes.filter((node) => node.kind === "boundary")) {
      const path = flowPathTo(reach, field.id, boundary.id)
      const status = weakestStatus(path.map((edge) => edge.status))
      // An observation corroborates the claim only if the static flow carries the very path that was observed.
      const matching = about
        .filter(
          ({ observation, reachable }) =>
            boundaryMatches(observation, boundary) && reachable.has(boundary.id),
        )
        .map(({ observation }) => observation)
      for (const observation of matching) covered.add(observation.id)

      claims.push({
        id: `claim:field-reaches-boundary:${field.name}->${boundary.boundaryKind ?? "-"}:${boundary.name}`,
        kind: "field-reaches-boundary",
        statement: `${field.name} reaches ${boundary.boundaryKind ?? "boundary"} ${boundary.name}`,
        subject: field.name,
        object: boundary.name,
        status,
        verification: reachVerification(matching, status),
        scope: { observationScopes: scopesOf(matching), traceComplete: full.complete },
        supporting: [
          ...path.map((edge) => ({ model: "flow" as const, id: edge.id })),
          ...observationRefs(matching),
        ],
        contradicting: [],
        derivedFrom: derivedFromOf(inputs, false),
      })
    }
  }
  return claims
}

/** Declared sources: a field read from a boundary it is declared to come from. */
function sourcedClaims(
  inputs: ClaimsModelInputs,
  observations: readonly Observation[],
  covered: Set<string>,
): Claim[] {
  const { flow } = inputs
  const claims: Claim[] = []

  for (const field of flow.nodes.filter((node) => node.kind === "field")) {
    for (const edge of flow.edges.filter(
      (candidate) => candidate.kind === "crosses-boundary" && candidate.to === field.id,
    )) {
      const source = flow.nodes.find((node) => node.id === edge.from)
      if (source?.kind !== "boundary") continue
      const matching = observations.filter(
        (observation) =>
          subpathWithin(field.name, observation.field) !== undefined &&
          boundaryMatches(observation, source),
      )
      for (const observation of matching) covered.add(observation.id)
      claims.push({
        id: `claim:field-sourced-from-boundary:${field.name}<-${source.boundaryKind ?? "-"}:${source.name}`,
        kind: "field-sourced-from-boundary",
        statement: `${field.name} is sourced from ${source.boundaryKind ?? "boundary"} ${source.name}`,
        subject: field.name,
        object: source.name,
        status: edge.status,
        verification: matching.length > 0 ? "verified" : "unobserved",
        scope: { observationScopes: scopesOf(matching), traceComplete: true },
        supporting: [{ model: "flow", id: edge.id }, ...observationRefs(matching)],
        contradicting: [],
        derivedFrom: derivedFromOf(inputs, false),
      })
    }
  }
  return claims
}

/** The observations no claim covered, grouped by field and boundary, each group in first-seen order. */
function groupUncovered(
  observations: readonly Observation[],
  covered: ReadonlySet<string>,
): { readonly first: Observation; readonly all: Observation[] }[] {
  const groups = new Map<string, { readonly first: Observation; readonly all: Observation[] }>()
  for (const observation of observations) {
    if (covered.has(observation.id)) continue
    const key = `${observation.field}|${observation.boundary.kind}|${observation.boundary.name}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { first: observation, all: [observation] })
    else group.all.push(observation)
  }
  return [...groups.values()]
}

/** Observations the static flow does not carry. */
function observedOnlyClaims(
  inputs: ClaimsModelInputs,
  observations: readonly Observation[],
  covered: ReadonlySet<string>,
): Claim[] {
  const { flow } = inputs
  const claims: Claim[] = []

  for (const { first, all: group } of groupUncovered(observations, covered)) {
    const fields = flow.nodes.filter(
      (node) => node.kind === "field" && subpathWithin(node.name, first.field) !== undefined,
    )
    // A contradiction is asserted only when every field the observation could be about has a complete trace.
    const complete =
      fields.length > 0 && fields.every((node) => traceFlow(flow, node.id, "downstream").complete)
    const contradicting = complete
      ? fields.slice(0, 1).map((node) => ({ model: "flow" as const, id: node.id }))
      : []
    claims.push({
      id: `claim:field-reaches-boundary:${first.field}->${first.boundary.kind}:${first.boundary.name}`,
      kind: "field-reaches-boundary",
      statement: `${first.field} reaches ${first.boundary.kind} ${first.boundary.name}`,
      subject: first.field,
      object: first.boundary.name,
      status: "observed",
      verification: contradicting.length === 0 ? "observed-only" : "contradicted",
      scope: { observationScopes: scopesOf(group), traceComplete: complete },
      supporting: observationRefs(group),
      contradicting,
      derivedFrom: derivedFromOf(inputs, false),
    })
  }
  return claims
}

function reachClaims(inputs: ClaimsModelInputs): Claim[] {
  const observations = inputs.observation?.observations ?? []
  const covered = new Set<string>()
  // Order matters: the first two passes fill `covered`, which the last one reads.
  const reaching = fieldReachClaims(inputs, observations, covered)
  const sourced = sourcedClaims(inputs, observations, covered)
  return [...reaching, ...sourced, ...observedOnlyClaims(inputs, observations, covered)]
}

/** The results of each rule for each subject, keyed `ruleId#subject`, with the first of them as the sample. */
function groupPolicyResults(
  policy: PolicyModel,
): Map<string, { readonly sample: PolicyResult; readonly results: PolicyResult[] }> {
  const groups = new Map<
    string,
    { readonly sample: PolicyResult; readonly results: PolicyResult[] }
  >()
  for (const result of policy.results) {
    const key = `${result.ruleId}#${result.subject}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { sample: result, results: [result] })
    else group.results.push(result)
  }
  return groups
}

function policyClaims(inputs: ClaimsModelInputs): Claim[] {
  const { flow, policy } = inputs
  if (policy === undefined) return []
  const observations = inputs.observation?.observations ?? []
  const claims: Claim[] = []

  for (const [key, { sample, results }] of groupPolicyResults(policy)) {
    const rule = policy.rules.find((candidate) => candidate.id === sample.ruleId)
    const subject = flow.nodes.find((node) => node.id === sample.subject)
    if (rule === undefined || subject === undefined) continue

    const violated = results.filter((result) => result.outcome === "violated")
    const indeterminate = results.filter((result) => result.outcome === "indeterminate")
    const satisfied = results.filter((result) => result.outcome === "satisfied")
    // Only observations about the data this rule governs: the field, or the rule's path inside it.
    const fieldObservations = observations.filter((observation) => {
      const inside = subpathWithin(subject.name, observation.field)
      if (inside === undefined) return false
      return rule.appliesTo.path === undefined || pathsRelated(inside, rule.appliesTo.path)
    })
    const violatingObservations = fieldObservations.filter(
      (observation) =>
        judgeCrossing(rule, observation.boundary.kind, [observation.handling])?.outcome ===
        "violated",
    )

    let verification: ClaimVerification
    if (violated.length > 0 || violatingObservations.length > 0) verification = "contradicted"
    else if (indeterminate.length > 0) verification = "indeterminate"
    else if (fieldObservations.length > 0) verification = "verified"
    else verification = "unobserved"

    const dominant =
      violated.length > 0 ? violated : satisfied.length > 0 ? satisfied : indeterminate
    const status = weakestStatus(dominant.map((result) => result.basis))
    const policyRef: EvidenceRef = { model: "policy", id: key }
    const edgeRefs = (list: readonly PolicyResult[]): EvidenceRef[] =>
      list.flatMap((result) => result.edges.map((id) => ({ model: "flow" as const, id })))
    const supportingObservations = fieldObservations.filter(
      (observation) => !violatingObservations.includes(observation),
    )

    claims.push({
      id: `claim:policy-holds:${rule.id}:${subject.name}`,
      kind: "policy-holds",
      statement: `Rule ${rule.id} holds for ${subject.name}`,
      subject: subject.name,
      object: rule.id,
      status,
      verification,
      scope: {
        observationScopes: scopesOf(fieldObservations),
        traceComplete: !results.some((result) => result.reason === "trace-incomplete"),
      },
      supporting: [policyRef, ...edgeRefs(satisfied), ...observationRefs(supportingObservations)],
      contradicting: [
        ...(violated.length > 0 ? [policyRef, ...edgeRefs(violated)] : []),
        ...observationRefs(violatingObservations),
      ],
      derivedFrom: derivedFromOf(inputs, true),
    })
  }

  return claims
}

/** Builds the Claims Model from the Flow Model and, when supplied, the Policy and Observation Models. */
export function buildClaimsModel(inputs: ClaimsModelInputs): ClaimsModel {
  const claims = [...reachClaims(inputs), ...policyClaims(inputs)].sort(compareById)
  const summary: Record<ClaimVerification, number> = {
    verified: 0,
    inferred: 0,
    unobserved: 0,
    contradicted: 0,
    "observed-only": 0,
    indeterminate: 0,
  }
  for (const claim of claims) summary[claim.verification] += 1
  return { schemaVersion: CLAIMS_MODEL_SCHEMA_VERSION, claims, summary }
}
