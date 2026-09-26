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
import { globToRegExp } from "./glob.js"

const createRule = RuleCreator(
  (name) => `https://github.com/maverickcer/data-cap#eslint-plugin-${name}`,
)

/** Options for `no-fields-escape`. */
export interface RuleOptions {
  /**
   * Glob-array of files this rule doesn't apply to -- same escape hatch
   * `no-raw-external-io` offers, for a project's own trusted internal
   * plumbing that legitimately forwards a whole `.fields` object (a generic
   * `<DataDebugPanel data={...x.fields} />` dev tool, for instance). Empty
   * by default: this rule never guesses at which files are exempt.
   */
  allow?: string[]
}

/**
 * Whether `node` is a `.fields` member access -- `x.fields` or
 * `x.getSnapshot().fields` are structurally identical here (both are a
 * non-computed `MemberExpression` named `fields`), regardless of what `x`
 * is: a bare capability identifier, a renamed import, or a locally aliased
 * binding. Matched by property name alone, the same "by name, not by
 * provenance" convention `capability-call.ts`'s `isCapabilityCall` already
 * establishes for this plugin -- see this rule's own top-level doc comment
 * for the false-positive tradeoff that implies.
 *
 * Takes a `MemberExpression` directly, not a generic `TSESTree.Node` --
 * this is only ever called from the `MemberExpression` visitor below, so a
 * runtime `node.type === MemberExpression` re-check would be provably
 * always true there and untestable as a distinct branch.
 *
 * A non-computed member access's property is an `Identifier` for an
 * ordinary name (`x.fields`) or a `PrivateIdentifier` for a private class
 * field (`x.#fields`) -- the only two possibilities once `!node.computed`
 * holds, so the `Identifier` check is a real, meaningful distinction, not
 * a redundant one.
 */
function isFieldsMemberAccess(node: TSESTree.MemberExpression): boolean {
  return (
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === "fields"
  )
}

/**
 * Whether `node` is a bare `x.getSnapshot()` call, not yet narrowed to
 * `.fields` -- spreads `info` alongside `fields` at once, wider even than
 * `isFieldsMemberAccess`.
 *
 * Takes a `CallExpression` directly, for the same reason
 * `isFieldsMemberAccess` takes a `MemberExpression` directly -- see its
 * own doc comment.
 */
function isGetSnapshotCall(node: TSESTree.CallExpression): boolean {
  return (
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    !node.callee.computed &&
    node.callee.property.type === AST_NODE_TYPES.Identifier &&
    node.callee.property.name === "getSnapshot"
  )
}

/**
 * Whether `node` sits as the argument of a JSX spread attribute
 * (`<Child {...node} />`) or an object-literal spread (`{ ...node }`) --
 * two of the shapes that erase which specific field(s) actually flow
 * onward, the exact escape [ADR 0060](../../specs/decisions/0060-usage-scanner-escape-sites.md)
 * documents the build-time scanner widening to `indeterminate` rather than
 * silently `unconsumed`. An array spread (`[...node]`) is deliberately not
 * matched -- `.fields`/`getSnapshot()` never produce an iterable, so real
 * code never does this.
 *
 * `parent.argument === node` is never separately checked once `parent`'s
 * own `type` matches: a `JSXSpreadAttribute`/`SpreadElement` each have
 * exactly one child slot (`argument`), so `node` being `parent`'s child at
 * all already proves it. `node.parent` itself is `Node | undefined` only
 * by TSESTree's general type -- every node reached here comes from the
 * `MemberExpression`/`CallExpression` visitors below, never the `Program`
 * root, so it is always populated in practice.
 */
function isSpread(node: TSESTree.Node): boolean {
  // `node.parent` is always populated for a MemberExpression/CallExpression
  // reached via a real ESLint traversal (never the Program root).
  // Hand-verified: mutating this guard to `if (false)` (or the `return
  // false` it guards to `return true`) and running the real suite passes
  // unchanged -- the branch's body is never reached by any real input.
  // Stryker disable next-line ConditionalExpression, BooleanLiteral
  if (node.parent === undefined) return false
  const parent = node.parent
  if (parent.type === AST_NODE_TYPES.JSXSpreadAttribute) return true
  if (parent.type === AST_NODE_TYPES.SpreadElement) {
    return parent.parent.type === AST_NODE_TYPES.ObjectExpression
  }
  return false
}

/**
 * Whether `node` is the initializer of a destructuring pattern that
 * contains a rest element -- `const { ...rest } = node` or `const { email,
 * ...rest } = node`. A rest element captures every remaining field at
 * once, the same "which fields, exactly" ambiguity as a spread, just on
 * the reading side instead of the writing side.
 *
 * `parent.init === node` is never separately checked once `parent.type`
 * matches `VariableDeclarator`: its only other child slot is `id`, typed
 * as a binding pattern (`Identifier`/`ObjectPattern`/`ArrayPattern`) --
 * never a `MemberExpression`/`CallExpression`, the only two node types
 * this function is ever called with -- so `node` being `parent`'s child at
 * all already proves it is `init`, not `id`.
 */
function isDestructuredWithRest(node: TSESTree.Node): boolean {
  // Same reasoning as `isSpread`'s identical guard: `node.parent` is always
  // populated for a MemberExpression/CallExpression reached via a real
  // ESLint traversal. Hand-verified: mutating this guard to `if (false)`
  // (or the `return false` it guards to `return true`) and running the
  // real suite passes unchanged -- the branch's body is never reached.
  // Stryker disable next-line ConditionalExpression, BooleanLiteral
  if (node.parent === undefined) return false
  const parent = node.parent
  if (parent.type !== AST_NODE_TYPES.VariableDeclarator) return false
  const id = parent.id
  return (
    id.type === AST_NODE_TYPES.ObjectPattern &&
    id.properties.some(
      (property: TSESTree.Property | TSESTree.RestElement) =>
        property.type === AST_NODE_TYPES.RestElement,
    )
  )
}

/**
 * Whether `node` sits as one of a `CallExpression`/`NewExpression`'s
 * arguments -- `doSomething(node)` -- never the callee itself. Handing the
 * whole value to an arbitrary function is the same "we don't know what
 * happens to it next" ambiguity `isSpread` already covers, just via a
 * function boundary instead of an object/JSX boundary.
 */
function isCallArgument(node: TSESTree.Node): boolean {
  // node.parent is always populated for a MemberExpression/CallExpression
  // reached via a real ESLint traversal (never the Program root).
  // Hand-verified: mutating this guard to `if (false)` (or the `return
  // false` it guards to `return true`) and running the real suite passes
  // unchanged -- the branch's body is never reached by any real input.
  // Stryker disable next-line ConditionalExpression, BooleanLiteral
  if (node.parent === undefined) return false
  const parent = node.parent
  if (
    parent.type !== AST_NODE_TYPES.CallExpression &&
    parent.type !== AST_NODE_TYPES.NewExpression
  ) {
    return false
  }
  return (parent.arguments as readonly TSESTree.Node[]).includes(node)
}

/**
 * Whether `node` is the value of a single, *named* JSX attribute --
 * `<Child data={node} />` -- as opposed to a spread (`isSpread` already
 * covers `<Child {...node} />` separately). A named prop at least tells a
 * reader *something* is being passed and under what name, but data-cap's
 * build-time scanner is exactly as blind to which field(s) flow through it
 * as it is through a spread -- ADR 0064 chose to flag this shape too,
 * revisiting ADR 0063's original "leave it out" call for this specific
 * pattern once asked directly whether it should stay out.
 *
 * `node.parent.type === JSXExpressionContainer` is never separately checked:
 * `node` is always a `MemberExpression`/`CallExpression`, and the only
 * `JSXAttribute`-adjacent slot either can ever occupy is a
 * `JSXExpressionContainer`'s own `.expression` (a `JSXAttribute`'s `.value`
 * is a `Literal`/`JSXElement`/`JSXFragment`/`JSXExpressionContainer`, never
 * a bare expression) -- so `node.parent.parent.type === JSXAttribute` being
 * true already proves `node.parent` is that container.
 *
 * Both `?.` hops are for the compiler only: `node.parent`/`.parent.parent`
 * are always populated for a MemberExpression/CallExpression reached via a
 * real ESLint traversal (never the Program root). Hand-verified: mutating
 * either optional-chain operator away and running the real suite passes
 * unchanged.
 */
function isNamedJsxAttributeValue(node: TSESTree.Node): boolean {
  // Stryker disable next-line OptionalChaining
  return node.parent?.parent?.type === AST_NODE_TYPES.JSXAttribute
}

/**
 * Whether `name` is exported from this module via a same-file
 * `export { name }` specifier. Every ES module export is necessarily a
 * top-level `Program` statement (no conditional or nested export exists in
 * the language), and a top-level `const`/`function` name can never collide
 * with another top-level declaration of the same name in the same module (a
 * duplicate declaration is a parse error) -- so matching by name alone
 * against `program.body` is sound here without needing full scope
 * resolution.
 *
 * `statement.source !== null` excludes `export { name } from "./other"` --
 * a re-export names a binding from *another* module, never this one's own
 * `name`, even when the two happen to share a spelling. Once `source` is
 * null, TSESTree's own types narrow `specifiers` to
 * `ExportSpecifierWithIdentifierLocal[]`, so `specifier.local` is already
 * exactly an `Identifier` -- no separate `.type` check is needed or even
 * well-typed.
 *
 * `statement.type !== ExportNamedDeclaration` is checked before
 * `statement.source`, but no other `Program.body` statement type can ever
 * reach the line below it regardless: `source` is `null`-typed only on an
 * `ExportNamedDeclaration`'s own "without source" variants, so any other
 * statement either has no `source` at all (`undefined !== null` is `true`,
 * short-circuiting the same as a real non-export statement would) or a
 * non-null one (an import/re-export's own `source`, never `null`). Hand-
 * verified: mutating this first guard away and running the real suite
 * passes unchanged.
 */
function isExportedName(name: string, program: TSESTree.Program): boolean {
  return program.body.some((statement) => {
    // Stryker disable next-line ConditionalExpression, BooleanLiteral
    if (statement.type !== AST_NODE_TYPES.ExportNamedDeclaration) return false
    if (statement.source !== null) return false
    return statement.specifiers.some((specifier) => specifier.local.name === name)
  })
}

/**
 * Whether `declaration` (a `VariableDeclaration` or `FunctionDeclaration`)
 * is exported -- directly (`export const x = ...` / `export function
 * f() {}`, wrapped in an `ExportNamedDeclaration`) or later, by name, via
 * `export { name }` (see `isExportedName`).
 */
function isDeclarationExported(
  declaration: TSESTree.VariableDeclaration | TSESTree.FunctionDeclaration,
  name: string,
  program: TSESTree.Program,
): boolean {
  if (declaration.parent.type === AST_NODE_TYPES.ExportNamedDeclaration) return true
  return isExportedName(name, program)
}

/**
 * Whether `node` is the initializer of a top-level `const`/`let`/`var`
 * declaration that is exported -- `export const leaked = x.fields;`, or
 * `const leaked = x.fields; export { leaked };`. A field only reachable
 * through this module's own public export surface has crossed this file's
 * boundary the moment the export exists, regardless of what any importer
 * later does with it -- the same "declaring an escape is provable, tracing
 * where it goes next is not" boundary this whole rule works within.
 *
 * Only a simple `Identifier` binding is matched (`const leaked = ...`) --
 * a destructuring binding pattern names no single exportable identifier
 * this check could look up in `program.body`.
 *
 * `declarator.init === node` is never separately checked once
 * `declarator.type` matches `VariableDeclarator`: its only other child slot
 * is `id`, a binding pattern (`Identifier`/`ObjectPattern`/`ArrayPattern`)
 * -- never a `MemberExpression`/`CallExpression`, the only two node types
 * this function is ever called with -- so `node` being `declarator`'s child
 * at all already proves it is `init`, the same reasoning
 * `isDestructuredWithRest` already applies to this exact parent type.
 */
function isExportedVariableInit(node: TSESTree.Node, program: TSESTree.Program): boolean {
  // node.parent is always populated for a MemberExpression/CallExpression
  // reached via a real ESLint traversal (never the Program root).
  const declarator = node.parent
  // Stryker disable next-line OptionalChaining
  if (declarator?.type !== AST_NODE_TYPES.VariableDeclarator) return false
  if (declarator.id.type !== AST_NODE_TYPES.Identifier) return false
  // A `VariableDeclarator` is only ever a child of a `VariableDeclaration`
  // (`for (const x of y)` included) -- TSESTree types `.parent` here as
  // exactly that, so no `.type` re-check is needed or even well-typed.
  return isDeclarationExported(declarator.parent, declarator.id.name, program)
}

type FunctionLike =
  TSESTree.FunctionDeclaration | TSESTree.FunctionExpression | TSESTree.ArrowFunctionExpression

/**
 * The nearest enclosing function (of any kind) walking up from `node`, or
 * `undefined` at module top level.
 *
 * A `for` loop, not a `while` loop with the advance step in its body: the
 * advance (`current = current.parent`) lives in the loop's own header, not
 * inside the block a mutation-testing tool could empty out wholesale --
 * emptying only the `if` leaves the walk still terminating (just never
 * matching early), rather than spinning forever over a `current` that never
 * changes.
 */
function enclosingFunction(node: TSESTree.Node): FunctionLike | undefined {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      current.type === AST_NODE_TYPES.FunctionDeclaration ||
      current.type === AST_NODE_TYPES.FunctionExpression ||
      current.type === AST_NODE_TYPES.ArrowFunctionExpression
    ) {
      return current
    }
  }
  return undefined
}

/**
 * Whether `fn` is exported -- a named `export function f() {}` (or one
 * later re-exported via `export { f }`), or a function/arrow expression
 * assigned directly to a top-level exported `const` (`export const f =
 * () => ...`). A method, a callback passed inline, or a function nested
 * inside another function is never "exported" by this definition -- only
 * a binding this module's own top-level export surface names.
 */
function isFunctionExported(fn: FunctionLike, program: TSESTree.Program): boolean {
  if (fn.type === AST_NODE_TYPES.FunctionDeclaration) {
    return fn.id !== null && isDeclarationExported(fn, fn.id.name, program)
  }
  // A function/arrow expression is exported only via a `const name = fn`
  // it's the direct initializer of -- the same shape `isExportedVariableInit`
  // already recognizes for a plain value, reused here for a function value.
  return isExportedVariableInit(fn, program)
}

/**
 * Whether `node` is returned from a function that is itself exported --
 * an explicit `return node;`, or `node` as an arrow function's own
 * implicit-return body (`() => node`). Returning a field wholesale from an
 * exported function hands it to whatever, anywhere, later calls that
 * function -- the same "crosses this module's own boundary" concern
 * `isExportedVariableInit` covers for a plain exported value.
 *
 * Neither `parent.argument === node` nor `parent.body === node` is
 * separately checked once `parent.type` matches: a `ReturnStatement`'s only
 * child slot is `argument`, and the only `ArrowFunctionExpression` slot that
 * can directly hold an unwrapped `Expression` (rather than, say, a param
 * default) is `body`, in its implicit-return form -- so `node` being
 * `parent`'s child at all already proves which one it is, the same
 * "only possible slot" reasoning `isDestructuredWithRest`/
 * `isExportedVariableInit` already apply to their own parent types.
 */
function isReturnedFromExportedFunction(node: TSESTree.Node, program: TSESTree.Program): boolean {
  // node.parent is always populated for a MemberExpression/CallExpression
  // reached via a real ESLint traversal (never the Program root).
  // Stryker disable next-line ConditionalExpression, BooleanLiteral
  if (node.parent === undefined) return false
  const parent = node.parent
  const isExplicitReturn = parent.type === AST_NODE_TYPES.ReturnStatement
  const isImplicitArrowReturn = parent.type === AST_NODE_TYPES.ArrowFunctionExpression
  if (!isExplicitReturn && !isImplicitArrowReturn) return false
  const fn = enclosingFunction(node)
  // A `ReturnStatement`/implicit-return arrow body can only ever exist
  // inside a function (a bare `return` outside one is a parse error, and
  // `enclosingFunction` finds the very arrow that IS `parent` on its very
  // first step for the implicit-return case) -- `fn` is never actually
  // `undefined` reached from here, but `enclosingFunction`'s own return
  // type stays `| undefined` since it's a general-purpose upward walk.
  // Stryker disable next-line ConditionalExpression, BooleanLiteral
  return fn !== undefined && isFunctionExported(fn, program)
}

/** Every way this rule recognizes a `.fields`/`getSnapshot()` value crossing a boundary it can't see through -- see each message's own text for what each one means. */
type EscapeKind = "spread" | "argument" | "prop" | "exported"

/**
 * Classifies `node`'s escape shape, or `undefined` if it isn't one.
 * Checked in a fixed order so a value that matches more than one shape at
 * once (a real possibility: an exported variable's initializer could also,
 * in principle, itself be an argument in a wrapping expression) reports
 * its single most specific, most actionable classification rather than an
 * arbitrary one -- `"exported"` first (crosses this module's own boundary,
 * the most consequential shape), then `"spread"`/rest (erases per-field
 * granularity entirely), then the narrower `"argument"`/`"prop"` shapes.
 */
function classifyEscape(node: TSESTree.Node, program: TSESTree.Program): EscapeKind | undefined {
  if (isExportedVariableInit(node, program) || isReturnedFromExportedFunction(node, program)) {
    return "exported"
  }
  if (isSpread(node) || isDestructuredWithRest(node)) return "spread"
  if (isCallArgument(node)) return "argument"
  if (isNamedJsxAttributeValue(node)) return "prop"
  return undefined
}

/**
 * Flags a capability's whole `.fields` (or a bare `getSnapshot()` result)
 * escaping this file's local, single-`.fields.<name>`-read visibility --
 * spread into JSX/an object literal, destructured with a rest element,
 * passed as a bare function argument or a named JSX prop, or exported
 * (directly, or returned from an exported function) -- so field-level
 * data flow stays provable by data-cap's build-time scanner instead of
 * silently escaping it.
 *
 * @remarks
 * **Exact matching rule, deliberately kept purely structural.** Matched by
 * property/method name alone (`.fields`, `.getSnapshot()`) -- like
 * `stable-operation-reference`'s `createData`/`buildData` name matching,
 * this never resolves an import or confirms the base expression is
 * actually a data-cap capability, and never traces an intermediate alias
 * (`const f = x.fields; const { ...rest } = f;` is one hop this rule
 * declines to follow, matching [ADR 0060](../../specs/decisions/0060-usage-scanner-escape-sites.md)'s
 * own "one level" scope for the build-time scanner it mirrors). The
 * consequence is worth stating plainly: an unrelated object that merely
 * happens to expose a `.fields` property or a `.getSnapshot()` method is
 * indistinguishable to this rule and would be flagged the same way --
 * rare in practice, but a real, documented tradeoff, not an oversight.
 *
 * A **plain, non-exported local alias** (`const alias = x.fields;`, never
 * spread, never passed anywhere, never exported) is deliberately never
 * flagged on its own -- seeing a `const` declaration alone can't tell a
 * harmless local narrowing (`const f = x.fields; return f.email;`) apart
 * from a real escape without dataflow tracing this rule doesn't do; see
 * [ADR 0064](../../specs/decisions/0064-no-fields-escape-export-argument-and-prop.md)
 * for why *exported* reassignment is flagged (a provable, structural,
 * module-boundary fact) while plain reassignment stays out of scope (an
 * unprovable one).
 *
 * This rule does not itself prove a leak -- it proves a *shape* the
 * build-time scanner cannot see through, the same distinction
 * `no-raw-external-io`'s own doc comment draws for its own structural
 * check. `options.allow` exempts whole files by glob.
 */
export const noFieldsEscape = createRule<
  [RuleOptions],
  "spread" | "argument" | "prop" | "exported"
>({
  name: "no-fields-escape",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a capability's whole .fields (or a bare getSnapshot() result) escaping this file's provable, per-field visibility -- via spread, rest-destructure, a bare function argument, a named JSX prop, or an export -- so field-level data flow stays provable instead of escaping data-cap's build-time scanner.",
    },
    schema: [
      {
        type: "object",
        properties: { allow: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      spread:
        'Spreading or rest-destructuring "{{expr}}" whole hides which specific field(s) flow onward from here -- data-cap\'s build-time scanner can only prove a direct ".fields.<name>" read, so every field only reachable through this escape is reported "indeterminate", never proven safe (see ADR 0060). Read or destructure the specific field(s) you actually need by name instead.',
      argument:
        'Passing "{{expr}}" whole as an argument hides which specific field(s) the callee actually reads -- data-cap\'s build-time scanner can only prove a direct ".fields.<name>" read, so every field only reachable through this call is reported "indeterminate", never proven safe (see ADR 0060). Pass the specific field(s) the callee actually needs instead.',
      prop: 'Passing "{{expr}}" whole as a prop hides which specific field(s) the receiving component actually reads -- data-cap\'s build-time scanner can only prove a direct ".fields.<name>" read, so every field only reachable through this prop is reported "indeterminate", never proven safe (see ADR 0060). Pass the specific field(s) the component actually needs instead.',
      exported:
        "Exporting \"{{expr}}\" whole hands every field it contains to whatever, anywhere, imports this module -- this module's own boundary is the last point data-cap's build-time scanner can see at all. Export the specific field(s) an importer actually needs instead (see ADR 0064).",
    },
  },
  defaultOptions: [{ allow: [] }],
  create(context, [options]) {
    // `defaultOptions` (the RuleCreator merge) always supplies `allow`, so this
    // is never nullish -- but the option type keeps it optional for a caller.
    // Stryker disable next-line ArrayDeclaration
    const allowPatterns = options.allow ?? []
    if (allowPatterns.some((pattern) => globToRegExp(pattern).test(context.filename))) return {}

    function check(node: TSESTree.MemberExpression | TSESTree.CallExpression): void {
      const kind = classifyEscape(node, context.sourceCode.ast)
      if (kind === undefined) return
      context.report({ node, messageId: kind, data: { expr: context.sourceCode.getText(node) } })
    }

    return {
      MemberExpression(node) {
        if (isFieldsMemberAccess(node)) check(node)
      },
      CallExpression(node) {
        if (isGetSnapshotCall(node)) check(node)
      },
    }
  },
})
