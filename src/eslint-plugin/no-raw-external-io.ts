// Deliberately narrow imports -- see `stable-operation-reference.ts`'s own
// header for the full rationale: `@typescript-eslint/utils`'s main entry
// re-exports FlatESLint/ESLint wrapper classes that do a runtime
// `require("eslint")`, which throws once bundled into dependency-free ESM
// output. `RuleCreator` alone lives at the `eslint-utils` subpath and
// `AST_NODE_TYPES` in `@typescript-eslint/types`, neither of which touch
// `eslint` at all.
import { RuleCreator } from "@typescript-eslint/utils/eslint-utils"
import { AST_NODE_TYPES } from "@typescript-eslint/types"
import type { TSESTree } from "@typescript-eslint/types"
import type { Scope } from "@typescript-eslint/scope-manager"
import {
  CAPABILITY_CALL_NAMES,
  getStaticKeyName,
  isCapabilityCall,
  isOperationBodyKey,
  isOperationSectionKey,
} from "./capability-call.js"
import { globToRegExp } from "./glob.js"

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

/**
 * Whether `name` at `node` refers to an ambient global rather than something
 * the file itself declared or imported.
 *
 * Without this, a project's own `import { fetch } from "./http.js"` or a
 * local `function fetch()` helper would be flagged as raw external I/O
 * purely because of its name -- the rule's own option is documented as
 * naming *global* identifiers, so it has to actually mean that. An
 * identifier that resolves nowhere is treated as a global: that's exactly
 * what an ambient `fetch` looks like to scope analysis.
 */
function isBareGlobal(
  sourceCode: Readonly<{ getScope(node: TSESTree.Node): Scope }>,
  node: TSESTree.Identifier,
): boolean {
  let scope: Scope | null = sourceCode.getScope(node)
  while (scope !== null) {
    const variable = scope.variables.find((candidate) => candidate.name === node.name)
    // A real global (`fetch`, `XMLHttpRequest`) appears in the global scope's
    // variable list with zero definitions -- nothing in this program declared
    // it. Anything with a definition was declared or imported here.
    if (variable !== undefined) return variable.defs.length === 0
    scope = scope.upper
  }
  return true
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
  // `Program.parent` is `null` at runtime even though the TSESTree types
  // declare it as `Node | undefined` -- a nullish check covers both without
  // asserting a `null` the types claim can't happen.
  let current: TSESTree.Node | undefined = node.parent

  while (current != null) {
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
    current = current.parent
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
        "\"{{name}}\" is called outside any capability's execute/subscribe, so this data access is invisible to data-cap's analysis -- no owner, no sensitivity, no declared endpoint, and nothing for the generated reports to describe. Move it into a getter/mutator/subscription's own execute/subscribe (see README's ESLint plugin section for the allow-list escape hatch for a project's own transport layer).",
    },
  },
  defaultOptions: [{ allow: [], functions: DEFAULT_FUNCTIONS }],
  create(context, [options]) {
    // `defaultOptions` (the RuleCreator merge) always supplies `allow`, so this
    // is never nullish -- but the option type keeps it optional for a caller.
    // Stryker disable next-line ArrayDeclaration
    const allowPatterns = options.allow ?? []
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
