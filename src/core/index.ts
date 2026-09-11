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
