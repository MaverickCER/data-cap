/**
 * The one canonical position representation used everywhere this codebase
 * captures where a fact came from -- not several subtly different
 * `{line, column}`-shaped things accumulating independently across
 * `dependency-graph.ts`, `parse.ts`, `finding-model.ts`, and whatever future
 * module needs one next. Source positions are captured at the earliest
 * layer where they're authoritative (an AST node's own position) and
 * threaded forward from there; nothing downstream ever rediscovers a
 * position from scratch. See ADR 0052.
 */

import ts from "typescript"

/** A 1-based line/column within a file already known from context (e.g. `DependencyEdge.from`). */
export interface SourcePosition {
  readonly line: number
  readonly column: number
}

/** A `SourcePosition` plus the file it's in, for anywhere the file isn't already implied by the surrounding structure (e.g. a finding's list of candidate sites spanning multiple files). */
export interface SourceLocation extends SourcePosition {
  readonly file: string
}

/** The one place a `SourcePosition` is ever computed from a raw AST node -- every caller reuses this instead of hand-rolling `getLineAndCharacterOfPosition` arithmetic. */
export function positionOf(sourceFile: ts.SourceFile, node: ts.Node): SourcePosition {
  const { line, character } = ts.getLineAndCharacterOfPosition(
    sourceFile,
    node.getStart(sourceFile),
  )
  return { line: line + 1, column: character + 1 }
}
