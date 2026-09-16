/**
 * Converts one glob pattern to a RegExp. Handles `**` as "any number of path
 * segments, including zero" (so `**\/node_modules/**` matches a root-level
 * `node_modules`, and `**\/*.spec.ts` matches a root-level file, not just
 * nested ones) -- a plain `**` -> `.*` substitution gets both of those wrong.
 *
 * Used by discover.ts's `include`/`exclude` capability-discovery walk.
 *
 * Deliberately duplicated (not shared) with a hypothetical
 * `src/eslint-plugin/glob.ts` should one ever be added -- keeps this
 * build-only module free of any import reaching outside src/build, so
 * `src/build` stays independently splittable into its own package with zero
 * source-level cross-folder dependency. Not re-exported from `./index.js` --
 * Private tier per VERSIONING.md.
 */
/* jscpd:ignore-start -- deliberately duplicated across the build/ and eslint-plugin/ bundle boundaries; see this file's module doc */

/**
 * @internal The regex-source builder, with the iteration ceiling
 * caller-supplied so a direct unit test can force it absurdly low (against
 * an ordinary, valid pattern) and organically exercise the fail-fast path
 * below -- rather than that path being reachable only by mutating source.
 * Exported for direct unit coverage; {@link globToRegExp} is the real entry
 * point and always passes a generous, real ceiling.
 */
export function buildGlobRegExpSource(pattern: string, iterationCeiling: number): string {
  let out = ""
  let i = 0
  // A hard, generous iteration ceiling -- deliberately bounded by a fixed
  // array's length (same technique as runtime/retry.ts's `withRetry`), not a
  // manually incremented index compared against a limit: an
  // AssignmentOperator mutation flipping any `i += ...` below to `i -= ...`
  // could make `i` oscillate (a "**" branch's own extra advance and a
  // decrementing per-step update can settle into a stable cycle that never
  // reaches `pattern.length` and never even goes negative) instead of
  // monotonically progressing, looping forever instead of producing an
  // observably wrong result a normal test could catch. Iterator protocol has
  // no exposed counter for that class of mutation to target.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the loop variable itself is irrelevant; only the fixed array length bounds the loop
  for (const _iteration of Array.from({ length: iterationCeiling + 1 })) {
    if (i >= pattern.length) break
    // `charAt` (never `pattern[i]`) so every read is a real `string`: an
    // out-of-range index yields `""`, which no branch below matches.
    const char = pattern.charAt(i)
    if (char === "*" && pattern.charAt(i + 1) === "*") {
      const precededBySlashOrStart = i === 0 || pattern.charAt(i - 1) === "/"
      const followedBySlash = pattern.charAt(i + 2) === "/"
      if (precededBySlashOrStart && followedBySlash) {
        out += "(?:.*/)?"
        i += 3 // consume both '*' and the following '/'
      } else {
        out += ".*"
        i += 2 // consume both '*'
      }
    } else if (char === "*") {
      out += "[^/]*"
      i += 1
    } else if (char === "?") {
      out += "[^/]"
      i += 1
    } else if (".+^${}()|[]\\".includes(char)) {
      out += `\\${char}`
      i += 1
    } else {
      out += char
      i += 1
    }
  }
  // Unreachable from `globToRegExp` by any correct exit path: every branch
  // above advances `i` by at least 1, so a `pattern.length`-character input
  // always finishes in at most `pattern.length` iterations -- `globToRegExp`
  // always supplies a ceiling well beyond that. Reaching here means either
  // some branch's advancement is broken, or (as a direct unit test forces)
  // the caller-supplied ceiling itself is too low -- fail fast and say so,
  // rather than hang.
  if (i < pattern.length) {
    throw new Error(
      `globToRegExp: exceeded ${String(iterationCeiling)} loop iterations without finishing a ${String(pattern.length)}-character pattern -- the loop's own advancement is broken.`,
    )
  }
  return out
}

export function globToRegExp(pattern: string): RegExp {
  return new RegExp(`^${buildGlobRegExpSource(pattern, pattern.length + 8)}$`)
}
/* jscpd:ignore-end */
