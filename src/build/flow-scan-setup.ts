/**
 * Setting the scan up: registering capabilities and files, indexing, classes, and the small node helpers. These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import type { DataFlowEndpoint } from "../core/document.js"
import type {
  FlowEdgeInput,
  FlowNodeInput,
  FlowStatus,
  FlowUnknownReason,
} from "../flow/flow-model.js"
import { flowEdgeId, flowNodeId } from "../flow/flow-model.js"
import { assertCompilerApi } from "./compiler-api.js"
import type { ScanTarget } from "./dependency-graph.js"
import { absolutePathFrom, displayPath } from "./display-path.js"
import {
  bindingNames,
  Env,
  hasModifier,
  isFunctionLikeNode,
  isOpaqueCallee,
  loadedSpecifier,
  memberKey,
  memberName,
  unwrap,
} from "./flow-scan-helpers.js"
import type {
  CapInfo,
  ClassInfo,
  ClassLike,
  FileInfo,
  FunctionInfo,
  FunctionLike,
  FunctionRole,
} from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Atom } from "./flow-values.js"
import { EMPTY_VAL } from "./flow-values.js"
import type { CapabilityInventory, CapabilityNode } from "./inventory.js"
import type { ImportBinding } from "./parse.js"
import type { ImportResolutionContext } from "./resolution/resolve-import.js"
import { resolveImportSpecifier } from "./resolution/resolve-import.js"
import { collectFileImports, matchFileImports } from "./scan-dependencies.js"
import type { SourceLocation } from "./source-position.js"
import { positionOf } from "./source-position.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    // ----- setup ---------------------------------------------------------------------------------

    registerCapabilities(this: FlowScan, inventory: CapabilityInventory): void {
      for (const declared of inventory.capabilities) {
        // An inventory may spell a path `./features/x.ts` or with backslashes; every id and scope uses the one normal form.
        const file = absolutePathFrom(this.root, declared.file)
        const node: CapabilityNode = { ...declared, file: displayPath(this.root, file) }
        const key = `${file}#${node.exportName}`
        const cap: CapInfo = {
          key,
          node,
          fieldIds: new Map(),
          operations: new Map(),
        }
        for (const field of node.fields) {
          const fieldName = field.path.join(".")
          const id = flowNodeId("field", node.file, `${node.exportName}.${fieldName}`)
          cap.fieldIds.set(field.path[0] ?? fieldName, id)
          this.shapeByOrigin.set(id, field.shape)
          this.addNode({
            kind: "field",
            scope: node.file,
            name: `${node.exportName}.${fieldName}`,
            status: "static",
            ...(field.sensitivity.value === undefined
              ? {}
              : { classification: field.sensitivity.value }),
            ...(field.declarationPosition === undefined
              ? {}
              : { source: field.declarationPosition }),
          })
        }
        for (const [list, kind] of [
          [node.getters, "getter"],
          [node.mutators, "mutator"],
          [node.subscriptions, "subscription"],
        ] as const) {
          for (const operation of list)
            cap.operations.set(operation.name, { kind, endpoints: operation.endpoints })
        }
        this.caps.set(key, cap)
        this.addDeclaredEdges(cap)
      }
    },

    addNode(this: FlowScan, node: FlowNodeInput): string {
      const id = flowNodeId(node.kind, node.scope, node.name)
      this.nodes.set(id, this.nodes.get(id) ?? node)
      return id
    },

    /** Adds the edge unless it is there, and returns the id the Flow Model gives it. */
    addEdge(this: FlowScan, edge: FlowEdgeInput): string {
      const key = JSON.stringify([
        edge.kind,
        edge.from,
        edge.to,
        edge.path,
        edge.status,
        edge.origin,
        edge.handling,
      ])
      if (!this.edges.has(key)) this.edges.set(key, edge)
      return flowEdgeId(edge.kind, edge.from, edge.to, edge.path, edge.status, edge.origin)
    },

    declaredBoundary(this: FlowScan, endpoint: DataFlowEndpoint): string {
      const mapKey = `${endpoint.kind}|${endpoint.name}`
      const known = this.declaredBoundaries.get(mapKey)
      if (known !== undefined) return known
      const taken = [...this.declaredBoundaries.values()].some(
        (id) => id === flowNodeId("boundary", "boundary", endpoint.name),
      )
      const name = taken ? `${endpoint.name}#${endpoint.kind}` : endpoint.name
      const id = this.addNode({
        kind: "boundary",
        scope: "boundary",
        name,
        status: "declared",
        boundaryKind: endpoint.kind,
      })
      this.declaredBoundaries.set(mapKey, id)
      return id
    },

    addDeclaredEdges(this: FlowScan, cap: CapInfo): void {
      for (const node of [...cap.node.getters, ...cap.node.mutators, ...cap.node.subscriptions]) {
        for (const written of node.writes) {
          const fieldId = cap.fieldIds.get(written[0] ?? "")
          if (fieldId === undefined) continue
          for (const endpoint of node.endpoints) {
            const boundary = this.declaredBoundary(endpoint)
            if (endpoint.direction === "input") {
              this.addEdge({
                kind: "crosses-boundary",
                from: boundary,
                to: fieldId,
                status: "declared",
                origin: fieldId,
                ...(endpoint.handling === undefined ? {} : { handling: endpoint.handling }),
              })
            } else {
              this.addEdge({
                kind: "crosses-boundary",
                from: fieldId,
                to: boundary,
                status: "declared",
                origin: fieldId,
                ...(endpoint.handling === undefined ? {} : { handling: endpoint.handling }),
              })
            }
          }
        }
      }
    },

    /**
     * Names of the schema constants this file hands to `createData`/`buildData`/`documentData` (`createData(schema)`).
     * Their declarations hold the operation bodies (`execute`, `processor`, ...), which stay opaque however the schema
     * is spelled -- inline in the call or declared first and passed by name (AGENTS.md invariant 6).
     */
    schemaConstants(this: FlowScan, sourceFile: TS.SourceFile): ReadonlySet<string> {
      const names = new Set<string>()
      const visit = (node: TS.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          isOpaqueCallee(node.expression.text)
        ) {
          const first = node.arguments[0]
          if (first !== undefined && ts.isIdentifier(first)) names.add(first.text)
        }
        ts.forEachChild(node, visit)
      }
      for (const statement of sourceFile.statements) visit(statement)
      return names
    },

    async indexFile(
      this: FlowScan,
      file: string,
      text: string,
      context: ImportResolutionContext,
      targets: readonly ScanTarget[],
      targetsByName: ReadonlyMap<string, readonly ScanTarget[]>,
    ): Promise<void> {
      assertCompilerApi(ts)
      const sourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        undefined,
        ts.ScriptKind.TSX,
      )
      const schemas = this.schemaConstants(sourceFile)
      const info: FileInfo = {
        file,
        scope: displayPath(this.root, file),
        sourceFile,
        capabilityBindings: new Map(),
        resolvedImports: new Map(),
        namespaces: new Map(),
        packageImports: new Map(),
        topFunctions: new Map(),
        topClasses: new Map(),
        // Stryker disable next-line ArrayDeclaration: equivalent -- a stand-in file names no module, so looking a name up in it finds nothing.
        stars: [],
        dynamicImports: new Map(),
        valueNames: new Set(),
        exports: new Map(),
        moduleStatements: [],
        // Stryker disable next-line BooleanLiteral: equivalent -- writes to a module variable or to an undeclared global reach the functions that read them whether or not the module scope is a boundary; no read of module state differs by it.
        moduleEnv: new Env(this.globalEnv, true, true),
        moduleStarted: false,
      }
      // What a CommonJS module writes its exports to: `exports.a = ...`, `module.exports = ...`.
      info.moduleEnv.set("exports", EMPTY_VAL)
      // Stryker disable next-line ArrayDeclaration,StringLiteral: equivalent -- `module.exports.x = ...` creates the entry on its first write, and before any write `module.exports` reads as the empty value it is initialised to.
      info.moduleEnv.set("module", { ...EMPTY_VAL, props: new Map([["exports", EMPTY_VAL]]) })
      const imports: readonly ImportBinding[] = collectFileImports(sourceFile)
      const matches = await matchFileImports(file, imports, targets, targetsByName, context)
      const matched = new Set(matches.map((match) => match.localName))
      for (const match of matches)
        info.capabilityBindings.set(
          match.localName,
          `${match.target.file}#${match.target.exportName}`,
        )
      for (const target of targets) {
        if (target.file === file && !matched.has(target.exportName))
          info.capabilityBindings.set(target.exportName, `${target.file}#${target.exportName}`)
      }
      for (const binding of imports) {
        info.packageImports.set(binding.localName, {
          module: binding.moduleSpecifier,
          name: binding.importedName,
        })
        const resolved = await resolveImportSpecifier(file, binding.moduleSpecifier, context)
        // Stryker disable next-line ConditionalExpression: equivalent -- an unresolved import recorded with no file finds no exports later, the same as not recording it.
        if (resolved === undefined) continue
        if (binding.importedName === "*") info.namespaces.set(binding.localName, resolved)
        else
          info.resolvedImports.set(binding.localName, {
            file: resolved,
            name: binding.importedName,
          })
      }
      await this.indexDynamicImports(info, context)
      for (const statement of sourceFile.statements)
        await this.indexStatement(info, statement, context, schemas)
      // Stryker disable next-line BlockStatement: equivalent -- the module's statements find an imported capability through its import, and the module's own definition is bound again by `ensureModule` after its statements run.
      for (const [local, key] of info.capabilityBindings) {
        info.moduleEnv.set(local, { ...EMPTY_VAL, capability: key })
      }
      this.files.set(file, info)
    },

    /** Resolves every `import("literal")` and `require("literal")` in the file now, since resolution is asynchronous and the analysis is not. */
    async indexDynamicImports(
      this: FlowScan,
      info: FileInfo,
      context: ImportResolutionContext,
    ): Promise<void> {
      const specifiers = new Set<string>()
      const visit = (node: TS.Node): void => {
        const loaded = loadedSpecifier(node)
        if (loaded !== undefined) specifiers.add(loaded)
        ts.forEachChild(node, visit)
      }
      visit(info.sourceFile)
      for (const specifier of specifiers) {
        const resolved = await resolveImportSpecifier(info.file, specifier, context)
        // Stryker disable next-line ConditionalExpression: equivalent -- a specifier stored with no file is looked up as no file.
        if (resolved !== undefined) info.dynamicImports.set(specifier, resolved)
      }
    },

    async indexStatement(
      this: FlowScan,
      info: FileInfo,
      statement: TS.Statement,
      context: ImportResolutionContext,
      schemas: ReadonlySet<string>,
    ): Promise<void> {
      if (ts.isFunctionDeclaration(statement) && statement.body !== undefined) {
        this.indexFunctionDeclaration(info, statement)
      } else if (ts.isClassDeclaration(statement)) {
        this.indexClassDeclaration(info, statement)
      } else if (ts.isVariableStatement(statement)) {
        this.indexVariableStatement(info, statement, schemas)
      } else if (ts.isExportDeclaration(statement)) {
        await this.indexExportDeclaration(info, statement, context)
      } else if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
        this.indexExportAssignment(info, statement)
      } else if (
        ts.isModuleDeclaration(statement) &&
        statement.body !== undefined &&
        ts.isModuleBlock(statement.body)
      ) {
        // A namespace's functions and statements are the file's: its exports are not the file's exports.
        const before = new Map(info.exports)
        for (const inner of statement.body.statements)
          await this.indexStatement(info, inner, context, schemas)
        info.exports.clear()
        for (const [name, ref] of before) info.exports.set(name, ref)
      } else {
        // Imports, type declarations and the like are kept as module statements too: `statement` ignores them.
        info.moduleStatements.push(statement)
      }
    },

    exportLocal(this: FlowScan, info: FileInfo, exported: string, local: string): void {
      info.exports.set(exported, { owner: info, file: undefined, name: local })
    },

    indexFunctionDeclaration(
      this: FlowScan,
      info: FileInfo,
      statement: TS.FunctionDeclaration,
    ): void {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      const name = statement.name?.text ?? "default"
      this.registerTop(info, name, statement)
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword))
        this.exportLocal(info, isDefault ? "default" : name, name)
    },

    indexClassDeclaration(this: FlowScan, info: FileInfo, statement: TS.ClassDeclaration): void {
      // An ambient class (`declare class`) has no body here: whatever implements it is code the analysis cannot see.
      if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
        // Stryker disable next-line CallExpression: equivalent -- an ambient class has no body, so running it as a module statement defines nothing the scan reads.
        info.moduleStatements.push(statement)
        return
      }
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      const name = statement.name?.text ?? "default"
      this.registerClass(info, name, statement)
      if (hasModifier(statement, ts.SyntaxKind.ExportKeyword))
        this.exportLocal(info, isDefault ? "default" : name, name)
    },

    indexVariableStatement(
      this: FlowScan,
      info: FileInfo,
      statement: TS.VariableStatement,
      schemas: ReadonlySet<string>,
    ): void {
      const declared = statement.declarationList.declarations
      if (
        declared.every(
          (declaration) => ts.isIdentifier(declaration.name) && schemas.has(declaration.name.text),
        )
      )
        return
      const isExported = hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      let allFunctions = true
      for (const declaration of declared) {
        const initializer =
          declaration.initializer === undefined ? undefined : unwrap(declaration.initializer)
        if (
          ts.isIdentifier(declaration.name) &&
          initializer !== undefined &&
          isFunctionLikeNode(initializer)
        ) {
          this.registerTop(info, declaration.name.text, initializer)
          if (isExported) this.exportLocal(info, declaration.name.text, declaration.name.text)
        } else {
          allFunctions = false
          for (const name of bindingNames(declaration.name)) {
            info.valueNames.add(name)
            if (isExported) this.exportLocal(info, name, name)
          }
        }
      }
      if (!allFunctions) info.moduleStatements.push(statement)
    },

    async indexExportDeclaration(
      this: FlowScan,
      info: FileInfo,
      statement: TS.ExportDeclaration,
      context: ImportResolutionContext,
    ): Promise<void> {
      const specifier = statement.moduleSpecifier
      const hasSource = specifier !== undefined
      const from =
        specifier !== undefined && ts.isStringLiteralLike(specifier)
          ? await resolveImportSpecifier(info.file, specifier.text, context)
          : undefined
      const clause = statement.exportClause
      if (clause === undefined) {
        // Stryker disable next-line ConditionalExpression: equivalent -- a star re-export of a module that cannot be resolved is looked up as no file, which finds nothing, as not recording it does.
        if (from !== undefined) info.stars.push(from)
      } else if (ts.isNamespaceExport(clause)) {
        // Stryker disable next-line ConditionalExpression: equivalent -- a namespace re-export of a module that cannot be resolved is looked up as no file, which finds nothing, as not recording it does.
        if (from !== undefined)
          info.exports.set(clause.name.text, { owner: info, file: from, name: "*" })
      } else {
        for (const element of clause.elements) {
          const local = (element.propertyName ?? element.name).text
          // A name re-exported from a module that cannot be resolved points at no file at all, never at a local of the same name.
          info.exports.set(element.name.text, {
            owner: info,
            // Stryker disable next-line StringLiteral: equivalent -- any text that is no file path points at no file, as the empty one does.
            file: hasSource ? (from ?? "") : undefined,
            name: local,
          })
        }
      }
    },

    indexExportAssignment(this: FlowScan, info: FileInfo, statement: TS.ExportAssignment): void {
      const expression = unwrap(statement.expression)
      if (isFunctionLikeNode(expression)) {
        this.registerTop(info, "default", expression)
      } else if (ts.isClassExpression(expression)) {
        this.registerClass(info, "default", expression)
      } else if (ts.isIdentifier(expression)) {
        this.exportLocal(info, "default", expression.text)
        return
      } else {
        info.valueNames.add("default")
        info.moduleStatements.push(statement)
      }
      this.exportLocal(info, "default", "default")
    },

    registerTop(this: FlowScan, info: FileInfo, name: string, node: FunctionLike): void {
      const position = positionOf(info.sourceFile, node)
      const finalName = info.topFunctions.has(name)
        ? `${name}@${position.line}:${position.column}`
        : name
      const fn = this.makeFunction(info, finalName, node)
      info.topFunctions.set(name, fn)
      // A function is a value of its module: properties stored on it (`Foo.prototype.m = ...`) live there.
      info.moduleEnv.set(name, { ...EMPTY_VAL, callable: fn.key })
    },

    makeFunction(
      this: FlowScan,
      info: FileInfo,
      name: string,
      node: FunctionLike | undefined,
      owner?: {
        readonly cls: ClassInfo
        readonly role: FunctionRole
        /** Set on the members of a class made by one particular evaluation: each answers to a token of its own. */
        readonly instance?: string
      },
    ): FunctionInfo {
      const fn: FunctionInfo = {
        key: `${info.file}#${name}`,
        file: info,
        name,
        node,
        // A TypeScript `this` parameter only types the receiver: it takes no argument.
        // Stryker disable next-line ArrayDeclaration: equivalent -- only the module function has no node, and it is never called with arguments, so its parameter list is never read.
        params: (node?.parameters ?? []).filter(
          (param) => !(ts.isIdentifier(param.name) && param.name.text === "this"),
        ),
        cls: owner?.cls,
        // Stryker disable next-line StringLiteral: equivalent -- the code only asks whether a role is `static` or `constructor`, never whether it is `plain`.
        role: owner?.role ?? "plain",
        closureEnv: undefined,
        instance: owner?.instance,
        bound: undefined,
      }
      this.functions.set(fn.key, fn)
      // Stryker disable next-line ConditionalExpression: equivalent -- a closure is looked up by its token, which is never `undefined`.
      if (fn.instance !== undefined) this.instances.set(fn.instance, fn)
      return fn
    },

    // ----- classes -------------------------------------------------------------------------------

    registerClass(this: FlowScan, info: FileInfo, name: string, node: ClassLike): ClassInfo {
      const cls = this.makeClass(info, name, node, info.moduleEnv)
      info.topClasses.set(name, cls)
      info.moduleEnv.set(name, { ...EMPTY_VAL, classRef: cls.key })
      return cls
    },

    /**
     * The class declared by `node` -- one per node, created the first time it is met. Its members are analyzed as roots
     * too. With `evaluation` set it is instead the class one particular evaluation of the code made (a class written inside
     * a function, which captures that call's variables): a new one each time.
     */
    makeClass(
      this: FlowScan,
      info: FileInfo,
      name: string,
      node: ClassLike,
      env: Env,
      evaluation?: string,
    ): ClassInfo {
      const position = positionOf(info.sourceFile, node)
      const label = this.classes.has(`${info.file}#${name}`)
        ? `${name}@${position.line}:${position.column}`
        : name
      const cls: ClassInfo = {
        key:
          evaluation === undefined
            ? `${info.file}#${label}`
            : `${info.file}#${label}\u0000${evaluation}`,
        name: label,
        file: info,
        node,
        env,
        members: new Map(),
        fields: [],
        statics: [],
        ctor: this.makeFunction(info, `${label}.constructor`, undefined),
        staticFn: undefined,
        staticVals: undefined,
        parent: undefined,
        evaluation,
        decorated: false,
        opaque: new Set(),
        opaqueClass: false,
        replacement: undefined,
      }
      this.classes.set(cls.key, cls)
      this.registerMembers(cls)
      return cls
    },

    classFunction(
      this: FlowScan,
      cls: ClassInfo,
      name: string,
      node: FunctionLike,
      role: FunctionRole,
    ): FunctionInfo {
      const fn = this.makeFunction(cls.file, `${cls.name}.${name}`, node, {
        cls,
        role,
        ...(cls.evaluation === undefined ? {} : { instance: `${cls.key}.${name}` }),
      })
      fn.closureEnv = cls.env
      // A method of a class one call made is a closure of that call: if nothing calls it, what it returns is handed to code the scan cannot see.
      // Stryker disable next-line ConditionalExpression: equivalent -- a key of `undefined` that is added is one no function is looked up by.
      if (fn.instance !== undefined) this.closureKeys.add(fn.instance)
      this.queue.push(fn)
      return fn
    },

    /** The capability a key names; none when there is no key or no capability under it. */
    capFor(this: FlowScan, key: string | undefined): CapInfo | undefined {
      // Stryker disable next-line ConditionalExpression: equivalent -- no capability is registered under `undefined`, so asking for it finds none, as the check does.
      return key === undefined ? undefined : this.caps.get(key)
    },

    /** The class a key names; none when there is no key or no class under it. */
    classFor(this: FlowScan, key: string | undefined): ClassInfo | undefined {
      // Stryker disable next-line ConditionalExpression: equivalent -- no class is registered under `undefined`, so asking for it finds none, as the check does.
      return key === undefined ? undefined : this.classes.get(key)
    },

    registerMembers(this: FlowScan, cls: ClassInfo): void {
      const explicit = cls.node.members.find(
        (member): member is TS.ConstructorDeclaration =>
          ts.isConstructorDeclaration(member) && member.body !== undefined,
      )
      if (explicit !== undefined) {
        cls.ctor = this.classFunction(cls, "constructor", explicit, "constructor")
      } else {
        cls.ctor.cls = cls
        cls.ctor.role = "constructor"
        cls.ctor.closureEnv = cls.env
        this.queue.push(cls.ctor)
      }
      for (const member of cls.node.members) this.registerMember(cls, member)
      // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent -- the root made for a class with no statics has nothing to run, so it adds no node and no edge.
      if (cls.statics.length > 0) {
        cls.staticFn = this.makeFunction(cls.file, `${cls.name}.static`, undefined, {
          cls,
          role: "static",
        })
        this.queue.push(cls.staticFn)
      }
    },

    registerMember(this: FlowScan, cls: ClassInfo, member: TS.ClassElement): void {
      const isStatic = hasModifier(member, ts.SyntaxKind.StaticKeyword)
      if (
        (ts.isMethodDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)) &&
        member.body !== undefined
      ) {
        const kind = ts.isMethodDeclaration(member)
          ? "method"
          : ts.isGetAccessorDeclaration(member)
            ? "get"
            : "set"
        const name = memberName(member.name)
        const fn = this.classFunction(
          cls,
          `${kind === "method" ? "" : `${kind} `}${name ?? "<computed>"}`,
          member,
          // Stryker disable next-line StringLiteral: equivalent -- the code only asks whether a role is `static` or `constructor`, never whether it is `method`.
          isStatic ? "static" : "method",
        )
        // Stryker disable next-line ConditionalExpression: equivalent -- a member whose name is not known is stored under a key nothing looks up.
        if (name !== undefined) cls.members.set(memberKey(kind, isStatic, name), fn)
      } else if (ts.isPropertyDeclaration(member) && member.initializer !== undefined) {
        if (isStatic) cls.statics.push(member)
        else cls.fields.push(member)
      } else if (ts.isClassStaticBlockDeclaration(member)) {
        cls.statics.push(member)
      }
    },

    // ----- node helpers --------------------------------------------------------------------------

    /** The id of `fn`'s node, creating it first so no edge ever points at a missing one. */
    fnNode(this: FlowScan, fn: FunctionInfo): string {
      return this.addNode(this.functionNode(fn, "static"))
    },

    paramName(this: FlowScan, fn: FunctionInfo, index: number): string {
      const param = fn.params[index]
      if (index < 0) return `${fn.name}.this`
      const base =
        param !== undefined && ts.isIdentifier(param.name) ? param.name.text : `arg${index}`
      return `${fn.name}.${base}`
    },

    /** The node of the `index`th argument position -- created on demand, since a call may pass more arguments than the callee declares parameters. */
    paramNode(this: FlowScan, fn: FunctionInfo, index: number): string {
      return this.addNode(this.parameterNode(fn, index))
    },

    parameterNode(this: FlowScan, fn: FunctionInfo, index: number): FlowNodeInput {
      return {
        kind: "parameter",
        scope: fn.file.scope,
        name: this.paramName(fn, index),
        status: "static",
      }
    },

    returnNode(this: FlowScan, fn: FunctionInfo): string {
      return this.addNode({
        kind: "return",
        scope: fn.file.scope,
        name: `${fn.name}#return`,
        status: "static",
      })
    },

    functionNode(this: FlowScan, fn: FunctionInfo, status: FlowStatus): FlowNodeInput {
      return {
        kind: "function",
        scope: fn.file.scope,
        name: fn.name,
        status,
        ...(fn.node === undefined ? {} : { source: positionOf(fn.file.sourceFile, fn.node) }),
      }
    },

    /** Every node a function owns: itself, each declared parameter and its return. */
    ensureFunctionNodes(this: FlowScan, fn: FunctionInfo): void {
      this.fnNode(fn)
      fn.params.forEach((_, index) => this.paramNode(fn, index))
      this.returnNode(fn)
    },

    location(this: FlowScan, fn: FunctionInfo, node: TS.Node): SourceLocation {
      return { file: fn.file.scope, ...positionOf(fn.file.sourceFile, node) }
    },

    /** Records what could not be followed, and which tracked data was inside it (merged when the same site is reached again). */
    unknown(
      this: FlowScan,
      fn: FunctionInfo,
      reason: FlowUnknownReason,
      node: TS.Node,
      detail: string,
      atoms: readonly Atom[],
    ): void {
      const source = this.location(fn, node)
      const key = `${reason}|${source.file}|${source.line}|${source.column}`
      // The same data can arrive under several entries (as a parameter and as a returned value): it is one piece of data.
      const data = [
        ...new Map(
          atoms.map((atom) => [
            JSON.stringify([atom.origin, atom.path]),
            { origin: atom.origin, path: atom.path },
          ]),
        ).values(),
      ]
      const existing = this.unknowns.get(key)
      if (existing !== undefined) {
        const known = new Set(existing.data.map((item) => JSON.stringify([item.origin, item.path])))
        const added = data.filter((item) => !known.has(JSON.stringify([item.origin, item.path])))
        this.unknowns.set(key, { ...existing, data: [...existing.data, ...added] })
        return
      }
      this.unknowns.set(key, {
        reason,
        source,
        subject: this.fnNode(fn),
        detail,
        data,
      })
    },
  }
}
