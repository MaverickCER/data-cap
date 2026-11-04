/**
 * The evaluation driver: entries, uses and sinks, the rounds, and the analysis of one function call. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import type { FlowStatus } from "../flow/flow-model.js"
import {
  arrayOf,
  Env,
  isAsyncFunction,
  isGeneratorFunction,
  memberChain,
  rejectedKey,
  withBound,
} from "./flow-scan-helpers.js"
import type {
  AnalyzeOptions,
  CallRecord,
  CallSite,
  CapInfo,
  FileInfo,
  FlowSinkPattern,
  Frame,
  FunctionInfo,
  SinkSpec,
} from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Atom, Val } from "./flow-values.js"
import {
  approximate,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  GENERATOR_HANDLE,
  handleVal,
  mergeVals,
  signatureOf,
  withAlloc,
  withEntry,
} from "./flow-values.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    // ----- entries, uses, sinks ------------------------------------------------------------------

    entryKey(this: FlowScan, fnKey: string, origin: string, entryPath: readonly string[]): string {
      return JSON.stringify([fnKey, origin, entryPath])
    },

    noteEntry(this: FlowScan, fn: FunctionInfo, val: Val): void {
      for (const atom of flattenAtoms(val)) {
        const key = this.entryKey(fn.key, atom.origin, atom.entryPath)
        if (!this.entered.has(key))
          this.entered.set(key, {
            fn,
            origin: atom.origin,
            entryPath: atom.entryPath,
            touched: [],
          })
      }
    },

    /** Records that `fn` accessed this data (so it is not "discarded"), and that it reads it -- even if it never goes anywhere. */
    touch(this: FlowScan, fn: FunctionInfo, val: Val, site: TS.Node): void {
      for (const atom of flattenAtoms(val)) {
        this.entered
          .get(this.entryKey(fn.key, atom.origin, atom.entryPath))
          ?.touched.push(atom.path)
        this.emitEntry(fn, atom, site)
      }
    },

    statusOf(this: FlowScan, atom: Atom): FlowStatus {
      if (atom.declared === true) return "declared"
      return atom.approx ? "inferred" : "static"
    },

    /** Records that `fn` received this data, and returns the id of the edge that says so. */
    emitEntry(this: FlowScan, fn: FunctionInfo, atom: Atom, node: TS.Node): string | undefined {
      const to = this.fnNode(fn)
      const source = this.location(fn, node)
      const base = { to, status: this.statusOf(atom), path: atom.path, origin: atom.origin, source }
      const { entry } = atom
      switch (entry.kind) {
        case "read":
          // The read itself is a fact the scan saw, whatever a summary later says about where the data went.
          return this.addEdge({
            kind: "reads",
            from: atom.origin,
            ...base,
            status: atom.approx ? "inferred" : "static",
          })
        case "param": {
          const owner = this.functions.get(entry.fn)
          // Stryker disable next-line ConditionalExpression: equivalent -- an atom's function key was registered when the atom was made, so the owner is always found.
          return owner === undefined
            ? undefined
            : this.addEdge({ kind: "reads", from: this.paramNode(owner, entry.index), ...base })
        }
        case "return": {
          const owner = this.functions.get(entry.from)
          // Stryker disable next-line ConditionalExpression: equivalent -- an atom's function key was registered when the atom was made, so the owner is always found.
          return owner === undefined
            ? undefined
            : this.addEdge({ kind: "passes", from: this.returnNode(owner), ...base })
        }
      }
    },

    sink(this: FlowScan, frame: Frame, val: Val, spec: SinkSpec, node: TS.Node): void {
      const fn = frame.fn
      // Data handed to a boundary or an operation leaves the program: a whole `fields` object takes every field with it.
      const sent =
        spec.kind === "boundary" || spec.kind === "operation"
          ? this.materialize(frame, val, node)
          : val
      for (const atom of flattenAtoms(sent)) {
        this.emitEntry(fn, atom, node)
        this.entered
          .get(this.entryKey(fn.key, atom.origin, atom.entryPath))
          ?.touched.push(atom.path)
        const edgeBase = {
          from: this.fnNode(fn),
          status:
            spec.kind === "boundary" && spec.declared === true ? "declared" : this.statusOf(atom),
          path: atom.path,
          origin: atom.origin,
          source: this.location(fn, node),
        }
        switch (spec.kind) {
          case "return":
            this.addEdge({ kind: "returns", ...edgeBase, to: this.returnNode(fn) })
            break
          case "arg":
            this.addEdge({
              kind: "passes",
              ...edgeBase,
              to: this.paramNode(spec.callee, spec.index),
            })
            break
          case "boundary":
            this.addEdge({
              kind: "side-effect",
              ...edgeBase,
              to: spec.id,
              ...(spec.handling === undefined ? {} : { handling: spec.handling }),
            })
            break
          case "operation": {
            const operationId = this.operationNode(spec.cap, spec.operation)
            this.addEdge({ kind: "passes", ...edgeBase, to: operationId })
            if (spec.info.kind === "mutator") {
              for (const endpoint of spec.info.endpoints.filter(
                (candidate) => candidate.direction === "output",
              )) {
                this.addEdge({
                  kind: "crosses-boundary",
                  from: operationId,
                  to: this.declaredBoundary(endpoint),
                  status: "declared",
                  path: atom.path,
                  origin: atom.origin,
                  ...(endpoint.handling === undefined ? {} : { handling: endpoint.handling }),
                })
              }
            }
            break
          }
        }
      }
    },

    operationNode(this: FlowScan, cap: CapInfo, operation: string): string {
      return this.addNode({
        kind: "function",
        scope: cap.node.file,
        name: `${cap.node.exportName}.${operation}`,
        status: "static",
      })
    },

    codeBoundary(this: FlowScan, pattern: FlowSinkPattern["boundary"]): string {
      return this.addNode({
        kind: "boundary",
        scope: "boundary:code",
        name: pattern.name,
        status: "static",
        boundaryKind: pattern.kind,
      })
    },

    // ----- evaluation driver ---------------------------------------------------------------------

    step(this: FlowScan): boolean {
      this.steps += 1
      if (this.steps > this.limits.maxSteps) this.exhausted = true
      return !this.exhausted
    },

    frame(
      this: FlowScan,
      fn: FunctionInfo,
      env: Env,
      depth: number,
      root = false,
      callKey = fn.key,
    ): Frame {
      return {
        fn,
        env,
        returns: [],
        depth,
        thrown: [],
        yields: [],
        mutated: new Set(),
        aliased: new Set(),
        root,
        fnEnv: env,
        callKey,
      }
    },

    /** The same function frame, one block deeper: names declared in the block go away with it. */
    scoped(this: FlowScan, frame: Frame): Frame {
      return { ...frame, env: new Env(frame.env) }
    },

    ensureModule(this: FlowScan, file: FileInfo): void {
      if (file.moduleStarted) return
      file.moduleStarted = true
      const frame = this.frame(this.makeFunction(file, "<module>", undefined), file.moduleEnv, 0)
      for (const statement of file.moduleStatements) this.statement(frame, statement)
      for (const cls of file.topClasses.values()) this.applyDecorators(cls)
      // The capability's own `const userData = createData(...)` rebinds its name to an empty value; restore it so functions in the same file trace through it.
      for (const [local, key] of file.capabilityBindings)
        file.moduleEnv.set(local, { ...EMPTY_VAL, capability: key })
    },

    /**
     * Runs every function as a root, then repeats while a function wrote into a scope it does not own (module state, a
     * captured variable): a reader analyzed before the writer must see what the writer stored. Merging only ever adds, so
     * the repetition ends; it is also capped, and a project that is still changing at the cap is reported, not trusted.
     */
    run(this: FlowScan): void {
      for (const file of this.files.values()) this.ensureModule(file)
      const roots: FunctionInfo[] = []
      for (const file of this.files.values()) roots.push(...file.topFunctions.values())
      const rounds = 6
      let settled = false
      for (let round = 0; round < rounds && !settled; round += 1) {
        // Stryker disable next-line ArithmeticOperator: equivalent -- rounds are only compared with one another and with 0, which no closure made while a round runs carries, so counting them from another number tells them apart the same way.
        this.round = round + 1
        // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent -- before the first round the heap holds nothing to move on, so moving it on then changes nothing.
        if (round > 0) {
          this.heap.nextRound()
        }
        this.dirty = false
        this.memo.clear()
        settled = !this.runRoots(roots)
      }
      const first = roots[0]
      // Data kept moving between functions after every round: a function analyzed early may have missed what a later one stored.
      if (!settled && first?.node !== undefined)
        this.unknown(
          first,
          "unanalyzed-function",
          first.node,
          `the analysis did not settle after ${rounds} rounds: data written by one function was still reaching others`,
          [],
        )
      this.runUncalledInstances()
      this.flagUncalledClosures()
      this.flushDeferred()
    },

    /** Runs every root and everything queued meanwhile; true when a write reached beyond the scope that made it. */
    runRoots(this: FlowScan, roots: FunctionInfo[]): boolean {
      for (const fn of roots) this.runRoot(fn)
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
        roots.push(next)
        this.runRoot(next)
      }
      return this.dirty
    },

    runRoot(this: FlowScan, fn: FunctionInfo): void {
      if (fn.role === "static" && fn.node === undefined) {
        if (fn.cls !== undefined) this.classStatics(fn.cls)
        return
      }
      const options = this.rootOptions(fn)
      const returned = this.analyze(undefined, fn, [], options)
      const id = fn.instance ?? fn.key
      if (this.closureKeys.has(id)) this.closureReturns.set(id, flattenAtoms(returned))
    },

    /**
     * Closures, and the methods of classes, that one call made and nothing called. Whatever received them can call them
     * -- with the variables of the call that made them, which are not the variables of the first call -- so each is run on
     * its own, and what it sends or returns counts.
     */
    runUncalledInstances(this: FlowScan): void {
      const done = new Set<string>()
      const pending = (): FunctionInfo[] => {
        const found: FunctionInfo[] = []
        for (const [token, round] of this.madeByCalls) {
          const fn = this.instances.get(token)
          // Stryker disable next-line ConditionalExpression,OptionalChaining: equivalent -- a token in `madeByCalls` was put in `instances` with the node of the function it copies, so both are always there; the check only satisfies the type checker.
          if (fn?.node === undefined) continue
          // The last round has the module's state as it ended up; earlier ones are superseded.
          // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: equivalent -- the module's state only grows from round to round, so running a superseded closure as well finds nothing the last round's does not.
          if (round !== 0 && round !== this.round) continue
          if (done.has(token) || this.calledKeys.has(token)) continue
          found.push(fn)
        }
        return found
      }
      // Each round is a call of its own, so a body that does nothing ends the run instead of repeating it.
      const runRound = (): void => {
        const next = pending()
        if (next.length === 0) return
        const before = done.size
        for (const fn of next) {
          done.add(fn.instance ?? fn.key)
          this.runRoot(fn)
        }
        // Stryker disable all: unreachable -- `pending` never offers a function twice, so each round marks one more as done; the check only turns a round that makes no progress into a failure instead of a hang.
        /* v8 ignore next 3 -- unreachable: an earlier guard keeps this check from ever being true; it only turns a lost bound into a failure instead of a hang */
        if (done.size === before) {
          throw new Error("running the uncalled instances made no progress")
        }
        // Stryker restore all
        runRound()
      }
      runRound()
    },

    /**
     * How a function runs when nothing calls it: a method on an instance of its class, a constructor on a fresh instance.
     * The constructor and the methods run on the same stand-in instance (one allocation site for the class), so what the
     * constructor and the field initializers store on `this` is what a method finds there.
     */
    rootOptions(this: FlowScan, fn: FunctionInfo): AnalyzeOptions {
      const { cls } = fn
      if (cls === undefined) return {}
      const instance = withAlloc(
        { ...EMPTY_VAL, instance: cls.key },
        // Stryker disable next-line StringLiteral: equivalent -- the site is told apart by the class key; the text after it only has to differ from the positions other sites use.
        this.heap.allocId(cls.key, "instance"),
      )
      if (fn.role === "constructor") return { thisVal: instance, construct: cls }
      return { thisVal: fn.role === "static" ? { ...EMPTY_VAL, classRef: cls.key } : instance }
    },

    /** A closure that returns tracked data and that nothing calls hands it to code the analysis cannot see. */
    flagUncalledClosures(this: FlowScan): void {
      for (const [key, atoms] of this.closureReturns) {
        const fn = this.functionOf(key)
        // Stryker disable next-line ConditionalExpression,OptionalChaining: equivalent -- a key in `closureReturns` names a closure that was registered with its node, so both are always there; the check only satisfies the type checker.
        if (fn?.node === undefined) continue
        if (atoms.length === 0) continue
        if (this.calledKeys.has(key)) continue
        this.unknown(
          fn,
          "unanalyzed-function",
          fn.node,
          "closure returns tracked data but nothing in the project calls it",
          atoms,
        )
      }
    },

    // ----- function calls ------------------------------------------------------------------------

    analyze(
      this: FlowScan,
      call: CallSite | undefined,
      fn: FunctionInfo,
      given: readonly Val[],
      own: AnalyzeOptions = {},
    ): Val {
      const { args, options } = withBound(fn, given, own)
      if (call !== undefined) this.enterCall(call, fn, args, options)
      if (
        this.exhausted ||
        (call !== undefined && call.caller.depth + 1 > this.limits.maxCallDepth)
      )
        return this.overBudget(call, fn, args, options)
      const shape = [
        options.construct?.key,
        options.constructs === true,
        // Stryker disable next-line StringLiteral: equivalent -- the stand-in for "no receiver" only has to differ from the signature of a receiver.
        options.thisVal === undefined ? "" : signatureOf(options.thisVal),
        ...args.map(signatureOf),
      ]
      const key = JSON.stringify([fn.instance ?? fn.key, ...shape])
      const cached = this.memo.get(key)
      if (cached !== undefined) return this.finishCall(call, fn, cached)
      const record: CallRecord = { returnVal: EMPTY_VAL, outs: new Map(), thrown: EMPTY_VAL }
      this.memo.set(key, record)
      this.ensureModule(fn.file)

      const frame = this.frame(
        fn,
        new Env(fn.closureEnv ?? fn.file.moduleEnv, true),
        (call?.caller.depth ?? 0) + 1,
        call === undefined,
        // The same function called with the same data is the same evaluation, whichever copy of a closure it is.
        JSON.stringify([fn.key, ...shape]),
      )
      this.heap.enter(frame.callKey)
      this.enterFrame(frame, args, options)
      this.runBody(frame, fn)
      this.collect(frame, record, options)
      this.heap.leave(frame.callKey)
      return this.finishCall(call, fn, record)
    },

    /** A call the analysis does not make because it is too deep or the budget is spent: the callee becomes unknown, and the data handed to it comes out approximately. */
    overBudget(
      this: FlowScan,
      call: CallSite | undefined,
      fn: FunctionInfo,
      args: readonly Val[],
      options: AnalyzeOptions,
    ): Val {
      this.nodes.set(this.fnNode(fn), this.functionNode(fn, "unknown"))
      const all = options.thisVal === undefined ? args : [options.thisVal, ...args]
      if (call !== undefined)
        this.unknown(
          call.caller.fn,
          "unanalyzed-function",
          call.site,
          `call depth or analysis budget exceeded at ${fn.name}`,
          all.flatMap((arg) => flattenAtoms(arg)),
        )
      return approximate(mergeVals(...all))
    },

    /** The edges a call adds before anything is known about the callee: the call itself and the data handed over. */
    enterCall(
      this: FlowScan,
      call: CallSite,
      fn: FunctionInfo,
      args: readonly Val[],
      options: AnalyzeOptions,
    ): void {
      this.addEdge({
        kind: "calls",
        from: this.fnNode(call.caller.fn),
        to: this.fnNode(fn),
        status: "static",
        source: this.location(call.caller.fn, call.site),
      })
      if (options.thisVal !== undefined)
        this.sink(call.caller, options.thisVal, { kind: "arg", callee: fn, index: -1 }, call.site)
      args.forEach((arg, index) => {
        this.sink(call.caller, arg, { kind: "arg", callee: fn, index }, call.site)
      })
    },

    /** Binds `this`, `arguments` and the parameters, and starts a constructor's instance. */
    enterFrame(this: FlowScan, frame: Frame, args: readonly Val[], options: AnalyzeOptions): void {
      const { fn } = frame
      const bound = args.map((arg, index) => withEntry(arg, { kind: "param", fn: fn.key, index }))
      if (fn.node === undefined || !ts.isArrowFunction(fn.node)) {
        const self = withEntry(options.thisVal ?? EMPTY_VAL, {
          kind: "param",
          fn: fn.key,
          index: -1,
        })
        this.noteEntry(fn, self)
        frame.env.set("this", self)
        frame.env.set("arguments", {
          ...EMPTY_VAL,
          props: new Map([[ELEMENT_KEY, mergeVals(...bound)]]),
        })
      }
      if (fn.node !== undefined && ts.isFunctionExpression(fn.node) && fn.node.name !== undefined)
        frame.env.set(fn.node.name.text, { ...EMPTY_VAL, callable: fn.instance ?? fn.key })
      fn.params.forEach((param, index) => {
        const value = mergeVals(
          param.dotDotDotToken === undefined
            ? (bound[index] ?? EMPTY_VAL)
            : { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, mergeVals(...bound.slice(index))]]) },
          this.expr(frame, param.initializer),
        )
        this.noteEntry(fn, value)
        this.bind(frame, param.name, value)
      })
      if (options.construct !== undefined) this.beginConstruct(frame, options.construct, bound)
    },

    runBody(this: FlowScan, frame: Frame, fn: FunctionInfo): void {
      // Stryker disable next-line OptionalChaining: equivalent -- only the module function has no node, and it is never analyzed as a call.
      const body = fn.node?.body
      // Stryker disable next-line ConditionalExpression: equivalent -- a function declaration without a body is never registered, so the body is always present when a node is.
      if (body === undefined) return
      if (ts.isBlock(body)) this.statements(frame, body.statements)
      else this.returnValue(frame, this.expr(frame, body), body)
    },

    /** Turns what a finished frame holds into the call's record: its result, what it threw, and the objects it filled in. */
    collect(this: FlowScan, frame: Frame, record: CallRecord, options: AnalyzeOptions): void {
      const { fn } = frame
      const anchor = fn.node ?? fn.cls?.node ?? fn.file.sourceFile
      const returned = mergeVals(...frame.returns)
      const constructs = options.construct !== undefined || options.constructs === true
      if (constructs) {
        record.returnVal = mergeVals(frame.env.lookup("this"), returned)
        this.sink(frame, record.returnVal, { kind: "return" }, anchor)
      } else if (isGeneratorFunction(fn.node)) {
        const items = mergeVals(...frame.yields, returned)
        this.generators.set(frame.callKey, fn)
        record.returnVal = mergeVals(arrayOf(items), handleVal(GENERATOR_HANDLE, frame.callKey))
      } else {
        record.returnVal = returned
      }
      record.thrown = mergeVals(...frame.thrown)
      if (isAsyncFunction(fn.node) && flattenAtoms(record.thrown).length > 0)
        record.returnVal = mergeVals(record.returnVal, {
          ...EMPTY_VAL,
          props: new Map([[rejectedKey(), record.thrown]]),
        })
      fn.params.forEach((param, index) => {
        if (ts.isIdentifier(param.name) && frame.mutated.has(param.name.text))
          record.outs.set(index, frame.env.lookup(param.name.text))
      })
      if (!constructs && frame.mutated.has("this")) record.outs.set(-1, frame.env.lookup("this"))
      for (const out of record.outs.values()) this.sink(frame, out, { kind: "return" }, anchor)
    },

    finishCall(
      this: FlowScan,
      call: CallSite | undefined,
      fn: FunctionInfo,
      record: CallRecord,
    ): Val {
      const result = withEntry(record.returnVal, { kind: "return", from: fn.key })
      if (call === undefined) return result
      this.calledKeys.add(fn.key)
      if (fn.instance !== undefined) this.calledKeys.add(fn.instance)
      this.noteEntry(call.caller.fn, result)
      const thrown = withEntry(record.thrown, { kind: "return", from: fn.key })
      call.caller.thrown.push(thrown)
      this.noteEntry(call.caller.fn, thrown)
      for (const [index, val] of record.outs) this.writeBack(call, fn, index, val)
      return result
    },

    /** An object the callee stored properties into is the caller's object: what was stored is visible to the caller from here on. */
    writeBack(this: FlowScan, call: CallSite, fn: FunctionInfo, index: number, val: Val): void {
      const target = index === -1 ? call.receiver : call.argExprs?.[index]
      const root = target === undefined ? undefined : memberChain(target).root
      if (target === undefined || root === undefined) return
      const relabeled = withEntry(val, { kind: "return", from: fn.key })
      this.noteEntry(call.caller.fn, relabeled)
      if (call.caller.aliased.has(root))
        this.flagStore(
          call.caller,
          call.site,
          this.atomsOf(call.caller, relabeled, call.site),
          "an object another name may share was filled in by a call",
        )
      this.assign(call.caller, target, relabeled)
      call.caller.mutated.add(root)
    },

    returnValue(this: FlowScan, frame: Frame, val: Val, node: TS.Node): void {
      frame.returns.push(val)
      this.sink(frame, val, { kind: "return" }, node)
    },
  }
}
