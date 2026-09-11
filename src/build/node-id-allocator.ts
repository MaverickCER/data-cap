/**
 * Stable `n0`, `n1`, ... id allocation, keyed by an arbitrary string, for the
 * DOT/Mermaid graph renderers (`graph-export.ts`, `flow-diagram.ts`). The same
 * key always maps to the same id within one allocator; a fresh allocator starts
 * over. Internal -- not re-exported from `./index.js`.
 */
export class NodeIdAllocator {
  private readonly ids = new Map<string, string>()
  private counter = 0

  idFor(key: string): string {
    const existing = this.ids.get(key)
    if (existing !== undefined) return existing
    const id = `n${this.counter}`
    this.counter += 1
    this.ids.set(key, id)
    return id
  }
}
