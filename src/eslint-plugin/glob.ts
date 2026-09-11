/**
 * Converts one glob pattern to a RegExp. Handles `**` as "any number of path
 * segments, including zero" (so `**\/node_modules/**` matches a root-level
 * `node_modules`, and `**\/*.spec.ts` matches a root-level file, not just
 * nested ones) -- a plain `**` -> `.*` substitution gets both of those wrong.
 *
 * Used by this folder's rules to match a file path against an `allow`
 * option's glob array.
 *
 * **Deliberately duplicated from `src/build/glob.ts`, not imported from it**
 * -- and `src/build/glob.ts`'s own doc comment anticipates exactly this file.
 * `src/eslint-plugin/` ships as its own bundled entry point that must stay
 * loadable inside ESLint's process with no reach into `src/build/`, which
 * imports the TypeScript Compiler API and `node:fs`; a single cross-folder
 * import here would drag that whole graph into every consumer's lint run.
 * The two copies are ~30 lines of pure, fully-tested string logic with no
 * dependencies and no reason to diverge -- the coupling cost of sharing them
 * is strictly higher than the duplication cost of not. Not re-exported from
 * `./index.js` -- Private tier per VERSIONING.md.
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
