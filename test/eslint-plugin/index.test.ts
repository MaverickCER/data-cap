import { describe, expect, it } from "vitest"
import plugin, {
  noFieldsEscape,
  noNodeFs,
  noRawExternalIo,
  stableOperationReference,
} from "../../src/eslint-plugin/index.js"

describe("eslint-plugin public exports", () => {
  it("exposes a flat-config-shaped plugin object with every rule keyed by its flat-config name", () => {
    expect(plugin.rules["stable-operation-reference"]).toBe(stableOperationReference)
    expect(plugin.rules["no-raw-external-io"]).toBe(noRawExternalIo)
    expect(plugin.rules["no-node-fs"]).toBe(noNodeFs)
    expect(plugin.rules["no-fields-escape"]).toBe(noFieldsEscape)
  })

  it("also exposes each rule as a named export", () => {
    expect(stableOperationReference).toBeDefined()
    expect(stableOperationReference.meta.type).toBe("suggestion")
    expect(noRawExternalIo).toBeDefined()
    expect(noNodeFs).toBeDefined()
    expect(noFieldsEscape).toBeDefined()
    // "problem", not "suggestion": a library surface acquiring node:fs
    // isn't a style preference (ADR 0058).
    expect(noNodeFs.meta.type).toBe("problem")
    // "problem", not "suggestion": raw external I/O outside a capability
    // isn't a style preference, it's data acquisition the whole analysis
    // layer is blind to -- same severity class as env-cap's own
    // `no-raw-process-env`.
    expect(noRawExternalIo.meta.type).toBe("problem")
    // "problem", not "suggestion": a capability's fields escaping whole is
    // the exact escape ADR 0060 documents the build-time scanner losing
    // field-level provability over, not a style preference.
    expect(noFieldsEscape.meta.type).toBe("problem")
  })

  it("gives every rule at least one message id (a specific diagnostic each)", () => {
    for (const rule of Object.values(plugin.rules)) {
      expect(Object.keys(rule.meta.messages).length).toBeGreaterThan(0)
    }
    expect(Object.keys(noRawExternalIo.meta.messages)).toEqual(["noRawExternalIo"])
    // Four distinct, specific diagnostics -- one per escape shape -- not
    // one generic "escape detected" message.
    expect(new Set(Object.keys(noFieldsEscape.meta.messages))).toEqual(
      new Set(["spread", "argument", "prop", "exported"]),
    )
  })
})
