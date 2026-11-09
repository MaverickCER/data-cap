import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { EvidenceModel } from "../../src/build/evidence-model.js"
import type { GenerateDataArtifactsOptions } from "../../src/build/generate-data-artifacts.js"
import { nodeBuildFs } from "./build-filesystem.js"

/**
 * The user's own illustration, as a real project: a database query returns
 * id, name, email, passwordHash and role; `buildUserProfile` forwards three
 * of them and discards the rest; `sendProfileToClient` serializes the profile
 * into a response. Plus one handler that leaks the whole record to the
 * client and one that hands a field to code the analysis cannot follow, so a
 * policy violation and an unknown both exist in the same evidence.
 */
export const PROFILE_CAPABILITY = `export const userData = createData({
  fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } },
  getters: { getUser: { execute: async () => ({}), processor: (raw: unknown) => ({ user: raw }), writes: { user: true } } },
});
documentData(
  { fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } } },
  {
    owner: "platform",
    sensitivity: "confidential",
    purpose: "account management",
    legalBasis: "contract",
    protections: "encrypted at rest",
    getters: { getUser: { endpoints: [{ direction: "input", kind: "database", name: "postgres:users" }] } },
    flowPolicy: [
      { id: "no-password-to-client", description: "A password hash never reaches a client response.", appliesTo: { field: "user", path: ["passwordHash"] }, forbidDestinations: ["client-response"] },
      { id: "no-role-to-log", appliesTo: { field: "user", path: ["role"] }, forbidDestinations: ["log"] },
    ],
  },
);
`

export const PROFILE_HANDLERS = `import { userData } from "../features/user.js";

export function buildUserProfile(user: any) {
  return { id: user.id, name: user.name, email: user.email }
}

export function sendProfileToClient(res: any, profile: any) {
  res.json(profile)
}

export function profileHandler(res: any) {
  const user = userData.getSnapshot().fields.user
  const profile = buildUserProfile(user)
  sendProfileToClient(res, profile)
}
`

export const LEAKING_HANDLER = `import { userData } from "../features/user.js";

export function exportEverything(res: any) {
  res.json(userData.getSnapshot().fields.user)
}
`

export const OPAQUE_HANDLER = `import { userData } from "../features/user.js";
import { audit } from "some-analytics-lib";

export function trackUser() {
  audit(userData.getSnapshot().fields.user.email)
}
`

export interface FlowEvidenceFixture {
  readonly evidence: EvidenceModel
  readonly root: string
  cleanup(): Promise<void>
}

/** Writes `files` (root-relative path -> content) into a temp project and runs the real pipeline with flow analysis on. */
export async function buildFlowEvidence(
  files: Readonly<Record<string, string>>,
  overrides: Partial<GenerateDataArtifactsOptions> = {},
): Promise<FlowEvidenceFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-flow-fixture-"))
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content, "utf8")
  }
  try {
    // A violated policy is a blocking error by design; fixtures want the evidence regardless.
    const { evidence } = await computeEvidence(root, overrides)
    return { evidence, root, cleanup: () => fs.rm(root, { recursive: true, force: true }) }
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true })
    throw error
  }
}

async function computeEvidence(root: string, overrides: Partial<GenerateDataArtifactsOptions>) {
  const { computeDataArtifacts } = await import("../../src/build/generate-data-artifacts.js")
  const { result } = await computeDataArtifacts({
    fs: nodeBuildFs,
    root,
    tsconfig: false,
    flowEvidence: true,
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    commit: "0123456789abcdef0123456789abcdef01234567",
    ...overrides,
  })
  return result
}

/** The standard fixture: the safe profile flow, a leaking handler (policy violated) and an opaque one (an unknown). */
export function profileFixture(
  overrides: Partial<GenerateDataArtifactsOptions> = {},
): Promise<FlowEvidenceFixture> {
  return buildFlowEvidence(
    {
      "features/user.ts": PROFILE_CAPABILITY,
      "app/profile.ts": PROFILE_HANDLERS,
      "app/export.ts": LEAKING_HANDLER,
      "app/track.ts": OPAQUE_HANDLER,
    },
    overrides,
  )
}
