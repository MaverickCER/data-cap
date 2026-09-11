import { describe, expect, it } from "vitest"
import {
  buildDependencyModel,
  DEPENDENCY_MODEL_SCHEMA_VERSION,
} from "../../src/build/dependency-model.js"
import type { DependencyEdge } from "../../src/build/dependency-types.js"

function edge(overrides: Partial<DependencyEdge> = {}): DependencyEdge {
  return {
    relationship: "reads-field",
    from: "/project/consumer.ts",
    to: {
      capability: { file: "/project/user.ts", exportName: "userCapability" },
      field: ["email"],
    },
    resolution: "resolved",
    position: { line: 1, column: 1 },
    ...overrides,
  }
}

describe("buildDependencyModel", () => {
  it("stamps schemaVersion and carries the raw edges array through unchanged (ADR 0056: edges is the model's only stored fact)", () => {
    const edges = [edge()]
    const model = buildDependencyModel(edges)
    expect(model.schemaVersion).toBe(DEPENDENCY_MODEL_SCHEMA_VERSION)
    expect(model.edges).toBe(edges)
  })

  it("carries an empty edges array through unchanged", () => {
    const model = buildDependencyModel([])
    expect(model.edges).toEqual([])
  })
})
