import { userField, USER } from "./flow-catalog.js"
import { IMPORT_CAP } from "../build/mut-flow-scan-harness.js"
import { body, mod, multi } from "./flow-catalog-builders.js"
import type { Form } from "./flow-catalog-builders.js"

/**
 * The second half of the never-silently-safe catalog: builtins with known semantics, partial application, constant
 * keys, prototypes, CommonJS, decorators and per-evaluation classes. Same contract as `flow-catalog-forms.ts`:
 * every row leaks one field of `userData.user` through the form and pins the class the evidence must end in.
 */
const cap = IMPORT_CAP
const sink = "console.log"
const lib = (extra: string): Record<string, string> => ({ "app/lib.ts": extra })

function collections(): Form[] {
  const g = "builtins and higher-order data"
  return [
    body(
      g,
      "Map built from entries",
      "A",
      (_, u) => `const m = new Map([["a", ${u}]])\nres.json(m.get("a"))`,
    ),
    body(
      g,
      "Map set then get",
      "A",
      (_, u) => `const m = new Map<string, any>()\nm.set("k", ${u})\nres.json(m.get("k"))`,
    ),
    body(
      g,
      "Map set chained",
      "A",
      (_, u) => `const m = new Map<string, any>().set("a", 1).set("b", ${u})\nres.json(m.get("b"))`,
    ),
    body(g, "Map forEach", "A", (_, u) => `new Map([["a", ${u}]]).forEach((v) => res.json(v))`),
    body(g, "Map values", "A", (_, u) => `res.json([...new Map([["a", ${u}]]).values()][0])`),
    body(g, "Map keys", "A", (_, u) => `res.json([...new Map([[${u}, 1]]).keys()][0])`),
    body(
      g,
      "Map entries in for-of",
      "A",
      (_, u) => `for (const [, v] of new Map([["a", ${u}]]).entries()) res.json(v)`,
    ),
    body(
      g,
      "Map iterated directly",
      "A",
      (_, u) => `for (const [, v] of new Map([["a", ${u}]])) res.json(v)`,
    ),
    body(
      g,
      "Map copied from another Map",
      "A",
      (_, u) => `const a = new Map([["a", ${u}]])\nres.json(new Map(a).get("a"))`,
    ),
    body(
      g,
      "Map built from Object.entries",
      "A",
      (_, u) => `res.json(new Map(Object.entries({ a: ${u} })).get("a"))`,
    ),
    body(
      g,
      "Map.groupBy",
      "A",
      (_, u) => `res.json(Map.groupBy([${u}], (x: any) => "k").get("k"))`,
    ),
    body(
      g,
      "WeakMap",
      "A",
      (_, u) => `const k = {}\nconst m = new WeakMap()\nm.set(k, ${u})\nres.json(m.get(k))`,
    ),
    body(g, "Set from items", "A", (_, u) => `res.json([...new Set([${u}])][0])`),
    body(
      g,
      "Set add then forEach",
      "A",
      (_, u) => `const s = new Set<any>()\ns.add(${u})\ns.forEach((x) => res.json(x))`,
    ),
    body(g, "Set values", "A", (_, u) => `for (const x of new Set([${u}]).values()) res.json(x)`),
    body(g, "Set iterated directly", "A", (_, u) => `for (const x of new Set([${u}])) res.json(x)`),
    body(
      g,
      "Set union",
      "A",
      (_, u) => `res.json([...(new Set([1]) as any).union(new Set([${u}]))][0])`,
    ),
    body(
      g,
      "Map passed to a project function",
      "A",
      (_, u) => `res.json(first(new Map([["a", ${u}]])))`,
      () => `function first(m: Map<string, any>) { return m.get("a") }\n`,
    ),
    body(
      g,
      "Map set under a computed key",
      "A",
      (_, u) => `const m = new Map<string, any>()\nm.set(key, ${u})\nres.json(m.get("other"))`,
    ),
    body(
      g,
      "Map stored through a call result",
      "B",
      (_, u) => `make().set("k", ${u})`,
      () => `function make(): Map<string, any> { return new Map() }\n`,
    ),
  ]
}

function promises(): Form[] {
  const g = "builtins and higher-order data"
  const async = "async "
  const none = (): string => ""
  return [
    body(
      g,
      "new Promise resolved synchronously",
      "A",
      (_, u) => `res.json(await new Promise((resolve) => resolve(${u})))`,
      none,
      async,
    ),
    body(
      g,
      "new Promise then",
      "A",
      (_, u) => `new Promise((resolve) => resolve(${u})).then((v) => res.json(v))`,
    ),
    body(
      g,
      "new Promise rejected and caught",
      "A",
      (_, u) => `new Promise((_, reject) => reject(${u})).catch((e) => res.json(e))`,
    ),
    body(
      g,
      "new Promise resolved by a later callback",
      "A",
      (_, u) =>
        `const p = new Promise<any>((resolve) => { setTimeout(() => resolve(${u}), 0) })\nres.json(await p)`,
      none,
      async,
    ),
    body(
      g,
      "new Promise inside a helper",
      "A",
      (_, u) => `res.json(await wrap(${u}))`,
      () => `function wrap(v: any) { return new Promise<any>((resolve) => resolve(v)) }\n`,
      async,
    ),
    body(
      g,
      "new Promise with a named executor",
      "A",
      () => `res.json(await new Promise(exec))`,
      (_, u) => `function exec(resolve: any) { resolve(${u}) }\n`,
      async,
    ),
    body(
      g,
      "Promise.race",
      "A",
      (_, u) => `res.json(await Promise.race([Promise.resolve(${u}), Promise.resolve(1)]))`,
      none,
      async,
    ),
    body(
      g,
      "Promise.any",
      "A",
      (_, u) => `res.json(await Promise.any([Promise.resolve(${u})]))`,
      none,
      async,
    ),
    body(
      g,
      "Promise.allSettled",
      "A",
      (_, u) =>
        `const [r] = await Promise.allSettled([Promise.resolve(${u})])\nres.json((r as any).value)`,
      none,
      async,
    ),
    body(
      g,
      "Promise.all rejection caught",
      "A",
      (_, u) => `Promise.all([Promise.reject(${u})]).catch((e) => res.json(e))`,
    ),
    body(
      g,
      "Promise.all of constructed promises",
      "A",
      (_, u) =>
        `const [a] = await Promise.all([new Promise((resolve) => resolve(${u})), new Promise((resolve) => resolve(1))])\nres.json(a)`,
      none,
      async,
    ),
    body(
      g,
      "for await over constructed promises",
      "A",
      (_, u) => `for await (const x of [new Promise((resolve) => resolve(${u}))]) res.json(x)`,
      none,
      async,
    ),
    body(
      g,
      "resolve handed to a package function",
      "B",
      (_, u) => `res.json(await new Promise((resolve) => lib.once(${u}, resolve)))`,
      () => `import * as lib from "some-lib";\n`,
      async,
    ),
  ]
}

function reflection(): Form[] {
  const g = "builtins and higher-order data"
  return [
    body(g, "Reflect.get with a dynamic key", "B", () => `res.json(Reflect.get(${USER}, key))`),
    body(
      g,
      "Reflect.set",
      "A",
      (f, u) => `const o: any = {}\nReflect.set(o, "${f}", ${u})\nres.json(o.${f})`,
    ),
    body(
      g,
      "Reflect.apply",
      "A",
      (_, u) => `res.json(Reflect.apply(id, null, [${u}]))`,
      () => `function id(v: any) { return v }\n`,
    ),
    body(
      g,
      "Reflect.construct",
      "A",
      (_, u) => `res.json(Reflect.construct(Box, [${u}]).v)`,
      () => `class Box { v: any; constructor(v: any) { this.v = v } }\n`,
    ),
    body(
      g,
      "Reflect.getOwnPropertyDescriptor",
      "A",
      (f) => `res.json(Reflect.getOwnPropertyDescriptor(${USER}, "${f}")?.value)`,
    ),
    body(
      g,
      "Reflect.defineProperty",
      "A",
      (f, u) =>
        `const o: any = {}\nReflect.defineProperty(o, "${f}", { value: ${u} })\nres.json(o.${f})`,
    ),
    body(
      g,
      "Array.prototype.map.call",
      "A",
      (_, u) => `res.json(Array.prototype.map.call([${u}], (x: any) => x)[0])`,
    ),
    body(
      g,
      "Array.prototype.slice.call",
      "A",
      (_, u) => `res.json(Array.prototype.slice.call([${u}])[0])`,
    ),
    body(g, "empty array literal .call", "A", (_, u) => `res.json([].concat.call([], [${u}])[0])`),
    body(
      g,
      "Object.prototype.hasOwnProperty.call as a guard",
      "A",
      (f, u) => `if (Object.prototype.hasOwnProperty.call(${USER}, "${f}")) res.json(${u})`,
    ),
    body(
      g,
      "JSON.parse(JSON.stringify(x)) of a record",
      "A",
      (f) => `res.json(JSON.parse(JSON.stringify(${USER})).${f})`,
    ),
  ]
}

function partialApplication(): Form[] {
  const g = "functions"
  return [
    body(
      g,
      "bind with a partially applied argument",
      "A",
      (_, u) => `const bound = add.bind(null, ${u})\nres.json(bound(1))`,
      () => `function add(a: any, b: any) { return a }\n`,
    ),
    body(
      g,
      "bind with the rest of the arguments later",
      "A",
      (_, u) => `res.json(add.bind(null, 1)(${u}))`,
      () => `function add(a: any, b: any) { return b }\n`,
    ),
    body(
      g,
      "bind of an object method",
      "A",
      (_, u) => `const o = { m(v: any) { return v } }\nconst f = o.m.bind(o)\nres.json(f(${u}))`,
    ),
    body(
      g,
      "bind fixing this",
      "A",
      (_, u) => `res.json(out.bind({ v: ${u} })())`,
      () => `function out(this: any) { return this.v }\n`,
    ),
    body(
      g,
      "bind of a class method",
      "A",
      (_, u) => `const b = new Box(${u})\nconst f = b.out.bind(b)\nres.json(f())`,
      () => `class Box { v: any; constructor(v: any) { this.v = v } out() { return this.v } }\n`,
    ),
    body(
      g,
      "bound function passed as a callback",
      "A",
      (_, u) => `[${u}].forEach(show.bind(null, res))`,
      () => `function show(res: any, v: any) { res.json(v) }\n`,
    ),
    body(
      g,
      "bind of a function the scan cannot read",
      "B",
      (_, u) => `res.json(lib.run.bind(null, ${u})())`,
      () => `import * as lib from "some-lib";\n`,
    ),
    body(
      g,
      "method call with a literal key",
      "A",
      (_, u) => `const o = { m(v: any) { return v } }\nres.json(o["m"](${u}))`,
    ),
    body(
      g,
      "method call with a constant key",
      "A",
      (_, u) => `const o = { m(v: any) { return v } }\nconst k = "m"\nres.json(o[k](${u}))`,
    ),
    body(
      g,
      "property read with a constant key",
      "A",
      (f) => `const k = "${f}"\nres.json(${USER}[k])`,
    ),
    body(
      g,
      "store with a constant key",
      "A",
      (f, u) => `const k = "${f}"\nconst o: any = {}\no[k] = ${u}\nres.json(o.${f})`,
    ),
    body(
      g,
      "a let is not a constant key",
      "B",
      () => `let k = "email"\nk = key\nres.json(${USER}[k])`,
    ),
    body(
      g,
      "a shadowed constant key",
      "B",
      () => `const k = "email"\nif (key) { const k = key; res.json(${USER}[k]) }`,
    ),
    body(
      g,
      "constant key read inside a closure",
      "A",
      (_, u) =>
        `const o = { m(v: any) { return v } }\nconst k = "m"\nconst call = () => o[k](${u})\nres.json(call())`,
    ),
  ]
}

function prototypes(): Form[] {
  const g = "prototypes and mixins"
  return [
    mod(
      g,
      "constructor function and prototype method",
      "A",
      (_, u) =>
        `function Svc(this: any, v: any) { this.v = v }\n(Svc as any).prototype.out = function (this: any) { ${sink}(this.v) }\nexport function h() { new (Svc as any)(${u}).out() }`,
    ),
    mod(
      g,
      "prototype replaced by an object literal",
      "A",
      (_, u) =>
        `function Svc(this: any, v: any) { this.v = v }\n(Svc as any).prototype = { out() { ${sink}(this.v) } }\nexport function h() { new (Svc as any)(${u}).out() }`,
    ),
    mod(
      g,
      "prototype extended with Object.assign",
      "A",
      (_, u) =>
        `function Svc(this: any, v: any) { this.v = v }\nObject.assign((Svc as any).prototype, { out() { ${sink}(this.v) } })\nexport function h() { new (Svc as any)(${u}).out() }`,
    ),
    mod(
      g,
      "constructor function held in a variable",
      "A",
      (_, u) =>
        `const Svc: any = function (this: any, v: any) { this.v = v }\nSvc.prototype.out = function () { ${sink}(this.v) }\nexport function h() { new Svc(${u}).out() }`,
    ),
    mod(
      g,
      "static property of a function",
      "A",
      (_, u) =>
        `function Svc() {}\n;(Svc as any).send = function (v: any) { ${sink}(v) }\nexport function h() { (Svc as any).send(${u}) }`,
    ),
    mod(
      g,
      "Object.create from an object",
      "A",
      (_, u) =>
        `const proto = { out(v: any) { ${sink}(v) } }\nexport function h() { const o = Object.create(proto); o.out(${u}) }`,
    ),
    mod(
      g,
      "Object.create reads a prototype field through this",
      "A",
      (_, u) =>
        `const proto = { v: ${u}, out() { ${sink}(this.v) } }\nexport function h() { Object.create(proto).out() }`,
    ),
    mod(
      g,
      "Object.setPrototypeOf",
      "A",
      (_, u) =>
        `const proto = { out(v: any) { ${sink}(v) } }\nexport function h() { const o: any = {}; Object.setPrototypeOf(o, proto); o.out(${u}) }`,
    ),
    mod(
      g,
      "__proto__ in an object literal",
      "A",
      (_, u) =>
        `const proto = { out(v: any) { ${sink}(v) } }\nexport function h() { const o: any = { __proto__: proto }; o.out(${u}) }`,
    ),
    mod(
      g,
      "constructor function inheriting through Object.create",
      "A",
      (_, u) =>
        `function Base() {}\n;(Base as any).prototype.out = function (v: any) { ${sink}(v) }\nfunction Derived() {}\n;(Derived as any).prototype = Object.create((Base as any).prototype)\nexport function h() { new (Derived as any)().out(${u}) }`,
    ),
    mod(
      g,
      "method added to a class prototype",
      "A",
      (_, u) =>
        `class Svc {}\n;(Svc as any).prototype.out = function (v: any) { ${sink}(v) }\nexport function h() { (new Svc() as any).out(${u}) }`,
    ),
    mod(
      g,
      "mixin copied onto a class prototype",
      "A",
      (_, u) =>
        `class Svc {}\nconst mixin = { out(v: any) { ${sink}(v) } }\nObject.assign(Svc.prototype, mixin)\nexport function h() { (new Svc() as any).out(${u}) }`,
    ),
    mod(
      g,
      "instance method over a prototype method of the same name",
      "A",
      (_, u) =>
        `class Svc { out(v: any) { ${sink}(v) } }\n;(Svc as any).prototype.other = function () {}\nexport function h() { new Svc().out(${u}) }`,
    ),
    mod(
      g,
      "prototype of a package function",
      "B",
      (_, u) => `export function h() { const o = Object.create(base); o.out(${u}) }`,
      `import { base } from "some-lib";\n`,
    ),
    mod(
      g,
      "constructor function called with new from a package",
      "B",
      (_, u) => `export function h() { new Thing(${u}).out() }`,
      `import { Thing } from "some-lib";\n`,
    ),
  ]
}

function commonjs(): Form[] {
  const g = "CommonJS"
  const use = (field: string, call: string, requires: string): Record<string, string> => ({
    "app/p.ts": `${cap}${requires}\nexport function h() { ${call.replace("$", userField(field))} }\n`,
  })
  return [
    multi(g, "exports.name = function", "A", (f) => ({
      ...lib(`exports.fx = function (v: any) { ${sink}(v) }\n`),
      ...use(f, `lib.fx($)`, `const lib = require("./lib.js")`),
    })),
    multi(g, "module.exports.name = function", "A", (f) => ({
      ...lib(`module.exports.fx = function (v: any) { ${sink}(v) }\n`),
      ...use(f, `lib.fx($)`, `const lib = require("./lib.js")`),
    })),
    multi(g, "module.exports = an object of names", "A", (f) => ({
      ...lib(`function fx(v: any) { ${sink}(v) }\nmodule.exports = { fx }\n`),
      ...use(f, `lib.fx($)`, `const lib = require("./lib.js")`),
    })),
    multi(g, "destructured require", "A", (f) => ({
      ...lib(`function fx(v: any) { ${sink}(v) }\nmodule.exports = { fx }\n`),
      ...use(f, `fx($)`, `const { fx } = require("./lib.js")`),
    })),
    multi(g, "module.exports = a function", "A", (f) => ({
      ...lib(`module.exports = function (v: any) { ${sink}(v) }\n`),
      ...use(f, `fx($)`, `const fx = require("./lib.js")`),
    })),
    multi(g, "module.exports = a class", "A", (f) => ({
      ...lib(`module.exports = class Svc { send(v: any) { ${sink}(v) } }\n`),
      ...use(f, `new Svc().send($)`, `const Svc = require("./lib.js")`),
    })),
    multi(g, "require result called directly", "A", (f) => ({
      ...lib(`module.exports = function (v: any) { ${sink}(v) }\n`),
      ...use(f, `require("./lib.js")($)`, ""),
    })),
    multi(g, "require without an extension", "A", (f) => ({
      ...lib(`exports.fx = (v: any) => ${sink}(v)\n`),
      ...use(f, `lib.fx($)`, `const lib = require("./lib")`),
    })),
    multi(g, "exports assigned from inside a function", "A", (f) => ({
      ...lib(
        `export {}\nfunction init() { (exports as any).fx = (v: any) => ${sink}(v) }\ninit()\n`,
      ),
      ...use(f, `lib.fx($)`, `const lib = require("./lib.js")`),
    })),
    multi(g, "import = require", "A", (f) => ({
      ...lib(`exports.fx = (v: any) => ${sink}(v)\n`),
      ...use(f, `lib.fx($)`, `import lib = require("./lib.js")`),
    })),
    multi(g, "ES module required from CommonJS code", "A", (f) => ({
      ...lib(`export function fx(v: any) { ${sink}(v) }\n`),
      ...use(f, `lib.fx($)`, `const lib = require("./lib.js")`),
    })),
    multi(g, "require of a package", "B", (f) =>
      use(f, `lib.send($)`, `const lib = require("some-lib")`),
    ),
    multi(g, "destructured require of a package", "B", (f) =>
      use(f, `send($)`, `const { send } = require("some-lib")`),
    ),
    multi(g, "require with a specifier built from tracked data", "B", (f) =>
      use(f, `require($)`, ""),
    ),
    multi(g, "require with an unrelated computed specifier", "A", (f) => ({
      "app/p.ts": `${cap}export function h(res: any, key: string) { require(key); res.json(${userField(f)}) }\n`,
    })),
    multi(g, "required module that exports nothing", "B", (f) => ({
      ...lib(`const hidden = 1\n`),
      ...use(f, `lib.fx($)`, `const lib = require("./lib.js")`),
    })),
  ]
}

function decorators(): Form[] {
  const g = "decorators"
  const descriptor = `function wrap(target: any, key: string, desc: any) { const orig = desc.value; return { value: function (this: any, ...args: any[]) { return orig.apply(this, args) }, configurable: true } }\n`
  const inPlace = `function rewrite(target: any, key: string, desc: any) { const orig = desc.value; desc.value = function (this: any, ...args: any[]) { return orig.apply(this, args) }; return desc }\n`
  return [
    mod(
      g,
      "method decorator that returns a descriptor wrapping the method",
      "A",
      (_, u) =>
        `${descriptor}class Svc { @wrap send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "method decorator that returns nothing",
      "A",
      (_, u) =>
        `function mark(target: any, key: string) {}\nclass Svc { @mark send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "method decorator that hands the descriptor back untouched",
      "A",
      (_, u) =>
        `function keep(target: any, key: string, desc: any) { return desc }\nclass Svc { @keep send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "decorator factory",
      "A",
      (_, u) =>
        `function tag(name: string) { return function (target: any, key: string, desc: any) { return desc } }\nclass Svc { @tag("x") send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "decorator that replaces the method with one that logs",
      "A",
      (_, u) =>
        `function spy(target: any, key: string, desc: any) { return { value: function (this: any, v: any) { ${sink}(v); return 1 } } }\nclass Svc { @spy send(v: any) { return v } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "decorator that rewrites the descriptor in place",
      "B",
      (_, u) =>
        `${inPlace}class Svc { @rewrite send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "standard decorator that replaces the method",
      "A",
      (_, u) =>
        `function wrap(method: any, context: any) { return function (this: any, ...args: any[]) { return method.apply(this, args) } }\nclass Svc { @wrap send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "class decorator",
      "A",
      (_, u) =>
        `function seal(ctor: any) { return ctor }\n@seal\nclass Svc { send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "class decorator that returns a subclass",
      "A",
      (_, u) =>
        `function ext(ctor: any) { return class extends ctor {} }\n@ext\nclass Svc { send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "field decorator",
      "A",
      (_, u) =>
        `function field(target: any, key: string) {}\nclass Svc { @field v: any = ${u}; out() { ${sink}(this.v) } }\nexport function h() { new Svc().out() }`,
    ),
    mod(
      g,
      "accessor decorator",
      "A",
      (_, u) =>
        `function acc(target: any, key: string, desc: any) { return desc }\nclass Svc { @acc get v() { return ${u} } }\nexport function h() { ${sink}(new Svc().v) }`,
    ),
    mod(
      g,
      "parameter decorator",
      "A",
      (_, u) =>
        `function arg(target: any, key: string, index: number) {}\nclass Svc { send(@arg v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    mod(
      g,
      "static method decorator",
      "A",
      (_, u) =>
        `function mark(target: any, key: string) {}\nclass Svc { @mark static send(v: any) { ${sink}(v) } }\nexport function h() { Svc.send(${u}) }`,
    ),
    mod(
      g,
      "stacked decorators",
      "A",
      (_, u) =>
        `${descriptor}function mark(target: any, key: string) {}\nclass Svc { @mark @wrap send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
    ),
    multi(g, "decorator imported from another module", "A", (_, u) => ({
      "app/deco.ts": `export function mark(target: any, key: string, desc: any) { return desc }\n`,
      "app/p.ts": `${cap}import { mark } from "./deco.js";\nclass Svc { @mark send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }\n`,
    })),
    mod(
      g,
      "package method decorator",
      "B",
      (_, u) =>
        `class Svc { @Cached() send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
      `import { Cached } from "some-lib";\n`,
    ),
    mod(
      g,
      "package method decorator without a call",
      "B",
      (_, u) =>
        `class Svc { @cached send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
      `import { cached } from "some-lib";\n`,
    ),
    mod(
      g,
      "package class decorator",
      "B",
      (_, u) =>
        `@Injectable()\nclass Svc { send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
      `import { Injectable } from "some-lib";\n`,
    ),
    mod(
      g,
      "package decorator on another member",
      "A",
      (_, u) =>
        `class Svc { @Cached() other() {} send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
      `import { Cached } from "some-lib";\n`,
    ),
    mod(
      g,
      "package parameter decorator",
      "A",
      (_, u) =>
        `class Svc { send(@Body() v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
      `import { Body } from "some-lib";\n`,
    ),
    mod(
      g,
      "package accessor decorator",
      "B",
      (_, u) =>
        `class Svc { v: any = ${u}; @Observed() get w() { return this.v } }\nexport function h() { ${sink}(new Svc().w) }`,
      `import { Observed } from "some-lib";\n`,
    ),
    mod(
      g,
      "decorator factory from a package on a method",
      "B",
      (_, u) =>
        `const guard = Guard("x")\nclass Svc { @guard send(v: any) { ${sink}(v) } }\nexport function h() { new Svc().send(${u}) }`,
      `import { Guard } from "some-lib";\n`,
    ),
  ]
}

function perEvaluation(): Form[] {
  const g = "classes and this"
  const other = (f: string): string => userField(f === "email" ? "passwordHash" : "email")
  return [
    body(
      g,
      "classes from one factory called with different data",
      "A",
      (f, u) =>
        `const Other = mk(${other(f)})\nconst Mine = mk(${u})\nvoid new Other().out()\nres.json(new Mine().out())`,
      () => `function mk(v: any) { return class { out() { return v } } }\n`,
    ),
    body(
      g,
      "class declarations inside a function called with different data",
      "A",
      (f, u) => `void new (mk(${other(f)}))().out()\nres.json(new (mk(${u}))().out())`,
      () => `function mk(v: any) { class C { out() { return v } }\n return C }\n`,
    ),
    body(
      g,
      "static members of classes from one factory",
      "A",
      (f, u) => `void mk(${other(f)}).send()\nres.json(mk(${u}).send())`,
      () => `function mk(v: any) { return class { static send() { return v } } }\n`,
    ),
    body(
      g,
      "constructors of classes from one factory",
      "A",
      (f, u) => `void new (mk(${other(f)}))().v\nconst C = mk(${u})\nres.json(new C().v)`,
      () => `function mk(v: any) { return class { v: any; constructor() { this.v = v } } }\n`,
    ),
    body(
      g,
      "field initializers of classes from one factory",
      "A",
      (f, u) => `void new (mk(${other(f)}))().v\nconst C = mk(${u})\nres.json(new C().v)`,
      () => `function mk(x: any) { return class { v = x } }\n`,
    ),
    body(
      g,
      "same class evaluated twice with the same data",
      "A",
      (_, u) =>
        `const A = mk(${u})\nconst B = mk(${u})\nres.json(new A().out())\nres.json(new B().out())`,
      () => `function mk(v: any) { return class { out() { return v } } }\n`,
    ),
    body(
      g,
      "subclass made inside a function",
      "A",
      (f, u) => `void new (mk(${other(f)}))().out()\nres.json(new (mk(${u}))().out())`,
      () =>
        `class Base { out() { return this.v } v: any }\nfunction mk(x: any) { return class extends Base { v = x } }\n`,
    ),
  ]
}

/** Values that carry tracked data out of the program without any of it being read: closures, classes, promises. */
function escapes(): Form[] {
  const pkg = `import * as lib from "some-lib";\n`
  return [
    body(
      "functions",
      "closure made by a factory and handed to a package, sending what it captured",
      "A",
      (_, u) => `lib.on("x", mk(${u}))`,
      () => `${pkg}function mk(v: any) { return () => console.log(v) }\n`,
    ),
    body(
      "functions",
      "closure made by a factory and handed to a package, returning what it captured",
      "B",
      (_, u) => `lib.on("x", mk(${u}))`,
      () => `${pkg}function mk(v: any) { return () => v }\n`,
    ),
    body(
      "functions",
      "closure made by a second call of a factory the first call of which was used",
      "B",
      (_, u) => `mk(1)()\nlib.on("x", mk(${u}))`,
      () => `${pkg}function mk(v: any) { return () => v }\n`,
    ),
    body(
      "classes and this",
      "class made by a factory and handed to a package",
      "B",
      (_, u) => `lib.on("x", mk(${u}))`,
      () => `${pkg}function mk(v: any) { return class { out() { return v } } }\n`,
    ),
    body(
      "builtins and higher-order data",
      "promise settled with tracked data and handed to a package",
      "B",
      (_, u) => `lib.on("x", new Promise((resolve) => resolve(${u})))`,
      () => pkg,
    ),
    body(
      "builtins and higher-order data",
      "Map holding tracked data handed to a package",
      "B",
      (_, u) => `lib.on("x", new Map([["a", ${u}]]))`,
      () => pkg,
    ),
    body(
      "builtins and higher-order data",
      "Set holding tracked data handed to a package",
      "B",
      (_, u) => `lib.on("x", new Set([${u}]))`,
      () => pkg,
    ),
    mod(
      "generators and iteration",
      "generator over tracked data handed to a package",
      "B",
      (_, u) => `function* g(v: any) { yield v }\nexport function h() { lib.on("x", g(${u})) }`,
      pkg,
    ),
  ]
}

/** The rows added after the first catalog; see `flow-catalog-forms.ts` for the rest. */
export function moreForms(): Form[] {
  return [
    ...escapes(),
    ...collections(),
    ...promises(),
    ...reflection(),
    ...partialApplication(),
    ...prototypes(),
    ...commonjs(),
    ...decorators(),
    ...perEvaluation(),
    ...generatorsMore(),
  ]
}

function generatorsMore(): Form[] {
  const g = "generators and iteration"
  return [
    mod(
      g,
      "value sent into a generator and returned",
      "A",
      (_, u) =>
        `function* gen() { const x = yield 1; yield x }\nexport function h() { const it = gen(); it.next(); ${sink}(it.next(${u}).value) }`,
    ),
    mod(
      g,
      "value sent into a generator through a variable",
      "A",
      (_, u) =>
        `function* gen() { let total: any; while (true) { total = yield total; ${sink}(total) } }\nexport function h() { const it = gen(); it.next(); it.next(${u}) }`,
    ),
    mod(
      g,
      "value sent into a generator method",
      "A",
      (_, u) =>
        `const o = { *gen() { const x = yield 1; ${sink}(x) } }\nexport function h() { const it = o.gen(); it.next(); it.next(${u}) }`,
    ),
    mod(
      g,
      "value sent into a generator the scan cannot read",
      "B",
      (_, u) => `export function h() { const it = makeGen(); it.next(); it.next(${u}) }`,
      `import { makeGen } from "some-lib";\n`,
    ),
    mod(
      g,
      "value sent into an async generator",
      "A",
      (_, u) =>
        `async function* gen() { const x = yield 1; ${sink}(x) }\nexport async function h() { const it = gen(); await it.next(); await it.next(${u}) }`,
    ),
  ]
}
