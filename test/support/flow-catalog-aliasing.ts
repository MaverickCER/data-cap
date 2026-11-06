import { body } from "./flow-catalog-builders.js"
import type { Form } from "./flow-catalog-builders.js"

/**
 * Heap aliasing (ADR 0074 section 5): a store through one name into an object another name holds, where the sharing is
 * made by a literal that holds a reference, an array element, a function's return value, a prototype shared by
 * instances, a collection's value or a loop element. Every row stores the leaked field into a shared container through
 * one name and sends the container through another. Same contract as `flow-catalog-forms.ts`.
 */
const g = "heap aliasing"

export function aliasingForms(): Form[] {
  return [
    body(
      g,
      "property shared through an object literal",
      "A",
      (_, u) =>
        `const a: any = { list: [] }\nconst b = { list: a.list }\nb.list.push(${u})\nres.json(a.list)`,
    ),
    body(
      g,
      "nested object shared through an object literal",
      "A",
      (_, u) =>
        `const a: any = { inner: {} }\nconst b = { inner: a.inner }\nb.inner.x = ${u}\nres.json(a.inner.x)`,
    ),
    body(
      g,
      "container returned by a function",
      "B",
      (_, u) => `const a: any = { list: [] }\nget(a).push(${u})\nres.json(a.list)`,
      () => `function get(o: any) { return o.list }\n`,
    ),
    body(
      g,
      "container returned by a function and bound",
      "A",
      (_, u) => `const a: any = { list: [] }\nconst l = get(a)\nl.push(${u})\nres.json(a.list)`,
      () => `function get(o: any) { return o.list }\n`,
    ),
    body(
      g,
      "array element",
      "A",
      (_, u) => `const a: any[] = []\nconst arr = [a]\narr[0].push(${u})\nres.json(a)`,
    ),
    body(
      g,
      "array element stored by property",
      "A",
      (_, u) => `const a: any = {}\nconst arr = [a]\narr[0].x = ${u}\nres.json(a.x)`,
    ),
    body(
      g,
      "Object.values element",
      "B",
      (_, u) => `const o: any = { k: { x: 0 } }\nObject.values(o)[0].x = ${u}\nres.json(o.k.x)`,
    ),
    body(
      g,
      "array destructuring element",
      "B",
      (_, u) =>
        `const arrays: any[][] = [[]]\nconst [first] = arrays\nfirst.push(${u})\nres.json(arrays[0])`,
    ),
    body(
      g,
      "Array.from then forEach",
      "A",
      (_, u) =>
        `const list: any[] = [{ items: [] }]\nArray.from(list).forEach((x) => x.items.push(${u}))\nres.json(list[0].items)`,
    ),
    body(
      g,
      "for-of element",
      "B",
      (_, u) =>
        `const objs: any[] = [{ list: [] }]\nfor (const o of objs) o.list.push(${u})\nres.json(objs[0].list)`,
    ),
    body(
      g,
      "Map value mutated after retrieval",
      "B",
      (_, u) =>
        `const m = new Map<string, any[]>([["k", []]])\nm.get("k")!.push(${u})\nres.json(m.get("k"))`,
    ),
    body(
      g,
      "Set item mutated in a loop",
      "B",
      (_, u) =>
        `const s = new Set<any>([{ items: [] }])\nfor (const o of s) o.items.push(${u})\nres.json([...s][0].items)`,
    ),
    body(
      g,
      "prototype property shared by instances",
      "A",
      (_, u) =>
        `const a: any = new Foo()\nconst b: any = new Foo()\na.items.push(${u})\nres.json(b.items)`,
      () => `function Foo(this: any) {}\nFoo.prototype.items = [] as any[]\n`,
    ),
    body(
      g,
      "container returned by a method",
      "B",
      (_, u) => `const bx = new Box()\nbx.get().push(${u})\nres.json(bx.items)`,
      () => `class Box { items: any[] = []\n  get() { return this.items } }\n`,
    ),
    body(
      g,
      "shallow copy by spread shares nested containers",
      "A",
      (_, u) =>
        `const a: any = { list: [] }\nconst b = { ...a }\nb.list.push(${u})\nres.json(a.list)`,
    ),
    body(
      g,
      "shallow copy by Object.assign shares nested containers",
      "A",
      (_, u) =>
        `const base: any = { list: [] }\nconst o2: any = Object.assign({}, base)\no2.list.push(${u})\nres.json(base.list)`,
    ),
    body(
      g,
      "shallow copy by slice shares elements",
      "A",
      (_, u) =>
        `const a: any[] = [{ items: [] }]\nconst c = a.slice()\nc[0].items.push(${u})\nres.json(a[0].items)`,
    ),
    body(
      g,
      "either of two objects chosen by a ternary",
      "A",
      (_, u) =>
        `const a: any = { list: [] }\nconst b: any = { list: [] }\nconst t = key ? a : b\nt.list.push(${u})\nres.json(a.list)`,
    ),
    body(
      g,
      "container captured by a closure",
      "A",
      (_, u) =>
        `const box: any = { items: [] }\nconst add = () => box.items.push(${u})\nconst alias = { items: box.items }\nadd()\nres.json(alias.items)`,
    ),
    body(
      g,
      "container handed to a function that fills it",
      "A",
      () =>
        `const a: any = { list: [] }\nconst b = { list: a.list }\nfill(b.list)\nres.json(a.list)`,
      (_, u) => `function fill(l: any[]) { l.push(${u}) }\n`,
    ),
  ]
}
