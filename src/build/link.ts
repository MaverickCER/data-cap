/**
 * Cross-file linking: resolves each `buildData()`/`createData()` call's
 * `fields` reference to an actual literal-evaluated shape (following at
 * most one level of cross-file identifier imports -- including a
 * `tsconfig.json` path alias, via `resolveImportSpecifier`), and correlates
 * `documentData()` calls with the `buildData()`/`createData()` capability
 * they document (decision 19 -- see specs/architecture.md's
 * "documentation-consistency" section).
 *
 * Correlation is same-file only, matching env-cap's own `link.ts`
 * convention: a `documentData()` call correlates with a `buildData()`/
 * `createData()` call in the same file when either (a) both reference the
 * same local `fields` identifier, or (b) the file contains exactly one of
 * each (an unambiguous single pair). Anything else is not guessed at -- it
 * surfaces as a `ParseWarning` naming the specific mismatch category
 * instead.
 */

import ts from "typescript"
import { evaluateLiteral } from "./literal-eval.js"
import { extractCapabilityDocs, parseCapabilityFile } from "./parse.js"
import type {
  LooseCapabilityDocs,
  OperationNames,
  OperationPresenceByKind,
  OperationWritesByKind,
  ParseResult,
  ParseWarning,
  RawCreateDataCall,
  RawDocumentDataCall,
  SchemaRef,
} from "./parse.js"
import {
  createAliasResolutionCache,
  loadTsconfigPaths,
} from "./resolution/resolve-tsconfig-paths.js"
import { resolveImportSpecifier } from "./resolution/resolve-import.js"
import type { ImportResolutionContext } from "./resolution/resolve-import.js"
import type { SourcePosition } from "./source-position.js"
import type { BuildFileSystem } from "./types.js"

/** Options for `linkCapabilityFiles`. */
export interface LinkOptions {
  /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
  readonly fs: BuildFileSystem
  /** Directory import specifiers/tsconfig auto-detection resolve against. */
  readonly root: string
  /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution. Defaults to auto-detecting `root/tsconfig.json`. */
  readonly tsconfig?: string | false
  /** Explicit cross-package schema discovery allowlist -- see `resolve-package-schema.ts`. */
  readonly packages?: readonly string[]
}

/** One `buildData`/`createData` capability, linked with its correlated `documentData()` call (if any). */
export interface DiscoveredCapability {
  /** Absolute path of the file declaring this capability. */
  readonly file: string
  /** The binding name the capability is exported as. */
  readonly exportName: string
  /** `"buildData"` or `"createData"` -- which call form declared this capability. */
  readonly kind: "buildData" | "createData"
  /** The literal-evaluated `fields` shape, or `undefined` when it couldn't be statically resolved (see accompanying warnings). */
  readonly fieldsShape: Record<string, unknown> | undefined
  /** Static getter/mutator/subscription names (never their function bodies) -- only ever populated for a `createData()` call; `undefined` for `buildData()`, which has no operations section. */
  readonly operationNames: OperationNames | undefined
  /** Static `writes` field-ownership shapes, keyed the same way as `operationNames` -- `undefined` under the same condition. */
  readonly operationWrites: OperationWritesByKind | undefined
  /** Static `processor`/`optimistic` key-presence facts, keyed the same way as `operationNames` -- `undefined` under the same condition. */
  readonly operationPresence: OperationPresenceByKind | undefined
  /** Position of this capability's own `buildData`/`createData` call site -- always available. */
  readonly declarationPosition: SourcePosition
  /** Position of each top-level field's own key, keyed by field name -- only when `fields` was an inline object literal in this file (see `parse.ts`'s `extractFieldPositions`); `undefined` when identifier-resolved across a file boundary. */
  readonly fieldPositions: Readonly<Record<string, SourcePosition>> | undefined
  /** The `documentData()` call correlated with this capability, if any. */
  readonly documentedBy:
    | {
        /** Absolute path of the file declaring the correlated `documentData()` call. */
        readonly file: string
      }
    | undefined
  /** Statically-extracted governance metadata from the correlated `documentData()` call, if any -- `undefined` when `documentedBy` is `undefined`, or when its `docs` argument wasn't an inline object literal. */
  readonly docs: LooseCapabilityDocs | undefined
}

/** Every capability discovered and linked across the project, plus every warning encountered along the way. */
export interface LinkResult {
  /**
   * The discovery root this result was produced against (`LinkOptions.root`),
   * carried through so `buildInventory` can publish every `file` root-relative
   * without a second, separately-supplied copy of the same fact that could
   * disagree with the one linking actually used (OUT-01; see
   * `display-path.ts`).
   */
  readonly root: string
  /** Every discovered, linked capability -- each `file` still ABSOLUTE here, since linking itself does real filesystem work. Relativized once, at model construction, by `buildInventory`. */
  readonly capabilities: readonly DiscoveredCapability[]
  /** Parse/link warnings, never blocking. */
  readonly warnings: readonly ParseWarning[]
}

const MAX_IDENTIFIER_CHAIN_DEPTH = 5

// A hard, generous fail-safe wholly independent of `depth`/`MAX_IDENTIFIER_CHAIN_DEPTH`
// -- not a policy limit (a real chain never needs more than a handful of hops
// to hit that depth cap) but a backstop against a broken depth-increment
// itself: an ArithmeticOperator mutation flipping `depth + 1` to `depth - 1`
// (in `resolveExpression` below) would otherwise let a genuine identifier
// cycle recurse forever, since `depth` would never exceed the cap. Threaded
// alongside `depth` via its own separate `+ 1` at every recursive call site,
// so a mutation to `depth`'s own arithmetic leaves this one intact.
const MAX_TOTAL_RESOLUTION_HOPS = 50

/**
 * @internal Exported for direct unit coverage of `resolveFieldsShape`'s
 * `MAX_TOTAL_RESOLUTION_HOPS` fail-safe: a direct unit test can start
 * `totalHops` already past the ceiling against a trivially "unresolvable"
 * ref, organically exercising the fail-fast path no real (even maximally
 * deep or cyclic) identifier chain reachable through the public
 * `linkCapabilityFiles` entry point can ever reach -- the ordinary
 * `depth`/`MAX_IDENTIFIER_CHAIN_DEPTH` check always resolves first.
 */
export class LinkContext {
  private readonly parsedByFile = new Map<string, ParseResult>()
  readonly warnings: ParseWarning[] = []
  readonly importContext: ImportResolutionContext

  constructor(importContext: ImportResolutionContext) {
    this.importContext = importContext
  }

  async getParsed(file: string): Promise<ParseResult> {
    const cached = this.parsedByFile.get(file)
    if (cached !== undefined) return cached
    const sourceText = await this.importContext.fs.readFile(file, "utf8")
    const parsed = parseCapabilityFile(file, sourceText)
    this.parsedByFile.set(file, parsed)
    this.warnings.push(...parsed.warnings)
    return parsed
  }

  /** Resolves a `SchemaRef` to a literal-evaluated object shape, following identifiers within and across files (including via a tsconfig path alias). */
  async resolveFieldsShape(
    ref: SchemaRef,
    file: string,
    parsed: ParseResult,
    depth: number,
    totalHops = 0,
  ): Promise<Record<string, unknown> | undefined> {
    if (totalHops > MAX_TOTAL_RESOLUTION_HOPS) {
      throw new Error(
        `resolveFieldsShape: exceeded ${String(MAX_TOTAL_RESOLUTION_HOPS)} total resolution hops without ever honoring MAX_IDENTIFIER_CHAIN_DEPTH=${String(MAX_IDENTIFIER_CHAIN_DEPTH)} -- the depth-increment itself is broken.`,
      )
    }
    if (ref.kind === "unresolvable") {
      this.warnings.push({ file, message: `Could not statically resolve "fields": ${ref.reason}` })
      return undefined
    }

    if (ref.kind === "literal") {
      // `ref.node` is always an object-literal expression here (per parse.ts),
      // and `evaluateLiteral` of one, when `ok`, is always a plain
      // `Record<string, unknown>` -- never null, an array, or a primitive -- so
      // `result.ok` is the only decision left to make.
      const result = evaluateLiteral(ref.node)
      if (result.ok) return result.value as Record<string, unknown>
      this.warnings.push({
        file,
        message: `"fields" object literal is not fully statically evaluable.`,
      })
      return undefined
    }

    // ref.kind === "identifier"
    if (depth > MAX_IDENTIFIER_CHAIN_DEPTH) {
      this.warnings.push({
        file,
        message: `"fields" identifier chain for "${ref.name}" exceeds the maximum resolvable depth.`,
      })
      return undefined
    }

    const local = parsed.localConsts.get(ref.name)
    if (local !== undefined) {
      return this.resolveExpression(local, file, parsed, depth, totalHops + 1)
    }

    const importBinding = parsed.imports.find((binding) => binding.localName === ref.name)
    if (importBinding === undefined) {
      this.warnings.push({
        file,
        message: `Could not resolve "${ref.name}" -- it is neither a local const nor a recognized import.`,
      })
      return undefined
    }
    if (importBinding.importedName === "*" || importBinding.importedName === "default") {
      this.warnings.push({
        file,
        message: `"${ref.name}" is a namespace/default import -- "fields" must reference a named export to be statically resolved.`,
      })
      return undefined
    }

    const resolvedFile = await resolveImportSpecifier(
      file,
      importBinding.moduleSpecifier,
      this.importContext,
    )
    if (resolvedFile === undefined) {
      this.warnings.push({
        file,
        message: `Could not resolve import "${importBinding.moduleSpecifier}" (for "${ref.name}").`,
      })
      return undefined
    }

    const importedParsed = await this.getParsed(resolvedFile)
    const remoteInitializer = importedParsed.localConsts.get(importBinding.importedName)
    if (remoteInitializer === undefined) {
      this.warnings.push({
        file,
        message: `"${importBinding.importedName}" was not found as a top-level const in "${resolvedFile}".`,
      })
      return undefined
    }
    // The identifier branch of `resolveExpression` already charges one unit of
    // depth per hop, which is what bounds a cross-file cycle -- no extra "+1"
    // for the file boundary itself is needed here.
    return this.resolveExpression(
      remoteInitializer,
      resolvedFile,
      importedParsed,
      depth,
      totalHops + 1,
    )
  }

  private async resolveExpression(
    expression: ts.Expression,
    file: string,
    parsed: ParseResult,
    depth: number,
    totalHops: number,
  ): Promise<Record<string, unknown> | undefined> {
    const ref = schemaRefFromExpression(expression)
    if (ref === undefined) {
      this.warnings.push({
        file,
        message: "Referenced value is not statically resolvable to an object literal.",
      })
      return undefined
    }
    // `depth + 1` charges this hop against the identifier-chain budget. A
    // literal-kind ref ignores `depth` (it never re-enters the chain), so the
    // bump is harmless there and only matters for the identifier case, where it
    // is what bounds a cycle.
    return this.resolveFieldsShape(ref, file, parsed, depth + 1, totalHops + 1)
  }
}

/**
 * The `fields`-shape reference an already-resolved *expression* stands for:
 * an inline object literal, a bare identifier to follow, or (returned as
 * `undefined`) something -- a call, a member access -- this pass will not chase.
 * Mirrors parse.ts's own `fields`-property classification, one level down.
 */
export function schemaRefFromExpression(
  expression: ts.Expression,
): Extract<SchemaRef, { kind: "literal" | "identifier" }> | undefined {
  if (ts.isObjectLiteralExpression(expression)) return { kind: "literal", node: expression }
  if (ts.isIdentifier(expression)) return { kind: "identifier", name: expression.text }
  return undefined
}

/**
 * Whether two `fields` references are the *same* identifier reference -- the
 * basis for unambiguous same-file `createData`/`documentData` correlation.
 * Non-identifier refs (inline literals, unresolvable) never correlate this way,
 * not even two structurally-identical literals: that is the positional
 * fallback's job.
 */
export function sameIdentifierRef(a: SchemaRef, b: SchemaRef): boolean {
  // Key an identifier ref by its bound name; key every other ref by its own
  // object identity (so it equals nothing but itself). Two refs correlate iff
  // their keys are `===` -- i.e. both are identifiers naming the same binding.
  const key = (ref: SchemaRef): string | SchemaRef => (ref.kind === "identifier" ? ref.name : ref)
  return key(a) === key(b)
}

/** Same-file correlation between one file's `buildData`/`createData`/`documentData` calls, per decision 19's mismatch categories. */
function correlate(
  file: string,
  createDataCalls: readonly RawCreateDataCall[],
  documentDataCalls: readonly RawDocumentDataCall[],
  warnings: ParseWarning[],
): ReadonlyMap<RawCreateDataCall, RawDocumentDataCall> {
  const correlated = new Map<RawCreateDataCall, RawDocumentDataCall>()
  const documentedCalls = new Set<RawDocumentDataCall>()

  // Identifier-based correlation: unambiguous whenever both sides reference the same local name.
  for (const createCall of createDataCalls) {
    for (const docCall of documentDataCalls) {
      if (sameIdentifierRef(createCall.fieldsRef, docCall.fieldsRef)) {
        if (correlated.has(createCall)) {
          warnings.push({
            file,
            message: `Multiple documentData() calls reference the same "fields" as one buildData()/createData() capability -- duplicate documentation.`,
          })
          continue
        }
        correlated.set(createCall, docCall)
        documentedCalls.add(docCall)
      }
    }
  }

  // Single-pair positional fallback: exactly one still-uncorrelated createData and one still-unused documentData in the file.
  const uncorrelatedCreates = createDataCalls.filter(
    (c) => c.exportName !== undefined && !correlated.has(c),
  )
  const unusedDocs = documentDataCalls.filter((d) => !documentedCalls.has(d))
  if (uncorrelatedCreates.length === 1 && unusedDocs.length === 1) {
    // Both arrays hold exactly one element; iterating is just how we bind that
    // element without a redundant `!== undefined` narrowing step.
    for (const soleCreate of uncorrelatedCreates) {
      for (const soleDoc of unusedDocs) {
        correlated.set(soleCreate, soleDoc)
        documentedCalls.add(soleDoc)
      }
    }
  }

  for (const docCall of documentDataCalls) {
    if (!documentedCalls.has(docCall)) {
      warnings.push({
        file,
        message:
          "documentData() call could not be correlated with any buildData()/createData() capability in this file (orphaned documentation).",
      })
    }
  }

  return correlated
}

/**
 * @internal Detects a documentData() call's `docs.fields` referencing a field
 * name absent from the capability's own resolved shape. Exported for direct
 * unit coverage -- in production it only ever runs after an `await` in
 * `linkCapabilityFiles`, which Stryker's perTest coverage cannot attribute.
 */
export function checkDocFieldsAgainstShape(
  file: string,
  docsNode: ts.Expression | undefined,
  fieldsShape: Record<string, unknown> | undefined,
  warnings: ParseWarning[],
): void {
  if (
    docsNode === undefined ||
    fieldsShape === undefined ||
    !ts.isObjectLiteralExpression(docsNode)
  )
    return
  const fieldsDocsProp = docsNode.properties.find(
    (prop) =>
      ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === "fields",
  )
  if (fieldsDocsProp === undefined || !ts.isPropertyAssignment(fieldsDocsProp)) return
  if (!ts.isObjectLiteralExpression(fieldsDocsProp.initializer)) return

  for (const prop of fieldsDocsProp.initializer.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue
    const name = ts.isIdentifier(prop.name) ? prop.name.text : undefined
    if (name !== undefined && !Object.hasOwn(fieldsShape, name)) {
      warnings.push({
        file,
        message: `documentData() documents field "${name}", which does not exist on the capability's declared "fields" shape.`,
      })
    }
  }
}

/**
 * Detects a documentData() call's `docs.getters`/`docs.mutators`/
 * `docs.subscriptions` referencing an operation name absent from the
 * capability's own declared operations -- the build-time (AST) counterpart
 * to `CapabilityDocs`'s own compile-time `keyof` checking (see
 * `core/document.ts`): a project not authoring through TypeScript's type
 * checker (or one that bypassed it) still gets this caught here. Mirrors
 * `checkDocFieldsAgainstShape` exactly, one operation-kind section at a
 * time.
 *
 * @internal Exported for direct unit coverage, for the same reason as
 * {@link checkDocFieldsAgainstShape}.
 */
export function checkDocOperationsAgainstShape(
  file: string,
  docsNode: ts.Expression | undefined,
  operationNames: OperationNames | undefined,
  warnings: ParseWarning[],
): void {
  if (
    docsNode === undefined ||
    operationNames === undefined ||
    !ts.isObjectLiteralExpression(docsNode)
  )
    return

  // One `documentData()` docs section, mapped to its singular label for the
  // warning message. Kept inside the function (not a module-level `const`) so
  // Stryker attributes mutants on these literals to the tests that reach here.
  const sections: readonly {
    readonly key: "getters" | "mutators" | "subscriptions"
    readonly singular: string
  }[] = [
    { key: "getters", singular: "getter" },
    { key: "mutators", singular: "mutator" },
    { key: "subscriptions", singular: "subscription" },
  ]

  for (const section of sections) {
    const sectionProp = docsNode.properties.find(
      (prop) =>
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === section.key,
    )
    if (sectionProp === undefined || !ts.isPropertyAssignment(sectionProp)) continue
    if (!ts.isObjectLiteralExpression(sectionProp.initializer)) continue

    const declaredNames = operationNames[section.key]
    for (const prop of sectionProp.initializer.properties) {
      if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue
      const name = ts.isIdentifier(prop.name) ? prop.name.text : undefined
      if (name !== undefined && !declaredNames.includes(name)) {
        warnings.push({
          file,
          message: `documentData() documents ${section.singular} "${name}", which does not exist on the capability's declared "${section.key}".`,
        })
      }
    }
  }
}

/** Discovers and links every `buildData()`/`createData()`/`documentData()` call across `files`, resolving field shapes and cross-file/aliased references. */
export async function linkCapabilityFiles(
  files: readonly string[],
  options: LinkOptions,
): Promise<LinkResult> {
  const { resolution: tsconfigPaths, warning: tsconfigWarning } = await loadTsconfigPaths(
    options.root,
    options.tsconfig,
    options.fs,
  )
  const context = new LinkContext({
    fs: options.fs,
    root: options.root,
    // An allow-list entry is only ever compared against real bare import
    // specifiers (`resolvePackageImport`); linking never eagerly resolves the
    // list, so a phantom extra entry here matches no specifier and is
    // unobservable. Threading `undefined` through instead only relocates this
    // same `?? []` into `resolve-import.ts` / `resolve-package-schema.ts`.
    // Stryker disable next-line ArrayDeclaration
    packages: options.packages ?? [],
    cache: new Map(),
    tsconfigPaths,
    aliasCache: createAliasResolutionCache(),
  })
  if (tsconfigWarning !== undefined) context.warnings.push(tsconfigWarning)

  const capabilities: DiscoveredCapability[] = []

  for (const file of files) {
    const parsed = await context.getParsed(file)
    const correlated = correlate(
      file,
      parsed.createDataCalls,
      parsed.documentDataCalls,
      context.warnings,
    )

    for (const call of parsed.createDataCalls) {
      if (call.exportName === undefined) continue
      const fieldsShape = await context.resolveFieldsShape(call.fieldsRef, file, parsed, 0)
      const docCall = correlated.get(call)
      let docs: DiscoveredCapability["docs"]
      if (docCall !== undefined) {
        checkDocFieldsAgainstShape(file, docCall.docsNode, fieldsShape, context.warnings)
        checkDocOperationsAgainstShape(
          file,
          docCall.docsNode,
          call.operationNames,
          context.warnings,
        )
        docs = extractCapabilityDocs(docCall.docsNode, call.exportName, file, context.warnings)
      }
      capabilities.push({
        file,
        exportName: call.exportName,
        kind: call.kind,
        fieldsShape,
        operationNames: call.operationNames,
        operationWrites: call.operationWrites,
        operationPresence: call.operationPresence,
        declarationPosition: call.declarationPosition,
        fieldPositions: call.fieldPositions,
        documentedBy: docCall !== undefined ? { file } : undefined,
        docs,
      })
    }
  }

  return { root: options.root, capabilities, warnings: context.warnings }
}
