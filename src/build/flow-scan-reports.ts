/**
 * What a call reports (capabilities, unknowns), decorators, and declared package summaries. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import type { FlowUnknownReason } from "../flow/flow-model.js"
import {
  bindingNames,
  decoratorsOf,
  Env,
  hasModifier,
  memberKey,
  memberName,
} from "./flow-scan-helpers.js"
import type { ClassInfo, FlowSummary, Frame, FunctionInfo } from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Atom, Val } from "./flow-values.js"
import {
  approximate,
  declaredVal,
  EMPTY_VAL,
  flattenAtoms,
  mergeVals,
  objectVal,
  OPAQUE_ALLOC,
  withAlloc,
  withoutExternal,
} from "./flow-values.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    capabilityCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      capKey: string,
      name: string,
    ): Val {
      const cap = this.caps.get(capKey)
      const args = this.evalArgs(frame, node)
      // Stryker disable next-line ConditionalExpression: equivalent -- a capability is registered before any value carries its key, so it is always found; the check only satisfies the type checker.
      if (cap === undefined) return EMPTY_VAL
      if (name === "getSnapshot") {
        return { ...EMPTY_VAL, props: new Map([["fields", { ...EMPTY_VAL, fieldsOf: capKey }]]) }
      }
      const operation = cap.operations.get(name)
      if (operation === undefined) return EMPTY_VAL
      this.addEdge({
        kind: "calls",
        from: this.fnNode(frame.fn),
        to: this.operationNode(cap, name),
        status: "static",
        source: this.location(frame.fn, node),
      })
      this.sink(
        frame,
        mergeVals(...args),
        { kind: "operation", cap, operation: name, info: operation },
        node,
      )
      return EMPTY_VAL
    },

    /** A call whose target cannot be followed: tracked data going in is an explicit unknown, and is assumed to come out approximately. */
    unresolved(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      receiver: Val | undefined,
      args: readonly Val[],
    ): Val {
      // Nothing a call returns is a package's export, whatever was handed to it.
      const all = this.materialize(
        frame,
        withoutExternal(mergeVals(...(receiver === undefined ? [] : [receiver]), ...args)),
        node,
      )
      const atoms = flattenAtoms(all)
      if (atoms.length === 0) return withAlloc(EMPTY_VAL, OPAQUE_ALLOC)
      if (this.callsThroughParameter(frame, node))
        this.deferUnknown(
          frame.fn,
          node,
          atoms,
          "unresolved-call",
          "call target is not a project function",
        )
      else
        this.unknown(
          frame.fn,
          "unresolved-call",
          node,
          "call target is not a project function",
          atoms,
        )
      for (const atom of atoms)
        this.entered
          .get(this.entryKey(frame.fn.key, atom.origin, atom.entryPath))
          ?.touched.push(atom.path)
      return withAlloc(approximate(all), OPAQUE_ALLOC)
    },

    /** Whether `node` calls something reached through one of the parameters of a function that is being analyzed on its own, where the parameter is empty. */
    callsThroughParameter(this: FlowScan, frame: Frame, node: TS.Node): boolean {
      if (!frame.root || !ts.isCallExpression(node)) return false
      const root = this.rootIdentifier(node.expression)
      return (
        root !== undefined &&
        frame.fn.params.some((param) => bindingNames(param.name).includes(root.text))
      )
    },

    deferUnknown(
      this: FlowScan,
      fn: FunctionInfo,
      node: TS.Node,
      atoms: readonly Atom[],
      reason: FlowUnknownReason,
      detail: string,
    ): void {
      const kept = this.provisional.get(fn.key) ?? []
      kept.push({ fn, node, atoms, reason, detail })
      this.provisional.set(fn.key, kept)
    },

    /** Data stored on an object that arrived as a parameter is in the caller's hands: reported unless every caller is analyzed (the object is then written back). */
    noteParameterStore(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      root: string,
      value: Val,
    ): void {
      if (!frame.root || !frame.fn.params.some((param) => bindingNames(param.name).includes(root)))
        return
      const atoms = this.atomsOf(frame, value, node)
      if (atoms.length > 0)
        this.deferUnknown(
          frame.fn,
          node,
          atoms,
          "unsupported-construct",
          "tracked data stored on an object the caller owns",
        )
    },

    /** Whether code outside the analyzed project may call `fn`: it is exported, or belongs to an exported class. */
    exposed(this: FlowScan, fn: FunctionInfo): boolean {
      const names = new Set([fn.name, fn.cls?.name])
      return [...fn.file.exports.values()].some(
        (ref) => ref.file === undefined && names.has(ref.name),
      )
    },

    /** What was met only while analyzing a function with empty arguments is dropped when analyzed code does call it, unless callers outside the project could too. */
    flushDeferred(this: FlowScan): void {
      for (const [key, items] of this.provisional) {
        const fn = this.functions.get(key)
        // Stryker disable next-line ConditionalExpression: equivalent -- every key in `provisional` was registered with `functions` first, so the function is always found; the check only satisfies the type checker.
        if (fn === undefined || (this.calledKeys.has(key) && !this.exposed(fn))) continue
        for (const item of items)
          this.unknown(item.fn, item.reason, item.node, item.detail, item.atoms)
      }
    },

    // ----- decorators ----------------------------------------------------------------------------

    /** Calls the decorators written on a class and on its members, as the language does when the class is defined. */
    applyDecorators(this: FlowScan, cls: ClassInfo): void {
      // Stryker disable next-line ConditionalExpression,BooleanLiteral: equivalent -- the guard only keeps the decorators from being analyzed again; analyzing them again finds the same facts, which are kept as a set.
      if (cls.decorated) return
      // Stryker disable next-line BooleanLiteral: equivalent -- see above; the flag only keeps the decorators from being analyzed twice.
      cls.decorated = true
      const fn = this.makeFunction(cls.file, `${cls.name}.decorators`, undefined)
      // Stryker disable next-line BooleanLiteral: equivalent -- the decorator scope declares nothing of its own, so whether it is a function boundary decides nothing; what a decorator writes goes to the scopes it names.
      const frame = this.frame(fn, new Env(cls.env, true), 1)
      for (const member of cls.node.members) this.decorateMember(frame, cls, member)
      for (const decorator of decoratorsOf(cls.node).reverse()) {
        const result = this.runDecorator(frame, decorator, [{ ...EMPTY_VAL, classRef: cls.key }])
        if (result === undefined) {
          cls.opaqueClass = true
          continue
        }
        if (result.classRef === undefined) continue
        // Stryker disable next-line ConditionalExpression: equivalent -- the class handed back to itself is bound to its own name again, which changes nothing.
        if (result.classRef !== cls.key) this.replaceClass(cls, result)
      }
    },

    /** A class decorator returned another class: that is what the class's name stands for from now on. */
    replaceClass(this: FlowScan, cls: ClassInfo, replacement: Val): void {
      cls.replacement = replacement
      const name = cls.node.name?.text
      // Stryker disable next-line ConditionalExpression: equivalent -- a class with no name has nothing to rebind; setting an undefined name binds nothing anyone can look up.
      if (name !== undefined) cls.env.set(name, replacement)
    },

    /** Runs one decorator with the arguments it receives; `undefined` when it is not a function the project defines. */
    runDecorator(
      this: FlowScan,
      frame: Frame,
      decorator: TS.Decorator,
      args: readonly Val[],
    ): Val | undefined {
      const fn = this.functionOf(this.expr(frame, decorator.expression).callable)
      return fn === undefined
        ? undefined
        : this.analyze({ caller: frame, site: decorator }, fn, args)
    },

    decorateMember(this: FlowScan, frame: Frame, cls: ClassInfo, member: TS.ClassElement): void {
      if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member))
        for (const param of member.parameters)
          for (const decorator of decoratorsOf(param))
            // Stryker disable next-line ArrayDeclaration: equivalent -- the arguments are empty values, which a decorator reads the same as no arguments.
            this.runDecorator(frame, decorator, [EMPTY_VAL, EMPTY_VAL, EMPTY_VAL])
      if (
        ts.isMethodDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
      ) {
        this.decorateMethod(frame, cls, member)
        return
      }
      // Stryker disable next-line ConditionalExpression: equivalent -- the other members that reach here (a constructor, an index signature) carry no decorators of their own, so running none changes nothing.
      if (ts.isPropertyDeclaration(member))
        for (const decorator of decoratorsOf(member).reverse())
          // Stryker disable next-line ArrayDeclaration: equivalent -- the arguments are empty values, which a decorator reads the same as no arguments.
          this.runDecorator(frame, decorator, [EMPTY_VAL, EMPTY_VAL])
    },

    /** A method decorator may return a function, or a descriptor holding one, that takes the method's place. */
    decorateMethod(
      this: FlowScan,
      frame: Frame,
      cls: ClassInfo,
      member: TS.MethodDeclaration | TS.GetAccessorDeclaration | TS.SetAccessorDeclaration,
    ): void {
      const name = memberName(member.name)
      // Stryker disable next-line ConditionalExpression: equivalent -- a member with no name has no entry under any key, which ends this at the next check.
      if (name === undefined) return
      const kind = ts.isMethodDeclaration(member)
        ? "method"
        : ts.isGetAccessorDeclaration(member)
          ? "get"
          : "set"
      const key = memberKey(kind, hasModifier(member, ts.SyntaxKind.StaticKeyword), name)
      for (const decorator of decoratorsOf(member).reverse()) {
        const current = cls.members.get(key)
        if (current === undefined) return
        const original = { ...EMPTY_VAL, callable: current.instance ?? current.key }
        // The descriptor holds a method as `value`, an accessor as `get` or `set`.
        const slot = kind === "method" ? "value" : kind
        const result = this.runDecorator(frame, decorator, [
          original,
          EMPTY_VAL,
          objectVal({ [slot]: original }, []),
        ])
        if (result === undefined) {
          cls.opaque.add(key)
          continue
        }
        const replacement = this.replacementOf(result, original, slot)
        // Stryker disable next-line ConditionalExpression,StringLiteral: equivalent -- storing "opaque" as the member itself reads back as opaque, the same as marking it so.
        if (replacement === "opaque") cls.opaque.add(key)
        else if (replacement !== undefined) cls.members.set(key, replacement)
      }
    },

    /** The function a method decorator put in place of the method: what it returned, or the `value` of the descriptor it returned. `"opaque"` when it replaced the method with something the scan cannot tell apart. */
    replacementOf(
      this: FlowScan,
      result: Val,
      original: Val,
      slot: string,
    ): FunctionInfo | "opaque" | undefined {
      const returned = this.functionOf(result.callable)
      if (returned !== undefined) return returned
      const value = result.props.get(slot)
      // Stryker disable next-line ConditionalExpression: equivalent -- putting the original method back in its own place changes nothing.
      if (value === undefined || value.callable === original.callable) return undefined
      return this.functionOf(value.callable) ?? "opaque"
    },

    // ----- declared summaries --------------------------------------------------------------------

    /** The summary the project declared for a package export, if any. */
    summaryFor(this: FlowScan, external: string): FlowSummary | undefined {
      // `split` always gives at least the module.
      // Stryker disable next-line StringLiteral: equivalent -- a key of this kind always holds the separator, so the path is always there and the default is never used.
      const [module, path = ""] = external.split("\u0000") as [string, string?]
      const bare = path.startsWith("default.") ? path.slice(8) : undefined
      return this.summaries.find(
        (summary) =>
          summary.module === module && (summary.export === path || summary.export === bare),
      )
    },

    /** A call to a package export: what its declared summary says, or `undefined` when none was declared (then it is an unknown). */
    declaredCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      external: string | undefined,
      args: readonly Val[],
    ): Val | undefined {
      const summary = external === undefined ? undefined : this.summaryFor(external)
      if (summary === undefined) return undefined
      const given = this.materialize(frame, mergeVals(...args), node)
      // Whatever the summary says, the function reads what it is handed.
      // Stryker disable next-line CallExpression: equivalent -- `materialize` has already recorded every part of the arguments as read, so reading them again records nothing new.
      this.touch(frame.fn, given, node)
      switch (summary.effect) {
        case "pass-through":
          return this.declaredResult(given, summary.approximate)
        case "returns-arg":
          return this.declaredResult(
            this.materialize(frame, args[summary.arg] ?? EMPTY_VAL, node),
            summary.approximate,
          )
        case "sink":
          this.sinkToDeclared(frame, node, given, summary)
          return EMPTY_VAL
        default:
          return EMPTY_VAL
      }
    },

    /** The result of a summarized call: the data it carries, as the author's word. */
    declaredResult(this: FlowScan, val: Val, approximated: true | undefined): Val {
      // Stryker disable next-line ConditionalExpression,BooleanLiteral: equivalent -- a declared result outranks an approximate one in its status, and an approximation of data already declared keeps the same paths; no read of it tells them apart.
      return declaredVal(approximated === true ? approximate(val) : val)
    },

    /** A summary that says the arguments are sent through a boundary. */
    sinkToDeclared(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      sent: Val,
      summary: FlowSummary & { readonly effect: "sink" },
    ): void {
      if (flattenAtoms(sent).length === 0) return
      const id = this.addNode({
        kind: "boundary",
        scope: "boundary:declared",
        name: summary.boundary.name,
        status: "declared",
        boundaryKind: summary.boundary.kind,
      })
      this.sink(
        frame,
        sent,
        { kind: "boundary", id, handling: summary.handling, declared: true },
        node,
      )
    },
  }
}
