/**
 * Recursively discovers files matching `include`/`exclude` under `root`,
 * pruning `node_modules`/`.git` (and any directory an `exclude` pattern
 * matches) during the walk itself, not after. Hand-rolled -- no glob
 * dependency, see glob.ts.
 *
 * Uses `fs.readdir(..., { withFileTypes: true })`'s `Dirent#isDirectory()`/
 * `isFile()`, which report the directory entry's own type (never following
 * a symlink) -- a symlink is neither, so it's silently skipped rather than
 * traversed. This makes the walk symlink-cycle-immune by construction, not
 * by explicit cycle tracking.
 */

import path from "node:path"
import { globToRegExp } from "./glob.js"
import type { BuildDirent, BuildFileSystem } from "./types.js"

/** Options for `discoverCapabilityFiles`. */
export interface DiscoverOptions {
  /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
  readonly fs: BuildFileSystem
  /** Directory to walk. */
  readonly root: string
  /** Glob patterns (relative to `root`) a file must match at least one of to be included. Defaults to every `.ts`/`.tsx` file. */
  readonly include?: readonly string[] | undefined
  /** Glob patterns (relative to `root`) that prune a file or directory regardless of `include`. */
  readonly exclude?: readonly string[] | undefined
}

// A function so the globs are read when discovery runs, not once at module load (where a change to them
// could not be attributed to a test).
function defaultInclude(): string[] {
  return ["**/*.ts", "**/*.tsx"]
}

/** The default `include` glob when none is supplied: every `.ts`/`.tsx` file. */
export const DEFAULT_INCLUDE: readonly string[] = defaultInclude()

/** Directory names discovery never descends into, regardless of `include`/`exclude`. */
function isAlwaysExcludedDir(name: string): boolean {
  return name === "node_modules" || name === ".git"
}

function toPosixRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/")
}

function matchesAnyPattern(filePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath))
}

async function walk(
  fs: BuildFileSystem,
  dir: string,
  root: string,
  include: readonly string[],
  exclude: readonly string[],
  results: string[],
): Promise<void> {
  let entries: readonly BuildDirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return // unreadable directory (permissions, race with deletion, ...) -- skip silently, never throw during discovery
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (isAlwaysExcludedDir(entry.name)) continue
      // Tested as a directory (trailing slash) so a pattern like
      // "**/dist/**" -- meant to match *files inside* the directory --
      // also prunes the directory itself before its contents are ever read.
      const relativeDir = `${toPosixRelative(root, fullPath)}/`
      if (matchesAnyPattern(relativeDir, exclude)) continue
      await walk(fs, fullPath, root, include, exclude, results)
    } else if (entry.isFile()) {
      const relativePath = toPosixRelative(root, fullPath)
      if (matchesAnyPattern(relativePath, include) && !matchesAnyPattern(relativePath, exclude)) {
        results.push(fullPath)
      }
    }
  }
}

/**
 * Discovers every file matching `include`/`exclude` under `root`, alphabetically sorted, as absolute paths.
 */
export async function discoverCapabilityFiles(options: DiscoverOptions): Promise<string[]> {
  const include = options.include ?? defaultInclude()
  // No test can distinguish this default from a non-empty placeholder array:
  // `new Set(undefined)` is empty, so an omitted `exclude` excludes nothing.
  const exclude = [...new Set(options.exclude)]
  const root = path.resolve(options.root)

  const results: string[] = []
  await walk(options.fs, root, root, include, exclude, results)
  results.sort()
  return results
}
