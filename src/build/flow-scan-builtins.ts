/**
 * Built-ins with known semantics, and the discards. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import type { FlowModelInput } from "../flow/flow-model.js"
import {
  arrayOf,
  collectionBase,
  isShapeObject,
  literalPairs,
  memberChain,
  pathStartsWith,
  rejectedKey,
  setAlgebra,
  settled,
  shapeAt,
  unwrap,
} from "./flow-scan-helpers.js"
import type { Frame, MemberCallee, PromiseSlot, Settlement } from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Val } from "./flow-values.js"
import {
  accessDynamic,
  approximate,
  dropHandles,
  ELEMENT_KEY,
  EMPTY_VAL,
  handlesOf,
  handleVal,
  MAP_KEYS,
  MAP_VALUES,
  mapVal,
  mergeVals,
  objectVal,
  PROMISE_HANDLE,
  recordVal,
  REJECT_HANDLE,
  RESOLVE_HANDLE,
  setVal,
  signatureOf,
  withEntry,
} from "./flow-values.js"
import { positionOf } from "./source-position.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    // ----- builtins with known semantics ---------------------------------------------------------

    /** `new Map(...)`, `new Set(...)`, `new Promise(...)`; `undefined` for any other constructor, or one the project shadows. */
    builtinNew(this: FlowScan, frame: Frame, node: TS.NewExpression): Val | undefined {
      const callee = unwrap(node.expression)
      if (!ts.isIdentifier(callee) || frame.env.has(callee.text)) return undefined
      if (this.resolveName(frame.fn.file, callee.text) !== undefined) return undefined
      if (callee.text === "Map" || callee.text === "WeakMap")
        return this.fresh(frame, node, this.newMap(frame, node))
      if (callee.text === "Set" || callee.text === "WeakSet")
        return this.fresh(frame, node, this.newSet(frame, node))
      return callee.text === "Promise" ? this.newPromise(frame, node) : undefined
    },

    /** A map made of `[key, value]` literals keeps keys and values apart; one made of anything else cannot tell them apart. */
    newMap(this: FlowScan, frame: Frame, node: TS.NewExpression): Val {
      const source = node.arguments?.[0]
      if (source === undefined) return mapVal(EMPTY_VAL, EMPTY_VAL)
      const pairs = literalPairs(source)
      if (pairs !== undefined) {
        const keys = pairs.map((pair) => this.expr(frame, pair.elements[0]))
        const values = pairs.map((pair) => this.expr(frame, pair.elements[1]))
        return mapVal(mergeVals(...keys), mergeVals(...values))
      }
      const given = this.expr(frame, source)
      if (given.native === "map")
        return mapVal(
          given.props.get(MAP_KEYS) ?? EMPTY_VAL,
          given.props.get(MAP_VALUES) ?? EMPTY_VAL,
        )
      const element = this.iterate(frame, this.iterate(frame, given, node), node)
      return mapVal(element, element)
    },

    newSet(this: FlowScan, frame: Frame, node: TS.NewExpression): Val {
      const source = node.arguments?.[0]
      return setVal(
        // Stryker disable next-line ConditionalExpression: equivalent -- with no source, the expression reads as an empty value, and iterating an empty value gives an empty value.
        source === undefined ? EMPTY_VAL : this.iterate(frame, this.expr(frame, source), node),
      )
    },

    /** `new Promise(executor)`: the executor runs with `resolve` and `reject` that settle this very promise, wherever they are called from. */
    newPromise(this: FlowScan, frame: Frame, node: TS.NewExpression): Val {
      const position = positionOf(frame.fn.file.sourceFile, node)
      const id = `${frame.callKey}@${position.line}:${position.column}`
      const handle = handleVal(PROMISE_HANDLE, id)
      const executor = node.arguments?.[0]
      const target = executor === undefined ? undefined : this.resolveCallable(frame, executor)
      const args = this.evalArgs(frame, node)
      if (target === undefined)
        return mergeVals(handle, this.unresolved(frame, node, undefined, args))
      const raised = frame.thrown.length
      this.analyze({ caller: frame, site: node }, target, [
        handleVal(RESOLVE_HANDLE, id),
        handleVal(REJECT_HANDLE, id),
      ])
      // What the executor throws rejects the promise.
      const thrown = frame.thrown.splice(raised)
      // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent -- rejecting with an empty value records a rejection no reader tells from none.
      if (thrown.length > 0) this.settle(frame, node, id, "rejected", mergeVals(...thrown))
      return handle
    },

    promiseSlot(this: FlowScan, id: string): PromiseSlot {
      const known = this.promiseSlots.get(id)
      if (known !== undefined) return known
      // Stryker disable next-line BooleanLiteral: equivalent -- a slot nobody has read yet, marked read, only makes the first settle run one more round, which finds the same facts.
      const slot: PromiseSlot = { resolved: new Map(), rejected: new Map(), read: false }
      this.promiseSlots.set(id, slot)
      return slot
    },

    /** Records what a promise was resolved or rejected with, and hands it to the function that settled it as a return. */
    settle(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      id: string,
      outcome: "resolved" | "rejected",
      value: Val,
    ): void {
      const slot = this.promiseSlot(id)
      const list = slot[outcome]
      const key = JSON.stringify([frame.fn.key, signatureOf(value)])
      if (!list.has(key)) {
        list.set(key, { from: frame.fn.key, val: value })
        // Whoever awaited it before saw less than it holds now.
        // Stryker disable next-line ConditionalExpression: equivalent -- marking a round dirty when nobody has read the slot only runs one more round, which finds the same facts.
        if (slot.read) this.dirty = true
      }
      this.sink(frame, value, { kind: "return" }, node)
    },

    /** The value a promise made by `new Promise` settles with, what it was rejected with, kept apart as an awaited or `.then`-ed value is. */
    unwrapPromise(this: FlowScan, frame: Frame, promise: Val, site: TS.Node): Val {
      const ids = handlesOf(promise, PROMISE_HANDLE)
      if (ids.length === 0) return promise
      const parts: Val[] = [dropHandles(promise)]
      for (const id of ids) {
        const slot = this.promiseSlot(id)
        slot.read = true
        const back = (settlement: Settlement): Val =>
          withEntry(settlement.val, { kind: "return", from: settlement.from })
        parts.push(...[...slot.resolved.values()].map(back))
        const rejected = [...slot.rejected.values()].map(back)
        // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent -- an empty rejection recorded for a promise nothing rejected reads the same as none.
        if (rejected.length > 0)
          parts.push({ ...EMPTY_VAL, props: new Map([[rejectedKey(), mergeVals(...rejected)]]) })
      }
      const result = mergeVals(...parts)
      // The data comes to this function from whichever function settled the promise, as a value it was returned.
      // Stryker disable next-line CallExpression: equivalent -- `touch` reads every part of the result on the next line, which records the same entries.
      this.noteEntry(frame.fn, result)
      this.touch(frame.fn, result, site)
      return result
    },

    isSettler(this: FlowScan, callee: Val): boolean {
      return handlesOf(callee, RESOLVE_HANDLE).length + handlesOf(callee, REJECT_HANDLE).length > 0
    },

    /** `resolve(x)` / `reject(e)`: settles every promise the callee stands for. */
    settleCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: Val,
      args: readonly Val[],
    ): Val {
      const value = args[0] ?? EMPTY_VAL
      for (const id of handlesOf(callee, RESOLVE_HANDLE))
        this.settle(frame, node, id, "resolved", this.unwrapPromise(frame, value, node))
      for (const id of handlesOf(callee, REJECT_HANDLE))
        this.settle(frame, node, id, "rejected", value)
      return EMPTY_VAL
    },

    /** `Promise.all`, `allSettled`, `race`, `any`: the settled values of the promises given, and the first rejection. */
    promiseStatic(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      qualified: string,
      args: readonly Val[],
    ): Val | undefined {
      if (!["Promise.all", "Promise.allSettled", "Promise.race", "Promise.any"].includes(qualified))
        return undefined
      const name = qualified.slice(8)
      const items = this.unwrapPromise(frame, this.iterate(frame, args[0] ?? EMPTY_VAL, node), node)
      const rejected = items.props.get(rejectedKey())
      const value = settled(items)
      if (name === "allSettled")
        return arrayOf(objectVal({ value, reason: rejected ?? EMPTY_VAL }, []))
      const failure: Val =
        rejected === undefined
          ? EMPTY_VAL
          : { ...EMPTY_VAL, props: new Map([[rejectedKey(), rejected]]) }
      return mergeVals(name === "all" ? arrayOf(value) : value, failure)
    },

    /** `Reflect.*`: each is the operation it names, written as a call. */
    reflectCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      name: string,
      args: readonly Val[],
    ): Val {
      const access = this.reflectAccess(frame, node, name, args)
      if (access !== undefined) return access
      // Names and booleans only: what they answer holds no data.
      if (["has", "deleteProperty", "ownKeys", "isExtensible"].includes(name)) return EMPTY_VAL
      if (name === "defineProperty" || name === "setPrototypeOf") {
        this.storeIntoTarget(frame, node, `Object.${name}`, args)
        return EMPTY_VAL
      }
      if (name === "getPrototypeOf") return approximate(mergeVals(...args))
      if (name === "apply") return this.reflectApply(frame, node, args)
      if (name === "construct") return this.reflectConstruct(frame, node, args)
      return this.unresolved(frame, node, undefined, args)
    },

    /** `Reflect.get`, `Reflect.set` and `Reflect.getOwnPropertyDescriptor` are a property read, a property store, and a read wrapped in a descriptor. */
    reflectAccess(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      name: string,
      args: readonly Val[],
    ): Val | undefined {
      const [target, key] = node.arguments
      // Stryker disable next-line ConditionalExpression: equivalent -- arguments are positional, so a missing first one means the second is missing too and the next test ends it; the check only narrows the type.
      if (target === undefined || key === undefined) return undefined
      if (name === "get") return this.readKey(frame, node, args[0] ?? EMPTY_VAL, key)
      if (name === "getOwnPropertyDescriptor")
        return objectVal({ value: this.readKey(frame, node, args[0] ?? EMPTY_VAL, key) }, [])
      if (name !== "set") return undefined
      const literal = this.literalReader(frame)
      const chain = memberChain(target, literal)
      const text = literal(unwrap(key))
      const dynamic = text === undefined && !ts.isNumericLiteral(unwrap(key))
      const value = args[2] ?? EMPTY_VAL
      this.storeAt(
        frame,
        node,
        {
          root: chain.root,
          keys: [...chain.keys, text ?? ELEMENT_KEY],
          dynamic: chain.dynamic || dynamic,
        },
        value,
        this.atomsOf(frame, value, node),
        () => args[0],
      )
      return EMPTY_VAL
    },

    /** `Reflect.construct(Class, argumentsList)` is `new Class(...argumentsList)`. */
    reflectConstruct(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      args: readonly Val[],
    ): Val {
      const target = args[0] ?? EMPTY_VAL
      const list = args[1] ?? EMPTY_VAL
      const arity = Math.max(this.constructorOf(target)?.params.length ?? 1, 1)
      const given = Array.from({ length: arity }, () =>
        this.accessMember(frame, list, ELEMENT_KEY, node),
      )
      // Stryker disable next-line ArrayDeclaration: equivalent -- the expressions of the arguments are only where a callee's stores are written back to, and a list given as a value has none.
      return this.construct(frame, node, target, given, [])
    },

    /** `Reflect.apply(fn, thisArg, argumentsList)` is `fn.apply(thisArg, argumentsList)`. */
    reflectApply(this: FlowScan, frame: Frame, node: TS.CallExpression, args: readonly Val[]): Val {
      const target = this.functionOf(args[0]?.callable)
      if (target === undefined) return this.unresolved(frame, node, undefined, args)
      const list = args[2] ?? EMPTY_VAL
      const spread = Array.from({ length: Math.max(target.params.length, 1) }, () =>
        this.accessMember(frame, list, ELEMENT_KEY, node),
      )
      return this.analyze(
        { caller: frame, site: node },
        target,
        spread,
        // Stryker disable next-line ConditionalExpression: equivalent -- an undefined `this` reads the same as none.
        args[1] === undefined ? {} : { thisVal: args[1] },
      )
    },

    /** `Object.create(proto, descriptors)`: an object that answers to everything `proto` holds -- its methods, its data, its class. */
    objectCreate(this: FlowScan, frame: Frame, node: TS.CallExpression, args: readonly Val[]): Val {
      const [proto, descriptors] = args
      // A property defined through a descriptor holds the descriptor's value under a name chosen at run time.
      const defined =
        descriptors === undefined
          ? EMPTY_VAL
          : accessDynamic(this.materialize(frame, descriptors, node))
      return this.fresh(frame, node, mergeVals(proto ?? EMPTY_VAL, defined))
    },

    /** `Object.groupBy(items, f)` and `Map.groupBy(items, f)`: arrays of the items, under the keys `f` chooses. */
    groupBy(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      qualified: string,
      args: readonly Val[],
    ): Val {
      const callbackExpression = node.arguments[1]
      const callback =
        callbackExpression === undefined
          ? undefined
          : this.resolveCallable(frame, callbackExpression)
      if (callback === undefined) return this.unresolved(frame, node, undefined, args)
      const element = this.iterate(frame, args[0] ?? EMPTY_VAL, node)
      const chosen = this.analyze(
        { caller: frame, site: node, argExprs: node.arguments },
        callback,
        [element, EMPTY_VAL],
      )
      const group = arrayOf(element)
      return qualified === "Map.groupBy" ? mapVal(chosen, group) : recordVal(group)
    },

    /** The calls on a `Map` / `WeakMap`; `undefined` for a method it does not have. */
    mapCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: MemberCallee,
      receiver: Val,
      name: string,
      args: readonly Val[],
      list: readonly TS.Expression[],
    ): Val | undefined {
      const keys = receiver.props.get(MAP_KEYS) ?? EMPTY_VAL
      const values = receiver.props.get(MAP_VALUES) ?? EMPTY_VAL
      switch (name) {
        case "get":
          return values
        case "set":
          return this.addToCollection(
            frame,
            node,
            callee,
            receiver,
            mapVal(args[0] ?? EMPTY_VAL, args[1] ?? EMPTY_VAL),
            args,
          )
        // Stryker disable next-line StringLiteral: equivalent -- a `has` that falls through is answered as the predicate it is, with no data.
        case "has":
        case "delete":
        case "clear":
          return EMPTY_VAL
        case "forEach":
          return this.collectionEach(frame, node, receiver, [values, keys, receiver], args, list)
        case "values":
          return arrayOf(values)
        case "keys":
          return arrayOf(keys)
        case "entries":
          return arrayOf(receiver.props.get(ELEMENT_KEY) ?? EMPTY_VAL)
      }
      return undefined
    },

    /** The calls on a `Set` / `WeakSet`; `undefined` for a method it does not have. */
    setCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: MemberCallee,
      receiver: Val,
      name: string,
      args: readonly Val[],
      list: readonly TS.Expression[],
    ): Val | undefined {
      const items = receiver.props.get(ELEMENT_KEY) ?? EMPTY_VAL
      switch (name) {
        case "add":
          return this.addToCollection(
            frame,
            node,
            callee,
            receiver,
            setVal(args[0] ?? EMPTY_VAL),
            args,
          )
        // Stryker disable next-line StringLiteral: equivalent -- a `has` that falls through is answered as the predicate it is, with no data.
        case "has":
        case "delete":
        case "clear":
          return EMPTY_VAL
        case "forEach":
          return this.collectionEach(frame, node, receiver, [items, items, receiver], args, list)
        case "values":
        case "keys":
          return arrayOf(items)
        case "entries":
          return arrayOf(arrayOf(items))
        default:
          return setAlgebra(name, items, args[0]?.props.get(ELEMENT_KEY) ?? EMPTY_VAL)
      }
    },

    /** `m.set(k, v)` / `s.add(x)`: stored into the variable the chain of calls starts from, and the collection returned for chaining. */
    addToCollection(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: MemberCallee,
      receiver: Val,
      added: Val,
      args: readonly Val[],
    ): Val {
      const base = collectionBase(callee.expression)
      if (!this.fillContainer(frame, base, receiver, added) && !ts.isNewExpression(base)) {
        // Stored into something no later read can find: data that went somewhere unseen.
        this.unresolved(frame, node, undefined, args)
      }
      return mergeVals(receiver, added)
    },

    /** `forEach(callback)` on a collection: the callback runs once with what the collection holds. */
    collectionEach(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      receiver: Val,
      params: readonly Val[],
      args: readonly Val[],
      list: readonly TS.Expression[],
    ): Val {
      const [callback] = this.callbackArgs(frame, list)
      if (callback !== undefined)
        this.analyze({ caller: frame, site: node, argExprs: list }, callback, params)
      else if (this.unresolvedCallback(list)) this.unresolved(frame, node, receiver, args)
      return EMPTY_VAL
    },

    /** `Array.prototype.m.call(self, ...)`: the call `self.m(...)`. */
    prototypeCall(this: FlowScan, frame: Frame, node: TS.CallExpression, method: string): Val {
      const [self, ...rest] = node.arguments
      // Stryker disable next-line ConditionalExpression: equivalent -- with no first argument there is nothing to evaluate, and the expression of none reads as the empty value.
      const receiver = self === undefined ? EMPTY_VAL : this.expr(frame, self)
      // Stryker disable next-line ObjectLiteral: equivalent -- the method name travels as its own argument, so the name inside the callee is only read to report a call that is not followed, which carries the same data.
      const callee: MemberCallee = { expression: self ?? node.expression, name: { text: method } }
      return this.valueMethodCall(frame, node, callee, receiver, method, rest)
    },

    // ----- discards ------------------------------------------------------------------------------

    emitDiscards(this: FlowScan): void {
      for (const record of this.entered.values()) {
        const fn = record.fn
        const shape = shapeAt(this.shapeByOrigin.get(record.origin), record.entryPath)
        if (!isShapeObject(shape)) continue
        for (const key of Object.keys(shape)) {
          const path = [...record.entryPath, key]
          const used = record.touched.some(
            (touched) => pathStartsWith(touched, path) || pathStartsWith(path, touched),
          )
          if (used) continue
          this.addEdge({
            kind: "discards",
            from: this.fnNode(fn),
            to: record.origin,
            status: "static",
            path,
            origin: record.origin,
          })
        }
      }
    },

    finish(this: FlowScan): FlowModelInput {
      for (const fn of this.functions.values())
        if (fn.node !== undefined) this.ensureFunctionNodes(fn)
      this.emitDiscards()
      return {
        nodes: [...this.nodes.values()],
        edges: [...this.edges.values()],
        unknowns: [...this.unknowns.values()],
        ...(this.edgeTags.length === 0 ? {} : { edgeTags: this.edgeTags }),
      }
    },
  }
}
