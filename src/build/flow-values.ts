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
  /** True when the data went through a package call the user declared a summary for: a modelled fact, never a proven one (ADR 0071). */
  readonly declared?: true
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
  /** Set when the value is an instance of a project class (a key into the scan's class table). */
  readonly instance?: string
  /** Set when the value is a project class itself -- its constructor and statics (a key into the scan's class table). */
  readonly classRef?: string
  /** On a value whose data is only read when asked for (a capability, its `fields`): a transformation touched it, so what is read from it is approximate. */
  readonly inexact?: true
  /** With `capability`: the value is that capability's method, read but not called yet (`const { getSnapshot } = data`). */
  readonly boundMethod?: string
  /** Set when the value is a project module's namespace (the absolute path of the module's file). */
  readonly namespace?: string
  /** Set when the value is a builtin collection the scan models: a `Map` / `WeakMap`, a `Set` / `WeakSet`, or an object whose keys the code chooses at run time. */
  readonly native?: NativeKind
  /** Set when the value is something a package exports: `module\u0000export`, where export `*` is the module itself. Only a declared summary can say what a call to it does. */
  readonly external?: string
  /**
   * The allocation sites (sorted, no duplicates) the value's object may have been made at: two values with an id in
   * common may be the same object, so what is stored through one is visible through the other (`flow-heap.ts`).
   */
  readonly alloc?: readonly string[]
}

/** The builtin collections the scan models (`mapVal`, `setVal`, `recordVal`). */
export type NativeKind = "map" | "set" | "record"

/** The value of an expression carrying no tracked data. */
export const EMPTY_VAL: Val = { atoms: [], props: new Map() }

// Stryker disable StringLiteral: static -- Stryker reports each of these module-load values as surviving, yet applying any one of them by hand fails `the keys the analysis keeps for itself`, which pins every one exactly (verified).
/** The allocation site of an object the analysis did not see made: a package export, the result of a call it could not follow. A store into it is a store it cannot trace. */
export const OPAQUE_ALLOC = "?"

/** The element key used for any array index or iteration step. */
export const ELEMENT_KEY = "[]"

/** The property a map keeps its keys under (its values are under `MAP_VALUES`, and each key/value pair is an element). */
export const MAP_KEYS = "\u0000keys"
export const MAP_VALUES = "\u0000values"
/** What any key of a `record` holds: a record is an object whose keys are chosen when the program runs. */
export const ANY_KEY = "\u0000any"
/** Handles to the state a promise, a `resolve` function or a generator shares with the code that settles it: no data, but they tell two values apart. */
export const PROMISE_HANDLE = "\u0000promise:"
export const RESOLVE_HANDLE = "\u0000resolve:"
export const REJECT_HANDLE = "\u0000reject:"
export const GENERATOR_HANDLE = "\u0000generator:"
// Stryker restore StringLiteral

/** Whether a property key is one of the handles above: kept in a signature even when it holds nothing. */
export function isHandleKey(key: string): boolean {
  return [PROMISE_HANDLE, RESOLVE_HANDLE, REJECT_HANDLE, GENERATOR_HANDLE].some((prefix) =>
    key.startsWith(prefix),
  )
}

/** The handles of one kind a value carries (`promiseHandles(val, PROMISE_HANDLE)`), without the prefix. */
export function handlesOf(val: Val, prefix: string): string[] {
  return [...val.props.keys()]
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length))
}

/** The value without any handle it carries: what is left once a promise has been settled. */
export function dropHandles(val: Val): Val {
  const props = new Map([...val.props].filter(([key]) => !isHandleKey(key)))
  return { ...val, props }
}

/** A value carrying one handle. */
export function handleVal(prefix: string, id: string): Val {
  return { atoms: [], props: new Map([[`${prefix}${id}`, EMPTY_VAL]]) }
}

/** A `Map`: every key/value pair is an element, and the keys and values are kept apart for `get`, `keys` and `values`. */
export function mapVal(keys: Val, values: Val): Val {
  const pair: Val = { atoms: [], props: new Map([[ELEMENT_KEY, mergeVals(keys, values)]]) }
  return {
    atoms: [],
    props: new Map([
      [ELEMENT_KEY, pair],
      [MAP_KEYS, keys],
      [MAP_VALUES, values],
    ]),
    native: "map",
  }
}

/** A `Set`: its items are its elements. */
export function setVal(items: Val): Val {
  return { atoms: [], props: new Map([[ELEMENT_KEY, items]]), native: "set" }
}

/** An object whose keys are chosen when the program runs: every key reads `entry`. */
export function recordVal(entry: Val): Val {
  return { atoms: [], props: new Map([[ANY_KEY, entry]]), native: "record" }
}

/** The same value without the mark that it is something a package exports: a mark that is only meaningful where a value is called, and must not outlive the call. */
export function withoutExternal(val: Val): Val {
  const copy: { -readonly [K in keyof Val]: Val[K] } = { ...val }
  delete copy.external
  return copy
}

/** The same value, as data reached through a package call the user declared a summary for. */
export function declaredVal(val: Val): Val {
  return mapAtoms(val, (atom) => ({ ...atom, declared: true as const }))
}

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
  return JSON.stringify([
    atom.origin,
    atom.path,
    atom.approx,
    atom.entry,
    atom.entryPath,
    atom.declared,
  ])
}

function dedupe(atoms: readonly Atom[]): Atom[] {
  const seen = new Map<string, Atom>()
  for (const atom of atoms) seen.set(atomKey(atom), atom)
  return [...seen.values()]
}

/** The first marker any value carries, and whether two values carry different ones. */
function markerOf<T extends string>(
  vals: readonly Val[],
  pick: (val: Val) => T | undefined,
): { readonly value: T | undefined; readonly conflict: boolean } {
  const present = vals.map(pick).filter((marker): marker is T => marker !== undefined)
  const [value] = present
  return { value, conflict: present.some((marker) => marker !== value) }
}

/** Unions the named properties: one present on several sides is merged. */
function mergeProps(vals: readonly Val[]): Map<string, Val> {
  const props = new Map<string, Val>()
  for (const val of vals) {
    for (const [key, child] of val.props) {
      const existing = props.get(key)
      props.set(key, existing === undefined ? child : mergeVals(existing, child))
    }
  }
  return props
}

type Markers = { -readonly [K in keyof Val]?: Val[K] }

/** The markers two values agree on well enough to keep: the first one's, unless a different callee, collection or export is also present. */
function mergeSimpleMarkers(vals: readonly Val[]): Markers {
  const result: Markers = {}
  // Two different callees cannot be followed as one: dropping the callable makes a call through it an explicit unknown rather than silently following only the first.
  const callable = markerOf(vals, (val) => val.callable)
  if (callable.value !== undefined && !callable.conflict) result.callable = callable.value
  const capability = markerOf(vals, (val) => val.capability).value
  if (capability !== undefined) result.capability = capability
  const fieldsOf = markerOf(vals, (val) => val.fieldsOf).value
  if (fieldsOf !== undefined) result.fieldsOf = fieldsOf
  // Two different builtin collections, or two different package exports, cannot be told as one either.
  const native = markerOf(vals, (val) => val.native)
  if (native.value !== undefined && !native.conflict) result.native = native.value
  const external = markerOf(vals, (val) => val.external)
  if (external.value !== undefined && !external.conflict) result.external = external.value
  if (vals.some((val) => val.inexact === true)) result.inexact = true
  const alloc = mergeAllocs(vals)
  if (alloc !== undefined) result.alloc = alloc
  return result
}

/** The allocation sites any of the values may have been made at, sorted; `undefined` when none has one. */
function mergeAllocs(vals: readonly Val[]): readonly string[] | undefined {
  const ids = new Set(vals.flatMap((val) => val.alloc ?? []))
  return ids.size === 0 ? undefined : [...ids].sort()
}

/** A value that is known to be an object of its own: it has at least the allocation site that made it. */
export type Allocated = Val & { readonly alloc: readonly string[] }

/** The same value, made at the allocation site `id` as well: a fresh object has one site. */
export function withAlloc(val: Val, id: string): Allocated {
  return { ...val, alloc: [...new Set([...(val.alloc ?? []), id])].sort() }
}

/** The same value without the identity of its own object: a copy made from it (a spread) is a new object. */
export function withoutAlloc(val: Val): Val {
  const copy: { -readonly [K in keyof Val]: Val[K] } = { ...val }
  delete copy.alloc
  return copy
}

/** The same value with every allocation site, at any depth, replaced by `rename(site)`: a deep copy has sites of its own. */
export function remapAllocs(val: Val, rename: (id: string) => string): Val {
  const props = new Map<string, Val>()
  for (const [key, child] of val.props) props.set(key, remapAllocs(child, rename))
  if (val.alloc === undefined) return { ...val, props }
  return { ...val, props, alloc: [...new Set(val.alloc.map(rename))].sort() }
}

/** Every allocation site in the value, at any depth, sorted. */
export function allocsOf(val: Val): string[] {
  const ids = new Set<string>(val.alloc ?? [])
  for (const child of val.props.values()) for (const id of allocsOf(child)) ids.add(id)
  return [...ids].sort()
}

/** The same for an instance, a class, a module and a bound method: two different ones cannot be followed as one, and then none of the four is kept. */
function mergeIdentityMarkers(vals: readonly Val[]): Markers {
  const instance = markerOf(vals, (val) => val.instance)
  const classRef = markerOf(vals, (val) => val.classRef)
  const namespace = markerOf(vals, (val) => val.namespace)
  const boundMethod = markerOf(vals, (val) => val.boundMethod)
  if (instance.conflict || classRef.conflict || namespace.conflict || boundMethod.conflict)
    return {}
  const result: Markers = {}
  if (instance.value !== undefined) result.instance = instance.value
  if (classRef.value !== undefined) result.classRef = classRef.value
  if (namespace.value !== undefined) result.namespace = namespace.value
  if (boundMethod.value !== undefined) result.boundMethod = boundMethod.value
  return result
}

/** Unions values: atoms are deduplicated, a property present on both sides is merged, markers are kept. */
export function mergeVals(...vals: readonly Val[]): Val {
  return {
    atoms: dedupe(vals.flatMap((val) => val.atoms)),
    props: mergeProps(vals),
    ...mergeSimpleMarkers(vals),
    ...mergeIdentityMarkers(vals),
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

/** Reads an unknown key: everything the value holds, approximately. The handles to promises and generators it holds go with it. */
export function accessDynamic(val: Val): Val {
  const nested = [...val.props.values()].flatMap((child) => allocsOf(child))
  return approximate({
    atoms: flattenAtoms(val),
    props: deepHandles(val),
    ...(nested.length === 0 ? {} : { alloc: [...new Set(nested)].sort() }),
  })
}

/** Every handle in the value, at any depth, as properties of an otherwise empty value. */
function deepHandles(val: Val): Map<string, Val> {
  const handles = new Map<string, Val>()
  for (const [key, child] of val.props) {
    if (isHandleKey(key)) handles.set(key, EMPTY_VAL)
    for (const [inner, innerVal] of deepHandles(child)) handles.set(inner, innerVal)
  }
  return handles
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

/** Marks every atom approximate -- and, on a value that has not produced its atoms yet, the atoms it will produce. */
export function approximate(val: Val): Val {
  const props = new Map<string, Val>()
  for (const [key, child] of val.props) props.set(key, approximate(child))
  const lazy = val.fieldsOf !== undefined || val.capability !== undefined
  return {
    ...val,
    atoms: val.atoms.map((atom) => (atom.approx ? atom : { ...atom, approx: true })),
    props,
    ...(lazy ? { inexact: true as const } : {}),
  }
}

/** Re-labels how every atom entered the frame, recording the path it had on entry. */
export function withEntry(val: Val, entry: AtomEntry): Val {
  return mapAtoms(val, (atom) => ({ ...atom, entry, entryPath: atom.path }))
}

const MAX_SIGNATURE_DEPTH = 6

function signatureAt(val: Val, depth: number): string {
  const rootAtoms = val.atoms
    .map(
      (atom) =>
        `${atom.origin}|${atom.path.join(".")}|${atom.approx ? "~" : "="}${atom.declared === true ? "d" : ""}`,
    )
    .sort()
    .join(",")
  if (depth >= MAX_SIGNATURE_DEPTH) {
    const everything = flattenAtoms(val)
      .map((atom) => `${atom.origin}|${atom.path.join(".")}|~${atom.declared === true ? "d" : ""}`)
      .sort()
      .join(",")
    return everything === "" ? "" : `*{${everything}}`
  }
  const children = [...val.props.entries()]
    .map(([key, child]) => [key, signatureAt(child, depth + 1)] as const)
    .filter(([key, signature]) => signature !== "" || isHandleKey(key))
    .map(([key, signature]) => `${key}:{${signature}}`)
    .sort()
    .join(",")
  const markerList = [
    val.callable,
    val.instance,
    val.classRef,
    val.namespace,
    val.capability,
    val.fieldsOf,
    val.boundMethod,
    val.inexact === true ? "~" : undefined,
    val.native,
    val.external,
  ]
  const markers = markerList.map((marker) => marker ?? "").join("|")
  const bare = markerList.every((marker) => marker === undefined)
  // Two values made at different sites are different objects, whatever they hold.
  const sites = val.alloc === undefined ? "" : `@${val.alloc.join("+")}`
  if (rootAtoms === "" && children === "" && bare && sites === "") return ""
  return `[${rootAtoms}]{${children}}${bare ? "" : `<${markers}>`}${sites}`
}

/** A canonical string for memoizing a call by what its arguments carry. Ignores entry; empty for an empty value. */
export function signatureOf(val: Val): string {
  return signatureAt(val, 0)
}
