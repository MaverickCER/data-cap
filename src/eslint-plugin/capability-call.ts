/**
 * The structural AST vocabulary both rules in this folder share: how to
 * recognize a `buildData(...)`/`createData(...)` call, and how to read a
 * static property key. Extracted here rather than duplicated once per rule
 * so "what counts as a capability declaration" has exactly one definition --
 * a second, drifting copy is the failure mode this folder is small enough to
 * still avoid.
 *
 * Deliberately narrow imports, same as each rule file's own: `AST_NODE_TYPES`
 * lives in `@typescript-eslint/types`, which never touches `eslint` itself
 * (see `stable-operation-reference.ts`'s header for the full rationale).
 *
 * Nothing here inspects what an operation's `execute`/`processor`/`subscribe`
 * body *does* -- that stays opaque, per AGENTS.md invariant 6. These helpers
 * only answer questions about the shape of the call expression itself.
 */

import { AST_NODE_TYPES } from "@typescript-eslint/types"
import type { TSESTree } from "@typescript-eslint/types"

/** The two call forms that declare a capability. `buildData` has no operations section; `createData` does. */
export const CAPABILITY_CALL_NAMES: ReadonlySet<string> = new Set(["buildData", "createData"])

/** Whether `key` names one of `createData`'s three operation sections -- the only places an `execute`/`subscribe` can legitimately live. */
export function isOperationSectionKey(key: string | undefined): boolean {
  return key === "getters" || key === "mutators" || key === "subscriptions"
}

/** Whether `key` names an operation property whose value is the function that actually performs the capability's own I/O. */
export function isOperationBodyKey(key: string | undefined): boolean {
  return key === "execute" || key === "subscribe"
}

/**
 * Whether `node` is a call to one of `names`, written either bare
 * (`createData(...)`) or as a member access (`dataCap.createData(...)`) --
 * the same two forms `stable-operation-reference.ts` has always recognized.
 * Never resolves an alias or traces an import: a renamed binding is outside
 * what a purely structural check can decide.
 */
export function isCapabilityCall(node: TSESTree.Node, names: ReadonlySet<string>): boolean {
  if (node.type !== AST_NODE_TYPES.CallExpression) return false
  const callee = node.callee
  if (callee.type === AST_NODE_TYPES.Identifier) return names.has(callee.name)
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return names.has(callee.property.name)
  }
  return false
}

/** A property key's static name, or `undefined` when it's computed/dynamic (never guessed at). */
export function getStaticKeyName(key: TSESTree.PropertyName): string | undefined {
  if (key.type === AST_NODE_TYPES.Identifier) return key.name
  // Any other static-name key is a `Literal`; take its value only when it is a
  // string (a numeric/bigint/regexp literal key has no usable static name).
  const literalValue: unknown = "value" in key ? key.value : undefined
  return typeof literalValue === "string" ? literalValue : undefined
}

/** Whether `node` is an inline function literal (arrow or `function` expression). */
export function isInlineFunction(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression
  )
}
