/**
 * Expressions, and the copies and derivations they make (ADR 0075). These are methods of `FlowScan` (`flow-scan.ts`), kept in a file of their own so that no file grows past what a
 * mutation run can cover quickly; each runs with `this` as the scan.
 */

import type TS from "typescript"
import type { FlowEdgeTagInput, FlowUnknownReason } from "../flow/flow-model.js"
import { identifierCounts, isPureDerivation } from "./flow-derivation.js"
import {
  accessorKey,
  bindingNames,
  isArithmeticOperator,
  isCompoundAssignment,
  isFunctionLikeNode,
  isLogicalOperator,
  isTransparentWrapper,
  keyOf,
  linkKey,
  memberName,
  rejectedKey,
  settled,
  unwrap,
} from "./flow-scan-helpers.js"
import type { Frame, FunctionInfo, LiteralReader, SentSlot } from "./flow-scan-types.js"
import type { FlowScan } from "./flow-scan.js"
import type { Allocated, Atom, Val } from "./flow-values.js"
import {
  accessDynamic,
  allocsOf,
  approximate,
  ELEMENT_KEY,
  EMPTY_VAL,
  flattenAtoms,
  GENERATOR_HANDLE,
  handlesOf,
  mergeVals,
  objectVal,
  OPAQUE_ALLOC,
  remapAllocs,
  signatureOf,
  withAlloc,
  withEntry,
  withoutAlloc,
} from "./flow-values.js"
import { ts } from "./typescript.js"

export function methods() {
  return {
    // ----- expressions ---------------------------------------------------------------------------

    /** The value of an expression, with whatever was stored into the objects it may be through any other name. */
    expr(this: FlowScan, frame: Frame, node: TS.Node | undefined): Val {
      return this.heap.expand(this.evaluate(frame, node))
    },

    evaluate(this: FlowScan, frame: Frame, node: TS.Node | undefined): Val {
      if (node === undefined || !this.step()) return EMPTY_VAL
      if (isTransparentWrapper(node)) return this.evaluate(frame, node.expression)
      if (ts.isAwaitExpression(node)) return this.awaited(frame, node)
      if (ts.isCallExpression(node)) return this.call(frame, node)
      if (ts.isNewExpression(node)) return this.newExpression(frame, node)
      if (ts.isBinaryExpression(node)) return this.binary(frame, node)
      if (ts.isConditionalExpression(node)) {
        this.expr(frame, node.condition)
        return mergeVals(this.expr(frame, node.whenTrue), this.expr(frame, node.whenFalse))
      }
      return this.referenceOrLiteral(frame, node)
    },

    /** A name, `this`, a member read, or an object / array literal. */
    referenceOrLiteral(this: FlowScan, frame: Frame, node: TS.Node): Val {
      if (ts.isIdentifier(node))
        return frame.env.get(node.text) ?? this.importedVal(frame.fn.file, node.text)
      if (node.kind === ts.SyntaxKind.ThisKeyword) return frame.env.get("this") ?? EMPTY_VAL
      if (ts.isPropertyAccessExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.SuperKeyword)
          return this.superMember(frame, node)
        return this.accessMember(frame, this.expr(frame, node.expression), node.name.text, node)
      }
      if (ts.isElementAccessExpression(node)) return this.elementAccess(frame, node)
      if (ts.isObjectLiteralExpression(node)) return this.objectLiteral(frame, node)
      if (ts.isArrayLiteralExpression(node)) return this.arrayLiteral(frame, node)
      return this.otherExpression(frame, node)
    },

    otherExpression(this: FlowScan, frame: Frame, node: TS.Node): Val {
      if (ts.isTemplateExpression(node))
        return approximate(
          mergeVals(...node.templateSpans.map((span) => this.expr(frame, span.expression))),
        )
      if (ts.isTaggedTemplateExpression(node)) return this.taggedTemplate(frame, node)
      if (isFunctionLikeNode(node)) return this.functionValue(frame, node)
      if (ts.isClassExpression(node)) return this.classValue(frame, node)
      if (ts.isYieldExpression(node)) return this.yielded(frame, node)
      if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
        return this.unary(frame, node)
      if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node) || ts.isDeleteExpression(node)) {
        this.expr(frame, node.expression)
        return EMPTY_VAL
      }
      if (ts.isSpreadElement(node)) return this.expr(frame, node.expression)
      return this.jsxExpression(frame, node)
    },

    unary(
      this: FlowScan,
      frame: Frame,
      node: TS.PrefixUnaryExpression | TS.PostfixUnaryExpression,
    ): Val {
      const operand = this.expr(frame, node.operand)
      // `-x`, `+x` and `~x` are numeric transformations of `x`, like `x * 1`; `!x`, `++x` and `x--` are not.
      return ts.isPrefixUnaryExpression(node) &&
        (node.operator === ts.SyntaxKind.MinusToken ||
          node.operator === ts.SyntaxKind.PlusToken ||
          node.operator === ts.SyntaxKind.TildeToken)
        ? approximate(operand)
        : EMPTY_VAL
    },

    jsxExpression(this: FlowScan, frame: Frame, node: TS.Node): Val {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return this.jsx(frame, node)
      if (ts.isJsxFragment(node)) this.jsxChildren(frame, node.children)
      return EMPTY_VAL
    },

    /** `super.name` read off the superclass: an accessor runs on this instance, a method is the method. */
    superMember(this: FlowScan, frame: Frame, node: TS.PropertyAccessExpression): Val {
      const cls = frame.fn.cls
      const parent = cls === undefined ? "none" : this.parentOf(cls)
      if (parent === "none" || parent === "opaque") return EMPTY_VAL
      const isStatic = frame.fn.role === "static"
      const accessor = this.findMember(parent, "get", isStatic, node.name.text)
      if (accessor !== undefined && accessor !== "opaque")
        return this.analyze({ caller: frame, site: node }, accessor, [], {
          thisVal: frame.env.lookup("this"),
        })
      const method = this.findMember(parent, "method", isStatic, node.name.text)
      return method === undefined || method === "opaque"
        ? EMPTY_VAL
        : { ...EMPTY_VAL, callable: method.instance ?? method.key }
    },

    /** `await x` is `x`; awaiting a rejected promise throws what it was rejected with. */
    awaited(this: FlowScan, frame: Frame, node: TS.AwaitExpression): Val {
      const value = this.unwrapPromise(frame, this.expr(frame, node.expression), node)
      const rejected = value.props.get(rejectedKey())
      if (rejected === undefined) return value
      frame.thrown.push(rejected)
      return settled(value)
    },

    /** `yield x` hands `x` to the consumer and evaluates to what `next(y)` sends in; `yield* x` hands over everything `x` yields. */
    yielded(this: FlowScan, frame: Frame, node: TS.YieldExpression): Val {
      const value = this.expr(frame, node.expression)
      const item = node.asteriskToken === undefined ? value : this.iterate(frame, value, node)
      frame.yields.push(item)
      this.sink(frame, item, { kind: "return" }, node)
      if (node.asteriskToken === undefined) return this.sentInto(frame)
      // `yield* inner` hands the generator inner everything that is sent to this one.
      const forwarded = this.sentInto(frame)
      for (const [id, generator] of this.generatorsOf(value))
        this.send(frame, node, id, generator, forwarded)
      return EMPTY_VAL
    },

    sentSlot(this: FlowScan, id: string): SentSlot {
      const known = this.sent.get(id)
      if (known !== undefined) return known
      const slot: SentSlot = { values: new Map() }
      this.sent.set(id, slot)
      return slot
    },

    /** What was sent into this evaluation of the generator, as a parameter the generator receives after its declared ones. */
    sentInto(this: FlowScan, frame: Frame): Val {
      const slot = this.sentSlot(frame.callKey)
      const received = withEntry(mergeVals(...slot.values.values()), {
        kind: "param",
        fn: frame.fn.key,
        index: frame.fn.params.length,
      })
      this.noteEntry(frame.fn, received)
      return received
    },

    /** The generators `value` holds handles to, each with the evaluation it runs in. */
    generatorsOf(this: FlowScan, value: Val): [string, FunctionInfo][] {
      const ids = handlesOf(value, GENERATOR_HANDLE)
      return [...this.generators].filter(([id]) => ids.includes(id))
    },

    /** `generator.next(x)` hands `x` to the `yield` the generator is stopped at -- any of them, as the scan does not count the calls. */
    send(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      id: string,
      generator: FunctionInfo,
      value: Val,
    ): void {
      const slot = this.sentSlot(id)
      const key = signatureOf(value)
      if (!slot.values.has(key)) {
        slot.values.set(key, value)
        // A `yield` analyzed before this call took less than the generator is now sent.
        this.dirty = true
      }
      this.sink(
        frame,
        value,
        { kind: "arg", callee: generator, index: generator.params.length },
        node,
      )
    },

    /** A tagged template calls its tag with the strings and the substituted values. */
    taggedTemplate(this: FlowScan, frame: Frame, node: TS.TaggedTemplateExpression): Val {
      const spans = ts.isTemplateExpression(node.template)
        ? node.template.templateSpans.map((span) => this.expr(frame, span.expression))
        : []
      const tag = unwrap(node.tag)
      if (
        ts.isPropertyAccessExpression(tag) &&
        ts.isIdentifier(tag.expression) &&
        tag.expression.text === "String" &&
        tag.name.text === "raw"
      )
        return approximate(mergeVals(...spans))
      const target = this.resolveCallable(frame, tag)
      if (target !== undefined)
        return this.analyze({ caller: frame, site: node }, target, [EMPTY_VAL, ...spans])
      return this.unresolved(frame, node, undefined, spans)
    },

    /** The string an expression is for sure -- a literal, or a `const` initialized with one -- for `o[k]`. */
    literalReader(this: FlowScan, frame: Frame): LiteralReader {
      return (expression) => {
        const target = unwrap(expression)
        if (ts.isStringLiteralLike(target)) return target.text
        return ts.isIdentifier(target) ? frame.env.textOf(target.text) : undefined
      }
    },

    elementAccess(this: FlowScan, frame: Frame, node: TS.ElementAccessExpression): Val {
      return this.readKey(frame, node, this.expr(frame, node.expression), node.argumentExpression)
    },

    /** `receiver[key]`: a literal or constant key reads that property, a number an element, anything else every property (an explicit unknown when the receiver holds tracked data). */
    readKey(this: FlowScan, frame: Frame, node: TS.Node, receiver: Val, key: TS.Expression): Val {
      const argument = unwrap(key)
      const text = this.literalReader(frame)(argument)
      if (text !== undefined) return this.accessMember(frame, receiver, text, node)
      if (ts.isNumericLiteral(argument))
        return this.accessMember(frame, receiver, ELEMENT_KEY, node)
      this.expr(frame, argument)
      const held = this.materialize(frame, receiver, node)
      if (flattenAtoms(held).length > 0) {
        this.unknown(
          frame.fn,
          "dynamic-access",
          node,
          "computed property key on tracked data",
          flattenAtoms(held),
        )
        const result = accessDynamic(held)
        this.touch(frame.fn, result, node)
        return result
      }
      return EMPTY_VAL
    },

    objectLiteral(this: FlowScan, frame: Frame, node: TS.ObjectLiteralExpression): Val {
      const props: Record<string, Val> = {}
      const spreads: Val[] = []
      let lone: Val | undefined
      const inherited: Val[] = []
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          const key = keyOf(property.name)
          const value = this.expr(frame, property.initializer)
          if (key === undefined) spreads.push(approximate(value))
          else if (key === "__proto__") inherited.push(value)
          else props[key] = props[key] === undefined ? value : mergeVals(props[key], value)
        } else if (ts.isShorthandPropertyAssignment(property)) {
          props[property.name.text] = this.expr(frame, property.name)
        } else if (ts.isSpreadAssignment(property)) {
          const operand = this.expr(frame, property.expression)
          spreads.push(operand)
          if (node.properties.length === 1) lone = operand
        } else {
          this.objectMethod(frame, property, props)
        }
      }
      // `{ ...x }` and nothing else is a copy of `x`.
      if (lone !== undefined) return this.copied(frame, node, lone, "copy", false)
      // A spread copies the properties of an object into a new one: the new object is not the old.
      return this.fresh(
        frame,
        node,
        objectVal(props, [...spreads.map((spread) => withoutAlloc(spread)), ...inherited]),
      )
    },

    /** A method, getter or setter written in an object literal: a closure stored under its name. */
    objectMethod(
      this: FlowScan,
      frame: Frame,
      property: TS.MethodDeclaration | TS.AccessorDeclaration,
      props: Record<string, Val>,
    ): void {
      if (property.body === undefined) return
      const key = memberName(property.name)
      const value = this.functionValue(frame, property, key)
      if (key === undefined) return
      if (ts.isMethodDeclaration(property)) props[key] = value
      else props[accessorKey(ts.isGetAccessorDeclaration(property) ? "get" : "set", key)] = value
    },

    arrayLiteral(this: FlowScan, frame: Frame, node: TS.ArrayLiteralExpression): Val {
      let lone: Val | undefined
      const elements = node.elements.map((element) => {
        if (!ts.isSpreadElement(element)) return this.expr(frame, element)
        const operand = this.expr(frame, element.expression)
        if (node.elements.length === 1) lone = operand
        return this.iterate(frame, operand, element)
      })
      const merged = mergeVals(...elements)
      const made = this.fresh(frame, node, {
        ...EMPTY_VAL,
        props: new Map([[ELEMENT_KEY, merged]]),
      })
      // `[...x]` and nothing else is a copy of `x`.
      return lone === undefined ? made : this.copiedElements(frame, node, lone, made)
    },

    binary(this: FlowScan, frame: Frame, node: TS.BinaryExpression): Val {
      const operator = node.operatorToken.kind
      const { SyntaxKind } = ts
      if (operator === SyntaxKind.EqualsToken) {
        const value = this.expr(frame, node.right)
        this.assign(frame, node.left, value)
        return value
      }
      const left = this.expr(frame, node.left)
      const right = this.expr(frame, node.right)
      if (operator === SyntaxKind.CommaToken) return right
      if (isLogicalOperator(operator)) return mergeVals(left, right)
      if (isCompoundAssignment(operator)) {
        const value =
          operator === SyntaxKind.PlusEqualsToken
            ? approximate(mergeVals(left, right))
            : mergeVals(left, right)
        this.assign(frame, node.left, value)
        return value
      }
      return isArithmeticOperator(operator) ? approximate(mergeVals(left, right)) : EMPTY_VAL
    },

    // ----- copies and derivations (ADR 0075) -----------------------------------------------------

    /** Whether the value is a copy a recognised copy made: copying it again changes nothing. */
    isFreshCopy(this: FlowScan, val: Val): boolean {
      return val.alloc?.every((id) => this.copySites.has(id)) === true
    },

    /** Notes what happened to the tracked data in `val` at `node`: one tag for each piece of it, on the edge that carries it into this function. */
    tagData(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      val: Val,
      via: FlowEdgeTagInput["via"],
      flags: Pick<FlowEdgeTagInput, "fresh" | "unused"> = {},
    ): void {
      for (const atom of flattenAtoms(val)) {
        const edge = this.emitEntry(frame.fn, atom, node)
        // Stryker disable next-line ConditionalExpression: equivalent -- `emitEntry` finds no edge only for an atom whose function key was never registered, and every atom's was when it was made.
        if (edge !== undefined)
          this.edgeTags.push({ via, edge, source: this.location(frame.fn, node), ...flags })
      }
    },

    /** A copy of `operand` that changes nothing, made at `node` with its own object (its own nested objects too, when the copy is deep). */
    copied(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      operand: Val,
      via: "copy" | "serialize-roundtrip",
      deep: boolean,
    ): Val {
      this.tagData(frame, node, operand, via, this.isFreshCopy(operand) ? { fresh: true } : {})
      const where = `${node.pos}:${node.end}`
      const renamed = deep
        ? remapAllocs(operand, (id) =>
            id === OPAQUE_ALLOC ? id : this.heap.allocId(frame.callKey, `${where}:${id}`),
          )
        : operand
      const result = this.fresh(frame, node, withoutAlloc(renamed))
      for (const id of deep ? allocsOf(result) : result.alloc) this.copySites.add(id)
      return result
    },

    /** `[...x]` made `made` out of `operand`: a copy, noted as one. */
    copiedElements(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      operand: Val,
      made: Allocated,
    ): Val {
      this.tagData(frame, node, operand, "copy", this.isFreshCopy(operand) ? { fresh: true } : {})
      for (const id of made.alloc) this.copySites.add(id)
      return made
    },

    /** A name nothing reads, bound to a value derived from tracked data and nothing else, is a derivation nobody uses. */
    noteUnusedDerivation(
      this: FlowScan,
      frame: Frame,
      declaration: TS.VariableDeclaration,
      value: Val,
    ): void {
      const { initializer } = declaration
      const root = frame.fn.node
      if (root === undefined || initializer === undefined || !isPureDerivation(initializer)) return
      const counts = identifierCounts(root)
      const names = bindingNames(declaration.name)
      // A name that is written once is written where it is declared; `_name` says it is meant to be unused.
      const unused = names.every((name) => counts.get(name) === 1 && !name.startsWith("_"))
      if (names.length > 0 && unused)
        this.tagData(frame, declaration, value, "derive", { unused: true })
    },

    /** A value for the object an expression at `node` makes: it has its own allocation site, so what is stored into it is shared by every alias. */
    fresh(this: FlowScan, frame: Frame, node: TS.Node, val: Val): Allocated {
      return withAlloc(val, this.heap.allocId(frame.callKey, `${node.pos}:${node.end}`))
    },

    /** Writes `content` into the shared contents of the objects `container` may be, so every other name for them sees it. */
    storeShared(
      this: FlowScan,
      frame: Frame,
      site: TS.Node,
      container: Val | undefined,
      content: Val,
    ): void {
      if (container?.alloc === undefined) return
      if (container.alloc.includes(OPAQUE_ALLOC))
        this.flagStore(
          frame,
          site,
          this.atomsOf(frame, content, site),
          "tracked data stored into an object whose origin the analysis cannot see",
        )
      const sites = container.alloc.filter((id) => id !== OPAQUE_ALLOC)
      if (this.heap.store(sites, content, frame.callKey)) this.dirty = true
    },

    flagStore(
      this: FlowScan,
      frame: Frame,
      node: TS.Node,
      atoms: readonly Atom[],
      detail: string,
      reason: FlowUnknownReason = "unsupported-construct",
    ): void {
      if (atoms.length > 0) this.unknown(frame.fn, reason, node, detail, atoms)
    },

    /** `obj.prop = value` where `prop` has a setter runs the setter instead of storing. */
    callSetter(
      this: FlowScan,
      frame: Frame,
      left: TS.PropertyAccessExpression | TS.ElementAccessExpression,
      value: Val,
    ): boolean {
      const link = linkKey(left, this.literalReader(frame))
      const receiver = this.expr(frame, left.expression)
      const own = receiver.props.get(accessorKey("set", link.key))
      const cls = this.classes.get(receiver.instance)
      const inherited = cls === undefined ? undefined : this.findMember(cls, "set", false, link.key)
      const setter = own?.callable === undefined ? inherited : this.functionOf(own.callable)
      if (setter === undefined || setter === "opaque") return false
      this.analyze({ caller: frame, site: left, receiver: left.expression }, setter, [value], {
        thisVal: receiver,
      })
      return true
    },

    /** `({ a, b: [c] } = value)` and `[a, b] = value`: binds each target to its part of `value`. */
    assignPattern(
      this: FlowScan,
      frame: Frame,
      pattern: TS.ObjectLiteralExpression | TS.ArrayLiteralExpression,
      value: Val,
    ): void {
      if (ts.isArrayLiteralExpression(pattern)) {
        const items = this.iterate(frame, value, pattern)
        for (const element of pattern.elements) {
          this.assignTarget(
            frame,
            ts.isSpreadElement(element) ? element.expression : element,
            ts.isSpreadElement(element) ? value : items,
          )
        }
        return
      }
      for (const property of pattern.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          const part = this.accessMember(frame, value, property.name.text, property)
          const fallback = this.expr(frame, property.objectAssignmentInitializer)
          this.assignName(frame, property.name.text, mergeVals(part, fallback))
        } else if (ts.isPropertyAssignment(property)) {
          const key = keyOf(property.name)
          const part =
            key === undefined
              ? accessDynamic(this.materialize(frame, value, property))
              : this.accessMember(frame, value, key, property)
          this.assignTarget(frame, property.initializer, part)
        } else if (ts.isSpreadAssignment(property)) {
          this.assignTarget(frame, property.expression, approximate(value))
        }
      }
    },

    /** One target of a destructuring assignment: it may carry a default (`a = 1`) or be a nested pattern. */
    assignTarget(this: FlowScan, frame: Frame, target: TS.Expression, part: Val): void {
      const inner = unwrap(target)
      if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        this.assign(frame, inner.left, mergeVals(part, this.expr(frame, inner.right)))
      } else {
        this.assign(frame, inner, part)
      }
    },

    jsxChildren(this: FlowScan, frame: Frame, children: TS.NodeArray<TS.JsxChild>): void {
      for (const child of children)
        this.expr(frame, ts.isJsxExpression(child) ? child.expression : child)
    },

    jsx(this: FlowScan, frame: Frame, node: TS.JsxElement | TS.JsxSelfClosingElement): Val {
      const opening = ts.isJsxElement(node) ? node.openingElement : node
      const props: Record<string, Val> = {}
      const spreads: Val[] = []
      for (const attribute of opening.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) {
          const key = ts.isIdentifier(attribute.name) ? attribute.name.text : undefined
          const value =
            attribute.initializer !== undefined && ts.isJsxExpression(attribute.initializer)
              ? this.expr(frame, attribute.initializer.expression)
              : EMPTY_VAL
          if (key !== undefined) props[key] = value
        } else {
          spreads.push(this.expr(frame, attribute.expression))
        }
      }
      const propsVal = objectVal(props, spreads)
      if (ts.isJsxElement(node)) this.jsxChildren(frame, node.children)
      const tag = opening.tagName
      const target = ts.isIdentifier(tag) ? this.resolveCallable(frame, tag) : undefined
      if (target !== undefined)
        return this.analyze({ caller: frame, site: opening }, target, [propsVal])
      return this.unresolved(frame, opening, undefined, [propsVal])
    },
  }
}
