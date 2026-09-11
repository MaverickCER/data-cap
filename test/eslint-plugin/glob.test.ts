import { describe, expect, it } from "vitest"
import { globToRegExp } from "../../src/eslint-plugin/glob.js"

/** Deliberately mirrors `test/eslint-plugin/glob.test.ts` -- the two `glob.ts` modules are intentionally duplicated (bundle-boundary isolation), so their tests are too. */
describe("globToRegExp", () => {
  it.each<[string, string, boolean]>([
    // literal segments
    ["src/user.ts", "src/user.ts", true],
    ["src/user.ts", "src/other.ts", false],
    // single `*` -- one segment, no slash
    ["src/*.ts", "src/user.ts", true],
    ["src/*.ts", "src/nested/user.ts", false],
    ["*.ts", "user.ts", true],
    ["*.ts", "a.tsx", false],
    // `?` -- exactly one non-slash char
    ["src/user.?s", "src/user.ts", true],
    ["src/user.?s", "src/user.js", true],
    ["src/user.?s", "src/user.mjs", false],
    ["a?b", "a/b", false],
    // leading `**/` -- zero or more segments
    ["**/node_modules/**", "node_modules/x", true],
    ["**/node_modules/**", "a/b/node_modules/x", true],
    ["**/*.spec.ts", "a.spec.ts", true],
    ["**/*.spec.ts", "deep/nested/a.spec.ts", true],
    // mid `/**/`
    ["src/**/user.ts", "src/user.ts", true],
    ["src/**/user.ts", "src/a/b/user.ts", true],
    // `**` NOT preceded by `/` or start, or NOT followed by `/` -> plain `.*`
    ["src/a**b", "src/aXYZb", true],
    ["src/a**", "src/anything/here", true],
    // `**` followed by `/` but NOT preceded by `/`/start -> still plain `.*`,
    // NOT the zero-or-more-segments form (`precededBySlashOrStart` is false)
    ["a**/b", "aX/b", true],
    // the `/` after `**` stays mandatory here (plain `.*` form), unlike the
    // leading-`**/` form where the whole segment is optional
    ["a**/b", "ab", false],
    // regex metacharacters in the pattern are escaped, matched literally
    ["src/(x).ts", "src/(x).ts", true],
    ["src/(x).ts", "src/x.ts", false],
    ["a+b.c", "a+b.c", true],
    ["a+b.c", "aaab.c", false],
    // anchored at both ends
    ["user.ts", "src/user.ts", false],
    ["src/user", "src/user.ts", false],
  ])("globToRegExp(%j) vs %j -> %s", (pattern, input, matches) => {
    expect(globToRegExp(pattern).test(input)).toBe(matches)
  })

  it("produces the exact source for a representative pattern", () => {
    // note: `RegExp.prototype.source` escapes `/` as `\/`
    expect(globToRegExp("**/*.ts").source).toBe("^(?:.*\\/)?[^/]*\\.ts$")
    expect(globToRegExp("a**b").source).toBe("^a.*b$")
    expect(globToRegExp("?").source).toBe("^[^/]$")
  })
})
