/**
 * Runtime observation, the way an application would wire it (ADR 0072).
 *
 * `observedResponse` wraps the response object a handler writes to. When the
 * handler calls `json(body)` it records, with `data-cap/observe`, which KEYS of
 * the body went out at the `client-response` boundary -- names only, never the
 * values. The wrapper is told which capability field the body was built from
 * (`userData.user`), because only the application knows that; the static
 * analysis does not need to be told.
 *
 * `recordScenario` then runs the real handlers once each, as a test would, and
 * returns what was seen. Those events are what `--observations` ingests.
 */
import { createMemorySink, observeBoundary } from "data-cap/observe"
import type { ObservationEvent, ObservationSink } from "data-cap/observe"
import { exportEverything } from "./app/export.js"
import type { Respond } from "./app/profile.js"
import { profileHandler } from "./app/profile.js"
import { trackUser } from "./app/track.js"
import { userData } from "./features/user.capability.js"

/** A response whose `json()` records the keys it sends. */
export function observedResponse(sink: ObservationSink, scope: string): Respond {
  return {
    json(value: unknown): void {
      if (typeof value !== "object" || value === null) return
      observeBoundary(sink, {
        scope,
        boundary: { kind: "client-response", name: "http-response" },
        capability: "userData",
        fields: Object.keys(value).map((key) => ["user", key]),
      })
    },
  }
}

/** Runs each handler once against a recording response and returns every observation. */
export async function recordScenario(): Promise<readonly ObservationEvent[]> {
  const memory = createMemorySink()
  await userData.getUser({ id: "1" })
  profileHandler(observedResponse(memory.sink, "scenario:profile"))
  exportEverything(observedResponse(memory.sink, "scenario:debug-export"))
  // The analytics SDK has no instrumented boundary, so nothing about it is observed -- and the evidence says so.
  trackUser()
  return memory.events()
}
