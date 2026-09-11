# helpers

## Interfaces

### IdentityWarning

One array item that couldn't be reconciled by identity -- surfaced, never silently dropped.

#### Properties

##### path

```ts
readonly path: readonly string[];
```

Path to the array field, then the item's index within it.

##### reason

```ts
readonly reason: IdentityWarningReason;
```

Why this item couldn't be reconciled.

***

### ReconcileArrayInfoResult

The result of reconciling an array field's identity-keyed `DataInfo` map against a new `fields` array.

#### Type Parameters

| Type Parameter |
| ------ |
| `TInfo` |

#### Properties

##### info

```ts
readonly info: Partial<Record<string, TInfo>>;
```

The reconciled identity-keyed info map, preserving reference identity for unaffected items.

##### warnings

```ts
readonly warnings: readonly IdentityWarning[];
```

Items that couldn't be reconciled by identity, never silently dropped.

## Type Aliases

### IdentityKeys

```ts
type IdentityKeys<Item> = readonly keyof Item & string[];
```

Declared identity field names for one array item shape -- e.g. `["id"]`, or `["postId", "commentId"]` for a composite key.

#### Type Parameters

| Type Parameter |
| ------ |
| `Item` |

***

### IdentityWarningReason

```ts
type IdentityWarningReason = "missing-key" | "malformed-item" | "duplicate-identity";
```

Why one array item couldn't be assigned a stable identity key.

## Variables

### identity

```ts
const identity: {
  computeItemIdentity: <Item>(item, keys, path, warnings) => string;
  reconcileArrayInfo: <Item, TInfo>(prevInfo, nextItems, identityKeys, touchedIdentities, makeInfoFor) => ReconcileArrayInfoResult<TInfo>;
};
```

Array-identity primitives -- the same ones the standalone runtime uses to reconcile `info` for an identity-configured array field.

#### Type Declaration

##### computeItemIdentity

```ts
computeItemIdentity: <Item>(item, keys, path, warnings) => string;
```

Computes the joined identity key for one array item from its declared identity fields.

Computes the joined identity key for one array item. Each declared key's
value is independently canonicalized (so `1` and `"1"`, or `NaN` and any
number, can never collide) and concatenated via `canonicalize`'s own
self-delimiting encoding -- no additional separator is needed. A missing
key, a `null`/`undefined` component, or a non-canonicalizable component
(a function, a symbol, ...) all degrade to the same fixed token rather
than throwing or silently colliding with unrelated data; each is recorded
as a warning against `path`.

###### Type Parameters

| Type Parameter |
| ------ |
| `Item` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `item` | `Item` |
| `keys` | [`IdentityKeys`](#identitykeys)\<`Item`\> |
| `path` | readonly `string`[] |
| `warnings` | [`IdentityWarning`](#identitywarning)[] |

###### Returns

`string`

##### reconcileArrayInfo

```ts
reconcileArrayInfo: <Item, TInfo>(prevInfo, nextItems, identityKeys, touchedIdentities, makeInfoFor) => ReconcileArrayInfoResult<TInfo>;
```

Reconciles an identity-keyed `DataInfo` map against a new items array, preserving reference identity for untouched entries.

Recomputes an array field's identity-keyed `DataInfo` map by diffing
against the previous map: an identity the current operation did not touch
(per `touchedIdentities`), but that still exists in `nextItems`, keeps its
previous `TInfo` object reference exactly -- this is the release-blocking
performance invariant `next.info.comments["1"] === previous.info.comments["1"]`
relies on. Identities no longer present in `nextItems` are dropped (no
orphans); this is always a full recompute of the key SET (never
incremental), even though individual entries are reference-preserved.

A duplicate identity across two items is not an error: both items remain
in `fields` untouched, but they share one `DataInfo` slot -- the
last-encountered item during the walk determines that slot's info
(recorded as a warning, never silently ignored).

###### Type Parameters

| Type Parameter |
| ------ |
| `Item` |
| `TInfo` |

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `prevInfo` | `Partial`\<`Record`\<`string`, `TInfo`\>\> \| `undefined` |
| `nextItems` | readonly `Item`[] |
| `identityKeys` | [`IdentityKeys`](#identitykeys)\<`Item`\> |
| `touchedIdentities` | `ReadonlySet`\<`string`\> \| `"all"` |
| `makeInfoFor` | (`item`, `identityKey`) => `TInfo` |

###### Returns

[`ReconcileArrayInfoResult`](#reconcilearrayinforesult)\<`TInfo`\>

***

### processors

```ts
const processors: {
  parseJSON: (value) => unknown;
  toArray: (value, separator) => string[] | undefined;
  toBigInt: (value) => bigint | undefined;
  toBoolean: (value) => boolean | undefined;
  toDate: (value) => Date | undefined;
  toInteger: (value) => number | undefined;
  toLowerCase: (value) => string | undefined;
  toNumber: (value) => number | undefined;
  toRegExp: (value) => RegExp | undefined;
  toString: (value) => string | undefined;
  toUpperCase: (value) => string | undefined;
  toURL: (value) => URL | undefined;
  trim: (value) => string | undefined;
};
```

Convenience coercion helpers for a `processor(raw, ctx)` function (e.g. `processors.toNumber(raw.age)`). Never throw -- unparseable input resolves to `undefined`.

#### Type Declaration

##### parseJSON

```ts
parseJSON: (value) => unknown;
```

Parses a JSON string; non-string input returns `undefined`.

Parses a JSON string; non-string input returns `undefined`. Returns
`unknown` rather than an assertable `<T>` -- its result flows into a
processor's returned patch, which already runs through
`core/ownership.ts`'s own shape check on the way to a commit, so an
unchecked generic cast here would just hide that same unsafety behind a
type parameter instead of surfacing it at the call site.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`unknown`

##### toArray

```ts
toArray: (value, separator) => string[] | undefined;
```

Splits a delimited string into trimmed items; an array input passes through stringified.

Splits a delimited string into trimmed items; an array input passes through stringified.

###### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `value` | `unknown` | `undefined` |
| `separator` | `string` \| `RegExp` | `","` |

###### Returns

`string`[] \| `undefined`

##### toBigInt

```ts
toBigInt: (value) => bigint | undefined;
```

Coerces a string/number to a `bigint`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`bigint` \| `undefined`

##### toBoolean

```ts
toBoolean: (value) => boolean | undefined;
```

Coerces common boolean-like strings (`true`/`1`/`yes`/`on`, and their opposites) to a real boolean.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`boolean` \| `undefined`

##### toDate

```ts
toDate: (value) => Date | undefined;
```

Parses a value into a `Date`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`Date` \| `undefined`

##### toInteger

```ts
toInteger: (value) => number | undefined;
```

Coerces a value to a number and requires it to be an integer.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`number` \| `undefined`

##### toLowerCase

```ts
toLowerCase: (value) => string | undefined;
```

Lowercases a coercible value.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`string` \| `undefined`

##### toNumber

```ts
toNumber: (value) => number | undefined;
```

Coerces a value to a number, rejecting empty/whitespace-only strings.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`number` \| `undefined`

##### toRegExp

```ts
toRegExp: (value) => RegExp | undefined;
```

Compiles a string into a `RegExp`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`RegExp` \| `undefined`

##### toString

```ts
toString: (value) => string | undefined;
```

Coerces a value to a string.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`string` \| `undefined`

##### toUpperCase

```ts
toUpperCase: (value) => string | undefined;
```

Uppercases a coercible value.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`string` \| `undefined`

##### toURL

```ts
toURL: (value) => URL | undefined;
```

Parses a value into a `URL`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`URL` \| `undefined`

##### trim

```ts
trim: (value) => string | undefined;
```

Trims surrounding whitespace from a coercible value.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`string` \| `undefined`

***

### shape

```ts
const shape: {
  isDate: (value) => value is Date;
  isNullish: (value) => value is null | undefined;
  isPlainObject: (value) => value is Record<string, unknown>;
  isRegExp: (value) => value is RegExp;
  isURL: (value) => value is URL;
};
```

Structural (never business-rule) type guards for narrowing a raw value inside a processor.

#### Type Declaration

##### isDate

```ts
isDate: (value) => value is Date;
```

True for a `Date` instance.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`value is Date`

##### isNullish

```ts
isNullish: (value) => value is null | undefined;
```

True for `null`/`undefined`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

value is null \| undefined

##### isPlainObject

```ts
isPlainObject: (value) => value is Record<string, unknown>;
```

True for a plain object literal (or `Object.create(null)`) -- false for arrays, `null`, and class instances.

True for a plain object literal (or `Object.create(null)`) -- false for
`null`, arrays, and any class instance (including `Date`/`URL`/`RegExp`),
matching the same "plain object" notion `core/canonicalize.ts` uses
internally.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`value is Record<string, unknown>`

##### isRegExp

```ts
isRegExp: (value) => value is RegExp;
```

True for a `RegExp` instance.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`value is RegExp`

##### isURL

```ts
isURL: (value) => value is URL;
```

True for a `URL` instance.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

###### Returns

`value is URL`

## Functions

### canonicalize()

```ts
function canonicalize(value): string | undefined;
```

Canonicalizes `value` into a deterministic string, or `undefined` if it
cannot be safely canonicalized (a function, a symbol, a cyclic reference,
an invalid `Date`, a class instance without `.toJSON()`, or any object
carrying `__proto__`/`constructor`/`prototype` as an own key). Never
throws. Equal inputs always produce equal output; distinct supported
values never collide (own-enumerable-key walk only, `Object.keys` --
never `for...in`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `value` | `unknown` |

#### Returns

`string` \| `undefined`
