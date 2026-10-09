// `@typescript-eslint/utils` is an external optional peer (ADR 0068), resolved by the consumer's own
// module loader, so its main entry is safe to import from; `RuleCreator` still comes from the
// `eslint-utils` subpath to keep the loaded surface small.
import { RuleCreator } from "@typescript-eslint/utils/eslint-utils"
import { AST_NODE_TYPES } from "@typescript-eslint/utils"
import type { TSESTree } from "@typescript-eslint/utils"
import type { TSESLint } from "@typescript-eslint/utils"
import {
  CAPABILITY_CALL_NAMES,
  getStaticKeyName,
  isCapabilityCall,
  isOperationBodyKey,
  isOperationSectionKey,
} from "./capability-call.js"
import { globToRegExp } from "./glob.js"

type Scope = TSESLint.Scope.Scope

const createRule = RuleCreator(
  (name) => `https://github.com/maverickcer/data-cap#eslint-plugin-${name}`,
)

/** Options for `no-raw-external-io`. */
export interface RuleOptions {
  /**
   * Glob-array of files this rule doesn't apply to -- for a consuming
   * project's own transport/client layer, a test harness, or a script that
   * legitimately talks to the network outside any capability. Empty by
   * default: `data-cap` never guesses at which of a project's files are
   * exempt, the same way `env-cap`'s `no-raw-process-env` never guesses at
   * which are trusted bootstrap code.
   */
  allow?: string[]
  /**
   * Bare global identifier names to flag when called outside an
   * `execute`/`subscribe`. Defaults to `["fetch"]`; extend it with whatever
   * a project's own environment provides (`"XMLHttpRequest"`,
   * `"WebSocket"`, `"EventSource"`). Deliberately a list of *global*
   * identifiers rather than a set of special-cased HTTP client libraries --
   * this rule never learns about axios, ky, got, or any other package by
   * name.
   */
  functions?: string[]
}

const DEFAULT_FUNCTIONS = ["fetch"]

/** `scope` and every scope above it, innermost first. Ends at the global scope, whose `upper` is `null`. */
/** @internal Exported for direct unit coverage. */
export function scopeChain(scope: Scope | null): Scope[] {
  return scope === null ? [] : [scope, ...scopeChain(scope.upper)]
}

/** `node` and every ancestor above it, innermost first. Ends at the program root, whose parent is nullish. */
/** @internal Exported for direct unit coverage. */
export function ancestorChain(node: TSESTree.Node | null | undefined): TSESTree.Node[] {
  return node == null ? [] : [node, ...ancestorChain(node.parent)]
}

function isBareGlobal(
  sourceCode: Readonly<{ getScope(node: TSESTree.Node): Scope }>,
  node: TSESTree.Identifier,
): boolean {
  // The innermost scope declaring the name decides. A real global (`fetch`, `XMLHttpRequest`) appears in
  // the global scope's variable list with zero definitions -- nothing in this program declared it.
  // Anything with a definition was declared or imported here. A name no scope lists is a bare global too.
  const variable = scopeChain(sourceCode.getScope(node))
    .flatMap((scope) => scope.variables)
    .find((candidate) => candidate.name === node.name)
  return variable === undefined || variable.defs.length === 0
}

/**
 * Whether `node` sits lexically inside the `execute`/`subscribe` function of
 * an operation declared in a `buildData`/`createData` call's
 * `getters`/`mutators`/`subscriptions` section.
 *
 * Walks outward from `node` and requires, in this order: a function literal
 * that is the *value* of an `execute`/`subscribe` property, and -- further
 * up, still inside the same walk -- a `getters`/`mutators`/`subscriptions`
 * property, and then the enclosing capability call itself. Requiring all
 * three (rather than just "inside a capability call") is what keeps a
 * `fetch` in a `processor`, an `optimistic`, or a `documentData` docs
 * literal from being silently exempted: only the two properties that are
 * *supposed* to perform I/O are.
 *
 * Nothing here reads the function's body. The exemption is granted by
 * position alone, the moment a call is lexically inside an `execute`/
 * `subscribe` -- never by cross-referencing a URL against declared endpoint
 * metadata, which would make this rule depend on documentation being
 * accurate and would violate the invariant that an operation's body stays
 * opaque to static analysis (AGENTS.md invariant 6).
 */
function isInsideOperationBody(node: TSESTree.Node): boolean {
  let sawOperationBody = false
  let sawOperationSection = false
  for (const current of ancestorChain(node.parent)) {
    if (
      !sawOperationBody &&
      current.type === AST_NODE_TYPES.Property &&
      !current.computed &&
      isFunctionValueOf(current)
    ) {
      if (isOperationBodyKey(getStaticKeyName(current.key))) sawOperationBody = true
    }
    if (sawOperationBody && current.type === AST_NODE_TYPES.Property && !current.computed) {
      if (isOperationSectionKey(getStaticKeyName(current.key))) sawOperationSection = true
    }
    if (sawOperationSection && isCapabilityCall(current, CAPABILITY_CALL_NAMES)) return true
  }
  return false
}

/** Whether this property's value is an inline function literal -- `execute: someModuleLevelFn` is a reference, and its referent's own body is a separate lexical scope this rule never treats as exempt. */
function isFunctionValueOf(property: TSESTree.Property): boolean {
  return (
    property.value.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    property.value.type === AST_NODE_TYPES.FunctionExpression
  )
}

/**
 * Flags a direct call to a global I/O function (`fetch` by default) written
 * anywhere other than inside a capability's own `execute`/`subscribe`, so
 * external data access always goes through a declared, analyzable
 * capability operation instead of being scattered through application code.
 *
 * @remarks
 * **Exact matching rule, deliberately kept purely structural.** A
 * `fetch(...)` is exempt the moment it is lexically inside an
 * `execute`/`subscribe` function of an operation declared in a
 * `buildData`/`createData` call's `getters`/`mutators`/`subscriptions`
 * section -- position alone. There is no cross-referencing against declared
 * `endpoints` metadata, no URL matching, and no inspection of what the
 * operation's body actually does: an operation body is opaque to `data-cap`'s
 * static analysis by design (AGENTS.md invariant 6), and a rule that peeked
 * inside one would be the first thing in this package to break that.
 *
 * The consequence is worth stating plainly: this rule proves *where* a call
 * is written, never that the capability declaring it is honest about what it
 * fetches. It is a structural convention check, not a security control.
 *
 * `options.functions` names *global* identifiers, so the rule never learns
 * about a specific HTTP client library; `options.allow` exempts whole files
 * by glob, for a project's own transport layer or scripts.
 */
export const noRawExternalIo = createRule<[RuleOptions], "noRawExternalIo">({
  name: "no-raw-external-io",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct external I/O calls (fetch, ...) outside a capability's own execute/subscribe, so data acquisition stays inside a declared, analyzable data-cap operation.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
          functions: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noRawExternalIo:
        "\"{{name}}\" is called outside any capability's execute/subscribe, so this data access is invisible to data-cap's analysis -- no owner, no sensitivity, no declared endpoint, and nothing for the generated reports to describe. Move it into a getter/mutator/subscription's own execute/subscribe (see GUIDE.md's ESLint plugin section for the allow-list escape hatch for a project's own transport layer).",
    },
  },
  defaultOptions: [{ allow: [], functions: DEFAULT_FUNCTIONS }],
  create(context, [options]) {
    // `RuleCreator` merges `defaultOptions` onto the configured options, so `allow` is always set.
    const allowPatterns = options.allow as readonly string[]
    if (allowPatterns.some((pattern) => globToRegExp(pattern).test(context.filename))) return {}

    const flagged = new Set(options.functions ?? DEFAULT_FUNCTIONS)

    // `NewExpression` as well as `CallExpression`: `XMLHttpRequest` and
    // `WebSocket` -- the natural entries beyond the default -- are only ever
    // reached through `new`, so a rule that only saw plain calls would
    // silently do nothing for them while still accepting them as options. The
    // `Identifier.callee` selectors mean every node reaching `check` already
    // has a bare-identifier callee.
    function check(node: TSESTree.CallExpression | TSESTree.NewExpression): void {
      const callee = node.callee as TSESTree.Identifier
      if (!flagged.has(callee.name)) return
      if (!isBareGlobal(context.sourceCode, callee)) return
      if (isInsideOperationBody(node)) return
      context.report({ node, messageId: "noRawExternalIo", data: { name: callee.name } })
    }

    return {
      "CallExpression > Identifier.callee": (node: TSESTree.Identifier) => {
        check(node.parent as TSESTree.CallExpression)
      },
      "NewExpression > Identifier.callee": (node: TSESTree.Identifier) => {
        check(node.parent as TSESTree.NewExpression)
      },
    }
  },
})
