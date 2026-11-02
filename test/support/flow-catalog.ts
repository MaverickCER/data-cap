import { buildFlowModel } from "../../src/flow/flow-model.js"
import { traceFlow } from "../../src/flow/flow-projections.js"
import type { FlowTrace } from "../../src/flow/flow-projections.js"
import { fieldId, IMPORT_CAP, makeHarness } from "../build/mut-flow-scan-harness.js"
import type { Harness } from "../build/mut-flow-scan-harness.js"

/**
 * What a project that leaks exactly one field of `userData.user` ends up as in the evidence:
 *
 * - `A` followed: the trace of the leaked field reaches a sink boundary, is complete, and the other field's trace does not.
 * - `B` honest unknown: the leaked field's trace is reported incomplete (and the unknown concerns that field).
 * - `W` whole record: complete, and both fields reach the sink -- right for a form that really sends the whole record.
 * - `C` silently safe or wrong: a complete trace that misses the leak.
 */
export type FormClass = "A" | "B" | "C" | "W"

export interface Classified {
  readonly cls: FormClass
  readonly reaches: boolean
  readonly otherReaches: boolean
  readonly complete: boolean
  readonly otherComplete: boolean
  readonly unknownReasons: readonly string[]
}

/** The leaked field of a catalog form, and a sibling field that must stay clean. */
export interface Fields {
  readonly leaked: string
  readonly other: string
}

const reachesSink = (trace: FlowTrace): boolean =>
  trace.nodes.some((node) => node.kind === "boundary")

export function classifyScan(
  input: Parameters<typeof buildFlowModel>[0],
  fields: Fields,
): Classified {
  const model = buildFlowModel(input)
  const leaked = traceFlow(model, fieldId("user"), "downstream", { path: [fields.leaked] })
  const other = traceFlow(model, fieldId("user"), "downstream", { path: [fields.other] })
  const reaches = reachesSink(leaked)
  const otherReaches = reachesSink(other)
  const cls: FormClass = !leaked.complete ? "B" : reaches ? (otherReaches ? "W" : "A") : "C"
  return {
    cls,
    reaches,
    otherReaches,
    complete: leaked.complete,
    otherComplete: other.complete,
    unknownReasons: leaked.unknowns.map((unknown) => unknown.reason),
  }
}

/** Writes `files` into a fresh project, scans it, and classifies the result. */
export async function classifyProject(
  files: Record<string, string>,
  fields: Fields,
  harness?: Harness,
): Promise<Classified> {
  const own = harness ?? (await makeHarness())
  try {
    const result = await own.scan(files)
    return classifyScan(result.input, fields)
  } finally {
    if (harness === undefined) await own.cleanup()
  }
}

/** The whole `user` field. */
export const USER = "userData.getSnapshot().fields.user"

/** `userData.getSnapshot().fields.user.<field>` */
export const userField = (field: string): string => `userData.getSnapshot().fields.user.${field}`

/** A project file `app/p.ts` holding one exported function `h(res, key)`; `extra` is declared above it. */
export function fn(body: string, extra = "", keyword = ""): Record<string, string> {
  return {
    "app/p.ts": `${IMPORT_CAP}${extra}export ${keyword}function h(res: any, key: string) {\n${body}\n}\n`,
  }
}

/** A project file `app/p.ts` that only declares `extra` (module level), no handler. */
export function module(extra: string, imports = ""): Record<string, string> {
  return { "app/p.ts": `${IMPORT_CAP}${imports}${extra}\n` }
}
