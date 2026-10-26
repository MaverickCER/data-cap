/**
 * `data-cap`'s runtime-observation entry point (`data-cap/observe`, ADR 0072).
 *
 * Records which fields were seen crossing which boundary, into a
 * caller-supplied sink. Deliberately tiny and isomorphic: no `node:fs`, no
 * `typescript`, no build module, no timers, no global hooks -- it never opens
 * a file, socket or connection of its own. An event carries a scope id, a
 * boundary, and a field *name*; it never carries a field value, and any key
 * outside that shape is dropped on the way in.
 *
 * Observations reach the Evidence Model only through the build
 * (`buildObservationModel`), which joins them to static flow facts. Observed
 * behavior is evidence of what happened in the scopes that ran; it does not
 * prove that every static path is safe.
 */

import type { FlowBoundaryKind, FlowHandling } from "../flow/flow-model.js"

/** What kind of boundary was crossed and its stable name (matches a `boundary` node of the Flow Model). */
export interface ObservedBoundary {
  readonly kind: FlowBoundaryKind
  readonly name: string
}

/** One observation: a field name was seen at a boundary during one scope. Never a value. */
export interface ObservationEvent {
  /** Caller-supplied id of the execution or test the event was seen in. */
  readonly scope: string
  readonly boundary: ObservedBoundary
  /** Capability-qualified dotted field path, for example `userData.user.email` -- the same naming the static Flow Model uses for field nodes. */
  readonly field: string
  /** Declared handling of the value at this crossing, when the caller knows it. */
  readonly handling?: FlowHandling
}

/** Where events go. The package never provides one that does I/O. */
export interface ObservationSink {
  record(event: ObservationEvent): void
}

/** What a caller passes to `observeBoundary`. */
export interface ObserveBoundaryInput {
  readonly scope: string
  readonly boundary: ObservedBoundary
  /** The capability's export name, used to qualify each field path. */
  readonly capability: string
  /** Field paths (key names only) observed at the boundary. */
  readonly fields: readonly (readonly string[])[]
  readonly handling?: FlowHandling
}

/** The one place a capability-qualified field name is formed. */
export function fieldPathName(capability: string, path: readonly string[]): string {
  return [capability, ...path].join(".")
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isNamedBoundary(boundary: unknown): boolean {
  return (
    typeof boundary === "object" &&
    boundary !== null &&
    isName((boundary as { name?: unknown }).name)
  )
}

function isPath(path: unknown): path is readonly string[] {
  return Array.isArray(path) && path.length > 0 && path.every(isName)
}

/**
 * Records one event per valid field path and returns how many it recorded.
 * Never throws: invalid input records nothing, and a throwing sink stops
 * recording without propagating (observation must not break the observed
 * program).
 */
export function observeBoundary(sink: ObservationSink, input: ObserveBoundaryInput): number {
  if (!isName(input.scope) || !isName(input.capability) || !isNamedBoundary(input.boundary)) {
    return 0
  }
  let recorded = 0
  for (const path of input.fields) {
    if (!isPath(path)) continue
    const event: ObservationEvent = {
      scope: input.scope,
      boundary: { kind: input.boundary.kind, name: input.boundary.name },
      field: fieldPathName(input.capability, path),
      ...(input.handling === undefined ? {} : { handling: input.handling }),
    }
    try {
      sink.record(event)
    } catch {
      return recorded
    }
    recorded += 1
  }
  return recorded
}

/** An in-memory sink -- the only one this package provides. */
export function createMemorySink(): {
  readonly sink: ObservationSink
  events(): readonly ObservationEvent[]
} {
  const events: ObservationEvent[] = []
  return {
    sink: {
      record(event) {
        events.push(event)
      },
    },
    events: () => [...events],
  }
}
