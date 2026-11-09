/**
 * Statements, binding, and assignment. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import type { Env } from "./flow-scan-helpers.js"
import {
  accessorKey,
  bindingNames,
  externalMember,
  externalVal,
  hasModifier,
  holdsFields,
  holdsPromise,
  isReferenceExpression,
  keyOf,
  loadedSpecifier,
  memberChain,
  unwrap,
} from "./flow-scan-helpers.js"
import type { ClassInfo, ExportTarget, FileInfo, Frame, FunctionInfo } from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Atom, Val } from "./flow-values.js"
import {
  accessDynamic,
  accessKey,
  ANY_KEY,
  approximate,
  atomVal,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  mergeVals,
  signatureOf,
  withoutAlloc,
} from "./flow-values.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    // ----- statements ----------------------------------------------------------------------------

    /** Function declarations are hoisted: they can be called before the line that declares them. */
    statements(this: FlowScan, frame: Frame, list: readonly TS.Statement[]): void {
      const declaresFunction = (statement: TS.Statement): boolean =>
        ts.isFunctionDeclaration(statement) && statement.body !== undefined
      for (const statement of list)
        if (declaresFunction(statement)) this.statement(frame, statement)
      // Stryker disable next-line ConditionalExpression: equivalent -- a function declaration run again in the second pass is declared again under the same name, which changes nothing.
      for (const statement of list)
        if (!declaresFunction(statement)) this.statement(frame, statement)
    },

    statement(this: FlowScan, frame: Frame, node: TS.Statement): void {
      if (!this.step()) return
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations)
          this.declare(frame, declaration, node.declarationList)
      } else if (ts.isExpressionStatement(node)) {
        this.expr(frame, node.expression)
      } else if (ts.isReturnStatement(node)) {
        this.returnValue(frame, this.expr(frame, node.expression), node)
      } else if (ts.isIfStatement(node)) {
        this.expr(frame, node.expression)
        this.statement(frame, node.thenStatement)
        if (node.elseStatement !== undefined) this.statement(frame, node.elseStatement)
      } else if (ts.isBlock(node)) {
        this.statements(this.scoped(frame), node.statements)
      } else if (ts.isLabeledStatement(node)) {
        this.statement(frame, node.statement)
      } else if (ts.isThrowStatement(node)) {
        const thrown = this.expr(frame, node.expression)
        frame.thrown.push(thrown)
        this.sink(frame, thrown, { kind: "return" }, node)
      } else if (ts.isTryStatement(node)) {
        this.tryStatement(frame, node)
      } else if (ts.isSwitchStatement(node)) {
        this.expr(frame, node.expression)
        const inner = this.scoped(frame)
        for (const clause of node.caseBlock.clauses) {
          this.expr(inner, ts.isCaseClause(clause) ? clause.expression : undefined)
          this.statements(inner, clause.statements)
        }
      } else {
        this.loopOrDeclaration(frame, node)
      }
    },

    loopOrDeclaration(this: FlowScan, frame: Frame, node: TS.Statement): void {
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        this.forInOf(frame, node)
      } else if (ts.isForStatement(node)) {
        this.forLoop(frame, node)
      } else if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
        this.expr(frame, node.expression)
        this.statement(frame, node.statement)
      } else {
        this.declarationStatement(frame, node)
      }
    },

    forInOf(this: FlowScan, frame: Frame, node: TS.ForOfStatement | TS.ForInStatement): void {
      const inner = this.scoped(frame)
      const iterable = this.expr(frame, node.expression)
      const element = ts.isForOfStatement(node) ? this.iterated(frame, iterable, node) : EMPTY_VAL
      if (ts.isVariableDeclarationList(node.initializer)) {
        for (const declaration of node.initializer.declarations) {
          for (const name of bindingNames(declaration.name)) inner.aliased.add(name)
          this.bind(inner, declaration.name, element, this.scopeFor(inner, node.initializer))
        }
      } else {
        this.assign(inner, node.initializer, element)
      }
      this.statement(inner, node.statement)
    },

    /** What `for...of` binds: each element, and, in `for await`, the value an element that is a promise settles with. */
    iterated(this: FlowScan, frame: Frame, iterable: Val, node: TS.ForOfStatement): Val {
      const element = this.iterate(frame, iterable, node)
      return node.awaitModifier === undefined ? element : this.unwrapPromise(frame, element, node)
    },

    forLoop(this: FlowScan, frame: Frame, node: TS.ForStatement): void {
      const inner = this.scoped(frame)
      if (node.initializer !== undefined) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          for (const declaration of node.initializer.declarations)
            this.declare(inner, declaration, node.initializer)
        } else {
          this.expr(inner, node.initializer)
        }
      }
      this.expr(inner, node.condition)
      this.expr(inner, node.incrementor)
      this.statement(inner, node.statement)
    },

    declarationStatement(this: FlowScan, frame: Frame, node: TS.Statement): void {
      // Stryker disable next-line ConditionalExpression: equivalent -- only `export default function () {}` has no name, and the module's index declares that one; a statement inside a function always has its name. The check narrows the type.
      if (ts.isFunctionDeclaration(node) && node.name !== undefined && node.body !== undefined) {
        frame.env.set(node.name.text, this.functionValue(frame, node, node.name.text))
      } else if (
        ts.isClassDeclaration(node) &&
        // Stryker disable next-line ConditionalExpression: equivalent -- only `export default class {}` has no name, and the module's index declares that one; a statement inside a function always has its name.
        node.name !== undefined &&
        !hasModifier(node, ts.SyntaxKind.DeclareKeyword)
      ) {
        frame.env.set(node.name.text, this.classValue(frame, node))
      } else if (ts.isImportEqualsDeclaration(node)) {
        const specifier = loadedSpecifier(node)
        const file =
          specifier === undefined ? undefined : frame.fn.file.dynamicImports.get(specifier)
        frame.env.set(
          node.name.text,
          specifier === undefined ? EMPTY_VAL : this.loaded(specifier, file),
        )
      } else if (ts.isExportAssignment(node)) {
        frame.env.set("default", this.expr(frame, node.expression))
      } else if (ts.isWithStatement(node)) {
        this.withStatement(frame, node)
      } else if (ts.isEnumDeclaration(node)) {
        for (const member of node.members) this.expr(frame, member.initializer)
      }
    },

    /** `with (object) { ... }` makes every name in the block a possible property of `object`: nothing in it can be resolved when `object` holds tracked data. */
    withStatement(this: FlowScan, frame: Frame, node: TS.WithStatement): void {
      const scope = this.expr(frame, node.expression)
      this.flagStore(
        frame,
        node,
        this.atomsOf(frame, scope, node),
        "names inside a with statement may be properties of tracked data",
      )
      this.statement(frame, node.statement)
    },

    /** `var` lands in the function's own scope, `let` and `const` in the scope they are written in. */
    scopeFor(this: FlowScan, frame: Frame, list: TS.VariableDeclarationList): Env {
      return (list.flags & ts.NodeFlags.BlockScoped) === 0 ? frame.fnEnv : frame.env
    },

    /** `try` / `catch` / `finally`: the catch variable holds whatever the try block threw, directly or through a call. */
    tryStatement(this: FlowScan, frame: Frame, node: TS.TryStatement): void {
      const before = frame.thrown.length
      this.statements(this.scoped(frame), node.tryBlock.statements)
      if (node.catchClause !== undefined) {
        // What the try block threw is caught here; only what the handler throws goes on.
        const caught = mergeVals(...frame.thrown.splice(before))
        const handler = this.scoped(frame)
        if (node.catchClause.variableDeclaration !== undefined)
          this.bind(handler, node.catchClause.variableDeclaration.name, caught)
        this.statements(handler, node.catchClause.block.statements)
      }
      if (node.finallyBlock !== undefined)
        this.statements(this.scoped(frame), node.finallyBlock.statements)
    },

    declare(
      this: FlowScan,
      frame: Frame,
      declaration: TS.VariableDeclaration,
      list: TS.VariableDeclarationList,
    ): void {
      if (ts.isIdentifier(declaration.name)) {
        if (isReferenceExpression(declaration.initializer)) frame.aliased.add(declaration.name.text)
      } else {
        for (const name of bindingNames(declaration.name)) frame.aliased.add(name)
      }
      const env = this.scopeFor(frame, list)
      const value = this.expr(frame, declaration.initializer)
      this.bind(frame, declaration.name, value, env)
      this.rememberText(frame, declaration, list, env)
      this.noteUnusedDerivation(frame, declaration, value)
    },

    /** `const k = "name"`: remembers the string, so `o[k]` reads the property `name`. */
    rememberText(
      this: FlowScan,
      frame: Frame,
      declaration: TS.VariableDeclaration,
      list: TS.VariableDeclarationList,
      env: Env,
    ): void {
      if ((list.flags & ts.NodeFlags.Const) === 0 || !ts.isIdentifier(declaration.name)) return
      const text =
        declaration.initializer === undefined
          ? undefined
          : this.literalReader(frame)(declaration.initializer)
      // Stryker disable next-line ConditionalExpression: equivalent -- a text of `undefined` recorded for a name reads back as no text, exactly as not recording one does.
      if (text !== undefined) env.setText(declaration.name.text, text)
    },

    // ----- binding -------------------------------------------------------------------------------

    bind(
      this: FlowScan,
      frame: Frame,
      name: TS.BindingName,
      value: Val,
      env: Env = frame.env,
    ): void {
      if (ts.isIdentifier(name)) {
        env.set(name.text, value)
      } else if (ts.isObjectBindingPattern(name)) {
        for (const element of name.elements) {
          if (element.dotDotDotToken !== undefined) {
            // The rest of an object is a new object holding what is left of it.
            this.bind(
              frame,
              element.name,
              this.fresh(frame, element, withoutAlloc(approximate(value))),
              env,
            )
            continue
          }
          const key =
            element.propertyName === undefined ? keyOf(element.name) : keyOf(element.propertyName)
          const part =
            key === undefined
              ? accessDynamic(this.materialize(frame, value, element))
              : this.accessMember(frame, value, key, element)
          this.bind(
            frame,
            element.name,
            mergeVals(part, this.expr(frame, element.initializer)),
            env,
          )
        }
      } else {
        name.elements.forEach((element) => {
          if (ts.isOmittedExpression(element)) return
          const part =
            element.dotDotDotToken !== undefined ? value : this.iterate(frame, value, element)
          this.bind(frame, element.name, part, env)
        })
      }
    },

    /** What iterating `val` yields: an instance that defines `[Symbol.iterator]` answers with its generator, anything else with its elements. */
    iterate(this: FlowScan, frame: Frame, val: Val, site: TS.Node): Val {
      const cls = this.classFor(val.instance)
      const method =
        cls === undefined
          ? this.functionOf(
              (val.props.get("[Symbol.iterator]") ?? val.props.get("[Symbol.asyncIterator]"))
                ?.callable,
            )
          : this.iteratorMethod(cls)
      if (method === undefined) return this.accessMember(frame, val, ELEMENT_KEY, site)
      const generator = this.analyze({ caller: frame, site }, method, [], { thisVal: val })
      return this.accessMember(frame, generator, ELEMENT_KEY, site)
    },

    iteratorMethod(this: FlowScan, cls: ClassInfo): FunctionInfo | undefined {
      for (const name of ["[Symbol.iterator]", "[Symbol.asyncIterator]"]) {
        const found = this.findMember(cls, "method", false, name)
        if (found !== undefined && found !== "opaque") return found
      }
      return undefined
    },

    /**
     * Replaces every capability, and every capability `fields` object, inside `val` by the data of all its fields: they are
     * lazy (a field is only read when asked for), so anything that takes the whole object -- a sink, an unresolved call
     * (which can call `getSnapshot()` on a capability it is handed), a computed key -- gets every field, each read here.
     */
    materialize(this: FlowScan, frame: Frame, given: Val, site: TS.Node): Val {
      // What a promise settles with is data that goes wherever the promise goes.
      const val = this.unwrapPromise(frame, given, site)
      // Stryker disable next-line ConditionalExpression: equivalent -- a value that holds neither would be rebuilt below with the same properties and no capability to expand, so returning it early only avoids the copy.
      if (!holdsFields(val) && !holdsPromise(val)) return val
      const props = new Map<string, Val>()
      for (const [key, child] of val.props) props.set(key, this.materialize(frame, child, site))
      const base: Val = { ...val, props }
      const cap = this.capFor(val.fieldsOf ?? val.capability)
      if (cap === undefined) return base
      const lazy: Val = { ...EMPTY_VAL, fieldsOf: cap.key }
      const fields = [...cap.fieldIds.keys()].map((key) =>
        this.accessMember(frame, lazy, key, site),
      )
      // A transformation that touched the lazy value (a JSON round trip, a template) made what it holds approximate.
      return mergeVals(base, ...(val.inexact === true ? fields.map(approximate) : fields))
    },

    /** Every atom `val` holds, counting the fields of a whole capability `fields` object. */
    atomsOf(this: FlowScan, frame: Frame, val: Val, site: TS.Node): Atom[] {
      return flattenAtoms(this.materialize(frame, val, site))
    },

    accessMember(this: FlowScan, frame: Frame, receiver: Val, key: string, site: TS.Node): Val {
      if (receiver.fieldsOf !== undefined) {
        const cap = this.caps.get(receiver.fieldsOf)
        const origin = cap?.fieldIds.get(key)
        if (origin === undefined) return EMPTY_VAL
        const atom: Atom = {
          origin,
          path: [],
          approx: false,
          entry: { kind: "read" },
          entryPath: [],
        }
        const val = atomVal(atom)
        this.noteEntry(frame.fn, val)
        // The function reads this field, whatever it later does with it. Without the edge, a field handed straight
        // to code the analysis cannot follow would leave the function out of every trace, and the unknown with it.
        this.emitEntry(frame.fn, atom, site)
        return val
      }
      if (receiver.capability !== undefined) return this.capabilityMember(receiver.capability, key)
      const special = this.accessSpecial(frame, receiver, key, site)
      if (special !== undefined) return special
      const result = accessKey(receiver, key)
      this.touch(frame.fn, result, site)
      // What a package exports has members of its own, besides any data the same value holds.
      return receiver.external === undefined
        ? result
        : mergeVals(result, externalVal(...externalMember(receiver.external, key)))
    },

    /** `data.fields` is the capability's fields; a method read without being called stays attached to its capability so a later call still counts. */
    capabilityMember(this: FlowScan, capKey: string, key: string): Val {
      if (key === "fields") return { ...EMPTY_VAL, fieldsOf: capKey }
      const known = key === "getSnapshot" || this.caps.get(capKey)?.operations.has(key) === true
      return known ? { ...EMPTY_VAL, capability: capKey, boundMethod: key } : EMPTY_VAL
    },

    /** A property that is not stored data: a module's export, an accessor, a method, a static of a class. */
    accessSpecial(
      this: FlowScan,
      frame: Frame,
      receiver: Val,
      key: string,
      site: TS.Node,
    ): Val | undefined {
      // The keys of a record are chosen when the program runs: any key may read any entry.
      if (receiver.native === "record")
        return mergeVals(
          receiver.props.get(key) ?? EMPTY_VAL,
          receiver.props.get(ANY_KEY) ?? EMPTY_VAL,
        )
      if (receiver.namespace !== undefined) {
        const target = this.lookupExport(receiver.namespace, key)
        return target === undefined ? undefined : this.targetVal(target)
      }
      const getter = receiver.props.get(accessorKey("get", key))
      if (getter?.callable !== undefined) {
        const fn = this.functionOf(getter.callable)
        if (fn !== undefined)
          return this.analyze({ caller: frame, site }, fn, [], { thisVal: receiver })
      }
      if (receiver.instance !== undefined) return this.instanceMember(frame, receiver, key, site)
      if (receiver.classRef !== undefined) return this.staticMember(frame, receiver, key, site)
      return undefined
    },

    instanceMember(
      this: FlowScan,
      frame: Frame,
      receiver: Val,
      key: string,
      site: TS.Node,
    ): Val | undefined {
      const cls = this.classFor(receiver.instance)
      if (cls === undefined) return undefined
      const getter = this.findMember(cls, "get", false, key)
      if (getter !== undefined && getter !== "opaque")
        return this.analyze({ caller: frame, site }, getter, [], { thisVal: receiver })
      // An accessor a decorator the scan cannot follow may have replaced: what it answers is not known.
      if (getter === "opaque" && this.isDecorated(cls, "get", false, key))
        return this.unresolved(frame, site, receiver, [])
      if (receiver.props.has(key)) return undefined
      const method = this.findMember(cls, "method", false, key)
      if (method !== undefined && method !== "opaque")
        return { ...EMPTY_VAL, callable: method.instance ?? method.key }
      return this.mixedIn(cls, key)
    },

    staticMember(
      this: FlowScan,
      frame: Frame,
      receiver: Val,
      key: string,
      site: TS.Node,
    ): Val | undefined {
      const cls = this.classFor(receiver.classRef)
      if (cls === undefined) return undefined
      for (const owner of this.chain(cls)) {
        const stored = this.classStatics(owner).get(key)
        if (stored !== undefined) return stored
      }
      const getter = this.findMember(cls, "get", true, key)
      if (getter !== undefined && getter !== "opaque")
        return this.analyze({ caller: frame, site }, getter, [], { thisVal: receiver })
      const method = this.findMember(cls, "method", true, key)
      return method === undefined || method === "opaque"
        ? undefined
        : { ...EMPTY_VAL, callable: method.instance ?? method.key }
    },

    // ----- assignment ----------------------------------------------------------------------------

    /** Binds `value` to `name` in the nearest scope that has it, noting when that scope is not the running one. */
    assignName(this: FlowScan, frame: Frame, name: string, value: Val): void {
      if (frame.env.has(name)) {
        if (frame.env.assign(name, value)) this.dirty = true
        return
      }
      // Not a variable of this function or its scopes: an imported object lives in the module that exports it, anything else is a global.
      const imported = this.resolveName(frame.fn.file, name)
      const home = imported === undefined ? undefined : this.homeOf(imported)
      if (home !== undefined) {
        this.assignShared(home.file.moduleEnv, home.name, value)
      } else {
        this.assignShared(this.globalEnv, name, value)
      }
    },

    /** A function or class as its module holds it: with the properties stored on it since (`Foo.prototype.m = ...`, `Foo.helper = ...`), from any module. */
    homeVal(
      this: FlowScan,
      target: Extract<ExportTarget, { kind: "function" | "class" }>,
    ): Val | undefined {
      const home = this.homeOf(target)
      if (home === undefined) return undefined
      const held = home.file.moduleEnv.lookup(home.name)
      const [bound, own] =
        target.kind === "function"
          ? [held.callable, target.fn.key]
          : [held.classRef, target.cls.key]
      return bound === own ? held : undefined
    },

    /** The module scope and the name a function, class or exported variable lives under, so a store through an import reaches the original. */
    homeOf(
      this: FlowScan,
      target: ExportTarget,
    ): { readonly file: FileInfo; readonly name: string } | undefined {
      if (target.kind === "value") return target
      if (target.kind === "function") {
        return [...target.fn.file.topFunctions]
          .filter(([, fn]) => fn === target.fn)
          .map(([name]) => ({ file: target.fn.file, name }))[0]
      }
      if (target.kind === "class") {
        const name = target.cls.node.name?.text
        return name === undefined ? undefined : { file: target.cls.file, name }
      }
      return undefined
    },

    /** Writes where every function can read it; the functions analyzed before this write must see it, so a new or changed binding asks for another round. */
    assignShared(this: FlowScan, env: Env, name: string, value: Val): void {
      const before = env.get(name)
      env.assign(name, value)
      if (before === undefined || signatureOf(before) !== signatureOf(env.lookup(name)))
        this.dirty = true
    },

    /** Stores `value` at `keys` below the variable `root`, merging with what it already holds. */
    storeMember(
      this: FlowScan,
      frame: Frame,
      root: string,
      keys: readonly string[],
      value: Val,
    ): void {
      const nested = keys.reduceRight<Val>(
        (inner, key) => ({ ...EMPTY_VAL, props: new Map([[key, inner]]) }),
        value,
      )
      this.assignName(frame, root, nested)
      if (keys.length > 0) frame.mutated.add(root)
    },

    assign(this: FlowScan, frame: Frame, target: TS.Expression, value: Val): void {
      const left = unwrap(target)
      if (ts.isIdentifier(left)) {
        this.assignName(frame, left.text, value)
      } else if (left.kind === ts.SyntaxKind.ThisKeyword) {
        // The object a callee filled in through `Base.call(this, ...)`.
        this.assignName(frame, "this", value)
      } else if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
        this.assignMember(frame, left, value)
      } else if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
        this.assignPattern(frame, left, value)
      }
    },

    /** `a.b.c = value`: stored under the variable `a` -- or reported, when the store reaches somewhere the analysis cannot follow. */
    assignMember(
      this: FlowScan,
      frame: Frame,
      left: TS.PropertyAccessExpression | TS.ElementAccessExpression,
      value: Val,
    ): void {
      const chain = memberChain(left, this.literalReader(frame))
      const atoms = this.atomsOf(frame, value, left)
      if (this.callSetter(frame, left, value)) return
      // `o.__proto__ = p` makes `o` answer to what `p` holds; it is not a property of `o`.
      const proto = chain.keys.at(-1) === "__proto__"
      const keys = proto ? chain.keys.slice(0, -1) : chain.keys
      this.storeAt(
        frame,
        left,
        { root: chain.root, keys, dynamic: chain.dynamic },
        value,
        atoms,
        // The object the property is stored into, read again only when the store is to a plain chain of names.
        proto ? undefined : () => this.expr(frame, left.expression),
      )
    },

    /** Stores `value` below the variable a member chain starts from. */
    storeAt(
      this: FlowScan,
      frame: Frame,
      site: TS.Node,
      chain: {
        readonly root: string | undefined
        readonly keys: readonly string[]
        readonly dynamic: boolean
      },
      value: Val,
      atoms: readonly Atom[],
      container?: () => Val | undefined,
    ): void {
      const { root, keys, dynamic } = chain
      if (root === undefined) {
        this.flagStore(frame, site, atoms, "assignment target is not a variable")
        return
      }
      if (this.storeThroughNamespace(frame, root, keys, value)) return
      if (dynamic)
        this.flagStore(
          frame,
          site,
          atoms,
          "computed property key on a store of tracked data",
          "dynamic-access",
        )
      else if (frame.aliased.has(root))
        this.flagStore(frame, site, atoms, "property stored into an object another name may share")
      // Read before the store below, which changes what the object holds.
      const shared = keys
        .slice(dynamic ? keys.length : -1)
        .map((last) => ({ into: container?.(), last }))
      this.storeMember(frame, root, keys, value)
      for (const { into, last } of shared)
        this.storeShared(frame, site, into, { ...EMPTY_VAL, props: new Map([[last, value]]) })
      this.noteParameterStore(frame, site, root, value)
    },

    /** `ns.shared.x = value` where `ns` is an imported module: the object `shared` lives in that module. */
    storeThroughNamespace(
      this: FlowScan,
      frame: Frame,
      root: string,
      keys: readonly string[],
      value: Val,
    ): boolean {
      if (frame.env.has(root)) return false
      const module = this.namespaceFile(frame.fn.file, root)
      return keys
        .slice(0, 1)
        .map((first) => {
          const target = this.lookupExport(module, first)
          if (target?.kind !== "value") return false
          const nested = keys
            .slice(1)
            .reduceRight<Val>(
              (inner, key) => ({ ...EMPTY_VAL, props: new Map([[key, inner]]) }),
              value,
            )
          this.assignShared(target.file.moduleEnv, target.name, nested)
          return true
        })
        .includes(true)
    },
  }
}
