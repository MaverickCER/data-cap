/**
 * Re-exports core's canonicalization primitive for direct use outside the
 * package (e.g. building a custom coordinator dedup key, or a bespoke
 * identity scheme for an array shape `identity.ts`'s own key-joining logic
 * doesn't cover). Neither `buildData` nor the runtime import this module --
 * they use `core/canonicalize.ts` directly; this is purely a convenience
 * re-export for application code.
 */
export { canonicalize } from "../core/canonicalize.js"
