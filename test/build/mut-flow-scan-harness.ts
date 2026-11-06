import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowModelInput } from "../../src/flow/flow-model.js"
import { defaultScanLimits, scanFlowWithin } from "../../src/build/flow-scan.js"
import type { FlowSinkPattern } from "../../src/build/flow-scan.js"
import type { ScanFlowOptions, ScanFlowResult, ScanLimits } from "../../src/build/flow-scan.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

export const CAP_FILE = "features/user/user.ts"
export const USER_SHAPE = { id: "", name: "", email: "", passwordHash: "", role: "" }

export function field(
  name: string,
  shape: unknown,
  extra: Partial<FieldNode> = {},
  sensitivity?: string,
): FieldNode {
  return {
    path: [name],
    docs: undefined,
    owner: { value: undefined, declaredOn: undefined },
    sensitivity: {
      value: sensitivity,
      declaredOn: sensitivity === undefined ? undefined : "capability",
    },
    purpose: { value: undefined, declaredOn: undefined },
    legalBasis: { value: undefined, declaredOn: undefined },
    dataResidency: { value: undefined, declaredOn: undefined },
    auditRequired: { value: undefined, declaredOn: undefined },
    declarationPosition: undefined,
    writtenBy: [],
    shape,
    ...extra,
  }
}

export function operation(
  kind: OperationNode["kind"],
  name: string,
  overrides: Partial<OperationNode> = {},
): OperationNode {
  return {
    kind,
    name,
    docs: undefined,
    writes: [],
    hasProcessor: false,
    hasOptimistic: false,
    endpoints: [],
    ...overrides,
  }
}

export function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: CAP_FILE,
    exportName: "userData",
    kind: "createData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields: [
      field("user", USER_SHAPE, {}, "secret"),
      field("team", { name: "" }),
      field("tags", [{ label: "", secret: "" }]),
      field("empty", []),
    ],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

export function inventoryOf(...capabilities: CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

export const CAP_SOURCE = `export const userData = createData({ fields: { user: {} } });\n`
export const IMPORT_CAP = `import { userData } from "../features/user/user.js";\n`
export const USER = "userData.getSnapshot().fields.user"
export const fieldId = (name: string): string => flowNodeId("field", CAP_FILE, `userData.${name}`)

/** The exact content of a scan, one line per fact, in insertion order. */
/** `!undef:<keys>` for every key an object carries with the value `undefined` -- a present-but-undefined key is a different fact from an absent one. */
function undefinedKeys(value: object): string {
  const keys = Object.entries(value)
    .filter(([, v]) => v === undefined)
    .map(([k]) => k)
  return keys.length === 0 ? "" : ` !undef:${keys.join(",")}`
}

export function dump(input: FlowModelInput): string[] {
  const lines: string[] = []
  const ids = new Set(input.nodes.map((n) => flowNodeId(n.kind, n.scope, n.name)))
  for (const n of input.nodes) {
    lines.push(
      [
        "N",
        n.kind,
        n.scope,
        n.name,
        n.status,
        `bk=${n.boundaryKind ?? ""}`,
        `cl=${n.classification ?? ""}`,
        `src=${n.source === undefined ? "" : `${n.source.line}:${n.source.column}`}`,
      ].join(" ") + undefinedKeys(n),
    )
  }
  for (const e of input.edges) {
    lines.push(`E ${edgeLine(e)}${undefinedKeys(e)}`)
    for (const end of [e.from, e.to]) if (!ids.has(end)) lines.push(`!DANGLING edge end ${end}`)
  }
  for (const u of input.unknowns) {
    lines.push(
      [
        "U",
        u.reason,
        `${u.source.file}:${u.source.line}:${u.source.column}`,
        `subject=${u.subject}`,
        `detail=${u.detail ?? ""}`,
        `data=${(u.data ?? []).map((d) => `${d.origin}/${d.path.join(".")}`).join(",")}`,
      ].join(" ") + undefinedKeys(u),
    )
    if (u.subject !== undefined && !ids.has(u.subject))
      lines.push(`!DANGLING unknown subject ${u.subject}`)
  }
  return lines
}

export function edgeLine(e: FlowEdgeInput): string {
  return [
    e.kind,
    `${e.from}->${e.to}`,
    `p=${e.path === undefined ? "-" : e.path.join(".")}`,
    e.status,
    `o=${e.origin ?? ""}`,
    `h=${e.handling ?? ""}`,
    `@${e.source === undefined ? "" : `${e.source.file}:${e.source.line}:${e.source.column}`}`,
  ].join(" ")
}

export interface Harness {
  scan(
    files: Record<string, string>,
    overrides?: Partial<ScanFlowOptions>,
    inventory?: CapabilityInventory,
    limits?: Partial<ScanLimits>,
  ): Promise<ScanFlowResult>
  /** As `scan`, with every `res.json(` rewritten to its own sink (see `distinctSinks`). */
  scanDistinct(
    files: Record<string, string>,
    overrides?: Partial<ScanFlowOptions>,
    inventory?: CapabilityInventory,
    limits?: Partial<ScanLimits>,
  ): Promise<ScanFlowResult>
  root(): string
  cleanup(): Promise<void>
}

export async function makeHarness(): Promise<Harness> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-mut-flow-scan-")),
  )
  const harness: Harness = {
    root: () => root,
    async scanDistinct(files, overrides = {}, inventory = inventoryOf(capability()), limits = {}) {
      const { files: rewritten, sinks } = distinctSinks(files)
      return harness.scan(rewritten, { sinks, ...overrides }, inventory, limits)
    },
    async scan(files, overrides = {}, inventory = inventoryOf(capability()), limits = {}) {
      const absolute: string[] = []
      for (const [relative, content] of Object.entries({ [CAP_FILE]: CAP_SOURCE, ...files })) {
        const filePath = path.join(root, relative)
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, content, "utf8")
        absolute.push(filePath)
      }
      return scanFlowWithin(
        {
          inventory,
          files: absolute,
          fs: nodeBuildFs,
          root,
          tsconfig: false,
          ...overrides,
        },
        { ...defaultScanLimits(), ...limits },
      )
    },
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true })
    },
  }
  return harness
}

/** Several independent probes, each in its own function `p0`, `p1`, ... of one file. */
export const probes = (bodies: readonly string[], extra = ""): Record<string, string> => ({
  "app/p.ts": `${IMPORT_CAP}${extra}${bodies
    .map((body, i) => `export function p${i}(res: any, key: string) {\n${body}\n}\n`)
    .join("")}`,
})

/** One handler file: `h(res, key)` with the given body. */
export const handler = (body: string, extra = ""): Record<string, string> => ({
  "app/p.ts": `${IMPORT_CAP}${extra}export function h(res: any, key: string) {\n${body}\n}\n`,
})

/** How many distinct sinks `distinctSinks` can hand out. */
const SINK_COUNT = 60

/**
 * Rewrites every `res.json(` in `sources` to its own sink (`o0.emit(`, `o1.emit(`, ...) -- edges to one boundary from
 * one function with one path are merged, which would hide every probe after the first.
 */
export function distinctSinks(sources: Record<string, string>): {
  files: Record<string, string>
  sinks: FlowSinkPattern[]
} {
  let n = 0
  const files: Record<string, string> = {}
  for (const [name, text] of Object.entries(sources))
    files[name] = text.replace(/res\.json\(/g, () => `o${n++}.emit(`)
  if (n > SINK_COUNT) throw new Error("too many probes")
  const sinks = Array.from({ length: SINK_COUNT }, (_, i) => ({
    callee: `o${i}.emit`,
    boundary: { kind: "log" as const, name: `b${i}` },
  }))
  return { files, sinks }
}
