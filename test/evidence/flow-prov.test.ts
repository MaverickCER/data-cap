import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildProvDocument } from "../../src/evidence/flow-prov.js"
import type { ProvDocument } from "../../src/evidence/flow-prov.js"
import { profileFixture } from "../support/flow-evidence-fixture.js"
import type { FlowEvidenceFixture } from "../support/flow-evidence-fixture.js"

/** The id of the one record in `section` whose `dc:name` is `name`. */
function idByName(section: Record<string, Record<string, unknown>>, name: string): string {
  const entry = Object.entries(section).find(([, attributes]) => attributes["dc:name"] === name)
  if (entry === undefined) throw new Error(`no record named ${name}`)
  return entry[0]
}

describe("buildProvDocument (W3C PROV-JSON)", () => {
  let fixture: FlowEvidenceFixture
  let prov: ProvDocument

  beforeAll(async () => {
    fixture = await profileFixture({
      observations: [
        {
          scope: "test:profile",
          boundary: { kind: "client-response", name: "http-response" },
          field: "userData.user.email",
        },
      ],
    })
    prov = buildProvDocument(fixture.evidence)!
  })
  afterAll(async () => {
    await fixture.cleanup()
  })

  const ids = (section: Record<string, unknown> | undefined): string[] => Object.keys(section ?? {})
  const all = (): Set<string> =>
    new Set([...ids(prov.entity), ...ids(prov.activity), ...ids(prov.agent)])
  const relations = (): Record<string, Record<string, unknown>>[] =>
    [
      prov.used,
      prov.wasGeneratedBy,
      prov.wasDerivedFrom,
      prov.wasAssociatedWith,
      prov.wasInformedBy,
    ].filter((section): section is Record<string, Record<string, unknown>> => section !== undefined)

  it("declares the prov, xsd and data-cap prefixes, and uses no other", () => {
    expect(Object.keys(prov.prefix).sort()).toEqual(["dc", "prov", "xsd"])
    // Only positions that PROV-JSON defines as qualified names: record ids, attribute names, the endpoints of a
    // relation, prov:type values and typed-literal types. Literal values such as a boundary named "postgres:users"
    // are text, not names.
    const used = new Set<string>()
    const note = (name: string): void => {
      const match = /^([A-Za-z][\w-]*):/.exec(name)
      if (match !== null) used.add(match[1]!)
    }
    for (const section of [
      prov.entity,
      prov.activity,
      prov.agent,
      prov.used,
      prov.wasGeneratedBy,
      prov.wasDerivedFrom,
      prov.wasAssociatedWith,
      prov.wasInformedBy,
    ]) {
      for (const [id, attributes] of Object.entries(section ?? {})) {
        if (!id.startsWith("_:")) note(id)
        for (const [name, value] of Object.entries(attributes)) {
          note(name)
          if (name === "prov:type" && typeof value === "string") note(value)
          if (name.startsWith("prov:") && !name.endsWith("Time") && typeof value === "string")
            note(value)
          if (typeof value === "object" && value !== null && "type" in value)
            note(String(value.type))
        }
      }
    }
    expect([...used].sort()).toEqual(["dc", "prov", "xsd"])
    for (const prefix of used)
      expect(prov.prefix, `undeclared prefix ${prefix}`).toHaveProperty(prefix)
  })

  it("names the tool as a software agent and the run as an activity it is associated with", () => {
    expect(prov.agent["dc:tool"]).toMatchObject({
      "prov:type": "prov:SoftwareAgent",
      "dc:name": "data-cap",
    })
    expect(prov.activity["dc:analysis"]).toBeDefined()
    expect(prov.activity["dc:analysis"]?.["prov:endTime"]).toEqual({
      $: "2026-01-01T00:00:00.000Z",
      type: "xsd:dateTime",
    })
    expect(prov.activity["dc:analysis"]?.["dc:commit"]).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    )
    const association = Object.values(prov.wasAssociatedWith ?? {})
    expect(association).toContainEqual({ "prov:activity": "dc:analysis", "prov:agent": "dc:tool" })
  })

  it("maps fields, parameters, returns and boundaries to entities and functions to activities", () => {
    const entity = (name: string) =>
      Object.entries(prov.entity).find(([, attrs]) => attrs["dc:name"] === name)?.[1]
    expect(entity("userData.user")).toMatchObject({
      "prov:type": "dc:Field",
      "dc:classification": "confidential",
    })
    expect(entity("buildUserProfile.user")).toMatchObject({ "prov:type": "dc:Parameter" })
    expect(entity("buildUserProfile#return")).toMatchObject({ "prov:type": "dc:ReturnValue" })
    expect(entity("http-response")).toMatchObject({
      "prov:type": "dc:Boundary",
      "dc:boundaryKind": "client-response",
    })
    const fn = Object.entries(prov.activity).find(
      ([, attrs]) => attrs["dc:name"] === "buildUserProfile",
    )?.[1]
    expect(fn).toMatchObject({ "prov:type": "dc:Function", "dc:status": "static" })
  })

  it("expresses the lineage: a function used its input and generated its output, with the path and status on the relation", () => {
    const fnId = idByName(prov.activity, "buildUserProfile")
    const inputId = idByName(prov.entity, "buildUserProfile.user")
    const outputId = idByName(prov.entity, "buildUserProfile#return")
    const used = Object.values(prov.used ?? {}).filter(
      (relation) => relation["prov:activity"] === fnId && relation["prov:entity"] === inputId,
    )
    expect(used.map((relation) => relation["dc:path"]).sort()).toEqual(["email", "id", "name"])
    expect(used.every((relation) => relation["dc:status"] === "static")).toBe(true)
    const generated = Object.values(prov.wasGeneratedBy ?? {}).filter(
      (relation) => relation["prov:entity"] === outputId && relation["prov:activity"] === fnId,
    )
    expect(generated.length).toBeGreaterThan(0)
  })

  it("records a dropped path as a use with the role discarded, so the omission is not lost", () => {
    const discarded = Object.values(prov.used ?? {}).filter(
      (relation) => relation["dc:role"] === "discarded",
    )
    expect(discarded.map((relation) => relation["dc:path"]).sort()).toEqual(
      expect.arrayContaining(["passwordHash", "role"]),
    )
  })

  it("records the declared database as the source the field derives from", () => {
    const derived = Object.values(prov.wasDerivedFrom ?? {}).filter(
      (relation) => relation["dc:status"] === "declared",
    )
    expect(derived.length).toBeGreaterThan(0)
  })

  it("records calls as activities informed by their callers", () => {
    expect(Object.keys(prov.wasInformedBy ?? {}).length).toBeGreaterThan(0)
  })

  it("represents each claim as an entity generated by the analysis, with its verification and the entities it is derived from", () => {
    const claim = Object.entries(prov.entity).find(
      ([, attrs]) =>
        attrs["prov:type"] === "dc:Claim" &&
        String(attrs["dc:statement"]).startsWith("Rule userData/no-password-to-client holds"),
    )
    expect(claim?.[1]).toMatchObject({ "dc:verification": "contradicted", "dc:status": "static" })
    if (claim === undefined) throw new Error("no policy claim")
    const claimId = claim[0]
    expect(Object.values(prov.wasGeneratedBy ?? {})).toContainEqual({
      "prov:entity": claimId,
      "prov:activity": "dc:analysis",
    })
    const derivedFrom = Object.values(prov.wasDerivedFrom ?? {}).filter(
      (relation) => relation["prov:generatedEntity"] === claimId,
    )
    expect(derivedFrom.length).toBeGreaterThan(0)
  })

  it("represents an observation as an entity generated by its scope's activity, and links the claims it supports", () => {
    const scope = Object.entries(prov.activity).find(
      ([, attrs]) => attrs["prov:type"] === "dc:ObservationScope",
    )
    expect(scope?.[1]).toMatchObject({ "dc:name": "test:profile" })
    const observation = Object.entries(prov.entity).find(
      ([, attrs]) => attrs["prov:type"] === "dc:Observation",
    )
    expect(observation?.[1]).toMatchObject({ "dc:field": "userData.user.email", "dc:count": 1 })
    expect(Object.values(prov.wasGeneratedBy ?? {})).toContainEqual({
      "prov:entity": observation?.[0],
      "prov:activity": scope?.[0],
    })
    const supported = Object.values(prov.wasDerivedFrom ?? {}).filter(
      (relation) => relation["prov:usedEntity"] === observation?.[0],
    )
    expect(supported.length).toBeGreaterThan(0)
  })

  it("is referentially closed: every relation names records that exist", () => {
    const known = all()
    for (const section of relations()) {
      for (const [key, relation] of Object.entries(section)) {
        expect(key.startsWith("_:")).toBe(true)
        for (const [attr, value] of Object.entries(relation)) {
          if (attr.startsWith("prov:") && typeof value === "string" && !attr.endsWith("Time")) {
            expect(known.has(value), `${key}.${attr} -> ${value}`).toBe(true)
          }
        }
      }
    }
  })

  it("uses identifiers that are valid qualified names", () => {
    for (const id of [...all()]) {
      expect(id, id).toMatch(/^[a-z]+:[A-Za-z0-9._~%-]+$/)
      expect(id.endsWith("."), id).toBe(false)
    }
  })

  it("is deterministic and JSON round-trips", () => {
    expect(buildProvDocument(fixture.evidence)).toEqual(prov)
    expect(JSON.parse(JSON.stringify(prov))).toEqual(prov)
  })

  it("returns undefined when no flow was computed", async () => {
    const without = await profileFixture({ flowEvidence: false })
    try {
      expect(buildProvDocument(without.evidence)).toBeUndefined()
    } finally {
      await without.cleanup()
    }
  })
})
