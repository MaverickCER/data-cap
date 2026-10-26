# 0072: Runtime observation lives in `data-cap/observe` and enters the evidence only through the build

## Status

Accepted. Adds the `./observe` entry point. Adds items to the negative-guarantees checklist of ADR 0047.

## Context

Static analysis cannot prove what a deployed program does at its boundaries, so the evidence needs a way to
record what was actually seen. Two risks follow. Observation code runs inside the consumer's application, so
it must be small, free of build tooling, and safe to bundle for a client. And observed data is exactly the
kind of data this package exists to protect, so the recorder must not become a leak.

## Decision

- `data-cap/observe` is its own entry point: no import of the compiler, `node:fs`, or any build module
  (verified by `internal-package-contract tool compiler-isolation`), `sideEffects: false`.
- `observeBoundary(...)` records events into a **caller-supplied sink**. The package never opens a file,
  socket, or network connection, and installs no global hook.
- An event records a capability, operation, field path, boundary kind, and a caller-supplied scope id (an
  execution or test id). It never records field values. The recorder validates its input and drops anything
  that is not a path.
- Observations reach the evidence only through the build: the caller passes the collected events to
  `buildEvidenceModel`, which stores them in `observation` and joins them to static facts. The runtime store
  (`data-cap/runtime`) is unchanged and does not observe anything on its own.
- OpenTelemetry is a mapping, not a dependency. A projection maps observations to and from OTel-shaped
  span/attribute data. Observed behavior is evidence of what happened in one execution; it does not prove
  that every static path is safe, and the documentation says so.

## Consequences

- ADR 0047 gains: observation never records values; observation never performs I/O of its own; a projection
  never presents an observation as covering code that was not exercised.
- A consumer that does not use observation pays nothing: the entry point is not imported.
