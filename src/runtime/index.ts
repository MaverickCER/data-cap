export { createDataStore } from "./store.js"
export type { DataStoreController } from "./store.js"

export { composeSignals, rejectOnAbort } from "./abort.js"

export { createCoordinator, defaultCoordinator } from "./coordinator.js"
export type { Coordinator, SubscribeFn, SubscriptionHandlers } from "./coordinator.js"

export { UnknownGetterError } from "./errors.js"

// `createData` (below) calls core's `buildData` internally, which can throw
// `InvalidFieldDefaultError` -- re-exported here (not just from `data-cap`
// core) so a `data-cap/runtime`-only consumer can catch it without also
// importing from core. Load-bearing, not just convenience: `core` and
// `runtime` are separate tsup entries, each independently bundled (see
// tsup.config.ts), so `data-cap`'s own `InvalidFieldDefaultError` class and
// this bundle's inlined copy of the same source are two distinct classes at
// runtime -- an `instanceof` check only succeeds against the copy actually
// thrown from. Catching a `createData` error must use this export, not
// core's, unless the two bundles happen to share one module graph (a
// bundler that dedupes by source path, not guaranteed).
export { DataCapError, InvalidFieldDefaultError } from "../core/errors.js"

export { createData } from "./capability.js"
export type {
  CapabilityDescriptor,
  CreateDataOptions,
  DataCapability,
  DataCapabilitySnapshot,
  OperationDescriptor,
  OperationOutcome,
  OperationsSnapshot,
  OperationState,
  RunGettersOptions,
} from "./capability.js"
