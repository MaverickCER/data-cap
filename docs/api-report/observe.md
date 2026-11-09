# observe

## Interfaces

### BodyReadable

The part of a web `Response` or `Request` that `observeResponse` uses; both satisfy it.

#### Methods

##### clone()

```ts
clone(): BodyReadable;
```

###### Returns

[`BodyReadable`](#bodyreadable)

##### json()

```ts
json(): Promise<unknown>;
```

###### Returns

`Promise`\<`unknown`\>

***

### InstrumentContext

`observeValue` context plus the walker options, for `instrumentBoundary` and `observeSink`.

#### Extends

- [`ObserveValueContext`](#observevaluecontext)

#### Properties

##### boundary

```ts
readonly boundary: ObservedBoundary;
```

###### Inherited from

[`ObserveValueContext`](#observevaluecontext).[`boundary`](#boundary-4)

##### capability

```ts
readonly capability: string;
```

The capability's export name, used to qualify each field path.

###### Inherited from

[`ObserveValueContext`](#observevaluecontext).[`capability`](#capability-2)

##### clock?

```ts
readonly clock?: () => number;
```

###### Returns

`number`

###### Inherited from

[`ObserveValueContext`](#observevaluecontext).[`clock`](#clock-2)

##### handling?

```ts
readonly handling?: FlowHandling;
```

###### Inherited from

[`ObserveValueContext`](#observevaluecontext).[`handling`](#handling-3)

##### observe?

```ts
readonly observe?: InstrumentObserve;
```

What to observe on each call: the first argument (default), the returned value, or both.

##### options?

```ts
readonly options?: ObserveValueOptions;
```

##### scope

```ts
readonly scope: string | (() => string);
```

###### Inherited from

[`ObserveValueContext`](#observevaluecontext).[`scope`](#scope-4)

***

### ObservationEvent

One observation: a field name was seen at a boundary during one scope. Never a value.

#### Properties

##### at?

```ts
readonly at?: string | number;
```

When the crossing was seen: epoch milliseconds or an ISO 8601 string. Present only when the caller supplied a
`clock` (the recorder never reads one itself, so it stays deterministic); the Observation Model keeps first/last seen.

##### boundary

```ts
readonly boundary: ObservedBoundary;
```

##### field

```ts
readonly field: string;
```

Capability-qualified dotted field path, for example `userData.user.email` -- the same naming the static Flow Model uses for field nodes.

##### handling?

```ts
readonly handling?: FlowHandling;
```

Declared handling of the value at this crossing, when the caller knows it.

##### scope

```ts
readonly scope: string;
```

Caller-supplied id of the execution or test the event was seen in.

***

### ObservationSink

Where events go. The package never provides one that does I/O.

#### Methods

##### record()

```ts
record(event): void;
```

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | [`ObservationEvent`](#observationevent) |

###### Returns

`void`

##### skip()?

```ts
skip?(info): void;
```

Optional channel for what the walker left out; pass `skips()` of the memory sink to `buildObservationModel`.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `info` | [`ObservationSkip`](#observationskip) |

###### Returns

`void`

***

### ObservationSkip

Evidence the recorder knowingly did not capture: below `field` (a capability-qualified path, or the capability
itself for the root) something was left out, for the stated reason. Names only, never a value.

#### Properties

##### boundary

```ts
readonly boundary: ObservedBoundary;
```

##### field

```ts
readonly field: string;
```

##### reason

```ts
readonly reason: ObservationSkipReason;
```

##### scope

```ts
readonly scope: string;
```

***

### ObserveBoundaryInput

What a caller passes to `observeBoundary`.

#### Properties

##### boundary

```ts
readonly boundary: ObservedBoundary;
```

##### capability

```ts
readonly capability: string;
```

The capability's export name, used to qualify each field path.

##### clock?

```ts
readonly clock?: () => number;
```

Caller-supplied time source (epoch ms), read once per call. The recorder never defaults to `Date.now()`.

###### Returns

`number`

##### fields

```ts
readonly fields: readonly (readonly string[])[];
```

Field paths (key names only) observed at the boundary.

##### handling?

```ts
readonly handling?: FlowHandling;
```

##### scope

```ts
readonly scope: string;
```

***

### ObservedBoundary

What kind of boundary was crossed and its stable name (matches a `boundary` node of the Flow Model).

#### Properties

##### kind

```ts
readonly kind: FlowBoundaryKind;
```

##### name

```ts
readonly name: string;
```

***

### ObserveValueContext

What `observeValue` and `observeSink` need besides the value; `scope` may be a function evaluated at each call (for example the current test name).

#### Extended by

- [`InstrumentContext`](#instrumentcontext)

#### Properties

##### boundary

```ts
readonly boundary: ObservedBoundary;
```

##### capability

```ts
readonly capability: string;
```

The capability's export name, used to qualify each field path.

##### clock?

```ts
readonly clock?: () => number;
```

###### Returns

`number`

##### handling?

```ts
readonly handling?: FlowHandling;
```

##### scope

```ts
readonly scope: string | (() => string);
```

***

### ObserveValueOptions

Bounds and switches for the walker.

#### Properties

##### collections?

```ts
readonly collections?: boolean;
```

Walk `Map` values and `Set` members under the element marker `[]` (default off: they are leaves). Map keys are never read.

##### maxDepth?

```ts
readonly maxDepth?: number;
```

Deepest nesting recorded (default 8); anything deeper is not walked and not recorded.

##### maxNodes?

```ts
readonly maxNodes?: number;
```

Most values visited per call (default 1000).

##### onSkip?

```ts
readonly onSkip?: (reason, path) => void;
```

Called once per distinct (reason, path) when the walker leaves something out, with the path (dotted, relative to
the capability, `""` for the root) below which evidence is missing. Names only. The same information goes to
`sink.skip` when the sink has one. A throwing callback is ignored.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `reason` | [`ObservationSkipReason`](#observationskipreason-1) |
| `path` | `string` |

###### Returns

`void`

## Type Aliases

### InstrumentObserve

```ts
type InstrumentObserve = "args" | "result" | "both";
```

Which call results `instrumentBoundary` observes.

***

### ObservationSkipReason

```ts
type ObservationSkipReason = "dotted-key" | "max-depth" | "max-nodes" | "cycle";
```

Why the walker did not record part of a value.

## Functions

### createMemorySink()

```ts
function createMemorySink(): {
  sink: ObservationSink;
  events(): readonly ObservationEvent[];
  skips(): readonly ObservationSkip[];
};
```

An in-memory sink -- the only one this package provides.

#### Returns

```ts
{
  sink: ObservationSink;
  events(): readonly ObservationEvent[];
  skips(): readonly ObservationSkip[];
}
```

##### sink

```ts
readonly sink: ObservationSink;
```

##### events()

```ts
events(): readonly ObservationEvent[];
```

###### Returns

readonly [`ObservationEvent`](#observationevent)[]

##### skips()

```ts
skips(): readonly ObservationSkip[];
```

###### Returns

readonly [`ObservationSkip`](#observationskip)[]

***

### fieldPathName()

```ts
function fieldPathName(capability, path): string;
```

The one place a capability-qualified field name is formed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `capability` | `string` |
| `path` | readonly `string`[] |

#### Returns

`string`

***

### instrumentBoundary()

```ts
function instrumentBoundary(
   target, 
   method, 
   context, 
   sink
): () => void;
```

Wraps `target[method]` so its first argument (`observe: "args"`, the default), its result (`"result"`: a returned
`Response` is observed by clone, a native promise by its resolved value) or both are observed (`observeValue`) on
every call, which then goes through with its `this`, arguments and result untouched. Returns a restore function (a no-op if someone else has since
replaced the method). Throws a `TypeError` at set-up when `target[method]` is not a function.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `target` | `object` |
| `method` | `string` |
| `context` | [`InstrumentContext`](#instrumentcontext) |
| `sink` | [`ObservationSink`](#observationsink) |

#### Returns

() => `void`

***

### observeBoundary()

```ts
function observeBoundary(sink, input): number;
```

Records one event per valid field path and returns how many it recorded.
Never throws: invalid input records nothing, and a throwing sink stops
recording without propagating (observation must not break the observed
program).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sink` | [`ObservationSink`](#observationsink) |
| `input` | [`ObserveBoundaryInput`](#observeboundaryinput) |

#### Returns

`number`

***

### observeResponse()

```ts
function observeResponse<T>(
   sink, 
   context, 
   response, 
   options?
): T;
```

Observes the JSON body of a web `Response` or `Request` without consuming the caller's: it clones, parses the
clone asynchronously and observes the parsed value (`observeValue`: names and paths only). Returns `response`
itself, untouched, so it can wrap a call (`const res = observeResponse(sink, ctx, await fetch(url))`). Scope and
the caller's `clock` are read when this is called, not when the body is parsed. A body that is not JSON, was
already used, or cannot be cloned records nothing; never throws and does no I/O beyond the clone. Cloning a
streaming body buffers it for the second reader, so avoid it on unbounded streams. Web-standard classes only.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t"></a> `T` *extends* [`BodyReadable`](#bodyreadable) |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sink` | [`ObservationSink`](#observationsink) |
| `context` | [`ObserveValueContext`](#observevaluecontext) |
| `response` | `T` |
| `options?` | [`ObserveValueOptions`](#observevalueoptions) |

#### Returns

`T`

***

### observeSink()

```ts
function observeSink(sink, context): <T>(value) => T;
```

A one-argument pass-through that observes its argument and returns it: `const tap = observeSink(sink, ctx); res.json(tap(body))`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sink` | [`ObservationSink`](#observationsink) |
| `context` | [`InstrumentContext`](#instrumentcontext) |

#### Returns

\<`T`\>(`value`) => `T`

***

### observeValue()

```ts
function observeValue<T>(
   sink, 
   context, 
   value, 
   options?
): T;
```

Walks any JSON-like `value` and records the field path of every object and leaf it contains -- names and paths
only, never a value -- through `observeBoundary`, then returns `value` itself so it can wrap a call
(`res.json(observeValue(sink, ctx, body))`). Array elements (and, with `collections`, Map values and Set members)
collapse into the Flow Model's element marker `[]`. Functions, symbols and `undefined` are ignored; getters are
never run; cycles are not re-entered; depth and visited-value count are bounded. The root itself is not a field
(a root primitive records nothing); keys that are empty or contain a dot cannot be path segments (the Flow Model names a path by joining segments with a
dot, so there is no reversible spelling) and are skipped -- but never silently: every skip (`dotted-key`, `max-depth`,
`max-nodes`, `cycle`) is reported to `options.onSkip` and to `sink.skip`. Never throws.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-1"></a> `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sink` | [`ObservationSink`](#observationsink) |
| `context` | [`ObserveValueContext`](#observevaluecontext) |
| `value` | `T` |
| `options?` | [`ObserveValueOptions`](#observevalueoptions) |

#### Returns

`T`
