/**
 * Calls on values: built-in objects, collections, promises, arrays, `bind`, `call` and `apply`. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import {
  arrayOf,
  externalKey,
  externalMember,
  isBuiltinEmpty,
  isBuiltinExact,
  isBuiltinGlobal,
  isElementCallbackMethod,
  isPredicateMethod,
  isReduceMethod,
  isShapePreservingMethod,
  isThenMethod,
  isTransformingMethod,
  memberChain,
  rejectedKey,
  settled,
  unwrap,
} from "./flow-scan-helpers.js"
import type { CallSite, Frame, MemberCallee } from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Val } from "./flow-values.js"
import {
  accessDynamic,
  approximate,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  GENERATOR_HANDLE,
  handlesOf,
  mergeVals,
  objectVal,
  withoutAlloc,
} from "./flow-values.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    /** `super.method(...)`: the superclass's method, run on this instance. */
    superMethodCall(this: FlowScan, frame: Frame, node: TS.CallExpression, name: string): Val {
      const cls = frame.fn.cls
      const parent = cls === undefined ? undefined : this.parentOf(cls)
      const isStatic = frame.fn.role === "static"
      // Only a superclass the scan can read has a method to run; no superclass, or one it cannot see, has none.
      const found =
        typeof parent === "object" ? this.findMember(parent, "method", isStatic, name) : undefined
      const args = this.evalArgs(frame, node)
      if (found === undefined || found === "opaque")
        return this.unresolved(frame, node, frame.env.get("this"), args)
      return this.analyze({ caller: frame, site: node, argExprs: node.arguments }, found, args, {
        thisVal: frame.env.lookup("this"),
      })
    },

    builtinCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      rootName: string,
      name: string,
    ): Val {
      const qualified = `${rootName}.${name}`
      // A JSON round trip changes nothing a data-flow analysis can see.
      const stringified = qualified === "JSON.parse" ? this.stringifiedArgument(node) : undefined
      if (stringified !== undefined) return this.roundTrip(frame, node, stringified)
      const args = this.evalArgs(frame, node)
      if (isBuiltinEmpty(qualified)) return EMPTY_VAL
      const special = this.specialBuiltin(frame, node, qualified, args)
      if (special !== undefined) return special
      const merged = mergeVals(...args)
      if (qualified === "Object.values" || qualified === "Object.entries") {
        // An array of the object's values (or of key/value pairs): every value is one element.
        const element = accessDynamic(this.materialize(frame, merged, node))
        const pair: Val = { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, element]]) }
        return {
          ...EMPTY_VAL,
          props: new Map([[ELEMENT_KEY, qualified === "Object.values" ? element : pair]]),
        }
      }
      if (qualified === "Object.fromEntries") {
        // `Object.fromEntries(Object.entries(x))` takes the object apart and puts it back as it was.
        if (this.isEntriesOf(node)) this.tagData(frame, node, merged, "serialize-roundtrip")
        return accessDynamic(this.materialize(frame, merged, node))
      }
      if (qualified === "Array.from" && node.arguments.length === 1)
        return this.copiedElements(
          frame,
          node,
          merged,
          this.fresh(frame, node, withoutAlloc(approximate(merged))),
        )
      this.storeIntoTarget(frame, node, qualified, args)
      if (qualified === "Promise.reject")
        return { ...EMPTY_VAL, props: new Map([[rejectedKey(), merged]]) }
      return isBuiltinExact(qualified) ? merged : approximate(merged)
    },

    /** `JSON.parse(JSON.stringify(x))`: the data of `x` in new objects. With a replacer, a reviver or a second argument it can change the data, so only the plain pair is a copy. */
    roundTrip(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      stringified: TS.CallExpression,
    ): Val {
      const operand = this.expr(frame, stringified.arguments[0])
      return node.arguments.length === 1 && stringified.arguments.length === 1
        ? this.copied(frame, node, operand, "serialize-roundtrip", true)
        : operand
    },

    /** Whether the call's only argument is `Object.entries(x)` with nothing else. */
    isEntriesOf(this: FlowScan, node: TS.CallExpression): boolean {
      const [first, ...rest] = node.arguments
      if (first === undefined || rest.length > 0) return false
      const inner = unwrap(first)
      if (!ts.isCallExpression(inner)) return false
      const callee = unwrap(inner.expression)
      return (
        inner.arguments.length === 1 &&
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "Object" &&
        callee.name.text === "entries"
      )
    },

    /** `JSON.stringify(x)` written as the argument of `JSON.parse`: that call. */
    stringifiedArgument(this: FlowScan, node: TS.CallExpression): TS.CallExpression | undefined {
      const [first] = node.arguments
      const inner = first === undefined ? undefined : unwrap(first)
      if (inner === undefined || !ts.isCallExpression(inner)) return undefined
      const callee = unwrap(inner.expression)
      return ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "JSON" &&
        callee.name.text === "stringify"
        ? inner
        : undefined
    },

    /** The builtins whose result the scan models rather than approximates; `undefined` for the rest. */
    specialBuiltin(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      qualified: string,
      args: readonly Val[],
    ): Val | undefined {
      if (qualified.startsWith("Reflect."))
        return this.reflectCall(frame, node, qualified.slice(8), args)
      if (qualified === "Object.groupBy" || qualified === "Map.groupBy")
        return this.groupBy(frame, node, qualified, args)
      if (qualified === "Object.create") return this.objectCreate(frame, node, args)
      return this.promiseStatic(frame, node, qualified, args)
    },

    /** `Object.assign(target, ...sources)` and `Object.defineProperty(target, ...)` change `target` itself. */
    storeIntoTarget(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      qualified: string,
      args: readonly Val[],
    ): void {
      const target = node.arguments[0]
      const stored = qualified === "Object.assign" || qualified === "Object.setPrototypeOf"
      if (!stored && !qualified.startsWith("Object.define")) return
      if (target === undefined) return
      const given = mergeVals(...args.slice(1))
      // A property defined through a descriptor holds the descriptor's value under a name chosen at run time.
      const value = stored ? given : accessDynamic(this.materialize(frame, given, node))
      const fresh =
        ts.isObjectLiteralExpression(unwrap(target)) || ts.isArrayLiteralExpression(unwrap(target))
      if (stored) this.storeShared(frame, node, args[0], value)
      if (memberChain(target).root !== undefined) this.assign(frame, target, value)
      else if (!fresh)
        this.flagStore(frame, node, flattenAtoms(value), "assignment target is not a variable")
    },

    /** The calls made on a value rather than on a module, a class or a capability: promises, array methods, strings, and the rest. */
    valueMethodCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: MemberCallee,
      receiver: Val,
      name: string,
      list: readonly TS.Expression[] = node.arguments,
    ): Val {
      if (isThenMethod(name)) return this.promiseCall(frame, node, receiver, name, list)
      if (name === "call" || name === "apply") {
        const handled = this.functionCall(frame, node, callee, name)
        if (handled !== undefined) return handled
      }
      const args = this.evalArgs(frame, { arguments: list })
      const modelled = this.modelledCall(frame, node, callee, receiver, name, args, list)
      if (modelled !== undefined) return modelled
      if (isElementCallbackMethod(name) || isReduceMethod(name)) {
        const handled = this.callbackCall(frame, node, receiver, name, args, list)
        if (handled !== undefined) return handled
      }
      return this.plainMethodCall(frame, node, callee, receiver, name, args)
    },

    /** Calls on values the scan models itself: bound functions, maps, sets and generators. `undefined` when `receiver` is none of them. */
    modelledCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: MemberCallee,
      receiver: Val,
      name: string,
      args: readonly Val[],
      list: readonly TS.Expression[],
    ): Val | undefined {
      if (name === "bind") return this.bindCall(frame, node, receiver, args)
      if (receiver.external !== undefined)
        return this.declaredCall(
          frame,
          node,
          externalKey(externalMember(receiver.external, name)),
          args,
        )
      if (receiver.native === "map")
        return this.mapCall(frame, node, callee, receiver, name, args, list)
      if (receiver.native === "set")
        return this.setCall(frame, node, callee, receiver, name, args, list)
      if (name === "next" && receiver.props.has(ELEMENT_KEY))
        return this.generatorNext(frame, node, receiver, args)
      return undefined
    },

    /** `fn.bind(thisArg, ...args)` on a project function; a capability's method bound to its capability is still that method. */
    bindCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      receiver: Val,
      args: readonly Val[],
    ): Val | undefined {
      if (receiver.boundMethod !== undefined) return receiver
      const target = this.functionOf(receiver.callable)
      if (target === undefined) return undefined
      const [self, ...rest] = args
      // Stryker disable next-line LogicalOperator: equivalent -- the token only has to be unique, and the count of instances at the time already makes it so; which of the two names precedes it changes nothing.
      const token = `${target.instance ?? target.key}\u0000bind${this.instances.size}`
      this.instances.set(token, {
        ...target,
        instance: token,
        bound: {
          thisVal: target.bound?.thisVal ?? self,
          args: [...(target.bound?.args ?? []), ...rest],
        },
      })
      // The data fixed into the function travels with it: a bound function handed to code the scan cannot read hands that over too.
      const fixed = this.materialize(
        frame,
        mergeVals(...(self === undefined ? [] : [self]), ...rest),
        node,
      )
      return { ...EMPTY_VAL, atoms: flattenAtoms(approximate(fixed)), callable: token }
    },

    plainMethodCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: MemberCallee,
      receiver: Val,
      name: string,
      args: readonly Val[],
    ): Val {
      if (name === "push" || name === "unshift" || name === "splice" || name === "fill") {
        // Elements stored where no later read can find them are data that went somewhere unseen.
        if (!this.storeElements(frame, callee.expression, receiver, args))
          this.unresolved(frame, node, undefined, args)
        if (name === "push" || name === "unshift") return EMPTY_VAL
      }
      if (isPredicateMethod(name)) return EMPTY_VAL
      if (isShapePreservingMethod(name) || name === "fill")
        return mergeVals(this.elementIfArray(frame, receiver, name, node), ...args)
      if (isTransformingMethod(name)) return approximate(mergeVals(receiver, ...args))
      return this.unresolved(frame, node, receiver, args)
    },

    /** Stores `args` as elements of the array `target` names; false when `target` is not something a later read can find again. */
    storeElements(
      this: FlowScan,
      frame: Frame,
      target: TS.Expression,
      receiver: Val,
      args: readonly Val[],
    ): boolean {
      return this.fillContainer(frame, target, receiver, arrayOf(mergeVals(...args)))
    },

    /** Merges `added` into the variable or member `target` names, as a call that fills a container does; false when `target` is not something a later read can find again. */
    fillContainer(
      this: FlowScan,
      frame: Frame,
      target: TS.Expression,
      container: Val,
      added: Val,
    ): boolean {
      this.storeShared(frame, target, container, added)
      const { root } = memberChain(target)
      if (root === undefined) return false
      // Another name may hold this very object: what is stored here is stored there too, and the scan does not follow that.
      if (frame.aliased.has(root))
        this.flagStore(
          frame,
          target,
          this.atomsOf(frame, added, target),
          "property stored into an object another name may share",
        )
      this.assign(frame, target, added)
      frame.mutated.add(root)
      this.noteParameterStore(frame, target, root, added)
      return true
    },

    /** `generator.next(x)` hands out what the generator yielded, and sends `x` to a generator the project defines; into any other it is an unknown. */
    generatorNext(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      receiver: Val,
      args: readonly Val[],
    ): Val {
      if (handlesOf(receiver, GENERATOR_HANDLE).length === 0) this.unresolvedSent(frame, node, args)
      for (const [id, generator] of this.generatorsOf(receiver))
        this.send(frame, node, id, generator, mergeVals(...args))
      return objectVal(
        { value: this.accessMember(frame, receiver, ELEMENT_KEY, node), done: EMPTY_VAL },
        [],
      )
    },

    /** Tracked data handed to a generator through `next(x)` flows into code this analysis does not follow. */
    unresolvedSent(this: FlowScan, frame: Frame, node: TS.Node, args: readonly Val[]): void {
      const atoms = this.atomsOf(frame, mergeVals(...args), node)
      if (atoms.length > 0)
        this.unknown(
          frame.fn,
          "unresolved-call",
          node,
          "value sent into a generator is not followed",
          atoms,
        )
    },

    /** `promise.then(a, b)`, `.catch(b)`, `.finally(c)`: the callbacks run with the settled value, or with what the promise was rejected with. */
    promiseCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      promise: Val,
      name: string,
      list: readonly TS.Expression[],
    ): Val {
      const callbacks = this.callbackArgs(frame, list)
      this.evalArgs(frame, { arguments: list })
      const receiver = this.unwrapPromise(frame, promise, node)
      const rejected = receiver.props.get(rejectedKey()) ?? EMPTY_VAL
      const value = settled(receiver)
      let result = name === "catch" ? value : name === "then" ? EMPTY_VAL : receiver
      callbacks.forEach((fn, index) => {
        if (fn === undefined) return
        const received =
          name === "then" && index === 0 ? value : name === "finally" ? EMPTY_VAL : rejected
        const returned = this.analyze({ caller: frame, site: node }, fn, [received])
        if (name !== "finally") result = mergeVals(result, returned)
      })
      if (callbacks.every((fn) => fn === undefined)) return promise
      // What the callbacks do not handle stays rejected.
      // Stryker disable next-line ConditionalExpression: equivalent -- a rejection with no data adds an empty rejection to the result, which every reader of it treats as none.
      if (name !== "then" || flattenAtoms(rejected).length === 0) return result
      return mergeVals(result, { ...EMPTY_VAL, props: new Map([[rejectedKey(), rejected]]) })
    },

    /** `array.map(cb)`, `forEach`, `reduce`, ...: the callback runs once with an element (and the accumulator). */
    callbackCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      receiver: Val,
      name: string,
      args: readonly Val[],
      list: readonly TS.Expression[],
    ): Val | undefined {
      const [callback] = this.callbackArgs(frame, list)
      if (callback === undefined) {
        if (this.unresolvedCallback(list)) this.unresolved(frame, node, receiver, args)
        if (isPredicateMethod(name) || name === "forEach") return EMPTY_VAL
        return undefined
      }
      const site: CallSite = { caller: frame, site: node, argExprs: list }
      const element = this.accessMember(frame, receiver, ELEMENT_KEY, node)
      if (isReduceMethod(name)) {
        const initial = args[1] ?? EMPTY_VAL
        const returned = this.analyze(site, callback, [mergeVals(initial, receiver), element])
        return approximate(mergeVals(initial, returned))
      }
      const returned = this.analyze(site, callback, [element])
      if (name === "map" || name === "flatMap")
        return { ...EMPTY_VAL, props: new Map([[ELEMENT_KEY, returned]]) }
      if (name === "forEach" || isPredicateMethod(name)) return EMPTY_VAL
      return this.elementIfArray(frame, receiver, name, node)
    },

    /** `at`, `find` and `findLast` give one element of an array whose elements are known, and otherwise the value itself. */
    elementIfArray(this: FlowScan, frame: Frame, receiver: Val, name: string, node: TS.Node): Val {
      const single = name === "at" || name === "find" || name === "findLast"
      return single && receiver.props.has(ELEMENT_KEY)
        ? this.accessMember(frame, receiver, ELEMENT_KEY, node)
        : receiver
    },

    /** Whether the first argument names something that could be a callback (not a literal, not a builtin like `Boolean`) -- and, being here, was not resolved. */
    unresolvedCallback(this: FlowScan, list: readonly TS.Expression[]): boolean {
      const [first] = list
      if (first === undefined) return false
      const target = unwrap(first)
      if (ts.isIdentifier(target)) return !isBuiltinGlobal(target.text)
      return (
        ts.isPropertyAccessExpression(target) ||
        ts.isElementAccessExpression(target) ||
        ts.isCallExpression(target) ||
        ts.isConditionalExpression(target) ||
        ts.isBinaryExpression(target)
      )
    },

    /** `fn.call(thisArg, ...args)` and `fn.apply(thisArg, array)` call a project function. */
    functionCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: MemberCallee,
      name: string,
    ): Val | undefined {
      const method = this.expr(frame, callee.expression)
      // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent -- a call on a capability itself is answered before this point, so a capability here always has its method bound; the two tests only narrow the types.
      if (method.capability !== undefined && method.boundMethod !== undefined)
        return this.capabilityCall(frame, node, method.capability, method.boundMethod)
      const target = this.resolveCallable(frame, callee.expression)
      if (target === undefined) return undefined
      const [self, ...rest] = this.evalArgs(frame, node)
      const args =
        name === "call"
          ? rest
          : Array.from({ length: Math.max(target.params.length, 1) }, () =>
              this.accessMember(frame, rest[0] ?? EMPTY_VAL, ELEMENT_KEY, node),
            )
      // What the callee stores on `this` is stored on the object `thisArg` names (`Base.call(this, x)`), and on the arguments it fills in.
      const site: CallSite = {
        caller: frame,
        site: node,
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: equivalent -- the argument list of `apply` is one array that names no variable, so listing it as the arguments changes no write-back.
        argExprs: name === "call" ? node.arguments.slice(1) : [],
        // Stryker disable next-line ConditionalExpression: equivalent -- without a first argument there is nothing to run `this` on, and an undefined receiver reads the same as none.
        ...(node.arguments[0] === undefined ? {} : { receiver: node.arguments[0] }),
      }
      // Stryker disable next-line ConditionalExpression: equivalent -- an undefined `this` reads the same as none.
      return this.analyze(site, target, args, self === undefined ? {} : { thisVal: self })
    },
  }
}
