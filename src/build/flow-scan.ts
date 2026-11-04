/**
 * The flow pass (ADR 0070, ADR 0071): a syntactic, import-resolved,
 * context-sensitive data-flow analysis that follows capability field data
 * through local variables, destructuring, spreads, object and array
 * literals, function parameters and return values, closures, callbacks and
 * known sinks, and produces the input for `buildFlowModel`.
 *
 * It evaluates expressions to abstract values (`flow-values.ts`): bags of
 * (origin field, path) atoms with known properties. Each function is
 * evaluated once per distinct argument shape (memoized), starting from every
 * function with empty arguments (so direct reads are found) and from each
 * call with the arguments' real values (so interprocedural flow is found).
 * Edges carry the origin field, so a helper shared by two fields never makes
 * one appear to reach the other's destinations.
 *
 * Never imports or evaluates the code it reads (ADR 0002); the compiler API
 * parses text only. Anything it cannot follow -- a call it cannot resolve
 * that receives tracked data, a computed key on tracked data, a call chain
 * deeper than its limit -- becomes an explicit `FlowUnknown` with a
 * `file:line:column` citation, and the data is assumed to pass through
 * approximately (an `inferred` edge). It never guesses silently (ADR 0071).
 *
 * Operation bodies (`createData`/`buildData`/`documentData` arguments) stay
 * opaque (AGENTS.md invariant 6).
 */

import type TS from "typescript"
import type {
  FlowEdgeInput,
  FlowEdgeTagInput,
  FlowNodeInput,
  FlowUnknownInput,
  FlowUnknownReason,
} from "../flow/flow-model.js"
import type { ScanTarget } from "./dependency-graph.js"
import { HeapCells } from "./flow-heap.js"
import { methods as builtinsMethods } from "./flow-scan-builtins.js"
import { methods as callsMethods } from "./flow-scan-calls.js"
import { methods as classValuesMethods } from "./flow-scan-class-values.js"
import { methods as evaluationMethods } from "./flow-scan-evaluation.js"
import { methods as expressionsMethods } from "./flow-scan-expressions.js"
import {
  arrayOf,
  collectionBase,
  decoratorsOf,
  defaultFlowSinks,
  defaultScanLimits,
  Env,
  externalKey,
  externalMember,
  externalVal,
  holdsFields,
  holdsPromise,
  isArithmeticOperator,
  isAsyncFunction,
  isCompoundAssignment,
  isGeneratorFunction,
  isLogicalOperator,
  isReferenceExpression,
  isTransparentWrapper,
  keyOf,
  linkKey,
  literalPairs,
  loadedSpecifier,
  memberCallee,
  memberChain,
  memberKey,
  memberName,
  prototypeMethod,
  rejectedKey,
  setAlgebra,
  settled,
  unwrap,
  withBound,
} from "./flow-scan-helpers.js"
import { methods as methodCallsMethods } from "./flow-scan-method-calls.js"
import { methods as reportsMethods } from "./flow-scan-reports.js"
import { methods as setupMethods } from "./flow-scan-setup.js"
import { methods as statementsMethods } from "./flow-scan-statements.js"
import type {
  CallRecord,
  CapInfo,
  ClassInfo,
  EntryRecord,
  FileInfo,
  FlowSinkPattern,
  FlowSummary,
  FunctionInfo,
  PromiseSlot,
  ScanFlowOptions,
  ScanFlowResult,
  ScanLimits,
  SentSlot,
} from "./flow-scan-types.js"
import type { Atom } from "./flow-values.js"
import { buildScanTargets } from "./generate-usage.js"
import { isGeneratedFile } from "./generated-banner.js"
import type { ParseWarning } from "./parse.js"
import type { ImportResolutionContext } from "./resolution/resolve-import.js"
import {
  createAliasResolutionCache,
  loadTsconfigPaths,
} from "./resolution/resolve-tsconfig-paths.js"

export { DEFAULT_FLOW_SINKS, defaultScanLimits, Env, isBuiltinExact } from "./flow-scan-helpers.js"
export type {
  FlowSinkPattern,
  FlowSummary,
  ScanFlowOptions,
  ScanFlowResult,
  ScanLimits,
} from "./flow-scan-types.js"

type Methods = ReturnType<typeof setupMethods> &
  ReturnType<typeof evaluationMethods> &
  ReturnType<typeof statementsMethods> &
  ReturnType<typeof classValuesMethods> &
  ReturnType<typeof expressionsMethods> &
  ReturnType<typeof callsMethods> &
  ReturnType<typeof methodCallsMethods> &
  ReturnType<typeof reportsMethods> &
  ReturnType<typeof builtinsMethods>

// The methods live in the files imported above, so that no file grows past what a mutation run can cover quickly.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type -- the interface gives the class the methods the files above add to its prototype.
export interface FlowScan extends Methods {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- see the interface above.
export class FlowScan {
  readonly nodes = new Map<string, FlowNodeInput>()

  readonly edges = new Map<string, FlowEdgeInput>()

  readonly unknowns = new Map<
    string,
    FlowUnknownInput & { readonly data: readonly { origin: string; path: readonly string[] }[] }
  >()

  readonly warnings: ParseWarning[] = []

  readonly functions = new Map<string | undefined, FunctionInfo>()

  readonly nestedByNode = new Map<TS.Node, FunctionInfo>()

  /** Closures by the token a value carries: one per evaluation of the expression that makes them, each with its own scope. */
  readonly instances = new Map<string, FunctionInfo>()

  readonly instanceTokens = new WeakMap<Env, Map<string, string>>()

  /** The round of the analysis (0 before the first) that made each closure or method of a class a call made, when no function analyzed on its own made it. */
  readonly madeByCalls = new Map<string, number>()

  round = 0

  /** What `globalThis`, `window` and undeclared names refer to: shared by every file. */
  readonly globalEnv = new Env(undefined, undefined, true)

  readonly classes = new Map<string | undefined, ClassInfo>()

  /** Keys of the functions that were created as closures (arrows, function expressions, object methods). */
  readonly closureKeys = new Set<string>()

  /** Keys of the functions some analyzed code called. */
  readonly calledKeys = new Set<string>()

  /** What each closure returns when run on its own, for closures nothing calls. */
  readonly closureReturns = new Map<string, readonly Atom[]>()

  /** Unresolved calls through a parameter, met while a function was analyzed on its own: reported only if nothing analyzed ever calls it with real arguments. */
  readonly provisional = new Map<
    string,
    {
      readonly fn: FunctionInfo
      readonly node: TS.Node
      readonly atoms: readonly Atom[]
      readonly reason: FlowUnknownReason
      readonly detail: string
    }[]
  >()

  /** Set when a write changed a scope other than the one running, so earlier-analyzed functions may see more. */
  // Stryker disable next-line BooleanLiteral: equivalent -- `run` clears the flag at the start of every round, before any function is analyzed.
  dirty = false

  readonly caps = new Map<string, CapInfo>()

  readonly shapeByOrigin = new Map<string, unknown>()

  readonly files = new Map<string | undefined, FileInfo>()

  readonly memo = new Map<string, CallRecord>()

  readonly entered = new Map<string, EntryRecord>()

  readonly sinks: readonly FlowSinkPattern[]

  readonly queue: FunctionInfo[] = []

  readonly declaredBoundaries = new Map<string, string>()

  /** What the code that settles a promise handed it, by the promise's id: read back wherever the promise is awaited. */
  readonly promiseSlots = new Map<string, PromiseSlot>()

  /** The generators the analysis has run, by evaluation, and what was sent into them with `next(x)`. */
  readonly generators = new Map<string, FunctionInfo>()

  readonly sent = new Map<string, SentSlot>()

  /** The shared contents of the objects made so far (`flow-heap.ts`): a store through one name is seen through every alias. */
  readonly heap = new HeapCells()

  /** What the scan saw happen to the data of some edges at some places: copies and unused derivations (ADR 0075). */
  readonly edgeTags: FlowEdgeTagInput[] = []

  /** The allocation sites of the values a recognised copy made: copying one of them again changes nothing. */
  readonly copySites = new Set<string>()

  steps = 0

  exhausted = false

  constructor(
    readonly root: string,
    sinks: readonly FlowSinkPattern[],
    readonly summaries: readonly FlowSummary[],
    readonly limits: ScanLimits,
  ) {
    this.sinks = sinks
    // Built here, not when the module loads, so that a mutant in a method is run by the tests that use it.
    Object.assign(
      this,
      setupMethods(),
      evaluationMethods(),
      statementsMethods(),
      classValuesMethods(),
      expressionsMethods(),
      callsMethods(),
      methodCallsMethods(),
      reportsMethods(),
      builtinsMethods(),
    )
  }
}

/** Runs the flow pass over `options.files` for every capability in `options.inventory`. */
export async function scanFlow(options: ScanFlowOptions): Promise<ScanFlowResult> {
  return scanFlowWithin(options, defaultScanLimits())
}

/** `scanFlow` within the given bounds. @internal Exported so a test can reach each bound with a small project. */
export async function scanFlowWithin(
  options: ScanFlowOptions,
  limits: ScanLimits,
): Promise<ScanFlowResult> {
  const { resolution: tsconfigPaths, warning: tsconfigWarning } = await loadTsconfigPaths(
    options.root,
    options.tsconfig,
    options.fs,
  )
  const context: ImportResolutionContext = {
    fs: options.fs,
    root: options.root,
    packages: options.packages ?? [],
    cache: new Map(),
    tsconfigPaths,
    aliasCache: createAliasResolutionCache(),
  }
  const targets = buildScanTargets(options.inventory, options.root)
  const targetsByName = new Map<string, ScanTarget[]>()
  for (const target of targets)
    targetsByName.set(target.exportName, [...(targetsByName.get(target.exportName) ?? []), target])

  const scan = new FlowScan(
    options.root,
    options.sinks ?? defaultFlowSinks(),
    // Stryker disable next-line ArrayDeclaration: equivalent -- an entry that is not a summary names no module, so it matches no call.
    options.summaries ?? [],
    limits,
  )
  scan.registerCapabilities(options.inventory)
  if (tsconfigWarning !== undefined) scan.warnings.push(tsconfigWarning)

  for (const file of [...options.files].sort()) {
    let text: string
    try {
      text = await options.fs.readFile(file, "utf8")
    } catch {
      continue
    }
    if (isGeneratedFile(text)) continue
    await scan.indexFile(file, text, context, targets, targetsByName)
  }

  scan.run()
  return { input: scan.finish(), warnings: scan.warnings }
}

/** The small rules of the scan, exported so a test can reach each one without writing a project around it. @internal */
export function scanHelpers() {
  return {
    arrayOf,
    collectionBase,
    decoratorsOf,
    externalKey,
    externalMember,
    externalVal,
    holdsFields,
    holdsPromise,
    isArithmeticOperator,
    isAsyncFunction,
    isCompoundAssignment,
    isGeneratorFunction,
    isLogicalOperator,
    isReferenceExpression,
    isTransparentWrapper,
    keyOf,
    linkKey,
    literalPairs,
    loadedSpecifier,
    memberCallee,
    memberChain,
    memberKey,
    memberName,
    prototypeMethod,
    rejectedKey,
    setAlgebra,
    settled,
    unwrap,
    withBound,
  }
}
