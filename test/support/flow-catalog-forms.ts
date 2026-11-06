import { fn, USER, userField } from "./flow-catalog.js"
import { IMPORT_CAP } from "../build/mut-flow-scan-harness.js"
import { body, form, mod, multi } from "./flow-catalog-builders.js"
import type { Form } from "./flow-catalog-builders.js"
import { aliasingForms } from "./flow-catalog-aliasing.js"
import { moreForms } from "./flow-catalog-more.js"

export type { Form }

const cap = IMPORT_CAP

function basics(): Form[] {
  const g = "basics"
  return [
    body(g, "direct read", "A", (_, u) => `res.json(${u})`),
    body(g, "local alias", "A", (_, u) => `const v = ${u}\nres.json(v)`),
    body(g, "object destructuring", "A", (f) => `const { ${f} } = ${USER}\nres.json(${f})`),
    body(g, "destructuring with rename", "A", (f) => `const { ${f}: x } = ${USER}\nres.json(x)`),
    body(
      g,
      "destructuring with default",
      "A",
      (f) => `const { ${f}: x = "d" } = ${USER}\nres.json(x)`,
    ),
    body(g, "array destructuring", "A", (_, u) => `const [x] = [${u}]\nres.json(x)`),
    body(g, "object spread", "A", (f) => `const o = { ...${USER} }\nres.json(o.${f})`),
    body(g, "array spread", "A", (_, u) => `const a = [...[${u}]]\nres.json(a[0])`),
    body(g, "object rest", "A", (f) => `const { id, ...rest } = ${USER}\nres.json(rest.${f})`),
    body(g, "optional chaining", "A", (_, u) => `res.json(${u.replace("user.", "user?.")})`),
    body(g, "optional call", "A", (_, u) => `const id = (x: any) => x\nres.json(id?.(${u}))`),
    body(g, "computed literal key", "A", (f) => `res.json(${USER}["${f}"])`),
    body(g, "computed dynamic key", "B", () => `res.json(${USER}[key])`),
    body(g, "computed key in a literal", "A", (_, u) => `const o = { [key]: ${u} }\nres.json(o.x)`),
    body(
      g,
      "dynamic property store",
      "B",
      (f, u) => `const o: any = {}\no[key] = ${u}\nres.json(o.${f})`,
    ),
    body(
      g,
      "nested property store",
      "A",
      (_, u) => `const o: any = { inner: {} }\no.inner.x = ${u}\nres.json(o.inner.x)`,
    ),
    body(g, "string template", "A", (_, u) => `res.json(\`x \${${u}}\`)`),
    body(g, "string concatenation", "A", (_, u) => `res.json("x" + ${u})`),
    body(g, "string method chain", "A", (_, u) => `res.json(${u}.toLowerCase().trim())`),
    body(g, "comma operator", "A", (_, u) => `res.json((0, ${u}))`),
    body(g, "logical or / nullish", "A", (_, u) => `res.json(${u} ?? "" || "")`),
    body(g, "ternary", "A", (_, u) => `res.json(key ? ${u} : "none")`),
  ]
}

function control(): Form[] {
  const g = "control flow"
  return [
    body(
      g,
      "try / catch / finally",
      "A",
      (_, u) => `let v: any\ntry { v = ${u} } catch (e) { v = 1 } finally { res.json(v) }`,
    ),
    body(g, "throw caught locally", "A", (_, u) => `try { throw ${u} } catch (e) { res.json(e) }`),
    body(
      g,
      "throw caught across a call",
      "A",
      (_, u) => `try { thrower(${u}) } catch (e) { res.json(e) }`,
      () => `function thrower(v: any) { throw v }\n`,
    ),
    body(
      g,
      "promise rejection caught",
      "A",
      (_, u) => `Promise.reject(${u}).catch((e) => res.json(e))`,
    ),
    body(
      g,
      "switch",
      "A",
      (_, u) => `switch (key) { case "a": res.json(${u}); break; default: break }`,
    ),
    body(g, "for-of loop", "A", (_, u) => `for (const x of [${u}]) res.json(x)`),
    body(
      g,
      "for-in over tracked data",
      "B",
      () => `const u = ${USER}\nfor (const k in u) res.json(u[k])`,
    ),
    body(
      g,
      "classic for loop",
      "A",
      (_, u) => `let v: any\nfor (let i = 0; i < 2; i++) { v = ${u} }\nres.json(v)`,
    ),
    body(g, "while loop", "A", (_, u) => `let v: any\nwhile (!v) { v = ${u} }\nres.json(v)`),
    body(g, "labeled block", "A", (_, u) => `blk: { res.json(${u}); break blk }`),
  ]
}

function functions(): Form[] {
  const g = "functions"
  return [
    body(
      g,
      "closure reading a variable",
      "A",
      (_, u) => `const v = ${u}\nconst get = () => v\nres.json(get())`,
    ),
    body(g, "closure returning a read", "A", (_, u) => `const get = () => ${u}\nres.json(get())`),
    body(
      g,
      "higher-order function",
      "A",
      (_, u) => `res.json(apply((x: any) => x, ${u}))`,
      () => `function apply(f: any, v: any) { return f(v) }\n`,
    ),
    body(
      g,
      "function returning a function",
      "A",
      (_, u) => `const mk = (v: any) => () => v\nres.json(mk(${u})())`,
    ),
    body(g, "immediately invoked function", "A", (_, u) => `res.json((() => ${u})())`),
    body(
      g,
      "recursion",
      "A",
      (_, u) => `res.json(rec(3, ${u}))`,
      () => `function rec(n: number, v: any): any { return n > 0 ? rec(n - 1, v) : v }\n`,
    ),
    body(
      g,
      "default parameter",
      "A",
      () => `res.json(d())`,
      (_, u) => `function d(v: any = ${u}) { return v }\n`,
    ),
    body(
      g,
      "rest parameters",
      "A",
      (_, u) => `res.json(r(1, ${u}))`,
      () => `function r(...vs: any[]) { return vs[1] }\n`,
    ),
    body(
      g,
      "spread arguments",
      "A",
      (_, u) => `res.json(id(...[${u}]))`,
      () => `function id(v: any) { return v }\n`,
    ),
    body(
      g,
      "arguments object",
      "A",
      (_, u) => `res.json(viaArgs(${u}))`,
      () => `function viaArgs() { return arguments[0] }\n`,
    ),
    body(
      g,
      "Function.prototype.call",
      "A",
      (_, u) => `res.json(id.call(null, ${u}))`,
      () => `function id(v: any) { return v }\n`,
    ),
    body(
      g,
      "Function.prototype.apply",
      "A",
      (_, u) => `res.json(id.apply(null, [${u}]))`,
      () => `function id(v: any) { return v }\n`,
    ),
    body(
      g,
      "Function.prototype.bind",
      "A",
      (_, u) => `res.json(id.bind(null, ${u})())`,
      () => `function id(v: any) { return v }\n`,
    ),
    body(
      g,
      "method on an object literal",
      "A",
      (_, u) => `const o = { m(v: any) { return v } }\nres.json(o.m(${u}))`,
    ),
    body(
      g,
      "arrow stored in an object",
      "A",
      (_, u) => `const o = { m: (v: any) => v }\nres.json(o.m(${u}))`,
    ),
    body(
      g,
      "this in an object method",
      "A",
      (_, u) => `const o = { v: ${u}, m() { return this.v } }\nres.json(o.m())`,
    ),
    body(
      g,
      "getter on an object literal",
      "A",
      (_, u) => `const o = { get v() { return ${u} } }\nres.json(o.v)`,
    ),
    body(
      g,
      "setter on an object literal",
      "A",
      (_, u) => `const o = { set v(x: any) { res.json(x) } }\no.v = ${u}`,
    ),
    body(
      g,
      "module state written elsewhere (writer first)",
      "A",
      () => `res.json(store.v)`,
      (_, u) => `const store: any = {}\nexport function put() { store.v = ${u} }\n`,
    ),
    body(
      g,
      "module state written elsewhere (reader first)",
      "A",
      () => `put()`,
      (_, u) =>
        `const store: any = {}\nexport function read(res: any) { res.json(store.v) }\nfunction put() { store.v = ${u} }\n`,
    ),
    body(
      g,
      "callee mutates an argument object",
      "A",
      (f) => `const o: any = {}\nfill(o)\nres.json(o.${f})`,
      (f, u) => `function fill(o: any) { o.${f} = ${u} }\n`,
    ),
    body(
      g,
      "mutation through an alias of the object",
      "B",
      (f, u) => `const o: any = {}\nconst alias = o\nalias.${f} = ${u}\nres.json(o.${f})`,
    ),
    body(
      g,
      "store into a call result",
      "B",
      (f, u) => `make().${f} = ${u}`,
      () => `function make(): any { return {} }\n`,
    ),
    body(
      g,
      "Object.assign into a variable",
      "A",
      (f, u) => `const o: any = {}\nObject.assign(o, { ${f}: ${u} })\nres.json(o.${f})`,
    ),
    body(
      g,
      "Object.defineProperty on a variable",
      "A",
      (f, u) =>
        `const o: any = {}\nObject.defineProperty(o, "${f}", { value: ${u} })\nres.json(o.${f})`,
    ),
    body(
      g,
      "Object.assign into a call result",
      "B",
      (_, u) => `Object.assign(make(), { v: ${u} })`,
      () => `function make(): any { return {} }\n`,
    ),
    body(
      g,
      "Array.prototype.splice inserting data",
      "A",
      (_, u) => `const a: any[] = []\na.splice(0, 0, ${u})\nres.json(a[0])`,
    ),
    body(
      g,
      "Array.prototype.fill with data",
      "A",
      (_, u) => `const a: any[] = [0]\na.fill(${u})\nres.json(a[0])`,
    ),
    body(
      g,
      "push into a property of an object",
      "A",
      (_, u) => `const o: any = { list: [] }\no.list.push(${u})\nres.json(o.list[0])`,
    ),
    body(
      g,
      "push into a call result",
      "B",
      (_, u) => `make().push(${u})`,
      () => `function make(): any { return [] }\n`,
    ),
    body(
      g,
      "with statement over tracked data",
      "B",
      (f) => `with (userData.getSnapshot().fields.user) { res.json(${f}) }`,
    ),
    body(g, "Object.groupBy", "A", (_, u) => `res.json(Object.groupBy([${u}], (x: any) => x).k)`),
    body(
      g,
      "same helper called with two different callbacks",
      "A",
      (_, u) => `res.json(apply((x: any) => "k", ${u}))\nres.json(apply((x: any) => x, ${u}))`,
      () => `function apply(f: any, v: any) { return f(v) }\n`,
    ),
    body(
      g,
      "block-scoped name shadows an outer one",
      "A",
      (_, u) => `const v = ${u}\n{ const v = 1; void v }\nres.json(v)`,
    ),
    body(g, "var declared in a block", "A", (_, u) => `if (key) { var x = ${u} }\nres.json(x)`),
    body(
      g,
      "closures from one factory called with different data",
      "A",
      (f, u) =>
        `const other = mk(${userField(f === "email" ? "passwordHash" : "email")})\nconst mine = mk(${u})\nother()\nres.json(mine())`,
      () => `const mk = (v: any) => () => v\n`,
    ),
    body(
      g,
      "function declared after the call that uses it",
      "A",
      (_, u) => `res.json(helper())\nfunction helper() { return ${u} }`,
    ),
    body(
      g,
      "global object property written elsewhere",
      "A",
      () => `res.json((globalThis as any).leak)`,
      (_, u) => `export function put() { (globalThis as any).leak = ${u} }\n`,
    ),
    multi(g, "imported object filled in by another module", "A", (_, u) => ({
      "app/store.ts": `export const store: any = {}\n`,
      "app/w.ts": `${cap}import { store } from "./store.js"\nexport function put() { store.v = ${u} }\n`,
      "app/p.ts": `import { store } from "./store.js"\nexport function h(res: any) { res.json(store.v) }\n`,
    })),
    multi(g, "object of another module filled in through a namespace import", "A", (_, u) => ({
      "app/store.ts": `export const store: any = {}\n`,
      "app/w.ts": `${cap}import * as shared from "./store.js"\nexport function put() { shared.store.v = ${u} }\n`,
      "app/p.ts": `import { store } from "./store.js"\nexport function h(res: any) { res.json(store.v) }\n`,
    })),
    body(
      g,
      "function inside a namespace",
      "A",
      () => `N.leak(res)`,
      (_, u) => `namespace N { export function leak(res: any) { res.json(${u}) } }\n`,
    ),
    body(g, "data stored on an object the caller owns", "B", (_, u) => `res.user = ${u}`),
    body(g, "data pushed onto an array the caller owns", "B", (_, u) => `res.list.push(${u})`),
    body(
      g,
      "closure returned to an unknown caller",
      "B",
      (_, u) => `const app: any = res\napp.get("/x", () => ${u})`,
    ),
  ]
}

function builtins(): Form[] {
  const g = "builtins and higher-order data"
  return [
    body(g, "array map", "A", (f) => `res.json([${USER}].map((u: any) => u.${f}))`),
    body(g, "array forEach", "A", (f) => `[${USER}].forEach((u: any) => res.json(u.${f}))`),
    body(g, "array reduce", "A", (_, u) => `res.json([${u}].reduce((acc: any, x: any) => x, ""))`),
    body(g, "array find", "A", (f) => `res.json([${USER}].find((u: any) => u.id).${f})`),
    body(g, "array at", "A", (f) => `res.json([${USER}].at(0).${f})`),
    body(g, "array filter", "A", (f) => `res.json([${USER}].filter(Boolean)[0].${f})`),
    body(g, "promise then", "A", (_, u) => `Promise.resolve(${u}).then((e) => res.json(e))`),
    body(
      g,
      "async function with await",
      "A",
      (_, u) => `const v = await Promise.resolve(${u})\nres.json(v)`,
      () => "",
      "async ",
    ),
    body(
      g,
      "Promise.all",
      "A",
      (_, u) => `const [v] = await Promise.all([Promise.resolve(${u})])\nres.json(v)`,
      () => "",
      "async ",
    ),
    body(g, "Object.assign", "A", (_, u) => `res.json(Object.assign({}, { v: ${u} }).v)`),
    body(g, "Array.from", "A", (_, u) => `res.json(Array.from([${u}])[0])`),
    body(g, "Object.values", "A", (_, u) => `res.json(Object.values({ v: ${u} })[0])`),
    body(
      g,
      "JSON round trip",
      "A",
      (_, u) => `res.json(JSON.parse(JSON.stringify({ v: ${u} })).v)`,
    ),
    body(g, "structuredClone", "A", (_, u) => `res.json(structuredClone({ v: ${u} }).v)`),
    body(
      g,
      "tagged template with a project tag",
      "A",
      (_, u) => `res.json(tag\`x \${${u}}\`)`,
      () => `const tag = (s: any, v: any) => v\n`,
    ),
    form(g, "tagged template with a package tag", "B", (f) =>
      fn(`sql\`insert \${${userField(f)}}\``, `import { sql } from "some-orm";\n`),
    ),
  ]
}

function opaque(): Form[] {
  const g = "opaque and dynamic code"
  return [
    body(g, "Proxy", "B", (f) => `const p = new Proxy(${USER}, {})\nres.json(p.${f})`),
    body(g, "Reflect.get", "A", (f) => `res.json(Reflect.get(${USER}, "${f}"))`),
    body(g, "new Function", "B", (_, u) => `res.json(new Function("v", "return v")(${u}))`),
    body(g, "eval", "B", (_, u) => `res.json(eval(${u}))`),
    body(
      g,
      "call through an alias of a sink method",
      "B",
      (_, u) => `const send = res.json.bind(res)\nsend(${u})`,
    ),
    body(g, "destructured sink method", "B", (_, u) => `const { json } = res\njson(${u})`),
    form(g, "method of an unknown parameter", "B", (f) => ({
      "app/p.ts": `${cap}export function h(client: any) {\n  client.send(${userField(f)})\n}\n`,
    })),
    body(g, "computed method call", "B", (_, u) => `const o: any = {}\no[key](${u})`),
    body(
      g,
      "dynamic import of a computed specifier",
      "B",
      (_, u) => `await import(${u})`,
      () => "",
      "async ",
    ),
    form(g, "package named import", "B", (f) =>
      fn(`audit(${userField(f)})`, `import { audit } from "some-analytics-lib";\n`),
    ),
    form(g, "package default import", "B", (f) =>
      fn(`audit(${userField(f)})`, `import audit from "some-analytics-lib";\n`),
    ),
    form(g, "package namespace import", "B", (f) =>
      fn(`lib.send(${userField(f)})`, `import * as lib from "some-lib";\n`),
    ),
    form(g, "package constructor", "B", (f) =>
      fn(`const c = new Client()\nc.send(${userField(f)})`, `import { Client } from "some-lib";\n`),
    ),
    form(g, "package present under node_modules", "B", (f) => ({
      ...fn(`pkg.go(${userField(f)})`, `import * as pkg from "vendored-lib";\n`),
      "node_modules/vendored-lib/index.js": `export function go(v) { console.log(v) }\n`,
    })),
    form(g, "conditional callee", "B", (f) =>
      fn(
        `(key ? a : b)(${userField(f)})`,
        `function a(x: any) { return 1 }\nfunction b(x: any) { return 2 }\n`,
      ),
    ),
  ]
}

function classes(): Form[] {
  const g = "classes and this"
  const sink = "console.log"
  return [
    mod(
      g,
      "constructor and instance method",
      "A",
      (_, u) =>
        `class Svc { send(v: any) { ${sink}(v) } }\nexport function h() { const s = new Svc(); s.send(${u}) }`,
    ),
    mod(
      g,
      "constructor stores to this",
      "A",
      (_, u) =>
        `class Svc { v: any; constructor(v: any) { this.v = v } out() { ${sink}(this.v) } }\nexport function h() { new Svc(${u}).out() }`,
    ),
    mod(
      g,
      "instance held in a variable",
      "A",
      (_, u) =>
        `class Svc { v: any; constructor(v: any) { this.v = v } out() { ${sink}(this.v) } }\nexport function h() { const s = new Svc(${u}); s.out() }`,
    ),
    mod(
      g,
      "this method calls this method",
      "A",
      (_, u) =>
        `class S { a(v: any) { this.b(v) } b(v: any) { ${sink}(v) } }\nexport function h() { new S().a(${u}) }`,
    ),
    mod(
      g,
      "static method",
      "A",
      (_, u) =>
        `class S { static send(v: any) { ${sink}(v) } }\nexport function h() { S.send(${u}) }`,
    ),
    mod(
      g,
      "static factory",
      "A",
      (_, u) =>
        `class S { v: any; static make(v: any) { const s = new S(); s.v = v; return s } out() { ${sink}(this.v) } }\nexport function h() { S.make(${u}).out() }`,
    ),
    mod(
      g,
      "class field arrow function",
      "A",
      (_, u) =>
        `class S { send = (v: any) => ${sink}(v) }\nexport function h() { new S().send(${u}) }`,
    ),
    mod(
      g,
      "class field initializer",
      "A",
      (_, u) =>
        `class S { v = ${u}; out() { ${sink}(this.v) } }\nexport function h() { new S().out() }`,
    ),
    mod(
      g,
      "getter",
      "A",
      (_, u) =>
        `class S { _v: any; constructor(v: any) { this._v = v } get v() { return this._v } }\nexport function h() { ${sink}(new S(${u}).v) }`,
    ),
    mod(
      g,
      "setter",
      "A",
      (_, u) =>
        `class S { set v(x: any) { ${sink}(x) } }\nexport function h() { const s = new S(); s.v = ${u} }`,
    ),
    mod(
      g,
      "private field",
      "A",
      (_, u) =>
        `class S { #v: any; constructor(v: any) { this.#v = v } out() { ${sink}(this.#v) } }\nexport function h() { new S(${u}).out() }`,
    ),
    mod(
      g,
      "super constructor call",
      "A",
      (_, u) =>
        `class A { v: any; constructor(v: any) { this.v = v } }\nclass B extends A { constructor(v: any) { super(v) } out() { ${sink}(this.v) } }\nexport function h() { new B(${u}).out() }`,
    ),
    mod(
      g,
      "inherited method",
      "A",
      (_, u) =>
        `class A { send(v: any) { ${sink}(v) } }\nclass B extends A {}\nexport function h() { new B().send(${u}) }`,
    ),
    mod(
      g,
      "overriding method calling super",
      "A",
      (_, u) =>
        `class A { send(v: any) { ${sink}(v) } }\nclass B extends A { send(v: any) { super.send(v) } }\nexport function h() { new B().send(${u}) }`,
    ),
    mod(
      g,
      "method returning this",
      "A",
      (_, u) =>
        `class S { v: any; set(v: any) { this.v = v; return this } out() { ${sink}(this.v) } }\nexport function h() { new S().set(${u}).out() }`,
    ),
    mod(
      g,
      "instance made by a factory function",
      "A",
      (_, u) =>
        `class S { send(v: any) { ${sink}(v) } }\nfunction make() { return new S() }\nexport function h() { make().send(${u}) }`,
    ),
    mod(
      g,
      "instance passed as an argument",
      "A",
      (_, u) =>
        `class S { send(v: any) { ${sink}(v) } }\nfunction use(s: any) { s.send(${u}) }\nexport function h() { use(new S()) }`,
    ),
    mod(
      g,
      "class expression",
      "A",
      (_, u) =>
        `const S = class { send(v: any) { ${sink}(v) } }\nexport function h() { new S().send(${u}) }`,
    ),
    mod(
      g,
      "method used as a callback",
      "A",
      (_, u) =>
        `class S { send(v: any) { ${sink}(v) } }\nexport function h() { const s = new S(); [${u}].forEach(s.send) }`,
    ),
    mod(
      g,
      "class extending a package class",
      "B",
      (_, u) => `class S extends Base {}\nexport function h() { new S().send(${u}) }`,
      `import { Base } from "some-lib";\n`,
    ),
    mod(
      g,
      "instance from a package factory",
      "B",
      (_, u) => `export function h() { const s = makeService(); s.send(${u}) }`,
      `import { makeService } from "some-lib";\n`,
    ),
    mod(
      g,
      "constructor function with prototype",
      "A",
      (_, u) =>
        `function Svc() {}\n(Svc as any).prototype.send = function (v: any) { ${sink}(v) }\nexport function h() { new (Svc as any)().send(${u}) }`,
    ),
    mod(
      g,
      "logger held in a field",
      "A",
      (_, u) =>
        `class S { logger: any; run() { this.logger.info(${u}) } }\nexport function h() { new S().run() }`,
    ),
    mod(
      g,
      "super property read",
      "A",
      (_, u) =>
        `class A { get v() { return ${u} } }\nclass B extends A { get w() { return super.v } }\nexport function h() { ${sink}(new B().w) }`,
    ),
    mod(
      g,
      "new with spread arguments",
      "A",
      (_, u) =>
        `class Box { v: any; constructor(v: any) { this.v = v } }\nexport function h() { ${sink}(new Box(...[${u}]).v) }`,
    ),
    mod(
      g,
      "static getter",
      "A",
      (_, u) => `class S { static get v() { return ${u} } }\nexport function h() { ${sink}(S.v) }`,
    ),
    mod(
      g,
      "static block",
      "A",
      (_, u) => `class S { static { ${sink}(${u}) } }\nexport function h() { return S }`,
    ),
    mod(
      g,
      "TypeScript parameter property",
      "A",
      (_, u) =>
        `class S { constructor(private v: any) {} out() { ${sink}(this.v) } }\nexport function h() { new S(${u}).out() }`,
    ),
    mod(
      g,
      "iterable class instance",
      "A",
      (_, u) =>
        `class Bag { v: any; constructor(v: any) { this.v = v } *[Symbol.iterator]() { yield this.v } }\nexport function h() { for (const x of new Bag(${u})) ${sink}(x) }`,
    ),
  ]
}

function modules(): Form[] {
  const g = "default exports and re-exports"
  const use =
    (name: string, spec: string, call: (f: string) => string) =>
    (f: string, extra = ""): string =>
      `${cap}import ${name} from "${spec}";\n${extra}export function h() { ${call(f)} }\n`
  const callFn = (f: string): string => `fx(${userField(f)})`
  const lib = `const sink = (v: any) => console.log(v);\n`
  return [
    multi(g, "export default function", "A", (f) => ({
      "app/f.ts": `export default function fx(v: any) { console.log(v) }\n`,
      "app/p.ts": use("fx", "./f.js", callFn)(f),
    })),
    multi(g, "export default anonymous function", "A", (f) => ({
      "app/f.ts": `export default function (v: any) { console.log(v) }\n`,
      "app/p.ts": use("fx", "./f.js", callFn)(f),
    })),
    multi(g, "export default arrow", "A", (f) => ({
      "app/f.ts": `export default (v: any) => console.log(v)\n`,
      "app/p.ts": use("fx", "./f.js", callFn)(f),
    })),
    multi(g, "export default class", "A", (f) => ({
      "app/f.ts": `export default class Svc { send(v: any) { console.log(v) } }\n`,
      "app/p.ts": use("Svc", "./f.js", (field) => `new Svc().send(${userField(field)})`)(f),
    })),
    multi(g, "export default of a name", "A", (f) => ({
      "app/f.ts": `${lib}function named(v: any) { sink(v) }\nexport default named\n`,
      "app/p.ts": use("fx", "./f.js", callFn)(f),
    })),
    multi(g, "export { x as default }", "A", (f) => ({
      "app/f.ts": `function named(v: any) { console.log(v) }\nexport { named as default }\n`,
      "app/p.ts": use("fx", "./f.js", callFn)(f),
    })),
    multi(g, "export default of an object", "A", (f) => ({
      "app/f.ts": `export default { send(v: any) { console.log(v) } }\n`,
      "app/p.ts": use("o", "./f.js", (field) => `o.send(${userField(field)})`)(f),
    })),
    multi(g, "export default of a package call", "B", (f) => ({
      "app/f.ts": `import { wrap } from "some-lib";\nexport default wrap((v: any) => console.log(v))\n`,
      "app/p.ts": use("fx", "./f.js", callFn)(f),
    })),
    multi(g, "default re-exported by name", "A", (f) => ({
      "app/f.ts": `export default function fx(v: any) { console.log(v) }\n`,
      "app/barrel.ts": `export { default } from "./f.js"\n`,
      "app/p.ts": use("fx", "./barrel.js", callFn)(f),
    })),
    multi(g, "default re-exported under another name", "A", (f) => ({
      "app/f.ts": `export default function fx(v: any) { console.log(v) }\n`,
      "app/barrel.ts": `export { default as send } from "./f.js"\n`,
      "app/p.ts": `${cap}import { send } from "./barrel.js";\nexport function h() { send(${userField(f)}) }\n`,
    })),
    multi(g, "default is not carried by export *", "B", (f) => ({
      "app/f.ts": `export default function fx(v: any) { console.log(v) }\n`,
      "app/barrel.ts": `export * from "./f.js"\n`,
      "app/p.ts": use("fx", "./barrel.js", callFn)(f),
    })),
    multi(g, "export * barrel", "A", (f) => ({
      "app/f.ts": `export function fx(v: any) { console.log(v) }\n`,
      "app/barrel.ts": `export * from "./f.js"\n`,
      "app/p.ts": `${cap}import { fx } from "./barrel.js";\nexport function h() { fx(${userField(f)}) }\n`,
    })),
    multi(g, "export * as namespace", "A", (f) => ({
      "app/f.ts": `export function fx(v: any) { console.log(v) }\n`,
      "app/barrel.ts": `export * as ns from "./f.js"\n`,
      "app/p.ts": `${cap}import { ns } from "./barrel.js";\nexport function h() { ns.fx(${userField(f)}) }\n`,
    })),
    multi(g, "export { a as b } from", "A", (f) => ({
      "app/f.ts": `export function fx(v: any) { console.log(v) }\n`,
      "app/barrel.ts": `export { fx as gx } from "./f.js"\n`,
      "app/p.ts": `${cap}import { gx } from "./barrel.js";\nexport function h() { gx(${userField(f)}) }\n`,
    })),
    multi(g, "chain of three barrels", "A", (f) => ({
      "app/f.ts": `export function fx(v: any) { console.log(v) }\n`,
      "app/b1.ts": `export * from "./f.js"\n`,
      "app/b2.ts": `export * from "./b1.js"\n`,
      "app/b3.ts": `export { fx } from "./b2.js"\n`,
      "app/p.ts": `${cap}import { fx } from "./b3.js";\nexport function h() { fx(${userField(f)}) }\n`,
    })),
    multi(g, "namespace import of a barrel", "A", (f) => ({
      "app/f.ts": `export function fx(v: any) { console.log(v) }\n`,
      "app/barrel.ts": `export * from "./f.js"\n`,
      "app/p.ts": `${cap}import * as lib from "./barrel.js";\nexport function h() { lib.fx(${userField(f)}) }\n`,
    })),
    multi(g, "class through a barrel", "A", (f) => ({
      "app/f.ts": `export class Svc { send(v: any) { console.log(v) } }\n`,
      "app/barrel.ts": `export * from "./f.js"\n`,
      "app/p.ts": `${cap}import { Svc } from "./barrel.js";\nexport function h() { new Svc().send(${userField(f)}) }\n`,
    })),
    multi(g, "cyclic export * barrels", "B", (f) => ({
      "app/a.ts": `export * from "./b.js"\n`,
      "app/b.ts": `export * from "./a.js"\n`,
      "app/p.ts": `${cap}import { missing } from "./a.js";\nexport function h() { missing(${userField(f)}) }\n`,
    })),
  ]
}

function dynamicImports(): Form[] {
  const g = "dynamic import"
  const lib = {
    "app/lib.ts": `export function fx(v: any) { console.log(v) }\nexport default function dx(v: any) { console.log(v) }\n`,
  }
  const run =
    (code: (f: string) => string, keyword = "async "): ((f: string) => Record<string, string>) =>
    (f) => ({ ...lib, ...fn(code(userField(f)), "", keyword) })
  return [
    form(
      g,
      "await import then member call",
      "A",
      run((u) => `const m = await import("./lib.js")\nm.fx(${u})`),
    ),
    form(
      g,
      "await import with destructuring",
      "A",
      run((u) => `const { fx } = await import("./lib.js")\nfx(${u})`),
    ),
    form(
      g,
      "await import default",
      "A",
      run((u) => `const { default: dx } = await import("./lib.js")\ndx(${u})`),
    ),
    form(
      g,
      "import then callback",
      "A",
      run((u) => `import("./lib.js").then((m) => m.fx(${u}))`, ""),
    ),
    form(
      g,
      "import then destructured callback",
      "A",
      run((u) => `import("./lib.js").then(({ fx }) => fx(${u}))`, ""),
    ),
    form(
      g,
      "import of a template literal specifier",
      "A",
      run((u) => "const m = await import(`./lib.js`)\n" + `m.fx(${u})`),
    ),
    form(g, "dynamic import of a package", "B", (f) =>
      fn(`const lib: any = await import("some-lib")\nlib.send(${userField(f)})`, "", "async "),
    ),
    form(g, "unrelated computed dynamic import", "A", (f) =>
      fn(`await import(key)\nres.json(${userField(f)})`, "", "async "),
    ),
  ]
}

function generators(): Form[] {
  const g = "generators and iteration"
  const sink = "console.log"
  return [
    mod(
      g,
      "generator consumed by for-of",
      "A",
      (_, u) =>
        `function* gen(v: any) { yield v }\nexport function h() { for (const x of gen(${u})) ${sink}(x) }`,
    ),
    mod(
      g,
      "async generator consumed by for-await",
      "A",
      (_, u) =>
        `async function* gen(v: any) { yield v }\nexport async function h() { for await (const x of gen(${u})) ${sink}(x) }`,
    ),
    mod(
      g,
      "yield* delegation",
      "A",
      (_, u) =>
        `function* inner(v: any) { yield v }\nfunction* outer(v: any) { yield* inner(v) }\nexport function h() { for (const x of outer(${u})) ${sink}(x) }`,
    ),
    mod(
      g,
      "yield* of an array",
      "A",
      (_, u) =>
        `function* gen(v: any) { yield* [v] }\nexport function h() { for (const x of gen(${u})) ${sink}(x) }`,
    ),
    mod(
      g,
      "yielded object",
      "A",
      (_, u) =>
        `function* gen(v: any) { yield { w: v } }\nexport function h() { for (const x of gen(${u})) ${sink}(x.w) }`,
    ),
    mod(
      g,
      "spread of a generator",
      "A",
      (_, u) =>
        `function* gen(v: any) { yield v }\nexport function h() { ${sink}([...gen(${u})]) }`,
    ),
    mod(
      g,
      "destructuring a generator",
      "A",
      (_, u) =>
        `function* gen(v: any) { yield v }\nexport function h() { const [a] = gen(${u}); ${sink}(a) }`,
    ),
    mod(
      g,
      "Array.from of a generator",
      "A",
      (_, u) =>
        `function* gen(v: any) { yield v }\nexport function h() { ${sink}(Array.from(gen(${u}))[0]) }`,
    ),
    mod(
      g,
      "generator next().value",
      "A",
      (_, u) =>
        `function* gen(v: any) { yield v }\nexport function h() { const it = gen(${u}); ${sink}(it.next().value) }`,
    ),
    mod(
      g,
      "value sent into a generator",
      "A",
      (_, u) =>
        `function* gen() { const x = yield 1; ${sink}(x) }\nexport function h() { const it: any = gen(); it.next(); it.next(${u}) }`,
    ),
    mod(
      g,
      "for-await over an array of promises",
      "A",
      (_, u) =>
        `export async function h() { for await (const x of [Promise.resolve(${u})]) ${sink}(x) }`,
    ),
    mod(
      g,
      "generator method of an object",
      "A",
      (_, u) =>
        `const o = { *items(v: any) { yield v } }\nexport function h() { for (const x of o.items(${u})) ${sink}(x) }`,
    ),
    mod(
      g,
      "Map built from tracked data",
      "A",
      (_, u) =>
        `export function h() { const m = new Map([["a", ${u}]]); for (const [, v] of m) ${sink}(v) }`,
    ),
  ]
}

function whole(): Form[] {
  const g = "whole record and capability values"
  const snapshot = "userData.getSnapshot()"
  return [
    body(g, "whole snapshot to a sink", "W", () => `res.json(${snapshot})`),
    body(g, "whole fields object to a sink", "W", () => `res.json(${snapshot}.fields)`),
    body(
      g,
      "Object.values of the fields object",
      "W",
      () => `res.json(Object.values(${snapshot}.fields))`,
    ),
    body(
      g,
      "fields object spread into a literal",
      "W",
      () => `res.json({ ...${snapshot}.fields })`,
    ),
    body(g, "snapshot through JSON.stringify", "W", () => `res.json(JSON.stringify(${snapshot}))`),
    body(
      g,
      "fields object held in a variable",
      "W",
      () => `const all = ${snapshot}.fields\nres.json(all)`,
    ),
    body(
      g,
      "computed destructuring key on the fields object",
      "W",
      () => `const { [key]: v } = ${snapshot}.fields\nres.json(v)`,
    ),
    body(g, "computed key on the fields object", "B", () => `res.json(${snapshot}.fields[key])`),
    body(
      g,
      "computed key on the fields object, logged",
      "B",
      () => `logger.info(${snapshot}.fields[key])`,
      () => `declare const logger: any\n`,
    ),
    body(
      g,
      "whole fields object to a package function",
      "B",
      () => `audit(${snapshot}.fields)`,
      () => `import { audit } from "some-lib";\n`,
    ),
    body(
      g,
      "the capability itself to a package function",
      "B",
      () => `audit(userData)`,
      () => `import { audit } from "some-lib";\n`,
    ),
    body(
      g,
      "capability method read without calling it",
      "A",
      (f) => `const { getSnapshot } = userData\nres.json(getSnapshot().fields.user.${f})`,
    ),
    body(
      g,
      "capability method kept in a variable",
      "A",
      (f) => `const read = userData.getSnapshot\nres.json(read().fields.user.${f})`,
    ),
    body(
      g,
      "capability method bound",
      "A",
      (f) => `const read = userData.getSnapshot.bind(userData)\nres.json(read().fields.user.${f})`,
    ),
    body(
      g,
      "capability method through call",
      "A",
      (f) => `res.json(userData.getSnapshot.call(userData).fields.user.${f})`,
    ),
    body(
      g,
      "capability passed to a project function",
      "A",
      () => `res.json(read(userData))`,
      (f) => `function read(c: any) { return c.getSnapshot().fields.user.${f} }\n`,
    ),
    mod(
      g,
      "capability reached through a namespace import",
      "A",
      (f) =>
        `import * as caps from "../features/user/user.js"\nexport function h() { console.log(caps.userData.getSnapshot().fields.user.${f}) }`,
    ),
  ]
}

/** Every form of the catalog. */
export function catalog(): readonly Form[] {
  return [
    ...basics(),
    ...control(),
    ...functions(),
    ...builtins(),
    ...opaque(),
    ...classes(),
    ...modules(),
    ...dynamicImports(),
    ...generators(),
    ...whole(),
    ...moreForms(),
    ...aliasingForms(),
  ]
}
