/**
 * Syntactic helpers for the flow pass's redundant-transformation tags (ADR 0075): whether an initializer only
 * derives a value from what it reads (so that a name nothing reads is a derivation nobody uses, not a call whose effect
 * is the point), and how often each name is written in a function.
 *
 * No analysis here: they read the syntax tree and nothing else.
 */

import type TS from "typescript"
import { ts } from "./typescript.js"

/** Methods of a value that make a new value from it and do nothing else. */
function isDerivingMethod(name: string): boolean {
  return [
    "toString",
    "toLowerCase",
    "toUpperCase",
    "trim",
    "trimStart",
    "trimEnd",
    "substring",
    "substr",
    "split",
    "join",
    "replace",
    "replaceAll",
    "padStart",
    "padEnd",
    "repeat",
    "normalize",
    "charAt",
    "toFixed",
    "toISOString",
    "map",
    "filter",
    "flat",
    "flatMap",
    "slice",
    "concat",
    "toSorted",
    "toReversed",
    "at",
  ].includes(name)
}

/** A literal, a name or `this`: nothing to evaluate. */
function isLeaf(node: TS.Node): boolean {
  return (
    ts.isIdentifier(node) ||
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.ThisKeyword ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  )
}

/** An expression that only wraps another (parentheses, a type assertion, `!`) or reads a member of it. */
function pureThrough(node: TS.Node): boolean | undefined {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isSpreadElement(node) ||
    ts.isSpreadAssignment(node) ||
    ts.isTypeOfExpression(node)
  )
    return isPureDerivation(node.expression)
  if (ts.isElementAccessExpression(node))
    return isPureDerivation(node.expression) && isPureDerivation(node.argumentExpression)
  return undefined
}

function pureMember(member: TS.ObjectLiteralElementLike): boolean {
  if (ts.isPropertyAssignment(member))
    return (
      (!ts.isComputedPropertyName(member.name) || isPureDerivation(member.name.expression)) &&
      isPureDerivation(member.initializer)
    )
  if (ts.isSpreadAssignment(member)) return isPureDerivation(member.expression)
  // A shorthand property reads a name; a method, getter or setter is only defined here, not run.
  return true
}

/** An object, array or template literal whose members are all pure. */
function pureLiteral(node: TS.Node): boolean | undefined {
  if (ts.isObjectLiteralExpression(node)) return node.properties.every(pureMember)
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(isPureDerivation)
  if (ts.isTemplateExpression(node))
    return node.templateSpans.every((span) => isPureDerivation(span.expression))
  return undefined
}

function isAssignment(kind: TS.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment
}

/** An operator applied to pure operands. Assignment, `++` and `--` change something, so they are not pure. */
function pureOperator(node: TS.Node): boolean | undefined {
  if (ts.isBinaryExpression(node))
    return (
      !isAssignment(node.operatorToken.kind) &&
      isPureDerivation(node.left) &&
      isPureDerivation(node.right)
    )
  if (ts.isConditionalExpression(node))
    return [node.condition, node.whenTrue, node.whenFalse].every(isPureDerivation)
  if (ts.isPrefixUnaryExpression(node))
    return (
      node.operator !== ts.SyntaxKind.PlusPlusToken &&
      node.operator !== ts.SyntaxKind.MinusMinusToken &&
      isPureDerivation(node.operand)
    )
  return undefined
}

/** A callback written as an expression: `(x) => x.id`. A block body can do anything. */
function isPureCallback(node: TS.Node): boolean {
  return ts.isArrowFunction(node) && !ts.isBlock(node.body) && isPureDerivation(node.body)
}

/** Methods that call the function they are given for each item: the function must be pure itself. */
function takesCallback(name: string): boolean {
  return ["map", "filter", "flatMap", "toSorted"].includes(name)
}

/**
 * `value.method(...)` for a method that only derives a new value, with arguments that are pure (or, for a method that
 * calls its argument, a pure callback); or `capability.getSnapshot()`, which only reads the current state.
 */
function pureCall(node: TS.Node): boolean | undefined {
  if (!ts.isCallExpression(node)) return undefined
  const callee = node.expression
  if (!ts.isPropertyAccessExpression(callee)) return false
  const method = callee.name.text
  if (method === "getSnapshot")
    return node.arguments.length === 0 && isPureDerivation(callee.expression)
  return (
    isDerivingMethod(method) &&
    isPureDerivation(callee.expression) &&
    node.arguments.every((argument) =>
      takesCallback(method) ? isPureCallback(argument) : isPureDerivation(argument),
    )
  )
}

/**
 * Whether evaluating `node` only derives a value from what it reads: names, members, literals, operators, and the
 * methods of a value that make a new value. A call to anything else, an assignment, `await`, `new` and `yield` are not
 * pure: their effect may be the reason they are written.
 */
export function isPureDerivation(node: TS.Node): boolean {
  if (isLeaf(node)) return true
  return pureThrough(node) ?? pureLiteral(node) ?? pureOperator(node) ?? pureCall(node) ?? false
}

/** How many times each name is written as an identifier anywhere under `root`, declarations and member names included. */
export function identifierCounts(root: TS.Node): Map<string, number> {
  const counts = new Map<string, number>()
  const visit = (node: TS.Node): void => {
    if (ts.isIdentifier(node)) counts.set(node.text, (counts.get(node.text) ?? 0) + 1)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return counts
}
