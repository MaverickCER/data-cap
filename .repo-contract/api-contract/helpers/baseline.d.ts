/**
 * `data-cap/helpers`: optional helpers for writing processors (`processors`), keying array items
 * (`identity`, `canonicalize`) and narrowing raw values (`shape`).
 *
 * @packageDocumentation
 */

/**
 * Deterministic canonicalization of arbitrary runtime values into a single
 * comparable string, or `undefined` when the value cannot be safely
 * canonicalized (never throws, never silently collides). Shared by array
 * identity key computation (`identity.ts`) and, in a later phase, the
 * runtime coordinator's execution-dedup key.
 *
 * Internal: not re-exported from the public `.` barrel.
 *
 * Encoding: every value becomes a self-delimiting "atom", `<tag><byteLen>:<payload>`.
 * Composite values (arrays and objects) concatenate their children's atoms
 * directly, with NO separator character between them and therefore nothing
 * to escape. Each atom carries its own payload length. So two distinct
 * logical values can never produce one canonical string through one value's
 * content "leaking" into where a delimiter would be expected. This sidesteps
 * the whole class of separator-escaping bugs a reserved-character scheme
 * would need to get right.
 */
/**
 * Canonicalizes `value` into a deterministic string, or returns `undefined`
 * when that is unsafe. Unsafe values are a function, a symbol, a cyclic
 * reference, an invalid `Date` and a class instance without `.toJSON()`.
 * So is an object with an own `__proto__`, `constructor` or `prototype` key. Never
 * throws. Equal inputs always produce equal output; distinct supported
 * values never collide (own-enumerable-key walk only: `Object.keys`,
 * never `for...in`).
 */
export declare function canonicalize(value: unknown): string | undefined;

/**
 * Computes the joined identity key for one array item. Each declared key's
 * value is canonicalized on its own, so `1` and `"1"`, or `NaN` and any
 * number, can never collide. The parts are concatenated through
 * `canonicalize`'s self-delimiting encoding, so no extra separator is needed. A missing key, a
 * `null` or `undefined` component, or one that cannot be canonicalized (a
 * function, a symbol) becomes the same fixed token. Nothing throws or silently
 * collides with unrelated data, and each case is recorded as a warning against
 * `path`.
 */
declare function computeItemIdentity<Item>(item: Item, keys: IdentityKeys<Item>, path: readonly string[], warnings: IdentityWarning[]): string;

/** Array-identity primitives: the same ones the standalone runtime uses to reconcile `info` for an identity-configured array field. */
export declare const identity: {
    /** Computes the joined identity key for one array item from its declared identity fields. */
    computeItemIdentity: typeof computeItemIdentity;
    /** Reconciles an identity-keyed `DataInfo` map against a new items array, preserving reference identity for untouched entries. */
    reconcileArrayInfo: typeof reconcileArrayInfo;
};

/**
 * Array identity: computes a stable per-item key from developer-declared
 * identity field names. It then reconciles an array's `DataInfo` map against
 * a new `fields` array using that key. Unaffected items keep their reference
 * identity (see specs/architecture.md's "DataInfo array reconciliation").
 *
 * Internal: not re-exported from the public `.` barrel. Consumed by the
 * (future) standalone runtime whenever it populates `info` for an
 * identity-configured array field.
 *
 * Identity is declared as an array of key names (`["id"]`, `["postId",
 * "commentId"]`). It is never a callback or a dot-notation path. It never
 * uses React's "key" terminology: this is a data concept, not a rendering
 * one. Identity metadata exists only for `DataInfo` and never alters
 * `fields` itself. Arrays without a declared identity get no per-item
 * `DataInfo` at all. There is no numeric-index fallback: that would bring
 * back the array-index-as-key fragility this system exists to avoid.
 */
/** Declared identity field names for one array item shape: e.g. `["id"]`, or `["postId", "commentId"]` for a composite key. */
export declare type IdentityKeys<Item> = readonly (keyof Item & string)[];

/** One array item that couldn't be reconciled by identity: surfaced, never silently dropped. */
export declare interface IdentityWarning {
    /** Path to the array field, then the item's index within it. */
    readonly path: readonly string[];
    /** Why this item couldn't be reconciled. */
    readonly reason: IdentityWarningReason;
}

/** Why one array item couldn't be assigned a stable identity key. */
export declare type IdentityWarningReason = "missing-key" | "malformed-item" | "duplicate-identity";

declare function isDate(value: unknown): value is Date;

declare function isNullish(value: unknown): value is null | undefined;

/**
 * Structural type guards for narrowing an unknown raw value inside a
 * getter/mutator/subscription `processor(raw, ctx)` function.
 *
 * Deliberately not a business-rule validator system (no `shape.email()`,
 * no `shape.range()`): data-cap has no per-field validator vocabulary
 * (unlike env-cap's `helpers.validators`); a processor's own logic is the
 * sole place business rules belong. These check only structural JS shape:
 * "is this a plain object" vs. "is this an array" vs. "is this a Date":
 * the same category of check `core/schema.ts` already performs internally,
 * exposed here for application code writing its own processors.
 *
 * ## Why there is no `helpers.validators` here (a design choice, not a gap)
 *
 * The absence of a validator-combinator library is structural, not an
 * unfinished feature. The two packages fail differently, so they need
 * different vocabularies:
 *
 * - `env-cap` validates on a **reject-and-throw** pipeline: a variable that
 *   fails its declared validator is an invalid environment, and
 *   `createEnv()` refuses to produce a contract at all. A validator there
 *   must therefore carry a human-readable *message* explaining what was
 *   rejected and why: which is exactly what a combinator library like
 *   `helpers.validators` exists to compose.
 * - `data-cap` has no reject path to write a message for. Fields are
 *   always synchronously readable (`AGENTS.md` invariant 2). So a
 *   processor/operation result that doesn't match a field's declared shape
 *   **resets that field to its declared default** via `core/schema.ts`'s
 *   `checkValueAgainstSchema`. The state stays valid and readable, and
 *   the mismatch surfaces through `DataInfo`, never as a thrown validator
 *   error. A `validators.email()` here would have nowhere to put its
 *   message and no failure mode to attach it to; it would only re-describe
 *   the structural check `checkValueAgainstSchema` already performs.
 *
 * A field's own runtime type is its shape descriptor, and a `processor` is
 * the single escape hatch for anything beyond that (`AGENTS.md`'s "Avoid"
 * list). Adding a validator vocabulary would introduce a second, parallel
 * notion of "valid" that nothing in the runtime could enforce.
 */
/**
 * True for a plain object literal (or `Object.create(null)`): false for
 * `null`, arrays, and any class instance (including `Date`/`URL`/`RegExp`),
 * matching the same "plain object" notion `core/canonicalize.ts` uses
 * internally.
 */
declare function isPlainObject(value: unknown): value is Record<string, unknown>;

declare function isRegExp(value: unknown): value is RegExp;

declare function isURL(value: unknown): value is URL;

/**
 * Parses a JSON string; non-string input returns `undefined`. Returns
 * `unknown` rather than an assertable `<T>`. Its result flows into a
 * processor's returned patch, which already runs through
 * `core/ownership.ts`'s own shape check on the way to a commit. So an
 * unchecked generic cast here would only hide that same unsafety behind a
 * type parameter instead of surfacing it at the call site.
 */
declare function parseJSON(value: unknown): unknown;

/** Convenience coercion helpers for a `processor(raw, ctx)` function (e.g. `processors.toNumber(raw.age)`). Never throw: unparseable input resolves to `undefined`. */
export declare const processors: {
    /** Parses a JSON string; non-string input returns `undefined`. */
    parseJSON: typeof parseJSON;
    /** Splits a delimited string into trimmed items; an array input passes through stringified. */
    toArray: typeof toArray;
    /** Coerces a string/number to a `bigint`. */
    toBigInt: typeof toBigInt;
    /** Coerces common boolean-like strings (`true`/`1`/`yes`/`on`, and their opposites) to a real boolean. */
    toBoolean: typeof toBoolean;
    /** Parses a value into a `Date`. */
    toDate: typeof toDate;
    /** Coerces a value to a number and requires it to be an integer. */
    toInteger: typeof toInteger;
    /** Lowercases a coercible value. */
    toLowerCase: typeof toLowerCase;
    /** Coerces a value to a number, rejecting empty/whitespace-only strings. */
    toNumber: typeof toNumber;
    /** Compiles a string into a `RegExp`. */
    toRegExp: typeof toRegExp;
    /** Coerces a value to a string. */
    toString: typeof toString_2;
    /** Parses a value into a `URL`. */
    toURL: typeof toURL;
    /** Uppercases a coercible value. */
    toUpperCase: typeof toUpperCase;
    /** Trims surrounding whitespace from a coercible value. */
    trim: typeof trim;
};

/**
 * Recomputes an array field's identity-keyed `DataInfo` map by diffing
 * against the previous map. An identity the current operation did not touch
 * (per `touchedIdentities`), but that still exists in `nextItems`, keeps its
 * previous `TInfo` object reference exactly. This is the release-blocking
 * performance invariant `next.info.comments["1"] === previous.info.comments["1"]`
 * relies on. Identities no longer present in `nextItems` are dropped, so no
 * orphans remain. The key SET is always fully recomputed, never
 * incrementally, even though individual entries keep their references.
 *
 * A duplicate identity across two items is not an error. Both items stay in
 * `fields` untouched, but they share one `DataInfo` slot. The last item the
 * walk meets sets that slot's info, and a warning records it.
 */
declare function reconcileArrayInfo<Item, TInfo>(prevInfo: Partial<Record<string, TInfo>> | undefined, nextItems: readonly Item[], identityKeys: IdentityKeys<Item>, touchedIdentities: ReadonlySet<string> | "all", makeInfoFor: (item: Item, identityKey: string) => TInfo): ReconcileArrayInfoResult<TInfo>;

/** The result of reconciling an array field's identity-keyed `DataInfo` map against a new `fields` array. */
export declare interface ReconcileArrayInfoResult<TInfo> {
    /** The reconciled identity-keyed info map, preserving reference identity for unaffected items. */
    readonly info: Partial<Record<string, TInfo>>;
    /** Items that couldn't be reconciled by identity, never silently dropped. */
    readonly warnings: readonly IdentityWarning[];
}

/** Structural (never business-rule) type guards for narrowing a raw value inside a processor. */
export declare const shape: {
    /** True for a `Date` instance. */
    isDate: typeof isDate;
    /** True for `null`/`undefined`. */
    isNullish: typeof isNullish;
    /** True for a plain object literal (or `Object.create(null)`): false for arrays, `null`, and class instances. */
    isPlainObject: typeof isPlainObject;
    /** True for a `RegExp` instance. */
    isRegExp: typeof isRegExp;
    /** True for a `URL` instance. */
    isURL: typeof isURL;
};

/** Splits a delimited string into trimmed items; an array input passes through stringified. */
declare function toArray(value: unknown, separator?: string | RegExp): string[] | undefined;

declare function toBigInt(value: unknown): bigint | undefined;

declare function toBoolean(value: unknown): boolean | undefined;

declare function toDate(value: unknown): Date | undefined;

declare function toInteger(value: unknown): number | undefined;

declare function toLowerCase(value: unknown): string | undefined;

declare function toNumber(value: unknown): number | undefined;

declare function toRegExp(value: unknown): RegExp | undefined;

/**
 * Optional convenience coercion helpers for writing a getter/mutator/
 * subscription `processor(raw, ctx)` function. Entirely separate from core:
 * neither `buildData` nor the runtime's `createData` import this module;
 * an application processor calls into it, never the other way around.
 *
 * Unlike env-cap's `helpers.processors` (a per-field pipeline slot that
 * throws a descriptive error on failure), a data-cap processor's returned
 * patch already runs through `core/ownership.ts`'s own shape check and
 * per-field reset-to-default on the way to a commit. So these never
 * throw and never format an error message. On unparseable input, each
 * returns `undefined`, leaving the ownership/shape pipeline's own
 * fallback to decide what happens next.
 */
declare function toString_2(value: unknown): string | undefined;

declare function toUpperCase(value: unknown): string | undefined;

declare function toURL(value: unknown): URL | undefined;

declare function trim(value: unknown): string | undefined;

export { }
