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
export function globToRegExp(pattern: string): RegExp {
  let out = ""
  // `charAt` (never `pattern[i]`) so every read is a real `string`: an
  // out-of-range index yields `""`, which no branch below matches.
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i)
    if (char === "*" && pattern.charAt(i + 1) === "*") {
      const precededBySlashOrStart = i === 0 || pattern.charAt(i - 1) === "/"
      const followedBySlash = pattern.charAt(i + 2) === "/"
      if (precededBySlashOrStart && followedBySlash) {
        out += "(?:.*/)?"
        i += 2 // consume the second '*' and the following '/'
      } else {
        out += ".*"
        i += 1 // consume the second '*'
      }
    } else if (char === "*") {
      out += "[^/]*"
    } else if (char === "?") {
      out += "[^/]"
    } else if (".+^${}()|[]\\".includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`^${out}$`)
}
/* jscpd:ignore-end */
