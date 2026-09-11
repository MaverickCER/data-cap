import { deepFreezeNewNodes } from "./patch.js"
import { resolveFieldDefaults } from "./schema.js"
import type { BuildDataConfig, DataInfo, DataState, FieldsShape, InferFields } from "./types.js"

/**
 * The synchronous `{fields, info}` state `buildData` returns -- structurally
 * just `DataState<InferFields<TFields>>`, not a distinct shape. This alias
 * exists so `buildData`'s own signature reads as "the shape `buildData`
 * specifically returns," which is more informative at that one call site
 * than a bare `DataState` would be; every other consumer should keep using
 * `DataState` directly.
 */
export type BuiltData<TFields extends FieldsShape> = DataState<InferFields<TFields>>

/**
 * Declares a schema's field contract. `data.fields` is synchronously readable
 * the instant this returns -- populated with declared defaults -- there is no
 * throw-until-ready gate (a deliberate divergence from `@maverickcer/env-cap`'s
 * `createEnv`; see specs/architecture.md).
 *
 * `buildData` is the low-level, pure/synchronous primitive: `config` only ever
 * reads `fields` (a `getters`/`mutators`/`subscriptions` section on the same
 * object, if present, is simply ignored here -- that's what the batteries-
 * included `createData` from `data-cap/runtime` is for). `data.
 * info` is present (mandatory, never optional) but starts empty: nothing has
 * executed yet, so there is nothing to report metadata for.
 *
 * @remarks
 * Throws synchronously, at call time, for a structurally invalid field
 * default (a function value, or a cyclic reference) -- this is a
 * schema-authoring mistake the developer must fix, not a runtime condition
 * to warn-and-continue past.
 */
export function buildData<TFields extends FieldsShape>(
  config: BuildDataConfig<TFields>,
): BuiltData<TFields> {
  const resolvedFields = resolveFieldDefaults(config.fields, [], new Set()) as InferFields<TFields>
  const info = {} as DataInfo<InferFields<TFields>>

  const state: DataState<InferFields<TFields>> = { fields: resolvedFields, info }
  // The very first snapshot is deep-frozen in full once; every subsequent
  // commit (via patch.ts's commitState) only needs to freeze its
  // newly-created nodes, since unchanged branches are reused by reference
  // and were already frozen here or by a prior commit. See
  // specs/architecture.md's "Snapshot immutability enforcement".
  deepFreezeNewNodes(state)

  return state
}
