/**
 * NIST OSCAL assessment-results for the Evidence Model's declared flow
 * policies (ADR 0070): control coverage and assessment status in the
 * standard compliance vocabulary, as a pure projection of the one evidence
 * object.
 *
 * Control identifiers belong to the people who own the control catalog, so
 * they are **supplied by the caller and never inferred**: a mapping from a
 * data-cap rule id to the control ids it is evidence for. A rule with no
 * mapping is listed as `unmapped-rule` rather than dropped, and with no
 * mapping at all the result says so instead of implying a review took place.
 *
 * Status is never stronger than the evidence (ADR 0071). A rule is
 * `satisfied` only when every result for it holds; one violation, or one
 * contradicting observation, makes it `not-satisfied` (`fail`); a result the
 * analysis could not decide is `not-satisfied` with the reason `other` and the
 * reason stated -- "could not prove" is not "proved". A satisfied rule says
 * whether it was also observed at runtime.
 *
 * Emits OSCAL 1.1.2 assessment-results. `test/evidence/flow-oscal.test.ts` validates the
 * output against the NIST JSON Schema with Ajv.
 */

import { flowEvidenceDisclaimer } from "./flow-disclaimer.js"
import type { EvidenceModel } from "../build/evidence-model.js"
import type { Claim } from "../flow/claims-model.js"
import type { PolicyIndeterminateReason, PolicyResult } from "../flow/policy-model.js"
import { deterministicUuid } from "./uuid.js"

/** A control's part id in NIST's OSCAL catalogs: `<control>_obj` or `<control>_smt`, optionally with an item suffix. */
const PART_ID = /^([^_]+)_(obj|smt)(?:\..+)?$/

/**
 * @param id - A control id (`ac-4`) or a part id (`ac-4_obj`, `ac-4_smt.a`).
 * @returns The control the id belongs to, and the finding target for it.
 */
function oscalTarget(id: string): {
  readonly control: string
  readonly type: "objective-id" | "statement-id"
  readonly targetId: string
} {
  const part = PART_ID.exec(id)
  if (part === null) return { control: id, type: "objective-id", targetId: `${id}_obj` }
  return {
    control: part[1] ?? id,
    type: part[2] === "smt" ? "statement-id" : "objective-id",
    targetId: id,
  }
}

/** Options for `buildOscalAssessmentResults`. */
export interface OscalOptions {
  /**
   * data-cap rule id (as in `evidence.policy.rules[].id`, for example `userData/no-pii-to-log`) to the
   * control ids it is evidence for. Never inferred. A control id (`ac-4`) is targeted at its
   * assessment objective (`ac-4_obj`), the part id NIST's SP 800-53 OSCAL catalog gives it; an id that
   * already names a part (`ac-4_obj`, `ac-4_smt`, `ac-4_smt.a`) is targeted as given. Name each
   * objective once: `ac-4` and `ac-4_obj` are the same target and would give two findings.
   */
  readonly controls: Readonly<Record<string, readonly string[]>>
  /** Document title (default `data-cap data-flow assessment`). */
  readonly title?: string | undefined
  /**
   * `href` of the assessment plan this result imports. OSCAL requires one; without it the document
   * carries the placeholder `#data-cap-assessment-plan` and says so in `import-ap.remarks`, which is
   * enough for review and nothing an OSCAL tool-chain should resolve. See {@link strict}.
   */
  readonly assessmentPlan?: string | undefined
  /**
   * `href` the evidence file is reachable at from where the document will live (for example
   * `docs/data.evidence.json`). With it, every evidence reference becomes a back-matter resource
   * with an `rlink`, and each observation's `relevant-evidence` points at that resource, so a
   * tool-chain can follow the trail; without it the references stay descriptive text.
   */
  readonly evidenceHref?: string | undefined
  /**
   * Refuse to build a document a tool-chain could not use: `true` requires {@link assessmentPlan}
   * and {@link evidenceHref}, and throws when either is missing. The default builds the reviewable
   * document with placeholders named as such.
   */
  readonly strict?: boolean | undefined
}

/** The OSCAL assessment-results document, restricted to what this projection populates. */
export interface OscalAssessmentResults {
  readonly "assessment-results": {
    readonly uuid: string
    readonly metadata: {
      readonly title: string
      readonly "last-modified": string
      readonly version: string
      readonly "oscal-version": string
      /** The shared evidence disclaimer: this document supports a review and establishes nothing by itself. */
      readonly remarks: string
    }
    readonly "import-ap": { readonly href: string; readonly remarks?: string }
    readonly results: readonly {
      readonly uuid: string
      readonly title: string
      readonly description: string
      readonly start: string
      readonly end: string
      readonly props?: readonly { readonly name: string; readonly value: string }[]
      readonly "reviewed-controls": {
        readonly "control-selections": readonly {
          readonly description?: string
          readonly "include-controls"?: readonly { readonly "control-id": string }[]
        }[]
      }
      readonly observations?: readonly {
        readonly uuid: string
        readonly description: string
        readonly methods: readonly ("EXAMINE" | "TEST")[]
        readonly types: readonly string[]
        readonly collected: string
        readonly "relevant-evidence"?: readonly {
          readonly href?: string
          readonly description: string
        }[]
      }[]
      readonly findings?: readonly {
        readonly uuid: string
        readonly title: string
        readonly description: string
        readonly target: {
          readonly type: "objective-id" | "statement-id"
          readonly "target-id": string
          readonly status: {
            readonly state: "satisfied" | "not-satisfied"
            readonly reason: "pass" | "fail" | "other"
            readonly remarks?: string
          }
        }
        readonly "related-observations"?: readonly { readonly "observation-uuid": string }[]
      }[]
    }[]
    /** One resource per evidence reference, each resolving to the evidence file; present only with `evidenceHref`. */
    readonly "back-matter"?: {
      readonly resources: readonly {
        readonly uuid: string
        readonly title: string
        readonly description: string
        readonly rlinks: readonly { readonly href: string; readonly "media-type": string }[]
      }[]
    }
  }
}

/** What the projection reads from the Evidence Model. */
export type OscalInput = Pick<EvidenceModel, "flow" | "policy" | "claims" | "provenance">

interface RuleStatus {
  readonly state: "satisfied" | "not-satisfied"
  readonly reason: "pass" | "fail" | "other"
  readonly remarks: string
}

function statusOf(results: readonly PolicyResult[], claims: readonly Claim[]): RuleStatus {
  const indeterminateText: Readonly<Record<PolicyIndeterminateReason, string>> = {
    "rule-matches-nothing": "the rule matches no field",
    "trace-incomplete": "the flow of the governed data reaches code the analysis could not follow",
    "handling-not-declared": "a governed crossing declares no handling",
    "boundary-kind-unknown": "a destination the data reaches has no known kind",
  }
  const violated = results.filter((result) => result.outcome === "violated")
  if (violated.length > 0) {
    return {
      state: "not-satisfied",
      reason: "fail",
      remarks: `Violated for ${[...new Set(violated.map((r) => r.subject ?? "a field"))].join(", ")} (established by ${[...new Set(violated.map((r) => r.basis))].join(", ")} analysis).`,
    }
  }
  const contradicted = claims.filter((claim) => claim.verification === "contradicted")
  if (contradicted.length > 0) {
    return {
      state: "not-satisfied",
      reason: "fail",
      remarks: "Holds statically but is contradicted by runtime observation.",
    }
  }
  const undecided = results.filter((result) => result.outcome === "indeterminate")
  if (undecided.length > 0) {
    const why = [
      ...new Set(
        undecided.flatMap((result) =>
          result.reason === undefined ? [] : [indeterminateText[result.reason]],
        ),
      ),
    ].join("; ")
    return {
      state: "not-satisfied",
      reason: "other",
      remarks: `Could not be decided by static analysis: ${why}.`,
    }
  }
  const scopes = [...new Set(claims.flatMap((claim) => claim.scope.observationScopes))]
  return {
    state: "satisfied",
    reason: "pass",
    remarks:
      scopes.length === 0
        ? "Established by static analysis; not observed at runtime."
        : `Established by static analysis and corroborated by runtime observation in ${scopes.length} scope(s).`,
  }
}

/**
 * @param options - The caller's options.
 * @returns The assessment plan and evidence hrefs with blank values treated as absent, in either mode.
 * @throws In strict mode, when either is absent: a tool-chain could not resolve the document.
 */
function resolveLinks(options: OscalOptions): {
  readonly assessmentPlan: string | undefined
  readonly evidenceHref: string | undefined
} {
  const blank = (value: string | undefined): boolean => value === undefined || value.trim() === ""
  const assessmentPlan = blank(options.assessmentPlan) ? undefined : options.assessmentPlan
  const evidenceHref = blank(options.evidenceHref) ? undefined : options.evidenceHref
  if (options.strict === true) {
    const missing = [
      assessmentPlan === undefined ? "assessmentPlan" : undefined,
      evidenceHref === undefined ? "evidenceHref" : undefined,
    ].filter((name): name is string => name !== undefined)
    if (missing.length > 0) {
      throw new Error(
        `OSCAL strict mode needs ${missing.join(" and ")}: a tool-chain must be able to resolve the assessment plan and the evidence.`,
      )
    }
  }
  return { assessmentPlan, evidenceHref }
}

/** Projects the policy results and claims into OSCAL assessment-results, or `undefined` when no flow was computed. */

export function buildOscalAssessmentResults(
  evidence: OscalInput,
  options: OscalOptions,
): OscalAssessmentResults | undefined {
  if (evidence.flow === undefined) return undefined
  const { assessmentPlan, evidenceHref } = resolveLinks(options)
  const stamp = evidence.provenance.generatedAt
  const seed = `${stamp}|${evidence.provenance.commit ?? ""}`
  const { policy, claims } = evidence

  // Every evidence reference becomes a back-matter resource when the evidence file has an href, so
  // `relevant-evidence[].href` can point at it (`#<uuid>`), the way OSCAL tools follow a trail.
  type Resource = NonNullable<
    OscalAssessmentResults["assessment-results"]["back-matter"]
  >["resources"][number]
  const resources = new Map<string, Resource>()
  const evidenceReference = (
    role: "supporting" | "contradicting",
    ref: { readonly model: string; readonly id: string },
  ): { href?: string; description: string } => {
    const description = `${role}: ${ref.model} ${ref.id}`
    if (evidenceHref === undefined) return { description }
    // The resource is a pure function of the reference, so a repeat reference rebuilds the same one
    // and the map keeps a single copy per record.
    const key = `${ref.model}|${ref.id}`
    const resource: Resource = {
      uuid: deterministicUuid(`${seed}|resource|${key}`),
      title: `${ref.model} ${ref.id}`,
      description: `data-cap evidence: the ${ref.model} record ${ref.id} in the Evidence Model.`,
      rlinks: [{ href: evidenceHref, "media-type": "application/json" }],
    }
    resources.set(key, resource)
    return { href: `#${resource.uuid}`, description }
  }
  const rules =
    policy === undefined
      ? []
      : policy.rules.map((rule) => ({
          id: rule.id,
          results: policy.results.filter((result) => result.ruleId === rule.id),
        }))

  const mapped = rules.flatMap(({ id, results }) => {
    const controls = options.controls[id]
    return controls === undefined || controls.length === 0 ? [] : [{ id, controls, results }]
  })
  const unmapped = rules
    .filter(({ id }) => !mapped.some((entry) => entry.id === id))
    .map(({ id }) => id)
  const controlIds = [
    ...new Set(mapped.flatMap((entry) => entry.controls.map((id) => oscalTarget(id).control))),
  ].sort()

  type Result = OscalAssessmentResults["assessment-results"]["results"][number]
  const observations: NonNullable<Result["observations"]>[number][] = []
  const findings: NonNullable<Result["findings"]>[number][] = []

  for (const { id: ruleId, controls, results } of mapped) {
    const ruleClaims =
      claims === undefined
        ? []
        : claims.claims.filter((claim) => claim.kind === "policy-holds" && claim.object === ruleId)
    const status = statusOf(results, ruleClaims)

    const linked = ruleClaims.map((claim) => {
      const uuid = deterministicUuid(`${seed}|observation|${claim.id}`)
      const evidenceRefs = [
        ...claim.supporting.map((ref) => evidenceReference("supporting", ref)),
        ...claim.contradicting.map((ref) => evidenceReference("contradicting", ref)),
      ]
      observations.push({
        uuid,
        description: `${claim.statement}: ${claim.verification} (${claim.status}).`,
        methods: claim.scope.observationScopes.length > 0 ? ["EXAMINE", "TEST"] : ["EXAMINE"],
        types: ["finding"],
        collected: stamp,
        ...(evidenceRefs.length === 0 ? {} : { "relevant-evidence": evidenceRefs }),
      })
      return { "observation-uuid": uuid }
    })

    for (const control of controls) {
      findings.push({
        uuid: deterministicUuid(`${seed}|finding|${ruleId}|${control}`),
        title: `${ruleId} -- ${control}`,
        description: `data-cap data-flow rule ${ruleId} as evidence for ${control}.`,
        target: {
          type: oscalTarget(control).type,
          "target-id": oscalTarget(control).targetId,
          status: { state: status.state, reason: status.reason, remarks: status.remarks },
        },
        ...(linked.length === 0 ? {} : { "related-observations": linked }),
      })
    }
  }
  findings.sort((a, b) => a.uuid.localeCompare(b.uuid, "en"))

  const description =
    mapped.length === 0
      ? "data-cap data-flow assessment. No controls were mapped to data-cap rules, so no findings are reported."
      : `data-cap data-flow assessment of ${mapped.length} rule(s) against ${controlIds.length} control(s).`

  return {
    "assessment-results": {
      uuid: deterministicUuid(`${seed}|assessment-results`),
      metadata: {
        title: options.title ?? "data-cap data-flow assessment",
        "last-modified": stamp,
        version: evidence.provenance.toolVersion,
        "oscal-version": "1.1.2",
        remarks: flowEvidenceDisclaimer(),
      },
      "import-ap":
        assessmentPlan === undefined
          ? {
              href: "#data-cap-assessment-plan",
              remarks:
                "Placeholder: no assessment plan was supplied. Pass `assessmentPlan` to reference a real one; this document supports a review and establishes nothing by itself.",
            }
          : { href: assessmentPlan },
      results: [
        {
          uuid: deterministicUuid(`${seed}|result`),
          title: "Data-flow policy results",
          description,
          start: stamp,
          end: stamp,
          ...(unmapped.length === 0
            ? {}
            : { props: unmapped.map((value) => ({ name: "unmapped-rule", value })) }),
          "reviewed-controls": {
            "control-selections": [
              controlIds.length === 0
                ? { description: "No controls were mapped to data-cap rules." }
                : { "include-controls": controlIds.map((id) => ({ "control-id": id })) },
            ],
          },
          ...(observations.length === 0 ? {} : { observations }),
          ...(findings.length === 0 ? {} : { findings }),
        },
      ],
      ...(resources.size === 0
        ? {}
        : {
            "back-matter": {
              resources: [...resources.values()].sort((a, b) => a.uuid.localeCompare(b.uuid, "en")),
            },
          }),
    },
  }
}
