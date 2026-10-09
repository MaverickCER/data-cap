import fs from "node:fs/promises"
import type { BuildDirent, BuildFileSystem, BuildStats } from "../build/types.js"

/**
 * The concrete `node:fs/promises`-backed {@link BuildFileSystem} the `data-cap`
 * CLI hands to `data-cap/build`. Also re-exported as the public
 * `data-cap/node` entry point (`src/node/index.ts`) for a
 * consumer running the generators from their own Node build script.
 *
 * This is the deliberate injection boundary -- mirrors `repo-contract`'s own
 * `repo-contract.config.ts` (`spawn: crossSpawn, env: process.env`): a
 * **library surface** (`./build`) must not acquire filesystem access
 * implicitly; an **executable-context** entry (this CLI, or `./node`)
 * constructs the adapter and passes it in. `src/cli/**` is the sanctioned
 * executable-source carve-out -- `node:fs` lives only here. See ADR 0058.
 *
 * A thin structural pass-through: each method delegates straight to
 * `node:fs/promises`, whose real `Dirent`/`Stats` already satisfy the
 * minimal {@link BuildFileSystem} `BuildDirent`/`BuildStats` shapes.
 *
 * Named `function` declarations, not an object of arrow properties, so each
 * delegation body is a per-call statement a mutation test can actually reach
 * -- an arrow assigned as a property is only evaluated once, at module load,
 * where Stryker's mutant switch can't flip it.
 */
function readFile(path: string, encoding: "utf8"): Promise<string> {
  return fs.readFile(path, encoding)
}

function writeFile(path: string, data: string, encoding: "utf8"): Promise<void> {
  return fs.writeFile(path, data, encoding)
}

async function mkdir(path: string, options: { recursive: true }): Promise<void> {
  await fs.mkdir(path, options)
}

function readdir(path: string, options: { withFileTypes: true }): Promise<BuildDirent[]> {
  return fs.readdir(path, options)
}

function stat(path: string): Promise<BuildStats> {
  return fs.stat(path)
}

function realpath(path: string): Promise<string> {
  return fs.realpath(path)
}

/**
 * The Node-backed `BuildFileSystem`: the filesystem capability the build-time generators require.
 * @public
 */
export const nodeBuildFileSystem: BuildFileSystem = new (class implements BuildFileSystem {
  readonly readFile = readFile
  readonly writeFile = writeFile
  readonly mkdir = mkdir
  readonly readdir = readdir
  readonly stat = stat
  readonly realpath = realpath
})()
