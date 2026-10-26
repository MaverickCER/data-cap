import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId } from "../../src/flow/flow-model.js"
import type { FlowModel } from "../../src/flow/flow-model.js"
import { traceFlow } from "../../src/flow/flow-projections.js"
import { scanFlow } from "../../src/build/flow-scan.js"
import type { ScanFlowOptions } from "../../src/build/flow-scan.js"
import type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
} from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

const CAP_FILE = "features/user/user.ts"
const USER_SHAPE = { id: "", name: "", email: "", passwordHash: "", role: "" }

function field(name: string, shape: unknown): FieldNode {
  return {
    path: [name],
    docs: undefined,
    owner: { value: undefined, declaredOn: undefined },
    sensitivity: { value: undefined, declaredOn: undefined },
    purpose: { value: undefined, declaredOn: undefined },
    legalBasis: { value: undefined, declaredOn: undefined },
    dataResidency: { value: undefined, declaredOn: undefined },
    auditRequired: { value: undefined, declaredOn: undefined },
    declarationPosition: undefined,
    writtenBy: [],
    shape,
  }
}

function operation(
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

function capability(overrides: Partial<CapabilityNode> = {}): CapabilityNode {
  return {
    file: CAP_FILE,
    exportName: "userData",
    kind: "createData",
    docs: undefined,
    active: true,
    exclusiveGroup: undefined,
    declarationPosition: { line: 1, column: 1 },
    fields: [
      field("user", USER_SHAPE),
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

function inventoryOf(...capabilities: CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

const CAP_SOURCE = `export const userData = createData({ fields: { user: {} } });\n`
const IMPORT_CAP = `import { userData } from "../features/user/user.js";\n`
const fieldId = (name: string): string => flowNodeId("field", CAP_FILE, `userData.${name}`)
const fnId = (file: string, name: string): string => flowNodeId("function", file, name)

describe("scanFlow statement and expression coverage", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-flow-scan-cov-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function scan(
    files: Record<string, string>,
    overrides: Partial<ScanFlowOptions> = {},
    inventory: CapabilityInventory = inventoryOf(capability()),
  ) {
    const absolute: string[] = []
    for (const [relative, content] of Object.entries({ [CAP_FILE]: CAP_SOURCE, ...files })) {
      const filePath = path.join(root, relative)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, "utf8")
      absolute.push(filePath)
    }
    const result = await scanFlow({
      inventory,
      files: absolute,
      fs: nodeBuildFs,
      root,
      tsconfig: false,
      ...overrides,
    })
    const model: FlowModel = buildFlowModel(result.input)
    return { result, model }
  }

  /** Paths of the userData.<name> field that reach the http-response boundary. */
  function responsePaths(model: FlowModel, fieldName: string): string[] {
    const paths = model.edges
      .filter(
        (e) =>
          e.kind === "side-effect" &&
          e.origin === fieldId(fieldName) &&
          model.nodes.find((n) => n.id === e.to)?.name === "http-response",
      )
      .map((e) => (e.path ?? []).join("."))
    return [...new Set(paths)].sort()
  }

  const reaches = (model: FlowModel, fieldName: string, p: string[]): boolean =>
    traceFlow(model, fieldId(fieldName), "downstream", { path: p }).nodes.some(
      (node) => node.kind === "boundary" && node.name === "http-response",
    )

  const handler = (body: string): Record<string, string> => ({
    "app/p.ts": `${IMPORT_CAP}export function h(res: any, key: string) {\n${body}\n}\n`,
  })

  describe("statements", () => {
    it("follows data through for-of, for-in, classic for, while, do, switch, try, labels and throw", async () => {
      const { model } = await scan(
        handler(`
  for (const item of [userData.fields.user.email]) { res.json(item) }
  let each: any
  for (each of [userData.fields.user.name]) { res.json(each) }
  for (const k in userData.fields.user) { res.json(k) }
  for (let i = userData.fields.user.id, j = 0; i; j++) { res.json(i) }
  for (; false; ) { res.json(1) }
  for (j = 0; ; ) { break }
  while (userData.fields.user.role) { res.json(userData.fields.team.name) }
  do { res.json(userData.fields.user.role) } while (userData.fields.user.id)
  switch (userData.fields.user.id) {
    case userData.fields.team.name: res.json(userData.fields.user.id); break
    default: res.json(userData.fields.user.passwordHash)
  }
  try { res.json(userData.fields.tags) } catch (err) { res.json(err) } finally { res.json(userData.fields.empty) }
  try { res.json(1) } catch { res.json(2) }
  label: res.json(userData.fields.user.passwordHash)
  throw new Error(userData.fields.user.id)
`),
      )
      expect(responsePaths(model, "user")).toEqual(
        expect.arrayContaining(["email", "name", "id", "role", "passwordHash"]),
      )
      expect(responsePaths(model, "team")).toEqual(["name"])
      expect(responsePaths(model, "tags")).toEqual([""])
      expect(responsePaths(model, "empty")).toEqual([""])
    })

    it("walks a for-in over tracked data without forwarding its keys as data", async () => {
      const { model } = await scan(
        handler(
          `  for (const k in userData.fields.user) { res.json(k) }\n  const copy = userData.fields.team\n  res.json(copy.name)`,
        ),
      )
      expect(responsePaths(model, "user")).toEqual([])
      expect(responsePaths(model, "team")).toEqual(["name"])
    })

    it("registers a nested function declaration as a callable local", async () => {
      const { model } = await scan(
        handler(
          `  function inner(v: any) { return v.email }\n  res.json(inner(userData.fields.user))`,
        ),
      )
      expect(responsePaths(model, "user")).toEqual(["email"])
      expect(model.nodes.some((n) => n.kind === "function" && n.name.startsWith("h>inner@"))).toBe(
        true,
      )
    })

    it("ignores statements it does not model (class, enum, type alias inside a body)", async () => {
      const { model } = await scan(
        handler(
          `  type T = string\n  enum E { A }\n  class C {}\n  res.json(userData.fields.user.id)`,
        ),
      )
      expect(responsePaths(model, "user")).toEqual(["id"])
    })

    it("runs module-level statements, including exported const non-functions", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}const early = userData.fields.user.email\nexport const fresh = () => 1, value = 2\nexport function h(res: any) { res.json(early) }\n`,
      })
      expect(responsePaths(model, "user")).toEqual(["email"])
    })
  })

  describe("binding", () => {
    it("binds array destructuring, rest, omitted holes and defaults", async () => {
      const { model } = await scan(
        handler(`  const [first, , ...others] = [userData.fields.user.email, 1, userData.fields.user.name]
  res.json(first)
  res.json(others)`),
      )
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["email", "name"]))
    })

    it("treats a computed destructuring key as a dynamic access over the whole value", async () => {
      const { model } = await scan(
        handler(`  const { [key]: picked } = userData.fields.user\n  res.json(picked)`),
      )
      expect(reaches(model, "user", ["email"])).toBe(true)
    })

    it("applies a destructuring default alongside the member", async () => {
      const { model } = await scan(
        handler(
          `  const { email = userData.fields.team.name } = userData.fields.user\n  res.json(email)`,
        ),
      )
      expect(responsePaths(model, "user")).toEqual(["email"])
      expect(responsePaths(model, "team")).toEqual(["name"])
    })

    it("binds parameter defaults, rest parameters and destructured parameters", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}function pick(a: any = userData.fields.team.name, ...rest: any[]) { return [a, rest] }
function unpack({ email }: any, [x]: any[]) { return [email, x] }
export function h(res: any) {
  res.json(pick(undefined, userData.fields.user.id))
  res.json(unpack(userData.fields.user, [userData.fields.user.role]))
}
`,
      })
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["id", "email", "role"]))
      expect(responsePaths(model, "team")).toEqual(["name"])
    })
  })

  describe("expressions", () => {
    it("handles logical, compound assignment and arithmetic operators", async () => {
      const { model } = await scan(
        handler(`  let a: any = userData.fields.user.email
  a ||= userData.fields.user.name
  a &&= userData.fields.user.id
  a ??= userData.fields.user.role
  a += userData.fields.team.name
  const b = a && userData.fields.user.passwordHash
  const c = (userData.fields.user.id as any) ?? 1
  const d = userData.fields.user.id - 1
  res.json([b, c, d, userData.fields.user.id === 1, -userData.fields.user.id, typeof userData.fields.user.id])`),
      )
      const paths = responsePaths(model, "user")
      expect(paths).toEqual(expect.arrayContaining(["email", "name", "id", "role", "passwordHash"]))
    })

    it("tags, templates, new expressions and satisfies/assertion wrappers", async () => {
      const { model } = await scan(
        handler(`  const t = String.raw\`x\${userData.fields.user.email}\`
  res.json(t)
  res.json((userData.fields.user.name as any))
  res.json(userData.fields.user.id satisfies string)
  res.json(userData.fields.user.role!)
  res.json(new Thing(userData.fields.team.name))
  res.json(void userData.fields.user.passwordHash)
  res.json(delete (userData.fields.user as any).passwordHash)`),
      )
      expect(responsePaths(model, "user")).toEqual(
        expect.arrayContaining(["email", "name", "id", "role"]),
      )
      expect(model.unknowns.map((u) => u.reason)).toContain("unresolved-call")
    })

    it("tags a template literal with no substitutions as empty", async () => {
      const { model } = await scan(handler("  res.json(tag`plain`)"))
      expect(model.unknowns).toEqual([])
    })

    it("writes through property and element assignment on a local object", async () => {
      const { model } = await scan(
        handler(`  const o: any = {}
  o.email = userData.fields.user.email
  o["name"] = userData.fields.user.name
  o[key] = userData.fields.user.id
  ;(o as any).role = userData.fields.user.role
  ;[o.x] = [userData.fields.user.passwordHash]
  ;({ y: o.y } = { y: 1 })
  res.json(o.email)
  res.json(o.name)`),
      )
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["email", "name"]))
    })

    it("an assignment to a non-local base stores nothing", async () => {
      const { model } = await scan(
        handler(`  res.other.a = userData.fields.user.email\n  res.json(res.other.a)`),
      )
      expect(responsePaths(model, "user")).toEqual([])
    })

    it("object literals: shorthand, spreads, computed keys, methods, duplicates", async () => {
      const { model } = await scan(
        handler(`  const id = userData.fields.user.id
  const base = { role: userData.fields.user.role }
  const o = {
    id,
    ...base,
    [key]: userData.fields.user.email,
    dup: userData.fields.user.name,
    dup: userData.fields.team.name,
    method() { return userData.fields.user.passwordHash },
    1: 2,
    noBody: 1,
  }
  res.json(o.id)
  res.json(o.role)
  res.json(o.dup)
  res.json(o.method())`),
      )
      expect(responsePaths(model, "user")).toEqual(
        expect.arrayContaining(["id", "role", "name", "email"]),
      )
      expect(responsePaths(model, "team")).toEqual(["name"])
    })

    it("an element access with a numeric literal is an element step; a computed access on untracked data is empty", async () => {
      const { model } = await scan(
        handler(`  res.json(userData.fields.tags[0].label)
  const local = { a: 1 }
  res.json(local[key])`),
      )
      expect(responsePaths(model, "tags")).toEqual(["[].label"])
      expect(model.unknowns).toEqual([])
    })

    it("a field with an array shape: its element paths and an empty array shape", async () => {
      const { model } = await scan(
        handler(
          `  const [t] = userData.fields.tags\n  res.json(t.secret)\n  res.json(userData.fields.empty[0])`,
        ),
      )
      expect(responsePaths(model, "tags")).toEqual(["[].secret"])
      expect(responsePaths(model, "empty")).toEqual(["[]"])
    })

    it("reading a field the capability does not declare yields nothing", async () => {
      const { model } = await scan(handler(`  res.json(userData.fields.nope)`))
      expect(model.edges.filter((e) => e.kind === "side-effect")).toEqual([])
    })

    it("reading a capability member other than fields yields nothing", async () => {
      const { model } = await scan(
        handler(`  res.json(userData.other)\n  res.json(userData.notAnOp())`),
      )
      expect(model.edges.filter((e) => e.kind === "side-effect")).toEqual([])
    })
  })

  describe("variables and scopes", () => {
    it("a closure assigning an outer variable updates the outer binding", async () => {
      const { model } = await scan(
        handler(`  let out: any = 0
  const set = () => { out = userData.fields.user.email }
  set()
  res.json(out)`),
      )
      expect(responsePaths(model, "user")).toEqual(["email"])
    })

    it("reassigning merges with what the variable already held; an undeclared name is defined", async () => {
      const { model } = await scan(
        handler(`  let a: any = userData.fields.user.email
  a = userData.fields.user.name
  undeclared = userData.fields.user.id
  res.json(a)
  res.json(undeclared)`),
      )
      expect(responsePaths(model, "user")).toEqual(["email", "id", "name"])
    })

    it("if statements follow both branches; a for-of with a destructuring target binds nothing", async () => {
      const { model } = await scan(
        handler(`  if (userData.fields.user.role) { res.json(userData.fields.user.email) } else { res.json(userData.fields.user.name) }
  if (key) res.json(userData.fields.user.id)
  let a: any, b: any
  for ([a, b] of [userData.fields.user.passwordHash]) { res.json(a) }
  return
`),
      )
      // The condition `role` is read, not forwarded; the destructuring for-of target binds nothing.
      expect(responsePaths(model, "user")).toEqual(["email", "id", "name"])
    })

    it("try/finally without a catch, and a catch without a binding, are both walked", async () => {
      const { model } = await scan(
        handler(`  try { res.json(userData.fields.user.email) } finally { res.json(userData.fields.user.name) }
  try { res.json(userData.fields.user.id) } catch { res.json(userData.fields.user.role) }`),
      )
      expect(responsePaths(model, "user")).toEqual(["email", "id", "name", "role"])
    })
  })

  describe("calls", () => {
    it("global conversion functions keep the data approximately; structuredClone keeps it exactly", async () => {
      const { model } = await scan(
        handler(`  res.json(String(userData.fields.user.email))
  res.json(structuredClone(userData.fields.user.name))`),
      )
      const edges = model.edges.filter((e) => e.kind === "side-effect")
      expect(edges.find((e) => e.path?.join(".") === "email")?.status).toBe("inferred")
      expect(edges.find((e) => e.path?.join(".") === "name")?.status).toBe("static")
    })

    it("builtin namespace methods: keys is empty, assign exact, JSON approximate", async () => {
      const { model } = await scan(
        handler(`  res.json(Object.keys(userData.fields.user))
  res.json(Object.assign({}, userData.fields.user.name))
  res.json(JSON.stringify(userData.fields.user.email))`),
      )
      const edges = model.edges.filter((e) => e.kind === "side-effect")
      expect(edges.map((e) => `${e.path?.join(".")}:${e.status}`).sort()).toEqual([
        "email:inferred",
        "name:static",
      ])
    })

    it("a shadowed builtin root is not treated as a builtin", async () => {
      const { model } = await scan(
        handler(`  const JSON: any = { stringify: (v: any) => v }
  res.json(JSON.stringify(userData.fields.user.email))`),
      )
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    })

    it("an immediately-invoked function expression and an anonymous callback are analyzed", async () => {
      const { model } = await scan(
        handler(`  res.json((function (v: any) { return v.email })(userData.fields.user))
  res.json(((v: any) => v.name)(userData.fields.user))`),
      )
      expect(responsePaths(model, "user")).toEqual(["email", "name"])
    })

    it("a parenthesized conditional callee of two different functions is an explicit unknown", async () => {
      const { model } = await scan(
        handler(
          `  res.json((key ? (v: any) => v.email : (v: any) => v.name)(userData.fields.user))`,
        ),
      )
      expect(model.unknowns.map((unknown) => unknown.reason)).toContain("unresolved-call")
    })

    it("then/catch/finally run their callbacks; only then receives the value", async () => {
      const { model } = await scan(
        handler(`  Promise.resolve(userData.fields.user)
    .then((u: any) => res.json(u.email))
    .catch((e: any) => res.json(e))
    .finally(() => res.json(userData.fields.team.name))
  const p: any = userData.fields.user.id
  res.json(p.then(unknownHandler))
  res.json(p.then())
  res.json(p.then(undefined, (e: any) => e))`),
      )
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["email", "id"]))
      expect(responsePaths(model, "team")).toEqual(["name"])
    })

    it("array callbacks: map, flatMap, filter, find and sort forward the elements", async () => {
      const { model } = await scan(
        handler(`  const a: any[] = [userData.fields.user.email]
  const b: any[] = [userData.fields.user.name]
  const c: any[] = [userData.fields.user.id]
  const d: any[] = [userData.fields.user.role]
  const e: any[] = [userData.fields.user.passwordHash]
  res.json(a.map((r) => r))
  res.json(b.flatMap((r) => [r]))
  res.json(c.filter((r) => r))
  res.json(d.find((r) => r))
  res.json(e.sort((l, r) => 0))`),
      )
      expect(responsePaths(model, "user")).toEqual(["email", "id", "name", "passwordHash", "role"])
    })

    it("forEach and predicate callbacks return nothing, with or without a resolvable callback", async () => {
      const { model } = await scan(
        handler(`  const a: any[] = [userData.fields.user.email]
  const b: any[] = [userData.fields.user.name]
  const c: any[] = [userData.fields.user.id]
  const d: any[] = [userData.fields.user.role]
  const e: any[] = [userData.fields.team.name]
  res.json(a.forEach((r) => r))
  res.json(b.some((r) => r))
  res.json(c.every((r) => r))
  res.json(d.some(unknownFn))
  res.json(e.forEach(unknownFn))
  res.json(e.findIndex(unknownFn))`),
      )
      expect(responsePaths(model, "user")).toEqual([])
      expect(responsePaths(model, "team")).toEqual([])
      expect(model.unknowns).toEqual([])
    })

    it("map with a callback it cannot resolve is an unresolved call", async () => {
      const { model } = await scan(
        handler(`  const a: any[] = [userData.fields.user.email]
  res.json(a.map(unknownFn))`),
      )
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
      expect(responsePaths(model, "user")).toEqual(["email"])
    })

    it("reduce passes the accumulator and the element, and merges the initial value", async () => {
      const { model } = await scan(
        handler(`  const rows: any[] = [userData.fields.user.email]
  res.json(rows.reduce((acc, r) => acc + r, userData.fields.user.name))
  res.json(rows.reduce((acc, r) => acc))`),
      )
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["email", "name"]))
      expect(
        model.edges.filter((e) => e.kind === "side-effect").every((e) => e.status === "inferred"),
      ).toBe(true)
    })

    it("push and unshift store the pushed value as an element of the array variable", async () => {
      const { model } = await scan(
        handler(`  const list: any[] = []
  list.push(userData.fields.user.email)
  list.unshift(userData.fields.user.name)
  res.json(list[0])
  res.other.push(userData.fields.user.id)`),
      )
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["email", "name"]))
    })

    it("call, apply and bind on a project function are unresolved, with the data they received", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}function target(v: any) { return v }
export function h(res: any) {
  res.json(target.call(null, userData.fields.user.email))
  res.json(target.apply(null, [userData.fields.user.name]))
  res.json(target.bind(null, userData.fields.user.id)())
}
`,
      })
      expect(model.unknowns.map((u) => u.reason)).toEqual(
        expect.arrayContaining(["unresolved-call"]),
      )
      expect(model.unknowns.flatMap((u) => u.data ?? []).map((d) => d.path.join("."))).toEqual(
        expect.arrayContaining(["email", "name", "id"]),
      )
    })

    it("predicates, shape-preserving and transforming string/array methods", async () => {
      const { model } = await scan(
        handler(`  const s: any = userData.fields.user
  res.json(s.includes("x"))
  res.json(s.slice(1))
  res.json(s.toUpperCase())
  res.json(s.customMethod())`),
      )
      const edges = model.edges.filter((e) => e.kind === "side-effect")
      expect(edges.some((e) => e.status === "inferred")).toBe(true)
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    })

    it("new without arguments and calls with spread arguments", async () => {
      const { model } = await scan(
        handler(`  const t = new Thing
  res.json(t)
  res.json(String(...[userData.fields.user.email]))`),
      )
      expect(responsePaths(model, "user")).toEqual(["email"])
    })

    it("a function-expression argument to an unresolved call is still queued and analyzed", async () => {
      const { model } = await scan(
        handler(
          `  external(userData.fields.user.id, () => { res.json(userData.fields.user.email) })`,
        ),
      )
      expect(responsePaths(model, "user")).toEqual(["email"])
    })

    it("sink arguments that are functions are queued and analyzed", async () => {
      const { model } = await scan(
        handler(`  res.json(() => { res.send(userData.fields.user.email) })`),
      )
      expect(responsePaths(model, "user")).toEqual(["email"])
    })
  })

  describe("modules", () => {
    it("follows a namespace import to an exported function, and records one it cannot find", async () => {
      const { model } = await scan({
        "app/lib.ts": `export function email(u: any) { return u.email }\n`,
        "app/p.ts": `${IMPORT_CAP}import * as lib from "./lib.js";\nexport function h(res: any) {\n  res.json(lib.email(userData.fields.user))\n  res.json(lib.missing(userData.fields.user.name))\n}\n`,
      })
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["email", "name"]))
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    })

    it("follows re-exports, aliased exports and export lists through a chain of files", async () => {
      const { model } = await scan({
        "app/deep.ts": `function real(u: any) { return u.email }\nexport { real as renamed }\n`,
        "app/mid.ts": `export { renamed as again } from "./deep.js"\n`,
        "app/p.ts": `${IMPORT_CAP}import { again } from "./mid.js";\nimport * as ns from "./mid.js";\nimport def from "./mid.js";\nexport function h(res: any) {\n  res.json(again(userData.fields.user))\n  res.json(ns.again(userData.fields.user))\n}\n`,
      })
      expect(responsePaths(model, "user")).toEqual(["email"])
    })

    it("a re-export from a module that cannot be resolved leaves the name unresolved", async () => {
      const { model } = await scan({
        "app/mid.ts": `export { gone } from "nowhere-package"\n`,
        "app/p.ts": `${IMPORT_CAP}import { gone } from "./mid.js";\nexport function h() { gone(userData.fields.user.email) }\n`,
      })
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    })

    it("an export list entry naming something that is not a function resolves to nothing", async () => {
      const { model } = await scan({
        "app/mid.ts": `const value = 1\nexport { value }\nexport * from "./other.js"\n`,
        "app/p.ts": `${IMPORT_CAP}import { value } from "./mid.js";\nexport function h() { value(userData.fields.user.email) }\n`,
      })
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    })

    it("a cyclic re-export chain stops instead of looping", async () => {
      const { model } = await scan({
        "app/a.ts": `export { x } from "./b.js"\n`,
        "app/b.ts": `export { x } from "./a.js"\n`,
        "app/p.ts": `${IMPORT_CAP}import { x } from "./a.js";\nexport function h() { x(userData.fields.user.email) }\n`,
      })
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    })

    it("two top-level declarations with the same name get distinct nodes", async () => {
      const { model } = await scan({
        "app/p.ts": `export function dup() { return 1 }\nexport function dup() { return 2 }\n`,
      })
      const names = model.nodes
        .filter((n) => n.kind === "function" && n.name.startsWith("dup"))
        .map((n) => n.name)
      expect(names).toEqual(["dup", "dup@2:1"])
    })

    it("top-level variable statements with mixed declarations keep the non-function ones as module code", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export const f = () => 1, secret = userData.fields.user.email\nexport const g = function () { return 2 }\nexport function h(res: any) { res.json(secret) }\n`,
      })
      expect(responsePaths(model, "user")).toEqual(["email"])
    })

    it("ignores declaration-only top-level statements and export assignments", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export interface I { a: string }\nexport type T = string\nexport enum E { A }\nexport class C {}\ndeclare module "x" {}\nexport default function () {}\nexport function h(res: any) { res.json(userData.fields.user.id) }\n`,
      })
      expect(responsePaths(model, "user")).toEqual(["id"])
    })

    it("skips generated files and unreadable files", async () => {
      const { model } = await scan(
        {
          "app/gen.ts": `// GENERATED FILE -- do not edit by hand. Run it.\n${IMPORT_CAP}export function g(res: any) { res.json(userData.fields.user.email) }\n`,
        },
        {},
      )
      expect(responsePaths(model, "user")).toEqual([])
    })

    it("a file in the list that cannot be read is skipped", async () => {
      const result = await scanFlow({
        inventory: inventoryOf(capability()),
        files: [path.join(root, "missing.ts")],
        fs: nodeBuildFs,
        root,
        tsconfig: false,
      })
      expect(result.input.edges).toEqual([])
    })

    it("surfaces a tsconfig warning without blocking", async () => {
      const { result } = await scan({}, { tsconfig: path.join(root, "nope.json") })
      expect(result.warnings).toHaveLength(1)
    })
  })

  describe("limits", () => {
    it("past the call depth limit a function is marked unanalyzed and the data it received is an unknown", async () => {
      const depth = 45
      const chain = Array.from(
        { length: depth },
        (_, i) => `function f${i}(v: any): any { return f${i + 1}(v) }`,
      ).join("\n")
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}${chain}\nfunction f${depth}(v: any): any { return v }\nexport function h() { f0(userData.fields.user.email) }\n`,
      })
      const unknown = model.unknowns.find((u) => u.reason === "unanalyzed-function")
      expect(unknown?.data).toEqual([{ origin: fieldId("user"), path: ["email"] }])
      expect(unknown?.detail).toMatch(/^call depth or analysis budget exceeded at f\d+$/)
      const marked = model.nodes.filter((n) => n.kind === "function" && n.status === "unknown")
      expect(marked.length).toBeGreaterThan(0)
    })

    it("once the step budget is spent, remaining functions are unanalyzed and produce no edges", async () => {
      const { model } = await scan({
        "app/a.ts": `export function burn() {${";".repeat(3_000_100)}}\n`,
        "app/b.ts": `${IMPORT_CAP}export function after(res: any) { res.json(userData.fields.user.email) }\n`,
      })
      expect(model.nodes.find((n) => n.id === fnId("app/b.ts", "after"))?.status).toBe("unknown")
      expect(model.edges.filter((e) => e.kind === "side-effect")).toEqual([])
    }, 60_000)
  })

  describe("jsx", () => {
    const logged = (model: FlowModel): string[] =>
      model.edges
        .filter(
          (e) =>
            e.kind === "side-effect" && model.nodes.find((n) => n.id === e.to)?.name === "console",
        )
        .map((e) => e.path?.join(".") ?? "")
        .sort()

    it("a component receives string, expression and spread attributes as props, and its expression children are evaluated", async () => {
      const { model } = await scan({
        "app/v.tsx": `${IMPORT_CAP}
function Show(props: any) { console.log(props.id); console.log(props.extra); return null }
export function V() {
  return (
    <Show id={userData.fields.user.id} label="x" flag {...{ extra: userData.fields.user.role }} ns:attr="y">
      {console.log(userData.fields.user.email)}
      text
    </Show>
  )
}
`,
      })
      expect(logged(model)).toEqual(["email", "id", "role"])
    })

    it("a fragment evaluates its expression children; an empty expression child is harmless", async () => {
      const { model } = await scan({
        "app/v.tsx": `${IMPORT_CAP}
export function F() { return <>{console.log(userData.fields.user.name)}text{}</> }
`,
      })
      expect(logged(model)).toEqual(["name"])
    })

    it("an intrinsic or member-expression tag is unresolved and records the data in its attributes", async () => {
      const { model } = await scan({
        "app/v.tsx": `${IMPORT_CAP}
export function A() { return <div title={userData.fields.team.name}>{}</div> }
export function B() { return <ui.Card data={userData.fields.user.id} /> }
`,
      })
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call", "unresolved-call"])
      expect(model.unknowns.flatMap((u) => u.data ?? []).map((d) => d.path.join("."))).toEqual(
        expect.arrayContaining(["name", "id"]),
      )
    })
  })

  describe("capabilities", () => {
    it("a getter called with tracked data passes it to the operation but not to any destination", async () => {
      const inv = inventoryOf(
        capability({
          getters: [
            operation("getter", "getUser", {
              writes: [["user"], ["unknownField"]],
              endpoints: [
                { direction: "input", kind: "database", name: "db", handling: "encrypted" },
                { direction: "output", kind: "api", name: "audit-log", handling: "hashed" },
              ],
            }),
          ],
        }),
      )
      const { model } = await scan(
        {
          "app/p.ts": `${IMPORT_CAP}export function h() { userData.getUser(userData.fields.user.email) }\n`,
        },
        {},
        inv,
      )
      const op = flowNodeId("function", CAP_FILE, "userData.getUser")
      expect(model.edges.find((e) => e.kind === "passes" && e.to === op)?.path).toEqual(["email"])
      expect(model.edges.some((e) => e.kind === "crosses-boundary" && e.from === op)).toBe(false)
      const declared = model.edges.filter((e) => e.kind === "crosses-boundary")
      expect(declared.map((e) => e.handling).sort()).toEqual(["encrypted", "hashed"])
    })

    it("a field with a declaration position carries it onto its node", async () => {
      const positioned = {
        ...field("user", USER_SHAPE),
        declarationPosition: { line: 3, column: 5 },
      }
      const { model } = await scan({}, {}, inventoryOf(capability({ fields: [positioned] })))
      expect(model.nodes.find((n) => n.id === fieldId("user"))?.source).toEqual({
        line: 3,
        column: 5,
      })
    })
  })

  describe("discards by shape", () => {
    it("measures what a function drops against the shape of what it received", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}function useTag(t: any) { return t.label }
function keep(x: any) { return x }
export function h(res: any) {
  res.json(useTag(userData.fields.tags[0]))
  res.json(keep(userData.fields.tags.length))
  res.json(keep(userData.fields.empty[0]))
  res.json(keep(userData.fields.user.nope))
  res.json(keep(userData.fields.user.email.deeper))
  res.json(keep(userData.fields.tags))
}
`,
      })
      const discards = model.edges
        .filter((e) => e.kind === "discards")
        .map((e) => `${model.nodes.find((n) => n.id === e.from)?.name}:${e.path?.join(".")}`)
      // useTag took one tags element and used only `label`; everything else was forwarded or has no shape to compare to.
      expect(discards.filter((d) => d.startsWith("useTag:"))).toEqual(["useTag:[].secret"])
      expect(discards.filter((d) => d.startsWith("keep:"))).toEqual([])
    })
  })

  describe("more shapes of source", () => {
    it("loops with an uninitialized declaration, calls on non-function targets, and spreads in arrays and new", async () => {
      const { model } = await scan(
        handler(`  for (let i, j = userData.fields.user.id; ; ) { res.json(j) }
  const rows: any[] = [userData.fields.user.email]
  res.json([...rows])
  new Thing(...rows)
  const notFn: any = userData.fields.user.name
  notFn(1)
  res.json({ undeclaredName })
  res.json({ get g() { return 1 }, [key]() { return userData.fields.user.role } })
  f() = userData.fields.user.passwordHash`),
      )
      expect(responsePaths(model, "user")).toEqual(["email", "id"])
      expect(model.unknowns.map((u) => u.reason)).toContain("unresolved-call")
    })

    it("a bound parameter that is called stays unresolved, and namespace members work as callbacks", async () => {
      const { model } = await scan({
        "app/lib.ts": `export function email(u: any) { return u.email }\n`,
        "app/p.ts": `${IMPORT_CAP}import * as lib from "./lib.js";
const other: any = {}
function apply(cb: any, v: any) { return cb(v) }
export function h(res: any) {
  const rows: any[] = [userData.fields.user]
  res.json(rows.map(lib.email))
  res.json(rows.map(lib.nothing))
  res.json(rows.map(other.fn))
  res.json(apply(undefined, userData.fields.user.name))
}
`,
      })
      expect(responsePaths(model, "user")).toEqual(expect.arrayContaining(["email", "name"]))
      expect(model.unknowns.map((u) => u.reason)).toContain("unresolved-call")
    })

    it("call, apply and bind on a local function value are unresolved with the data they received", async () => {
      const { model } = await scan(
        handler(`  const t = (v: any) => v
  res.json(t.call(null, userData.fields.user.email))
  res.json(t.apply(null, [userData.fields.user.name]))
  res.json(t.bind(null, userData.fields.user.id))`),
      )
      expect(model.unknowns.map((u) => u.reason)).toEqual([
        "unresolved-call",
        "unresolved-call",
        "unresolved-call",
      ])
      expect(model.unknowns.flatMap((u) => u.data ?? []).map((d) => d.path.join("."))).toEqual([
        "email",
        "name",
        "id",
      ])
    })

    it("top-level variables without initializers or exports are not exported functions", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export let nothing: number\nconst local = () => 1\nexport function h(res: any) { res.json(local()) }\n`,
      })
      expect(model.nodes.some((n) => n.kind === "function" && n.name === "local")).toBe(true)
    })

    it("endpoints without a declared handling produce edges without one", async () => {
      const inv = inventoryOf(
        capability({
          getters: [
            operation("getter", "g", {
              writes: [["user"]],
              endpoints: [{ direction: "output", kind: "api", name: "audit" }],
            }),
          ],
          mutators: [
            operation("mutator", "m", {
              writes: [["user"]],
              endpoints: [{ direction: "output", kind: "database", name: "db" }],
            }),
          ],
        }),
      )
      const { model } = await scan(
        {
          "app/p.ts": `${IMPORT_CAP}export function h() { userData.m(userData.fields.user.email) }\n`,
        },
        {},
        inv,
      )
      const crossing = model.edges.filter((e) => e.kind === "crosses-boundary")
      // Two declared field-to-boundary edges, plus the mutator-to-boundary edge the call produces.
      expect(crossing.length).toBe(3)
      expect(crossing.every((e) => e.handling === undefined)).toBe(true)
    })

    it("an inventory entry whose path does not match a scanned file is registered under its own path and cannot be followed", async () => {
      const inv = inventoryOf(capability({ file: "./features/user/user.ts" }))
      const { model } = await scan(
        handler(`  res.json(userData.getSnapshot())\n  res.json(userData.fields.user.email)`),
        {},
        inv,
      )
      expect(model.nodes.find((n) => n.kind === "field" && n.name === "userData.user")?.scope).toBe(
        "./features/user/user.ts",
      )
      expect(model.edges.filter((e) => e.kind === "side-effect")).toEqual([])
    })

    it("a field with an empty path and a write with an empty path are keyed by the empty name", async () => {
      const inv = inventoryOf(
        capability({
          fields: [{ ...field("x", {}), path: [] }],
          getters: [
            operation("getter", "g", {
              writes: [[]],
              endpoints: [{ direction: "input", kind: "database", name: "db" }],
            }),
          ],
        }),
      )
      const { model } = await scan({}, {}, inv)
      expect(
        model.edges.some((e) => e.kind === "crosses-boundary" && e.status === "declared"),
      ).toBe(true)
    })
  })
})
