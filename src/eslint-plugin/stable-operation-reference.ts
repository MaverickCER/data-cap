// Deliberately narrow imports -- see env-cap's own eslint-plugin for the
// full rationale: `@typescript-eslint/utils`'s main entry (and its
// `ts-eslint` subpath) re-export FlatESLint/ESLint wrapper classes that do a
// runtime `require("eslint")`, which throws once bundled into
// dependency-free ESM output. `RuleCreator` alone lives at the
// `eslint-utils` subpath and `AST_NODE_TYPES` in `@typescript-eslint/types`,
// neither of which touch `eslint` at all. `@typescript-eslint/scope-manager`
// (a dependency of `utils`, not `eslint` itself) is the same story --
// `ScopeType` is used here as a real runtime enum, not just a type, to
// distinguish "declared inside a function" from "declared at module scope".
import { RuleCreator } from "@typescript-eslint/utils/eslint-utils"
import type { TSESTree } from "@typescript-eslint/types"
import { ScopeType } from "@typescript-eslint/scope-manager"
import type { Scope, ScopeVariable } from "@typescript-eslint/scope-manager"
import { getStaticKeyName, isCapabilityCall, isInlineFunction } from "./capability-call.js"

const createRule = RuleCreator(
  (name) => `https://github.com/maverickcer/data-cap#eslint-plugin-${name}`,
)

/** The two `createData` operation-value keys this rule governs. */
function isTargetKey(keyName: string | undefined): keyName is "execute" | "subscribe" {
  return keyName === "execute" || keyName === "subscribe"
}

// This rule is about `createData`'s coordinator-backed sharing specifically,
// so it recognizes only that call form -- `buildData` has no operations
// section for an `execute`/`subscribe` to live in at all. The shared
// `isCapabilityCall` helper takes the name set for exactly this reason.
const CREATE_DATA_ONLY: ReadonlySet<string> = new Set(["createData"])

function isCreateDataCall(node: TSESTree.Node): boolean {
  return isCapabilityCall(node, CREATE_DATA_ONLY)
}

/**
 * Resolves an `Identifier` reference to the `Variable` it binds to, or
 * `undefined` if scope analysis can't resolve it (e.g. an undeclared
 * global) -- which this rule treats as "can't prove instability", not as
 * an offense. See {@link isRecreatedPerCall} for why an unresolved binding
 * is the conservative case rather than the flagged one.
 */
/**
 * The `Variable` an expression node binds to, or `null`/`undefined` when it is
 * not a resolvable identifier reference at all (a call, a member access, an
 * undeclared global) -- which this rule treats as "can't prove instability".
 */
function resolveVariable(
  sourceCode: Readonly<{ getScope(node: TSESTree.Node): Scope }>,
  node: TSESTree.Node,
): ScopeVariable | null | undefined {
  const scope = sourceCode.getScope(node)
  for (const reference of scope.references) {
    if (reference.identifier === node) return reference.resolved
  }
  return undefined
}

/**
 * True when `variable` is declared inside a function scope (directly, or
 * inside a block/catch/etc. nested within one) rather than at module/global
 * scope -- i.e. its value is (re)constructed every time that enclosing
 * function runs, which includes ordinary parameters (the caller may pass a
 * fresh function on every invocation) as well as `const`/`function`
 * declarations local to a factory. A binding whose scope chain reaches
 * module/global without passing through a function scope only runs once,
 * at module evaluation, and is therefore stable.
 */
function isDeclaredWithinFunctionScope(scope: Scope): boolean {
  if (scope.type === ScopeType.function) return true
  // Only `GlobalScope` has a null `upper`; reaching it without having passed
  // through a function scope means the binding is module/global -- stable.
  // Every other variant (module, block, catch, class, switch, ...) has an
  // `upper` and defers the decision to it.
  if (scope.upper === null) return false
  return isDeclaredWithinFunctionScope(scope.upper)
}

function isRecreatedPerCall(variable: ScopeVariable): boolean {
  return isDeclaredWithinFunctionScope(variable.scope)
}

/**
 * Flags an `execute`/`subscribe` value inside a `createData()` call that
 * isn't a reference to a stable, module-level function, so the runtime
 * coordinator's function-identity-based sharing/deduplication actually
 * applies.
 *
 * @remarks
 * Function identity controls sharing (not function syntax) -- an inline
 * arrow function is a fresh identity every time the surrounding code runs,
 * which is indistinguishable, from the coordinator's perspective, from the
 * developer deliberately opting out of sharing. The same is true of an
 * identifier that merely *looks* like a stable reference syntactically but
 * resolves to a binding declared inside a function (a factory, a
 * component, a parameter) -- that binding is a fresh identity every time
 * the enclosing function runs, exactly like an inline literal would be.
 * This rule exists to make both easy-to-miss cases visible, not to ban
 * arrow functions -- `execute: myStableArrowFunction`, where
 * `myStableArrowFunction` is declared at module scope (or imported), is
 * exactly as sharable as a `function` declaration and never flagged.
 *
 * What this rule deliberately does not attempt: proving stability through
 * a `CallExpression` (`execute: makeGetUser()`), a `MemberExpression`
 * (`execute: someObject.getUser`), a conditional, or cross-module aliasing.
 * Those are outside what static analysis can reliably decide; the runtime
 * coordinator's own behavior must stay correct independent of this rule.
 */
export const stableOperationReference = createRule<
  [],
  "inlineFunctionLiteral" | "recreatedPerCall"
>({
  name: "stable-operation-reference",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require createData()'s execute/subscribe to reference a stable, module-level function rather than an inline function literal or a binding recreated on every call, so the runtime coordinator's identity-based sharing applies.",
    },
    schema: [],
    messages: {
      inlineFunctionLiteral:
        '"{{key}}" is an inline function literal -- a fresh function identity every time this code runs, which defeats the coordinator\'s function-identity-based sharing/deduplication. Extract it to a stable, module-level function and reference that instead.',
      recreatedPerCall:
        '"{{key}}" references "{{name}}", which is declared inside a function rather than at module scope -- so it gets a fresh function identity every time that function runs, which defeats the coordinator\'s function-identity-based sharing/deduplication. Move "{{name}}" to module scope and reference that instead.',
    },
  },
  defaultOptions: [],
  create(context) {
    let createDataDepth = 0

    return {
      CallExpression(node) {
        if (isCreateDataCall(node)) createDataDepth += 1
      },
      "CallExpression:exit"(node) {
        if (isCreateDataCall(node)) createDataDepth -= 1
      },
      Property(node) {
        // `< 1`, not `=== 0`: the rule only applies strictly *inside* an open
        // `createData(...)` -- a would-be-negative depth (never expected) must
        // not accidentally enable it either.
        if (createDataDepth < 1 || node.computed) return
        const keyName = getStaticKeyName(node.key)
        if (!isTargetKey(keyName)) return

        const value = node.value
        if (isInlineFunction(value)) {
          context.report({
            node: value,
            messageId: "inlineFunctionLiteral",
            data: { key: keyName },
          })
          return
        }

        // No explicit "is it an Identifier?" guard: `resolveVariable` returns
        // nullish for any non-identifier node (a call, a member access), so a
        // non-nullish `variable` here is necessarily an `Identifier` binding.
        const variable = resolveVariable(context.sourceCode, value)
        if (variable != null && isRecreatedPerCall(variable)) {
          context.report({
            node: value,
            messageId: "recreatedPerCall",
            data: { key: keyName, name: (value as TSESTree.Identifier).name },
          })
        }
      },
    }
  },
})
