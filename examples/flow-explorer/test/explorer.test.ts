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

