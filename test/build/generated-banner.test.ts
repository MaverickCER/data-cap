import { describe, expect, it } from "vitest"
import {
  evidenceDisclaimer,
  evidenceProjectionNote,
  generatedBanner,
  isGeneratedFile,
} from "../../src/build/generated-banner.js"

describe("generatedBanner", () => {
  it("renders a TS-style comment by default", () => {
    expect(generatedBanner()).toMatch(/^\/\/ GENERATED FILE/)
  })

  it("renders a TS-style comment explicitly", () => {
    expect(generatedBanner("ts")).toMatch(/^\/\/ GENERATED FILE/)
  })

  it("renders a Markdown-style HTML comment", () => {
    expect(generatedBanner("markdown")).toMatch(/^<!-- GENERATED FILE/)
    expect(generatedBanner("markdown")).toMatch(/-->$/)
  })

  it("renders the exact banner text in both formats", () => {
    expect(generatedBanner("ts")).toBe(
      "// GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate.",
    )
    expect(generatedBanner("markdown")).toBe(
      "<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->",
    )
  })
})

describe("isGeneratedFile", () => {
  it("recognizes a TS-banner-prefixed file", () => {
    expect(isGeneratedFile(`${generatedBanner("ts")}\n\nexport {}`)).toBe(true)
  })

  it("recognizes a Markdown-banner-prefixed file", () => {
    expect(isGeneratedFile(`${generatedBanner("markdown")}\n\n# Title`)).toBe(true)
  })

  it("returns false for hand-written content", () => {
    expect(isGeneratedFile("export const x = 1")).toBe(false)
  })

  it("returns false for empty content", () => {
    expect(isGeneratedFile("")).toBe(false)
  })
})

describe("evidenceDisclaimer", () => {
  it("states it can support review but never establishes compliance", () => {
    const text = evidenceDisclaimer()
    expect(text).toContain("does not itself establish compliance")
    expect(text).toContain("can support")
  })
})

describe("evidenceProjectionNote", () => {
  it("names the Evidence Model by concept only when no evidencePath is given", () => {
    const text = evidenceProjectionNote()
    expect(text).toContain("Projected from data-cap's Evidence Model")
    expect(text).not.toContain("This run also wrote it to")
  })

  it("additionally names the concrete path when evidencePath is given", () => {
    const text = evidenceProjectionNote("/project/docs/data.evidence.json")
    expect(text).toContain("Projected from data-cap's Evidence Model")
    expect(text).toContain("This run also wrote it to `/project/docs/data.evidence.json`.")
  })
})
