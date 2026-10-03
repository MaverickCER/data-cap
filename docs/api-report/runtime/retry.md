# runtime/retry

## Interfaces

### RetryOptions

#### Properties

##### delayMs?

```ts
readonly optional delayMs?: (attempt) => number;
```

Delay (ms) before a given 1-indexed retry attempt. Defaults to capped exponential backoff.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `attempt` | `number` |

###### Returns

`number`

##### maxAttempts?

```ts
readonly optional maxAttempts?: number;
```

Maximum retry attempts after the initial call (not counting the first attempt itself). Defaults to 3.

##### shouldRetry?

```ts
readonly optional shouldRetry?: (error, attempt) => boolean;
```

Whether `error` (from the given 1-indexed attempt) is worth retrying at all. Defaults to retrying every error -- callers should narrow this for real use.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `error` | `unknown` |
| `attempt` | `number` |

###### Returns

`boolean`

## Functions

### abortReason()

```ts
function abortReason(signal): unknown;
```

**`Internal`**

The reason value a `withRetry`/`delay` abort rejects with -- the signal's own `reason`, or a synthesized `AbortError` when it has none. Exported for direct unit coverage.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `signal` | `AbortSignal` |

#### Returns

`unknown`

***

### defaultBackoff()

```ts
function defaultBackoff(attempt): number;
```

**`Internal`**

Capped exponential backoff (1s, 2s, 4s, ... 30s max) for a 1-indexed attempt. Exported for direct unit coverage -- reached in production only through `withRetry`'s loop.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `attempt` | `number` |

#### Returns

`number`

***

### delay()

```ts
function delay(ms, signal): Promise<void>;
```

**`Internal`**

Resolves after `ms`, or immediately if `signal` aborts (now or during the wait). Exported for direct unit coverage.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ms` | `number` |
| `signal` | `AbortSignal` |

#### Returns

`Promise`\<`void`\>

***

### isStillDefault()

```ts
function isStillDefault(currentValue, declaredDefault): boolean;
```

One documented retry policy, exposed ready-made for the common case: retry
only when the target field currently holds nothing but its declared
schema default -- never risks overwriting already-valid data with an
ambiguous retry. Not the only valid policy. Uses the same canonicalization
comparison as array identity/coordinator dedup; a non-canonicalizable
value is conservatively treated as "not the default" (never retried).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `currentValue` | `unknown` |
| `declaredDefault` | `unknown` |

#### Returns

`boolean`

***

### withRetry()

```ts
function withRetry<T>(
   fn, 
   signal, 
   options?
): Promise<T>;
```

Runs `fn`, retrying on failure per `options`. Checks `signal` before every
attempt (including the first) and during any inter-attempt delay -- an
aborted signal always wins over a pending retry.

#### Type Parameters

| Type Parameter |
| ------ |
| `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `fn` | (`signal`) => `Promise`\<`T`\> |
| `signal` | `AbortSignal` |
| `options` | [`RetryOptions`](#retryoptions) |

#### Returns

`Promise`\<`T`\>
