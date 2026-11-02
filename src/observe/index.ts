/**
 * `data-cap`'s runtime-observation entry point (`data-cap/observe`, ADR 0072).
 *
 * Records which fields were seen crossing which boundary, into a
 * caller-supplied sink. Deliberately tiny and isomorphic: no `node:fs`, no
 * `typescript`, no build module, no timers, no global hooks -- it never opens
 * a file, socket or connection of its own. An event carries a scope id, a
 * boundary, and a field *name*; it never carries a field value, and any key
 * outside that shape is dropped on the way in.
 *
 * `observeValue` walks any JSON-like value and records its field paths;
 * `observeSink` and `instrumentBoundary` hook it onto `res.json`,
 * `logger.info`, `db.insert` or a `fetch` wrapper without a framework (the
 * only patching is the explicit `instrumentBoundary` call, undone by the
 * function it returns). In a test setup file (vitest `setupFiles`, jest
 * `setupFilesAfterEach`, node:test `--import`):
 *
 *     const memory = createMemorySink()
 *     instrumentBoundary(res, "json", { scope: () => currentTestName(), capability: "userData.user",
 *       boundary: { kind: "client-response", name: "http-response" }, clock: () => Date.now() }, memory.sink)
 *     // after the run: fs.writeFileSync("observations.json", JSON.stringify(memory.events()))
 *
 * then `data-cap --observations observations.json`. Timestamps come only from
 * the caller's `clock`; the recorder never reads one.
 *
 * Observations reach the Evidence Model only through the build
 * (`buildObservationModel`), which joins them to static flow facts. Observed
 * behavior is evidence of what happened in the scopes that ran; it does not
 * prove that every static path is safe.
 */

import type { FlowBoundaryKind, FlowHandling } from "../flow/flow-model.js"

/** What kind of boundary was crossed and its stable name (matches a `boundary` node of the Flow Model). */
export interface ObservedBoundary {
  readonly kind: FlowBoundaryKind
  readonly name: string
}

/** One observation: a field name was seen at a boundary during one scope. Never a value. */
export interface ObservationEvent {
  /** Caller-supplied id of the execution or test the event was seen in. */
  readonly scope: string
  readonly boundary: ObservedBoundary
  /** Capability-qualified dotted field path, for example `userData.user.email` -- the same naming the static Flow Model uses for field nodes. */
  readonly field: string
  /** Declared handling of the value at this crossing, when the caller knows it. */
  readonly handling?: FlowHandling
  /**
   * When the crossing was seen: epoch milliseconds or an ISO 8601 string. Present only when the caller supplied a
   * `clock` (the recorder never reads one itself, so it stays deterministic); the Observation Model keeps first/last seen.
   */
  readonly at?: string | number
}

/** Why the walker did not record part of a value. */
export type ObservationSkipReason = "dotted-key" | "max-depth" | "max-nodes" | "cycle"

/**
 * Evidence the recorder knowingly did not capture: below `field` (a capability-qualified path, or the capability
 * itself for the root) something was left out, for the stated reason. Names only, never a value.
 */
export interface ObservationSkip {
  readonly scope: string
  readonly boundary: ObservedBoundary
  readonly field: string
  readonly reason: ObservationSkipReason
}

/** Where events go. The package never provides one that does I/O. */
export interface ObservationSink {
  record(event: ObservationEvent): void
  /** Optional channel for what the walker left out; pass `skips()` of the memory sink to `buildObservationModel`. */
  skip?(info: ObservationSkip): void
}

/** What a caller passes to `observeBoundary`. */
export interface ObserveBoundaryInput {
  readonly scope: string
  readonly boundary: ObservedBoundary
  /** The capability's export name, used to qualify each field path. */
  readonly capability: string
  /** Field paths (key names only) observed at the boundary. */
  readonly fields: readonly (readonly string[])[]
  readonly handling?: FlowHandling
  /** Caller-supplied time source (epoch ms), read once per call. The recorder never defaults to `Date.now()`. */
  readonly clock?: () => number
}

/** The one place a capability-qualified field name is formed. */
export function fieldPathName(capability: string, path: readonly string[]): string {
  return [capability, ...path].join(".")
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isNamedBoundary(boundary: unknown): boolean {
  return (
    typeof boundary === "object" &&
    boundary !== null &&
    isName((boundary as { name?: unknown }).name)
  )
}

function isPath(path: unknown): path is readonly string[] {
  return Array.isArray(path) && path.length > 0 && path.every(isName)
}

// Stryker disable all: equivalent -- an absent clock, a clock that throws and the catch's own `return` all give `undefined` here: calling `undefined` throws, and the catch turns that into the same `undefined`.
function stamp(clock: (() => number) | undefined): number | undefined {
  if (clock === undefined) return undefined
  try {
    const now = clock()
    return Number.isFinite(now) ? now : undefined
  } catch {
    return undefined
  }
}
// Stryker restore all

/**
 * Records one event per valid field path and returns how many it recorded.
 * Never throws: invalid input records nothing, and a throwing sink stops
 * recording without propagating (observation must not break the observed
 * program).
 */
export function observeBoundary(sink: ObservationSink, input: ObserveBoundaryInput): number {
  if (!isName(input.scope) || !isName(input.capability) || !isNamedBoundary(input.boundary)) {
    return 0
  }
  const at = stamp(input.clock)
  let recorded = 0
  for (const path of input.fields) {
    if (!isPath(path)) continue
    const event: ObservationEvent = {
      scope: input.scope,
      boundary: { kind: input.boundary.kind, name: input.boundary.name },
      field: fieldPathName(input.capability, path),
      ...(input.handling === undefined ? {} : { handling: input.handling }),
      ...(at === undefined ? {} : { at }),
    }
    try {
      sink.record(event)
    } catch {
      return recorded
    }
    recorded += 1
  }
  return recorded
}

/** An in-memory sink -- the only one this package provides. */
export function createMemorySink(): {
  readonly sink: ObservationSink
  events(): readonly ObservationEvent[]
  skips(): readonly ObservationSkip[]
} {
  const events: ObservationEvent[] = []
  const skips: ObservationSkip[] = []
  return {
    sink: {
      record(event) {
        events.push(event)
      },
      skip(info) {
        skips.push(info)
      },
    },
    events: () => [...events],
    skips: () => [...skips],
  }
}

/** What `observeValue` and `observeSink` need besides the value; `scope` may be a function evaluated at each call (for example the current test name). */
export interface ObserveValueContext {
  readonly scope: string | (() => string)
  readonly boundary: ObservedBoundary
  /** The capability's export name, used to qualify each field path. */
  readonly capability: string
  readonly handling?: FlowHandling
  readonly clock?: () => number
}

/** Bounds and switches for the walker. */
export interface ObserveValueOptions {
  /** Deepest nesting recorded (default 8); anything deeper is not walked and not recorded. */
  readonly maxDepth?: number
  /** Most values visited per call (default 1000). */
  readonly maxNodes?: number
  /** Walk `Map` values and `Set` members under the element marker `[]` (default off: they are leaves). Map keys are never read. */
  readonly collections?: boolean
  /**
   * Called once per distinct (reason, path) when the walker leaves something out, with the path (dotted, relative to
   * the capability, `""` for the root) below which evidence is missing. Names only. The same information goes to
   * `sink.skip` when the sink has one. A throwing callback is ignored.
   */
  readonly onSkip?: (reason: ObservationSkipReason, path: string) => void
}

/** Which call results `instrumentBoundary` observes. */
export type InstrumentObserve = "args" | "result" | "both"

/** `observeValue` context plus the walker options, for `instrumentBoundary` and `observeSink`. */
export interface InstrumentContext extends ObserveValueContext {
  readonly options?: ObserveValueOptions
  /** What to observe on each call: the first argument (default), the returned value, or both. */
  readonly observe?: InstrumentObserve
}

interface WalkState {
  readonly paths: Map<string, string[]>
  readonly skips: Map<string, { readonly reason: ObservationSkipReason; readonly path: string }>
  readonly maxDepth: number
  readonly maxNodes: number
  readonly collections: boolean
  visited: number
}

function isPathSegment(key: string): boolean {
  return key.length > 0 && !key.includes(".")
}

function noteSkip(state: WalkState, reason: ObservationSkipReason, path: readonly string[]): void {
  const joined = path.join(".")
  state.skips.set(`${reason}|${joined}`, { reason, path: joined })
}

/** The children a value contributes: own enumerable data properties (never getters), or the element marker for collections. */
function childrenOf(
  state: WalkState,
  value: unknown,
  path: readonly string[],
): [string, unknown][] {
  const { collections } = state
  if (Array.isArray(value)) return value.map((element) => ["[]", element])
  if (collections && value instanceof Map) return [...value.values()].map((entry) => ["[]", entry])
  if (collections && value instanceof Set) return [...value].map((entry) => ["[]", entry])
  if (Object.prototype.toString.call(value) !== "[object Object]") return []
  const children: [string, unknown][] = []
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !("value" in descriptor)) continue
    if (isPathSegment(key)) children.push([key, descriptor.value])
    else noteSkip(state, "dotted-key", path)
  }
  return children
}

function walkChildren(
  state: WalkState,
  value: unknown,
  path: readonly string[],
  depth: number,
  ancestors: Set<unknown>,
): void {
  for (const [key, child] of childrenOf(state, value, path)) {
    if (state.visited >= state.maxNodes) {
      noteSkip(state, "max-nodes", path)
      return
    }
    walkValue(state, child, [...path, key], depth + 1, ancestors)
  }
}

function walkValue(
  state: WalkState,
  value: unknown,
  path: string[],
  depth: number,
  ancestors: Set<unknown>,
): void {
  const type = typeof value
  if (type === "function" || type === "symbol" || value === undefined) return
  if (depth > state.maxDepth) {
    noteSkip(state, "max-depth", path.slice(0, -1))
    return
  }
  state.visited += 1
  // Stryker disable all: unreachable -- `walkChildren` stops at `maxNodes` before it walks another node, so `visited` never passes it; the bound only turns a walk that lost that stop into a failure the caller's catch swallows, instead of a walk through an enormous value.
  /* v8 ignore next 3 */
  if (state.visited > state.maxNodes) {
    throw new Error("the walk passed its node bound")
  }
  // Stryker restore all
  state.paths.set(path.join("."), path)
  if (ancestors.has(value)) {
    noteSkip(state, "cycle", path)
    return
  }
  ancestors.add(value)
  walkChildren(state, value, path, depth, ancestors)
  ancestors.delete(value)
}

/** Tells `onSkip` and `sink.skip` what was left out; neither can break the observed program. */
function reportSkips(
  sink: ObservationSink,
  context: ObserveValueContext & { readonly scope: string },
  state: WalkState,
  onSkip: ObserveValueOptions["onSkip"],
): void {
  if (!isName(context.scope) || !isName(context.capability) || !isNamedBoundary(context.boundary))
    return
  for (const { reason, path } of state.skips.values()) {
    try {
      // Stryker disable next-line OptionalChaining: equivalent -- calling an absent `onSkip` throws, and the catch below ignores a throwing callback.
      onSkip?.(reason, path)
    } catch {
      // A throwing callback is ignored.
    }
    try {
      // Stryker disable next-line OptionalChaining: equivalent -- calling an absent `sink.skip` throws, and the catch below ignores a throwing sink.
      sink.skip?.({
        scope: context.scope,
        boundary: { kind: context.boundary.kind, name: context.boundary.name },
        field: path === "" ? context.capability : `${context.capability}.${path}`,
        reason,
      })
    } catch {
      // A throwing sink is ignored.
    }
  }
}

/**
 * Walks any JSON-like `value` and records the field path of every object and leaf it contains -- names and paths
 * only, never a value -- through `observeBoundary`, then returns `value` itself so it can wrap a call
 * (`res.json(observeValue(sink, ctx, body))`). Array elements (and, with `collections`, Map values and Set members)
 * collapse into the Flow Model's element marker `[]`. Functions, symbols and `undefined` are ignored; getters are
 * never run; cycles are not re-entered; depth and visited-value count are bounded. The root itself is not a field
 * (a root primitive records nothing); keys that are empty or contain a dot cannot be path segments (the Flow Model names a path by joining segments with a
 * dot, so there is no reversible spelling) and are skipped -- but never silently: every skip (`dotted-key`, `max-depth`,
 * `max-nodes`, `cycle`) is reported to `options.onSkip` and to `sink.skip`. Never throws.
 */
export function observeValue<T>(
  sink: ObservationSink,
  context: ObserveValueContext,
  value: T,
  options: ObserveValueOptions = {},
): T {
  try {
    const state: WalkState = {
      paths: new Map(),
      skips: new Map(),
      maxDepth: options.maxDepth ?? 8,
      maxNodes: options.maxNodes ?? 1000,
      collections: options.collections ?? false,
      visited: 0,
    }
    walkChildren(state, value, [], 0, new Set([value]))
    const scope = typeof context.scope === "function" ? context.scope() : context.scope
    observeBoundary(sink, { ...context, scope, fields: [...state.paths.values()] })
    reportSkips(sink, { ...context, scope }, state, options.onSkip)
  } catch {
    // Observation must never break the observed program.
  }
  return value
}

/** The part of a web `Response` or `Request` that `observeResponse` uses; both satisfy it. */
export interface BodyReadable {
  clone(): BodyReadable
  json(): Promise<unknown>
}

function isBodyReadable(value: unknown): value is BodyReadable {
  // Stryker disable next-line ConditionalExpression,LogicalOperator,BooleanLiteral: equivalent for this line -- a primitive or `null` is either refused here or makes `Reflect.get` throw, which the caller's catch swallows, and observing one records nothing either way.
  if (typeof value !== "object" || value === null) return false
  return (
    typeof Reflect.get(value, "clone") === "function" &&
    typeof Reflect.get(value, "json") === "function"
  )
}

/**
 * Observes the JSON body of a web `Response` or `Request` without consuming the caller's: it clones, parses the
 * clone asynchronously and observes the parsed value (`observeValue`: names and paths only). Returns `response`
 * itself, untouched, so it can wrap a call (`const res = observeResponse(sink, ctx, await fetch(url))`). Scope and
 * the caller's `clock` are read when this is called, not when the body is parsed. A body that is not JSON, was
 * already used, or cannot be cloned records nothing; never throws and does no I/O beyond the clone. Cloning a
 * streaming body buffers it for the second reader, so avoid it on unbounded streams. Web-standard classes only.
 */
export function observeResponse<T extends BodyReadable>(
  sink: ObservationSink,
  context: ObserveValueContext,
  response: T,
  options: ObserveValueOptions = {},
): T {
  try {
    const scope = typeof context.scope === "function" ? context.scope() : context.scope
    const at = stamp(context.clock)
    const pinned: ObserveValueContext = { ...context, scope, clock: () => at ?? Number.NaN }
    void Promise.resolve(response.clone().json()).then(
      (body) => {
        observeValue(sink, pinned, body, options)
      },
      () => undefined,
    )
  } catch {
    // Observation must never break the observed program.
  }
  return response
}

/** Observes whatever a call returned: a response by its clone, anything else by `observeValue`. */
function observeAny(sink: ObservationSink, context: InstrumentContext, value: unknown): void {
  if (isBodyReadable(value)) observeResponse(sink, context, value, context.options)
  else observeValue(sink, context, value, context.options)
}

/**
 * Observes a call's result at the time it is returned. Only a native `Promise` is waited for (through a side branch
 * that leaves the returned promise untouched): a non-native thenable such as a query builder may run its query on
 * `then`, so it is never touched.
 */
function observeResult(sink: ObservationSink, context: InstrumentContext, result: unknown): void {
  try {
    const scope = typeof context.scope === "function" ? context.scope() : context.scope
    const pinned: InstrumentContext = { ...context, scope }
    if (result instanceof Promise) {
      void result.then(
        (resolved: unknown) => {
          observeAny(sink, pinned, resolved)
        },
        () => undefined,
      )
    } else observeAny(sink, pinned, result)
  } catch {
    // Observation must never break the observed program.
  }
}

/** A one-argument pass-through that observes its argument and returns it: `const tap = observeSink(sink, ctx); res.json(tap(body))`. */
export function observeSink(sink: ObservationSink, context: InstrumentContext): <T>(value: T) => T {
  return (value) => observeValue(sink, context, value, context.options)
}

/**
 * Wraps `target[method]` so its first argument (`observe: "args"`, the default), its result (`"result"`: a returned
 * `Response` is observed by clone, a native promise by its resolved value) or both are observed (`observeValue`) on
 * every call, which then goes through with its `this`, arguments and result untouched. Returns a restore function (a no-op if someone else has since
 * replaced the method). Throws a `TypeError` at set-up when `target[method]` is not a function.
 */
export function instrumentBoundary(
  target: object,
  method: string,
  context: InstrumentContext,
  sink: ObservationSink,
): () => void {
  const original: unknown = Reflect.get(target, method)
  if (typeof original !== "function") {
    throw new TypeError(`instrumentBoundary: target.${method} is not a function`)
  }
  const ownedBefore = Object.hasOwn(target, method)
  const mode = context.observe ?? "args"
  const wrapper = function (this: unknown, ...args: unknown[]): unknown {
    if (mode !== "result") observeValue(sink, context, args[0], context.options)
    const result: unknown = Reflect.apply(original, this, args)
    if (mode !== "args") observeResult(sink, context, result)
    return result
  }
  Reflect.set(target, method, wrapper)
  return () => {
    if (Reflect.get(target, method) !== wrapper) return
    if (ownedBefore) Reflect.set(target, method, original)
    else Reflect.deleteProperty(target, method)
  }
}
