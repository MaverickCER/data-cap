import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderFlowDot } from "../../src/evidence/flow-dot.js"
import { renderFlowMermaid } from "../../src/evidence/flow-mermaid.js"
import { profileFixture } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

let fixture: FlowEvidenceFixture
beforeAll(async () => {
  fixture = await profileFixture()
})
afterAll(async () => {
  await fixture.cleanup()
})

describe("renderFlowDot", () => {
  const dot = (options = {}) => renderFlowDot(fixture.evidence, options)!

  it("is a well-formed digraph whose every edge endpoint is a declared node", () => {
    const text = dot()
    // The disclaimer rides in a leading // comment; the graph itself follows.
    expect(text.split("\n")[1]?.startsWith("digraph ")).toBe(true)
    expect(text.trimEnd().endsWith("}")).toBe(true)
    const declared = new Set([...text.matchAll(/^\s*"(n\d+)" \[/gm)].map((m) => m[1]))
    const edges = [...text.matchAll(/^\s*"(n\d+)" -> "(n\d+)"/gm)]
    expect(edges.length).toBeGreaterThan(0)
    for (const edge of edges) {
      expect(declared.has(edge[1]), `${edge[1]} undeclared`).toBe(true)
      expect(declared.has(edge[2]), `${edge[2]} undeclared`).toBe(true)
    }
    expect((text.match(/{/g) ?? []).length).toBe((text.match(/}/g) ?? []).length)
  })

  it("carries each node's and edge's evidence id as a DOT id attribute, so a rendered diagram links back to the evidence", () => {
    const text = dot()
    const flow = fixture.evidence.flow!
    const connected = new Set(
      flow.edges.filter((e) => e.kind !== "calls").flatMap((e) => [e.from, e.to]),
    )
    const drawn = flow.nodes.filter(
      (node) => (node.kind !== "parameter" && node.kind !== "return") || connected.has(node.id),
    )
    for (const node of drawn) expect(text, node.id).toContain(`id="${node.id}"`)
    for (const edge of flow.edges.filter((e) => e.kind !== "calls"))
      expect(text, edge.id).toContain(`id="${edge.id}"`)
    for (const unknown of flow.unknowns) expect(text).toContain(`id="${unknown.id}"`)
  })

  it("labels the nodes and the field-level edges", () => {
    const text = dot()
    expect(text).toContain('label="userData.user')
    expect(text).toContain('label="buildUserProfile"')
    expect(text).toContain("client-response: http-response")
    expect(text).toMatch(/label="reads email/)
    expect(text).toMatch(/label="discards passwordHash/)
  })

  it("draws what the analysis could not follow as a visible node, and says when the graph is not complete", () => {
    const text = dot()
    expect(text).toContain("unknown: unresolved-call")
    expect(text).toContain("app/track.ts:5:3")
    expect(text).toMatch(/NOT complete/)
  })

  it("marks a status in text on the edge, not only in colour", () => {
    expect(dot()).toMatch(/label="crosses-boundary \[declared\]"/)
  })

  it("highlights the edges of a violated policy", () => {
    const text = dot()
    const highlighted = text.split("\n").filter((line) => line.includes("penwidth=2"))
    expect(highlighted.length).toBeGreaterThan(0)
    expect(highlighted.every((line) => line.includes("color=red"))).toBe(true)
  })

  it("hides calls edges unless asked, and shows them dashed when asked", () => {
    expect(dot()).not.toMatch(/label="calls/)
    expect(dot({ includeCalls: true })).toMatch(/label="calls"[^\n]*style=dashed/)
  })

  it("does not draw a parameter or return node that nothing connects to (it only clutters the whole-graph view)", () => {
    const flow = fixture.evidence.flow!
    const connected = new Set(
      flow.edges.filter((e) => e.kind !== "calls").flatMap((e) => [e.from, e.to]),
    )
    const text = dot()
    for (const node of flow.nodes.filter((n) => n.kind === "parameter" || n.kind === "return")) {
      expect(text.includes(`id="${node.id}"`), node.id).toBe(connected.has(node.id))
    }
    // Functions are always drawn: an unconnected function is a coverage fact, not clutter.
    for (const node of flow.nodes.filter((n) => n.kind === "function"))
      expect(text).toContain(`id="${node.id}"`)
  })

  it("limits the graph to one field's flow, and to one path of it", () => {
    const whole = dot({ field: "userData.user" })
    expect(whole).toContain("sendProfileToClient")
    const narrow = dot({ field: "userData.user", path: ["passwordHash"] })
    expect(narrow).not.toContain('label="sendProfileToClient"')
    expect(narrow).toContain("exportEverything")
  })

  it("says so when the field does not exist, instead of drawing an empty graph", () => {
    const text = dot({ field: "userData.nope" })
    expect(text).toContain("No field named userData.nope")
    expect(text).not.toMatch(/"n\d+" -> /)
  })

  it("escapes quotes and backslashes in labels", () => {
    expect(dot()).not.toMatch(/label="[^"\n]*[^\\]"[^"\n]*"\s*[,\]]/)
  })

  it("is deterministic", () => {
    expect(dot()).toBe(dot())
  })

  it("returns undefined when no flow was computed", async () => {
    const without = await profileFixture({ flowEvidence: false })
    try {
      expect(renderFlowDot(without.evidence)).toBeUndefined()
    } finally {
      await without.cleanup()
    }
  })
})

describe("renderFlowMermaid", () => {
  const mmd = (options = {}) => renderFlowMermaid(fixture.evidence, options)!

  it("is a flowchart whose every edge endpoint is a declared node", () => {
    const text = mmd()
    // The disclaimer rides in a leading %% comment; the flowchart itself follows.
    expect(text.split("\n")[1]).toBe("flowchart LR")
    const declared = new Set([...text.matchAll(/^\s+(n\d+)(?:\[|\(|\{)/gm)].map((m) => m[1]))
    const edges = [...text.matchAll(/^\s+(n\d+) (?:--|-\.|==)[^\n]*?(?:-->|\.->|==>) (n\d+)\s*$/gm)]
    expect(edges.length).toBeGreaterThan(0)
    for (const edge of edges) {
      expect(declared.has(edge[1]), `${edge[1]} undeclared`).toBe(true)
      expect(declared.has(edge[2]), `${edge[2]} undeclared`).toBe(true)
    }
  })

  it("labels nodes and edges and states completeness in a comment-free, readable way", () => {
    const text = mmd()
    expect(text).toContain("buildUserProfile")
    expect(text).toContain("client-response: http-response")
    expect(text).toMatch(/reads email/)
    expect(text).toContain("NOT complete")
  })

  it("shows unknowns as nodes and marks non-static status in the label text", () => {
    const text = mmd()
    expect(text).toContain("unknown: unresolved-call")
    expect(text).toMatch(/crosses-boundary \[declared\]/)
  })

  it("draws a violated policy's edges thick and red", () => {
    const text = mmd()
    expect(text).toMatch(/==>/)
    expect(text).toMatch(/linkStyle \d+ stroke:#d00/)
  })

  it("never lets a label break out of its quotes", () => {
    for (const line of mmd().split("\n")) {
      const quotes = (line.match(/"/g) ?? []).length
      expect(quotes % 2, line).toBe(0)
    }
  })

  it("limits to one field, says so when it is missing, and is deterministic", () => {
    expect(mmd({ field: "userData.user", path: ["passwordHash"] })).not.toContain(
      "sendProfileToClient",
    )
    expect(mmd({ field: "userData.nope" })).toContain("No field named userData.nope")
    expect(mmd()).toBe(mmd())
  })

  it("returns undefined when no flow was computed", async () => {
    const without = await profileFixture({ flowEvidence: false })
    try {
      expect(renderFlowMermaid(without.evidence)).toBeUndefined()
    } finally {
      await without.cleanup()
    }
  })
})
