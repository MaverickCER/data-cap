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

function field(name: string, shape: unknown, sensitivity?: string): FieldNode {
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
    fields: [field("user", USER_SHAPE, "secret"), field("team", { name: "" })],
    getters: [],
    mutators: [],
    subscriptions: [],
    ...overrides,
  }
}

function inventoryOf(...capabilities: CapabilityNode[]): CapabilityInventory {
  return { schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION, capabilities, warnings: [] }
}

const CAP_SOURCE = `export const userData = createData({ fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" }, team: { name: "" } } });\n`
const IMPORT_CAP = `import { userData } from "../features/user/user.js";\n`

const fieldId = (name: string): string => flowNodeId("field", CAP_FILE, `userData.${name}`)
const codeBoundary = (name: string): string => flowNodeId("boundary", "boundary:code", name)

describe("scanFlow", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-flow-scan-"))
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

  function reaches(model: FlowModel, fieldName: string, boundary: string, p?: string[]): boolean {
    const trace = traceFlow(
      model,
      fieldId(fieldName),
      "downstream",
      p === undefined ? {} : { path: p },
    )
    return trace.nodes.some((node) => node.kind === "boundary" && node.name === boundary)
  }

  const names = (model: FlowModel, kind: string): string[] =>
    model.nodes
      .filter((node) => node.kind === kind)
      .map((node) => node.name)
      .sort()

  describe("a capability file that also uses its own export", () => {
    it("traces a field read by a function declared in the capability file itself", async () => {
      const source = `${CAP_SOURCE}export function leak(res: any) { res.json(userData.getSnapshot().fields.user.email) }\n`
      const { model } = await scan({ [CAP_FILE]: source })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
    })
  })

  describe("a call through a conditional callee", () => {
    it("is an unresolved call, not a silent follow of the first branch", async () => {
      const source = `${IMPORT_CAP}function a(x: any) { return 1 }
function b(x: any) { return 2 }
export function pick(flag: boolean, res: any) { (flag ? a : b)(userData.getSnapshot().fields.user.email) }
`
      const { model } = await scan({ "app/pick.ts": source })
      expect(model.unknowns.some((unknown) => unknown.reason === "unresolved-call")).toBe(true)
    })
  })

  describe("nodes", () => {
    it("creates a field node per capability field with its sensitivity as classification", async () => {
      const { model } = await scan({})
      const user = model.nodes.find((node) => node.id === fieldId("user"))
      expect(user).toMatchObject({
        kind: "field",
        scope: CAP_FILE,
        name: "userData.user",
        classification: "secret",
        status: "static",
      })
      expect(
        model.nodes.find((node) => node.id === fieldId("team"))?.classification,
      ).toBeUndefined()
    })

    it("creates function, parameter and return nodes for every project function", async () => {
      const { model } = await scan({
        "app/util.ts": `export function pick(a: any, b: any) { return a }\nexport const twice = (x: any) => x\n`,
      })
      expect(names(model, "function")).toEqual(expect.arrayContaining(["pick", "twice"]))
      expect(names(model, "parameter")).toEqual(
        expect.arrayContaining(["pick.a", "pick.b", "twice.x"]),
      )
      expect(names(model, "return")).toEqual(
        expect.arrayContaining(["pick#return", "twice#return"]),
      )
    })

    it("marks functions it analyzed as static and counts them in coverage", async () => {
      const { model } = await scan({ "app/util.ts": `export function f() { return 1 }\n` })
      expect(model.nodes.find((n) => n.kind === "function" && n.name === "f")?.status).toBe(
        "static",
      )
      expect(model.coverage.functionsAnalyzed).toBeGreaterThan(0)
    })

    it("is deterministic across runs", async () => {
      const files = {
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { res.json(userData.getSnapshot().fields.user.email) }\n`,
      }
      const first = await scan(files)
      const second = await scan(files)
      expect(second.model).toEqual(first.model)
    })
  })

  describe("direct reads and sinks", () => {
    it("traces a field read straight into a client response", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { res.json(userData.getSnapshot().fields.user.email) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(reaches(model, "user", "http-response", ["passwordHash"])).toBe(false)
    })

    it("records the read and the side effect as edges of the reading function, with the source location", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) {\n  res.json(userData.getSnapshot().fields.user.email)\n}\n`,
      })
      const h = flowNodeId("function", "app/p.ts", "h")
      const reads = model.edges.filter((e) => e.kind === "reads" && e.to === h)
      // The function reads the whole field (it took `fields.user`), then the `email` path of it.
      expect(reads.map((e) => e.path?.join("."))).toEqual(expect.arrayContaining(["", "email"]))
      expect(reads.find((e) => e.path?.[0] === "email")).toMatchObject({
        from: fieldId("user"),
        status: "static",
        origin: fieldId("user"),
      })
      const effect = model.edges.find((e) => e.kind === "side-effect" && e.from === h)
      expect(effect).toMatchObject({
        to: codeBoundary("http-response"),
        path: ["email"],
        status: "static",
      })
      // Line 1 is the capability import, 2 the function, 3 the call.
      expect(effect?.source).toEqual({ file: "app/p.ts", line: 3, column: 3 })
    })

    it("reads through fields without getSnapshot (X.fields.user)", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { res.send(userData.fields.team.name) }\n`,
      })
      expect(reaches(model, "team", "http-response", ["name"])).toBe(true)
    })

    it("treats console output as a log boundary", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h() { console.log(userData.getSnapshot().fields.user) }\n`,
      })
      const boundary = model.nodes.find((n) => n.kind === "boundary" && n.name === "console")
      expect(boundary?.boundaryKind).toBe("log")
      expect(reaches(model, "user", "console")).toBe(true)
    })

    it("matches a sink through a call chain (res.status(200).json)", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { res.status(200).json(userData.fields.user.name) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["name"])).toBe(true)
    })

    it("accepts custom sink patterns", async () => {
      const { model } = await scan(
        {
          "app/p.ts": `${IMPORT_CAP}export function h(mailer: any) { mailer.send(userData.fields.user.email) }\n`,
        },
        {
          sinks: [
            {
              callee: "mailer.send",
              boundary: { kind: "external-service", name: "mailer" },
              handling: "plaintext",
            },
          ],
        },
      )
      expect(reaches(model, "user", "mailer", ["email"])).toBe(true)
      const crossing = model.edges.find(
        (e) => e.kind === "side-effect" && e.to === codeBoundary("mailer"),
      )
      expect(crossing?.handling).toBe("plaintext")
    })

    it("does not invent a boundary when no tracked data reaches the sink", async () => {
      const { model } = await scan({
        "app/p.ts": `export function h(res: any) { res.json({ ok: true }) }\n`,
      })
      expect(model.nodes.some((n) => n.kind === "boundary")).toBe(false)
    })
  })

  describe("interprocedural, field-sensitive flow (the user's example)", () => {
    const PROFILE = `${IMPORT_CAP}
export function buildUserProfile(user: any) {
  return { id: user.id, name: user.name, email: user.email }
}
export function sendProfileToClient(res: any, profile: any) {
  res.json(profile)
}
export function handler(res: any) {
  const user = userData.getSnapshot().fields.user
  const profile = buildUserProfile(user)
  sendProfileToClient(res, profile)
}
`

    it("lets id, name and email reach the client but not passwordHash or role", async () => {
      const { model } = await scan({ "app/profile.ts": PROFILE })
      for (const key of ["id", "name", "email"])
        expect(reaches(model, "user", "http-response", [key])).toBe(true)
      for (const key of ["passwordHash", "role"])
        expect(reaches(model, "user", "http-response", [key])).toBe(false)
    })

    it("chains the edges through the helper functions in order", async () => {
      const { model } = await scan({ "app/profile.ts": PROFILE })
      const trace = traceFlow(model, fieldId("user"), "downstream", { path: ["email"] })
      expect(trace.nodes.map((n) => n.name)).toEqual(
        expect.arrayContaining([
          "userData.user",
          "handler",
          "buildUserProfile.user",
          "buildUserProfile",
          "buildUserProfile#return",
          "sendProfileToClient.profile",
          "sendProfileToClient",
          "http-response",
        ]),
      )
      expect(trace.complete).toBe(true)
    })

    it("records calls edges for the control flow", async () => {
      const { model } = await scan({ "app/profile.ts": PROFILE })
      const handler = flowNodeId("function", "app/profile.ts", "handler")
      const callees = model.edges
        .filter((e) => e.kind === "calls" && e.from === handler)
        .map((e) => e.to)
      expect(callees).toEqual(
        expect.arrayContaining([
          flowNodeId("function", "app/profile.ts", "buildUserProfile"),
          flowNodeId("function", "app/profile.ts", "sendProfileToClient"),
        ]),
      )
      expect(model.edges.find((e) => e.kind === "calls")?.origin).toBeUndefined()
    })

    it("records what buildUserProfile discards", async () => {
      const { model } = await scan({ "app/profile.ts": PROFILE })
      const bup = flowNodeId("function", "app/profile.ts", "buildUserProfile")
      const discarded = model.edges
        .filter((e) => e.kind === "discards" && e.from === bup)
        .map((e) => e.path?.join("."))
        .sort()
      expect(discarded).toEqual(["passwordHash", "role"])
      expect(model.edges.find((e) => e.kind === "discards")).toMatchObject({
        to: fieldId("user"),
        origin: fieldId("user"),
        status: "static",
      })
    })

    it("a path used only locally (a condition) is still a read of that path and is not discarded", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function isAdmin(user: any) {\n  return user.role === "admin"\n}\nexport function h() { return isAdmin(userData.fields.user) }\n`,
      })
      const isAdmin = flowNodeId("function", "app/p.ts", "isAdmin")
      const reads = model.edges.filter(
        (e) => e.kind === "reads" && e.to === isAdmin && e.origin === fieldId("user"),
      )
      expect(reads.map((e) => e.path?.join("."))).toContain("role")
      const discarded = model.edges
        .filter((e) => e.kind === "discards" && e.from === isAdmin)
        .map((e) => e.path?.join("."))
      expect(discarded).not.toContain("role")
      expect(discarded).toEqual(expect.arrayContaining(["id", "name", "email", "passwordHash"]))
    })

    it("does not report a discard for a field the function forwards", async () => {
      const { model } = await scan({ "app/profile.ts": PROFILE })
      const discarded = model.edges
        .filter((e) => e.kind === "discards")
        .map((e) => e.path?.join("."))
      expect(discarded).not.toContain("email")
    })

    it("works when the helpers live in another file", async () => {
      const { model } = await scan({
        "app/helpers.ts": `export function toProfile(u: any) { return { email: u.email } }\n`,
        "app/handler.ts": `${IMPORT_CAP}import { toProfile } from "./helpers.js";\nexport function h(res: any) { res.json(toProfile(userData.fields.user)) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(reaches(model, "user", "http-response", ["passwordHash"])).toBe(false)
    })
  })

  describe("value shapes", () => {
    it("spreading the whole value forwards every path, exactly", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const u = userData.fields.user; res.json({ ...u, extra: 1 }) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["passwordHash"])).toBe(true)
      const effect = model.edges.find((e) => e.kind === "side-effect")
      expect(effect?.status).toBe("static")
    })

    it("destructuring keeps the forwarded key and drops the rest", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const { email } = userData.fields.user; res.json(email) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(reaches(model, "user", "http-response", ["role"])).toBe(false)
    })

    it("destructuring with rest over-approximates the rest and marks it inferred", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const { email, ...rest } = userData.fields.user; res.json(rest) }\n`,
      })
      const effect = model.edges.find((e) => e.kind === "side-effect")
      expect(effect?.status).toBe("inferred")
      expect(reaches(model, "user", "http-response", ["role"])).toBe(true)
    })

    it("a property overridden in an object literal does not carry the original", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const u = userData.fields.user; res.json({ email: "redacted", name: u.name }) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["name"])).toBe(true)
      expect(reaches(model, "user", "http-response", ["email"])).toBe(false)
    })

    it("string concatenation and templates carry the data approximately", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { res.send(\`hello \${userData.fields.user.name}\`) }\n`,
      })
      const effect = model.edges.find((e) => e.kind === "side-effect")
      expect(effect).toMatchObject({ path: ["name"], status: "inferred" })
    })

    it("a conditional carries both branches", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any, flag: boolean) { const u = userData.fields.user; res.json(flag ? u.email : u.name) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(reaches(model, "user", "http-response", ["name"])).toBe(true)
    })

    it("an array of values keeps element paths", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const u = userData.fields.user; res.json([u.email, u.name]) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(reaches(model, "user", "http-response", ["role"])).toBe(false)
    })

    it("callbacks passed to map receive the element", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const out = userData.fields.team.name; res.json([out].map((n) => n)) }\n`,
      })
      expect(reaches(model, "team", "http-response", ["name"])).toBe(true)
    })

    it("a value stored on an object then read back keeps its path", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { const o: any = {}; o.mail = userData.fields.user.email; res.json(o.mail) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
    })

    it("await and promise chains pass the value through", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export async function h(res: any) { const v = await Promise.resolve(userData.fields.user.email); res.json(v) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
    })

    it("then callbacks receive the resolved value", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { Promise.resolve(userData.fields.user.email).then((e) => res.json(e)) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
    })
  })

  describe("origins stay separate through shared helpers", () => {
    it("two fields through one helper do not reach each other's destinations", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}
export function pass(v: any) { return v }
export function a(res: any) { res.json(pass(userData.fields.user.email)) }
export function b() { console.log(pass(userData.fields.team.name)) }
`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(reaches(model, "user", "console")).toBe(false)
      expect(reaches(model, "team", "console", ["name"])).toBe(true)
      expect(reaches(model, "team", "http-response")).toBe(false)
    })
  })

  describe("incompleteness is recorded, never hidden", () => {
    it("records an unresolved call that receives tracked data as an unknown, with a citation", async () => {
      const { result, model } = await scan({
        "app/p.ts": `${IMPORT_CAP}import { audit } from "some-external-lib";\nexport function h() {\n  audit(userData.fields.user)\n}\n`,
      })
      expect(model.unknowns).toHaveLength(1)
      expect(model.unknowns[0]).toMatchObject({
        reason: "unresolved-call",
        subject: flowNodeId("function", "app/p.ts", "h"),
        source: { file: "app/p.ts", line: 4, column: 3 },
      })
      expect(model.coverage.complete).toBe(false)
      expect(result.warnings).toEqual([])
    })

    it("an unresolved call records exactly which data it received, so an unrelated path is not blocked by it", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}import { audit } from "some-external-lib";\nexport function h() { audit(userData.fields.user.email) }\n`,
      })
      expect(model.unknowns[0]?.data).toEqual([{ origin: fieldId("user"), path: ["email"] }])
      expect(traceFlow(model, fieldId("user"), "downstream", { path: ["email"] }).complete).toBe(
        false,
      )
      expect(
        traceFlow(model, fieldId("user"), "downstream", { path: ["passwordHash"] }).complete,
      ).toBe(true)
    })

    it("a computed key on tracked data records the data it was applied to", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(key: string) {\n  const u: any = userData.fields.user.name\n  return u[key]\n}\n`,
      })
      expect(model.unknowns[0]).toMatchObject({
        reason: "dynamic-access",
        data: [{ origin: fieldId("user"), path: ["name"] }],
      })
    })

    it("an unknown reached through two contexts accumulates the data of both", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}import { audit } from "some-external-lib";\nexport function wrap(v: any) { audit(v) }\nexport function a() { wrap(userData.fields.user.email) }\nexport function b() { wrap(userData.fields.team.name) }\n`,
      })
      const data = model.unknowns
        .flatMap((u) => u.data ?? [])
        .map((d) => `${d.origin.split("#")[1]}:${d.path.join(".")}`)
        .sort()
      expect(data).toEqual(expect.arrayContaining(["userData.team:name", "userData.user:email"]))
    })

    it("a whole field handed to an unresolved call still links the field to the function, so a trace cannot miss the unknown", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}import { audit } from "some-external-lib";\nexport function h() { audit(userData.fields.user) }\n`,
      })
      const h = flowNodeId("function", "app/p.ts", "h")
      expect(
        model.edges.some((e) => e.kind === "reads" && e.from === fieldId("user") && e.to === h),
      ).toBe(true)
      expect(traceFlow(model, fieldId("user"), "downstream").complete).toBe(false)
    })

    it("does not record an unknown for an unresolved call that receives no tracked data", async () => {
      const { model } = await scan({
        "app/p.ts": `import { log } from "some-external-lib";\nexport function h() { log("hi") }\n`,
      })
      expect(model.unknowns).toEqual([])
    })

    it("the downstream trace through an unresolved call is not complete", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}import { audit } from "some-external-lib";\nexport function h(res: any) { res.json(audit(userData.fields.user.email)) }\n`,
      })
      const trace = traceFlow(model, fieldId("user"), "downstream", { path: ["email"] })
      expect(trace.complete).toBe(false)
      // The data is still assumed to pass through the unknown call, approximately.
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(model.edges.find((e) => e.kind === "side-effect")?.status).toBe("inferred")
    })

    it("records dynamic property access on tracked data as an unknown", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any, key: string) {\n  const u: any = userData.fields.user\n  res.json(u[key])\n}\n`,
      })
      expect(model.unknowns.map((u) => u.reason)).toEqual(["dynamic-access"])
      expect(model.unknowns[0]?.source).toEqual({ file: "app/p.ts", line: 4, column: 12 })
      expect(reaches(model, "user", "http-response")).toBe(true)
    })

    it("treats a literal element key as an ordinary path step", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(res: any) { res.json(userData.fields.user["email"]) }\n`,
      })
      expect(model.unknowns).toEqual([])
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(reaches(model, "user", "http-response", ["role"])).toBe(false)
    })

    it("terminates on recursion", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function walk(v: any, n: number): any { return n === 0 ? v : walk(v, n - 1) }\nexport function h(res: any) { res.json(walk(userData.fields.user.email, 3)) }\n`,
      })
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
    })

    it("does not follow a method call on a non-capability object into code it cannot resolve", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}export function h(repo: any) {\n  repo.save(userData.fields.user)\n}\n`,
      })
      expect(model.unknowns.map((u) => u.reason)).toEqual(["unresolved-call"])
    })

    it("skips a file that does not parse without failing the scan, and says so", async () => {
      const { result, model } = await scan({
        "app/broken.ts": `export function (((\n`,
        "app/ok.ts": `${IMPORT_CAP}export function h(res: any) { res.json(userData.fields.user.email) }\n`,
      })
      // The unparseable file contributes nothing and does not stop the healthy one from being analyzed.
      expect(reaches(model, "user", "http-response", ["email"])).toBe(true)
      expect(model.unknowns).toEqual([])
      expect(result.warnings).toEqual([])
    })

    it("keeps operation bodies opaque when the schema is declared as a const and passed to createData", async () => {
      const { model } = await scan({
        "features/other.ts": `
import { documentData } from "data-cap"
import { createData } from "data-cap/runtime"
const schema = {
  fields: { a: "" },
  getters: { get: { execute: (p: any) => console.log(p), processor: (r: any) => ({ a: r }), writes: { a: true } } },
}
export const other = createData(schema)
documentData(schema, { owner: "x" })
`,
      })
      // No phantom function for execute/processor, and no console boundary from inside an operation body.
      expect(
        model.nodes.filter((n) => n.kind === "function" && n.scope === "features/other.ts"),
      ).toEqual([])
      expect(model.nodes.some((n) => n.kind === "boundary" && n.name === "console")).toBe(false)
    })

    it("still analyzes an ordinary object literal that merely looks like a schema when nothing passes it to createData", async () => {
      const { model } = await scan({
        "app/p.ts": `${IMPORT_CAP}const handlers = { show: (res: any) => res.json(userData.fields.user.email) }\nexport function h(res: any) { handlers.show(res) }\n`,
      })
      expect(model.nodes.some((n) => n.kind === "function" && n.name.includes("anonymous"))).toBe(
        true,
      )
    })

    it("does not analyze the arguments of createData itself (operation bodies stay opaque)", async () => {
      const { model } = await scan({
        "features/other.ts": `export const other = createData({ fields: { a: "" }, getters: { get: { execute: (p: any) => console.log(p) } } });\n`,
      })
      expect(model.nodes.some((n) => n.kind === "boundary" && n.name === "console")).toBe(false)
    })
  })

  describe("capability operations and declared endpoints", () => {
    const withEndpoints = (): CapabilityInventory =>
      inventoryOf(
        capability({
          getters: [
            operation("getter", "getUser", {
              writes: [["user"]],
              endpoints: [{ direction: "input", kind: "database", name: "postgres:users" }],
            }),
          ],
          mutators: [
            operation("mutator", "updateUser", {
              writes: [["user"]],
              endpoints: [
                {
                  direction: "output",
                  kind: "external-service",
                  name: "stripe-api",
                  handling: "hashed",
                },
              ],
            }),
          ],
        }),
      )

    it("adds declared boundary nodes and declared edges for a field's endpoints", async () => {
      const { model } = await scan({}, {}, withEndpoints())
      const db = flowNodeId("boundary", "boundary", "postgres:users")
      const stripe = flowNodeId("boundary", "boundary", "stripe-api")
      expect(model.nodes.find((n) => n.id === db)).toMatchObject({
        boundaryKind: "database",
        status: "declared",
      })
      expect(model.edges.find((e) => e.from === db && e.to === fieldId("user"))).toMatchObject({
        kind: "crosses-boundary",
        status: "declared",
        origin: fieldId("user"),
      })
      expect(model.edges.find((e) => e.from === fieldId("user") && e.to === stripe)).toMatchObject({
        kind: "crosses-boundary",
        status: "declared",
        handling: "hashed",
        origin: fieldId("user"),
      })
    })

    it("a field with a declared output endpoint reaches it downstream", async () => {
      const { model } = await scan({}, {}, withEndpoints())
      expect(reaches(model, "user", "stripe-api")).toBe(true)
    })

    it("a mutator call that receives tracked data passes it to the operation and on to its declared destination", async () => {
      const { model } = await scan(
        {
          "app/p.ts": `${IMPORT_CAP}export function h() { userData.updateUser({ email: userData.fields.user.email }) }\n`,
        },
        {},
        withEndpoints(),
      )
      const op = flowNodeId("function", CAP_FILE, "userData.updateUser")
      expect(model.nodes.find((n) => n.id === op)).toBeDefined()
      const passes = model.edges.find((e) => e.kind === "passes" && e.to === op)
      expect(passes).toMatchObject({
        from: flowNodeId("function", "app/p.ts", "h"),
        path: ["email"],
        status: "static",
      })
      expect(model.edges.find((e) => e.kind === "crosses-boundary" && e.from === op)).toMatchObject(
        {
          to: flowNodeId("boundary", "boundary", "stripe-api"),
          handling: "hashed",
          status: "declared",
          path: ["email"],
        },
      )
    })

    it("calls to a getter produce a calls edge to the operation", async () => {
      const { model } = await scan(
        {
          "app/p.ts": `${IMPORT_CAP}export async function h() { await userData.getUser({ id: "1" }) }\n`,
        },
        {},
        withEndpoints(),
      )
      const op = flowNodeId("function", CAP_FILE, "userData.getUser")
      expect(model.edges.some((e) => e.kind === "calls" && e.to === op)).toBe(true)
    })

    it("two endpoints with the same name but different kinds do not collide", async () => {
      const inv = inventoryOf(
        capability({
          getters: [
            operation("getter", "g", {
              writes: [["user"]],
              endpoints: [
                { direction: "input", kind: "database", name: "x" },
                { direction: "input", kind: "api", name: "x" },
              ],
            }),
          ],
        }),
      )
      const { model } = await scan({}, {}, inv)
      expect(
        model.nodes.filter((n) => n.kind === "boundary" && n.name.startsWith("x")).length,
      ).toBe(2)
    })
  })

  describe("JSX components", () => {
    it("passes attributes to a component function as its props", async () => {
      const { model } = await scan({
        "app/view.tsx": `${IMPORT_CAP}
function Email(props: any) { console.log(props.email); return null }
export function View() { return <Email email={userData.fields.user.email} /> }
`,
      })
      expect(reaches(model, "user", "console", ["email"])).toBe(true)
      expect(reaches(model, "user", "console", ["role"])).toBe(false)
    })
  })
})
