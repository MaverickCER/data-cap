/**
 * The comparison of two revisions, as data: what a person is told changed between the committed earlier revision
 * (docs/baseline.evidence.json: before the debug endpoint existed) and the one on screen.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import type { EvidenceModel } from "data-cap/build"
import { compareEvidence, renderComparisonMarkdown, summarize } from "../scripts/explorer/compare.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name: string): EvidenceModel => JSON.parse(readFileSync(path.join(here, "../docs", name), "utf8")) as EvidenceModel
const baseline = read("baseline.evidence.json")
const current = read("data.evidence.json")

const labels = (comparison: ReturnType<typeof compareEvidence>, group: string): string[] => comparison.sections.find((section) => section.group === group)?.items.map((item) => item.label) ?? []

describe("the committed earlier revision", () => {
  it("is a real, different evidence file: same capability, no debug endpoint, no leak", () => {
    assert.ok(baseline.flow && current.flow)
    assert.ok(!baseline.flow.nodes.some((node) => node.name === "exportEverything"))
    assert.ok(current.flow.nodes.some((node) => node.name === "exportEverything"))
    assert.equal(baseline.policy?.summary.violated, 0)
    assert.equal(current.policy?.summary.violated, 1)
  })
})

describe("compareEvidence(baseline, current)", () => {
  const comparison = compareEvidence(baseline, current)

  it("lists the edges the leak added, and none removed", () => {
    assert.deepEqual(labels(comparison, "added-edges"), [
      "reads (whole): userData.user to exportEverything (static)",
      "side-effect (whole): exportEverything to http-response (static)",
    ])
    assert.deepEqual(labels(comparison, "removed-edges"), [])
  })

  it("lists the nodes the leak added, and the policy result that changed because of it", () => {
    assert.deepEqual(labels(comparison, "added-nodes"), [
      "function exportEverything (static)",
      "parameter exportEverything.res (static)",
      "return exportEverything#return (static)",
    ])
    assert.deepEqual(labels(comparison, "changed-policy"), ["userData/no-password-to-client for userData.user: satisfied, static before, violated reaching http-response, static now"])
  })

  it("every item that has a place in the source says where, and names which revision it can be inspected in", () => {
    const edges = comparison.sections.find((section) => section.group === "added-edges")!.items
    assert.deepEqual(edges.map((item) => [item.side, item.kind, /^src\/app\/export\.ts:\d+:\d+$/.test(item.location ?? "")]), [["now", "edge", true], ["now", "edge", true]], "both arise in the debug endpoint")
    const policy = comparison.sections.find((section) => section.group === "changed-policy")!.items[0]!
    assert.match(policy.location ?? "", /^src\/app\/export\.ts:\d+:\d+$/)
    assert.equal(policy.side, "now")
    assert.ok(policy.highlights.length >= 2, "the edges the violation rests on are highlighted")
  })

  it("marks what is new, and the edges of the changed policy result, for highlighting", () => {
    assert.ok([...comparison.added.nodes].some((id) => id.includes("exportEverything")))
    assert.equal(comparison.added.edges.size, 2)
    assert.equal(comparison.changed.edges.size, 2)
    assert.equal(comparison.changed.nodes.size, 0)
    assert.equal(comparison.unchanged, false)
  })

  it("the summary says how much changed, in the same words as the lists", () => {
    assert.equal(
      summarize(comparison, "the earlier revision"),
      "Compared with the earlier revision: 2 edge(s) added, 0 removed; 3 node(s) added, 0 removed, 0 changed; 0 new unknown(s), 0 resolved; 1 policy result(s) changed.",
    )
  })

  it("renders as plain Markdown with the three lists a pull request needs", () => {
    const text = renderComparisonMarkdown(comparison, "the earlier revision")
    assert.match(text, /^# Data-flow changes\n\nCompared with the earlier revision:/)
    assert.match(text, /## Added edges\n\n- reads \(whole\): userData\.user to exportEverything \(static\) \[src\/app\/export\.ts:\d+:\d+\]\n- side-effect \(whole\): exportEverything to http-response \(static\) \[src\/app\/export\.ts:\d+:\d+\]/)
    assert.match(text, /## Removed edges\n\n- none/)
    assert.match(text, /## Changed policy results\n\n- userData\/no-password-to-client for userData\.user: satisfied, static before, violated reaching http-response, static now \[src\/app\/export\.ts:\d+:\d+\]/)
  })
})

describe("compareEvidence(current, baseline): the leak removed", () => {
  const comparison = compareEvidence(current, baseline)
  it("lists the same changes as removed, inspectable only in the earlier revision, and the rule held again", () => {
    assert.deepEqual(labels(comparison, "added-edges"), [])
    assert.equal(labels(comparison, "removed-edges").length, 2)
    const removed = comparison.sections.find((section) => section.group === "removed-edges")!.items
    assert.ok(removed.every((item) => item.side === "before"))
    assert.deepEqual(labels(comparison, "changed-policy"), ["userData/no-password-to-client for userData.user: violated reaching http-response, static before, satisfied, static now"])
    assert.equal(comparison.added.edges.size, 0)
    assert.equal(comparison.changed.edges.size, 0, "a result that now holds has no violating edge to highlight")
  })
})

describe("compareEvidence(current, current)", () => {
  it("finds no difference, and says so", () => {
    const comparison = compareEvidence(current, current)
    assert.equal(comparison.unchanged, true)
    assert.equal(summarize(comparison, "itself"), "No difference from itself.")
    for (const section of comparison.sections) assert.equal(section.items.length, 0)
  })
})

describe("unknowns and changed nodes", () => {
  it("reports an unknown that appeared or went away, and a node whose status or classification changed", () => {
    const edited = structuredClone(current) as unknown as { flow: { nodes: { id: string; kind: string; status: string; classification?: string }[]; unknowns: unknown[] } }
    edited.flow.unknowns = []
    const field = edited.flow.nodes.find((node) => node.kind === "field")!
    field.classification = "restricted"
    field.status = "inferred"
    const comparison = compareEvidence(edited as unknown as EvidenceModel, current)
    assert.equal(labels(comparison, "new-unknowns").length, 1)
    assert.match(labels(comparison, "new-unknowns")[0]!, /^unresolved-call at src\/app\/track\.ts:\d+:\d+/)
    assert.deepEqual(labels(comparison, "changed-nodes"), ["field userData.user: inferred, restricted before, static, confidential now"])
    assert.ok(comparison.changed.nodes.has(field.id))
    const back = compareEvidence(current, edited as unknown as EvidenceModel)
    assert.equal(labels(back, "resolved-unknowns").length, 1)
    assert.equal(back.sections.find((s) => s.group === "resolved-unknowns")!.items[0]!.side, "before")
  })
})
