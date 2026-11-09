import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderFlowText } from "../../src/evidence/flow-text.js"
import { profileFixture } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

describe("renderFlowText (the accessible, textual equivalent of the graph)", () => {
  let fixture: FlowEvidenceFixture
  let text: string

  beforeAll(async () => {
    fixture = await profileFixture()
    text = renderFlowText(fixture.evidence)!
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  const section = (heading: string): string => {
    const start = text.indexOf(`\n### ${heading}\n`)
    if (start === -1) throw new Error(`no section for ${heading}`)
    const next = text.indexOf("\n### ", start + 5)
    const next2 = text.indexOf("\n## ", start + 5)
    const end =
      [next, next2].filter((index) => index !== -1).sort((a, b) => a - b)[0] ?? text.length
    return text.slice(start, end)
  }

  it("states coverage first, and says plainly when the picture is not complete", () => {
    expect(text.startsWith("# Data flow\n")).toBe(true)
    expect(text).toContain("5 function(s) analyzed")
    expect(text).toContain("1 unknown(s)")
    expect(text).toMatch(/not complete/)
  })

  it("explains the five statuses", () => {
    for (const status of ["declared", "static", "observed", "inferred", "unknown"])
      expect(text).toContain(`- **${status}**`)
  })

  it("buildUserProfile reads like the user's illustration: reads three, returns three, discards two", () => {
    const block = section("buildUserProfile")
    expect(block).toContain("- Confidence: static")
    expect(block).toContain("- Inputs: user")
    expect(block).toContain("- Reads: userData.user (via parameter): email, id, name")
    expect(block).toContain("- Returns: userData.user: email, id, name")
    expect(block).toContain("- Discards: userData.user: passwordHash, role")
    expect(block).toContain("- Callers: profileHandler")
    expect(block).toContain("- Callees: none")
    expect(block).toContain("- Side effects: none")
  })

  it("sendProfileToClient names the boundary it sends to and what goes there", () => {
    expect(section("sendProfileToClient")).toContain(
      "- Side effects: client-response http-response: userData.user: email, id, name",
    )
  })

  it("exportEverything shows a whole-record send", () => {
    expect(section("exportEverything")).toContain(
      "- Side effects: client-response http-response: userData.user: (whole)",
    )
  })

  it("trackUser cites where the analysis lost the data", () => {
    const block = section("trackUser")
    expect(block).toContain("- Confidence: inferred")
    expect(block).toContain(
      "- Not followed: app/track.ts:5:3 -- an unresolved call that receives tracked data",
    )
  })

  it("describes the field: sources, destinations, who drops what, and whether it is complete", () => {
    const block = section("userData.user")
    expect(block).toContain("- Classification: confidential")
    expect(block).toContain("- Fetched from: postgres:users (database, declared)")
    expect(block).toContain(
      "- Reaches: client-response http-response: (whole), email, id, name (static)",
    )
    expect(block).toContain("- Dropped by: buildUserProfile: passwordHash, role")
    expect(block).toMatch(/- Complete: no/)
  })

  it("lists the claims with their verification, contradicted ones included", () => {
    expect(text).toMatch(
      /- \[contradicted\] Rule userData\/no-password-to-client holds for userData\.user/,
    )
    expect(text).toMatch(/- \[unobserved\] userData\.user reaches client-response http-response/)
  })

  it("lists every unknown with its location, so nothing is hidden", () => {
    expect(text).toContain("## What the analysis could not follow")
    expect(text).toContain("- app/track.ts:5:3 -- an unresolved call that receives tracked data")
  })

  it("never prints a raw undefined or [object Object]", () => {
    expect(text).not.toContain("undefined")
    expect(text).not.toContain("[object Object]")
  })

  it("is deterministic and ends with a single newline", () => {
    expect(renderFlowText(fixture.evidence)).toBe(text)
    expect(text.endsWith("\n")).toBe(true)
    expect(text.endsWith("\n\n")).toBe(false)
  })

  it("can be limited to one field and its functions", () => {
    const only = renderFlowText(fixture.evidence, { field: "userData.user" })!
    expect(only).toContain("### userData.user")
    const none = renderFlowText(fixture.evidence, { field: "userData.nope" })!
    expect(none).toContain("No field named userData.nope")
  })

  it("can shift heading levels to nest inside a larger document", () => {
    const nested = renderFlowText(fixture.evidence, { headingLevel: 2 })!
    expect(nested.startsWith("## Data flow\n")).toBe(true)
    expect(nested).toContain("\n#### buildUserProfile\n")
  })

  it("returns undefined when no flow was computed", async () => {
    const without = await profileFixture({ flowEvidence: false })
    try {
      expect(renderFlowText(without.evidence)).toBeUndefined()
    } finally {
      await without.cleanup()
    }
  })
})
