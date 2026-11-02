import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { readObservationsInput } from "../../src/cli/index.js"
import {
  buildFlowEvidence,
  PROFILE_CAPABILITY,
  PROFILE_HANDLERS,
} from "../support/flow-evidence-fixture.js"

const files = { "features/user.ts": PROFILE_CAPABILITY, "app/profile.ts": PROFILE_HANDLERS }
const boundary = { kind: "client-response" as const, name: "http-response" }
const events = [{ scope: "vitest:profile", boundary, field: "userData.user.email" }]

describe("a recorder that dropped evidence cannot verify a claim", () => {
  it("verified without skips; indeterminate once the file reports a skipped path under the field", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "data-cap-skips-"))
    try {
      const file = path.join(dir, "observations.json")
      const skips = [
        { scope: "vitest:profile", boundary, field: "userData.user", reason: "max-depth" },
      ]
      await fs.writeFile(file, JSON.stringify({ events, skips }), "utf8")
      const input = await readObservationsInput(file)
      expect(input.skips).toHaveLength(1)

      const verifiedRun = await buildFlowEvidence(files, { observations: input.events })
      const skippedRun = await buildFlowEvidence(files, {
        observations: input.events,
        observationSkips: input.skips,
      })
      try {
        const pick = (run: typeof verifiedRun) =>
          run.evidence.claims?.claims.find(
            (claim) => claim.subject === "userData.user" && claim.object === "http-response",
          )
        expect(pick(verifiedRun)?.verification).toBe("verified")
        expect(pick(skippedRun)?.verification).toBe("indeterminate")
        expect(skippedRun.evidence.observation?.truncatedScopes).toEqual(["vitest:profile"])
      } finally {
        await verifiedRun.cleanup()
        await skippedRun.cleanup()
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
