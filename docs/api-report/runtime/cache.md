# runtime/cache

## Interfaces

### DataCache

#### Type Parameters

| Type Parameter |
| ------ |
| `TFields` |

#### Properties

##### size

```ts
readonly size: number;
```

#### Methods

##### clear()

```ts
clear(): void;
```

###### Returns

`void`

##### delete()

```ts
delete(key): void;
```

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

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `state` | [`DataState`](../core.md#datastate)\<`TFields`\> |

###### Returns

`void`

***

### DataCacheOptions

#### Properties

##### maxEntries?

```ts
readonly optional maxEntries?: number;
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
| `TFields` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`DataCacheOptions`](#datacacheoptions) |

#### Returns

[`DataCache`](#datacache)\<`TFields`\>
