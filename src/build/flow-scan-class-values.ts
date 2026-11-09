/**
 * Classes and functions as values at run time. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import {
  Env,
  externalVal,
  hasModifier,
  isFunctionLikeNode,
  memberCallee,
  memberKey,
  memberName,
  unwrap,
} from "./flow-scan-helpers.js"
import type {
  ClassInfo,
  ClassLike,
  ExportTarget,
  FileInfo,
  Frame,
  FunctionInfo,
  FunctionLike,
} from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Val } from "./flow-values.js"
import { EMPTY_VAL, flattenAtoms } from "./flow-values.js"
import { positionOf } from "./source-position.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    // ----- classes at run time -------------------------------------------------------------------

    /** The class a class expression or a class declared inside a function evaluates to: a new one each time, as it captures the variables of that very evaluation. */
    classValue(this: FlowScan, frame: Frame, node: ClassLike): Val {
      const name = node.name?.text ?? `anonymous@${positionOf(frame.fn.file.sourceFile, node).line}`
      const cls = this.makeClass(
        frame.fn.file,
        `${frame.fn.name}>${name}`,
        node,
        frame.env,
        String(this.classes.size),
      )
      if (!frame.root)
        for (const member of cls.members.values())
          if (member.instance !== undefined) this.madeByCalls.set(member.instance, this.round)
      this.applyDecorators(cls)
      return cls.replacement ?? { ...EMPTY_VAL, classRef: cls.key }
    },

    /** The class `extends` names: a project class, "opaque" for anything else (a package, a call), "none" when there is no `extends`. */
    parentOf(this: FlowScan, cls: ClassInfo): ClassInfo | "opaque" | "none" {
      // Stryker disable next-line ConditionalExpression: equivalent -- the answer is only kept so it is not worked out again; working it out again gives the same one.
      if (cls.parent !== undefined) return cls.parent
      const clause = cls.node.heritageClauses?.find(
        (candidate) => candidate.token === ts.SyntaxKind.ExtendsKeyword,
      )
      // Stryker disable next-line OptionalChaining: equivalent -- an `extends` clause names at least one type, so the first is always there.
      const base = clause?.types[0]?.expression
      cls.parent = base === undefined ? "none" : this.classNamed(cls, unwrap(base))
      return cls.parent
    },

    classNamed(this: FlowScan, cls: ClassInfo, base: TS.Expression): ClassInfo | "opaque" {
      if (ts.isIdentifier(base)) {
        const named = cls.env.get(base.text) ?? this.importedVal(cls.file, base.text)
        return this.classFor(named.classRef) ?? "opaque"
      }
      // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent -- any other shape of base (a call, a deeper member) names no file's export, and looking one up by its text finds nothing, so the class is `opaque` either way.
      if (ts.isPropertyAccessExpression(base) && ts.isIdentifier(base.expression)) {
        const file = this.namespaceFile(cls.file, base.expression.text)
        // Stryker disable next-line ConditionalExpression: equivalent -- a name that is no namespace has no file whose exports could hold the class, so the lookup finds none, as the check does.
        const target = file === undefined ? undefined : this.lookupExport(file, base.name.text)
        const found = target === undefined ? EMPTY_VAL : this.targetVal(target)
        return this.classFor(found.classRef) ?? "opaque"
      }
      return "opaque"
    },

    /** The class and its project superclasses, nearest first. A cycle or an overlong chain ends it. */
    chain(this: FlowScan, cls: ClassInfo): ClassInfo[] {
      const out: ClassInfo[] = []
      for (
        let current: ClassInfo | "opaque" | "none" = cls;
        current !== "opaque" &&
        current !== "none" &&
        out.length < this.limits.maxExportHops * 4 &&
        !out.includes(current);
        current = this.parentOf(current)
      )
        out.push(current)
      return out
    },

    /** The method or accessor `cls` or a superclass declares; "opaque" when the chain ends at a class the analysis cannot read before one is found. */
    findMember(
      this: FlowScan,
      cls: ClassInfo,
      kind: "method" | "get" | "set",
      isStatic: boolean,
      name: string,
    ): FunctionInfo | "opaque" | undefined {
      const owners = this.chain(cls)
      for (const owner of owners) {
        // A decorator the scan cannot follow may have replaced the member, or the class.
        if (owner.opaqueClass || owner.opaque.has(memberKey(kind, isStatic, name))) return "opaque"
        const fn = owner.members.get(memberKey(kind, isStatic, name))
        if (fn !== undefined) return fn
      }
      const last = owners[owners.length - 1]
      return last !== undefined && this.parentOf(last) === "opaque" ? "opaque" : undefined
    },

    /** Whether a decorator the scan cannot follow may have replaced this member (or the class that has it). */
    isDecorated(
      this: FlowScan,
      cls: ClassInfo,
      kind: "method" | "get" | "set",
      isStatic: boolean,
      name: string,
    ): boolean {
      return this.chain(cls).some(
        (owner) => owner.opaqueClass || owner.opaque.has(memberKey(kind, isStatic, name)),
      )
    },

    /** The static fields of a class, computed once (running its static initializers and blocks). */
    classStatics(this: FlowScan, cls: ClassInfo): ReadonlyMap<string, Val> {
      if (cls.staticVals !== undefined) return cls.staticVals
      const vals = new Map<string, Val>()
      cls.staticVals = vals
      if (cls.staticFn === undefined) return vals
      this.ensureModule(cls.file)
      const frame = this.frame(cls.staticFn, new Env(cls.env, true), 1)
      frame.env.set("this", { ...EMPTY_VAL, classRef: cls.key })
      for (const member of cls.statics) {
        if (ts.isClassStaticBlockDeclaration(member)) {
          this.statements(frame, member.body.statements)
        } else {
          const name = memberName(member.name)
          const value = this.expr(frame, member.initializer)
          if (name !== undefined) vals.set(name, value)
        }
      }
      return vals
    },

    /** A constructor run for a fresh instance starts its class: a base class initializes its fields now, a derived one when it calls `super`. */
    beginConstruct(this: FlowScan, frame: Frame, cls: ClassInfo, bound: readonly Val[]): void {
      const parent = this.parentOf(cls)
      if (parent === "none") {
        this.initInstance(frame, cls)
      } else if (frame.fn.node === undefined) {
        // An implicit constructor hands every argument to its superclass.
        this.callSuper(frame, cls.node, bound, [])
      }
    },

    /** The parameter properties and field initializers of `cls`, stored on `this`. */
    initInstance(this: FlowScan, frame: Frame, cls: ClassInfo): void {
      for (const param of cls.ctor.params) {
        if (
          ts.isIdentifier(param.name) &&
          (hasModifier(param, ts.SyntaxKind.PublicKeyword) ||
            hasModifier(param, ts.SyntaxKind.PrivateKeyword) ||
            hasModifier(param, ts.SyntaxKind.ProtectedKeyword) ||
            hasModifier(param, ts.SyntaxKind.ReadonlyKeyword))
        )
          this.initMember(frame, param, param.name.text, frame.env.lookup(param.name.text))
      }
      for (const field of cls.fields) {
        const name = memberName(field.name)
        const value = this.expr(frame, field.initializer)
        if (name !== undefined) this.initMember(frame, field, name, value)
      }
    },

    /**
     * Stores one member on `this`. Data it holds is also stored in the shared contents of the object `this` is, as
     * `this.name = value` does, so a method that nothing in the project calls on an instance still finds it; a function
     * is not, since it would lose its callable when read back from there.
     */
    initMember(this: FlowScan, frame: Frame, site: TS.Node, name: string, value: Val): void {
      this.storeMember(frame, "this", [name], value)
      if (flattenAtoms(value).length > 0)
        this.storeShared(frame, site, frame.env.lookup("this"), {
          ...EMPTY_VAL,
          props: new Map([[name, value]]),
        })
    },

    /** `super(...)`: the superclass constructor runs on this very instance, then this class's own fields are initialized. */
    callSuper(
      this: FlowScan,
      frame: Frame,
      site: TS.Node,
      args: readonly Val[],
      argExprs: readonly TS.Expression[],
    ): void {
      const cls = frame.fn.cls
      if (cls === undefined) return
      const parent = this.parentOf(cls)
      if (parent === "opaque") {
        this.assignName(frame, "this", this.unresolved(frame, site, undefined, args))
      } else if (parent !== "none") {
        const result = this.analyze({ caller: frame, site, argExprs }, parent.ctor, args, {
          thisVal: frame.env.lookup("this"),
          construct: parent,
        })
        this.assignName(frame, "this", result)
      }
      this.initInstance(frame, cls)
    },

    // ----- functions as values -------------------------------------------------------------------

    nestedFunction(
      this: FlowScan,
      frame: Frame,
      node: FunctionLike,
      hint: string | undefined,
    ): FunctionInfo {
      const known = this.nestedByNode.get(node)
      if (known !== undefined) return known
      const position = positionOf(frame.fn.file.sourceFile, node)
      const name = `${frame.fn.name}>${hint ?? "anonymous"}@${position.line}:${position.column}`
      const fn = this.makeFunction(frame.fn.file, name, node)
      fn.closureEnv = frame.env
      this.nestedByNode.set(node, fn)
      this.closureKeys.add(fn.key)
      this.queue.push(fn)
      return fn
    },

    /**
     * A closure value. The same code evaluated in two different scopes makes two different closures -- `mk(a)` and
     * `mk(b)` do not share what they captured -- so each gets its own token, and the token its own scope.
     */
    closureToken(
      this: FlowScan,
      frame: Frame,
      node: FunctionLike,
      hint: string | undefined,
    ): string {
      const canonical = this.nestedFunction(frame, node, hint)
      const known = this.instanceTokens.get(frame.env) ?? new Map<string, string>()
      this.instanceTokens.set(frame.env, known)
      const existing = known.get(canonical.key)
      if (existing !== undefined) return existing
      const token = `${canonical.key}\u0000${this.instances.size}`
      this.instances.set(token, { ...canonical, closureEnv: frame.env, instance: token })
      this.closureKeys.add(token)
      // A function analyzed on its own has no arguments: what it makes is covered by the closure run with it, not by this one.
      if (!frame.root) this.madeByCalls.set(token, this.round)
      known.set(canonical.key, token)
      return token
    },

    functionValue(this: FlowScan, frame: Frame, node: FunctionLike, hint?: string): Val {
      return { ...EMPTY_VAL, callable: this.closureToken(frame, node, hint) }
    },

    /** The function a value's `callable` token stands for. */
    functionOf(this: FlowScan, token: string | undefined): FunctionInfo | undefined {
      if (token === undefined) return undefined
      return this.instances.get(token) ?? this.functions.get(token)
    },

    resolveCallable(
      this: FlowScan,
      frame: Frame,
      expression: TS.Expression,
    ): FunctionInfo | undefined {
      const target = unwrap(expression)
      if (isFunctionLikeNode(target))
        return this.functionOf(this.closureToken(frame, target, undefined))
      if (ts.isIdentifier(target)) {
        const local = frame.env.get(target.text)
        if (local?.callable !== undefined) return this.functionOf(local.callable)
        if (frame.env.has(target.text)) return undefined
        return this.resolveByName(frame.fn.file, target.text)
      }
      if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.expression)) {
        const namespace = this.namespaceFile(frame.fn.file, target.expression.text)
        // Stryker disable next-line ConditionalExpression: equivalent -- `findExport` of a missing file finds no exports, so skipping it and calling it with `undefined` give the same result.
        if (namespace !== undefined) return this.findExport(namespace, target.name.text)
      }
      if (ts.isPropertyAccessExpression(target)) {
        // A method read off an object or an instance (`handler.send`), passed along as a callback.
        return this.functionOf(this.expr(frame, target).callable)
      }
      // A function made by `bind`, passed along as a callback.
      if (
        ts.isCallExpression(target) &&
        memberCallee(unwrap(target.expression), this.literalReader(frame))?.name.text === "bind"
      )
        return this.functionOf(this.expr(frame, target).callable)
      return undefined
    },

    resolveByName(this: FlowScan, file: FileInfo, name: string): FunctionInfo | undefined {
      const target = this.resolveName(file, name)
      return target?.kind === "function" ? target.fn : undefined
    },

    /** What a name that is not a local variable stands for in `file`: a function or class it declares, or something it imports. */
    resolveName(this: FlowScan, file: FileInfo, name: string): ExportTarget | undefined {
      const fn = file.topFunctions.get(name)
      if (fn !== undefined) return { kind: "function", fn }
      const cls = file.topClasses.get(name)
      if (cls !== undefined) return { kind: "class", cls }
      const imported = file.resolvedImports.get(name)
      if (imported !== undefined) return this.lookupExport(imported.file, imported.name)
      const namespace = file.namespaces.get(name)
      return namespace === undefined ? undefined : { kind: "namespace", file: namespace }
    },

    /** The module a name refers to when it is `import * as name` or an `export * as name` import. */
    namespaceFile(this: FlowScan, file: FileInfo, name: string): string | undefined {
      const direct = file.namespaces.get(name)
      if (direct !== undefined) return direct
      const imported = file.resolvedImports.get(name)
      const target =
        imported === undefined ? undefined : this.lookupExport(imported.file, imported.name)
      return target?.kind === "namespace" ? target.file : undefined
    },

    importedVal(this: FlowScan, file: FileInfo, name: string): Val {
      const target = this.resolveName(file, name)
      if (target !== undefined) return this.targetVal(target)
      const imported = file.packageImports.get(name)
      return imported === undefined ? EMPTY_VAL : externalVal(imported.module, imported.name)
    },

    targetVal(this: FlowScan, target: ExportTarget): Val {
      switch (target.kind) {
        case "function":
          return this.homeVal(target) ?? { ...EMPTY_VAL, callable: target.fn.key }
        case "class":
          return (
            target.cls.replacement ??
            this.homeVal(target) ?? { ...EMPTY_VAL, classRef: target.cls.key }
          )
        case "namespace":
          return { ...EMPTY_VAL, namespace: target.file }
        case "value":
          this.ensureModule(target.file)
          return target.file.moduleEnv.lookup(target.name)
      }
    },

    findExport(this: FlowScan, file: string, name: string): FunctionInfo | undefined {
      const target = this.lookupExport(file, name)
      return target?.kind === "function" ? target.fn : undefined
    },

    /**
     * Follows `export { name } from`, `export * from` and `export * as ns from` hops from `file` to what is finally
     * declared. At most `limits.maxExportHops` files are visited on a route, so a cycle of re-exports ends the search rather
     * than the process.
     */
    lookupExport(
      this: FlowScan,
      file: string | undefined,
      name: string,
      depth = 1,
      seen = new Map<string, number>(),
    ): ExportTarget | undefined {
      const info = this.files.get(file)
      const mark = `${file}\u0000${name}`
      const earlier = seen.get(mark)
      if (
        depth > this.limits.maxExportHops ||
        info === undefined ||
        (earlier !== undefined && earlier <= depth)
      )
        return undefined
      seen.set(mark, depth)
      const ref = info.exports.get(name)
      if (ref !== undefined) {
        if (ref.file === undefined) return this.localTarget(ref.owner, ref.name)
        if (ref.name === "*")
          return this.files.has(ref.file) ? { kind: "namespace", file: ref.file } : undefined
        return this.lookupExport(ref.file, ref.name, depth + 1, seen)
      }
      // `export *` carries every name but `default`.
      if (name === "default") return undefined
      for (const star of info.stars) {
        const found = this.lookupExport(star, name, depth + 1, seen)
        if (found !== undefined) return found
      }
      return undefined
    },

    localTarget(this: FlowScan, owner: FileInfo, name: string): ExportTarget | undefined {
      const fn = owner.topFunctions.get(name)
      if (fn !== undefined) return { kind: "function", fn }
      const cls = owner.topClasses.get(name)
      if (cls !== undefined) return { kind: "class", cls }
      return owner.valueNames.has(name) ? { kind: "value", file: owner, name } : undefined
    },
  }
}
