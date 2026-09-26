import path from "node:path"
import type { ParseWarning } from "../parse.js"

export type ResolveWithinRootResult =
  | { readonly ok: true; readonly resolved: string }
  | { readonly ok: false; readonly warning: ParseWarning }

/**
 * Plain lexical bounds-check: is `targetPath` inside `baseDir`? Shared by
 * `resolveWithinRoot()` below (output paths, checked lexically since they
 * usually don't exist on disk yet) and `resolve-package-schema.ts` (which
 * additionally re-checks this against `fs.realpath`-resolved paths, since a
 * package-declared schema path both exists on disk and crosses a real trust
 * boundary). Boundary-agnostic on purpose: neither caller's notion of "root"
 * is baked in here.
 */
export function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * Resolves `location` against `root` and checks the result doesn't escape it
 * (e.g. `location: "../../malicious.ts"`, or an absolute path on another
 * branch of the filesystem entirely). Discovery (`include`/`exclude`) is
 * already safe by construction -- it only ever walks *down* from `root` via
 * `readdir`, so a pattern can't make it read outside `root`. Output
 * locations have no such structural guarantee, since `path.resolve` happily
 * walks back out via `..` segments, so this is a plain lexical bounds-check
 * (not a symlink-aware `realpath` check -- these are *output* paths that
 * usually don't exist yet).
 *
 * Never throws itself -- returns a `ParseWarning`-shaped finding on escape
 * so each generator function can wrap it in its own error type.
 */
export function resolveWithinRoot(
  root: string,
  location: string,
  optionName: string,
  functionName: string,
): ResolveWithinRootResult {
  const resolved = path.resolve(root, location)
  if (!isWithinDirectory(root, resolved)) {
    return {
      ok: false,
      warning: {
        file: location,
        message:
          `"${optionName}" ("${location}") resolves to "${resolved}", which is outside "root" ("${root}"). ` +
          `${functionName}() refuses to write outside root -- use a path nested under root instead.`,
      },
    }
  }
  return { ok: true, resolved }
}
