/**
 * The `data-cap` entry: declare a capability's fields with `buildData`, and its documentation with
 * `documentData`. It also exports the `DataState` types and the error classes. It imports nothing.
 * Tests run it on Node 22 or later, as a bundle with Web globals only, and on Bun and Deno.
 *
 * @packageDocumentation
 */

export { buildData } from "./build.js"
export type { BuiltData } from "./build.js"

export { documentData } from "./document.js"
export type {
  CapabilityDocs,
  CapabilityFieldDocs,
  CapabilityOperationDocs,
  DataFlowDirection,
  DataFlowEndpoint,
  DataFlowEndpointKind,
  FieldDocs,
  FlowBoundaryKind,
  FlowHandling,
  FlowPolicyAppliesToDocs,
  FlowPolicyDocs,
  OperationDocs,
} from "./document.js"

export { fields } from "./fields.js"
export type { NullableMarker, OptionalMarker } from "./fields.js"

export { DataCapError, InvalidFieldDefaultError } from "./errors.js"

export type {
  BuildDataConfig,
  DataError,
  DataInfo,
  DataSchema,
  DataState,
  DataStatus,
  DataStore,
  FieldInfo,
  FieldOwnership,
  FieldsShape,
  GetterDefinition,
  InferFields,
  InferFieldValue,
  MutatorDefinition,
  OwnedPatch,
  SubscriptionDefinition,
  SubscriptionEventHandlers,
  SubscriptionInfo,
} from "./types.js"
