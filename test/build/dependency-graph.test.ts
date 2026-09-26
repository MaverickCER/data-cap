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

  it("reports a bare .fields reference with no further indexing as an indeterminate reads-field edge (ADR 0060)", () => {
    // Previously produced zero edges at all -- `.fields` handed whole to
    // another binding, a spread, a JSX prop, etc. is a real, provable
    // reference this pass can't attribute to any specific field, not the
    // absence of one (see this module's own header comment).
    const edges = scan(`userCapability.fields;`, [resolvedMatch("userCapability")])
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

  it("reports a bare .getSnapshot() call with no further .fields access as an indeterminate reads-field edge (ADR 0060)", () => {
    const edges = scan(`const snapshot = userCapability.getSnapshot();`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "reads-field", resolution: "indeterminate" })
  })

  it("does not report .getSnapshot() followed by a non-fields property -- provably never reads .fields at all", () => {
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

describe("scanFileForUsage -- escape sites (ADR 0060)", () => {
  // Before ADR 0060, every one of these produced zero edges -- a capability
  // reference that flows out of this pass's local dataflow analysis is a
  // real, provable read this file cannot attribute to a specific field, not
  // an absence of usage. Reported as `indeterminate`, the same as a
  // computed/dynamic access, so `usage-report.ts`'s existing widening
  // (`collectIndeterminateSites` -> `FIELD_ACCESS_INDETERMINATE`) covers it
  // with no downstream changes needed.

  it("escapes a bare capability reference in expression-statement position", () => {
    const edges = scan(`userCapability;`, [resolvedMatch("userCapability")])
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

  it("escapes a bare capability reference passed as a function argument", () => {
    const edges = scan(`initialize(userCapability);`, [resolvedMatch("userCapability")])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "imports", resolution: "indeterminate" })
  })

  it("escapes a bare capability reference spread into an object literal", () => {
    const edges = scan(`const props = { ...userCapability };`, [resolvedMatch("userCapability")])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "imports", resolution: "indeterminate" })
  })

  it("escapes a bare capability reference returned from a function -- the shape a React context provider's value takes", () => {
    const edges = scan(`function useCapability() { return userCapability; }`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "imports", resolution: "indeterminate" })
  })

  it("escapes a bare capability reference handed to JSX as a prop", () => {
    const edges = scan(`const el = <Child data={userCapability} />;`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "imports", resolution: "indeterminate" })
  })

  it("escapes `.fields` spread into an object literal (whole-object prop drilling)", () => {
    const edges = scan(`const props = { ...userCapability.fields };`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "reads-field", resolution: "indeterminate" })
  })

  it("escapes `.fields` handed to JSX as a spread prop", () => {
    const edges = scan(`const el = <Child {...userCapability.fields} />;`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "reads-field", resolution: "indeterminate" })
  })

  it("does not escalate a capability reference used only as another expression's element-access key", () => {
    // `userCapability`'s own identity is used as a lookup key here, never
    // its data -- inert with respect to what this scan tracks.
    const edges = scan(`const x = someArray[userCapability];`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([])
  })

  it("does not escalate `.fields` used only as another expression's element-access key", () => {
    const edges = scan(`const k = registry[userCapability.fields];`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toEqual([])
  })

  it("does not escalate a `.getSnapshot()` result used only as another expression's element-access key", () => {
    const edges = scan(`const k = registry[userCapability.getSnapshot()];`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toEqual([])
  })

  it("escapes a computed access on a `.getSnapshot()` result, distinct from the result being used as a key elsewhere", () => {
    // Unlike the previous test (`registry[x.getSnapshot()]` -- the call
    // result used AS a key, not a read at all), here the call result is the
    // thing BEING indexed by a computed key -- a real, ambiguous access this
    // pass can't attribute to a field.
    const edges = scan(`userCapability.getSnapshot()[someKey];`, [resolvedMatch("userCapability")])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "reads-field", resolution: "indeterminate" })
  })

  it("escapes a bare const-alias of the whole capability -- `const alias = x;` is a real read this pass declines to follow further", () => {
    const edges = scan(`const alias = userCapability;`, [resolvedMatch("userCapability")])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "imports", resolution: "indeterminate" })
  })

  it("does not escalate `.getSnapshot().fields` used only as another expression's element-access key", () => {
    const edges = scan(`const k = registry[userCapability.getSnapshot().fields];`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toEqual([])
  })
})

describe("scanFileForUsage -- name-position collisions (ADR 0060)", () => {
  // This pass matches identifiers by text alone (ADR 0010): a local binding
  // name can coincidentally recur as some OTHER declaration's own label
  // elsewhere in the file. None of these is ever a reference to the tracked
  // binding, escaped or otherwise -- see `isNamePosition`'s own doc comment.

  it("ignores a same-named object-literal property key", () => {
    expect(scan(`const obj = { getUser: 1 };`, [resolvedMatch("getUser")])).toEqual([])
  })

  it("escapes a tracked binding used as an object-literal property's VALUE, distinct from being its key", () => {
    const edges = scan(`const obj = { someOtherKey: getUser };`, [resolvedMatch("getUser")])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "imports", resolution: "indeterminate" })
  })

  it("treats a same-named shorthand object-literal property as a real escape (it IS a value reference)", () => {
    const edges = scan(`const obj = { getUser };`, [resolvedMatch("getUser")])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "imports", resolution: "indeterminate" })
  })

  it("ignores a same-named interface property signature", () => {
    expect(scan(`interface Props { getUser: string }`, [resolvedMatch("getUser")])).toEqual([])
  })

  it("ignores a same-named class method declaration", () => {
    expect(scan(`class Widget { getUser() {} }`, [resolvedMatch("getUser")])).toEqual([])
  })

  it("ignores a same-named interface method signature", () => {
    expect(scan(`interface Api { getUser(): void }`, [resolvedMatch("getUser")])).toEqual([])
  })

  it("ignores a same-named class getter accessor", () => {
    expect(
      scan(`class Widget { get getUser() { return 1; } }`, [resolvedMatch("getUser")]),
    ).toEqual([])
  })

  it("ignores a same-named class setter accessor", () => {
    expect(scan(`class Widget { set getUser(v) {} }`, [resolvedMatch("getUser")])).toEqual([])
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

  it("never treats a re-export specifier as a usage", () => {
    const edges = scan(`export { userCapability };`, [resolvedMatch("userCapability")])
    expect(edges).toEqual([])
  })

  it("never treats a re-export specifier as a usage even alongside real usage elsewhere in the file", () => {
    const edges = scan(`export { userCapability };\nuserCapability.getUser();`, [
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

  it("reports a `.getSnapshot().fields` bare reference (no field access after it) as indeterminate, not silently dropped (ADR 0060)", () => {
    const edges = scan(`const f = userCapability.getSnapshot().fields;`, [
      resolvedMatch("userCapability"),
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ relationship: "reads-field", resolution: "indeterminate" })
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
