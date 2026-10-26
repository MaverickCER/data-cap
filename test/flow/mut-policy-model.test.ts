import { describe, expect, it } from "vitest"
import { buildFlowModel, flowNodeId, FlowModelError } from "../../src/flow/flow-model.js"
import type { FlowEdgeInput, FlowNodeInput } from "../../src/flow/flow-model.js"
import {
  buildPolicyModel,
  collectFlowPolicyRules,
  judgeCrossing,
} from "../../src/flow/policy-model.js"
import type { FlowPolicyRule } from "../../src/flow/policy-model.js"
import type { CapabilityInventory, CapabilityNode } from "../../src/build/inventory.js"
import { CAPABILITY_MODEL_SCHEMA_VERSION } from "../../src/build/inventory.js"

const F = "p.ts"
const field = (name: string, classification?: string): FlowNodeInput => ({
  kind: "field",
  scope: F,
  name,
  status: "static",
  ...(classification === undefined ? {} : { classification }),
})
const fn = (name: string, status: FlowNodeInput["status"] = "static"): FlowNodeInput => ({
  kind: "function",
  scope: F,
  name,
  status,
})
const bd = (name: string, boundaryKind?: FlowNodeInput["boundaryKind"]): FlowNodeInput => ({
  kind: "boundary",
  scope: "b",
  name,
  status: "static",
  ...(boundaryKind === undefined ? {} : { boundaryKind }),
})
const fieldId = (name: string) => flowNodeId("field", F, name)
const fnId = (name: string) => flowNodeId("function", F, name)
const bdId = (name: string) => flowNodeId("boundary", "b", name)
const EMAIL = fieldId("User.email")
const edge = (
  kind: FlowEdgeInput["kind"],
  from: string,
  to: string,
  extra: Partial<FlowEdgeInput> = {},
): FlowEdgeInput => ({ kind, from, to, status: "static", origin: EMAIL, ...extra })

describe("judgeCrossing", () => {
  const rule = (extra: Partial<FlowPolicyRule>): FlowPolicyRule => ({
    id: "r",
    appliesTo: { classification: "pii" },
    ...extra,
  })

  it("a forbidden kind is violated; a kind the rule does not mention is not concerned", () => {
    const r = rule({ forbidDestinations: ["log"] })
    expect(judgeCrossing(r, "log", [])).toStrictEqual({ outcome: "violated" })
    expect(judgeCrossing(r, "database", [])).toBeUndefined()
  })

  it("an allow-list is satisfied inside and violated outside", () => {
    const r = rule({ allowedDestinations: ["database"] })
    expect(judgeCrossing(r, "database", [])).toStrictEqual({ outcome: "satisfied" })
    expect(judgeCrossing(r, "log", [])).toStrictEqual({ outcome: "violated" })
  })

  it("an allow-list and a forbid list combine", () => {
    const r = rule({ allowedDestinations: ["database", "log"], forbidDestinations: ["log"] })
    expect(judgeCrossing(r, "log", [])).toStrictEqual({ outcome: "violated" })
    expect(judgeCrossing(r, "database", [])).toStrictEqual({ outcome: "satisfied" })
  })

  it("an unknown kind cannot be judged by a destination rule", () => {
    expect(judgeCrossing(rule({ forbidDestinations: ["log"] }), undefined, [])).toStrictEqual({
      outcome: "indeterminate",
      reason: "boundary-kind-unknown",
    })
    expect(judgeCrossing(rule({ allowedDestinations: [] }), undefined, [])).toStrictEqual({
      outcome: "indeterminate",
      reason: "boundary-kind-unknown",
    })
  })

  it("an empty forbid list or a handling rule alone is not a destination rule", () => {
    const handlingOnly = rule({ requireHandling: ["hashed"] })
    expect(judgeCrossing(handlingOnly, undefined, ["hashed"])).toStrictEqual({
      outcome: "satisfied",
    })
    expect(judgeCrossing(handlingOnly, "log", ["hashed"])).toStrictEqual({ outcome: "satisfied" })
    const emptyForbid = rule({ forbidDestinations: [], requireHandling: ["hashed"] })
    expect(judgeCrossing(emptyForbid, undefined, ["hashed"])).toStrictEqual({
      outcome: "satisfied",
    })
    expect(judgeCrossing(emptyForbid, "log", ["hashed"])).toStrictEqual({ outcome: "satisfied" })
  })

  describe("allowed handling exempts a crossing", () => {
    const r = rule({ forbidDestinations: ["log"], allowedHandling: ["hashed", "masked"] })
    it("when every crossing declares an allowed handling", () => {
      expect(judgeCrossing(r, "log", ["hashed"])).toStrictEqual({ outcome: "satisfied" })
      expect(judgeCrossing(r, "log", ["hashed", "masked"])).toStrictEqual({ outcome: "satisfied" })
    })
    it("not when there is no crossing to vouch for", () => {
      expect(judgeCrossing(r, "log", [])).toStrictEqual({ outcome: "violated" })
    })
    it("not when any crossing declares nothing or something else", () => {
      expect(judgeCrossing(r, "log", ["hashed", undefined])).toStrictEqual({ outcome: "violated" })
      expect(judgeCrossing(r, "log", [undefined])).toStrictEqual({ outcome: "violated" })
      expect(judgeCrossing(r, "log", ["hashed", "plaintext"])).toStrictEqual({
        outcome: "violated",
      })
      expect(judgeCrossing(r, "log", ["plaintext", "hashed"])).toStrictEqual({
        outcome: "violated",
      })
    })
    it("not when the rule allows no handling", () => {
      expect(judgeCrossing(rule({ forbidDestinations: ["log"] }), "log", ["hashed"])).toStrictEqual(
        { outcome: "violated" },
      )
    })
    it("never counts an undeclared handling as allowed, whatever the rule lists", () => {
      const odd = rule({ forbidDestinations: ["log"], allowedHandling: [undefined as never] })
      expect(judgeCrossing(odd, "log", [undefined])).toStrictEqual({ outcome: "violated" })
    })
    it("exempts a violation of an allow-list too", () => {
      const allow = rule({ allowedDestinations: ["database"], allowedHandling: ["hashed"] })
      expect(judgeCrossing(allow, "log", ["hashed"])).toStrictEqual({ outcome: "satisfied" })
      expect(judgeCrossing(allow, "log", ["masked"])).toStrictEqual({ outcome: "violated" })
    })
  })

  describe("required handling", () => {
    const r = rule({ requireHandling: ["hashed", "masked"] })
    it("is satisfied by allowed handlings and by no crossing at all", () => {
      expect(judgeCrossing(r, "log", ["hashed", "masked"])).toStrictEqual({ outcome: "satisfied" })
      expect(judgeCrossing(r, "log", [])).toStrictEqual({ outcome: "satisfied" })
    })
    it("is violated by any other declared handling, wherever it is", () => {
      expect(judgeCrossing(r, "log", ["plaintext"])).toStrictEqual({ outcome: "violated" })
      expect(judgeCrossing(r, "log", ["hashed", "plaintext"])).toStrictEqual({
        outcome: "violated",
      })
      expect(judgeCrossing(r, "log", ["plaintext", "hashed"])).toStrictEqual({
        outcome: "violated",
      })
      expect(judgeCrossing(r, "log", ["plaintext", undefined])).toStrictEqual({
        outcome: "violated",
      })
    })
    it("is undecided when a crossing declares nothing, wherever it is", () => {
      const undecided = { outcome: "indeterminate", reason: "handling-not-declared" }
      expect(judgeCrossing(r, "log", [undefined])).toStrictEqual(undecided)
      expect(judgeCrossing(r, "log", ["hashed", undefined])).toStrictEqual(undecided)
      expect(judgeCrossing(r, "log", [undefined, "hashed"])).toStrictEqual(undecided)
    })
  })

  describe("when a rule yields several verdicts the worst wins, the first among equals", () => {
    it("violated beats indeterminate, in either order", () => {
      const a = rule({ forbidDestinations: ["log"], requireHandling: ["hashed"] })
      expect(judgeCrossing(a, "log", [undefined])).toStrictEqual({ outcome: "violated" })
      const b = rule({ forbidDestinations: ["log"], requireHandling: ["hashed"] })
      expect(judgeCrossing(b, undefined, ["masked"])).toStrictEqual({ outcome: "violated" })
    })
    it("indeterminate beats satisfied, in either order", () => {
      const a = rule({ allowedDestinations: ["log"], requireHandling: ["hashed"] })
      expect(judgeCrossing(a, "log", [undefined])).toStrictEqual({
        outcome: "indeterminate",
        reason: "handling-not-declared",
      })
      expect(judgeCrossing(a, undefined, [])).toStrictEqual({
        outcome: "indeterminate",
        reason: "boundary-kind-unknown",
      })
    })
    it("violated beats satisfied", () => {
      const a = rule({ allowedDestinations: ["log"], requireHandling: ["hashed"] })
      expect(judgeCrossing(a, "log", ["masked"])).toStrictEqual({ outcome: "violated" })
    })
    it("keeps the first of two equally bad verdicts", () => {
      const a = rule({ forbidDestinations: ["log"], requireHandling: ["hashed"] })
      expect(judgeCrossing(a, undefined, [undefined])).toStrictEqual({
        outcome: "indeterminate",
        reason: "boundary-kind-unknown",
      })
    })
    it("two satisfied verdicts stay satisfied", () => {
      const a = rule({ allowedDestinations: ["log"], requireHandling: ["hashed"] })
      expect(judgeCrossing(a, "log", ["hashed"])).toStrictEqual({ outcome: "satisfied" })
    })
  })
})

describe("buildPolicyModel: validation", () => {
  const empty = buildFlowModel({ nodes: [], edges: [], unknowns: [] })
  const attempt =
    (...rules: FlowPolicyRule[]) =>
    () =>
      buildPolicyModel(empty, rules)

  it("refuses a duplicate id", () => {
    const r: FlowPolicyRule = {
      id: "dup",
      appliesTo: { classification: "pii" },
      forbidDestinations: ["log"],
    }
    expect(attempt(r, r)).toThrow(new FlowModelError('Duplicate policy rule id "dup".'))
  })

  it("refuses a rule that applies to nothing in particular", () => {
    expect(attempt({ id: "x", appliesTo: { scope: "p.ts" }, forbidDestinations: ["log"] })).toThrow(
      new FlowModelError('Policy rule "x" must set appliesTo.classification or appliesTo.field.'),
    )
  })

  it("accepts a rule with only a field, or only a classification", () => {
    expect(
      attempt({ id: "x", appliesTo: { field: "a" }, forbidDestinations: ["log"] }),
    ).not.toThrow()
    expect(
      attempt({ id: "x", appliesTo: { classification: "a" }, forbidDestinations: ["log"] }),
    ).not.toThrow()
  })

  it("refuses an empty path", () => {
    expect(
      attempt({
        id: "x",
        appliesTo: { classification: "pii", path: [] },
        forbidDestinations: ["log"],
      }),
    ).toThrow(
      new FlowModelError(
        'Policy rule "x" has an empty appliesTo.path; omit it to govern the whole field.',
      ),
    )
  })

  it("refuses a rule that constrains nothing", () => {
    const message =
      'Policy rule "x" does not constrain anything: set forbidDestinations, allowedDestinations or requireHandling.'
    expect(attempt({ id: "x", appliesTo: { classification: "pii" } })).toThrow(
      new FlowModelError(message),
    )
    expect(
      attempt({ id: "x", appliesTo: { classification: "pii" }, forbidDestinations: [] }),
    ).toThrow(new FlowModelError(message))
    expect(
      attempt({ id: "x", appliesTo: { classification: "pii" }, allowedHandling: ["hashed"] }),
    ).toThrow(new FlowModelError(message))
  })

  it("accepts each way of constraining", () => {
    const base = { id: "x", appliesTo: { classification: "pii" } }
    expect(attempt({ ...base, allowedDestinations: [] })).not.toThrow()
    expect(attempt({ ...base, requireHandling: [] })).not.toThrow()
    expect(attempt({ ...base, forbidDestinations: ["log"] })).not.toThrow()
  })
})

describe("buildPolicyModel: results", () => {
  const flow = buildFlowModel({
    nodes: [
      field("User.email", "pii"),
      field("User.name"),
      fn("h"),
      bd("http", "client-response"),
      bd("pg", "database"),
      bd("lg", "log"),
      bd("mystery"),
    ],
    edges: [
      edge("reads", EMAIL, fnId("h"), { path: ["x"] }),
      edge("side-effect", fnId("h"), bdId("http"), { status: "inferred" }),
      edge("side-effect", fnId("h"), bdId("lg"), { handling: "hashed" }),
      edge("side-effect", fnId("h"), bdId("pg"), { status: "declared" }),
      edge("side-effect", fnId("h"), bdId("mystery")),
    ],
    unknowns: [],
  })
  const reads = `reads:${EMAIL}->${fnId("h")}:x@static^${EMAIL}`
  const effect = (to: string, status: string) =>
    `side-effect:${fnId("h")}->${bdId(to)}@${status}^${EMAIL}`

  it("states every result exactly, ordered by rule, subject and boundary", () => {
    const model = buildPolicyModel(flow, [
      {
        id: "b-rule",
        appliesTo: { classification: "pii" },
        forbidDestinations: ["client-response", "log"],
        allowedHandling: ["hashed"],
      },
      { id: "a-rule", appliesTo: { field: "User.email" }, requireHandling: ["hashed"] },
      { id: "c-rule", appliesTo: { field: "Nope" }, forbidDestinations: ["log"] },
    ])
    expect(model.rules.map((r) => r.id)).toEqual(["a-rule", "b-rule", "c-rule"])
    expect(model.results).toStrictEqual([
      {
        ruleId: "a-rule",
        subject: EMAIL,
        boundary: bdId("http"),
        outcome: "indeterminate",
        reason: "handling-not-declared",
        basis: "unknown",
        edges: [reads, effect("http", "inferred")],
      },
      {
        ruleId: "a-rule",
        subject: EMAIL,
        boundary: bdId("lg"),
        outcome: "satisfied",
        basis: "static",
        edges: [reads, effect("lg", "static")],
      },
      {
        ruleId: "a-rule",
        subject: EMAIL,
        boundary: bdId("mystery"),
        outcome: "indeterminate",
        reason: "handling-not-declared",
        basis: "unknown",
        edges: [reads, effect("mystery", "static")],
      },
      {
        ruleId: "a-rule",
        subject: EMAIL,
        boundary: bdId("pg"),
        outcome: "indeterminate",
        reason: "handling-not-declared",
        basis: "unknown",
        edges: [reads, effect("pg", "declared")],
      },
      {
        ruleId: "b-rule",
        subject: EMAIL,
        boundary: bdId("http"),
        outcome: "violated",
        basis: "inferred",
        edges: [reads, effect("http", "inferred")],
      },
      {
        ruleId: "b-rule",
        subject: EMAIL,
        boundary: bdId("lg"),
        outcome: "satisfied",
        basis: "static",
        edges: [reads, effect("lg", "static")],
      },
      {
        ruleId: "b-rule",
        subject: EMAIL,
        boundary: bdId("mystery"),
        outcome: "indeterminate",
        reason: "boundary-kind-unknown",
        basis: "unknown",
        edges: [reads, effect("mystery", "static")],
      },
      {
        ruleId: "c-rule",
        outcome: "indeterminate",
        reason: "rule-matches-nothing",
        basis: "unknown",
        edges: [],
      },
    ])
    expect(model.summary).toEqual({ satisfied: 2, violated: 1, indeterminate: 5 })
  })

  it("orders rules and the subjects of a rule by id", () => {
    const two = buildFlowModel({
      nodes: [field("User.name", "pii"), field("User.email", "pii"), bd("lg", "log")],
      edges: [],
      unknowns: [],
    })
    const model = buildPolicyModel(two, [
      { id: "z", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
      { id: "m", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
    ])
    expect(model.results.map((r) => [r.ruleId, r.subject])).toEqual([
      ["m", EMAIL],
      ["m", fieldId("User.name")],
      ["z", EMAIL],
      ["z", fieldId("User.name")],
    ])
  })

  it("a field that reaches no boundary satisfies the rule on the weakest edge it has", () => {
    const quiet = buildFlowModel({
      nodes: [field("User.email", "pii"), fn("h"), fn("g")],
      edges: [
        edge("reads", EMAIL, fnId("h")),
        edge("passes", fnId("h"), fnId("g"), { status: "inferred" }),
      ],
      unknowns: [],
    })
    const model = buildPolicyModel(quiet, [
      { id: "r", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
    ])
    expect(model.results).toStrictEqual([
      { ruleId: "r", subject: EMAIL, outcome: "satisfied", basis: "inferred", edges: [] },
    ])
  })

  it("a field whose rule concerns none of the boundaries it reaches is satisfied outright", () => {
    const model = buildPolicyModel(flow, [
      { id: "r", appliesTo: { field: "User.name" }, forbidDestinations: ["log"] },
    ])
    expect(model.results).toStrictEqual([
      {
        ruleId: "r",
        subject: fieldId("User.name"),
        outcome: "satisfied",
        basis: "static",
        edges: [],
      },
    ])
  })

  it("an incomplete trace is stated first, ahead of the boundaries it did reach", () => {
    const partial = buildFlowModel({
      nodes: [field("User.email", "pii"), fn("h", "unknown"), bd("lg", "log"), bd("aa", "log")],
      edges: [
        edge("reads", EMAIL, fnId("h")),
        edge("side-effect", fnId("h"), bdId("lg")),
        edge("side-effect", fnId("h"), bdId("aa")),
      ],
      unknowns: [],
    })
    const model = buildPolicyModel(partial, [
      { id: "r", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
    ])
    expect(model.results.map((r) => [r.boundary, r.outcome, r.reason])).toEqual([
      [undefined, "indeterminate", "trace-incomplete"],
      [bdId("aa"), "violated", undefined],
      [bdId("lg"), "violated", undefined],
    ])
    expect(model.results[0]).toStrictEqual({
      ruleId: "r",
      subject: EMAIL,
      outcome: "indeterminate",
      reason: "trace-incomplete",
      basis: "unknown",
      edges: [],
    })
  })

  it("an incomplete trace that reaches nothing says only that", () => {
    const partial = buildFlowModel({
      nodes: [field("User.email", "pii"), fn("h", "unknown")],
      edges: [edge("reads", EMAIL, fnId("h"))],
      unknowns: [],
    })
    const model = buildPolicyModel(partial, [
      { id: "r", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
    ])
    expect(model.results).toStrictEqual([
      {
        ruleId: "r",
        subject: EMAIL,
        outcome: "indeterminate",
        reason: "trace-incomplete",
        basis: "unknown",
        edges: [],
      },
    ])
  })

  it("narrows the trace to the rule's path", () => {
    const pathed = buildFlowModel({
      nodes: [field("User.email", "pii"), fn("h"), bd("lg", "log")],
      edges: [
        edge("reads", EMAIL, fnId("h"), { path: ["name"] }),
        edge("side-effect", fnId("h"), bdId("lg"), { path: ["name"] }),
      ],
      unknowns: [],
    })
    const rule = (path?: string[]): FlowPolicyRule => ({
      id: "r",
      appliesTo: { classification: "pii", ...(path === undefined ? {} : { path }) },
      forbidDestinations: ["log"],
    })
    expect(buildPolicyModel(pathed, [rule()]).results.map((r) => r.outcome)).toEqual(["violated"])
    expect(buildPolicyModel(pathed, [rule(["name"])]).results.map((r) => r.outcome)).toEqual([
      "violated",
    ])
    expect(buildPolicyModel(pathed, [rule(["email"])]).results.map((r) => r.outcome)).toEqual([
      "satisfied",
    ])
  })

  it("matches only field nodes, and every supplied criterion", () => {
    const mixed = buildFlowModel({
      nodes: [
        field("User.email", "pii"),
        { kind: "function", scope: F, name: "User.email", status: "static", classification: "pii" },
        { ...field("User.other", "pii"), scope: "other.ts" },
        field("User.third", "secret"),
      ],
      edges: [],
      unknowns: [],
    })
    const subjects = (appliesTo: FlowPolicyRule["appliesTo"]) =>
      buildPolicyModel(mixed, [{ id: "r", appliesTo, forbidDestinations: ["log"] }]).results.map(
        (r) => r.subject,
      )
    expect(subjects({ classification: "pii" })).toEqual([
      flowNodeId("field", "other.ts", "User.other"),
      EMAIL,
    ])
    expect(subjects({ classification: "pii", scope: F })).toEqual([EMAIL])
    expect(subjects({ classification: "pii", field: "User.other" })).toEqual([
      flowNodeId("field", "other.ts", "User.other"),
    ])
    expect(subjects({ field: "User.email" })).toEqual([EMAIL])
    expect(subjects({ classification: "secret", field: "User.email" })).toEqual([undefined])
  })
})

describe("collectFlowPolicyRules", () => {
  function cap(
    exportName: string,
    file: string,
    flowPolicy: unknown,
    active = true,
  ): CapabilityNode {
    return {
      file,
      exportName,
      kind: "createData",
      docs: flowPolicy === undefined ? undefined : ({ flowPolicy } as never),
      active,
      exclusiveGroup: undefined,
      declarationPosition: { line: 1, column: 1 },
      fields: [],
      getters: [],
      mutators: [],
      subscriptions: [],
    }
  }
  const inv = (...capabilities: CapabilityNode[]): CapabilityInventory => ({
    schemaVersion: CAPABILITY_MODEL_SCHEMA_VERSION,
    capabilities,
    warnings: [],
  })

  it("carries exactly the keys a declaration sets", () => {
    expect(
      collectFlowPolicyRules(
        inv(
          cap("c", "c.ts", [
            { id: "r", appliesTo: { classification: "pii" }, forbidDestinations: ["log"] },
          ]),
        ),
      ),
    ).toStrictEqual([
      {
        id: "c/r",
        appliesTo: { classification: "pii", scope: "c.ts" },
        forbidDestinations: ["log"],
      },
    ])
    expect(
      collectFlowPolicyRules(
        inv(
          cap("c", "c.ts", [{ id: "r", appliesTo: { field: "f" }, requireHandling: ["hashed"] }]),
        ),
      ),
    ).toStrictEqual([
      { id: "c/r", appliesTo: { field: "c.f", scope: "c.ts" }, requireHandling: ["hashed"] },
    ])
  })

  it("carries every optional part when set", () => {
    expect(
      collectFlowPolicyRules(
        inv(
          cap("c", "c.ts", [
            {
              id: "r",
              description: "why",
              appliesTo: { classification: "pii", field: "f", path: ["p"] },
              forbidDestinations: ["log"],
              allowedDestinations: ["database"],
              allowedHandling: ["hashed"],
              requireHandling: ["masked"],
            },
          ]),
        ),
      ),
    ).toStrictEqual([
      {
        id: "c/r",
        appliesTo: { classification: "pii", field: "c.f", path: ["p"], scope: "c.ts" },
        description: "why",
        forbidDestinations: ["log"],
        allowedDestinations: ["database"],
        allowedHandling: ["hashed"],
        requireHandling: ["masked"],
      },
    ])
  })

  it("skips inactive capabilities and keeps the rest in order", () => {
    const rule = (id: string) => ({
      id,
      appliesTo: { classification: "x" },
      forbidDestinations: ["log"],
    })
    const rules = collectFlowPolicyRules(
      inv(cap("a", "a.ts", [rule("one")], false), cap("b", "b.ts", [rule("two"), rule("three")])),
    )
    expect(rules.map((r) => r.id)).toEqual(["b/two", "b/three"])
  })
})
