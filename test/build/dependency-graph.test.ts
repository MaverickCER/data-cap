import ts from "typescript"
import { describe, expect, it } from "vitest"
import { scanFileForUsage } from "../../src/build/dependency-graph.js"
import type { ImportBindingMatch, ScanTarget } from "../../src/build/dependency-graph.js"

function target(overrides: Partial<ScanTarget> = {}): ScanTarget {
  return {
    file: "/project/user.ts",
    exportName: "userCapability",
    getterNames: ["getUser"],
    mutatorNames: ["updateUser"],
    subscriptionNames: ["subscribeToUser"],
    ...overrides,
  }
}

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "/project/consumer.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
}

function scan(source: string, matches: readonly ImportBindingMatch[]) {
  return scanFileForUsage(parse(source), "/project/consumer.ts", matches)
}

const resolvedMatch = (localName: string, t: ScanTarget = target()): ImportBindingMatch => ({
  localName,
  target: t,
  resolution: "resolved",
})

describe("scanFileForUsage -- operation calls", () => {
  it("detects a getter call", () => {
    const edges = scan(`userCapability.getUser({ id: "1" });`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([
      {
        relationship: "calls-getter",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: undefined,
          operation: "getUser",
        },
        resolution: "resolved",
        position: { line: 1, column: 1 },
      },
    ])
    expect("field" in edges[0]!.to).toBe(false)
  })

  it("detects a mutator call", () => {
    const edges = scan(`userCapability.updateUser({ id: "1" });`, [resolvedMatch("userCapability")])
    expect(edges[0]!.relationship).toBe("calls-mutator")
  })

  it("detects a subscription call", () => {
    const edges = scan(`userCapability.subscribeToUser({ id: "1" });`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges[0]!.relationship).toBe("calls-subscription")
  })

  it("does not report a property access matching an operation name that is never actually called", () => {
    const edges = scan(`const fn = userCapability.getUser;`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([])
  })

  it("ignores a property/method that isn't a recognized operation name", () => {
    const edges = scan(`userCapability.someOtherMethod();`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([])
  })

  it("respects the local (possibly renamed) import binding name", () => {
    const edges = scan(`user.getUser();`, [resolvedMatch("user")])
    expect(edges[0]!.to.operation).toBe("getUser")
  })

  it("propagates the match's resolution onto the produced edge", () => {
    const edges = scan(`userCapability.getUser();`, [
      { localName: "userCapability", target: target(), resolution: "unresolved-consumer" },
    ])
    expect(edges[0]!.resolution).toBe("unresolved-consumer")
  })
})

describe("scanFileForUsage -- field reads", () => {
  it("detects a direct .fields.<name> read", () => {
    const edges = scan(`userCapability.fields.email;`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([
      {
        relationship: "reads-field",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
          operation: undefined,
        },
        resolution: "resolved",
        position: { line: 1, column: 1 },
      },
    ])
    expect("operation" in edges[0]!.to).toBe(false)
  })

  it("detects a .getSnapshot().fields.<name> read", () => {
    const edges = scan(`userCapability.getSnapshot().fields.email;`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges[0]!.relationship).toBe("reads-field")
    expect(edges[0]!.to.field).toEqual(["email"])
  })

  it("does not report a bare .fields reference with no further indexing", () => {
    const edges = scan(`const allFields = userCapability.fields;`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toEqual([])
  })

  it("does not report a bare .getSnapshot() call with no further .fields access", () => {
    const edges = scan(`const snapshot = userCapability.getSnapshot();`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toEqual([])
  })

  it("does not report .getSnapshot() followed by a non-fields property", () => {
    const edges = scan(`userCapability.getSnapshot().info;`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([])
  })

  it("does not report a bare .getSnapshot reference that is never called", () => {
    const edges = scan(`const fn = userCapability.getSnapshot;`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([])
  })

  it("does not report .getSnapshot passed as an argument to another call (not itself the call being invoked)", () => {
    const edges = scan(`someOtherFn(userCapability.getSnapshot);`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toEqual([])
  })

  it("reads a string-literal computed field access (bracket notation)", () => {
    const edges = scan(`userCapability.fields["email"];`, [resolvedMatch("userCapability")])
    expect(edges[0]!.to.field).toEqual(["email"])
  })

  it("reports a non-string computed field access as an indeterminate reads-field edge, never silently dropped", () => {
    // Previously produced zero edges at all -- a field this pass genuinely
    // can't name is real, uncertain evidence, not the absence of evidence
    // (see this module's own header comment; fixed as part of Part 2A's
    // exact-position work).
    const edges = scan(`userCapability.fields[someVariable];`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([
      {
        relationship: "reads-field",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: undefined,
          operation: undefined,
        },
        resolution: "indeterminate",
        position: { line: 1, column: 1 },
      },
    ])
  })

  it("reports a non-string computed field access through .getSnapshot().fields[...] the same way", () => {
    const edges = scan(`userCapability.getSnapshot().fields[someVariable];`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "reads-field", resolution: "indeterminate" })
  })
})

describe("scanFileForUsage -- indeterminate dynamic access", () => {
  it("flags a dynamic/computed member access on the capability identifier itself", () => {
    const edges = scan(`userCapability[someKey];`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([
      {
        relationship: "imports",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: undefined,
          operation: undefined,
        },
        resolution: "indeterminate",
        position: { line: 1, column: 1 },
      },
    ])
  })
})

describe("scanFileForUsage -- structural edge cases", () => {
  it("never treats the import declaration's own specifier as a usage", () => {
    const edges = scan(`import { userCapability } from "./user.js";\nuserCapability.getUser();`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]!.relationship).toBe("calls-getter")
  })

  it("finds multiple distinct usages across a file", () => {
    const edges = scan(
      `userCapability.getUser();\nuserCapability.fields.email;\nuserCapability.updateUser();`,
      [resolvedMatch("userCapability")],
    )
    expect(edges.map((e) => e.relationship).sort()).toEqual([
      "calls-getter",
      "calls-mutator",
      "reads-field",
    ])
  })

  it("scopes matching to the given local name only -- an unrelated identifier of the same name in a different match set is untouched", () => {
    const edges = scan(`otherCapability.getUser();`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([])
  })

  it("supports two different targets imported under two different local names in the same file", () => {
    const postTarget = target({
      file: "/project/post.ts",
      exportName: "postCapability",
      getterNames: ["getPost"],
      mutatorNames: [],
      subscriptionNames: [],
    })
    const edges = scan(`userCapability.getUser();\npostCapability.getPost();`, [
      resolvedMatch("userCapability"),
      resolvedMatch("postCapability", postTarget),
    ])
    expect(edges).toHaveLength(2)
    expect(edges.map((e) => e.to.capability.exportName).sort()).toEqual([
      "postCapability",
      "userCapability",
    ])
  })

  it("returns no edges when there is nothing to match", () => {
    expect(scan(`const x = 1;`, [])).toEqual([])
  })

  it("reports the 1-based line number of each access site (ADR 0050)", () => {
    const edges = scan(
      `// a leading comment\nconst unrelated = 1;\nuserCapability.getUser();\nuserCapability.fields.email;`,
      [resolvedMatch("userCapability")],
    )
    expect(edges.map((e) => e.position?.line)).toEqual([3, 4])
  })

  it("reports the 1-based column of the access site, not just the line (ADR 0052)", () => {
    const edges = scan(`const x = userCapability.getUser();`, [resolvedMatch("userCapability")])
    // "const x = " is 10 characters -- the identifier starts at the 11th.
    expect(edges[0]!.position).toEqual({ line: 1, column: 11 })
  })
})

describe("scanFileForUsage -- position discrimination (the binding must be the subject, not incidental)", () => {
  it("ignores the binding used as an element-access index/argument, not as the indexed object", () => {
    expect(scan(`const x = someArray[userCapability];`, [resolvedMatch("userCapability")])).toEqual(
      [],
    )
  })

  it("ignores a same-named member of an unrelated object", () => {
    // `getUser` is a getter name AND the local binding name; `other.getUser()`
    // must not be read as a call on the capability.
    expect(
      scan(`import { getUser } from "x";\nother.getUser();`, [resolvedMatch("getUser")]),
    ).toEqual([])
  })

  it("ignores `.getSnapshot` referenced without being called", () => {
    expect(
      scan(`const fn = userCapability.getSnapshot;`, [resolvedMatch("userCapability")]),
    ).toEqual([])
  })

  it("ignores `.getSnapshot()` whose result is not `.fields`-accessed", () => {
    expect(
      scan(`userCapability.getSnapshot().somethingElse;`, [resolvedMatch("userCapability")]),
    ).toEqual([])
  })

  it("ignores `.getSnapshot().fields` accessed on an unrelated call, not the binding", () => {
    expect(scan(`other.getSnapshot().fields.email;`, [resolvedMatch("userCapability")])).toEqual([])
  })

  it("ignores `.getSnapshot` passed as an argument, even when the wrapping call is `.fields`-accessed", () => {
    expect(
      scan(`wrap(userCapability.getSnapshot).fields.email;`, [resolvedMatch("userCapability")]),
    ).toEqual([])
  })

  it("ignores `.getSnapshot()` followed by a non-`fields` property that is itself field-accessed", () => {
    expect(
      scan(`userCapability.getSnapshot().notFields.email;`, [resolvedMatch("userCapability")]),
    ).toEqual([])
  })

  it("ignores `.fields` used as an element-access key, not as the indexed object", () => {
    expect(
      scan(`const k = registry[userCapability.fields];`, [resolvedMatch("userCapability")]),
    ).toEqual([])
  })

  it("ignores an operation property referenced without being called", () => {
    expect(scan(`const g = userCapability.getUser;`, [resolvedMatch("userCapability")])).toEqual([])
  })

  it("ignores an operation property in bare expression-statement position (not a call)", () => {
    expect(scan(`userCapability.getUser;`, [resolvedMatch("userCapability")])).toEqual([])
  })

  it("ignores an operation property passed as an argument, not invoked", () => {
    expect(scan(`register(userCapability.getUser);`, [resolvedMatch("userCapability")])).toEqual([])
  })

  it("ignores a `.getSnapshot().fields` bare reference (no field access after it)", () => {
    expect(
      scan(`const f = userCapability.getSnapshot().fields;`, [resolvedMatch("userCapability")]),
    ).toEqual([])
  })

  it('ignores a same-named string-literal method call (`"userCapability".getUser()`)', () => {
    expect(scan(`"userCapability".getUser();`, [resolvedMatch("userCapability")])).toEqual([])
  })

  it('reads a `.getSnapshot().fields["name"]` string-literal element access as that field', () => {
    const edges = scan(`userCapability.getSnapshot().fields["email"];`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toEqual([
      {
        relationship: "reads-field",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: ["email"],
          operation: undefined,
        },
        resolution: "resolved",
        position: { line: 1, column: 1 },
      },
    ])
  })

  it("reads a non-string-literal `.fields[computed]` as an indeterminate field access", () => {
    const edges = scan(`userCapability.fields[keyVar];`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([
      {
        relationship: "reads-field",
        from: "/project/consumer.ts",
        to: {
          capability: { file: "/project/user.ts", exportName: "userCapability" },
          field: undefined,
          operation: undefined,
        },
        resolution: "indeterminate",
        position: { line: 1, column: 1 },
      },
    ])
  })
})
