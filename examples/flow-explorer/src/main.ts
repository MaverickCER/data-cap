/**
 * Tier 4 -- "Can I see, for any one piece of data, every function that touches
 * it and everywhere it goes -- and trust the picture?"
 *
 * This is the example's end-to-end regression test: it runs the real handlers
 * to record what actually leaves the service, runs the real analysis over the
 * real source, and asserts the facts the whole feature exists to establish.
 * A thrown assertion is a genuine non-zero-exit regression.
 *
 * The scenario is a profile page (src/app/profile.ts), a debug endpoint left in
 * by mistake that sends the whole record to the client (src/app/export.ts), and
 * an analytics call into a third-party SDK (src/app/track.ts), all reading one
 * capability (src/features/user.capability.ts) with two declared flow rules.
 */
import assert from "node:assert/strict"
import {
  analyzeLeastData,
  buildFlowGraphView,
  evaluateEvidenceRules,
  renderFlowText,
  traceFlow,
} from "data-cap/evidence"
import { recordScenario } from "./instrumentation.js"
import { compareEvidence } from "../scripts/explorer/compare.js"
import { runPipeline } from "../scripts/lib/pipeline.js"

const observations = await recordScenario()
const result = await runPipeline({ observations })
const { evidence } = result
const flow = evidence.flow
assert.ok(flow, "flow analysis ran")
const view = buildFlowGraphView(evidence)
assert.ok(view, "a graph view exists when a flow was computed")

// ---- 1. Field-level, interprocedural flow -------------------------------------------------------
const fn = (name: string) => {
  const found = view.functions.find((candidate) => candidate.name === name)
  assert.ok(found, `function ${name} is in the evidence`)
  return found
}
const paths = (items: readonly { readonly path: readonly string[] }[]) => items.map((item) => item.path.join(".")).sort()

const build = fn("buildUserProfile")
assert.deepEqual(paths(build.reads), ["email", "id", "name"], "buildUserProfile reads id, name and email")
assert.deepEqual(paths(build.forwards.filter((f) => f.kind === "returns")), ["email", "id", "name"], "...and returns them")
assert.deepEqual(paths(build.discards), ["passwordHash", "role"], "...and discards passwordHash and role")
assert.deepEqual(fn("sendProfileToClient").sideEffects.map((e) => e.boundaryKind), ["client-response", "client-response", "client-response"])

const user = view.fields.find((field) => field.name === "userData.user")
assert.ok(user, "the user field is in the evidence")
const reachesClient = (path: string) =>
  traceFlow(flow, user.id, "downstream", { path: [path] }).nodes.filter((n) => n.kind === "function").map((n) => n.name)
assert.ok(reachesClient("email").includes("sendProfileToClient"), "email reaches the client through the profile page")
assert.ok(!reachesClient("passwordHash").includes("sendProfileToClient"), "passwordHash does not go through the profile page")
assert.ok(reachesClient("passwordHash").includes("exportEverything"), "...but it does reach the debug export")

// ---- 2. Least data ------------------------------------------------------------------------------
const lean = analyzeLeastData({ capability: evidence.capability, flow })
assert.deepEqual(lean.wholeFieldToClient.map((w) => w.field), ["user"], "the debug export sends the whole record to a client")
assert.deepEqual(lean.wholeFieldToClient[0]?.keys, ["id", "name", "email", "passwordHash", "role"])

// ---- 3. Policies, enforced as a build gate ------------------------------------------------------
assert.deepEqual(
  evidence.policy?.results.map((r) => `${r.ruleId}:${r.outcome}`).sort(),
  ["userData/no-password-to-client:violated", "userData/no-role-to-log:satisfied"],
  "the leak violates its rule; the role rule holds, and the analytics call does not blur it",
)
assert.equal(result.hasBlockingErrors, true, "a violated policy blocks the build")
assert.ok(result.findings.some((f) => f.code === "FLOW_POLICY_VIOLATED" && f.severity === "error"))

// ---- 4. What the analysis could not follow is recorded, not hidden ------------------------------
assert.equal(flow.unknowns.length, 1, "exactly one place could not be followed")
const unknown = flow.unknowns[0]
assert.equal(unknown?.source.file, "src/app/track.ts", "the analytics call, by file and line")
assert.deepEqual(unknown?.data?.map((d) => d.path.join(".")), ["email"], "and it only ever received the email")
assert.equal(flow.coverage.complete, false, "so the picture says it is not complete")
assert.equal(fn("trackUser").confidence, "inferred")

// ---- 5. Runtime observation, joined to the static claims ----------------------------------------
const claim = (kind: string, object: string) => evidence.claims?.claims.find((c) => c.kind === kind && c.object === object)
assert.equal(claim("field-reaches-boundary", "http-response")?.verification, "verified", "the static flow to the client was seen at runtime")
assert.equal(claim("policy-holds", "userData/no-password-to-client")?.verification, "contradicted", "the leak was seen at runtime too")
assert.equal(claim("policy-holds", "userData/no-role-to-log")?.verification, "verified")
assert.equal(claim("field-sourced-from-boundary", "postgres:users")?.verification, "unobserved", "no database boundary was instrumented, and the evidence says so")

// ---- 6. Deterministic rules over the evidence ---------------------------------------------------
const gate = evaluateEvidenceRules(evidence, { noPolicyViolations: true, maxUnknowns: 1, maxContradictedClaims: 0 })
assert.equal(gate.ok, false)
assert.deepEqual(gate.violations.map((v) => v.rule).sort(), ["maxContradictedClaims", "noPolicyViolations"])
assert.equal(evaluateEvidenceRules(evidence, { maxUnknowns: 1 }).ok, true)

// ---- 7. The textual equivalent says the same ----------------------------------------------------
const text = renderFlowText(evidence)
assert.ok(text?.includes("- Discards: userData.user: passwordHash, role"))
assert.ok(text?.includes("not complete"))

// ---- 8. Two revisions compared: the commit that introduced the leak ---------------------------------
const earlier = await runPipeline({ observations: observations.filter((event) => event.scope !== "scenario:debug-export"), exclude: ["src/app/export.ts"] })
const changes = compareEvidence(earlier.evidence, evidence)
const listed = (group: string) => changes.sections.find((section) => section.group === group)?.items.map((item) => item.label) ?? []
assert.equal(listed("added-edges").length, 2, "the debug endpoint adds a read and a send to the client")
assert.deepEqual(listed("removed-edges"), [])
assert.equal(listed("changed-policy").length, 1, "and the password rule goes from satisfied to violated")
assert.match(listed("changed-policy")[0] ?? "", /satisfied, static before, violated reaching http-response, static now/)
assert.equal(compareEvidence(evidence, evidence).unchanged, true)

console.log("flow-explorer: all assertions passed")
