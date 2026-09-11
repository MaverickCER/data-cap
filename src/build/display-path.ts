/**
 * The one place a filesystem path crosses from "real, absolute, usable for
 * `fs`/import resolution" into "the path a canonical model publishes"
 * (OUT-01).
 *
 * Absolute paths originate exactly once, in `discover.ts`, and are the
 * correct currency for every internal filesystem read -- but they are a bug
 * in a published artifact: `/Users/someone/dev/app/src/user.ts` in a
 * committed `data.evidence.json` is machine-specific, makes two developers'
 * (or CI's) regeneration of the same artifact differ for no real reason,
 * and leaks a local directory layout into a document meant to be reviewed
 * and diffed. Every canonical model (`CapabilityNode.file`,
 * `DependencyEdge.from`/`.to.capability.file`, `OwnershipCapabilityRef.file`,
 * `FindingLocationCapability.file`, `ManifestSnapshotCapability.file`)
 * therefore stores the ROOT-RELATIVE path, produced here at the last step
 * before the model is returned.
 *
 * Anything that afterwards needs a real path for genuine filesystem or
 * import work re-derives it with {@link absolutePathFrom}, since `root` is
 * threaded through every one of those call sites already.
 */

import path from "node:path"

/**
 * Renders `filePath` relative to `root`, POSIX-separated regardless of
 * platform (matching every other rendered path in this package's Markdown/
 * Mermaid/JSON output).
 *
 * Two deliberate non-conversions:
 *
 * - An already-relative `filePath` is returned as-is (POSIX-normalized).
 *   That makes this function idempotent, which matters because a model's
 *   `file` is relativized once at construction and then passed through
 *   render-time helpers (`docs.ts`, `usage-report.ts`, `flow-diagram.ts`)
 *   that still call this. Resolving a relative path against `process.cwd()`
 *   first -- what `path.relative` would do on its own -- would silently
 *   produce a wrong answer whenever cwd isn't `root`.
 * - An absolute path that would need to climb outside `root` is returned
 *   unchanged, never rewritten into a `../` escape: a `--package`-discovered
 *   file legitimately lives outside `root`, and its absolute path is the
 *   only unambiguous thing to say about it.
 */
export function displayPath(root: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) return filePath.split(path.sep).join("/")
  const relative = path.relative(root, filePath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return filePath
  return relative.split(path.sep).join("/")
}

/**
 * The inverse of {@link displayPath}: turns a model's published `file` back
 * into a real, absolute path for actual filesystem or import-specifier work.
 *
 * `path.resolve` (not `path.join`) specifically because `displayPath` leaves
 * an out-of-root absolute path unchanged -- `resolve` returns such a path
 * untouched, where `join` would produce the nonsense `root + absolute`.
 */
export function absolutePathFrom(root: string, filePath: string): string {
  return path.resolve(root, filePath)
}
