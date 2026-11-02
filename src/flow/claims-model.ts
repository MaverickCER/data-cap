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
 *   `indeterminate` the policy could not be decided, or the recorder reported
 *                   leaving out part of the evidence near the field (a
 *                   truncated scope, see below)
 *
 * Path coverage. A claim's subject is a field; an observation may be about a
 * narrower path inside it. Every claim with matching observations therefore
 * lists `observedPaths` (the observed names) and a `pathCoverage`: `whole`
 * when an observation covers the whole path scope of the claim (the field,
 * the static edge's path, or the rule's path), `partial` when only narrower
 * paths were seen. The verification itself is unchanged by coverage: read
 * `verified` together with `observedPaths`.
 *
 * Truncated scopes. When the recorder reported that it did not capture part of
 * a value (`ObservationModel.truncations`: a dotted key, depth/node limits, a
 * cycle) in a scope that contributed to a claim, and the skipped path is the
 * claim's field, inside it, or contains it, a claim that would be `verified`
 * is `indeterminate` instead and `scope.truncatedScopes` names those scopes.
 * A contradiction is never softened. The rule is deliberately conservative:
 * absence of evidence in a cut-off value is not evidence.
 *
 * Pure -- no filesystem access.
 */

import { compareById } from "./flow-model.js"
import type { FlowModel, FlowNode, FlowStatus } from "./flow-model.js"
import {
  flowIndex,
  flowPathTo,
  pathsRelated,
  traceFlow,
  weakestStatus,
} from "./flow-projections.js"
import { fieldNamesRelated, nameAndAncestors, pathWithin } from "./observation-model.js"
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
  /** Contributing observation scopes whose recorder reported leaving out evidence near this claim's field, sorted; absent when none. */
  readonly truncatedScopes?: readonly string[]
}

/** Whether the observations seen cover the claim's whole path scope or only narrower paths inside it. */
export type ClaimPathCoverage = "whole" | "partial"

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
  /** The capability-qualified names of the observed paths that back this claim, sorted and distinct; absent when none did. */
  readonly observedPaths?: readonly string[]
  /** Whether those paths cover the claim's whole path scope; present exactly when `observedPaths` is. */
  readonly pathCoverage?: ClaimPathCoverage
  /** The latest time any backing observation was seen (ISO 8601, UTC); absent when none carried a time. */
  readonly lastObservedAt?: string
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

/** What the claim passes read, built once: observations by every ancestor name, fields by name, truncations by scope. */
interface ClaimContext {
  readonly inputs: ClaimsModelInputs
  readonly observations: readonly Observation[]
  readonly byPrefix: ReadonlyMap<string, readonly Observation[]>
  readonly fieldsByName: ReadonlyMap<
    string,
    readonly { readonly node: FlowNode; readonly position: number }[]
  >
  readonly truncations: ReadonlyMap<string, readonly string[]>
}

function claimContext(inputs: ClaimsModelInputs): ClaimContext {
  const observations = inputs.observation?.observations ?? []
  const byPrefix = new Map<string, Observation[]>()
  for (const observation of observations) {
    for (const prefix of nameAndAncestors(observation.field)) {
      const list = byPrefix.get(prefix)
      if (list === undefined) byPrefix.set(prefix, [observation])
      else list.push(observation)
    }
  }
  const fieldsByName = new Map<string, { node: FlowNode; position: number }[]>()
  flowIndex(inputs.flow).fields.forEach((node, position) => {
    const list = fieldsByName.get(node.name)
    if (list === undefined) fieldsByName.set(node.name, [{ node, position }])
    else list.push({ node, position })
  })
  const truncations = new Map<string, string[]>()
  const reported = inputs.observation?.truncations
  if (reported !== undefined) {
    for (const item of reported) {
      const list = truncations.get(item.scope)
      if (list === undefined) truncations.set(item.scope, [item.field])
      else list.push(item.field)
    }
  }
  return { inputs, observations, byPrefix, fieldsByName, truncations }
}

/** The observations about `fieldName` or a path inside it, in observation order. */
function observationsInside(context: ClaimContext, fieldName: string): readonly Observation[] {
  return context.byPrefix.get(fieldName) ?? []
}

/** Fields (in model order) that an observation of `observedName` could be about. */
function fieldsAround(context: ClaimContext, observedName: string): FlowNode[] {
  return nameAndAncestors(observedName)
    .flatMap((prefix) => context.fieldsByName.get(prefix) ?? [])
    .sort((a, b) => a.position - b.position)
    .map(({ node }) => node)
}

/** The scopes among `scopes` whose recorder left out evidence at, inside, or around `fieldName`. */
function truncatedAmong(
  context: ClaimContext,
  scopes: readonly string[],
  fieldName: string,
): string[] {
  return scopes.filter((scope) => {
    const cuts = context.truncations.get(scope)
    return cuts?.some((cut) => fieldNamesRelated(cut, fieldName))
  })
}

function covers(observed: readonly string[], required: readonly string[]): boolean {
  // An observed path longer than the required one has a segment the required one lacks, so `every` fails on it.
  return observed.every((segment, i) => segment === required[i])
}

/** Path scopes the matching observations are judged against: whole when some observation covers every required path. */
function coverageOf(
  fieldName: string,
  matching: readonly Observation[],
  required: readonly (readonly string[])[],
): ClaimPathCoverage {
  const whole = matching.some((observation) => {
    const inside = pathWithin(fieldName, observation.field)
    return required.length === 0
      ? inside.length === 0
      : required.every((path) => covers(inside, path))
  })
  return whole ? "whole" : "partial"
}

/** The latest of these instants (ISO instants sort as time does), or `undefined` when there are none. */
function latestOf(times: readonly string[]): string | undefined {
  return [...times].sort().at(-1)
}

/** What the backing observations add to a claim: their paths, how fully they cover it, and when they were last seen. */
function evidenceFacts(
  fieldName: string,
  matching: readonly Observation[],
  required: readonly (readonly string[])[],
): Pick<Claim, "observedPaths" | "pathCoverage" | "lastObservedAt"> {
  if (matching.length === 0) return {}
  const last = latestOf(matching.flatMap((observation) => observation.lastSeen ?? []))
  return {
    observedPaths: [...new Set(matching.map((observation) => observation.field))].sort(),
    pathCoverage: coverageOf(fieldName, matching, required),
    ...(last === undefined ? {} : { lastObservedAt: last }),
  }
}

/** The scope of a claim: the scopes observed, whether the trace was complete, and the observed scopes whose evidence was cut. */
function scopeOfClaim(
  context: ClaimContext,
  subject: string,
  matching: readonly Observation[],
  traceComplete: boolean,
): ClaimScope {
  const observationScopes = scopesOf(matching)
  const truncated = truncatedAmong(context, observationScopes, subject)
  return {
    observationScopes,
    traceComplete,
    ...(truncated.length === 0 ? {} : { truncatedScopes: truncated }),
  }
}

/** The scope of a claim, and its verification once truncated scopes are taken into account. */
function qualified(
  context: ClaimContext,
  subject: string,
  matching: readonly Observation[],
  traceComplete: boolean,
  verification: ClaimVerification,
): { readonly scope: ClaimScope; readonly verification: ClaimVerification } {
  const scope = scopeOfClaim(context, subject, matching, traceComplete)
  return {
    scope,
    verification:
      verification === "verified" && scope.truncatedScopes !== undefined
        ? "indeterminate"
        : verification,
  }
}

/** The observations about one field, each with the nodes the static flow reaches along the very path observed. */
function observationsAbout(
  context: ClaimContext,
  field: FlowNode,
): { readonly observation: Observation; readonly reachable: ReadonlySet<string> }[] {
  const cache = new Map<string, ReadonlySet<string>>()
  return observationsInside(context, field.name).flatMap((observation) => {
    const inside = pathWithin(field.name, observation.field)
    const key = inside.join("\u0000")
    let reachable = cache.get(key)
    if (reachable === undefined) {
      const traced = traceFlow(context.inputs.flow, field.id, "downstream", {
        statuses: reachStatuses(),
        path: inside,
      })
      reachable = new Set(traced.nodes.map((node) => node.id))
      cache.set(key, reachable)
    }
    return [{ observation, reachable }]
  })
}

function reachVerification(
  matching: readonly Observation[],
  status: FlowStatus,
): ClaimVerification {
  if (matching.length > 0) return "verified"
  return status === "inferred" ? "inferred" : "unobserved"
}

function fieldReachClaims(context: ClaimContext, covered: Set<string>): Claim[] {
  const { inputs } = context
  const { flow } = inputs
  const claims: Claim[] = []

  for (const field of flowIndex(flow).fields) {
    const full = traceFlow(flow, field.id, "downstream")
    const reach = traceFlow(flow, field.id, "downstream", { statuses: reachStatuses() })
    const about = observationsAbout(context, field)

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
      // Stryker disable next-line ArrayDeclaration: equivalent -- a stand-in path that is no prefix of anything observed covers exactly as the empty one does.
      const required = path.flatMap((edge) => (edge.path === undefined ? [] : [edge.path]))
      const { scope, verification } = qualified(
        context,
        field.name,
        matching,
        full.complete,
        reachVerification(matching, status),
      )

      claims.push({
        id: `claim:field-reaches-boundary:${field.name}->${boundary.boundaryKind ?? "-"}:${boundary.name}`,
        kind: "field-reaches-boundary",
        statement: `${field.name} reaches ${boundary.boundaryKind ?? "boundary"} ${boundary.name}`,
        subject: field.name,
        object: boundary.name,
        status,
        verification,
        scope,
        supporting: [
          ...path.map((edge) => ({ model: "flow" as const, id: edge.id })),
          ...observationRefs(matching),
        ],
        contradicting: [],
        derivedFrom: derivedFromOf(inputs, false),
        ...evidenceFacts(field.name, matching, required),
      })
    }
  }
  return claims
}

/** Declared sources: a field read from a boundary it is declared to come from. */
function sourcedClaims(context: ClaimContext, covered: Set<string>): Claim[] {
  const { inputs } = context
  const { fields, incoming, nodesById } = flowIndex(inputs.flow)
  const claims: Claim[] = []

  for (const field of fields) {
    const entering = incoming.get(field.id)
    if (entering === undefined) continue
    for (const edge of entering.filter((candidate) => candidate.kind === "crosses-boundary")) {
      const source = nodesById.get(edge.from)
      if (source?.kind !== "boundary") continue
      const matching = observationsInside(context, field.name).filter((observation) =>
        boundaryMatches(observation, source),
      )
      for (const observation of matching) covered.add(observation.id)
      const { scope, verification } = qualified(
        context,
        field.name,
        matching,
        true,
        matching.length > 0 ? "verified" : "unobserved",
      )
      // Stryker disable next-line ArrayDeclaration: equivalent -- a stand-in path that is no prefix of anything observed covers exactly as the empty one does.
      const sourcePath = edge.path === undefined ? [] : [edge.path]
      claims.push({
        id: `claim:field-sourced-from-boundary:${field.name}<-${source.boundaryKind ?? "-"}:${source.name}`,
        kind: "field-sourced-from-boundary",
        statement: `${field.name} is sourced from ${source.boundaryKind ?? "boundary"} ${source.name}`,
        subject: field.name,
        object: source.name,
        status: edge.status,
        verification,
        scope,
        supporting: [{ model: "flow", id: edge.id }, ...observationRefs(matching)],
        contradicting: [],
        derivedFrom: derivedFromOf(inputs, false),
        ...evidenceFacts(field.name, matching, sourcePath),
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
function observedOnlyClaims(context: ClaimContext, covered: ReadonlySet<string>): Claim[] {
  const { inputs, observations } = context
  const { flow } = inputs
  const claims: Claim[] = []

  for (const { first, all: group } of groupUncovered(observations, covered)) {
    const fields = fieldsAround(context, first.field)
    // A contradiction is asserted only when every field the observation could be about has a complete trace.
    const complete =
      fields.length > 0 && fields.every((node) => traceFlow(flow, node.id, "downstream").complete)
    const contradicting = complete
      ? fields.slice(0, 1).map((node) => ({ model: "flow" as const, id: node.id }))
      : []
    const last = latestOf(group.flatMap((item) => item.lastSeen ?? []))
    const scope = scopeOfClaim(context, first.field, group, complete)
    claims.push({
      id: `claim:field-reaches-boundary:${first.field}->${first.boundary.kind}:${first.boundary.name}`,
      kind: "field-reaches-boundary",
      statement: `${first.field} reaches ${first.boundary.kind} ${first.boundary.name}`,
      subject: first.field,
      object: first.boundary.name,
      status: "observed",
      verification: contradicting.length === 0 ? "observed-only" : "contradicted",
      scope,
      supporting: observationRefs(group),
      contradicting,
      derivedFrom: derivedFromOf(inputs, false),
      ...(last === undefined ? {} : { lastObservedAt: last }),
    })
  }
  return claims
}

function reachClaims(context: ClaimContext): Claim[] {
  const covered = new Set<string>()
  // Order matters: the first two passes fill `covered`, which the last one reads.
  const reaching = fieldReachClaims(context, covered)
  const sourced = sourcedClaims(context, covered)
  return [...reaching, ...sourced, ...observedOnlyClaims(context, covered)]
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

function policyClaims(context: ClaimContext): Claim[] {
  const { inputs } = context
  const { flow, policy } = inputs
  if (policy === undefined) return []
  const claims: Claim[] = []
  const rules = new Map(policy.rules.map((candidate) => [candidate.id, candidate]))
  const { nodesById } = flowIndex(flow)

  for (const [key, { sample, results }] of groupPolicyResults(policy)) {
    const rule = rules.get(sample.ruleId)
    // Stryker disable next-line ConditionalExpression: equivalent -- Map.get(undefined) is undefined too; the guard only satisfies the type checker.
    const subject = sample.subject === undefined ? undefined : nodesById.get(sample.subject)
    if (rule === undefined || subject === undefined) continue

    const violated = results.filter((result) => result.outcome === "violated")
    const indeterminate = results.filter((result) => result.outcome === "indeterminate")
    const satisfied = results.filter((result) => result.outcome === "satisfied")
    // Only observations about the data this rule governs: the field, or the rule's path inside it.
    const fieldObservations = observationsInside(context, subject.name).filter((observation) => {
      const inside = pathWithin(subject.name, observation.field)
      return rule.appliesTo.path === undefined || pathsRelated(inside, rule.appliesTo.path)
    })
    const violatingObservations = fieldObservations.filter(
      (observation) =>
        judgeCrossing(rule, observation.boundary.kind, [observation.handling])?.outcome ===
        "violated",
    )

    let base: ClaimVerification
    if (violated.length > 0 || violatingObservations.length > 0) base = "contradicted"
    else if (indeterminate.length > 0) base = "indeterminate"
    else if (fieldObservations.length > 0) base = "verified"
    else base = "unobserved"
    const { scope, verification } = qualified(
      context,
      subject.name,
      fieldObservations,
      !results.some((result) => result.reason === "trace-incomplete"),
      base,
    )

    const dominant =
      violated.length > 0 ? violated : satisfied.length > 0 ? satisfied : indeterminate
    const status = weakestStatus(dominant.map((result) => result.basis))
    const policyRef: EvidenceRef = { model: "policy", id: key }
    const edgeRefs = (list: readonly PolicyResult[]): EvidenceRef[] =>
      list.flatMap((result) => result.edges.map((id) => ({ model: "flow" as const, id })))
    const supportingObservations = fieldObservations.filter(
      (observation) => !violatingObservations.includes(observation),
    )

    // Stryker disable next-line ArrayDeclaration: equivalent -- a stand-in path that is no prefix of anything observed covers exactly as the empty one does.
    const governedPath = rule.appliesTo.path === undefined ? [] : [rule.appliesTo.path]
    claims.push({
      id: `claim:policy-holds:${rule.id}:${subject.name}`,
      kind: "policy-holds",
      statement: `Rule ${rule.id} holds for ${subject.name}`,
      subject: subject.name,
      object: rule.id,
      status,
      verification,
      scope,
      supporting: [policyRef, ...edgeRefs(satisfied), ...observationRefs(supportingObservations)],
      contradicting: [
        ...(violated.length > 0 ? [policyRef, ...edgeRefs(violated)] : []),
        ...observationRefs(violatingObservations),
      ],
      derivedFrom: derivedFromOf(inputs, true),
      ...evidenceFacts(subject.name, fieldObservations, governedPath),
    })
  }

  return claims
}

/** Builds the Claims Model from the Flow Model and, when supplied, the Policy and Observation Models. */
export function buildClaimsModel(inputs: ClaimsModelInputs): ClaimsModel {
  const context = claimContext(inputs)
  const claims = [...reachClaims(context), ...policyClaims(context)].sort(compareById)
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
