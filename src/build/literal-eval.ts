/**
 * Structurally evaluates a *literal* AST expression into a real JS value --
 * without ever executing code (no `eval`/`new Function`/dynamic `import()`).
 * Anything that isn't a literal (identifiers other than a recognized marker
 * call, arbitrary calls, template expressions with interpolation, ...)
 * resolves to `{ ok: false }` rather than being guessed at -- static analysis
 * warns, it never guesses.
 *
 * Extends the base literal grammar (strings/numbers/booleans/null/arrays/
 * plain objects) with two data-cap-specific recognized forms:
 *  - `fields.nullable(x)` / `fields.optional(x)` calls, recognized by
 *    property name alone (matching this codebase's existing
 *    match-by-name-not-import-provenance convention) and represented using
 *    the SAME `FIELD_MARKER` symbol `core/fields.ts` uses at runtime -- a
 *    safe, direct import of this package's own core code, not of a
 *    discovered third-party file (`build -> core` is an allowed dependency
 *    edge).
 *  - `new Date(...)` / `new URL(...)` / `new RegExp(...)` / `new Map(...)` /
 *    `new Set(...)`, an explicit allowlist of side-effect-free global
 *    constructors whose arguments are themselves literal-evaluable.
 *  - `expr as T` / `<T>expr` type assertions, unwrapped to `expr` -- a type
 *    assertion is compile-time-only and never changes the runtime shape
 *    being evaluated (e.g. `[] as CaseTask[]`).
 */

import ts from "typescript"
import { FIELD_MARKER } from "../core/fields.js"

/** The result of statically evaluating one AST expression -- `ok: false` when the expression falls outside the allow-listed literal grammar, never guessed at. */
export type LiteralEvalResult =
  | {
      /** Always `true` for this variant. */
      readonly ok: true
      /** The evaluated literal value. */
      readonly value: unknown
    }
  | {
      /** Always `false` for this variant. */
      readonly ok: false
    }

type AllowedConstructorName = "Date" | "URL" | "RegExp" | "Map" | "Set"

/** The explicit allowlist of side-effect-free global constructors this module will literal-evaluate. */
function isAllowedConstructor(name: string): name is AllowedConstructorName {
  return name === "Date" || name === "URL" || name === "RegExp" || name === "Map" || name === "Set"
}

/** The two `fields.*` marker call names recognized by property name alone. */
function isMarkerCallName(name: string): boolean {
  return name === "nullable" || name === "optional"
}

/**
 * @internal The literal-evaluated argument list, or `undefined` if any argument
 * falls outside the literal grammar. Exported for direct unit coverage --
 * reached in production only via {@link evaluateLiteral}'s recursion, which
 * per-test mutation coverage does not attribute.
 */
export function evaluateArgs(args: readonly ts.Expression[]): unknown[] | undefined {
  const values: unknown[] = []
  for (const arg of args) {
    const result = evaluateLiteral(arg)
    if (!result.ok) return undefined
    values.push(result.value)
  }
  return values
}

/** @internal Evaluates a `new Date/URL/RegExp/Map/Set(...)` call. Exported for direct unit coverage -- see {@link evaluateArgs}. */
export function evaluateAllowedConstructor(
  name: AllowedConstructorName,
  args: readonly ts.Expression[],
): LiteralEvalResult {
  const values = evaluateArgs(args)
  if (values === undefined) return { ok: false }
  const [first, second] = values

  try {
    switch (name) {
      case "Date":
        if (values.length === 0) return { ok: true, value: new Date() }
        if (typeof first === "string" || typeof first === "number") {
          return { ok: true, value: new Date(first) }
        }
        return { ok: false }
      case "URL":
        if (typeof first !== "string") return { ok: false }
        if (second !== undefined && typeof second !== "string") return { ok: false }
        return { ok: true, value: new URL(first, second) }
      case "RegExp":
        if (typeof first !== "string") return { ok: false }
        if (second !== undefined && typeof second !== "string") return { ok: false }
        return { ok: true, value: new RegExp(first, second) }
      case "Map":
        if (values.length === 0) return { ok: true, value: new Map() }
        return Array.isArray(first)
          ? { ok: true, value: new Map(first as [unknown, unknown][]) }
          : { ok: false }
      case "Set":
        if (values.length === 0) return { ok: true, value: new Set() }
        return Array.isArray(first) ? { ok: true, value: new Set(first) } : { ok: false }
    }
  } catch {
    // A syntactically-literal-evaluable but semantically invalid argument
    // (e.g. `new URL("not a url")`) -- never propagate the constructor's own
    // throw, just report "not literal-evaluable" like anything else that
    // doesn't resolve cleanly.
    return { ok: false }
  }
}

/** @internal Evaluates an `X.nullable(...)` / `X.optional(...)` marker call. Exported for direct unit coverage -- see {@link evaluateArgs}. */
export function evaluateMarkerCall(
  propertyName: string,
  args: readonly ts.Expression[],
): LiteralEvalResult {
  const onlyArg = args.length === 1 ? args[0] : undefined
  if (onlyArg === undefined) return { ok: false }
  const inner = evaluateLiteral(onlyArg)
  if (!inner.ok) return { ok: false }
  return {
    ok: true,
    value: {
      [FIELD_MARKER]: propertyName === "nullable" ? "nullable" : "optional",
      inner: inner.value,
    },
  }
}

/** Statically evaluates one AST expression against the allow-listed literal grammar -- never `eval`/`import`/`require`s anything (ADR 0002). */
export function evaluateLiteral(node: ts.Expression): LiteralEvalResult {
  if (ts.isStringLiteralLike(node)) return { ok: true, value: node.text }
  if (ts.isNumericLiteral(node)) return { ok: true, value: Number(node.text) }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true }
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false }
  if (node.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null }

  if (ts.isParenthesizedExpression(node)) return evaluateLiteral(node.expression)

  // `expr as T` / `<T>expr` -- a type assertion changes nothing about the
  // expression's own runtime shape, only how the compiler types it (e.g.
  // `[] as CaseTask[]` for an empty-array field default). Unwrapping it is
  // the same "look through, don't guess" move as parenthesized expressions
  // above -- the asserted type itself is never trusted or read.
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
    return evaluateLiteral(node.expression)
  }

  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) {
    const operand = evaluateLiteral(node.operand)
    if (!operand.ok || typeof operand.value !== "number") return { ok: false }
    return { ok: true, value: -operand.value }
  }

  if (ts.isArrayLiteralExpression(node)) {
    const values: unknown[] = []
    for (const element of node.elements) {
      // A spread (`...x`) or a hole (`[,]`) is not a literal-evaluable
      // expression -- `evaluateLiteral` returns `{ ok: false }` for it, same as
      // any other unsupported node.
      const result = evaluateLiteral(element)
      if (!result.ok) return { ok: false }
      values.push(result.value)
    }
    return { ok: true, value: values }
  }

  if (ts.isObjectLiteralExpression(node)) {
    const record: Record<string, unknown> = {}
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) return { ok: false }
      const key = getStaticPropertyName(prop.name)
      if (key === undefined) return { ok: false }
      const result = evaluateLiteral(prop.initializer)
      if (!result.ok) return { ok: false }
      record[key] = result.value
    }
    return { ok: true, value: record }
  }

  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    isAllowedConstructor(node.expression.text)
  ) {
    return evaluateAllowedConstructor(node.expression.text, node.arguments ?? [])
  }

  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    isMarkerCallName(node.expression.name.text)
  ) {
    return evaluateMarkerCall(node.expression.name.text, node.arguments)
  }

  return { ok: false }
}

/** Reads a property name statically (identifier, string literal, or numeric literal) -- a computed key (e.g. `[expr]`) resolves to `undefined` rather than being guessed at. */
export function getStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteralLike(name)) return name.text
  if (ts.isNumericLiteral(name)) return name.text
  return undefined
}
