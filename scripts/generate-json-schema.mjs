#!/usr/bin/env node
// Generates schemas/*.schema.json directly from their source types -- never
// hand-authored, so a schema and the type it describes cannot silently drift
// apart. Regenerated as part of `npm run verify`; each schema's own test
// (e.g. test/build/json-schema.test.ts, test/build/capability-model-json-schema.test.ts)
// fails the build if its committed file is stale relative to a fresh
// generation. See ADR 0050 (one target per canonical fact model, added
// incrementally as each model ships), ported from env-cap's own
// already-generalized `scripts/generate-json-schema.mjs`.

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createGenerator } from "ts-json-schema-generator"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// TSDoc `{@link Target}`/`{@link Target|label}` tags are meant for TypeDoc to resolve into
// hyperlinks (see typedoc.json) -- ts-json-schema-generator has no such resolution and would
// otherwise emit the raw `{@link ...}` tag text verbatim into a schema's "description"
// fields, which are read by external tools/humans with no TSDoc awareness.
function stripLinkTags(value) {
  return value
    .replace(/\{@link\s+([^\s}|]+)(?:\s*\|\s*([^}]+))?\s*\}/g, (_match, target, label) =>
      (label ?? target).trim(),
    )
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([).,;:])/g, "$1")
}

function stripLinkTagsDeep(value) {
  if (typeof value === "string") return stripLinkTags(value)
  if (Array.isArray(value)) return value.map(stripLinkTagsDeep)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, stripLinkTagsDeep(entry)]),
    )
  }
  return value
}

// One entry per published schema. Adding a new fact model's schema means
// adding one entry here -- everything else (generation, writing, freshness
// checking) is shared.
const TARGETS = [
  {
    name: "data-cap-report",
    sourceFile: "src/cli/json.ts",
    type: "JsonReportPayload",
    outputFile: "schemas/data-cap-report.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/data-cap-report.schema.json",
    title: "data-cap --json report",
    description:
      "Machine-readable envelope emitted by `data-cap --json` (see README's CLI section). " +
      "Generated from src/cli/json.ts's JsonReportPayload type -- never hand-authored. " +
      "Embeds the composed Evidence Model (see evidence-model.schema.json) as its own " +
      "`evidence` field -- this envelope is the CLI run's own summary (files written, " +
      "finding counts), not a competing canonical model.",
  },
  {
    name: "capability-model",
    sourceFile: "src/build/inventory.ts",
    type: "CapabilityInventory",
    outputFile: "schemas/capability-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/capability-model.schema.json",
    title: "data-cap Capability Model",
    description:
      "Canonical, versioned projection of every discovered capability's fields and operations " +
      "(see ADR 0050). Generated from src/build/inventory.ts's CapabilityInventory type -- never hand-authored.",
  },
  {
    name: "dependency-model",
    sourceFile: "src/build/dependency-model.ts",
    type: "DependencyModel",
    outputFile: "schemas/dependency-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/dependency-model.schema.json",
    title: "data-cap Dependency Model",
    description:
      "Canonical, versioned projection of every statically-proven consumer relationship, indexed " +
      "by capability and by consuming file (see ADR 0050). Generated from " +
      "src/build/dependency-model.ts's DependencyModel type -- never hand-authored.",
  },
  {
    name: "ownership-model",
    sourceFile: "src/build/ownership-model.ts",
    type: "OwnershipModel",
    outputFile: "schemas/ownership-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/ownership-model.schema.json",
    title: "data-cap Ownership Model",
    description:
      "Canonical, versioned owner -> {capabilities, fields} matrix (see ADR 0050). Generated from " +
      "src/build/ownership-model.ts's OwnershipModel type -- never hand-authored.",
  },
  {
    name: "lifecycle-model",
    sourceFile: "src/build/lifecycle-model.ts",
    type: "LifecycleModel",
    outputFile: "schemas/lifecycle-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/lifecycle-model.schema.json",
    title: "data-cap Lifecycle Model",
    description:
      "Canonical, versioned projection of every capability's and field's declared lifecycle data " +
      "(expiry, deprecation, removal deadline, rename correlation), plus the expiring-soon view. " +
      "Generated from src/build/lifecycle-model.ts's LifecycleModel type -- never hand-authored.",
  },
  {
    name: "finding-model",
    sourceFile: "src/build/finding-model.ts",
    type: "FindingModel",
    outputFile: "schemas/finding-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/finding-model.schema.json",
    title: "data-cap Finding Model",
    description:
      "Canonical, versioned list of every finding, each with a structured, pre-computed `location` " +
      "(see ADR 0050). Generated from src/build/finding-model.ts's FindingModel type -- never hand-authored.",
  },
  {
    name: "change-model",
    sourceFile: "src/build/change-model.ts",
    type: "ChangeModel",
    outputFile: "schemas/change-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/change-model.schema.json",
    title: "data-cap Change Model",
    description:
      "Canonical, versioned manifest diff plus an optional blast-radius index (see ADR 0050). " +
      "Generated from src/build/change-model.ts's ChangeModel type -- never hand-authored.",
  },
  {
    name: "runtime-contract-model",
    sourceFile: "src/build/runtime-contract-model.ts",
    type: "RuntimeContractModel",
    outputFile: "schemas/runtime-contract-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/runtime-contract-model.schema.json",
    title: "data-cap Runtime Contract Model",
    description:
      "Canonical, versioned, package-level (not per-project) description of data-cap's own " +
      "documented execution guarantees (see ADR 0050). Generated from " +
      "src/build/runtime-contract-model.ts's RuntimeContractModel type -- never hand-authored.",
  },
  {
    name: "flow-model",
    sourceFile: "src/flow/flow-model.ts",
    type: "FlowModel",
    outputFile: "schemas/flow-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/flow-model.schema.json",
    title: "data-cap Flow Model",
    description:
      "Canonical, versioned function-level, field-sensitive data-flow facts (nodes, edges, explicit " +
      "unknowns and a coverage summary), each with an epistemic status (see ADR 0070, ADR 0071). " +
      "Generated from src/flow/flow-model.ts's FlowModel type -- never hand-authored.",
  },
  {
    name: "policy-model",
    sourceFile: "src/flow/policy-model.ts",
    type: "PolicyModel",
    outputFile: "schemas/policy-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/policy-model.schema.json",
    title: "data-cap Policy Model",
    description:
      "Canonical, versioned declared data-flow rules and their evaluation results against the Flow " +
      "Model (see ADR 0070). Generated from src/flow/policy-model.ts's PolicyModel type -- never hand-authored.",
  },
  {
    name: "observation-model",
    sourceFile: "src/flow/observation-model.ts",
    type: "ObservationModel",
    outputFile: "schemas/observation-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/observation-model.schema.json",
    title: "data-cap Observation Model",
    description:
      "Canonical, versioned runtime observations: which field names were seen at which boundaries in " +
      "which scopes -- names and paths only, never values (see ADR 0070, ADR 0072). Generated from " +
      "src/flow/observation-model.ts's ObservationModel type -- never hand-authored.",
  },
  {
    name: "claims-model",
    sourceFile: "src/flow/claims-model.ts",
    type: "ClaimsModel",
    outputFile: "schemas/claims-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/claims-model.schema.json",
    title: "data-cap Claims Model",
    description:
      "Canonical, versioned claims with supporting and contradicting evidence, scope and a derived " +
      "verification status (see ADR 0070, ADR 0071). Generated from src/flow/claims-model.ts's " +
      "ClaimsModel type -- never hand-authored.",
  },
  {
    name: "evidence-model",
    sourceFile: "src/build/evidence-model.ts",
    type: "EvidenceModel",
    outputFile: "schemas/evidence-model.schema.json",
    id: "https://maverickcer.github.io/data-cap/schema/evidence-model.schema.json",
    title: "data-cap Evidence Model",
    description:
      "Canonical, versioned composition of Capability/Lifecycle/Dependency/Ownership/Finding/Change/" +
      "Flow/Policy/Observation/Claims/Runtime Contract Model into one provenance-stamped artifact " +
      "(see ADR 0050, ADR 0070). Generated from " +
      "src/build/evidence-model.ts's EvidenceModel type -- never hand-authored.",
  },
]

export function generateSchema(target) {
  const config = {
    path: path.join(root, target.sourceFile),
    tsconfig: path.join(root, "tsconfig.json"),
    type: target.type,
    expose: "export",
    jsDoc: "extended",
    skipTypeCheck: false,
  }

  const schema = stripLinkTagsDeep(createGenerator(config).createSchema(config.type))
  return {
    $schema: schema.$schema,
    $id: target.id,
    title: target.title,
    description: target.description,
    ...schema,
  }
}

function targetNamed(name) {
  const target = TARGETS.find((t) => t.name === name)
  if (!target) throw new Error(`No schema target named "${name}"`)
  return target
}

export function generateReportSchema() {
  return generateSchema(targetNamed("data-cap-report"))
}

export function generateCapabilityModelSchema() {
  return generateSchema(targetNamed("capability-model"))
}

export function generateDependencyModelSchema() {
  return generateSchema(targetNamed("dependency-model"))
}

export function generateOwnershipModelSchema() {
  return generateSchema(targetNamed("ownership-model"))
}

export function generateLifecycleModelSchema() {
  return generateSchema(targetNamed("lifecycle-model"))
}

export function generateFindingModelSchema() {
  return generateSchema(targetNamed("finding-model"))
}

export function generateChangeModelSchema() {
  return generateSchema(targetNamed("change-model"))
}

export function generateRuntimeContractModelSchema() {
  return generateSchema(targetNamed("runtime-contract-model"))
}

export function generateFlowModelSchema() {
  return generateSchema(targetNamed("flow-model"))
}

export function generatePolicyModelSchema() {
  return generateSchema(targetNamed("policy-model"))
}

export function generateObservationModelSchema() {
  return generateSchema(targetNamed("observation-model"))
}

export function generateClaimsModelSchema() {
  return generateSchema(targetNamed("claims-model"))
}

export function generateEvidenceModelSchema() {
  return generateSchema(targetNamed("evidence-model"))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const target of TARGETS) {
    const schema = generateSchema(target)
    const outPath = path.join(root, target.outputFile)
    mkdirSync(path.dirname(outPath), { recursive: true })
    writeFileSync(outPath, `${JSON.stringify(schema, null, 2)}\n`, "utf8")
    console.log(`[schema] wrote ${path.relative(root, outPath)}`)
  }
}
