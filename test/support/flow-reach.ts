import type { FlowModelInput } from "../../src/flow/flow-model.js"
import {
  dump,
  edgeLine,
  fieldId,
  handler,
  makeHarness,
  probes,
} from "../build/mut-flow-scan-harness.js"
import type { Harness } from "../build/mut-flow-scan-harness.js"

export { fieldId, handler, makeHarness, probes }
export type { Harness }

/**
 * The facts of a scan that say where data went, one line each: calls, argument and return passing, boundary crossings
 * and every unknown. (`reads` and `discards` edges and nodes are left out: they restate what the others imply.)
 */
export function facts(input: FlowModelInput): string[] {
  const kinds = new Set(["calls", "passes", "returns", "side-effect"])
  return [
    ...input.edges.filter((edge) => kinds.has(edge.kind)).map((edge) => `E ${edgeLine(edge)}`),
    ...dump(input).filter((line) => line.startsWith("U ")),
  ]
}

/** `path|status` of every edge into a boundary, in order: what reached a sink and how surely. */
export function effects(input: FlowModelInput): string[] {
  return input.edges
    .filter((edge) => edge.kind === "side-effect")
    .map((edge) => `${edge.path === undefined ? "" : edge.path.join(".")}|${edge.status}`)
}

/** `reason line:column` of every unknown. */
export function reasons(input: FlowModelInput): string[] {
  return input.unknowns.map(
    (unknown) => `${unknown.reason} ${unknown.source.line}:${unknown.source.column}`,
  )
}

/** The data every unknown concerns, as `path` per entry. */
export function unknownData(input: FlowModelInput): string[][] {
  return input.unknowns.map((unknown) => (unknown.data ?? []).map((item) => item.path.join(".")))
}

/** Just the reason of every unknown, in order. */
export function reasonNames(input: FlowModelInput): string[] {
  return input.unknowns.map((unknown) => unknown.reason)
}
