import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  computeSourceFingerprint,
  evidenceOptionsKey,
} from "../../src/build/evidence-fingerprint.js"
import { nodeBuildFs } from "../support/build-filesystem.js"

describe("evidenceOptionsKey", () => {
  it("is undefined when no option changes what the evidence contains", () => {
    expect(evidenceOptionsKey({})).toBeUndefined()
    expect(evidenceOptionsKey({ flowEvidence: false })).toBeUndefined()
    expect(
      evidenceOptionsKey({
        flowEvidence: undefined,
        flowSinks: undefined,
        observations: undefined,
      }),
    ).toBeUndefined()
  })

  it("differs between flow analysis on and off", () => {
    expect(evidenceOptionsKey({ flowEvidence: true })).toBeDefined()
    expect(evidenceOptionsKey({ flowEvidence: true })).not.toBe(
      evidenceOptionsKey({ flowEvidence: true, flowSinks: [] }),
    )
  })

  it("differs when the recognised sinks differ", () => {
    const a = evidenceOptionsKey({
      flowEvidence: true,
      flowSinks: [{ callee: "a.b", boundary: { kind: "log", name: "x" } }],
    })
    const b = evidenceOptionsKey({
      flowEvidence: true,
      flowSinks: [{ callee: "a.c", boundary: { kind: "log", name: "x" } }],
    })
    expect(a).not.toBe(b)
  })

  it("differs when the observations differ, and not when they merely arrive in another order", () => {
    const one = { scope: "s", boundary: { kind: "api" as const, name: "x" }, field: "a.b" }
    const two = { scope: "s", boundary: { kind: "api" as const, name: "x" }, field: "a.c" }
    expect(evidenceOptionsKey({ observations: [one] })).not.toBe(
      evidenceOptionsKey({ observations: [two] }),
    )
    expect(evidenceOptionsKey({ observations: [one, two] })).toBe(
      evidenceOptionsKey({ observations: [two, one] }),
    )
  })

  it("treats an empty observation list as different from no observations (the pass ran and found nothing)", () => {
    expect(evidenceOptionsKey({ observations: [] })).toBeDefined()
  })

  it("never includes anything but names and paths of an observation, even if a value was smuggled in", () => {
    const smuggled = {
      scope: "s",
      boundary: { kind: "api" as const, name: "x" },
      field: "a.b",
      value: "secret@example.com",
    }
    const clean = { scope: "s", boundary: { kind: "api" as const, name: "x" }, field: "a.b" }
    expect(evidenceOptionsKey({ observations: [smuggled] })).toBe(
      evidenceOptionsKey({ observations: [clean] }),
    )
  })
})

describe("computeSourceFingerprint with an options key", () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-fingerprint-extra-"))
    await fs.writeFile(path.join(root, "data.ts"), "export const x = 1\n", "utf8")
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it("is unchanged by an absent key, so existing fingerprints do not churn", async () => {
    const without = await computeSourceFingerprint({ fs: nodeBuildFs, root })
    const withUndefined = await computeSourceFingerprint({
      fs: nodeBuildFs,
      root,
      extra: undefined,
    })
    expect(withUndefined).toBe(without)
  })

  it("changes when a key is present, and differs between keys", async () => {
    const base = await computeSourceFingerprint({ fs: nodeBuildFs, root })
    const a = await computeSourceFingerprint({ fs: nodeBuildFs, root, extra: "a" })
    const b = await computeSourceFingerprint({ fs: nodeBuildFs, root, extra: "b" })
    expect(a).not.toBe(base)
    expect(b).not.toBe(a)
  })

  it("keys flow summaries by every field, in order, with a fixed placeholder for each one left out", () => {
    expect(
      evidenceOptionsKey({
        flowEvidence: true,
        flowSummaries: [
          {
            module: "lodash",
            export: "pick",
            effect: "sink",
            arg: 1,
            approximate: true,
            boundary: { kind: "log", name: "audit" },
            handling: "masked",
          },
          { module: "zod", export: "parse", effect: "pass-through" },
        ],
      }),
    ).toBe(
      '{"flow":true,"summaries":[["lodash","pick","sink",1,true,"log","audit","masked"],["zod","parse","pass-through","",false,"","",""]]}',
    )
  })

  it("keeps an argument of 0 apart from no argument", () => {
    const key = (arg?: number) =>
      evidenceOptionsKey({
        flowEvidence: true,
        flowSummaries: [{ module: "m", export: "e", effect: "returns-arg", arg }],
      })
    expect(key(0)).toContain('"returns-arg",0,')
    expect(key(0)).not.toBe(key())
  })
})
