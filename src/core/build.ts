import { deepFreezeNewNodes } from "./patch.js"
import { resolveFieldDefaults } from "./schema.js"
import type { BuildDataConfig, DataInfo, DataState, FieldsShape, InferFields } from "./types.js"

/**
 * The synchronous `{fields, info}` state `buildData` returns: structurally
 * `DataState<InferFields<TFields>>`, not a distinct shape. This alias makes `buildData`'s own
 * signature read as "the shape `buildData` returns". Every other consumer should keep using
 * `DataState` directly.
 */
export type BuiltData<TFields extends FieldsShape> = DataState<InferFields<TFields>>

/**
 * Declares a schema's fields and returns their state. `data.fields` is readable
 * synchronously the instant this returns, holding the declared defaults. There is
 * no throw-until-ready gate, unlike `@maverickcer/env-cap`'s `createEnv` (see
 * specs/architecture.md).
 *
 * `buildData` is the low-level, pure and synchronous primitive: it reads only
 * `config.fields`. It ignores a `getters`, `mutators` or `subscriptions` section
 * on the same object; `createData` from `data-cap/runtime` runs those.
 * `data.info` is always present but starts empty. Nothing has
 * executed yet, so there is no metadata to report.
 *
 * @remarks
 * Throws synchronously, at call time, for a structurally invalid field default: a function value,
 * or a cyclic reference. That is a schema-authoring mistake to fix, not a runtime condition to warn
 * past.
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
