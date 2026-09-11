// Deliberately narrow imports -- see `no-raw-external-io.ts`'s header for the
// full rationale (`@typescript-eslint/utils`'s main entry does a runtime
// `require("eslint")` that throws once bundled into dependency-free ESM).
import { RuleCreator } from "@typescript-eslint/utils/eslint-utils"
import { AST_NODE_TYPES } from "@typescript-eslint/types"
import { globToRegExp } from "./glob.js"

const createRule = RuleCreator(
  (name) => `https://github.com/maverickcer/data-cap#eslint-plugin-${name}`,
)

export interface RuleOptions {
  /** Glob-array of files this rule doesn't apply to -- a project's own
   *  executable entry points (a CLI, a script) that legitimately construct
   *  the concrete filesystem adapter. Empty by default -- populate it
   *  explicitly; the rule never guesses at what counts as an executable
   *  capability boundary. */
  allow?: string[]
}

/** `"node:fs"`, `"fs"`, and their `/promises` subpaths -- every specifier that resolves to Node's filesystem module. */
const FS_SPECIFIER = /^(node:)?fs(\/promises)?$/

/** The specifier string if it names Node's filesystem module, else `undefined`. */
function fsSpecifier(source: unknown): string | undefined {
  // `source` is always an AST literal's `.value`. The `typeof` guard is a
  // type-narrowing convenience, not a behavioral one: no non-string literal
  // value stringifies to `fs`/`node:fs`/their `/promises` forms, so
  // `FS_SPECIFIER.test()` already rejects every one -- the mutant dropping
  // this guard is equivalent.
  // Stryker disable next-line ConditionalExpression
  if (typeof source !== "string") return undefined
  if (!FS_SPECIFIER.test(source)) return undefined
  return source
}

/**
 * Flags any `import`/`require`/dynamic `import()` of `node:fs` in library
 * code, so a library surface acquires its filesystem capability from the
 * caller instead of reaching for `node:fs` itself (the same discipline
 * `repo-contract`'s ADR-0011 established for `child_process`/`process.env`).
 * See ADR 0058.
 *
 * @remarks
 * Nothing is exempt by default. data-cap's own config allows `src/cli/**`
 * (the executable capability boundary that builds the `node:fs/promises`
 * adapter); a consuming project sets its own `allow` for its own entry
 * points.
 */
export const noNodeFs = createRule<[RuleOptions], "noNodeFs">({
  name: "no-node-fs",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing node:fs in library code; accept a filesystem capability from the caller instead.",
    },
    schema: [
      {
        type: "object",
        properties: { allow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      noNodeFs:
        "Importing '{{specifier}}' makes this a filesystem-acquiring surface. Accept a filesystem capability as an argument instead, and let an executable entry point construct the node:fs adapter (see ADR 0058 / the README's ESLint section for the allow-list escape hatch).",
    },
  },
  defaultOptions: [{ allow: [] }],
  create(context, [options]) {
    const filename = context.filename
    // `?? []` is unreachable through the public API -- `RuleCreator` always
    // deep-merges `context.options` onto `defaultOptions` first.
    // Stryker disable next-line ArrayDeclaration
    const allowPatterns = options.allow ?? []
    if (allowPatterns.some((p) => globToRegExp(p).test(filename))) return {}

    return {
      ImportDeclaration(node) {
        const specifier = fsSpecifier(node.source.value)
        if (specifier !== undefined) {
          context.report({ node, messageId: "noNodeFs", data: { specifier } })
        }
      },
      ImportExpression(node) {
        // Narrowing guard so `.value` type-checks. Behaviorally equivalent to
        // omitting it -- a non-`Literal` source has no `.value`, and
        // `fsSpecifier(undefined)` is already `undefined`.
        // Stryker disable next-line ConditionalExpression
        if (node.source.type !== AST_NODE_TYPES.Literal) return
        const specifier = fsSpecifier(node.source.value)
        if (specifier !== undefined) {
          context.report({ node, messageId: "noNodeFs", data: { specifier } })
        }
      },
      CallExpression(node) {
        if (
          // Narrowing guard so `.name` type-checks; redundant at runtime with
          // the `.name !== "require"` clause (only an `Identifier` carries a
          // `.name`), so the mutant dropping it is equivalent.
          // Stryker disable next-line ConditionalExpression
          node.callee.type !== AST_NODE_TYPES.Identifier ||
          node.callee.name !== "require" ||
          node.arguments[0]?.type !== AST_NODE_TYPES.Literal
        ) {
          return
        }
        const specifier = fsSpecifier(node.arguments[0].value)
        if (specifier !== undefined) {
          context.report({ node, messageId: "noNodeFs", data: { specifier } })
        }
      },
    }
  },
})
