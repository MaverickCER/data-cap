// Hand-written type declaration for generate-json-schema.mjs, kept as plain,
// dependency-free-at-runtime JS. Exists purely so test/build/json-schema.test.ts
// gets real type-checking instead of treating the import as `any`; not
// shipped (outside `files` in package.json) and never affects the published
// package's types.

export interface SchemaTarget {
  readonly name: string
  readonly sourceFile: string
  readonly type: string
  readonly outputFile: string
  readonly id: string
  readonly title: string
  readonly description: string
}

export function generateSchema(target: SchemaTarget): object
export function generateReportSchema(): object
export function generateCapabilityModelSchema(): object
export function generateDependencyModelSchema(): object
export function generateOwnershipModelSchema(): object
export function generateLifecycleModelSchema(): object
export function generateFindingModelSchema(): object
export function generateChangeModelSchema(): object
export function generateRuntimeContractModelSchema(): object
export function generateEvidenceModelSchema(): object
