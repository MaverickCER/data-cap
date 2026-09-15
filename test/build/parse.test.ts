import ts from "typescript"
import { describe, expect, it } from "vitest"
import {
  collectImportBindings,
  extractCapabilityDocs,
  extractFieldsRef,
  extractOperationNames,
  extractSectionNames,
  hasExportModifier,
  isCallToName,
  isDataFlowDirection,
  isDataFlowEndpointKind,
  isDataFlowHandlingValue,
  isDynamicAccessCitation,
  parseCapabilityFile,
  readBooleanProp,
  readDataFlowEndpoint,
  readDataResidencyProp,
  readDynamicAccessCitations,
  readEndpointsProp,
  readMetadataProp,
  readStringProp,
} from "../../src/build/parse.js"
import type { ImportBinding, ParseWarning } from "../../src/build/parse.js"

describe("parseCapabilityFile -- createData discovery", () => {
  it("finds an exported createData() call and its inline fields object literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userCapability = createData({ fields: { id: "", email: "" } });`,
    )
    expect(result.createDataCalls).toHaveLength(1)
    const call = result.createDataCalls[0]!
    expect(call.exportName).toBe("userCapability")
    expect(call.fieldsRef.kind).toBe("literal")
    // An exported capability never draws a "not exported" warning.
    expect(result.warnings).toEqual([])
  })

  it("ignores a createData() call bound by a destructuring pattern (name is not a plain identifier)", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const [cap] = [createData({ fields: {} })];`,
    )
    expect(result.createDataCalls).toHaveLength(0)
  })

  it("ignores a declaration with no initializer at all", () => {
    const result = parseCapabilityFile("/project/user.ts", `export let pending: number;`)
    expect(result.createDataCalls).toHaveLength(0)
    expect(result.documentDataCalls).toHaveLength(0)
  })

  it("does not record an unrelated bare top-level call as a documentData() call", () => {
    const result = parseCapabilityFile("/project/user.ts", `configureSomething({ a: 1 });`)
    expect(result.documentDataCalls).toHaveLength(0)
  })

  it("does not record an unrelated createData-assigned-then-not call form", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const x = notCreateData({ fields: {} });\ndocumentDataLike({}, {});`,
    )
    expect(result.createDataCalls).toHaveLength(0)
    expect(result.documentDataCalls).toHaveLength(0)
  })

  it("recognizes a namespace-qualified call (dataCap.createData(...))", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `import * as dataCap from "data-cap";\nexport const userCapability = dataCap.createData({ fields: {} });`,
    )
    expect(result.createDataCalls).toHaveLength(1)
  })

  it("warns and still records the call when createData() is not exported", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const userCapability = createData({ fields: {} });`,
    )
    expect(result.createDataCalls).toHaveLength(1)
    expect(result.createDataCalls[0]!.exportName).toBeUndefined()
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.message).toContain("not exported")
  })

  it("resolves fields ref as an identifier when fields references a local const", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const userFields = { id: "" };\nexport const userCapability = createData({ fields: userFields });`,
    )
    const call = result.createDataCalls[0]!
    expect(call.fieldsRef).toEqual({ kind: "identifier", name: "userFields" })
  })

  it("marks fields ref unresolvable when the call has no arguments", () => {
    const result = parseCapabilityFile("/project/user.ts", `export const x = createData();`)
    expect(result.createDataCalls[0]!.fieldsRef.kind).toBe("unresolvable")
  })

  it("marks fields ref unresolvable when the config isn't an inline object literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const x = createData(someConfigVariable);`,
    )
    expect(result.createDataCalls[0]!.fieldsRef.kind).toBe("unresolvable")
  })

  it("marks fields ref unresolvable when the config object has no 'fields' property", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const x = createData({ notFields: {} });`,
    )
    expect(result.createDataCalls[0]!.fieldsRef.kind).toBe("unresolvable")
  })

  it("resolves the config through ONE level of identifier indirection -- the whole schema shared as a local const, not just its own 'fields' property", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      [
        `const userSchema = {`,
        `  fields: { id: "" },`,
        `  getters: { getUser: { execute: async () => ({}), processor: (r) => r, writes: { id: true } } },`,
        `};`,
        `export const userCapability = createData(userSchema);`,
      ].join("\n"),
    )
    const call = result.createDataCalls[0]!
    expect(call.fieldsRef.kind).toBe("literal")
    expect(call.operationNames?.getters).toEqual(["getUser"])
  })

  it("still reports unresolvable when the identifier doesn't resolve to any local const at all", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const x = createData(someConfigVariable);`,
    )
    expect(result.createDataCalls[0]!.fieldsRef.kind).toBe("unresolvable")
  })

  it("still reports unresolvable when the identifier resolves to something other than an object literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const userSchema = someFactory();\nexport const x = createData(userSchema);`,
    )
    expect(result.createDataCalls[0]!.fieldsRef.kind).toBe("unresolvable")
  })

  it("does not discover a call nested inside a function body (top-level statements only)", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `function makeCapability() {\n  return createData({ fields: {} });\n}`,
    )
    expect(result.createDataCalls).toHaveLength(0)
  })

  it("does not confuse an unrelated function also named createData-like but different", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const x = createSomethingElse({ fields: {} });`,
    )
    expect(result.createDataCalls).toHaveLength(0)
  })

  it("tracks every top-level const, not just createData/documentData calls, for later identifier resolution", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const shared = { a: 1 };\nconst other = 5;`,
    )
    expect(result.localConsts.get("shared")).toBeDefined()
    expect(result.localConsts.get("other")).toBeDefined()
  })
})

describe("parseCapabilityFile -- declarationPosition/fieldPositions (ADR 0052)", () => {
  it("reports the call's own declaration position, always", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `// a leading comment\nexport const userCapability = createData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls[0]!.declarationPosition).toEqual({ line: 2, column: 31 })
  })

  it("reports each top-level field's own key position when fields is an inline literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userCapability = createData({ fields: {\n  id: "",\n  email: "",\n} });`,
    )
    expect(result.createDataCalls[0]!.fieldPositions).toEqual({
      id: { line: 2, column: 3 },
      email: { line: 3, column: 3 },
    })
  })

  it("leaves fieldPositions undefined when fields is identifier-resolved -- never guessed at across a file boundary this pass doesn't retain AST access to", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const userFields = { id: "" };\nexport const userCapability = createData({ fields: userFields });`,
    )
    expect(result.createDataCalls[0]!.fieldsRef.kind).toBe("identifier")
    expect(result.createDataCalls[0]!.fieldPositions).toBeUndefined()
  })

  it("leaves fieldPositions undefined when fields is unresolvable", () => {
    const result = parseCapabilityFile("/project/user.ts", `export const x = createData();`)
    expect(result.createDataCalls[0]!.fieldPositions).toBeUndefined()
  })

  it("skips a non-statically-named field key rather than guessing at its position", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userCapability = createData({ fields: { [computedKey]: "", id: "" } });`,
    )
    expect(Object.keys(result.createDataCalls[0]!.fieldPositions ?? {})).toEqual(["id"])
  })

  it("skips a spread element in fields (never a property assignment) but still reports a shorthand property's position", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const shared = { a: "" };\nexport const userCapability = createData({ fields: { ...shared, id } });`,
    )
    // `id` here is shorthand (`{ id }`, sugar for `{ id: id }`) -- a real,
    // statically-named field key, distinct from the spread it follows.
    expect(Object.keys(result.createDataCalls[0]!.fieldPositions ?? {})).toEqual(["id"])
  })
})

describe("parseCapabilityFile -- documentData discovery", () => {
  it("finds a bare top-level documentData() call", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `documentData({ fields: { id: "" } }, { name: "user" });`,
    )
    expect(result.documentDataCalls).toHaveLength(1)
    expect(result.documentDataCalls[0]!.fieldsRef.kind).toBe("literal")
  })

  it("finds documentData() assigned to a variable too", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const ignoredResult = documentData({ fields: {} }, {});`,
    )
    expect(result.documentDataCalls).toHaveLength(1)
  })

  it("resolves documentData()'s own config through the same identifier indirection createData gets -- the whole schema shared as one local const", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      [
        `const userSchema = { fields: { id: "" } };`,
        `export const userCapability = createData(userSchema);`,
        `documentData(userSchema, { name: "user" });`,
      ].join("\n"),
    )
    expect(result.documentDataCalls[0]!.fieldsRef.kind).toBe("literal")
  })

  it("captures the docs argument node for later structural inspection", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `documentData({ fields: {} }, { name: "user", description: "A user." });`,
    )
    const docsNode = result.documentDataCalls[0]!.docsNode
    expect(docsNode).toBeDefined()
    expect(docsNode && ts.isObjectLiteralExpression(docsNode)).toBe(true)
  })
})

describe("parseCapabilityFile -- import binding collection", () => {
  it("produces EXACTLY the expected bindings (no phantom seed entries), in source order", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      [
        `import defaultThing, { a, b as bb } from "./one.js";`,
        `import * as ns from "./two.js";`,
        `import "./side-effect.js";`,
      ].join("\n"),
    )
    expect(result.imports).toEqual([
      { localName: "defaultThing", importedName: "default", moduleSpecifier: "./one.js" },
      { localName: "a", importedName: "a", moduleSpecifier: "./one.js" },
      { localName: "bb", importedName: "b", moduleSpecifier: "./one.js" },
      { localName: "ns", importedName: "*", moduleSpecifier: "./two.js" },
    ])
  })

  it("records nothing for a bare side-effect import (no import clause)", () => {
    const result = parseCapabilityFile("/project/user.ts", `import "./side-effect.js";`)
    expect(result.imports).toEqual([])
  })

  it("collects a named import", () => {
    const result = parseCapabilityFile("/project/user.ts", `import { createData } from "data-cap";`)
    expect(result.imports).toContainEqual({
      localName: "createData",
      importedName: "createData",
      moduleSpecifier: "data-cap",
    })
  })

  it("collects a renamed named import, tracking both the local and imported names", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `import { createData as makeData } from "data-cap";`,
    )
    expect(result.imports).toContainEqual({
      localName: "makeData",
      importedName: "createData",
      moduleSpecifier: "data-cap",
    })
  })

  it("collects a default import", () => {
    const result = parseCapabilityFile("/project/user.ts", `import dataCap from "data-cap";`)
    expect(result.imports).toContainEqual({
      localName: "dataCap",
      importedName: "default",
      moduleSpecifier: "data-cap",
    })
  })

  it("collects a namespace import", () => {
    const result = parseCapabilityFile("/project/user.ts", `import * as dataCap from "data-cap";`)
    expect(result.imports).toContainEqual({
      localName: "dataCap",
      importedName: "*",
      moduleSpecifier: "data-cap",
    })
  })

  it("collects a relative import specifier", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `import { userFields } from "./shared.js";`,
    )
    expect(result.imports).toContainEqual({
      localName: "userFields",
      importedName: "userFields",
      moduleSpecifier: "./shared.js",
    })
  })
})

describe("parseCapabilityFile -- buildData()/createData() kind and operation names", () => {
  it('recognizes buildData() the same way as createData() for fields extraction, tagged with kind: "buildData"', () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userCapability = buildData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls).toHaveLength(1)
    const call = result.createDataCalls[0]!
    expect(call.kind).toBe("buildData")
    expect(call.fieldsRef.kind).toBe("literal")
    // buildData never has an operations section -- never populated.
    expect(call.operationNames).toBeUndefined()
  })

  it('tags a createData() call with kind: "createData"', () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userData = createData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls[0]!.kind).toBe("createData")
  })

  it("extracts static getter/mutator/subscription names from a createData() call, never evaluating their bodies", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: { execute: getUser, writes: { id: true } } },
        mutators: { updateUser: { execute: updateUser } },
        subscriptions: { subscribeToUser: { subscribe: subscribeToUser, writes: { id: true } } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationNames).toEqual({
      getters: ["getUser"],
      mutators: ["updateUser"],
      subscriptions: ["subscribeToUser"],
    })
  })

  it("a createData() call with no getters/mutators/subscriptions still gets an operationNames catalog, with empty arrays", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userData = createData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls[0]!.operationNames).toEqual({
      getters: [],
      mutators: [],
      subscriptions: [],
    })
  })

  it("recognizes multiple getter/mutator/subscription names, in declared order, quoted keys included", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: {},
        getters: { getUser: {}, "getPost": {} },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationNames?.getters).toEqual(["getUser", "getPost"])
  })

  it("does not evaluate operation bodies -- a getter's execute/processor function is never inspected, only its key name is recorded", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: {},
        getters: { getUser: { execute: () => { throw new Error("never runs, only parsed") } } },
      });
      `,
    )
    // Parsing this file never throws or evaluates the arrow function body --
    // only its enclosing key name ("getUser") is ever read.
    expect(result.createDataCalls[0]!.operationNames?.getters).toEqual(["getUser"])
  })
})

describe("parseCapabilityFile -- operation writes extraction", () => {
  it("extracts a literal boolean writes shape", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: { execute: getUser, writes: true } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.getters).toEqual([
      { name: "getUser", writes: true },
    ])
  })

  it("extracts a nested object writes shape", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { user: { name: "", email: "" } },
        mutators: { updateEmail: { execute: updateEmail, writes: { user: { email: true } } } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.mutators).toEqual([
      { name: "updateEmail", writes: { user: { email: true } } },
    ])
  })

  it("defaults an absent writes on a mutator to true (ADR 0011 implicit full-capability ownership)", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        mutators: { updateUser: { execute: updateUser } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.mutators).toEqual([
      { name: "updateUser", writes: true },
    ])
  })

  it("leaves an absent writes on a getter/subscription as undefined -- never guessed", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: { execute: getUser } },
        subscriptions: { subscribeToUser: { subscribe: subscribeToUser } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.getters).toEqual([
      { name: "getUser", writes: undefined },
    ])
    expect(result.createDataCalls[0]!.operationWrites?.subscriptions).toEqual([
      { name: "subscribeToUser", writes: undefined },
    ])
  })

  it("warns and leaves writes undefined when the value isn't a statically-resolvable literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: { execute: getUser, writes: someComputedShape } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.getters).toEqual([
      { name: "getUser", writes: undefined },
    ])
    // Names the exact section + operation this unresolved "writes" belongs
    // to, not just the generic "writes" word.
    expect(result.warnings.some((w) => w.message.includes('"getters.getUser"'))).toBe(true)
  })

  it("never applies the mutator ADR-0011 default to an UNRESOLVABLE writes -- only a genuinely ABSENT one", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        mutators: { updateUser: { execute: updateUser, writes: someComputedShape } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.mutators).toEqual([
      { name: "updateUser", writes: undefined },
    ])
  })

  it("skips a non-statically-named getter key within the section, keeping every real one", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: {
          getUser: { execute: getUser, writes: true },
          [computedName]: { execute: getOther, writes: true },
        },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.getters).toEqual([
      { name: "getUser", writes: true },
    ])
  })

  it("skips a spread element within a section (never a property assignment at all), keeping every real one", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      const shared = { extraGetter: { execute: getExtra, writes: true } };
      export const userData = createData({
        fields: { id: "" },
        getters: {
          getUser: { execute: getUser, writes: true },
          ...shared,
        },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.getters).toEqual([
      { name: "getUser", writes: true },
    ])
  })

  it("warns and leaves writes undefined when the operation entry itself isn't an inline object literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: someFactory() },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationWrites?.getters).toEqual([
      { name: "getUser", writes: undefined },
    ])
    expect(result.warnings.some((w) => w.message.includes("getters.getUser"))).toBe(true)
  })

  it("returns undefined operationWrites for a buildData() call (no operations section)", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userCapability = buildData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls[0]!.operationWrites).toBeUndefined()
  })

  it("returns empty arrays when a section is absent entirely", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userData = createData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls[0]!.operationWrites).toEqual({
      getters: [],
      mutators: [],
      subscriptions: [],
    })
  })
})

describe("parseCapabilityFile -- operation presence extraction (hasProcessor/hasOptimistic)", () => {
  it("detects a declared processor key without evaluating it", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: { execute: getUser, processor: () => { throw new Error("never runs") } } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationPresence?.getters).toEqual([
      { name: "getUser", hasProcessor: true, hasOptimistic: false },
    ])
  })

  it("detects a declared optimistic key on a mutator", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        mutators: { updateUser: { execute: updateUser, optimistic: () => ({}) } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationPresence?.mutators).toEqual([
      { name: "updateUser", hasProcessor: false, hasOptimistic: true },
    ])
  })

  it("reports both false when neither key is declared", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: { execute: getUser } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationPresence?.getters).toEqual([
      { name: "getUser", hasProcessor: false, hasOptimistic: false },
    ])
  })

  it("also extracts presence for the subscriptions section, not just getters/mutators", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        subscriptions: { subscribeToUser: { subscribe: subscribeToUser, processor: (e) => e } },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationPresence?.subscriptions).toEqual([
      { name: "subscribeToUser", hasProcessor: true, hasOptimistic: false },
    ])
  })

  it("reports both false, without a warning, when the operation entry isn't an inline object literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `
      export const userData = createData({
        fields: { id: "" },
        getters: { getUser: someFactory() },
      });
      `,
    )
    expect(result.createDataCalls[0]!.operationPresence?.getters).toEqual([
      { name: "getUser", hasProcessor: false, hasOptimistic: false },
    ])
  })

  it("returns undefined operationPresence for a buildData() call (no operations section)", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `export const userCapability = buildData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls[0]!.operationPresence).toBeUndefined()
  })
})

/** Parses a bare `documentData({fields: {}}, <docsExpr>)` statement and returns its raw docs AST node. */
function docsNodeFrom(docsExpr: string): ts.Expression | undefined {
  const result = parseCapabilityFile(
    "/project/user.ts",
    `documentData({ fields: {} }, ${docsExpr});`,
  )
  return result.documentDataCalls[0]!.docsNode
}

function extract(docsExpr: string, warnings: ParseWarning[] = []) {
  return extractCapabilityDocs(
    docsNodeFrom(docsExpr),
    "userCapability",
    "/project/user.ts",
    warnings,
  )
}

describe("extractCapabilityDocs", () => {
  it("returns undefined when docsNode is undefined", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const x = documentData({ fields: {} });`,
    )
    expect(
      extractCapabilityDocs(result.documentDataCalls[0]!.docsNode, "x", "/project/user.ts", []),
    ).toBeUndefined()
  })

  it("returns undefined when docsNode is not an inline object literal", () => {
    const result = parseCapabilityFile(
      "/project/user.ts",
      `const sharedDocs = {};\ndocumentData({ fields: {} }, sharedDocs);`,
    )
    expect(
      extractCapabilityDocs(result.documentDataCalls[0]!.docsNode, "x", "/project/user.ts", []),
    ).toBeUndefined()
  })

  it("extracts every capability-level string/boolean/record field from literal values", () => {
    const docs = extract(`{
      name: "user",
      description: "The user capability.",
      owner: "identity-team",
      category: "identity",
      exclusiveGroup: "user-backend",
      active: false,
      sensitivity: "restricted",
      protections: "encrypted at rest",
      retention: "90 days",
      metadata: { regulatory: "GDPR" },
    }`)
    expect(docs).toEqual({
      name: "user",
      description: "The user capability.",
      owner: "identity-team",
      category: "identity",
      exclusiveGroup: "user-backend",
      active: false,
      sensitivity: "restricted",
      protections: "encrypted at rest",
      retention: "90 days",
      metadata: { regulatory: "GDPR" },
      fields: undefined,
      getters: undefined,
      mutators: undefined,
      subscriptions: undefined,
    })
  })

  it("extracts a fully-populated docs object verbatim -- every key, every section (pins the property-name literals)", () => {
    const warnings: ParseWarning[] = []
    const docs = extract(
      `{
        name: "userCap",
        description: "desc",
        owner: "team-a",
        category: "identity",
        exclusiveGroup: "grp",
        active: true,
        sensitivity: "restricted",
        protections: "prot",
        retention: "ret",
        purpose: "purp",
        legalBasis: "lb",
        dataResidency: ["us", "eu"],
        auditRequired: true,
        expiresAt: "2030-01-01",
        deprecated: true,
        deprecatedReason: "dep",
        metadata: { m: 1 },
        evidence: { fields: { email: { dynamicAccess: ["src/x.ts:1:2"] } } },
        fields: {
          email: {
            description: "fd",
            owner: "fo",
            sensitivity: "fs",
            protections: "fp",
            retention: "fr",
            purpose: "fpu",
            legalBasis: "flb",
            dataResidency: "us",
            auditRequired: false,
            expiresAt: "2031-02-02",
            deprecated: false,
            deprecatedReason: "fdr",
            removeBy: "2032-03-03",
            renamedFrom: "e_mail",
            metadata: { fm: 2 },
          },
        },
        getters: { getUser: { description: "gd", source: "gs", credentials: "gc", endpoints: [{ direction: "input", kind: "api", name: "svc" }], metadata: { gm: 3 } } },
        mutators: { setUser: { description: "md", source: "ms", credentials: "mc", metadata: { mm: 4 } } },
        subscriptions: { onUser: { description: "sd", source: "ss", credentials: "sc", metadata: { sm: 5 } } },
      }`,
      warnings,
    )
    expect(warnings).toEqual([])
    expect(docs).toEqual({
      name: "userCap",
      description: "desc",
      owner: "team-a",
      category: "identity",
      exclusiveGroup: "grp",
      active: true,
      sensitivity: "restricted",
      protections: "prot",
      retention: "ret",
      purpose: "purp",
      legalBasis: "lb",
      dataResidency: ["us", "eu"],
      auditRequired: true,
      expiresAt: "2030-01-01",
      deprecated: true,
      deprecatedReason: "dep",
      metadata: { m: 1 },
      evidence: { fields: { email: { dynamicAccess: ["src/x.ts:1:2"] } } },
      fields: {
        email: {
          description: "fd",
          owner: "fo",
          sensitivity: "fs",
          protections: "fp",
          retention: "fr",
          purpose: "fpu",
          legalBasis: "flb",
          dataResidency: "us",
          auditRequired: false,
          expiresAt: "2031-02-02",
          deprecated: false,
          deprecatedReason: "fdr",
          removeBy: "2032-03-03",
          renamedFrom: "e_mail",
          metadata: { fm: 2 },
        },
      },
      getters: {
        getUser: {
          description: "gd",
          source: "gs",
          credentials: "gc",
          endpoints: [{ direction: "input", kind: "api", name: "svc" }],
          metadata: { gm: 3 },
        },
      },
      mutators: {
        setUser: {
          description: "md",
          source: "ms",
          credentials: "mc",
          endpoints: undefined,
          metadata: { mm: 4 },
        },
      },
      subscriptions: {
        onUser: {
          description: "sd",
          source: "ss",
          credentials: "sc",
          endpoints: undefined,
          metadata: { sm: 5 },
        },
      },
    })
  })

  it("active defaults to undefined (not false) when omitted -- callers apply the true default themselves", () => {
    const docs = extract(`{ name: "user" }`)
    expect(docs?.active).toBeUndefined()
  })

  it("warns and omits a non-string-literal value for a string field (owner)", () => {
    const warnings: ParseWarning[] = []
    const docs = extract(`{ owner: someVariable }`, warnings)
    expect(docs?.owner).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('"owner"')
    expect(warnings[0]!.message).toContain("userCapability")
  })

  it("warns with the full contextLabel.sectionLabel.key label for a bad operation-docs field", () => {
    const warnings: ParseWarning[] = []
    const docs = extract(`{ getters: { getUser: { description: someVariable } } }`, warnings)
    expect(docs?.getters?.["getUser"]?.description).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toContain('"userCapability.getters.getUser"')
  })

  it('uses "mutators" (not "getters") in the label for a bad mutators-docs field', () => {
    const warnings: ParseWarning[] = []
    extract(`{ mutators: { updateUser: { description: someVariable } } }`, warnings)
    expect(warnings[0]!.message).toContain('"userCapability.mutators.updateUser"')
  })

  it('uses "subscriptions" (not "getters") in the label for a bad subscriptions-docs field', () => {
    const warnings: ParseWarning[] = []
    extract(`{ subscriptions: { onUser: { description: someVariable } } }`, warnings)
    expect(warnings[0]!.message).toContain('"userCapability.subscriptions.onUser"')
  })

  it("warns and omits a non-boolean-literal value for active", () => {
    const warnings: ParseWarning[] = []
    const docs = extract(`{ active: "yes" }`, warnings)
    expect(docs?.active).toBeUndefined()
    expect(warnings[0]!.message).toContain('"active"')
  })

  it("accepts non-string metadata values -- metadata is a genuinely opaque, arbitrary-shaped bag (ADR 0051)", () => {
    const warnings: ParseWarning[] = []
    const docs = extract(
      `{ metadata: { count: 5, tags: ["a", "b"], nested: { x: true } } }`,
      warnings,
    )
    expect(docs?.metadata).toEqual({ count: 5, tags: ["a", "b"], nested: { x: true } })
    expect(warnings).toHaveLength(0)
  })

  it("warns and omits metadata when it isn't an object literal", () => {
    const warnings: ParseWarning[] = []
    const docs = extract(`{ metadata: someVariable }`, warnings)
    expect(docs?.metadata).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it("extracts purpose/legalBasis/auditRequired at the capability level", () => {
    const docs = extract(`{
      purpose: "case management",
      legalBasis: "contract",
      auditRequired: true,
    }`)
    expect(docs?.purpose).toBe("case management")
    expect(docs?.legalBasis).toBe("contract")
    expect(docs?.auditRequired).toBe(true)
  })

  it("extracts dataResidency as a single string", () => {
    const docs = extract(`{ dataResidency: "us" }`)
    expect(docs?.dataResidency).toBe("us")
  })

  it("extracts dataResidency as a string array", () => {
    const docs = extract(`{ dataResidency: ["us", "eu"] }`)
    expect(docs?.dataResidency).toEqual(["us", "eu"])
  })

  it("warns and omits dataResidency when it's neither a string nor a string-array literal", () => {
    const warnings: ParseWarning[] = []
    const docs = extract(`{ dataResidency: 5 }`, warnings)
    expect(docs?.dataResidency).toBeUndefined()
    expect(warnings[0]!.message).toContain('"dataResidency"')
  })

  describe("fields section", () => {
    it("extracts description/owner/sensitivity/protections/retention per field", () => {
      const docs = extract(`{
        fields: {
          email: {
            description: "The user's email.",
            owner: "identity-team",
            sensitivity: "confidential",
            protections: "redacted in logs",
            retention: "account lifetime",
          },
          locale: { description: "UI locale." },
        },
      }`)
      expect(docs?.fields).toEqual({
        email: {
          description: "The user's email.",
          owner: "identity-team",
          sensitivity: "confidential",
          protections: "redacted in logs",
          retention: "account lifetime",
        },
        locale: {
          description: "UI locale.",
          owner: undefined,
          sensitivity: undefined,
          protections: undefined,
          retention: undefined,
        },
      })
    })

    it("skips (with a warning) a field entry that isn't an inline object literal", () => {
      const warnings: ParseWarning[] = []
      const docs = extract(`{ fields: { email: someVariable } }`, warnings)
      expect(docs?.fields).toEqual({})
      expect(warnings[0]!.message).toBe(
        'documentData() field docs for "email" in "userCapability" is not an inline object literal; skipped.',
      )
    })

    it("returns undefined for fields when the section itself isn't an inline object literal", () => {
      const docs = extract(`{ fields: someVariable }`)
      expect(docs?.fields).toBeUndefined()
    })

    it("warns with the full contextLabel.fields.key label for a bad field-docs field", () => {
      const warnings: ParseWarning[] = []
      const docs = extract(`{ fields: { email: { description: someVariable } } }`, warnings)
      expect(docs?.fields?.["email"]?.description).toBeUndefined()
      expect(warnings).toHaveLength(1)
      expect(warnings[0]!.message).toContain('"userCapability.fields.email"')
    })

    it("skips a non-statically-named field key in the docs section, keeping every real one", () => {
      const docs = extract(`{
        fields: {
          [computedKey]: { description: "ghost" },
          email: { description: "real" },
        },
      }`)
      expect(Object.keys(docs?.fields ?? {})).toEqual(["email"])
    })
  })

  describe("getters/mutators/subscriptions sections", () => {
    it("extracts description/source/credentials per operation, across all three sections", () => {
      const docs = extract(`{
        getters: { getUser: { description: "Fetches a user.", source: "GET /user" } },
        mutators: { updateUser: { credentials: "session cookie" } },
        subscriptions: { subscribeToUser: {} },
      }`)
      expect(docs?.getters).toEqual({
        getUser: {
          description: "Fetches a user.",
          source: "GET /user",
          credentials: undefined,
          endpoints: undefined,
        },
      })
      expect(docs?.mutators).toEqual({
        updateUser: {
          description: undefined,
          source: undefined,
          credentials: "session cookie",
          endpoints: undefined,
        },
      })
      expect(docs?.subscriptions).toEqual({
        subscribeToUser: {
          description: undefined,
          source: undefined,
          credentials: undefined,
          endpoints: undefined,
        },
      })
    })

    it("skips (with a warning) an operation entry that isn't an inline object literal", () => {
      const warnings: ParseWarning[] = []
      const docs = extract(`{ getters: { getUser: someVariable } }`, warnings)
      expect(docs?.getters).toEqual({})
      expect(warnings[0]!.message).toContain("getters")
    })

    describe("endpoints", () => {
      it("extracts a well-formed endpoints array", () => {
        const docs = extract(`{
          getters: {
            getUser: {
              endpoints: [{ direction: "input", kind: "api", name: "identity-service" }],
            },
          },
        }`)
        expect(docs?.getters?.["getUser"]?.endpoints).toEqual([
          { direction: "input", kind: "api", name: "identity-service" },
        ])
      })

      it("warns and omits endpoints when not an inline array literal", () => {
        const warnings: ParseWarning[] = []
        const docs = extract(`{ getters: { getUser: { endpoints: someVariable } } }`, warnings)
        expect(docs?.getters?.["getUser"]?.endpoints).toBeUndefined()
        expect(warnings.some((w) => w.message.includes('"endpoints"'))).toBe(true)
      })

      it("drops a spread element within endpoints, keeping the rest", () => {
        const warnings: ParseWarning[] = []
        const docs = extract(
          `{ getters: { getUser: { endpoints: [{ direction: "input", kind: "api", name: "a" }, ...rest] } } }`,
          warnings,
        )
        expect(docs?.getters?.["getUser"]?.endpoints).toEqual([
          { direction: "input", kind: "api", name: "a" },
        ])
        expect(warnings.some((w) => w.message.includes("spread"))).toBe(true)
      })

      it("drops a non-object endpoint entry", () => {
        const warnings: ParseWarning[] = []
        const docs = extract(`{ getters: { getUser: { endpoints: ["not-an-object"] } } }`, warnings)
        expect(docs?.getters?.["getUser"]?.endpoints).toEqual([])
        expect(warnings.some((w) => w.message.includes("object literal"))).toBe(true)
      })

      it("drops an endpoint entry with an unrecognized direction/kind, or a missing name", () => {
        const warnings: ParseWarning[] = []
        const docs = extract(
          `{
            getters: {
              getUser: {
                endpoints: [
                  { direction: "sideways", kind: "api", name: "a" },
                  { direction: "input", kind: "teleporter", name: "b" },
                  { direction: "input", kind: "api" },
                ],
              },
            },
          }`,
          warnings,
        )
        expect(docs?.getters?.["getUser"]?.endpoints).toEqual([])
        expect(warnings.filter((w) => w.message.includes("unrecognized")).length).toBe(3)
      })

      it("extracts an optional url and handling on an endpoint entry", () => {
        const docs = extract(`{
          getters: {
            getUser: {
              endpoints: [{
                direction: "input",
                kind: "api",
                name: "identity-service",
                url: "https://identity.example.com/v1/users/:id",
                handling: "encrypted",
              }],
            },
          },
        }`)
        expect(docs?.getters?.["getUser"]?.endpoints).toEqual([
          {
            direction: "input",
            kind: "api",
            name: "identity-service",
            url: "https://identity.example.com/v1/users/:id",
            handling: "encrypted",
          },
        ])
      })

      it("leaves url/handling undefined when absent, without warning", () => {
        const warnings: ParseWarning[] = []
        const docs = extract(
          `{ getters: { getUser: { endpoints: [{ direction: "input", kind: "api", name: "a" }] } } }`,
          warnings,
        )
        expect(docs?.getters?.["getUser"]?.endpoints?.[0]?.url).toBeUndefined()
        expect(docs?.getters?.["getUser"]?.endpoints?.[0]?.handling).toBeUndefined()
        expect(warnings).toEqual([])
      })

      it("drops only 'handling' (never the whole entry) when its value isn't a recognized state", () => {
        const warnings: ParseWarning[] = []
        const docs = extract(
          `{ getters: { getUser: { endpoints: [{ direction: "input", kind: "api", name: "a", handling: "invisible" }] } } }`,
          warnings,
        )
        expect(docs?.getters?.["getUser"]?.endpoints).toEqual([
          { direction: "input", kind: "api", name: "a" },
        ])
        expect(warnings.some((w) => w.message.includes("handling"))).toBe(true)
      })

      it("drops only 'url' (never the whole entry) when its value isn't a string", () => {
        const warnings: ParseWarning[] = []
        const docs = extract(
          `{ getters: { getUser: { endpoints: [{ direction: "input", kind: "api", name: "a", url: 5 }] } } }`,
          warnings,
        )
        expect(docs?.getters?.["getUser"]?.endpoints).toEqual([
          { direction: "input", kind: "api", name: "a" },
        ])
        expect(warnings.some((w) => w.message.includes("url"))).toBe(true)
      })
    })
  })

  describe("evidence.fields[key].dynamicAccess (ADR 0053)", () => {
    it("extracts a well-formed citation list", () => {
      const docs = extract(`{
        evidence: { fields: { email: { dynamicAccess: ["src/legacy.ts:12:5", "src/other.ts:3:1"] } } },
      }`)
      expect(docs?.evidence).toEqual({
        fields: { email: { dynamicAccess: ["src/legacy.ts:12:5", "src/other.ts:3:1"] } },
      })
    })

    it("drops a malformed citation entry, keeping the rest, with a warning", () => {
      const warnings: ParseWarning[] = []
      const docs = extract(
        `{ evidence: { fields: { email: { dynamicAccess: ["ok.ts:1:1", "not-a-citation", 5] } } } }`,
        warnings,
      )
      expect(docs?.evidence?.fields?.["email"]?.dynamicAccess).toEqual(["ok.ts:1:1"])
      expect(warnings.filter((w) => w.message.includes("dynamicAccess")).length).toBe(2)
    })

    it("warns and omits dynamicAccess when it isn't a statically-resolvable array literal", () => {
      const warnings: ParseWarning[] = []
      const docs = extract(
        `{ evidence: { fields: { email: { dynamicAccess: someVariable } } } }`,
        warnings,
      )
      expect(docs?.evidence?.fields?.["email"]?.dynamicAccess).toBeUndefined()
      expect(warnings.some((w) => w.message.includes('"dynamicAccess"'))).toBe(true)
    })

    it("warns and omits dynamicAccess when it's a resolvable literal that isn't an array (an object)", () => {
      // Distinct from the case above: `evaluateLiteral` succeeds here
      // (`ok: true`), it just isn't an array -- this exercises the
      // `Array.isArray` half of `!evaluated.ok || !Array.isArray(...)`
      // independently of the `!evaluated.ok` half.
      const warnings: ParseWarning[] = []
      const docs = extract(
        `{ evidence: { fields: { email: { dynamicAccess: { not: "an array" } } } } }`,
        warnings,
      )
      expect(docs?.evidence?.fields?.["email"]?.dynamicAccess).toBeUndefined()
      expect(
        warnings.some((w) =>
          w.message.includes('"dynamicAccess" for "userCapability.evidence.fields.email"'),
        ),
      ).toBe(true)
    })

    it("includes the full contextLabel.evidence.fields.key label in a dynamicAccess warning", () => {
      const warnings: ParseWarning[] = []
      extract(
        `{ evidence: { fields: { email: { dynamicAccess: ["ok.ts:1:1", "bad"] } } } }`,
        warnings,
      )
      expect(
        warnings.some((w) => w.message.includes('"userCapability.evidence.fields.email"')),
      ).toBe(true)
    })

    it("warns and ignores evidence when it isn't an inline object literal", () => {
      const warnings: ParseWarning[] = []
      const docs = extract(`{ evidence: someVariable }`, warnings)
      expect(docs?.evidence).toBeUndefined()
      expect(warnings.some((w) => w.message.includes('"evidence"'))).toBe(true)
    })

    it("leaves dynamicAccess undefined when the key is absent from the field entry entirely", () => {
      const docs = extract(`{ evidence: { fields: { email: {} } } }`)
      expect(docs?.evidence?.fields?.["email"]).toEqual({ dynamicAccess: undefined })
    })

    it("returns an empty evidence object when 'fields' is absent", () => {
      const docs = extract(`{ evidence: {} }`)
      expect(docs?.evidence).toEqual({})
    })

    it("returns undefined when evidence is absent entirely", () => {
      const docs = extract(`{ name: "user" }`)
      expect(docs?.evidence).toBeUndefined()
    })

    it("skips an evidence.fields entry that isn't an inline object literal", () => {
      const warnings: ParseWarning[] = []
      const docs = extract(
        `{ evidence: { fields: { email: someVariable, phone: { dynamicAccess: ["a.ts:1:1"] } } } }`,
        warnings,
      )
      expect(Object.keys(docs?.evidence?.fields ?? {})).toEqual(["phone"])
      expect(warnings.some((w) => w.message.includes("evidence.fields"))).toBe(true)
    })
  })
})

describe("documentData vocabulary predicates (direct)", () => {
  it("isDataFlowDirection: exactly input/output", () => {
    expect(isDataFlowDirection("input")).toBe(true)
    expect(isDataFlowDirection("output")).toBe(true)
    for (const v of ["Input", "in", "sideways", ""]) expect(isDataFlowDirection(v)).toBe(false)
  })

  it("isDataFlowEndpointKind: exactly the nine recognized kinds", () => {
    for (const v of [
      "database",
      "cache",
      "storage",
      "queue",
      "api",
      "external-service",
      "user-input",
      "computed",
      "internal",
    ]) {
      expect(isDataFlowEndpointKind(v)).toBe(true)
    }
    for (const v of ["db", "API", "teleporter", "external service", ""]) {
      expect(isDataFlowEndpointKind(v)).toBe(false)
    }
  })

  it("isDataFlowHandlingValue: exactly plaintext/masked/redacted/hashed/encrypted", () => {
    for (const v of ["plaintext", "masked", "redacted", "hashed", "encrypted"]) {
      expect(isDataFlowHandlingValue(v)).toBe(true)
    }
    for (const v of ["clear", "Encrypted", "invisible", ""]) {
      expect(isDataFlowHandlingValue(v)).toBe(false)
    }
  })

  it("isDynamicAccessCitation: <path>:<line>:<col>, anchored, multi-digit ok, nothing before/after", () => {
    for (const v of ["a:1:1", "src/deep/file.ts:12:345", "x-y_z.tsx:9:9"]) {
      expect(isDynamicAccessCitation(v)).toBe(true)
    }
    for (const v of [
      "", // empty
      ":1:1", // empty path
      "a:1", // no column
      "a:1:1 ", // trailing space
      "a:1:1x", // trailing junk (kills the `$` anchor)
      "junk\na:1:1", // valid tail but junk before (kills the `^` anchor)
      "a:1:1\nx", // junk after (kills the `$` anchor)
      "a:x:1", // non-digit line
      "a:1:x", // non-digit column
      "a::1", // missing line digits
      "a:1:", // missing column digits
    ]) {
      expect(isDynamicAccessCitation(v), `expected "${v}" to be rejected`).toBe(false)
    }
  })
})

describe("extractCapabilityDocs -- evaluable-but-wrong-typed values are rejected (not passed through)", () => {
  it("readStringProp rejects an evaluable non-string (number) and warns naming the key", () => {
    const w: ParseWarning[] = []
    const docs = extract(`{ owner: 5, name: 42 }`, w)
    expect(docs?.owner).toBeUndefined()
    expect(docs?.name).toBeUndefined()
    expect(
      w.some((x) => x.message.includes('"owner"') && x.message.includes("string literal")),
    ).toBe(true)
  })

  it("readBooleanProp rejects an evaluable non-boolean (string/number)", () => {
    const w: ParseWarning[] = []
    const docs = extract(`{ active: 1, auditRequired: "true" }`, w)
    expect(docs?.active).toBeUndefined()
    expect(docs?.auditRequired).toBeUndefined()
    expect(
      w.some((x) => x.message.includes('"active"') && x.message.includes("boolean literal")),
    ).toBe(true)
  })

  it("readMetadataProp rejects an evaluable number, null, and array (never passed through)", () => {
    expect(extract(`{ metadata: 5 }`, [])?.metadata).toBeUndefined()
    expect(extract(`{ metadata: null }`, [])?.metadata).toBeUndefined()
    expect(extract(`{ metadata: [1, 2] }`, [])?.metadata).toBeUndefined()
    const w: ParseWarning[] = []
    extract(`{ metadata: 5 }`, w)
    expect(w[0]?.message).toContain('"metadata"')
  })

  it("readMetadataProp accepts a genuine object literal (the happy path stays intact)", () => {
    expect(extract(`{ metadata: { a: 1 } }`, [])?.metadata).toEqual({ a: 1 })
  })

  it("readDataResidencyProp rejects a number, an object, and a mixed (non-all-string) array", () => {
    const w: ParseWarning[] = []
    expect(extract(`{ dataResidency: 5 }`, w)?.dataResidency).toBeUndefined()
    expect(extract(`{ dataResidency: { region: "us" } }`, [])?.dataResidency).toBeUndefined()
    expect(extract(`{ dataResidency: ["us", 7] }`, [])?.dataResidency).toBeUndefined()
    expect(w[0]?.message).toContain("string or string-array")
  })

  it("readDataResidencyProp still accepts a lone string and an all-string array", () => {
    expect(extract(`{ dataResidency: "us" }`, [])?.dataResidency).toBe("us")
    expect(extract(`{ dataResidency: ["us", "eu"] }`, [])?.dataResidency).toEqual(["us", "eu"])
  })
})

/** Parses a single expression (`{ ... }`, `[ ... ]`, `"x"`, ...) into its AST node. */
function exprNode(src: string): ts.Expression {
  const sf = ts.createSourceFile("x.ts", `const _ = ${src}`, ts.ScriptTarget.Latest, true)
  const decl = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0]!
  return decl.initializer!
}

describe("readDataFlowEndpoint (direct)", () => {
  function read(src: string): { endpoint: unknown; warnings: string[] } {
    const w: ParseWarning[] = []
    const endpoint = readDataFlowEndpoint(exprNode(src), "ctx", "f.ts", w)
    return { endpoint, warnings: w.map((x) => x.message) }
  }

  it("accepts a minimal well-formed endpoint", () => {
    const { endpoint, warnings } = read(
      `{ direction: "output", kind: "database", name: "primary" }`,
    )
    expect(endpoint).toEqual({
      direction: "output",
      kind: "database",
      name: "primary",
      url: undefined,
      handling: undefined,
    })
    expect(warnings).toEqual([])
  })

  it("drops (with 'object literal' warning) a non-object node: primitive, null, array", () => {
    for (const src of [`"str"`, `42`, `null`, `[1, 2]`]) {
      const { endpoint, warnings } = read(src)
      expect(endpoint).toBeUndefined()
      expect(warnings.some((m) => m.includes("object literal"))).toBe(true)
    }
  })

  it("drops (with 'missing or unrecognized' warning) a bad direction, kind, or name", () => {
    for (const src of [
      `{ direction: "sideways", kind: "api", name: "a" }`,
      `{ direction: "input", kind: "teleporter", name: "a" }`,
      `{ direction: "input", kind: "api" }`,
      `{ direction: 1, kind: "api", name: "a" }`,
      `{ direction: "input", kind: "api", name: 2 }`,
    ]) {
      const { endpoint, warnings } = read(src)
      expect(endpoint).toBeUndefined()
      expect(warnings.some((m) => m.includes("missing or unrecognized"))).toBe(true)
    }
  })

  it("keeps the entry but drops only a non-string url, with its own warning -- and no spurious handling warning", () => {
    const { endpoint, warnings } = read(`{ direction: "input", kind: "api", name: "a", url: 5 }`)
    expect(endpoint).toEqual({
      direction: "input",
      kind: "api",
      name: "a",
      url: undefined,
      handling: undefined,
    })
    // Exactly the url warning -- `handling` is absent, so it must NOT warn.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('non-string "url"')
  })

  it("keeps the entry but drops only an unrecognized handling, with its own warning -- and no spurious url warning", () => {
    const { endpoint, warnings } = read(
      `{ direction: "input", kind: "api", name: "a", handling: "invisible" }`,
    )
    expect(endpoint).toEqual({
      direction: "input",
      kind: "api",
      name: "a",
      url: undefined,
      handling: undefined,
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("handling")
  })

  it("does not warn about handling / url when they are simply absent", () => {
    const { warnings } = read(`{ direction: "input", kind: "api", name: "a" }`)
    expect(warnings).toEqual([])
  })

  it("with a bad url AND a bad handling, warns once for each (never conflated)", () => {
    const { endpoint, warnings } = read(
      `{ direction: "input", kind: "api", name: "a", url: 7, handling: "nope" }`,
    )
    expect(endpoint).toEqual({
      direction: "input",
      kind: "api",
      name: "a",
      url: undefined,
      handling: undefined,
    })
    expect(warnings).toHaveLength(2)
    expect(warnings.some((m) => m.includes('non-string "url"'))).toBe(true)
    expect(warnings.some((m) => m.includes("handling"))).toBe(true)
  })

  it("carries a valid url and handling straight through, without any warning", () => {
    const { endpoint, warnings } = read(
      `{ direction: "output", kind: "external-service", name: "svc", url: "https://x/y", handling: "hashed" }`,
    )
    expect(endpoint).toEqual({
      direction: "output",
      kind: "external-service",
      name: "svc",
      url: "https://x/y",
      handling: "hashed",
    })
    expect(warnings).toEqual([])
  })
})

/** The first statement of `src` as a specific node kind. */
function callFrom(src: string): ts.CallExpression {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true)
  let found: ts.CallExpression | undefined
  const walk = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && found === undefined) found = n
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return found!
}
function stmtFrom(src: string): ts.VariableStatement {
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true)
  return sf.statements[0] as ts.VariableStatement
}
function objLitFrom(src: string): ts.ObjectLiteralExpression {
  return exprNode(src) as ts.ObjectLiteralExpression
}
const NO_CONSTS = new Map<string, ts.Expression>()

describe("isCallToName (direct)", () => {
  it("matches a bare identifier call by exact name only", () => {
    expect(isCallToName(callFrom(`createData({})`), "createData")).toBe(true)
    expect(isCallToName(callFrom(`createData({})`), "buildData")).toBe(false)
    expect(isCallToName(callFrom(`createSomethingElse({})`), "createData")).toBe(false)
  })
  it("matches a property-access call by the property name", () => {
    expect(isCallToName(callFrom(`dc.createData({})`), "createData")).toBe(true)
    expect(isCallToName(callFrom(`dc.createData({})`), "buildData")).toBe(false)
  })
  it("never matches an element-access or call-of-call callee", () => {
    expect(isCallToName(callFrom(`dc["createData"]({})`), "createData")).toBe(false)
    expect(isCallToName(callFrom(`factory()({})`), "createData")).toBe(false)
  })
})

describe("hasExportModifier (direct)", () => {
  it("is true only when the statement carries an `export` keyword modifier", () => {
    expect(hasExportModifier(stmtFrom(`export const x = 1;`))).toBe(true)
    expect(hasExportModifier(stmtFrom(`const x = 1;`))).toBe(false)
    expect(hasExportModifier(stmtFrom(`declare const x: number;`))).toBe(false)
  })

  it("checks for an export modifier specifically -- another modifier alongside it does not stand in", () => {
    // `export declare const` carries [export, declare]: `.some(=== export)` is
    // true but `.every(=== export)` is false, so an `every`-based check would
    // wrongly report false here... this pins it to the `some` semantics.
    expect(hasExportModifier(stmtFrom(`export declare const x: number;`))).toBe(true)
  })
})

describe("extractFieldsRef (direct)", () => {
  const ref = (src: string, consts = NO_CONSTS) => extractFieldsRef(callFrom(src), consts)
  it("reports the specific unresolvable reason for each failure mode", () => {
    expect(ref(`createData()`)).toEqual({ kind: "unresolvable", reason: "call has no arguments" })
    expect(ref(`createData(someVar)`).kind).toBe("unresolvable")
    expect((ref(`createData(someVar)`) as { reason: string }).reason).toContain(
      "not an inline object literal",
    )
    expect((ref(`createData({ notFields: {} })`) as { reason: string }).reason).toContain(
      'no "fields" property',
    )
    expect((ref(`createData({ fields: someFactory() })`) as { reason: string }).reason).toContain(
      "neither an inline object literal nor a local identifier",
    )
  })
  it("returns a literal ref for an inline fields object and an identifier ref for a bare name", () => {
    expect(ref(`createData({ fields: { id: "" } })`).kind).toBe("literal")
    expect(ref(`createData({ fields: userFields })`)).toEqual({
      kind: "identifier",
      name: "userFields",
    })
  })
  it("follows one level of identifier indirection to the whole config object", () => {
    const consts = new Map<string, ts.Expression>([["schema", exprNode(`{ fields: { id: "" } }`)]])
    expect(ref(`createData(schema)`, consts).kind).toBe("literal")
  })
  it("never resolves a non-identifier first argument via a coincidentally-matching localConsts key (e.g. a string literal happens to share .text with a real const name)", () => {
    // A StringLiteral node also has a `.text` property -- this proves the
    // identifier-indirection lookup is gated on the node actually BEING an
    // identifier, not merely on "does it have `.text`".
    const consts = new Map<string, ts.Expression>([["schema", exprNode(`{ fields: {} }`)]])
    expect(ref(`createData("schema")`, consts).kind).toBe("unresolvable")
  })
})

describe("extractOperationNames (direct)", () => {
  it("returns undefined when the config isn't resolvable to an object literal", () => {
    expect(extractOperationNames(callFrom(`createData(someVar)`), NO_CONSTS)).toBeUndefined()
  })
  it("lists each section's keys, empty array when a section is absent", () => {
    expect(
      extractOperationNames(
        callFrom(`createData({ fields: {}, getters: { a: {}, b: {} }, subscriptions: { c: {} } })`),
        NO_CONSTS,
      ),
    ).toEqual({ getters: ["a", "b"], mutators: [], subscriptions: ["c"] })
  })
})

describe("extractSectionNames (direct)", () => {
  it("returns undefined when the named section's value isn't an inline object literal", () => {
    expect(extractSectionNames(objLitFrom(`{ getters: someVar }`), "getters")).toBeUndefined()
  })
  it("returns undefined when the section is absent entirely", () => {
    expect(extractSectionNames(objLitFrom(`{ fields: {} }`), "getters")).toBeUndefined()
  })
  it("skips a non-statically-named key, keeping every real one (never guessed, never dropping siblings)", () => {
    expect(
      extractSectionNames(objLitFrom(`{ getters: { a: {}, [computed]: {}, b: {} } }`), "getters"),
    ).toEqual(["a", "b"])
  })
})

describe("readStringProp / readBooleanProp / readMetadataProp / readDataResidencyProp (direct)", () => {
  const w = (): ParseWarning[] => []
  it("readStringProp: literal string, undefined for absent, warn+undefined for a non-string", () => {
    expect(readStringProp(objLitFrom(`{ owner: "team" }`), "owner", "c", "f", w())).toBe("team")
    expect(readStringProp(objLitFrom(`{}`), "owner", "c", "f", w())).toBeUndefined()
    const ws = w()
    expect(readStringProp(objLitFrom(`{ owner: 5 }`), "owner", "c", "f", ws)).toBeUndefined()
    expect(ws[0]?.message).toContain('"owner" for "c"')
  })
  it("readBooleanProp: literal boolean only", () => {
    expect(readBooleanProp(objLitFrom(`{ active: false }`), "active", "c", "f", w())).toBe(false)
    const ws = w()
    expect(readBooleanProp(objLitFrom(`{ active: "no" }`), "active", "c", "f", ws)).toBeUndefined()
    expect(ws[0]?.message).toContain('"active"')
  })
  it("readMetadataProp: any object literal through verbatim; number/null/array rejected", () => {
    expect(
      readMetadataProp(objLitFrom(`{ metadata: { x: [1], y: { z: true } } }`), "c", "f", w()),
    ).toEqual({ x: [1], y: { z: true } })
    for (const src of [`{ metadata: 1 }`, `{ metadata: null }`, `{ metadata: [1] }`]) {
      expect(readMetadataProp(objLitFrom(src), "c", "f", w())).toBeUndefined()
    }
  })
  it("readDataResidencyProp: string OR all-string array; rejects a mixed array and a number", () => {
    expect(readDataResidencyProp(objLitFrom(`{ dataResidency: "us" }`), "c", "f", w())).toBe("us")
    expect(
      readDataResidencyProp(objLitFrom(`{ dataResidency: ["us","eu"] }`), "c", "f", w()),
    ).toEqual(["us", "eu"])
    expect(
      readDataResidencyProp(objLitFrom(`{ dataResidency: ["us", 5] }`), "c", "f", w()),
    ).toBeUndefined()
    expect(readDataResidencyProp(objLitFrom(`{ dataResidency: 5 }`), "c", "f", w())).toBeUndefined()
  })
})

describe("readEndpointsProp / readDynamicAccessCitations (direct)", () => {
  it("readEndpointsProp: keeps well-formed entries, drops (with a warning) a spread or a bad entry", () => {
    const w1: ParseWarning[] = []
    expect(
      readEndpointsProp(
        objLitFrom(`{ endpoints: [{ direction: "input", kind: "api", name: "a" }, ...rest, 5] }`),
        "c",
        "f",
        w1,
      ),
    ).toEqual([{ direction: "input", kind: "api", name: "a", url: undefined, handling: undefined }])
    expect(w1.some((x) => x.message.includes("spread"))).toBe(true)
  })
  it("readEndpointsProp: warns + undefined when the value isn't an inline array literal", () => {
    const w1: ParseWarning[] = []
    expect(readEndpointsProp(objLitFrom(`{ endpoints: someVar }`), "c", "f", w1)).toBeUndefined()
    expect(w1[0]?.message).toContain('"endpoints"')
  })
  it("readDynamicAccessCitations: keeps well-formed, drops each malformed with its own warning", () => {
    const w1: ParseWarning[] = []
    expect(
      readDynamicAccessCitations(exprNode(`["a.ts:1:1", "bad", 5, "b.ts:22:3"]`), "c", "f", w1),
    ).toEqual(["a.ts:1:1", "b.ts:22:3"])
    expect(w1.filter((x) => x.message.includes("dynamicAccess")).length).toBe(2)
  })

  it("readDynamicAccessCitations: drops a non-string entry even when it coerces to a citation-shaped string", () => {
    // A single-element array like `["a:1:1"]` stringifies (via
    // `Array.prototype.toString`) to the citation-shaped string "a:1:1" --
    // exercising the `typeof entry !== "string"` half of the guard
    // independently of `isDynamicAccessCitation`'s own regex result, which
    // would otherwise (mis)judge this non-string entry as well-formed.
    const w1: ParseWarning[] = []
    expect(readDynamicAccessCitations(exprNode(`[["a.ts:1:1"]]`), "c", "f", w1)).toEqual([])
    expect(w1.filter((x) => x.message.includes("dynamicAccess")).length).toBe(1)
  })
  it("readDynamicAccessCitations: warns + undefined for a non-array", () => {
    const w1: ParseWarning[] = []
    expect(readDynamicAccessCitations(exprNode(`someVar`), "c", "f", w1)).toBeUndefined()
    expect(w1[0]?.message).toContain('"dynamicAccess" for "c"')
  })
})

describe("collectImportBindings (direct)", () => {
  function importDeclFrom(source: string): ts.ImportDeclaration {
    // Deliberately error-tolerant parsing (no bail on a malformed
    // specifier): the TS parser still produces an ImportDeclaration node
    // even for `import foo from bar;` (no quotes) -- moduleSpecifier is
    // typed `Expression`, not `StringLiteral`, precisely for this case.
    const sourceFile = ts.createSourceFile(
      "x.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    const decl = sourceFile.statements.find((s): s is ts.ImportDeclaration =>
      ts.isImportDeclaration(s),
    )
    if (decl === undefined) throw new Error("expected an ImportDeclaration")
    return decl
  }

  it("ignores an import whose module specifier isn't a string literal", () => {
    const imports: ImportBinding[] = []
    collectImportBindings(importDeclFrom(`import foo from bar;`), imports)
    expect(imports).toEqual([])
  })

  it("collects a default import", () => {
    const imports: ImportBinding[] = []
    collectImportBindings(importDeclFrom(`import foo from "./mod.js";`), imports)
    expect(imports).toEqual([
      { localName: "foo", importedName: "default", moduleSpecifier: "./mod.js" },
    ])
  })

  it("collects a namespace import", () => {
    const imports: ImportBinding[] = []
    collectImportBindings(importDeclFrom(`import * as ns from "./mod.js";`), imports)
    expect(imports).toEqual([{ localName: "ns", importedName: "*", moduleSpecifier: "./mod.js" }])
  })

  it("collects named imports, including a renamed one", () => {
    const imports: ImportBinding[] = []
    collectImportBindings(importDeclFrom(`import { a, b as bLocal } from "./mod.js";`), imports)
    expect(imports).toEqual([
      { localName: "a", importedName: "a", moduleSpecifier: "./mod.js" },
      { localName: "bLocal", importedName: "b", moduleSpecifier: "./mod.js" },
    ])
  })

  it("collects nothing for a side-effect-only import (no import clause)", () => {
    const imports: ImportBinding[] = []
    collectImportBindings(importDeclFrom(`import "./mod.js";`), imports)
    expect(imports).toEqual([])
  })
})
