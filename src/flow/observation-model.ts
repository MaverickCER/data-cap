/**
 * `data-cap`'s Observation Model (ADR 0070, ADR 0072) -- runtime observations
 * (`data-cap/observe` events) aggregated into the Evidence Model. Each
 * observation records that a named field was seen at a named boundary in a
 * named scope (an execution or test), how many times, and with what declared
 * handling. Every observation has the epistemic status `observed` (ADR 0071)
 * and is never merged with a static fact: joining observations to static
 * flow facts is the job of the Claims Model.
 *
 * Names and paths only, never values. Anything outside the event shape is
 * dropped here as well as in the recorder, so a JSON file of events written
 * by some other tool cannot smuggle a value into the evidence.
 *
 * Pure -- no filesystem access.
 */

import { compareById } from "./flow-model.js"
import type { FlowBoundaryKind, FlowHandling } from "./flow-model.js"
import type { ObservationEvent, ObservationSkip, ObservationSkipReason } from "../observe/index.js"

/** Bump only when a reader could misinterpret the shape. */
export const OBSERVATION_MODEL_SCHEMA_VERSION = 1

function isHandling(value: unknown): value is FlowHandling {
  const handlings: readonly unknown[] = ["plaintext", "masked", "redacted", "hashed", "encrypted"]
  return handlings.includes(value)
}

/** One aggregated observation. */
export interface Observation {
  /** Content-addressed: `observation:scope|kind:boundary|field|handling-or-dash`. */
  readonly id: string
  readonly scope: string
  readonly boundary: { readonly kind: FlowBoundaryKind; readonly name: string }
  /** Capability-qualified dotted field path -- the Flow Model's field-node naming. */
  readonly field: string
  readonly handling?: FlowHandling
  /** How many matching events were recorded. */
  readonly count: number
  /** Earliest time any matching event carried (ISO 8601, UTC); absent when none carried one. Never used in the id. */
  readonly firstSeen?: string
  /** Latest time any matching event carried; present exactly when `firstSeen` is. */
  readonly lastSeen?: string
  /** Always `observed` (ADR 0071). */
  readonly status: "observed"
}

/**
 * Evidence the recorder knowingly left out in one scope: below `field` something was not captured. Names only.
 *
 * @public Exported because a public type names it, so the published schema describes it.
 */
export interface ObservationTruncation {
  readonly scope: string
  /** Capability-qualified dotted path below which evidence is missing (the capability itself for the root). */
  readonly field: string
  readonly reason: ObservationSkipReason
  /** How many times the recorder reported this (scope, field, reason). */
  readonly count: number
}

/**
 * First and last time anything was observed in one scope; only for scopes whose events carried times.
 *
 * @public Exported because a public type names it, so the published schema describes it.
 */
export interface ObservationScopeTimes {
  readonly scope: string
  readonly firstSeen: string
  readonly lastSeen: string
}

/** `data-cap`'s Observation Model. */
export interface ObservationModel {
  /** Always `OBSERVATION_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof OBSERVATION_MODEL_SCHEMA_VERSION
  /** Every distinct scope that contributed at least one observation, sorted. */
  readonly scopes: readonly string[]
  /** Every observation, ordered by id. */
  readonly observations: readonly Observation[]
  /** First/last seen per scope, ordered by scope; absent when no event carried a time. */
  readonly scopeTimes?: readonly ObservationScopeTimes[]
  /** Events (and skip reports) dropped as malformed -- stated, never silent. */
  readonly skipped: number
  /** What the recorder reported leaving out, ordered by scope, field, reason; absent when it reported nothing. */
  readonly truncations?: readonly ObservationTruncation[]
  /** The scopes with a truncation, sorted -- a claim built on one cannot be called verified near the cut. Absent when none. */
  readonly truncatedScopes?: readonly string[]
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

interface CleanEvent {
  readonly scope: string
  readonly kind: FlowBoundaryKind
  readonly name: string
  readonly field: string
  readonly handling: FlowHandling | undefined
  /** Epoch milliseconds, when the event carried a usable time. */
  readonly at: number | undefined
}

interface Range {
  readonly first: number
  readonly last: number
}

/** An event time as epoch ms, from epoch ms or an ISO 8601 string; `undefined` for anything not a valid instant. */
function instantOf(raw: unknown): number | undefined {
  const ms = typeof raw === "string" ? Date.parse(raw) : typeof raw === "number" ? raw : Number.NaN
  const time = new Date(ms).getTime()
  return Number.isNaN(time) ? undefined : time
}

function widen(range: Range | undefined, at: number | undefined): Range | undefined {
  if (at === undefined) return range
  if (range === undefined) return { first: at, last: at }
  return { first: Math.min(range.first, at), last: Math.max(range.last, at) }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function clean(raw: unknown): CleanEvent | undefined {
  if (typeof raw !== "object" || raw === null) return undefined
  const candidate = raw as Partial<Record<keyof ObservationEvent, unknown>>
  const { boundary } = candidate
  if (!isName(candidate.scope) || !isName(candidate.field)) return undefined
  if (typeof boundary !== "object" || boundary === null) return undefined
  const { kind, name } = boundary as { kind?: unknown; name?: unknown }
  if (!isName(kind) || !isName(name)) return undefined
  const handling = isHandling(candidate.handling) ? candidate.handling : undefined
  return {
    scope: candidate.scope,
    kind: kind as FlowBoundaryKind,
    name,
    field: candidate.field,
    handling,
    at: instantOf(candidate.at),
  }
}

/**
 * The path inside the field named `fieldName` that the observed capability-qualified name `observed` refers to
 * (`[]` for the whole field), or `undefined` when `observed` is about some other field. A name only counts when it
 * continues at a `.`: `userData.userExtra.email` is not inside `userData.user`.
 */
export function subpathWithin(fieldName: string, observed: string): string[] | undefined {
  return observed === fieldName || observed.startsWith(`${fieldName}.`)
    ? pathWithin(fieldName, observed)
    : undefined
}

/** `subpathWithin` for a name already known to be the field or inside it: the path inside the field. */
export function pathWithin(fieldName: string, observed: string): string[] {
  return observed === fieldName ? [] : observed.slice(fieldName.length + 1).split(".")
}

/** `name`, then each name it lies inside of, shortest first: `a.b.c` gives `a.b.c`, `a`, `a.b`. */
export function nameAndAncestors(name: string): string[] {
  const parts = name.split(".")
  return [name, ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("."))]
}

/** Whether two capability-qualified names are the same or one lies inside the other (always at a `.` boundary). */
export function fieldNamesRelated(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)
}

function isSkipReason(value: unknown): value is ObservationSkipReason {
  const reasons: readonly unknown[] = ["dotted-key", "max-depth", "max-nodes", "cycle"]
  return reasons.includes(value)
}

/** Orders grouped entries by their keys, which are distinct. */
function byKey([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number {
  // Stryker disable next-line EqualityOperator: equivalent -- the keys are distinct, so `<` and `<=` order them the same.
  return a < b ? -1 : 1
}

/** Aggregates the recorder's skip reports into truncations; returns how many reports were malformed. */
function truncationsOf(rawSkips: readonly unknown[]): {
  readonly truncations: ObservationTruncation[]
  readonly malformed: number
} {
  const grouped = new Map<string, ObservationTruncation>()
  let malformed = 0
  for (const raw of rawSkips) {
    const candidate: Partial<Record<keyof ObservationSkip, unknown>> =
      typeof raw === "object" && raw !== null ? raw : {}
    const { scope, field, reason } = candidate
    if (!isName(scope) || !isName(field) || !isSkipReason(reason)) {
      malformed += 1
      continue
    }
    const key = `${scope}\u0000${field}\u0000${reason}`
    const existing = grouped.get(key)
    grouped.set(
      key,
      existing === undefined
        ? { scope, field, reason, count: 1 }
        : { ...existing, count: existing.count + 1 },
    )
  }
  const truncations = [...grouped.entries()].sort(byKey).map(([, item]) => item)
  return { truncations, malformed }
}

/**
 * Aggregates `events` into the Observation Model. `skips` is what the recorder reported leaving out
 * (`createMemorySink().skips()`): it becomes `truncations`/`truncatedScopes`, which the Claims Model reads.
 */
export function buildObservationModel(
  events: readonly ObservationEvent[],
  skips: readonly ObservationSkip[] = [],
): ObservationModel {
  const grouped = new Map<string, Observation>()
  const ranges = new Map<string, Range | undefined>()
  const scopeRanges = new Map<string, Range | undefined>()
  let skipped = 0

  for (const raw of events) {
    const event = clean(raw)
    if (event === undefined) {
      skipped += 1
      continue
    }
    const id = `observation:${event.scope}|${event.kind}:${event.name}|${event.field}|${event.handling ?? "-"}`
    const existing = grouped.get(id)
    grouped.set(
      id,
      existing === undefined
        ? {
            id,
            scope: event.scope,
            boundary: { kind: event.kind, name: event.name },
            field: event.field,
            ...(event.handling === undefined ? {} : { handling: event.handling }),
            count: 1,
            status: "observed",
          }
        : { ...existing, count: existing.count + 1 },
    )
    ranges.set(id, widen(ranges.get(id), event.at))
    scopeRanges.set(event.scope, widen(scopeRanges.get(event.scope), event.at))
  }

  const observations = [...grouped.values()]
    .map((item): Observation => {
      const range = ranges.get(item.id)
      return range === undefined
        ? item
        : { ...item, firstSeen: iso(range.first), lastSeen: iso(range.last) }
    })
    .sort(compareById)
  const scopes = [...new Set(observations.map((observation) => observation.scope))].sort()
  const scopeTimes = scopes.flatMap((scope) => {
    const range = scopeRanges.get(scope)
    return range === undefined
      ? []
      : [{ scope, firstSeen: iso(range.first), lastSeen: iso(range.last) }]
  })
  const { truncations, malformed } = truncationsOf(skips)
  // The truncations are ordered by a key that starts with the scope and ends it with the lowest character, so their scopes already are.
  const truncatedScopes = [...new Set(truncations.map((item) => item.scope))]
  return {
    schemaVersion: OBSERVATION_MODEL_SCHEMA_VERSION,
    scopes,
    observations,
    ...(scopeTimes.length === 0 ? {} : { scopeTimes }),
    skipped: skipped + malformed,
    ...(truncations.length === 0 ? {} : { truncations, truncatedScopes }),
  }
}
