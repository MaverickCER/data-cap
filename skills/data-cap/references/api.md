# data-cap public API

Every export a consumer can import, by entry point, for version 0.7.0. Generated from the package's committed API baselines; the type declarations in the installed package are the authority.

## `data-cap`

- `buildData` (function): `function buildData<TFields extends FieldsShape>(config: BuildDataConfig<TFields>): BuiltData<TFields>`
- `BuildDataConfig` (interface): `interface BuildDataConfig<TFields extends FieldsShape>`
- `BuiltData` (typealias): `type BuiltData<TFields extends FieldsShape> = DataState<InferFields<TFields>>`
- `CapabilityDocs` (interface): `interface CapabilityDocs<TSchema extends DataSchema<FieldsShape>>`
- `CapabilityFieldDocs` (typealias): `type CapabilityFieldDocs<TFields> = { [K in keyof TFields]?: FieldDocs; }`
- `CapabilityOperationDocs` (typealias): `type CapabilityOperationDocs<TOperations> = { [K in keyof TOperations]?: OperationDocs; }`
- `DataCapError` (class): `abstract class DataCapError extends Error`
- `DataError` (interface): `interface DataError`
- `DataFlowDirection` (typealias): `type DataFlowDirection = "input" | "output"`
- `DataFlowEndpoint` (interface): `interface DataFlowEndpoint`
- `DataFlowEndpointKind` (typealias): `type DataFlowEndpointKind = "database" | "cache" | "storage" | "queue" | "api" | "external-service" | "user-input" | "computed" | "internal"`
- `DataInfo` (typealias): `type DataInfo<T> = T extends readonly (infer Item)[] ? Partial<Record<string, DataInfo<Item> & FieldInfo>> : T extends Date | URL | RegExp ? FieldInfo : T extends object ? { [K in keyof T]?: DataInfo<T[K]>; } & FieldInfo : FieldInfo`
- `DataSchema` (interface): `interface DataSchema<TFields extends FieldsShape> extends BuildDataConfig<TFields>`
- `DataState` (interface): `interface DataState<TFields>`
- `DataStatus` (typealias): `type DataStatus = "idle" | "loading" | "success" | "error" | "retrying"`
- `DataStore` (interface): `interface DataStore<TFields>`
- `documentData` (function): `function documentData<TSchema extends DataSchema<FieldsShape>>(config: TSchema, docs: CapabilityDocs<TSchema>): void`
- `FieldDocs` (interface): `interface FieldDocs`
- `FieldInfo` (interface): `interface FieldInfo`
- `FieldOwnership` (typealias): `type FieldOwnership<T> = true | { [K in keyof T]?: T[K] extends readonly unknown[] ? true : T[K] extends object ? FieldOwnership<T[K]> : true; }`
- `fields` (class): `class fields`
- `FieldsShape` (typealias): `type FieldsShape = Record<string, any>`
- `GetterDefinition` (interface): `interface GetterDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields>>`
- `InferFields` (typealias): `type InferFields<F extends FieldsShape> = { [K in keyof F]: InferFieldValue<F[K]>; }`
- `InferFieldValue` (typealias): `type InferFieldValue<F> = F extends NullableMarker<infer Inner> ? InferFieldValue<Inner> | null : F extends OptionalMarker<infer Inner> ? InferFieldValue<Inner> | undefined : F extends readonly (infer Item)[] ? InferFieldValue<Item>[] : F extends Date | URL | RegExp ? F : F extends (...args: never[]) => unknown ? never : F extends object ? { [K in keyof F]: InferFieldValue<F[K]>; } : F`
- `InvalidFieldDefaultError` (class): `class InvalidFieldDefaultError extends DataCapError`
- `MutatorDefinition` (interface): `interface MutatorDefinition<TFields, TParams, TRaw, TWrites extends FieldOwnership<TFields> | undefined>`
- `NullableMarker` (interface): `interface NullableMarker<T>`
- `OperationDocs` (interface): `interface OperationDocs`
- `OptionalMarker` (interface): `interface OptionalMarker<T>`
- `OwnedPatch` (typealias): `type OwnedPatch<T, TOwnership> = TOwnership extends true ? DeepPartial<T> : T extends readonly unknown[] ? never : T extends Date | URL | RegExp ? never : T extends object ? { [K in keyof TOwnership & keyof T]?: OwnedPatch<T[K], TOwnership[K]>; } : never`
- `SubscriptionDefinition` (interface): `interface SubscriptionDefinition<TFields, TParams, TEvent, TWrites extends FieldOwnership<TFields>>`
- `SubscriptionEventHandlers` (interface): `interface SubscriptionEventHandlers<TEvent>`
- `SubscriptionInfo` (interface): `interface SubscriptionInfo`

## `data-cap/runtime`

- `CapabilityDescriptor` (interface): `interface CapabilityDescriptor`
- `composeSignals` (function): `function composeSignals(signals: readonly AbortSignal[]): AbortSignal`
- `Coordinator` (interface): `interface Coordinator`
- `createCoordinator` (function): `function createCoordinator(): Coordinator`
- `createData` (function): `function createData<TSchema extends DataSchema<FieldsShape>>(schema: TSchema, options?: CreateDataOptions): DataCapability<TSchema>`
- `CreateDataOptions` (interface): `interface CreateDataOptions`
- `createDataStore` (function): `function createDataStore<TFields>(initialState: DataState<TFields>): DataStoreController<TFields>`
- `DataCapability` (typealias): `type DataCapability<TSchema extends DataSchema<FieldsShape>> = CapabilityGetterMethods<InferFields<TSchema["fields"]>, TSchema["getters"]> & CapabilityMutatorMethods<InferFields<TSchema["fields"]>, TSchema["mutators"]> & CapabilitySubscriptionMethods<TSchema["subscriptions"]> & CapabilityBase<InferFields<TSchema["fields"]>, TSchema["getters"]>`
- `DataCapabilitySnapshot` (interface): `interface DataCapabilitySnapshot<TFields> extends DataState<TFields>`
- `DataCapError` (class): `abstract class DataCapError extends Error`
- `DataStoreController` (interface): `interface DataStoreController<TFields> extends DataStore<TFields>`
- `defaultCoordinator` (variable): `defaultCoordinator: Coordinator`
- `InvalidFieldDefaultError` (class): `class InvalidFieldDefaultError extends DataCapError`
- `OperationDescriptor` (interface): `interface OperationDescriptor`
- `OperationOutcome` (typealias): `type OperationOutcome<T> = { readonly status: "success"; readonly value: T; } | { readonly status: "error"; readonly error: DataError; }`
- `OperationsSnapshot` (typealias): `type OperationsSnapshot = Readonly<Record<string, Readonly<Record<string, OperationState>>>>`
- `OperationState` (interface): `interface OperationState`
- `rejectOnAbort` (function): `function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>`
- `RunGettersOptions` (interface): `interface RunGettersOptions`
- `SubscribeFn` (typealias): `type SubscribeFn<TEvent> = (handlers: SubscriptionHandlers<TEvent>) => () => void`
- `SubscriptionHandlers` (interface): `interface SubscriptionHandlers<TEvent>`
- `UnknownGetterError` (class): `class UnknownGetterError extends DataCapError`

## `data-cap/runtime/cache`

- `createDataCache` (function): `function createDataCache<TFields>(options?: DataCacheOptions): DataCache<TFields>`
- `DataCache` (interface): `interface DataCache<TFields>`
- `DataCacheOptions` (interface): `interface DataCacheOptions`

## `data-cap/runtime/retry`

- `isStillDefault` (function): `function isStillDefault(currentValue: unknown, declaredDefault: unknown): boolean`
- `RetryOptions` (interface): `interface RetryOptions`
- `withRetry` (function): `function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, options?: RetryOptions): Promise<T>`

## `data-cap/helpers`

- `canonicalize` (function): `function canonicalize(value: unknown): string | undefined`
- `identity` (variable): `identity: { computeItemIdentity: typeof computeItemIdentity; reconcileArrayInfo: typeof reconcileArrayInfo; }`
- `IdentityKeys` (typealias): `type IdentityKeys<Item> = readonly (keyof Item & string)[]`
- `IdentityWarning` (interface): `interface IdentityWarning`
- `IdentityWarningReason` (typealias): `type IdentityWarningReason = "missing-key" | "malformed-item" | "duplicate-identity"`
- `processors` (variable): `processors: { parseJSON: typeof parseJSON; toArray: typeof toArray; toBigInt: typeof toBigInt; toBoolean: typeof toBoolean; toDate: typeof toDate; toInteger: typeof toInteger; toLowerCase: typeof toLowerCase; toNumber: typeof toNumber; toRegExp: typeof toRegExp; toString: typeof toString; toURL: typeof toURL; toUpperCase: typeof toUpperCase; trim: typeof trim; }`
- `ReconcileArrayInfoResult` (interface): `interface ReconcileArrayInfoResult<TInfo>`
- `shape` (variable): `shape: { isDate: typeof isDate; isNullish: typeof isNullish; isPlainObject: typeof isPlainObject; isRegExp: typeof isRegExp; isURL: typeof isURL; }`

## `data-cap/build`

- `BlastRadiusEntry` (interface): `interface BlastRadiusEntry`
- `buildChangeModel` (function): `function buildChangeModel(manifest: ManifestChangeReport, capabilities: readonly ChangeModelCapability[], dependencyModel?: DependencyModel): ChangeModel`
- `buildCitationSnapshots` (function): `function buildCitationSnapshots(inventory: CapabilityInventory, root: string, fs: BuildFileSystem): Promise<ReadonlyMap<string, Readonly<Record<string, readonly CitationSnapshotEntry[]>>>>`
- `buildDependencyModel` (function): `function buildDependencyModel(edges: readonly DependencyEdge[]): DependencyModel`
- `BuildDirent` (interface): `interface BuildDirent`
- `buildEvidenceModel` (function): `function buildEvidenceModel(models: EvidenceModelInputs, provenance: EvidenceProvenance): EvidenceModel`
- `BuildFileSystem` (interface): `interface BuildFileSystem`
- `buildFindingModel` (function): `function buildFindingModel(findings: readonly ReportFinding[]): FindingModel`
- `buildFlowGraph` (function): `function buildFlowGraph(inventory: CapabilityInventory, edges: readonly DependencyEdge[]): FlowGraph`
- `buildInventory` (function): `function buildInventory(linkResult: LinkResult): CapabilityInventory`
- `buildLifecycleModel` (function): `function buildLifecycleModel(inventory: CapabilityInventory, expiringWithinDays: number, now: Date): LifecycleModel`
- `buildManifestSnapshot` (function): `function buildManifestSnapshot(inventory: CapabilityInventory): ManifestSnapshot`
- `buildOpenApiSchemaArtifact` (function): `function buildOpenApiSchemaArtifact(inventory: CapabilityInventory, info: { readonly title: string; readonly version: string; }): OpenApiSchemaArtifact`
- `buildOwnershipMatrix` (function): `function buildOwnershipMatrix(inventory: CapabilityInventory): readonly OwnershipMatrixEntry[]`
- `buildOwnershipModel` (function): `function buildOwnershipModel(inventory: CapabilityInventory): OwnershipModel`
- `buildRuntimeContractModel` (function): `function buildRuntimeContractModel(): RuntimeContractModel`
- `buildSarifLog` (function): `function buildSarifLog(findingModel: FindingModel): SarifLog`
- `BuildStats` (interface): `interface BuildStats`
- `CAPABILITY_MODEL_SCHEMA_VERSION` (variable): `CAPABILITY_MODEL_SCHEMA_VERSION = 3`
- `CapabilityInventory` (interface): `interface CapabilityInventory`
- `CapabilityNode` (interface): `interface CapabilityNode`
- `CHANGE_MODEL_SCHEMA_VERSION` (variable): `CHANGE_MODEL_SCHEMA_VERSION = 2`
- `ChangeModel` (interface): `interface ChangeModel`
- `ChangeModelCapability` (interface): `interface ChangeModelCapability`
- `checkArtifacts` (function): `function checkArtifacts(options: GenerateDataArtifactsOptions): Promise<CheckArtifactsResult>`
- `CheckArtifactsResult` (interface): `interface CheckArtifactsResult`
- `checkDuplicateEndpoints` (function): `function checkDuplicateEndpoints(inventory: CapabilityInventory): readonly ReportFinding[]`
- `checkExclusiveGroups` (function): `function checkExclusiveGroups(inventory: CapabilityInventory): readonly ReportFinding[]`
- `checkOwnershipAndSensitivity` (function): `function checkOwnershipAndSensitivity(inventory: CapabilityInventory): readonly ReportFinding[]`
- `checkStructuralDuplication` (function): `function checkStructuralDuplication(inventory: CapabilityInventory): readonly ReportFinding[]`
- `CitationSnapshotEntry` (interface): `interface CitationSnapshotEntry extends SourceLocation`
- `ClassificationEntry` (interface): `interface ClassificationEntry`
- `ComplianceEntry` (interface): `interface ComplianceEntry`
- `ComputedArtifacts` (interface): `interface ComputedArtifacts`
- `computeDataArtifacts` (function): `function computeDataArtifacts(options: GenerateDataArtifactsOptions): Promise<ComputedArtifacts>`
- `computeExpiringEntries` (function): `function computeExpiringEntries(inventory: CapabilityInventory, expiringWithinDays: number, now: Date): readonly ExpiringEntry[]`
- `computeSourceFingerprint` (function): `function computeSourceFingerprint(options: ComputeSourceFingerprintOptions): Promise<string>`
- `ComputeSourceFingerprintOptions` (interface): `interface ComputeSourceFingerprintOptions`
- `DataProjectGenerationError` (class): `class DataProjectGenerationError extends DataCapError`
- `DEFAULT_EXPIRING_WITHIN_DAYS` (variable): `DEFAULT_EXPIRING_WITHIN_DAYS = 30`
- `DEFAULT_INCLUDE` (variable): `DEFAULT_INCLUDE: readonly string[]`
- `defineEvidenceProjection` (function): `function defineEvidenceProjection<T extends Record<string, unknown>>(schema: EvidenceProjectionSchema<T>): EvidenceProjection<T>`
- `DEPENDENCY_MODEL_SCHEMA_VERSION` (variable): `DEPENDENCY_MODEL_SCHEMA_VERSION = 3`
- `DependencyEdge` (interface): `interface DependencyEdge`
- `DependencyModel` (interface): `interface DependencyModel`
- `DependencyModelCapabilityEdges` (interface): `interface DependencyModelCapabilityEdges`
- `DependencyModelConsumer` (interface): `interface DependencyModelConsumer`
- `DependencyRelationship` (typealias): `type DependencyRelationship = "imports" | "reads-field" | "calls-getter" | "calls-mutator" | "calls-subscription"`
- `deriveUsageFindings` (function): `function deriveUsageFindings(inventory: CapabilityInventory, edges: readonly DependencyEdge[]): readonly ReportFinding[]`
- `diffManifestSnapshots` (function): `function diffManifestSnapshots(previous: ManifestSnapshot | undefined, current: ManifestSnapshot): ManifestChangeReport`
- `discoverCapabilityFiles` (function): `function discoverCapabilityFiles(options: DiscoverOptions): Promise<string[]>`
- `DiscoveredCapability` (interface): `interface DiscoveredCapability`
- `DiscoverOptions` (interface): `interface DiscoverOptions`
- `evaluateLiteral` (function): `function evaluateLiteral(node: TS.Expression): LiteralEvalResult`
- `EVIDENCE_MODEL_SCHEMA_VERSION` (variable): `EVIDENCE_MODEL_SCHEMA_VERSION = 2`
- `EvidenceComputedModels` (interface): `interface EvidenceComputedModels`
- `evidenceDisclaimer` (function): `function evidenceDisclaimer(): string`
- `EvidenceModel` (interface): `interface EvidenceModel`
- `EvidenceModelInputs` (interface): `interface EvidenceModelInputs`
- `EvidenceProjection` (interface): `interface EvidenceProjection<T extends Record<string, unknown>>`
- `EvidenceProjectionResult` (interface): `interface EvidenceProjectionResult<T extends Record<string, unknown>>`
- `EvidenceProjectionSchema` (typealias): `type EvidenceProjectionSchema<T extends Record<string, unknown>> = { readonly [K in keyof T]: EvidenceProjector<T[K]>; }`
- `EvidenceProjector` (typealias): `type EvidenceProjector<T> = (evidence: EvidenceModel) => T`
- `EvidenceProvenance` (interface): `interface EvidenceProvenance`
- `ExpiringEntry` (interface): `interface ExpiringEntry`
- `FieldFlow` (interface): `interface FieldFlow`
- `FieldNode` (interface): `interface FieldNode`
- `FINDING_MODEL_SCHEMA_VERSION` (variable): `FINDING_MODEL_SCHEMA_VERSION = 2`
- `FindingLocation` (typealias): `type FindingLocation = { readonly kind: "none"; } | { readonly kind: "capability"; readonly capability: FindingLocationCapability; readonly position?: SourcePosition; } | { readonly kind: "field"; readonly capability: FindingLocationCapability; readonly field: readonly string[]; readonly position?: SourcePosition; readonly indeterminateSites?: readonly SourceLocation[]; } | { readonly kind: "operation"; readonly capability: FindingLocationCapability; readonly operation: string; readonly position?: SourcePosition; } | { readonly kind: "consumer"; readonly capability: FindingLocationCapability; readonly source: string; }`
- `FindingLocationCapability` (interface): `interface FindingLocationCapability`
- `FindingModel` (interface): `interface FindingModel`
- `findManifestExportCollisions` (function): `function findManifestExportCollisions(inventory: CapabilityInventory): ReadonlyMap<string, readonly string[]>`
- `fingerprintPathFor` (function): `function fingerprintPathFor(evidencePath: string): string`
- `FlowGraph` (interface): `interface FlowGraph`
- `generateDataArtifacts` (function): `function generateDataArtifacts(options: GenerateDataArtifactsOptions): Promise<ReportResult>`
- `GenerateDataArtifactsOptions` (interface): `interface GenerateDataArtifactsOptions`
- `generatedBanner` (function): `function generatedBanner(format?: "ts" | "markdown", regenerate?: string): string`
- `generateDocumentation` (function): `function generateDocumentation(options: GenerateDocumentationOptions): GenerateDocumentationResult`
- `GenerateDocumentationOptions` (interface): `interface GenerateDocumentationOptions`
- `GenerateDocumentationResult` (interface): `interface GenerateDocumentationResult`
- `generateFlow` (function): `function generateFlow(options: GenerateFlowOptions): GenerateFlowResult`
- `GenerateFlowFile` (interface): `interface GenerateFlowFile`
- `GenerateFlowOptions` (interface): `interface GenerateFlowOptions`
- `GenerateFlowResult` (interface): `interface GenerateFlowResult`
- `generateManifest` (function): `function generateManifest(options: GenerateManifestOptions): GenerateManifestResult`
- `GenerateManifestOptions` (interface): `interface GenerateManifestOptions`
- `GenerateManifestResult` (interface): `interface GenerateManifestResult`
- `generateUsage` (function): `function generateUsage(options: GenerateUsageOptions): Promise<GenerateUsageResult>`
- `GenerateUsageOptions` (interface): `interface GenerateUsageOptions`
- `GenerateUsageResult` (interface): `interface GenerateUsageResult`
- `getEvidenceModel` (function): `function getEvidenceModel(options: GetEvidenceModelOptions): Promise<GetEvidenceModelResult>`
- `GetEvidenceModelOptions` (interface): `interface GetEvidenceModelOptions extends GenerateDataArtifactsOptions`
- `GetEvidenceModelResult` (interface): `interface GetEvidenceModelResult`
- `getStaticPropertyName` (function): `function getStaticPropertyName(name: TS.PropertyName): string | undefined`
- `groupEdgesByCapability` (function): `function groupEdgesByCapability(capabilities: readonly { readonly file: string; readonly exportName: string; }[], edges: readonly DependencyEdge[]): readonly DependencyModelCapabilityEdges[]`
- `groupEdgesByConsumer` (function): `function groupEdgesByConsumer(edges: readonly DependencyEdge[]): readonly DependencyModelConsumer[]`
- `ImportBinding` (interface): `interface ImportBinding`
- `ImportBindingMatch` (interface): `interface ImportBindingMatch`
- `isGeneratedFile` (function): `function isGeneratedFile(content: string): boolean`
- `JsonSchemaLike` (typealias): `type JsonSchemaLike = Record<string, unknown>`
- `LIFECYCLE_MODEL_SCHEMA_VERSION` (variable): `LIFECYCLE_MODEL_SCHEMA_VERSION = 1`
- `LifecycleModel` (interface): `interface LifecycleModel`
- `LifecycleModelCapability` (interface): `interface LifecycleModelCapability`
- `LifecycleModelField` (interface): `interface LifecycleModelField`
- `linkCapabilityFiles` (function): `function linkCapabilityFiles(files: readonly string[], options: LinkOptions): Promise<LinkResult>`
- `LinkOptions` (interface): `interface LinkOptions`
- `LinkResult` (interface): `interface LinkResult`
- `LiteralEvalResult` (typealias): `type LiteralEvalResult = { readonly ok: true; readonly value: unknown; } | { readonly ok: false; }`
- `LocatedFinding` (typealias): `type LocatedFinding = Omit<ReportFinding, FlatLocators> & { readonly location: FindingLocation; }`
- `locationOf` (function): `function locationOf(finding: ReportFinding): FindingLocation`
- `ManifestCapabilityUpdate` (interface): `interface ManifestCapabilityUpdate`
- `ManifestChangeReport` (interface): `interface ManifestChangeReport`
- `ManifestFieldDiff` (interface): `interface ManifestFieldDiff`
- `ManifestSnapshot` (interface): `interface ManifestSnapshot`
- `ManifestSnapshotCapability` (interface): `interface ManifestSnapshotCapability`
- `OpenApiSchemaArtifact` (interface): `interface OpenApiSchemaArtifact`
- `OperationNames` (interface): `interface OperationNames`
- `OperationNode` (interface): `interface OperationNode`
- `OperationPresenceByKind` (interface): `interface OperationPresenceByKind`
- `OperationWritesByKind` (interface): `interface OperationWritesByKind`
- `OWNERSHIP_MODEL_SCHEMA_VERSION` (variable): `OWNERSHIP_MODEL_SCHEMA_VERSION = 2`
- `OwnershipCapabilityRef` (interface): `interface OwnershipCapabilityRef`
- `OwnershipFieldRef` (interface): `interface OwnershipFieldRef`
- `OwnershipMatrixEntry` (interface): `interface OwnershipMatrixEntry`
- `OwnershipModel` (interface): `interface OwnershipModel`
- `parseCapabilityFile` (function): `function parseCapabilityFile(filePath: string, sourceText: string): ParseResult`
- `ParseResult` (interface): `interface ParseResult`
- `ParseWarning` (interface): `interface ParseWarning`
- `positionOf` (function): `function positionOf(sourceFile: TS.SourceFile, node: TS.Node): SourcePosition`
- `PrivacyEntry` (interface): `interface PrivacyEntry`
- `projectAuditEvidence` (function): `function projectAuditEvidence(evidence: EvidenceModel): ProjectAuditEvidenceOutput`
- `projectAuditEvidence` (namespace): `namespace projectAuditEvidence`
- `projectClassificationEvidence` (function): `function projectClassificationEvidence(evidence: EvidenceModel): ProjectClassificationEvidenceOutput`
- `projectClassificationEvidence` (namespace): `namespace projectClassificationEvidence`
- `projectComplianceEvidence` (function): `function projectComplianceEvidence(evidence: EvidenceModel): ProjectComplianceEvidenceOutput`
- `projectComplianceEvidence` (namespace): `namespace projectComplianceEvidence`
- `projectFields` (function): `function projectFields(inventory: CapabilityInventory): readonly WithCapability<FieldNode>[]`
- `projectGetters` (function): `function projectGetters(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[]`
- `projectMutators` (function): `function projectMutators(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[]`
- `projectOperationInventory` (function): `function projectOperationInventory(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[]`
- `projectPrivacyEvidence` (function): `function projectPrivacyEvidence(evidence: EvidenceModel): ProjectPrivacyEvidenceOutput`
- `projectPrivacyEvidence` (namespace): `namespace projectPrivacyEvidence`
- `projectRetentionEvidence` (function): `function projectRetentionEvidence(evidence: EvidenceModel): ProjectRetentionEvidenceOutput`
- `projectRetentionEvidence` (namespace): `namespace projectRetentionEvidence`
- `projectSubscriptions` (function): `function projectSubscriptions(inventory: CapabilityInventory): readonly WithCapability<OperationNode>[]`
- `RawCreateDataCall` (interface): `interface RawCreateDataCall`
- `RawDocumentDataCall` (interface): `interface RawDocumentDataCall`
- `RawOperationPresence` (interface): `interface RawOperationPresence`
- `RawOperationWrites` (interface): `interface RawOperationWrites`
- `RenamedField` (interface): `interface RenamedField`
- `renderCapabilityDiagram` (function): `function renderCapabilityDiagram(capability: CapabilityNode, flows: readonly FieldFlow[], root: string): string`
- `renderDependencyGraphDot` (function): `function renderDependencyGraphDot(capabilities: readonly { readonly file: string; readonly exportName: string; }[], model: DependencyModel): string`
- `renderDocumentation` (function): `function renderDocumentation(inventory: CapabilityInventory, root: string, changes?: ManifestChangeReport, edges?: readonly DependencyEdge[], evidencePath?: string, lifecycle?: LifecycleModel): string`
- `renderManifest` (function): `function renderManifest(inventory: CapabilityInventory, outputPath: string, root: string): string`
- `renderOverviewDiagram` (function): `function renderOverviewDiagram(capabilities: readonly CapabilityNode[], flows: readonly FieldFlow[], root: string): string`
- `renderOwnershipGraphDot` (function): `function renderOwnershipGraphDot(model: OwnershipModel): string`
- `renderSensitivityDiagram` (function): `function renderSensitivityDiagram(level: string, capabilities: readonly CapabilityNode[], flows: readonly FieldFlow[], root: string): string`
- `renderUsageReport` (function): `function renderUsageReport(inventory: CapabilityInventory, edges: readonly DependencyEdge[], root: string, scannedPackages?: readonly string[], evidencePath?: string): string`
- `ReportFinding` (interface): `interface ReportFinding`
- `ReportFindingCode` (typealias): `type ReportFindingCode = "CAPABILITY_MISSING_OWNER" | "SENSITIVE_CAPABILITY_MISSING_PROTECTIONS" | "SENSITIVE_FIELD_MISSING_PROTECTIONS" | "SENSITIVE_FIELD_MISSING_PURPOSE" | "SENSITIVE_FIELD_MISSING_LEGAL_BASIS" | "AUDIT_REQUIRED_WITHOUT_OWNER" | "NONSTANDARD_SENSITIVITY_LEVEL" | "EXCLUSIVE_GROUP_VIOLATION" | "MANIFEST_EXPORT_NAME_COLLISION" | "DUPLICATE_FIELD_SHAPE_ACROSS_CAPABILITIES" | "DUPLICATE_ENDPOINT_ACROSS_CAPABILITIES" | "ABANDONED_CAPABILITY" | "UNCONSUMED_FIELD" | "FIELD_ACCESS_INDETERMINATE" | "FIELD_DYNAMIC_ACCESS_DECLARED" | "MISSING_DYNAMIC_ACCESS_CITATION" | "STALE_DYNAMIC_ACCESS_CITATION" | "UNRESOLVED_CONSUMER" | "INDETERMINATE_CONSUMER" | "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY" | "SENSITIVE_FIELD_ENDPOINT_MISSING_HANDLING"`
- `ReportFindingFamily` (typealias): `type ReportFindingFamily = "governance" | "structural" | "usage" | "citation" | "flow"`
- `ReportResult` (interface): `interface ReportResult`
- `ReportSeverity` (typealias): `type ReportSeverity = "info" | "warning" | "error"`
- `ResolvedGovernanceValue` (interface): `interface ResolvedGovernanceValue<T>`
- `RetentionEntry` (interface): `interface RetentionEntry`
- `RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION` (variable): `RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION = 1`
- `RuntimeContractModel` (interface): `interface RuntimeContractModel`
- `RuntimePolicyFact` (interface): `interface RuntimePolicyFact`
- `SarifLog` (interface): `interface SarifLog`
- `scanDependencies` (function): `function scanDependencies(files: readonly string[], targets: readonly ScanTarget[], options: ScanDependenciesOptions): Promise<ScanDependenciesResult>`
- `ScanDependenciesOptions` (interface): `interface ScanDependenciesOptions`
- `ScanDependenciesResult` (interface): `interface ScanDependenciesResult`
- `scanFileForUsage` (function): `function scanFileForUsage(sourceFile: TS.SourceFile, fromFile: string, matches: readonly ImportBindingMatch[]): readonly DependencyEdge[]`
- `ScanTarget` (interface): `interface ScanTarget`
- `SchemaRef` (typealias): `type SchemaRef = { readonly kind: "literal"; readonly node: TS.ObjectLiteralExpression; } | { readonly kind: "identifier"; readonly name: string; } | { readonly kind: "unresolvable"; readonly reason: string; }`
- `SourceLocation` (interface): `interface SourceLocation extends SourcePosition`
- `SourcePosition` (interface): `interface SourcePosition`
- `UNOWNED` (variable): `UNOWNED: string`
- `verifyDynamicAccessCitations` (function): `function verifyDynamicAccessCitations(inventory: CapabilityInventory, previousSnapshot: ManifestSnapshot | undefined, root: string, fs: BuildFileSystem): Promise<readonly ReportFinding[]>`
- `WithCapability` (interface): `interface WithCapability<T>`
- `writeEvidenceFingerprint` (function): `function writeEvidenceFingerprint(evidencePath: string, fingerprint: string, fs: BuildFileSystem): Promise<void>`

## `data-cap/node`

- `nodeBuildFileSystem` (variable): `nodeBuildFileSystem: BuildFileSystem`

## `data-cap/evidence`

- `defineEvidenceProjection` (function): `function defineEvidenceProjection<T extends Record<string, unknown>>(schema: EvidenceProjectionSchema<T>): EvidenceProjection<T>`
- `EvidenceModel` (interface): `interface EvidenceModel`
- `EvidenceProjection` (interface): `interface EvidenceProjection<T extends Record<string, unknown>>`
- `EvidenceProjectionResult` (interface): `interface EvidenceProjectionResult<T extends Record<string, unknown>>`
- `EvidenceProjectionSchema` (typealias): `type EvidenceProjectionSchema<T extends Record<string, unknown>> = { readonly [K in keyof T]: EvidenceProjector<T[K]>; }`
- `EvidenceProjector` (typealias): `type EvidenceProjector<T> = (evidence: EvidenceModel) => T`
- `EvidenceProvenance` (interface): `interface EvidenceProvenance`

## `data-cap/eslint-plugin`

- `noFieldsEscape` (variable): `noFieldsEscape: import("@typescript-eslint/utils/ts-eslint").RuleModule<"prop" | "spread" | "argument" | "exported", [RuleOptions], unknown, import("@typescript-eslint/utils/ts-eslint").RuleListener> & { name: string; }`
- `noNodeFs` (variable): `noNodeFs: import("@typescript-eslint/utils/ts-eslint").RuleModule<"noNodeFs", [import("../_ipc/no-node-fs.js").RuleOptions], unknown, import("@typescript-eslint/utils/ts-eslint").RuleListener> & { name: string; }`
- `noRawExternalIo` (variable): `noRawExternalIo: TSESLint.RuleModule<"noRawExternalIo", [RuleOptions], unknown, TSESLint.RuleListener> & { name: string; }`
- `plugin` (variable): `plugin: { rules: { "no-fields-escape": import("@typescript-eslint/utils/ts-eslint").RuleModule<"prop" | "spread" | "argument" | "exported", [import("./no-fields-escape.js").RuleOptions], unknown, import("@typescript-eslint/utils/ts-eslint").RuleListener> & { name: string; }; "no-node-fs": import("@typescript-eslint/utils/ts-eslint").RuleModule<"noNodeFs", [import("../_ipc/no-node-fs.js").RuleOptions], unknown, import("@typescript-eslint/utils/ts-eslint").RuleListener> & { name: string; }; "no-raw-external-io": import("@typescript-eslint/utils/ts-eslint").RuleModule<"noRawExternalIo", [import("./no-raw-external-io.js").RuleOptions], unknown, import("@typescript-eslint/utils/ts-eslint").RuleListener> & { name: string; }; "stable-operation-reference": import("@typescript-eslint/utils/ts-eslint").RuleModule<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, import("@typescript-eslint/utils/ts-eslint").RuleListener> & { name: string; }; }; }`
- `stableOperationReference` (variable): `stableOperationReference: TSESLint.RuleModule<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, TSESLint.RuleListener> & { name: string; }`
