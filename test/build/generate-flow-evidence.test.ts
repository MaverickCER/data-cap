import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DataProjectGenerationError } from "../../src/build/errors.js"
import { generateDataArtifacts } from "../../src/build/generate-data-artifacts.js"
import type { EvidenceModel } from "../../src/build/evidence-model.js"
import { traceFlow } from "../../src/flow/flow-projections.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

const CAPABILITY = (flowPolicy = "") => `
export const userData = createData({
  fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } },
});
documentData(
  { fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } } },
  { owner: "platform", sensitivity: "confidential", purpose: "accounts", legalBasis: "contract", protections: "encrypted at rest"${flowPolicy} },
);
`

const POLICY = `, flowPolicy: [{ id: "no-password-to-client", appliesTo: { field: "user", path: ["passwordHash"] }, forbidDestinations: ["client-response"] }]`

const SAFE_HANDLER = `import { userData } from "../features/user.js";
export function buildUserProfile(user: any) { return { id: user.id, name: user.name, email: user.email } }
export function sendProfileToClient(res: any, profile: any) { res.json(profile) }
export function handler(res: any) {
  const user = userData.getSnapshot().fields.user
  sendProfileToClient(res, buildUserProfile(user))
}
`

const LEAKING_HANDLER = `import { userData } from "../features/user.js";
export function handler(res: any) { res.json(userData.getSnapshot().fields.user) }
`

describe("generateDataArtifacts -- flow evidence (ADR 0070)", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-flow-evidence-"))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  async function write(relativePath: string, content: string): Promise<string> {
    const filePath = path.join(root, relativePath)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, "utf8")
    return filePath
  }

  const run = (extra: Partial<Parameters<typeof generateDataArtifacts>[0]> = {}) =>
    generateDataArtifacts({ fs: nodeBuildFs, root, tsconfig: false, ...extra })

  it("computes no flow, policy or claims by default", async () => {
    await write("features/user.ts", CAPABILITY())
    await write("app/handler.ts", SAFE_HANDLER)
    const { evidence } = await run()
    expect(evidence.flow).toBeUndefined()
    expect(evidence.policy).toBeUndefined()
    expect(evidence.claims).toBeUndefined()
    expect(evidence.computed).toMatchObject({
      flow: false,
      policy: false,
      observation: false,
      claims: false,
    })
  })

  it("flowEvidence computes the Flow, Policy and Claims Models into the one evidence object", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write("app/handler.ts", SAFE_HANDLER)
    const { evidence } = await run({ flowEvidence: true })
    expect(evidence.computed).toMatchObject({
      flow: true,
      policy: true,
      claims: true,
      observation: false,
    })
    expect(evidence.flow?.nodes.some((n) => n.kind === "field" && n.name === "userData.user")).toBe(
      true,
    )
    expect(evidence.policy?.rules.map((r) => r.id)).toEqual(["userData/no-password-to-client"])
    expect(evidence.claims?.claims.length).toBeGreaterThan(0)
  })

  it("the safe handler satisfies the policy and the fields reach the client only by the forwarded keys", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write("app/handler.ts", SAFE_HANDLER)
    const result = await run({ flowEvidence: true })
    expect(result.hasBlockingErrors).toBe(false)
    expect(result.evidence.policy?.summary).toEqual({ satisfied: 1, violated: 0, indeterminate: 0 })
    const flow = result.evidence.flow!
    const user = flow.nodes.find((n) => n.name === "userData.user")!
    const reaches = (p: string) =>
      traceFlow(flow, user.id, "downstream", { path: [p] }).nodes.some(
        (n) => n.kind === "boundary" && n.name === "http-response",
      )
    expect(reaches("email")).toBe(true)
    expect(reaches("passwordHash")).toBe(false)
  })

  it("reports least-data findings: the unforwarded keys are unused, the sensitive field's are warnings", async () => {
    await write("features/user.ts", CAPABILITY())
    await write("app/handler.ts", SAFE_HANDLER)
    const { findings } = await run({ flowEvidence: true })
    const unused = findings
      .filter((f) => f.code === "LEAST_DATA_UNUSED_SENSITIVE_PATH")
      .map((f) => f.field?.join("."))
    expect(unused.sort()).toEqual(["user.passwordHash", "user.role"])
  })

  it("a leaking handler violates the policy: an error finding that blocks generation", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write("app/handler.ts", LEAKING_HANDLER)
    await expect(
      run({ flowEvidence: true, location: path.join(root, "out", "manifest.ts") }),
    ).rejects.toBeInstanceOf(DataProjectGenerationError)
    // Atomicity: nothing was written.
    await expect(fs.stat(path.join(root, "out", "manifest.ts"))).rejects.toBeTruthy()
  })

  it("the violation is in the findings, the whole-field-to-client warning accompanies it", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write("app/handler.ts", LEAKING_HANDLER)
    let error: unknown
    try {
      await run({ flowEvidence: true })
    } catch (caught) {
      error = caught
    }
    const codes = (error as DataProjectGenerationError).findings.map((f) => f.code)
    expect(codes).toContain("FLOW_POLICY_VIOLATED")
    expect(codes).toContain("LEAST_DATA_WHOLE_FIELD_TO_CLIENT")
  })

  it("an unresolved call makes the policy indeterminate, which strictFlow escalates to blocking", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write(
      "app/handler.ts",
      `import { userData } from "../features/user.js";\nimport { audit } from "some-lib";\nexport function handler() { audit(userData.fields.user) }\n`,
    )
    const lenient = await run({ flowEvidence: true })
    expect(lenient.evidence.policy?.summary.indeterminate).toBeGreaterThan(0)
    expect(lenient.hasBlockingErrors).toBe(false)
    expect(lenient.findings.some((f) => f.code === "FLOW_POLICY_INDETERMINATE")).toBe(true)
    expect(lenient.findings.some((f) => f.code === "FLOW_ANALYSIS_INCOMPLETE")).toBe(true)
    await expect(run({ flowEvidence: true, strictFlow: true })).rejects.toBeInstanceOf(
      DataProjectGenerationError,
    )
  })

  it("observations are ingested, joined to the static claims, and marked computed", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write("app/handler.ts", SAFE_HANDLER)
    const { evidence } = await run({
      flowEvidence: true,
      observations: [
        {
          scope: "test:profile",
          boundary: { kind: "client-response", name: "http-response" },
          field: "userData.user.email",
        },
      ],
    })
    expect(evidence.computed.observation).toBe(true)
    expect(evidence.observation?.scopes).toEqual(["test:profile"])
    expect(evidence.claims?.summary.verified).toBeGreaterThan(0)
  })

  it("observations without flowEvidence are ingested but derive no claims", async () => {
    await write("features/user.ts", CAPABILITY())
    const { evidence } = await run({
      observations: [
        { scope: "s", boundary: { kind: "api", name: "x" }, field: "userData.user.email" },
      ],
    })
    expect(evidence.computed).toMatchObject({ observation: true, flow: false, claims: false })
  })

  it("flowSinks recognise a project-specific sink", async () => {
    await write("features/user.ts", CAPABILITY())
    await write(
      "app/handler.ts",
      `import { userData } from "../features/user.js";\nexport function handler(mailer: any) { mailer.send(userData.fields.user.email) }\n`,
    )
    const { evidence } = await run({
      flowEvidence: true,
      flowSinks: [
        { callee: "mailer.send", boundary: { kind: "external-service", name: "mailer" } },
      ],
    })
    expect(evidence.flow?.nodes.some((n) => n.kind === "boundary" && n.name === "mailer")).toBe(
      true,
    )
  })

  it("writes the one evidence JSON, flow sub-models included, to --evidence", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write("app/handler.ts", SAFE_HANDLER)
    const evidencePath = path.join(root, "docs", "data.evidence.json")
    await run({ flowEvidence: true, evidence: evidencePath })
    const written = JSON.parse(await fs.readFile(evidencePath, "utf8")) as EvidenceModel
    expect(written.flow?.nodes.length).toBeGreaterThan(0)
    expect(written.policy?.rules).toHaveLength(1)
    expect(written.claims?.claims.length).toBeGreaterThan(0)
    expect(written.schemaVersion).toBe(3)
  })

  it("is deterministic: two runs over the same source produce the same flow, policy and claims", async () => {
    await write("features/user.ts", CAPABILITY(POLICY))
    await write("app/handler.ts", SAFE_HANDLER)
    const first = (await run({ flowEvidence: true })).evidence
    const second = (await run({ flowEvidence: true })).evidence
    expect(second.flow).toEqual(first.flow)
    expect(second.policy).toEqual(first.policy)
    expect(second.claims).toEqual(first.claims)
  })
})
