/**
 * The shared contents of the objects the flow pass (`flow-scan.ts`) sees made.
 *
 * A `Val` is a value, not a reference: copying it (`const b = a`, `{ list: a.list }`, an array element, a function's
 * result) copies what it holds at that moment. A store through one name would then be invisible through another name
 * for the same object. To stay sound without becoming a points-to analysis, every object a literal, a `new` or a
 * collection makes carries the id of its allocation site (`Val.alloc`), and a store into a container writes the stored
 * value into that site's shared cell. Reading a value that carries a site id adds the cell, so an alias made by any
 * route sees the store.
 *
 * Program order is respected where it is known. A cell keeps what each evaluation (a function run with some
 * arguments, named by its `callKey`) stored in the current round of the analysis apart from what earlier rounds
 * stored. An evaluation that is still running will store again, in order, so it does not read its own earlier rounds'
 * stores back; every other evaluation sees all of them. That is what lets a reader analyzed before a writer see the
 * write after another round, without a store showing up before the line that made it.
 *
 * Pure -- no filesystem access, no AST.
 */
import { EMPTY_VAL, mergeVals, signatureOf, withoutAlloc } from "./flow-values.js"
import type { Val } from "./flow-values.js"

/** What one evaluation stored into one object: this round's stores, and those of the rounds before. */
interface Stored {
  readonly now: Val
  readonly before: Val
}

/** The shared contents of allocation sites. */
export class HeapCells {
  private readonly cells = new Map<string, Map<string, Stored>>()
  /** The evaluation (a function's `callKey`) that made each site's object. */
  private readonly makers = new Map<string, string>()
  private readonly ids = new Map<string, string>()
  /** The evaluations running now, with how many times each is on the stack (a function may call itself). */
  private readonly active = new Map<string, number>()
  /** Replaced whenever what a read sees may differ, so a memoized expansion knows it is out of date. */
  private version = Symbol()
  private readonly expanded = new WeakMap<Val, { readonly version: symbol; readonly val: Val }>()

  /** The id of the allocation site at `position` of an evaluation: the same site in the same evaluation always has the same id. */
  allocId(maker: string, position: string): string {
    const key = `${maker}\u0000${position}`
    const known = this.ids.get(key)
    if (known !== undefined) return known
    const id = `a${this.ids.size}`
    this.ids.set(key, id)
    this.makers.set(id, maker)
    return id
  }

  /** The evaluation `callKey` starts running. */
  enter(callKey: string): void {
    this.active.set(callKey, (this.active.get(callKey) ?? 0) + 1)
    this.version = Symbol()
  }

  /** The evaluation `callKey` is done. */
  leave(callKey: string): void {
    const count = this.active.get(callKey) ?? 0
    if (count <= 1) this.active.delete(callKey)
    else this.active.set(callKey, count - 1)
    this.version = Symbol()
  }

  /** Another round of the analysis starts: what was stored so far is what earlier rounds stored. */
  nextRound(): void {
    for (const writers of this.cells.values())
      for (const [writer, stored] of writers)
        writers.set(writer, { now: EMPTY_VAL, before: mergeVals(stored.before, stored.now) })
    this.version = Symbol()
  }

  /** The value with the shared contents of every object it may be, at any depth, added. */
  expand(val: Val): Val {
    if (this.cells.size === 0) return val
    return this.expandWith(val, new Set())
  }

  private expandWith(val: Val, open: ReadonlySet<string>): Val {
    const memo = this.expanded.get(val)
    if (memo?.version === this.version && open.size === 0) return memo.val
    const props = new Map<string, Val>()
    for (const [key, child] of val.props) props.set(key, this.expandWith(child, open))
    let result: Val = val.props.size === 0 ? val : { ...val, props }
    const now = new Set(open)
    // Stryker disable next-line ArrayDeclaration: equivalent -- a placeholder names no cell, so nothing is added for it.
    for (const id of val.alloc ?? []) {
      const parts = this.partsOf(id)
      if (parts.length === 0 || now.has(id)) continue
      now.add(id)
      result = mergeVals(result, ...parts.map((part) => this.expandWith(part, now)))
    }
    if (open.size === 0) this.expanded.set(val, { version: this.version, val: result })
    return result
  }

  /** What the evaluations that stored into the object made at `id` left there, as the running evaluation may see it. */
  private partsOf(id: string): Val[] {
    const parts: Val[] = []
    for (const [writer, stored] of this.cells.get(id) ?? []) {
      parts.push(stored.now)
      if (!this.active.has(writer)) parts.push(stored.before)
    }
    return parts.filter((part) => part !== EMPTY_VAL)
  }

  /**
   * Stores `content` into the shared cell of every site in `ids`, as the evaluation `writer`. True when the object may
   * have been read, before this store, by an evaluation that has finished: the analysis has to run again for that
   * reader to see it.
   */
  store(ids: readonly string[], content: Val, writer: string): boolean {
    const stored = withoutAlloc(content)
    let late = false
    for (const id of ids) {
      const writers = this.cells.get(id) ?? new Map<string, Stored>()
      const entry = writers.get(writer) ?? { now: EMPTY_VAL, before: EMPTY_VAL }
      const now = mergeVals(entry.now, stored)
      if (signatureOf(now) === signatureOf(entry.now)) continue
      writers.set(writer, { now, before: entry.before })
      this.cells.set(id, writers)
      this.version = Symbol()
      const novel =
        signatureOf(mergeVals(entry.before, now)) !==
        signatureOf(mergeVals(entry.before, entry.now))
      if (novel && !this.active.has(this.makers.get(id) ?? "")) late = true
    }
    return late
  }
}
