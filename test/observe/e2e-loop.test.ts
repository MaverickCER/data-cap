/**
 * The acceptance test for "unobserved becomes verified": a fixture app is instrumented with `instrumentBoundary`,
 * run, its sink is written to a JSON file in a temp dir (what a vitest/jest/node:test setup file would do), and
 * that file is fed to the real pipeline as `observations`. The static scan found the flow; the observation lifts
 * the claim from `unobserved` to `verified`, and no field value is anywhere in the file or the evidence.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Claim } from "../../src/flow/claims-model.js"
import { createMemorySink, instrumentBoundary } from "../../src/observe/index.js"
import type { ObservationEvent } from "../../src/observe/index.js"
import {
  buildFlowEvidence,
  PROFILE_CAPABILITY,
  PROFILE_HANDLERS,
} from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

const PASSWORD_HASH = "$2b$10$thisIsASecretHashThatMustNeverBeRecorded"
const EMAIL = "ada@example.com"

/** The fixture app at run time: the same shape as PROFILE_HANDLERS, over a fake database row and response. */
function runProfileApp(res: { json(body: unknown): void }): void {
  const row = { id: 7, name: "Ada", email: EMAIL, passwordHash: PASSWORD_HASH, role: "admin" }
  const profile = { id: row.id, name: row.name, email: row.email }
  res.json(profile)
}

async function writeObservations(): Promise<{
  file: string
  dir: string
  events: ObservationEvent[]
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-observe-e2e-"))
  const memory = createMemorySink()
  const res = { json: (_body: unknown) => undefined }
  const restore = instrumentBoundary(
    res,
    "json",
    {
      scope: "vitest:profile endpoint",
      // A dotted capability prefix qualifies the body's keys the way the Flow Model names the field.
      capability: "userData.user",
      boundary: { kind: "client-response", name: "http-response" },
      clock: () => 1_767_225_600_000,
    },
    memory.sink,
  )
  runProfileApp(res)
  restore()
  const file = path.join(dir, "observations.json")
  await fs.writeFile(file, JSON.stringify(memory.events(), null, 2), "utf8")
  return { file, dir, events: [...memory.events()] }
}

function claim(claims: readonly Claim[] | undefined, subject: string, object: string) {
  return claims?.find((candidate) => candidate.subject === subject && candidate.object === object)
}

describe("instrumented app -> JSON sink -> pipeline", () => {
  let before: FlowEvidenceFixture
  let after: FlowEvidenceFixture
  let written: Awaited<ReturnType<typeof writeObservations>>
  const files = { "features/user.ts": PROFILE_CAPABILITY, "app/profile.ts": PROFILE_HANDLERS }

  beforeAll(async () => {
    written = await writeObservations()
    before = await buildFlowEvidence(files)
    const loaded = JSON.parse(await fs.readFile(written.file, "utf8")) as ObservationEvent[]
    after = await buildFlowEvidence(files, { observations: loaded })
  })
  afterAll(async () => {
    await before.cleanup()
    await after.cleanup()
    await fs.rm(written.dir, { recursive: true, force: true })
  })

  it("the sink file holds names, paths and one clock reading per call -- no value", async () => {
    const text = await fs.readFile(written.file, "utf8")
    expect(text).not.toContain(PASSWORD_HASH)
    expect(text).not.toContain(EMAIL)
    expect(text).not.toContain("Ada")
    expect(written.events.map((event) => event.field)).toEqual([
      "userData.user.id",
      "userData.user.name",
      "userData.user.email",
    ])
    expect(written.events.every((event) => event.at === 1_767_225_600_000)).toBe(true)
  })

  it("without observations the static claim is unobserved", () => {
    expect(
      claim(before.evidence.claims?.claims, "userData.user", "http-response")?.verification,
    ).toBe("unobserved")
  })

  it("with the instrumented run's observations the same claim is verified, naming the scope", () => {
    const verified = claim(after.evidence.claims?.claims, "userData.user", "http-response")
    expect(verified?.verification).toBe("verified")
    expect(verified?.scope.observationScopes).toEqual(["vitest:profile endpoint"])
    expect(verified?.supporting.some((ref) => ref.model === "observation")).toBe(true)
  })

  it("what the run did not witness stays unobserved: the other claims (sourcing, policies) are not lifted by this crossing", () => {
    const others = after.evidence.claims?.claims.filter(
      (candidate) => candidate.object !== "http-response",
    )
    expect(others?.length).toBeGreaterThan(0)
    expect(others?.every((candidate) => candidate.verification === "unobserved")).toBe(true)
  })

  it("the observation model carries the times, and no value reaches the evidence", () => {
    expect(after.evidence.observation?.scopeTimes).toEqual([
      {
        scope: "vitest:profile endpoint",
        firstSeen: "2026-01-01T00:00:00.000Z",
        lastSeen: "2026-01-01T00:00:00.000Z",
      },
    ])
    const text = JSON.stringify(after.evidence)
    for (const secret of [PASSWORD_HASH, EMAIL]) expect(text).not.toContain(secret)
  })
})
