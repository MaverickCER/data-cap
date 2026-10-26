/**
 * The abstract values the flow pass (`flow-scan.ts`) passes between
 * expressions and functions: structured, field-sensitive, and immutable.
 *
 * A `Val` is a bag of `Atom`s plus known properties. An `Atom` says "the
 * data at `origin.path` (a capability field and a path inside it) is present
 * here". `atoms` hold data present at the value's own root (so reading `.email`
 * from them extends each path); `props` hold what a literal construction put
 * under a named key (so `{ id: user.id }` keeps `id` apart from everything
 * else). Spread, destructuring, element access and merging are all
 * expressible without losing which field a piece of data came from.
 *
 * Paths are always in the origin field's frame. An `approx` atom is
 * over-approximate (the data may have been transformed or only partly
 * present), and becomes an `inferred` edge (ADR 0071).
 *
 * Pure -- no filesystem access, no AST.
 */

/** How an atom entered the function frame it is currently in. */
export type AtomEntry =
  | { readonly kind: "read" }
  | { readonly kind: "param"; readonly fn: string; readonly index: number }
  | { readonly kind: "return"; readonly from: string }

/** One piece of capability-field data present in a value. */
export interface Atom {
  /** Id of the `field` node the data comes from. */
  readonly origin: string
  /** Path inside the origin field; `[]` is the whole field. */
  readonly path: readonly string[]
  /** True when the atom over-approximates (a transformation, rest/spread of unknown keys, dynamic access). */
  readonly approx: boolean
  /** How the atom entered the current function frame. */
  readonly entry: AtomEntry
  /** The path the atom had when it entered the frame -- what "discards" is measured against. */
  readonly entryPath: readonly string[]
}

/** An abstract value. */
export interface Val {
  /** Data present at this value's own root. */
  readonly atoms: readonly Atom[]
  /** Known named properties, from literal construction or capability structure. */
  readonly props: ReadonlyMap<string, Val>
  /** Set when the value is a project function (a key into the scan's function table). */
  readonly callable?: string
  /** Set when the value is a bound capability (its `file#exportName`). */
  readonly capability?: string
  /** Set when the value is a capability's `fields` object (its `file#exportName`): a field's atom is only created when that field is actually read. */
  readonly fieldsOf?: string
}

/** The value of an expression carrying no tracked data. */
export const EMPTY_VAL: Val = { atoms: [], props: new Map() }

/** The element key used for any array index or iteration step. */
export const ELEMENT_KEY = "[]"

/** A value holding exactly one atom at its root. */
export function atomVal(atom: Atom): Val {
  return { atoms: [atom], props: new Map() }
}

/** An object value: explicit properties plus spread values whose data stays at the root. */
export function objectVal(props: Readonly<Record<string, Val>>, spreads: readonly Val[]): Val {
  let result: Val = { atoms: [], props: new Map(Object.entries(props)) }
  for (const spread of spreads) result = mergeVals(result, spread)
  return result
}

function atomKey(atom: Atom): string {
  return JSON.stringify([atom.origin, atom.path, atom.approx, atom.entry, atom.entryPath])
}

function dedupe(atoms: readonly Atom[]): Atom[] {
  const seen = new Map<string, Atom>()
  for (const atom of atoms) seen.set(atomKey(atom), atom)
  return [...seen.values()]
}

/** Unions values: atoms are deduplicated, a property present on both sides is merged, markers are kept. */
export function mergeVals(...vals: readonly Val[]): Val {
  let atoms: Atom[] = []
  const props = new Map<string, Val>()
  let callable: string | undefined
  let conflicting = false
  let capability: string | undefined
  let fieldsOf: string | undefined
  for (const val of vals) {
    atoms = atoms.concat(val.atoms)
    for (const [key, child] of val.props) {
      const existing = props.get(key)
      props.set(key, existing === undefined ? child : mergeVals(existing, child))
    }
    // Two different callees cannot be followed as one: dropping the callable makes a call through it an explicit unknown rather than silently following only the first.
    if (callable !== undefined && val.callable !== undefined && callable !== val.callable)
      conflicting = true
    callable ??= val.callable
    capability ??= val.capability
    fieldsOf ??= val.fieldsOf
  }
  return {
    atoms: dedupe(atoms),
    props,
    ...(callable === undefined || conflicting ? {} : { callable }),
    ...(capability === undefined ? {} : { capability }),
    ...(fieldsOf === undefined ? {} : { fieldsOf }),
  }
}

/** Reads one named key: root atoms extend their path, an explicit property contributes its own value. */
export function accessKey(val: Val, key: string): Val {
  const extended: Val = {
    atoms: val.atoms.map((atom) => ({ ...atom, path: [...atom.path, key] })),
    props: new Map(),
  }
  const explicit = val.props.get(key)
  return explicit === undefined ? extended : mergeVals(explicit, extended)
}

/** Reads an unknown key: everything the value holds, approximately. */
export function accessDynamic(val: Val): Val {
  return approximate({ atoms: flattenAtoms(val), props: new Map() })
}

/** Every atom in the value, at any depth, deduplicated. */
export function flattenAtoms(val: Val): Atom[] {
  let atoms: Atom[] = [...val.atoms]
  for (const child of val.props.values()) atoms = atoms.concat(flattenAtoms(child))
  return dedupe(atoms)
}

function mapAtoms(val: Val, change: (atom: Atom) => Atom): Val {
  const props = new Map<string, Val>()
  for (const [key, child] of val.props) props.set(key, mapAtoms(child, change))
  return { ...val, atoms: val.atoms.map(change), props }
}

/** Marks every atom approximate. */
export function approximate(val: Val): Val {
  return mapAtoms(val, (atom) => (atom.approx ? atom : { ...atom, approx: true }))
}

/** Re-labels how every atom entered the frame, recording the path it had on entry. */
export function withEntry(val: Val, entry: AtomEntry): Val {
  return mapAtoms(val, (atom) => ({ ...atom, entry, entryPath: atom.path }))
}

const MAX_SIGNATURE_DEPTH = 6

function signatureAt(val: Val, depth: number): string {
  const rootAtoms = val.atoms
    .map((atom) => `${atom.origin}|${atom.path.join(".")}|${atom.approx ? "~" : "="}`)
    .sort()
    .join(",")
  if (depth >= MAX_SIGNATURE_DEPTH) {
    const everything = flattenAtoms(val)
      .map((atom) => `${atom.origin}|${atom.path.join(".")}|~`)
      .sort()
      .join(",")
    return everything === "" ? "" : `*{${everything}}`
  }
  const children = [...val.props.entries()]
    .map(([key, child]) => [key, signatureAt(child, depth + 1)] as const)
    .filter(([, signature]) => signature !== "")
    .map(([key, signature]) => `${key}:{${signature}}`)
    .sort()
    .join(",")
  if (rootAtoms === "" && children === "") return ""
  return `[${rootAtoms}]{${children}}`
}

/** A canonical string for memoizing a call by what its arguments carry. Ignores entry; empty for an empty value. */
export function signatureOf(val: Val): string {
  return signatureAt(val, 0)
}
