# observe

## Interfaces

### ObservationEvent

One observation: a field name was seen at a boundary during one scope. Never a value.

#### Properties

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
readonly optional handling?: FlowHandling;
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

##### fields

```ts
readonly fields: readonly (readonly string[])[];
```

Field paths (key names only) observed at the boundary.

##### handling?

```ts
readonly optional handling?: FlowHandling;
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

## Functions

### createMemorySink()

```ts
function createMemorySink(): {
  sink: ObservationSink;
  events(): readonly ObservationEvent[];
};
```

An in-memory sink -- the only one this package provides.

#### Returns

```ts
{
  sink: ObservationSink;
  events(): readonly ObservationEvent[];
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
