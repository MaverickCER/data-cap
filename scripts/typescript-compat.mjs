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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

const scanScript = `import { createRequire } from "node:module"
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
  console.log(`\nTypeScript compat check passed for typescript ${versions.join(", ")}.`)
} finally {
  rmSync(packDir, { recursive: true, force: true })
}
