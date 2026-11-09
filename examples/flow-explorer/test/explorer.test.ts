/**
 * The explorer, exercised the way a person uses it: keyboard, mouse, filters,
 * a shared link, a second revision -- in jsdom, with the page's real, bundled
 * script running against the real committed evidence. Plus an accessibility
 * audit (axe-core) and WCAG contrast, computed from the very palette the CSS is
 * generated from.
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import axe from "axe-core"
import { JSDOM, VirtualConsole } from "jsdom"
import { CONTRAST_PAIRS, DARK, LIGHT } from "../scripts/lib/explorer.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const html = readFileSync(path.join(here, "../docs/explorer.html"), "utf8")
const evidenceText = readFileSync(path.join(here, "../docs/data.evidence.json"), "utf8")
const evidence = JSON.parse(evidenceText) as {
  flow: { nodes: { id: string; name: string; kind: string }[] }
  policy: { results: { outcome: string; edges: string[] }[] }
}

const USER = evidence.flow.nodes.find((node) => node.kind === "field")!.id
const idOf = (name: string): string => evidence.flow.nodes.find((node) => node.name === name)!.id

/** Errors the page's own code raised. jsdom's "not implemented: canvas" is axe probing for a canvas jsdom lacks, not the page. */
const pageErrors: string[] = []

function open(hash = "", scripts = true): JSDOM {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on("jsdomError", (error: Error) => {
    if (!/Not implemented: HTMLCanvasElement/.test(error.message)) pageErrors.push(error.stack ?? error.message)
  })
  return new JSDOM(html, { url: `https://example.test/explorer.html${hash}`, runScripts: scripts ? "dangerously" : undefined, pretendToBeVisual: true, virtualConsole })
}

const doc = (dom: JSDOM): Document => dom.window.document
const group = (dom: JSDOM, id: string): Element => {
  const found = [...doc(dom).querySelectorAll("#graph g.node, #graph g.edge")].find((g) => g.getAttribute("id") === id)
  assert.ok(found, `no graph element ${id}`)
  return found
}
const classes = (dom: JSDOM, id: string): string[] => [...group(dom, id).classList]
const summary = (dom: JSDOM): string => doc(dom).getElementById("summary")!.textContent ?? ""
const change = (dom: JSDOM, id: string, value: string): void => {
  const element = doc(dom).getElementById(id) as HTMLInputElement | HTMLSelectElement
  element.value = value
  element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }))
}
const key = (dom: JSDOM, target: Element, name: string): void => {
  target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }))
}

describe("without scripts", () => {
  const dom = open("", false)
  it("still reads: coverage, the claims table, and the full text equivalent are in the page", () => {
    assert.match(doc(dom).getElementById("coverage")!.textContent!, /NOT complete/)
    assert.ok(doc(dom).querySelectorAll("table tbody tr").length >= 4)
    const text = doc(dom).getElementById("text-body")!.textContent!
    assert.match(text, /- Discards: userData.user: passwordHash, role/)
    assert.match(text, /not complete/)
  })

  it("is self-contained: nothing is fetched from anywhere", () => {
    assert.ok(!/<link[^>]+href/i.test(html))
    assert.ok(!/\ssrc=["']https?:/i.test(html))
    assert.ok(!/@import|url\(["']?https?:/i.test(html))
  })
})

describe("on load", () => {
  const dom = open()
  it("fills the field selector from the evidence", () => {
    const options = [...(doc(dom).getElementById("field") as HTMLSelectElement).options].map((o) => o.textContent)
    assert.deepEqual(options, ["All data (no trace)", "userData.user"])
  })

  it("announces what is shown, and says plainly that the analysis is not complete", () => {
    assert.match(summary(dom), /Showing all data\./)
    assert.match(summary(dom), /NOT complete/)
    assert.equal(doc(dom).getElementById("summary")!.getAttribute("aria-live"), "polite")
  })

  it("makes every node a keyboard-operable button with a name that states its status, and hides edges from the tab order", () => {
    const nodes = [...doc(dom).querySelectorAll("#graph g.node")]
    assert.ok(nodes.length >= 10)
    for (const node of nodes) {
      assert.equal(node.getAttribute("tabindex"), "0")
      assert.equal(node.getAttribute("role"), "button")
      assert.match(node.getAttribute("aria-label")!, /(declared|static|observed|inferred|unknown)/)
    }
    for (const edge of doc(dom).querySelectorAll("#graph g.edge")) {
      assert.equal(edge.getAttribute("aria-hidden"), "true")
      assert.equal(edge.getAttribute("tabindex"), null)
    }
  })

  it("draws what the analysis could not follow as a node of its own, named as such", () => {
    const unknown = evidence.flow.nodes.length > 0 && [...doc(dom).querySelectorAll("#graph g.node")].find((g) => /^Not followed:/.test(g.getAttribute("aria-label") ?? ""))
    assert.ok(unknown)
  })

  it("marks the violating edge, and nothing else, as a violation", () => {
    const violated = new Set(evidence.policy.results.filter((r) => r.outcome === "violated").flatMap((r) => r.edges))
    const marked = [...doc(dom).querySelectorAll("#graph g.edge.violation")].map((g) => g.getAttribute("id"))
    assert.deepEqual(new Set(marked), violated)
  })
})

describe("tracing", () => {
  it("tracing a path dims everything off it, lights the leak, updates the hash and tells a screen reader", () => {
    const dom = open()
    change(dom, "field", USER)
    change(dom, "path", "passwordHash")
    assert.match(summary(dom), /^Tracing downstream from userData\.user, path passwordHash\./)
    assert.ok(classes(dom, idOf("exportEverything")).includes("trace"))
    assert.ok(!classes(dom, idOf("exportEverything")).includes("dim"))
    assert.ok(classes(dom, idOf("sendProfileToClient")).includes("dim"), "the profile page does not carry passwordHash")
    assert.ok(classes(dom, idOf("buildUserProfile")).includes("dim"))
    assert.match(dom.window.location.hash, /from=/)
    assert.match(dom.window.location.hash, /path=passwordHash/)
  })

  it("tracing email lights the profile page instead", () => {
    const dom = open()
    change(dom, "field", USER)
    change(dom, "path", "email")
    assert.ok(!classes(dom, idOf("sendProfileToClient")).includes("dim"))
    assert.ok(classes(dom, idOf("exportEverything")).includes("trace"), "a whole-record send carries email too")
  })

  it("says so when the trace touches something the analysis could not follow", () => {
    const dom = open()
    change(dom, "field", USER)
    change(dom, "path", "email")
    assert.match(summary(dom), /NOT complete/)
    change(dom, "path", "passwordHash")
    assert.doesNotMatch(summary(dom), /NOT complete/, "the opaque call only ever received email")
  })

  it("T on a node traces upstream or downstream from it, with the direction control", () => {
    const dom = open()
    change(dom, "direction", "upstream")
    const boundary = idOf("http-response")
    key(dom, group(dom, boundary), "t")
    assert.match(summary(dom), /^Tracing upstream from http-response\./)
    assert.ok(!classes(dom, USER).includes("dim"), "the field is upstream of the response")
    assert.ok(classes(dom, idOf("trackUser")).includes("dim"), "trackUser does not feed the response")
  })

  it("Show everything clears the trace and every filter", () => {
    const dom = open()
    change(dom, "field", USER)
    change(dom, "path", "passwordHash")
    ;(doc(dom).getElementById("violations") as HTMLInputElement).checked = true
    doc(dom).getElementById("reset")!.dispatchEvent(new dom.window.Event("click", { bubbles: true }))
    assert.match(summary(dom), /^Showing all data\./)
    assert.equal(doc(dom).querySelectorAll("#graph .dim").length, 0)
    assert.equal(doc(dom).querySelectorAll("#graph .filtered").length, 0)
    assert.equal(dom.window.location.hash, "")
  })
})

describe("filtering", () => {
  it("hiding a status hides what has it, and its edges", () => {
    const dom = open()
    const declared = idOf("postgres:users")
    const box = doc(dom).getElementById("status-declared") as HTMLInputElement
    box.checked = false
    doc(dom).getElementById("statuses")!.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    assert.ok(classes(dom, declared).includes("filtered"))
    assert.match(dom.window.location.hash, /hide=declared/)
  })

  it("only policy violations leaves the leak and what it touches", () => {
    const dom = open()
    ;(doc(dom).getElementById("violations") as HTMLInputElement).checked = true
    doc(dom).getElementById("violations")!.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    assert.ok(!classes(dom, idOf("exportEverything")).includes("filtered"))
    assert.ok(classes(dom, idOf("sendProfileToClient")).includes("filtered"))
  })

  it("the search dims what does not match and leaves what does", () => {
    const dom = open()
    change(dom, "search", "track")
    assert.ok(!classes(dom, idOf("trackUser")).includes("dim"))
    assert.ok(classes(dom, idOf("buildUserProfile")).includes("dim"))
  })
})

describe("drill-down", () => {
  it("Enter on a function shows its inputs, reads, discards and callers, and moves focus to the details", () => {
    const dom = open()
    key(dom, group(dom, idOf("buildUserProfile")), "Enter")
    const detail = doc(dom).getElementById("detail-body")!.textContent!
    assert.match(detail, /buildUserProfile/)
    assert.match(detail, /userData\.user: passwordHash/)
    assert.match(detail, /userData\.user: role/)
    assert.match(detail, /called by profileHandler/)
    assert.equal(doc(dom).activeElement, doc(dom).getElementById("detail"))
  })

  it("Space works too, and the field's details say where it comes from, where it goes and whether that is complete", () => {
    const dom = open()
    key(dom, group(dom, USER), " ")
    const detail = doc(dom).getElementById("detail-body")!.textContent!
    assert.match(detail, /postgres:users \(database, declared\)/)
    assert.match(detail, /client-response http-response/)
    assert.match(detail, /Complete: no/)
    assert.match(detail, /\[contradicted\] Rule userData\/no-password-to-client holds/)
  })

  it("an unknown names what it could not follow, where, and which data entered it", () => {
    const dom = open()
    const unknown = [...doc(dom).querySelectorAll("#graph g.node")].find((g) => /^Not followed:/.test(g.getAttribute("aria-label") ?? ""))!
    key(dom, unknown, "Enter")
    const detail = doc(dom).getElementById("detail-body")!.textContent!
    assert.match(detail, /src\/app\/track\.ts/)
    assert.match(detail, /userData\.user: email/)
  })

  it("clicking an edge shows its kind, status, source and whether it is part of a violation", () => {
    const dom = open()
    const violating = [...doc(dom).querySelectorAll("#graph g.edge.violation")][0]!
    violating.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    const detail = doc(dom).getElementById("detail-body")!.textContent!
    assert.match(detail, /Status: static\. Source: src\/app\/export\.ts:/)
    assert.match(detail, /violated policy rule/)
  })
})

describe("filtering by execution", () => {
  const select = (dom: JSDOM, value: string): void => change(dom, "execution", value)

  it("lists every observed scope, plus 'any' and 'anything observed'", () => {
    const dom = open()
    const options = [...(doc(dom).getElementById("execution") as HTMLSelectElement).options].map((option) => option.textContent)
    assert.deepEqual(options, ["Any (do not filter by execution)", "Anything observed in any execution", "scenario:debug-export", "scenario:profile"])
  })

  it("dims what an execution did not witness, and says what it did", () => {
    const dom = open()
    select(dom, "scenario:profile")
    assert.match(summary(dom), /^Showing what scenario:profile witnessed: 3 observation\(s\), 0 not explained by the static flow\./)
    assert.ok(!classes(dom, idOf("sendProfileToClient")).includes("dim"), "the profile page is on a witnessed route")
    assert.ok(classes(dom, idOf("trackUser")).includes("dim"), "nothing observed went through the analytics call")
    assert.ok(classes(dom, idOf("postgres:users")).includes("dim"), "the declared source is not downstream of anything observed")
  })

  it("is honest that a route is one the static flow offers, not the one that ran", () => {
    const dom = open()
    select(dom, "scenario:profile")
    // Observing `id` at the client could have come through the profile page or the whole-record debug export.
    assert.ok(!classes(dom, idOf("exportEverything")).includes("dim"))
    assert.match(doc(dom).getElementById("execution-note")!.textContent!, /could have taken|routes the static flow offers/i)
  })

  it("combines with a trace: both must hold", () => {
    const dom = open()
    select(dom, "scenario:profile")
    change(dom, "field", USER)
    change(dom, "path", "passwordHash")
    assert.ok(classes(dom, idOf("sendProfileToClient")).includes("dim"), "the trace excludes it")
    assert.ok(!classes(dom, idOf("exportEverything")).includes("dim"))
  })

  it("is part of the shared link, and Show everything clears it", () => {
    const dom = open()
    select(dom, "scenario:profile")
    assert.match(dom.window.location.hash, /execution=scenario%3Aprofile/)
    doc(dom).getElementById("reset")!.dispatchEvent(new dom.window.Event("click", { bubbles: true }))
    assert.equal((doc(dom).getElementById("execution") as HTMLSelectElement).value, "")
    const restored = open(`#${new URLSearchParams({ execution: "scenario:profile" }).toString()}`)
    assert.equal((doc(restored).getElementById("execution") as HTMLSelectElement).value, "scenario:profile")
    assert.match(summary(restored), /witnessed/)
  })
})

describe("comparing revisions", () => {
  it("opens already comparing with the revision embedded in the page, and marks what was added", () => {
    const dom = open()
    const result = doc(dom).getElementById("diff-result")!.textContent!
    assert.match(result, /Compared with the revision embedded in this page/)
    assert.match(result, /userData\/no-password-to-client for userData\.user/)
    assert.ok(classes(dom, idOf("exportEverything")).includes("added"))
    assert.ok(!classes(dom, idOf("buildUserProfile")).includes("added"))
  })

  it("loading a file compares against it; loading the same evidence says there is no difference", async () => {
    const dom = open()
    const input = doc(dom).getElementById("baseline") as HTMLInputElement
    Object.defineProperty(input, "files", { value: [{ name: "same.json", text: async () => evidenceText }] })
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(doc(dom).getElementById("diff-result")!.textContent, "No difference from same.json.")
    assert.equal(doc(dom).querySelectorAll("#graph .added").length, 0)
  })

  it("a file that is not usable evidence is reported, not ignored", async () => {
    const dom = open()
    const input = doc(dom).getElementById("baseline") as HTMLInputElement
    Object.defineProperty(input, "files", { value: [{ name: "bad.json", text: async () => "{}" }] })
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.match(doc(dom).getElementById("diff-result")!.textContent!, /bad\.json could not be used: it has no flow analysis/)
  })
})

describe("comparison lists", () => {
  const items = (dom: JSDOM, group: string): Element[] => [...doc(dom).querySelectorAll(`#diff-result ul[data-group="${group}"] li`)]
  const buttons = (dom: JSDOM, group: string): HTMLButtonElement[] => [...doc(dom).querySelectorAll<HTMLButtonElement>(`#diff-result ul[data-group="${group}"] button`)]
  const headings = (dom: JSDOM): string[] => [...doc(dom).querySelectorAll("#diff-result h3")].map((h) => h.textContent ?? "")
  const detail = (dom: JSDOM): string => doc(dom).getElementById("detail-body")!.textContent!
  const SIDE_EFFECT = "side-effect (whole): exportEverything to http-response (static)"
  const flowOf = (): { edges: { id: string; kind: string; path?: string[]; from: string; to: string }[] } => (evidence as unknown as { flow: { edges: { id: string; kind: string; path?: string[]; from: string; to: string }[] } }).flow
  const loadFile = async (dom: JSDOM, name: string, text: string): Promise<void> => {
    const input = doc(dom).getElementById("baseline") as HTMLInputElement
    Object.defineProperty(input, "files", { value: [{ name, text: async () => text }], configurable: true })
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  it("reads without scripts: the same three lists are in the page as plain text", () => {
    const dom = open("", false)
    const result = doc(dom).getElementById("diff-result")!
    assert.match(result.textContent!, /Compared with the revision embedded in this page/)
    assert.deepEqual([...result.querySelectorAll("h3")].map((h) => h.textContent).slice(0, 3), ["Changed policy results (1)", "Added edges (2)", "Removed edges (0)"])
    assert.ok([...result.querySelectorAll("li")].some((li) => li.textContent!.startsWith(SIDE_EFFECT)))
    assert.match(result.textContent!, /satisfied, static before, violated reaching http-response, static now/)
    assert.equal(result.querySelectorAll("button").length, 0, "no scripts, no buttons: the text alone is complete")
  })

  it("lists Added edges, Removed edges and Changed policy results, then nodes and unknowns, each with its count", () => {
    const dom = open()
    assert.deepEqual(headings(dom), [
      "Changed policy results (1)",
      "Added edges (2)",
      "Removed edges (0)",
      "Added nodes (3)",
      "Removed nodes (0)",
      "Changed nodes (0)",
      "New unknowns (parts of the program the analysis could not follow) (0)",
      "Resolved unknowns (0)",
    ])
    assert.equal(items(dom, "added-edges").length, 2)
    assert.equal(items(dom, "removed-edges")[0]!.textContent, "none")
    assert.ok(items(dom, "added-edges").some((li) => li.textContent!.startsWith(SIDE_EFFECT)))
  })

  it("announces the summary in a live region of its own, not the whole list", () => {
    const dom = open()
    const summaryEl = doc(dom).getElementById("diff-summary")!
    assert.equal(summaryEl.getAttribute("role"), "status")
    assert.match(summaryEl.textContent!, /^Compared with the revision embedded in this page: 2 edge\(s\) added, 0 removed; 3 node\(s\) added/)
    assert.equal(doc(dom).getElementById("diff-result")!.getAttribute("role"), null)
  })

  it("highlights what changed in the graph: added, and changed policy results; the rest is untouched", () => {
    const dom = open()
    assert.ok(classes(dom, idOf("exportEverything")).includes("added"))
    assert.ok(!classes(dom, idOf("buildUserProfile")).includes("added"))
    const added = [...doc(dom).querySelectorAll("#graph g.edge.added")].map((g) => g.getAttribute("id"))
    assert.equal(added.length, 2)
    const changed = [...doc(dom).querySelectorAll("#graph g.edge.changed")].map((g) => g.getAttribute("id"))
    assert.deepEqual(new Set(changed), new Set(added), "both new edges are what makes the rule violated")
    assert.equal(doc(dom).querySelectorAll("#graph g.node.changed").length, 0)
  })

  it("says in a node's accessible name that it is new, so the highlight is not colour alone", () => {
    const dom = open()
    assert.match(group(dom, idOf("exportEverything")).getAttribute("aria-label")!, /, added since the compared revision$/)
    assert.doesNotMatch(group(dom, idOf("buildUserProfile")).getAttribute("aria-label")!, /since the compared revision/)
  })

  it("every item is a real button (Tab, Enter and Space work natively), named by its text", () => {
    const dom = open()
    const all = buttons(dom, "added-edges")
    assert.equal(all.length, 2)
    for (const button of all) {
      assert.equal(button.tagName, "BUTTON")
      assert.equal(button.getAttribute("type"), "button")
      assert.equal(button.getAttribute("tabindex"), null)
      assert.ok(button.textContent!.length > 10)
    }
  })

  it("activating an added edge drills to its source location and moves focus to the details", () => {
    const dom = open()
    const button = buttons(dom, "added-edges").find((b) => b.textContent!.startsWith(SIDE_EFFECT))!
    button.click()
    assert.match(detail(dom), /Added in this revision/)
    assert.match(detail(dom), /Source: src\/app\/export\.ts:\d+:\d+/)
    assert.match(detail(dom), /side-effect \(whole\): exportEverything to http-response \(static\)/)
    assert.equal(doc(dom).activeElement, doc(dom).getElementById("detail"))
    assert.equal(button.getAttribute("aria-current"), "true")
    assert.match(dom.window.location.hash, /change=added-edges%7C/)
  })

  it("activating a changed policy result shows both outcomes and where the crossing is", () => {
    const dom = open()
    buttons(dom, "changed-policy")[0]!.click()
    assert.match(detail(dom), /Policy result changed/)
    assert.match(detail(dom), /satisfied, static before, violated reaching http-response, static now/)
    assert.match(detail(dom), /Source: src\/app\/export\.ts:\d+:\d+/)
  })

  it("an added node says what it is and where it is declared, and can be opened in the graph", () => {
    const dom = open()
    const button = buttons(dom, "added-nodes").find((b) => b.textContent!.startsWith("function exportEverything"))!
    button.click()
    assert.match(detail(dom), /Source: src\/app\/export\.ts:\d+:\d+/)
    const open_ = doc(dom).getElementById("change-open")! as HTMLButtonElement
    open_.click()
    assert.match(detail(dom), /Reads/, "the full details of the function")
    assert.match(detail(dom), /exportEverything/)
  })

  it("a file with a flow the page lacks lists it as removed, inspectable only in the compared revision", async () => {
    const dom = open()
    const flow = flowOf()
    const base = flow.edges.find((e) => e.kind === "side-effect" && e.to === idOf("http-response") && e.from === idOf("exportEverything"))!
    const extra = { ...base, id: `${base.id}~extra`, path: ["role"] }
    const file = JSON.parse(evidenceText) as { flow: { edges: unknown[] } }
    file.flow.edges.push(extra)
    await loadFile(dom, "later.json", JSON.stringify(file))
    assert.match(doc(dom).getElementById("diff-summary")!.textContent!, /^Compared with later\.json: 0 edge\(s\) added, 1 removed/)
    assert.equal(items(dom, "removed-edges").length, 1)
    assert.equal(doc(dom).querySelectorAll("#graph .added").length, 0)
    buttons(dom, "removed-edges")[0]!.click()
    assert.match(detail(dom), /Only in the revision compared against/)
    assert.match(detail(dom), /not drawn/i)
    assert.equal(doc(dom).getElementById("change-open"), null, "there is nothing in the graph to open")
    assert.match(detail(dom), /Source: src\/app\/export\.ts:\d+:\d+/)
  })

  it("'Dim everything that did not change' keeps only the new and changed elements lit, and is part of the link", () => {
    const dom = open()
    const box = doc(dom).getElementById("only-changes") as HTMLInputElement
    box.checked = true
    box.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    assert.ok(!classes(dom, idOf("exportEverything")).includes("dim"))
    assert.ok(classes(dom, idOf("buildUserProfile")).includes("dim"))
    assert.ok(classes(dom, USER).includes("dim"), "the field did not change")
    assert.match(summary(dom), /Showing only what changed since the compared revision\./)
    assert.match(dom.window.location.hash, /changes=1/)
    const restored = open("#changes=1")
    assert.equal((doc(restored).getElementById("only-changes") as HTMLInputElement).checked, true)
    assert.ok(classes(restored, idOf("buildUserProfile")).includes("dim"))
  })

  it("'Stop comparing' removes the lists and the highlights, and the link records it; the other button brings them back", () => {
    const dom = open()
    doc(dom).getElementById("compare-off")!.dispatchEvent(new dom.window.Event("click", { bubbles: true }))
    assert.equal(doc(dom).querySelectorAll("#graph .added, #graph .changed").length, 0)
    assert.equal(headings(dom).length, 0)
    assert.match(doc(dom).getElementById("diff-summary")!.textContent!, /^Not comparing/)
    assert.match(dom.window.location.hash, /compare=off/)
    assert.equal((doc(dom).getElementById("only-changes") as HTMLInputElement).disabled, true)
    const off = open("#compare=off")
    assert.equal(doc(off).querySelectorAll("#graph .added").length, 0)
    doc(dom).getElementById("compare-embedded")!.dispatchEvent(new dom.window.Event("click", { bubbles: true }))
    assert.ok(classes(dom, idOf("exportEverything")).includes("added"))
    assert.ok(!/compare=off/.test(dom.window.location.hash))
  })

  it("restores a selected change from the link, with the details open but without taking focus", () => {
    const dom = open()
    buttons(dom, "changed-policy")[0]!.click()
    const hash = dom.window.location.hash
    const restored = open(hash)
    assert.match(detail(restored), /Policy result changed/)
    assert.notEqual(doc(restored).activeElement, doc(restored).getElementById("detail"))
    assert.equal(buttons(restored, "changed-policy")[0]!.getAttribute("aria-current"), "true")
  })

  it("ignores a link to a change that is not in this comparison", () => {
    const dom = open(`#${new URLSearchParams({ change: "added-edges|nope" }).toString()}`)
    assert.match(detail(dom), /Select a node or an edge/)
  })

  it("has no axe violations with the comparison open, a change selected and the dimming on", async () => {
    const dom = open()
    buttons(dom, "added-edges")[0]!.click()
    const box = doc(dom).getElementById("only-changes") as HTMLInputElement
    box.checked = true
    box.dispatchEvent(new dom.window.Event("change", { bubbles: true }))
    dom.window.eval(axe.source)
    const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(dom.window.document.documentElement, { rules: { "color-contrast": { enabled: false } } })
    const found = Array.from(results.violations, (v) => `${v.id}: ${Array.from(v.nodes, (n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
    assert.equal(found.length, 0, found.join("\n"))
  })
})

describe("a shared link", () => {
  it("restores the trace, the path and the filters", () => {
    const params = new URLSearchParams({ from: USER, path: "passwordHash", hide: "inferred", violations: "1" })
    const dom = open(`#${params.toString()}`)
    assert.equal((doc(dom).getElementById("field") as HTMLSelectElement).value, USER)
    assert.equal((doc(dom).getElementById("path") as HTMLInputElement).value, "passwordHash")
    assert.equal((doc(dom).getElementById("status-inferred") as HTMLInputElement).checked, false)
    assert.equal((doc(dom).getElementById("violations") as HTMLInputElement).checked, true)
    assert.match(summary(dom), /^Tracing downstream from userData\.user, path passwordHash\./)
  })

  it("ignores a link to something that is not in this evidence", () => {
    const dom = open(`#${new URLSearchParams({ from: "field:nope", classification: "nope" }).toString()}`)
    assert.match(summary(dom), /^Showing all data\./)
  })
})

describe("accessibility", () => {
  it("has no axe violations in its structure, names, roles and landmarks", async () => {
    const dom = open()
    dom.window.eval(axe.source)
    const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(dom.window.document.documentElement, {
      // jsdom has no layout engine, so colour contrast cannot be measured here; it is checked from the palette below.
      rules: { "color-contrast": { enabled: false }, "scrollable-region-focusable": { enabled: true } },
    })
    // (jsdom's arrays come from another realm, so compare a plain Node array.)
    const found = Array.from(results.violations, (v) => `${v.id}: ${Array.from(v.nodes, (n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)
    assert.equal(found.length, 0, found.join("\n"))
  })

  it("declares a language, a title, a skip link and a labelled control for every input", () => {
    const dom = open()
    assert.equal(doc(dom).documentElement.getAttribute("lang"), "en")
    assert.ok(doc(dom).title.length > 0)
    assert.equal(doc(dom).querySelector("a.skip")!.getAttribute("href"), "#main")
    for (const control of doc(dom).querySelectorAll("select, input")) {
      const id = control.getAttribute("id")
      const labelled = control.closest("label") !== null || (id !== null && doc(dom).querySelector(`label[for="${id}"]`) !== null)
      assert.ok(labelled, `${id} has no label`)
    }
  })

  it("meets WCAG AA contrast for every foreground/background pair it uses, in light and in dark", () => {
    const channel = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    }
    for (const [name, palette] of [["light", LIGHT], ["dark", DARK]] as const) {
      for (const pair of CONTRAST_PAIRS) {
        const value = ratio(palette[pair.fg], palette[pair.bg])
        assert.ok(value >= pair.min, `${name}: ${pair.fg} on ${pair.bg} is ${value.toFixed(2)}:1, needs ${pair.min}:1`)
      }
    }
  })

  it("the CSS is generated from those same palettes", () => {
    for (const hex of [...Object.values(LIGHT), ...Object.values(DARK)]) assert.ok(html.includes(hex), `${hex} is in the page`)
  })
})

describe("the page's own script", () => {
  it("raises no errors while loading, tracing, filtering, inspecting and comparing", () => {
    assert.deepEqual([...pageErrors], [])
  })
})

