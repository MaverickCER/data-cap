/**
 * Calls: resolving the callee, `new`, loading modules, and method resolution. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import {
  externalKey,
  externalMember,
  externalVal,
  isBuiltinGlobal,
  isBuiltinRoot,
  isOpaqueCallee,
  loadedSpecifier,
  memberCallee,
  prototypeMethod,
  unwrap,
} from "./flow-scan-helpers.js"
import type {
  CallSite,
  ClassInfo,
  FlowSinkPattern,
  Frame,
  FunctionInfo,
  MemberCallee,
} from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Val } from "./flow-values.js"
import { approximate, EMPTY_VAL, flattenAtoms, mergeVals } from "./flow-values.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    // ----- calls ---------------------------------------------------------------------------------

    callbackArgs(
      this: FlowScan,
      frame: Frame,
      list: readonly TS.Expression[],
    ): (FunctionInfo | undefined)[] {
      return list.map((argument) => this.resolveCallable(frame, argument))
    },

    /**
     * The values of a call's arguments. A spread argument stands for each of the parameters from its position on (at
     * least `arity` positions), so `f(...items)` hands every parameter an element.
     */
    evalArgs(
      this: FlowScan,
      frame: Frame,
      node: { readonly arguments?: readonly TS.Expression[] },
      arity = 1,
    ): Val[] {
      // Stryker disable next-line ArrayDeclaration: equivalent -- a call written without arguments (`new C`) has none to evaluate, and a stand-in list is read as one empty argument, which binds the same.
      return (node.arguments ?? []).flatMap((argument, index) => {
        if (!ts.isSpreadElement(argument)) return [this.expr(frame, argument)]
        const element = this.iterate(frame, this.expr(frame, argument.expression), argument)
        return Array.from({ length: Math.max(arity - index, 1) }, () => element)
      })
    },

    /** The identifier a callee chain starts from (`res` in `res.status(200).json`), looking through calls, members and wrappers. */
    rootIdentifier(this: FlowScan, expression: TS.Expression): TS.Identifier | undefined {
      const root = unwrap(expression)
      if (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root))
        return this.rootIdentifier(root.expression)
      return ts.isIdentifier(root) ? root : undefined
    },

    /** A sink is named by the root of the callee chain and its last member (`res.status(200).json` is `res.json`), or by the member just before the method (`this.logger.info` is `logger.info`). */
    matchSink(this: FlowScan, callee: TS.Expression): FlowSinkPattern | undefined {
      const target = unwrap(callee)
      if (!ts.isPropertyAccessExpression(target)) return undefined
      const receiver = unwrap(target.expression)
      const root = this.rootIdentifier(target.expression)
      const wanted = [
        root === undefined ? undefined : `${root.text}.${target.name.text}`,
        ts.isPropertyAccessExpression(receiver)
          ? `${receiver.name.text}.${target.name.text}`
          : undefined,
      ]
      return this.sinks.find((pattern) => wanted.includes(pattern.callee))
    },

    call(this: FlowScan, frame: Frame, node: TS.CallExpression): Val {
      const callee = unwrap(node.expression)
      if (callee.kind === ts.SyntaxKind.ImportKeyword) return this.dynamicImport(frame, node)
      if (callee.kind === ts.SyntaxKind.SuperKeyword) {
        this.callSuper(frame, node, this.evalArgs(frame, node), node.arguments)
        return EMPTY_VAL
      }
      // Stryker disable next-line ConditionalExpression: equivalent -- only an identifier can name a reserved call (`require`, `createData`); any other callee has no text that does.
      if (ts.isIdentifier(callee)) {
        const reserved = this.reservedCall(frame, node, callee)
        if (reserved !== undefined) return reserved
      }

      const sink = this.matchSink(callee)
      if (sink !== undefined) return this.sinkCall(frame, node, sink)

      const member = memberCallee(callee, this.literalReader(frame))
      if (member !== undefined) return this.methodCall(frame, node, member)

      const target = this.resolveCallable(frame, callee)
      const args = this.evalArgs(frame, node, target?.params.length)
      const site: CallSite = { caller: frame, site: node, argExprs: node.arguments }
      if (target !== undefined) return this.analyze(site, target, args)
      return this.valueCall(frame, node, callee, args, site)
    },

    /** A call whose callee is not a declared project function: a global builtin, a capability method, a function held in a value, or something unresolved. */
    valueCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: TS.Expression,
      args: readonly Val[],
      site: CallSite,
    ): Val {
      if (ts.isIdentifier(callee) && isBuiltinGlobal(callee.text))
        return approximate(mergeVals(...args))
      if (ts.isIdentifier(callee) && callee.text === "structuredClone")
        return this.copied(frame, node, mergeVals(...args), "copy", true)
      const computed = this.expr(frame, callee)
      if (
        // Stryker disable next-line ConditionalExpression: equivalent -- a method bound to a capability always carries the capability, so this operand is implied by the next.
        computed.capability !== undefined &&
        computed.boundMethod !== undefined
      )
        return this.capabilityCall(frame, node, computed.capability, computed.boundMethod)
      const fn = this.functionOf(computed.callable)
      if (fn !== undefined) return this.analyze(site, fn, args)
      if (this.isSettler(computed)) return this.settleCall(frame, node, computed, args)
      const declared = this.declaredCall(frame, node, computed.external, args)
      if (declared !== undefined) return declared
      return this.unresolved(frame, node, undefined, args)
    },

    /** `createData(...)` and friends stay opaque; `require(...)` loads a module. `undefined` for any other name. */
    reservedCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      callee: TS.Identifier,
    ): Val | undefined {
      if (isOpaqueCallee(callee.text)) return EMPTY_VAL
      return callee.text === "require" && !frame.env.has("require")
        ? this.requireCall(frame, node)
        : undefined
    },

    /** `require("./x")` is what the module `./x` exports; any other specifier is only reported when tracked data decides it. */
    requireCall(this: FlowScan, frame: Frame, node: TS.CallExpression): Val {
      const specifier = loadedSpecifier(node)
      if (specifier === undefined) return this.dynamicImport(frame, node)
      const file = frame.fn.file.dynamicImports.get(specifier)
      return this.loaded(specifier, file)
    },

    /** What loading `specifier` gives: a project file's exports, or, for any other module, what its package exports. */
    loaded(this: FlowScan, specifier: string, file: string | undefined): Val {
      // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent -- a module the scan skipped (a generated file) reads as an empty value, which is called as unresolved exactly as the package it stands in for is.
      return file !== undefined && this.files.has(file)
        ? this.moduleExports(file)
        : externalVal(specifier, "*")
    },

    /** What `require` hands back for a project file: its `export`s, and whatever it stored on `exports` and `module.exports`. */
    moduleExports(this: FlowScan, file: string): Val {
      const info = this.files.get(file)
      // Stryker disable next-line ConditionalExpression: equivalent -- only a file the scan has is loaded, so its info is there; the check only satisfies the type checker.
      if (info === undefined) return EMPTY_VAL
      this.ensureModule(info)
      const written = mergeVals(
        info.moduleEnv.lookup("exports"),
        info.moduleEnv.lookup("module").props.get("exports") ?? EMPTY_VAL,
      )
      return mergeVals({ ...EMPTY_VAL, namespace: file }, written)
    },

    /** A call that sends its arguments through a boundary. */
    sinkCall(this: FlowScan, frame: Frame, node: TS.CallExpression, sink: FlowSinkPattern): Val {
      const args = this.evalArgs(frame, node)
      const sent = this.materialize(frame, mergeVals(...args), node)
      // The boundary only exists in the model when tracked data actually reaches it.
      if (flattenAtoms(sent).length > 0) {
        this.sink(
          frame,
          sent,
          { kind: "boundary", id: this.codeBoundary(sink.boundary), handling: sink.handling },
          node,
        )
      }
      return EMPTY_VAL
    },

    /** `new C(...)`: the constructor of a project class runs on a fresh instance; a builtin the scan models is built; anything else is a call the analysis cannot follow. */
    newExpression(this: FlowScan, frame: Frame, node: TS.NewExpression): Val {
      const builtin = this.builtinNew(frame, node)
      if (builtin !== undefined) return builtin
      const target = this.expr(frame, node.expression)
      const constructor = this.constructorOf(target)
      const args = this.evalArgs(frame, node, constructor?.params.length)
      // Stryker disable next-line ArrayDeclaration: equivalent -- the expressions of the arguments are only where a callee's stores are written back to; with no arguments there is nothing to write back.
      return this.construct(frame, node, target, args, node.arguments ?? [])
    },

    /** The function that runs when `target` is constructed: a project class's constructor, or a plain function. */
    constructorOf(this: FlowScan, target: Val): FunctionInfo | undefined {
      const cls = this.classFor(target.classRef)
      if (cls !== undefined) return cls.ctor
      const fn = this.functionOf(target.callable)
      return fn?.node === undefined || ts.isArrowFunction(fn.node) ? undefined : fn
    },

    /** `new target(...args)`, for a class or for a function written as a constructor. */
    construct(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      target: Val,
      args: readonly Val[],
      argExprs: readonly TS.Expression[],
    ): Val {
      const cls = this.classFor(target.classRef)
      if (cls !== undefined)
        return this.analyze({ caller: frame, site: node, argExprs }, cls.ctor, args, {
          thisVal: this.fresh(frame, node, { ...EMPTY_VAL, instance: cls.key }),
          construct: cls,
        })
      const fn = this.constructorOf(target)
      if (fn === undefined) return this.unresolved(frame, node, undefined, args)
      // Its instances answer to whatever was stored on its `prototype`.
      const instance: Val = this.fresh(frame, node, {
        ...EMPTY_VAL,
        props: new Map(target.props.get("prototype")?.props),
      })
      return this.analyze({ caller: frame, site: node, argExprs }, fn, args, {
        thisVal: instance,
        constructs: true,
      })
    },

    /** `import("./x.js")` loads a project module; any other specifier is only reported when tracked data decides it. */
    dynamicImport(this: FlowScan, frame: Frame, node: TS.CallExpression): Val {
      const args = this.evalArgs(frame, node)
      const specifier = node.arguments[0] === undefined ? undefined : unwrap(node.arguments[0])
      if (specifier !== undefined && ts.isStringLiteralLike(specifier)) {
        const file = frame.fn.file.dynamicImports.get(specifier.text)
        // Stryker disable next-line ConditionalExpression: equivalent -- a namespace of no file reads as an empty value.
        return file === undefined ? EMPTY_VAL : { ...EMPTY_VAL, namespace: file }
      }
      const atoms = this.atomsOf(frame, mergeVals(...args), node)
      if (atoms.length > 0)
        this.unknown(
          frame.fn,
          "unresolved-import",
          node,
          "module specifier is computed from tracked data",
          atoms,
        )
      return EMPTY_VAL
    },

    methodCall(this: FlowScan, frame: Frame, node: TS.CallExpression, callee: MemberCallee): Val {
      const name = callee.name.text
      const base = unwrap(callee.expression)
      if (base.kind === ts.SyntaxKind.SuperKeyword) return this.superMethodCall(frame, node, name)
      const rootName = ts.isIdentifier(base) ? base.text : String(base.kind)

      const method =
        name === "call"
          ? prototypeMethod(callee.expression, (shadow) => frame.env.has(shadow))
          : undefined
      if (method !== undefined) return this.prototypeCall(frame, node, method)

      const namespaceFile = this.namespaceFile(frame.fn.file, rootName)
      if (namespaceFile !== undefined)
        return this.namespaceCall(frame, node, namespaceFile, rootName, name)

      if (!frame.env.has(rootName) && isBuiltinRoot(rootName))
        return this.builtinCall(frame, node, rootName, name)

      const receiver = this.expr(frame, callee.expression)

      if (receiver.capability !== undefined && receiver.boundMethod === undefined)
        return this.capabilityCall(frame, node, receiver.capability, name)

      const member = this.resolveMember(receiver, name)
      if (member === "opaque")
        return this.unresolved(frame, node, receiver, this.evalArgs(frame, node))
      if (member !== undefined) {
        const args = this.evalArgs(frame, node, member.params.length)
        const site: CallSite = {
          caller: frame,
          site: node,
          argExprs: node.arguments,
          receiver: callee.expression,
        }
        return this.analyze(site, member, args, { thisVal: receiver })
      }
      return this.valueMethodCall(frame, node, callee, receiver, name)
    },

    /** `ns.name(...)` on an imported module: an export of a project module, or, for a package, whatever its declared summary says. */
    namespaceCall(
      this: FlowScan,
      frame: Frame,
      node: TS.CallExpression,
      namespaceFile: string,
      rootName: string,
      name: string,
    ): Val {
      const exported = this.findExport(namespaceFile, name)
      const args = this.evalArgs(frame, node, exported?.params.length)
      if (exported !== undefined)
        return this.analyze({ caller: frame, site: node, argExprs: node.arguments }, exported, args)
      const imported = frame.fn.file.packageImports.get(rootName)
      const external =
        // Stryker disable next-line ConditionalExpression: equivalent -- a namespace the file imports was recorded as an import first, so `imported` is always there; the check only satisfies the type checker.
        imported === undefined
          ? undefined
          : externalKey(externalMember(`${imported.module}\u0000${imported.name}`, name))
      return (
        this.declaredCall(frame, node, external, args) ??
        this.unresolved(frame, node, undefined, args)
      )
    },

    /** The project function a method call on `receiver` runs: a module's export, a class's method, a function stored under that name. */
    resolveMember(
      this: FlowScan,
      receiver: Val,
      name: string,
    ): FunctionInfo | "opaque" | undefined {
      const exported =
        // Stryker disable next-line ConditionalExpression: equivalent -- a value that is no namespace has no file whose exports could hold the name, so the lookup finds none, as the check does.
        receiver.namespace === undefined ? undefined : this.findExport(receiver.namespace, name)
      if (exported !== undefined) return exported
      const own = this.functionOf(receiver.props.get(name)?.callable)
      if (own !== undefined) return own
      const cls = this.classFor(receiver.instance ?? receiver.classRef)
      if (cls === undefined) return undefined
      return this.methodOf(cls, receiver.instance === undefined, name)
    },

    /** The method a class answers to under `name`: one it declares, or one stored on its `prototype` from outside its body. */
    methodOf(
      this: FlowScan,
      cls: ClassInfo,
      isStatic: boolean,
      name: string,
    ): FunctionInfo | "opaque" | undefined {
      const declared = this.findMember(cls, "method", isStatic, name)
      if (isStatic || (declared !== undefined && declared !== "opaque")) return declared
      return this.functionOf(this.mixedIn(cls, name)?.callable) ?? declared
    },

    /** What `Class.prototype.name = ...` and `Object.assign(Class.prototype, ...)` stored for `cls` or a superclass. */
    mixedIn(this: FlowScan, cls: ClassInfo, name: string): Val | undefined {
      for (const owner of this.chain(cls)) {
        const className = owner.node.name?.text
        // Stryker disable next-line ConditionalExpression: equivalent -- a class without a name is bound to no name, so looking one up finds nothing, as the check does.
        const bound = className === undefined ? undefined : owner.env.get(className)
        const stored =
          bound?.classRef === owner.key ? bound.props.get("prototype")?.props.get(name) : undefined
        if (stored !== undefined) return stored
      }
      return undefined
    },
  }
}
