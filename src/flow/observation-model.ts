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
import type { ObservationEvent } from "../observe/index.js"

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
  /** Always `observed` (ADR 0071). */
  readonly status: "observed"
}

/** `data-cap`'s Observation Model. */
export interface ObservationModel {
  /** Always `OBSERVATION_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof OBSERVATION_MODEL_SCHEMA_VERSION
  /** Every distinct scope that contributed at least one observation, sorted. */
  readonly scopes: readonly string[]
  /** Every observation, ordered by id. */
  readonly observations: readonly Observation[]
  /** Events dropped as malformed -- stated, never silent. */
  readonly skipped: number
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
  }
}

/**
 * The path inside the field named `fieldName` that the observed capability-qualified name `observed` refers to
 * (`[]` for the whole field), or `undefined` when `observed` is about some other field. A name only counts when it
 * continues at a `.`: `userData.userExtra.email` is not inside `userData.user`.
 */
export function subpathWithin(fieldName: string, observed: string): string[] | undefined {
  if (observed === fieldName) return []
  return observed.startsWith(`${fieldName}.`)
    ? observed.slice(fieldName.length + 1).split(".")
    : undefined
}

/** Aggregates `events` into the Observation Model. */
export function buildObservationModel(events: readonly ObservationEvent[]): ObservationModel {
  const grouped = new Map<string, Observation>()
  let skipped = 0

  for (const raw of events) {
    const event = clean(raw)
    if (event === undefined) {
      skipped += 1
      continue
    }
    const id = `observation:${event.scope}|${event.kind}:${event.name}|${event.field}|${event.handling ?? "-"}`
    const existing = grouped.get(id)
    if (existing !== undefined) {
      grouped.set(id, { ...existing, count: existing.count + 1 })
      continue
    }
    grouped.set(id, {
      id,
      scope: event.scope,
      boundary: { kind: event.kind, name: event.name },
      field: event.field,
      ...(event.handling === undefined ? {} : { handling: event.handling }),
      count: 1,
      status: "observed",
    })
  }

  const observations = [...grouped.values()].sort(compareById)
  return {
    schemaVersion: OBSERVATION_MODEL_SCHEMA_VERSION,
    scopes: [...new Set(observations.map((observation) => observation.scope))].sort(),
    observations,
    skipped,
  }
}
