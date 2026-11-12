# runtime/cache

## Interfaces

### DataCache

A bounded cache of complete `DataState` snapshots, keyed by a string the caller computes.
It evicts the least recently used entry first. It never builds keys and never fetches.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-tfields"></a> `TFields` |

#### Properties

##### size

```ts
readonly size: number;
```

How many entries the cache holds now.

#### Methods

##### clear()

```ts
clear(): void;
```

Removes every entry.

###### Returns

`void`

##### delete()

```ts
delete(key): void;
```

Removes the entry under `key`, if any.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

`void`

##### get()

```ts
get(key): DataState<TFields> | undefined;
```

The snapshot stored under `key`, or `undefined`. A hit marks the entry as most recently used.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

###### Returns

[`DataState`](../core.md#datastate)\<`TFields`\> \| `undefined`

##### set()

```ts
set(key, state): void;
```

Stores a complete snapshot, `fields` and `info` together, evicting the oldest entries past `maxEntries`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `state` | [`DataState`](../core.md#datastate)\<`TFields`\> |

###### Returns

`void`

***

### DataCacheOptions

Options for `createDataCache`.

#### Properties

##### maxEntries?

```ts
readonly maxEntries?: number;
```

Maximum number of entries retained; least-recently-used entries are evicted first. Defaults to 100.

## Functions

### createDataCache()

```ts
function createDataCache<TFields>(options?): DataCache<TFields>;
```

Creates a bounded, least-recently-used-eviction cache of complete
`DataState` snapshots keyed by an opaque string the caller computes (e.g.
a canonicalized function-identity + params key, mirroring the
coordinator's own dedup key -- computing that key is an integration
concern outside this module, which is deliberately keying-scheme-agnostic).

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-tfields-1"></a> `TFields` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options?` | [`DataCacheOptions`](#datacacheoptions) |

#### Returns

[`DataCache`](#datacache)\<`TFields`\>
