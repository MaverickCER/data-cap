/**
 * The standards outputs, validated by the standards' own tools rather than by
 * shapes we wrote ourselves: Graphviz itself lays out the DOT, the real Mermaid
 * parser parses the diagram, and SARIF and OSCAL are checked against the
 * official JSON Schemas (vendored in the root's test fixtures, byte for byte).
 * What is committed under docs/ is what is tested, and `npm run check` already
 * guarantees it is what the analysis produces.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { instance } from "@viz-js/viz"
import Ajv from "ajv"
import Ajv04 from "ajv-draft-04"
import addFormats from "ajv-formats"
import { JSDOM } from "jsdom"

const here = path.dirname(fileURLToPath(import.meta.url))
const docs = (name: string): string => readFileSync(path.join(here, "../docs", name), "utf8")
const standards = (name: string): unknown => JSON.parse(readFileSync(path.join(here, "../../../test/fixtures/standards", name), "utf8"))

describe("DOT", () => {
  it("is laid out by Graphviz itself, and the SVG carries every evidence id back", async () => {
    const dot = docs("flow.dot")
    const viz = await instance()
    const svg = viz.renderString(dot, { format: "svg", engine: "dot" })
    // Parse the SVG, so attribute values are compared decoded (Graphviz escapes "-" and ">" in them).
    const doc = new JSDOM(svg, { contentType: "image/svg+xml" }).window.document
    const svgIds = new Set([...doc.querySelectorAll("g[id]")].map((g) => g.getAttribute("id")))
    const dotDoc = new JSDOM("<!doctype html>").window.document
    const decode = (text: string): string => {
      const holder = dotDoc.createElement("textarea")
      holder.innerHTML = text
      return holder.value
    }
    const ids = [...dot.matchAll(/id="([^"]+)"/g)].map((m) => decode((m[1] as string).replace(/\\"/g, '"')))
    assert.ok(ids.length > 10)
    for (const id of ids) assert.ok(svgIds.has(id), `${id} survives into the SVG`)
    const evidence = JSON.parse(docs("data.evidence.json")) as { flow: { nodes: { id: string }[] } }
    assert.ok(evidence.flow.nodes.some((node) => svgIds.has(node.id)))
  })

  it("rejects what is not DOT (so the check above is not vacuous)", async () => {
    const viz = await instance()
    assert.throws(() => viz.renderString("digraph { a -> }", { format: "svg" }))
  })
})

describe("Mermaid", () => {
  it("is parsed by the real Mermaid parser as a flowchart", async () => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>")
    Object.assign(globalThis, { window: dom.window, document: dom.window.document })
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true })
    const { default: mermaid } = await import("mermaid")
    const parsed = await mermaid.parse(docs("flow.mmd"))
    assert.ok(parsed && typeof parsed === "object" && "diagramType" in parsed)
    assert.match(String((parsed as { diagramType: string }).diagramType), /flowchart/)
    await assert.rejects(mermaid.parse("flowchart LR\n  a --> "))
  })
})

describe("SARIF", () => {
  it("is valid against the official SARIF 2.1.0 schema, and carries the leak with a code flow", () => {
    const validate = new Ajv04({ strict: false, allErrors: true }).compile(standards("sarif-schema-2.1.0.json") as object)
    const log = JSON.parse(docs("flow.sarif.json")) as { runs: { results: { ruleId: string; codeFlows?: unknown[]; locations?: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[] }
    assert.equal(validate(log), true, JSON.stringify(validate.errors?.slice(0, 3)))
    const violation = log.runs[0]?.results.find((r) => r.ruleId === "FLOW_POLICY_VIOLATED")
    assert.ok(violation, "the leak is a SARIF result")
    assert.equal(violation.locations?.[0]?.physicalLocation.artifactLocation.uri, "src/app/export.ts", "anchored at the debug endpoint")
    assert.ok((violation.codeFlows?.length ?? 0) > 0, "with the path the data took")
  })
})

describe("OSCAL", () => {
  it("is valid against NIST's official OSCAL 1.1.2 assessment-results schema, and reports the leak as not-satisfied", () => {
    const ajv = new Ajv({ strict: false, allErrors: true })
    addFormats(ajv)
    const validate = ajv.compile(standards("oscal_assessment-results_schema-1.1.2.json") as object)
    const doc = JSON.parse(docs("flow.oscal.json")) as {
      "assessment-results": { results: { findings: { target: { "target-id": string; status: { state: string } } }[] }[] }
    }
    assert.equal(validate(doc), true, JSON.stringify(validate.errors?.slice(0, 3)))
    const states = Object.fromEntries(doc["assessment-results"].results[0]!.findings.map((f) => [f.target["target-id"], f.target.status.state]))
    assert.deepEqual(states, { "ac-4": "not-satisfied", "sc-28": "not-satisfied", "au-3": "satisfied" })
  })
})

describe("CycloneDX", () => {
  it("is valid against the official CycloneDX 1.6 schema, and states the leak, the unknown and the incomplete coverage", () => {
    const ajv = new Ajv({ strict: false, allErrors: true })
    addFormats(ajv)
    ajv.addSchema(standards("spdx.schema.json") as object)
    ajv.addSchema(standards("jsf-0.82.schema.json") as object)
    const validate = ajv.compile(standards("bom-1.6.schema.json") as object)
    type Property = { name: string; value: string }
    type Service = { "bom-ref": string; name: string; properties: Property[]; data?: { flow: string; classification: string; description: string; destination?: string[]; source?: string[] }[] }
    const bom = JSON.parse(docs("flow.cdx.json")) as {
      specVersion: string
      metadata: { properties: Property[] }
      services: Service[]
      annotations: { text: string }[]
    }
    assert.equal(validate(bom), true, JSON.stringify(validate.errors?.slice(0, 3)))
    assert.equal(bom.specVersion, "1.6")
    const prop = (owner: { properties: Property[] }, name: string): string[] => owner.properties.filter((p) => p.name === name).map((p) => p.value)
    assert.deepEqual(prop(bom.metadata, "data-cap:coverage.complete"), ["false"], "an incomplete analysis is never presented as complete")
    const component = bom.services.find((service) => service.name === "src/features/user.capability.ts")
    const response = bom.services.find((service) => service.name === "http-response")
    assert.ok(component && response)
    const toClient = (component.data ?? []).filter((entry) => entry.flow === "outbound" && entry.destination?.[0]?.endsWith(`#${response["bom-ref"]}`))
    assert.deepEqual(toClient.map((entry) => entry.classification), ["confidential"])
    assert.ok(toClient.some((entry) => /status: static/.test(entry.description) && /\(whole\)/.test(entry.description)), "the whole-record send to the client is a static outbound flow")
    assert.deepEqual(prop(component, "data-cap:status"), ["static"])
    assert.deepEqual(prop(bom.services.find((service) => service.name === "postgres:users")!, "data-cap:status"), ["declared"])
    const text = bom.annotations.map((note) => note.text)
    assert.ok(text.some((line) => line.startsWith("policy violated: userData/no-password-to-client")))
    assert.ok(text.some((line) => line.startsWith("unknown: unresolved-call at src/app/track.ts")))
  })
})

describe("PROV-JSON", () => {
  it("is referentially closed and ties the leak's claim to its evidence", () => {
    const prov = JSON.parse(docs("flow.prov.json")) as Record<string, Record<string, Record<string, unknown>>>
    const known = new Set([...Object.keys(prov.entity ?? {}), ...Object.keys(prov.activity ?? {}), ...Object.keys(prov.agent ?? {})])
    for (const section of ["used", "wasGeneratedBy", "wasDerivedFrom", "wasAssociatedWith", "wasInformedBy"]) {
      for (const relation of Object.values(prov[section] ?? {})) {
        for (const [key, value] of Object.entries(relation)) if (key.startsWith("prov:") && typeof value === "string" && !key.endsWith("Time")) assert.ok(known.has(value), `${section}: ${value}`)
      }
    }
    const claim = Object.values(prov.entity ?? {}).find((e) => e["dc:statement"] === "Rule userData/no-password-to-client holds for userData.user")
    assert.equal(claim?.["dc:verification"], "contradicted")
  })
})

describe("OpenTelemetry", () => {
  it("is OTLP/JSON with one span per observation, never a value", () => {
    const text = docs("flow.otlp.json")
    const otlp = JSON.parse(text) as { resourceSpans: { scopeSpans: { spans: { traceId: string; spanId: string; attributes: { key: string }[] }[] }[] }[] }
    const spans = otlp.resourceSpans[0]!.scopeSpans[0]!.spans
    const observations = JSON.parse(docs("observations.json")) as unknown[]
    assert.ok(spans.length > 0 && spans.length <= observations.length)
    for (const span of spans) {
      assert.match(span.traceId, /^[0-9a-f]{32}$/)
      assert.match(span.spanId, /^[0-9a-f]{16}$/)
      assert.ok(span.attributes.every((a) => a.key.startsWith("data_cap.")))
    }
    assert.ok(!text.includes("ada@example.com") && !text.includes("argon2id"), "no value ever reaches an observation")
  })
})

describe("the evidence file", () => {
  it("never contains a value from the data it describes", () => {
    const text = docs("data.evidence.json")
    assert.ok(!text.includes("ada@example.com") && !text.includes("argon2id") && !text.includes("Ada Lovelace"))
  })
})
