/**
 * The types of the flow pass (`flow-scan.ts`): its options and results, and the shapes it keeps while it runs.
 */

import type TS from "typescript"
import type { DataFlowEndpoint } from "../core/document.js"
import type { FlowBoundaryKind, FlowHandling, FlowModelInput } from "../flow/flow-model.js"
import type { Env } from "./flow-scan-helpers.js"
import type { Val } from "./flow-values.js"
import type { CapabilityInventory, CapabilityNode } from "./inventory.js"
import type { ParseWarning } from "./parse.js"
import type { BuildFileSystem } from "./types.js"

/** A call whose arguments leave the program through a boundary. Matched by the root identifier and final member name of the callee (`res.status(200).json` matches `res.json`). */
export interface FlowSinkPattern {
  /** `root.method`, for example `res.json`. */
  readonly callee: string
  readonly boundary: { readonly kind: FlowBoundaryKind; readonly name: string }
  /** Declared data-safety state of what is sent here, when it is always the same. */
  readonly handling?: FlowHandling
}

/**
 * What a call to a function of a package does, as the project's author states it. A package's code is never read
 * (ADR 0002), so this is the only sound way past it: without a summary, a call that receives tracked data is an
 * explicit unknown. Whatever a summary lets the scan follow is `declared` evidence (ADR 0071), never `static`: it
 * is the author's word, not the scan's proof.
 *
 * `module` is the specifier as the code writes it (`lodash`, `lodash/fp`, `@acme/sdk`). `export` is the name it is
 * imported by (`pick`), `default` for a default import, or a dotted path to a member (`z.object`,
 * `default.get`). A member of a default import also matches the bare member name (`_.pick` matches `pick`), for
 * packages whose default export is the object of their named exports. The first summary that matches wins.
 */
export type FlowSummary = {
  readonly module: string
  readonly export: string
} & (
  | {
      /** The result holds everything the arguments hold. */
      readonly effect: "pass-through"
      /** Set when the result is a transformed or partial copy (`pick`, `omit`): its data is then inferred, not exact. */
      readonly approximate?: true
    }
  | {
      /** The result holds what the argument at `arg` holds, and nothing the others hold. */
      readonly effect: "returns-arg"
      readonly arg: number
      readonly approximate?: true
    }
  | {
      /** The arguments leave the program through `boundary`; the result holds nothing. */
      readonly effect: "sink"
      readonly boundary: FlowSinkPattern["boundary"]
      readonly handling?: FlowHandling
    }
  | {
      /** The result holds none of what the arguments hold (a hash, a redaction, a count): the call is not an unknown. */
      readonly effect: "sanitizes"
    }
  | {
      /** The call neither carries data nor sends it anywhere (a metric name, a validator that only throws). */
      readonly effect: "ignores"
    }
)

/** Options for `scanFlow`. */
export interface ScanFlowOptions {
  /** The capabilities whose field data is tracked. */
  readonly inventory: CapabilityInventory
  /** Absolute paths of every project file to analyze. */
  readonly files: readonly string[]
  /** The filesystem capability -- `./build` never imports `node:fs` (ADR 0058). */
  readonly fs: BuildFileSystem
  /** Directory import specifiers resolve against and paths are published relative to. */
  readonly root: string
  /** Explicit `tsconfig.json` path override, or `false` to disable alias resolution. */
  readonly tsconfig?: string | false | undefined
  /** Explicit cross-package allowlist, as for `scanDependencies`. */
  readonly packages?: readonly string[] | undefined
  /** Sinks to recognise instead of `DEFAULT_FLOW_SINKS`. */
  readonly sinks?: readonly FlowSinkPattern[] | undefined
  /** What calls into packages do, declared by the project. Each makes a call that would be an unknown a `declared` fact instead. */
  readonly summaries?: readonly FlowSummary[] | undefined
}

/** What `scanFlow` found. */
export interface ScanFlowResult {
  /** The facts, ready for `buildFlowModel`. */
  readonly input: FlowModelInput
  /** Resolution warnings, never blocking. */
  readonly warnings: readonly ParseWarning[]
}

/** The bounds the flow pass works within; `scanFlowWithin` takes smaller ones, so a test can reach each in moments. */
export interface ScanLimits {
  /** How deep calls are followed before the rest is reported as unknown. */
  readonly maxCallDepth: number
  /** How many evaluation steps the whole analysis may take before every later function is left unanalyzed. */
  readonly maxSteps: number
  /** How many files a re-export may be followed through, so a cycle of re-exports ends the search. */
  readonly maxExportHops: number
}

export type FunctionLike =
  | TS.ArrowFunction
  | TS.FunctionExpression
  | TS.FunctionDeclaration
  | TS.MethodDeclaration
  | TS.ConstructorDeclaration
  | TS.GetAccessorDeclaration
  | TS.SetAccessorDeclaration

export type ClassLike = TS.ClassDeclaration | TS.ClassExpression

/** What a function is for: a plain function, a class method (instance or static), or a class constructor. */
export type FunctionRole = "plain" | "method" | "static" | "constructor"

interface ExportRef {
  /** The file the export list is in -- where a name declared there is looked up. */
  readonly owner: FileInfo
  /** The file the name is re-exported from; `undefined` when it is declared in the exporting file. */
  readonly file: string | undefined
  readonly name: string
}

/** What an export name finally stands for. */
export type ExportTarget =
  | { readonly kind: "function"; readonly fn: FunctionInfo }
  | { readonly kind: "class"; readonly cls: ClassInfo }
  | { readonly kind: "value"; readonly file: FileInfo; readonly name: string }
  | { readonly kind: "namespace"; readonly file: string }

export interface FileInfo {
  readonly file: string
  readonly scope: string
  readonly sourceFile: TS.SourceFile
  readonly capabilityBindings: Map<string, string>
  readonly resolvedImports: Map<string, { readonly file: string; readonly name: string }>
  readonly namespaces: Map<string, string>
  /** Every imported name that is not (or not yet) a project module's: `module` as written and the name imported (`*` for a namespace). */
  readonly packageImports: Map<string, { readonly module: string; readonly name: string }>
  readonly topFunctions: Map<string, FunctionInfo>
  readonly topClasses: Map<string, ClassInfo>
  /** Names declared by module-level variables (and a default-exported expression): exports that stand for a value. */
  readonly valueNames: Set<string>
  /** Files this one re-exports wholesale (`export * from`), resolved. */
  readonly stars: string[]
  /** Literal specifiers of `import("...")` and `require("...")` calls in this file, resolved to the file they load. */
  readonly dynamicImports: Map<string, string>
  readonly exports: Map<string, ExportRef>
  readonly moduleStatements: TS.Statement[]
  moduleEnv: Env
  moduleStarted: boolean
}

export interface FunctionInfo {
  readonly key: string
  readonly file: FileInfo
  readonly name: string
  readonly node: FunctionLike | undefined
  readonly params: readonly TS.ParameterDeclaration[]
  /** The class a method, accessor or constructor belongs to. */
  cls: ClassInfo | undefined
  role: FunctionRole
  closureEnv: Env | undefined
  /** Set on a closure created by one particular evaluation of the code that makes it: it keeps the scope of that evaluation. */
  readonly instance: string | undefined
  /** Set on a function made by `bind`: what it fixes. */
  readonly bound: BoundArguments | undefined
}

/** What `fn.bind(thisArg, ...args)` fixed: the receiver (when given) and the leading arguments. */
interface BoundArguments {
  readonly thisVal: Val | undefined
  readonly args: readonly Val[]
}

export interface ClassInfo {
  readonly key: string
  readonly name: string
  readonly file: FileInfo
  readonly node: ClassLike
  /** The scope the class was declared in -- where its members and `extends` clause are resolved. */
  readonly env: Env
  /** Methods and accessors by `<kind>:<static|instance>:<name>` (see `memberKey`). */
  readonly members: Map<string, FunctionInfo>
  readonly fields: TS.PropertyDeclaration[]
  readonly statics: (TS.PropertyDeclaration | TS.ClassStaticBlockDeclaration)[]
  /** The declared constructor, or an implicit one that only initializes fields and hands its arguments to the superclass. */
  ctor: FunctionInfo
  /** Stands for the class's static initializers and blocks. */
  staticFn: FunctionInfo | undefined
  staticVals: Map<string, Val> | undefined
  /** The superclass once looked up: a project class, "opaque" when it is not one, "none" when there is no `extends`. */
  parent: ClassInfo | "opaque" | "none" | undefined
  /** Set on a class made by one evaluation of a class expression or declaration inside a function: its members share that evaluation's scope. */
  readonly evaluation: string | undefined
  /** Whether the decorators written on the class and its members have run. */
  decorated: boolean
  /** Members (by `memberKey`) a decorator the scan cannot follow may have replaced. */
  readonly opaque: Set<string>
  /** Set when a class decorator the scan cannot follow may have replaced the whole class. */
  opaqueClass: boolean
  /** What a class decorator that the scan follows returned in place of the class. */
  replacement: Val | undefined
}

interface OperationInfo {
  readonly kind: "getter" | "mutator" | "subscription"
  readonly endpoints: readonly DataFlowEndpoint[]
}

export interface CapInfo {
  readonly key: string
  readonly node: CapabilityNode
  readonly fieldIds: Map<string, string>
  readonly operations: Map<string, OperationInfo>
}

export interface Frame {
  readonly fn: FunctionInfo
  readonly env: Env
  readonly returns: Val[]
  readonly depth: number
  /** What `throw` statements (and the calls made here that throw) raised. */
  readonly thrown: Val[]
  /** What a generator yielded. */
  readonly yields: Val[]
  /** Names that had a property stored into them here: an object the caller may share. */
  readonly mutated: Set<string>
  /** Names bound to something that may be shared with another name (`const b = a`, a destructured part, a loop element). */
  readonly aliased: Set<string>
  /** True when nothing called this function: it is analyzed on its own, with empty arguments. */
  readonly root: boolean
  /** The scope of the function itself: `var` declarations land here even when written inside a block. */
  readonly fnEnv: Env
  /** Identifies this evaluation of the function by what it was called with: stable from one round of the analysis to the next. */
  readonly callKey: string
}

/** Where a call is made from: the frame making it and the node it is made at. */
export interface CallSite {
  readonly caller: Frame
  readonly site: TS.Node
  /** The argument expressions, so an object the callee filled in can be written back to the caller's variable. */
  readonly argExprs?: readonly TS.Expression[]
  /** The receiver expression of a method call, for the same reason. */
  readonly receiver?: TS.Expression
}

/** What a call to a function produced, remembered per distinct argument shape. */
export interface CallRecord {
  returnVal: Val
  /** Values of the arguments (by index; -1 is `this`) the callee stored properties into. */
  readonly outs: Map<number, Val>
  /** What the callee threw. */
  thrown: Val
}

/** How a function is entered beyond its arguments. */
export interface AnalyzeOptions {
  /** The receiver (`this`) of a method call. */
  readonly thisVal?: Val
  /** Set when the function is a constructor being run for an instance of this class. */
  readonly construct?: ClassInfo
  /** Set when a plain function is run as a constructor (`new Foo()` with a function `Foo`): `this` is the instance it returns. */
  readonly constructs?: true
}

/** A value some function resolved or rejected a promise with. */
export interface Settlement {
  readonly from: string
  readonly val: Val
}

/** Everything a promise was settled with so far. `read` is set once anything awaited it: a later settlement then asks for another round. */
export interface PromiseSlot {
  readonly resolved: Map<string, Settlement>
  readonly rejected: Map<string, Settlement>
  read: boolean
}

/** What `next(x)` handed one evaluation of a generator. */
export interface SentSlot {
  readonly values: Map<string, Val>
}

export interface EntryRecord {
  readonly fn: FunctionInfo
  readonly origin: string
  readonly entryPath: readonly string[]
  readonly touched: (readonly string[])[]
}

export type SinkSpec =
  | { readonly kind: "return" }
  | { readonly kind: "arg"; readonly callee: FunctionInfo; readonly index: number }
  | {
      readonly kind: "boundary"
      readonly id: string
      readonly handling?: FlowHandling | undefined
      /** Set when the boundary was declared by a summary: the crossing is the author's word. */
      readonly declared?: true
    }
  | {
      readonly kind: "operation"
      readonly cap: CapInfo
      readonly operation: string
      readonly info: OperationInfo
    }

/** Reads the string an expression is for sure: a literal, or a `const` bound to one. */
export type LiteralReader = (expression: TS.Expression) => string | undefined

/** What a method call is made through: a receiver expression and the name of the method (`a.b`, or `a["b"]` with a literal key). */
export interface MemberCallee {
  readonly expression: TS.Expression
  readonly name: { readonly text: string }
}
