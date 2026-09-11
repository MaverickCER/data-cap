/**
 * Re-exports core's array-identity primitives for application code that
 * builds its own runtime glue on top of `DataState` (per the "no first-party
 * transport adapters, only examples" decision -- see examples/) and needs to
 * reconcile `info` for an identity-configured array itself, the same way the
 * standalone runtime does.
 *
 * Purely a convenience re-export -- the runtime imports `core/identity.ts`
 * directly and has no knowledge of this module.
 */
export { computeItemIdentity, reconcileArrayInfo } from "../core/identity.js"
export type {
  IdentityKeys,
  IdentityWarning,
  IdentityWarningReason,
  ReconcileArrayInfoResult,
} from "../core/identity.js"
