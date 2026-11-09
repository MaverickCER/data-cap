// Deterministic source fixtures for the flow scan -- a pure function of the file index, zero Math.random() or
// timestamps. One capability (`userData.user`, five fields) and `files` application modules that read it and hand
// it down chains of wrapper functions to a response, the shape real handlers have:
//
//   h<i>(res)        reads userData's `user` and calls c<i>
//   c<i>(user, res)  wrapper -> w<i>a -> w<i>b -> s<i>      (every hop forwards the whole value)
//   s<i>(user, res)  sends `{ id, email }` to the client, then calls c<i+1> within a group of `groupSize` files
//
// Five functions per file. A file whose index is a multiple of `leakEvery` sends the WHOLE record instead (the
// leak a policy must catch), and one whose index is a multiple of `logEvery` also logs the role. Chains cross files
// only inside a group, so the call depth stays below the scanner's depth limit however many files there are.
//
// Used by benchmarks/performance-buildtime (the flow scan's cost as a project grows) and by
// test/build/flow-scale.test.ts (the same shape at ~600 files / ~3000 functions, asserted against a time budget).

import fs from "node:fs/promises"
import path from "node:path"

export const FLOW_FIXTURE_VERSION = 1

const CAPABILITY = `export const userData = createData({
  fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } },
  getters: { getUser: { execute: async () => ({}), processor: (raw: unknown) => ({ user: raw }), writes: { user: true } } },
});
documentData(
  { fields: { user: { id: "", name: "", email: "", passwordHash: "", role: "" } } },
  {
    owner: "platform",
    sensitivity: "confidential",
    purpose: "account management",
    legalBasis: "contract",
    protections: "encrypted at rest",
    getters: { getUser: { endpoints: [{ direction: "input", kind: "database", name: "postgres:users" }] } },
    flowPolicy: [
      { id: "no-password-to-client", appliesTo: { field: "user", path: ["passwordHash"] }, forbidDestinations: ["client-response"] },
      { id: "no-role-to-log", appliesTo: { field: "user", path: ["role"] }, forbidDestinations: ["log"] },
    ],
  },
);
`

/** The source of application module `index` of `files`. */
export function renderFlowModule(index, { files, groupSize = 6, leakEvery = 50, logEvery = 75 }) {
  const next = index + 1 < files && (index + 1) % groupSize !== 0 ? index + 1 : undefined
  const send =
    index % leakEvery === 0 ? "res.json(user)" : "res.json({ id: user.id, email: user.email })"
  const log = index % logEvery === 0 ? "\n  console.log(user.role)" : ""
  return `import { userData } from "../features/user.js"
${next === undefined ? "" : `import { c${String(next)} } from "./m${String(next)}.js"\n`}
export function h${String(index)}(res: any) {
  const user = userData.getSnapshot().fields.user
  return c${String(index)}(user, res)
}

export function c${String(index)}(user: any, res: any) {
  return w${String(index)}a(user, res)
}

function w${String(index)}a(user: any, res: any) {
  return w${String(index)}b(user, res)
}

function w${String(index)}b(user: any, res: any) {
  return s${String(index)}(user, res)
}

function s${String(index)}(user: any, res: any) {
  ${send}${log}
  return ${next === undefined ? "undefined" : `c${String(next)}(user, res)`}
}
`
}

/** Every file of the fixture project, as root-relative path to text. */
export function flowProjectFiles(options) {
  const out = { "features/user.ts": CAPABILITY }
  for (let index = 0; index < options.files; index++)
    out[`app/m${String(index)}.ts`] = renderFlowModule(index, options)
  return out
}

/** Writes the fixture project under `outputDir` (replacing it) and returns what it holds. */
export async function writeFlowProject(outputDir, options) {
  await fs.rm(outputDir, { recursive: true, force: true })
  const written = flowProjectFiles(options)
  for (const [relative, text] of Object.entries(written)) {
    const file = path.join(outputDir, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, text, "utf8")
  }
  return {
    files: options.files,
    functions: options.files * 5,
    written: Object.keys(written).length,
  }
}

/** A chain of `depth` wrapper functions from a read of the field to a response -- deeper than the scanner follows when `depth` is large. */
export function wrapperChainProject(depth) {
  const lines = ['import { userData } from "../features/user.js"', ""]
  lines.push(
    "export function start(res: any) {",
    "  const user = userData.getSnapshot().fields.user",
    "  return link0(user, res)",
    "}",
  )
  for (let i = 0; i < depth; i++)
    lines.push(
      `function link${String(i)}(user: any, res: any) {`,
      `  return link${String(i + 1)}(user, res)`,
      "}",
    )
  lines.push(`function link${String(depth)}(user: any, res: any) {`, "  res.json(user)", "}")
  return { "features/user.ts": CAPABILITY, "app/chain.ts": `${lines.join("\n")}\n` }
}

/**
 * A function whose analysis explodes: it calls itself with `breadth` differently-shaped arguments, to a depth the
 * scanner's call-signature memo cannot collapse, so the total work is `breadth ** levels` calls. It exists to exhaust the
 * scanner's step budget on a few hundred bytes of source.
 */
export function explosiveProject(breadth, levels) {
  const keys = Array.from({ length: breadth }, (_, i) => `k${String(i)}`)
  // Cheap statements: each is a step of the budget but costs the scanner almost nothing, so the budget runs out fast.
  const padding = Array.from({ length: 150 }, (_, i) => `  const t${String(i)} = v`).join("\n")
  const calls = keys.map((key) => `  boom({ ${key}: v }, n + 1)`).join("\n")
  const lines = [
    'import { userData } from "../features/user.js"',
    "",
    "export function start(res: any) {",
    "  const user = userData.getSnapshot().fields.user",
    "  boom(user, 0)",
    "  res.json(user)",
    "}",
    "",
    "function boom(v: any, n: number) {",
    `  if (n > ${String(levels)}) return v`,
    padding,
    calls,
    "  return v",
    "}",
  ]
  return { "features/user.ts": CAPABILITY, "app/boom.ts": `${lines.join("\n")}\n` }
}
