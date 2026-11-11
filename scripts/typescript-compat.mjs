// CI's `typescript-compat` job runs this after `npm run build`: it packs the package exactly as
// `npm publish` would, then, for each TypeScript major a consumer might have installed as their root
// `typescript`, installs the tarball into a scratch project and proves two things:
//
//   1. The build-time scanner (`data-cap/build`) runs from BOTH its ESM and CJS entry
//      points. TypeScript 7 ships no programmatic compiler API, so under a 7 root the scanner has to
//      fall back to the bundled `@typescript/typescript6` (src/build/typescript.ts) -- the case no
//      unit test can reach, because it needs a real TypeScript 7 root in `node_modules`.
//   2. The shipped `.d.ts` files type-check in a consumer under `moduleResolution: nodenext`,
//      `strict` and full library checking (no `skipLibCheck`), every entry point but `./eslint-plugin`
//      (its declarations type themselves from the `@typescript-eslint/utils` peer) included. Under a 7
//      root the `types@>=7` export conditions serve `dist/.dts7`, whose compiler-API types come from
//      the bundled `@typescript/typescript6` (TypeScript 7's own package ships none); under 5 and 6 the
//      primary declarations typed from the consumer's `typescript` are served (ADR 0069).
//
// Under a 7 root it also removes the bundled compiler and asserts the readable failure, so the
// "no usable compiler" message cannot rot unseen.
//
// Usage: node scripts/typescript-compat.mjs [version ...]   (default: 5 6 7)

import { spawnSync } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const versions = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["5", "6", "7"]
const PACKAGE = "data-cap"
const repoRoot = path.resolve(import.meta.dirname, "..")

function run(command, args, cwd, { allowFailure = false } = {}) {
  // `--traceResolution` under a TypeScript 7 root prints well past spawnSync's 1 MiB default, which
  // would end the child with ENOBUFS and a null status; the budget is generous on purpose.
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0 && !allowFailure) {
    process.stderr.write(result.stdout + result.stderr)
    console.error(`${command} ${args.join(" ")} failed (exit ${String(result.status)}) in ${cwd}`)
    process.exit(result.status ?? 1)
  }
  return result
}

const packDir = mkdtempSync(path.join(tmpdir(), "data-cap-pack-"))
run("npm", ["pack", "--ignore-scripts", "--pack-destination", packDir], repoRoot)
const tarball = path.join(
  packDir,
  readdirSync(packDir).find((f) => f.endsWith(".tgz")),
)

const scanScript = `import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const source = 'export const userCapability = createData({ fields: { id: "" } });'
const esm = await import("${PACKAGE}/build")
const cjs = require("${PACKAGE}/build")
for (const [label, build] of [["esm", esm], ["cjs", cjs]]) {
  const result = build.parseCapabilityFile("/repo/user.ts", source)
  if (result.createDataCalls.length !== 1 || result.createDataCalls[0].exportName !== "userCapability") {
    throw new Error(label + " scan found the wrong thing: " + JSON.stringify(result.createDataCalls.map((c) => c.exportName)))
  }
}
console.log("scanner ok (esm + cjs)")

// The real thing, not a one-line parse: the flow-explorer example's source is scanned with the
// flow pass under this root, with a fixed instant and commit so the evidence is a pure function of
// the source and the compiler. The runner compares the evidence across every root byte for byte.
const { nodeBuildFileSystem } = await import("${PACKAGE}/node")
const { result } = await esm.computeDataArtifacts({
  fs: nodeBuildFileSystem,
  root: process.cwd() + "/flow-fixture",
  include: ["src/features/**", "src/app/**"],
  tsconfig: false,
  flowEvidence: true,
  generatedAt: new Date("2026-01-01T00:00:00.000Z"),
  commit: "0123456789abcdef0123456789abcdef01234567",
})
const evidence = result.evidence
if (!evidence?.flow || evidence.flow.nodes.length === 0) {
  throw new Error("flow scan produced no flow nodes; result keys: " + Object.keys(result).join(", "))
}
writeFileSync("flow-evidence.json", JSON.stringify(evidence))
console.log("flow scan ok (" + evidence.flow.nodes.length + " nodes, " + evidence.flow.edges.length + " edges)")
`

// Every entry point, with the compiler-API-typed result read back so the build declarations are
// really resolved, not only imported.
const strictConsumer = `import * as core from "${PACKAGE}"
import * as runtime from "${PACKAGE}/runtime"
import * as cache from "${PACKAGE}/runtime/cache"
import * as retry from "${PACKAGE}/runtime/retry"
import * as helpers from "${PACKAGE}/helpers"
import * as node from "${PACKAGE}/node"
import * as observe from "${PACKAGE}/observe"
import { parseCapabilityFile } from "${PACKAGE}/build"
import * as evidence from "${PACKAGE}/evidence"
const result = parseCapabilityFile("a.ts", "export const e = 1")
// localConsts is typed with the compiler API (ReadonlyMap<string, ts.Expression>), so this line only
// compiles when the declaration set in use resolves the types of typescript.
const consts: ReadonlyMap<string, { readonly kind: number }> = result.localConsts
console.log(typeof core, typeof runtime, typeof cache, typeof retry, typeof helpers, typeof node, typeof observe, result.createDataCalls.length, consts.size, typeof evidence)
`

function tsconfig(file) {
  return JSON.stringify({
    compilerOptions: {
      module: "nodenext",
      moduleResolution: "nodenext",
      strict: true,
      noEmit: true,
      types: ["node"],
      skipLibCheck: false,
    },
    files: [file],
  })
}

try {
  /** The flow evidence each root produced for the same source, to be compared byte for byte. */
  const flowEvidenceByRoot = new Map()
  for (const version of versions) {
    const dir = mkdtempSync(path.join(tmpdir(), `data-cap-tscompat-${version}-`))
    try {
      console.log(`\n== typescript@${version} as the consumer's root compiler`)
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "tscompat", version: "0.0.0", type: "module" }),
      )
      // A plain install (no --legacy-peer-deps): proves the widened peer range resolves for this root.
      run(
        "npm",
        ["install", "--no-audit", "--no-fund", tarball, `typescript@${version}`, "@types/node"],
        dir,
      )

      // The consumer's ROOT compiler, by path.
      const tsc = path.join("node_modules", "typescript", "bin", "tsc")
      const rootVersion = JSON.parse(
        readFileSync(path.join(dir, "node_modules", "typescript", "package.json"), "utf8"),
      ).version
      console.log(`root typescript ${rootVersion}`)
      // Installing this package must not replace the consumer's `tsc`. The bundled TypeScript 6 ships a
      // `tsc` bin of its own; hoisted as an ordinary dependency, npm links it into `.bin` and every
      // consumer's `npx tsc` silently becomes TypeScript 6. Bundling keeps it nested and unlinked.
      const linked = run(
        "node",
        [path.join("node_modules", ".bin", "tsc"), "--version"],
        dir,
      ).stdout.trim()
      if (!linked.endsWith(rootVersion)) {
        console.error(
          `node_modules/.bin/tsc runs "${linked}", not the root typescript ${rootVersion}`,
        )
        process.exit(1)
      }
      console.log(`tsc bin is still the root compiler (${linked})`)
      mkdirSync(path.join(dir, "src"))
      writeFileSync(path.join(dir, "strict.ts"), strictConsumer)
      writeFileSync(path.join(dir, "tsconfig.strict.json"), tsconfig("strict.ts"))
      writeFileSync(path.join(dir, "scan.mjs"), scanScript)
      // The flow-explorer example's source, copied in so the scan under this root is a real one.
      cpSync(
        path.join(repoRoot, "examples", "flow-explorer", "src"),
        path.join(dir, "flow-fixture", "src"),
        {
          recursive: true,
        },
      )

      run("node", [tsc, "-p", "tsconfig.strict.json"], dir)
      console.log(
        "types ok: every entry point but ./eslint-plugin, full library check, no skipLibCheck",
      )
      // Which declaration set answered: the primary one under 5 and 6, the `types@>=7` one under 7.
      const trace = run(
        "node",
        [tsc, "-p", "tsconfig.strict.json", "--traceResolution"],
        dir,
      ).stdout
      const expected = version === "7" ? "types@>=7" : "types"
      if (!trace.includes(`Resolved under condition '${expected}'`)) {
        console.error(
          `expected the '${expected}' export condition to resolve the declarations under typescript@${version}`,
        )
        process.exit(1)
      }
      console.log(`declarations served under the '${expected}' export condition`)
      console.log(run("node", ["scan.mjs"], dir).stdout.trim())
      flowEvidenceByRoot.set(version, readFileSync(path.join(dir, "flow-evidence.json"), "utf8"))

      if (version === "7") {
        // Bundled inside the package (bundleDependencies), not hoisted into the consumer's node_modules.
        const bundled = path.join(
          dir,
          "node_modules",
          PACKAGE,
          "node_modules",
          "@typescript",
          "typescript6",
        )
        rmSync(bundled, { recursive: true, force: true })
        const failed = run("node", ["scan.mjs"], dir, { allowFailure: true })
        if (
          failed.status === 0 ||
          !/bundled @typescript\/typescript6 could not be loaded/.test(failed.stderr)
        ) {
          process.stderr.write(failed.stdout + failed.stderr)
          console.error(
            "expected the readable 'no usable compiler' error with the bundled compiler removed",
          )
          process.exit(1)
        }
        console.log("stripped bundled compiler fails with the documented message")
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  // Every root must have produced the same evidence: under 7 the scanner runs on the bundled
  // TypeScript 6, and this is the assertion that it sees the same program the consumer's 5 or 6 does.
  const [first, ...rest] = [...flowEvidenceByRoot.entries()]
  for (const [version, evidence] of rest) {
    if (evidence !== first[1]) {
      console.error(
        `flow evidence under typescript@${version} differs from typescript@${first[0]} (${String(evidence.length)} vs ${String(first[1].length)} bytes)`,
      )
      process.exit(1)
    }
  }
  console.log(`flow evidence identical across ${versions.length} TypeScript root(s)`)
  console.log(`\nTypeScript compat check passed for typescript ${versions.join(", ")}.`)
} finally {
  rmSync(packDir, { recursive: true, force: true })
}
