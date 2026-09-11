/**
 * The headless, golden-tested entry point -- `npm start`. Runs the entire
 * real service (MongoDB via `mongodb-memory-server`, the HTTP+SSE server,
 * every `createData` capability) in one Node process, no browser, no Vite
 * -- the same "real assertions against the actual built package, plus
 * committed, regeneratable documentation/reports" discipline every other
 * example in this repository follows (see `examples/README.md`). `npm run
 * dev` (additive, not exercised here) boots the real TanStack Start app for
 * interactive, browser-based verification instead.
 *
 * The story: Atlas, an internal work-management platform three
 * departments actually use -- engineering-ops opens a project
 * (`projectsData`, owned by engineering-ops), finance issues and manages
 * its invoices (`billingData`, owned by finance-team, `confidential`), and
 * platform-security's own `identityData` is what every department implicitly
 * depends on once a session exists. A client disputes an invoice; this
 * script proves, the same way a real incident review would, exactly what
 * billing data existed and how it was declared to be handled at every
 * endpoint it crossed -- via `reports/litigation-evidence.ts` -- and rolls
 * up governance-declaration completeness across all three departments' own
 * capabilities -- via `reports/audit-prep.ts`. A final section proves the
 * CI-configuration guard these two reports depend on (`data-cap --strict-
 * docs`/`--strict-flow`) genuinely blocks a real gap, not just a synthetic
 * demo unrelated to how the flags actually behave.
 */
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { MongoMemoryServer } from "mongodb-memory-server"
import { DataProjectGenerationError, generateDataArtifacts } from "data-cap/build"
import { nodeBuildFileSystem } from "data-cap/node"
import { connectDb, disconnectDb } from "./src/server/db.js"
import { handleRequest } from "./src/server/http-handler.js"
import { seedUser } from "./src/server/functions.js"
import { subscriberCountFor } from "./src/server/sse.js"
import { auditCurrentFields } from "./src/server/legacy-compliance-sync.js"
import { setBaseUrl, setSessionCookie } from "./src/capabilities/api-client.js"
import { identityData } from "./src/capabilities/identity.capability.js"
import { projectsData } from "./src/capabilities/projects.capability.js"
import { billingData } from "./src/capabilities/billing.capability.js"
import { generateLitigationEvidenceReport } from "./reports/litigation-evidence.js"
import { generateAuditPrepReport } from "./reports/audit-prep.js"

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const mongod = await MongoMemoryServer.create()
await connectDb(mongod.getUri())

const server = createServer((req, res) => {
  void handleRequest(req, res).then((handled) => {
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: "not found" }))
    }
  })
})
await new Promise<void>((resolve) => server.listen(0, resolve))
const address = server.address()
if (address === null || typeof address === "string") throw new Error("server did not bind a port")
setBaseUrl(`http://127.0.0.1:${String(address.port)}`)

// -- Seed the platform's first admin account directly -- self-registration --
// -- (/api/register) always grants "member", the same way a real deployment --
// -- never lets a public sign-up endpoint grant admin access to itself. -- //
await seedUser({
  email: "admin@atlas.example.com",
  name: "Ada Admin",
  password: "correct-horse-battery",
  role: "admin",
})
const loginResponse = await fetch(`http://127.0.0.1:${String(address.port)}/api/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@atlas.example.com", password: "correct-horse-battery" }),
})
assert.equal(loginResponse.status, 200)
const setCookieHeader = loginResponse.headers.get("set-cookie")
assert.ok(setCookieHeader, "login must issue a session cookie")
setSessionCookie(setCookieHeader.split(";")[0])

// -- identityData: what every other capability implicitly depends on once -- //
// -- a session exists. -- //
await identityData.getCurrentUser()
assert.equal(identityData.getSnapshot().fields.currentUser?.email, "admin@atlas.example.com")
assert.equal(identityData.getSnapshot().fields.currentUser?.role, "admin")

// -- projectsData: engineering-ops opens a project every department below -- //
// -- can see. -- //
await projectsData.createProject({ name: "Atlas Platform Migration", department: "engineering" })
assert.equal(projectsData.getSnapshot().fields.projects.length, 1)
const projectId = projectsData.getSnapshot().fields.projects[0]!.id

// -- billingData: finance-team issues invoices against the project. -- //
await billingData.listInvoices({ projectId })
assert.equal(billingData.getSnapshot().fields.invoices.length, 0)
await billingData.createInvoice({ projectId, clientName: "Initech", amountCents: 250_000 })
await billingData.createInvoice({ projectId, clientName: "Globex", amountCents: 480_000 })
assert.equal(billingData.getSnapshot().fields.invoices.length, 2)
const firstInvoice = billingData.getSnapshot().fields.invoices[0]!
const secondInvoice = billingData.getSnapshot().fields.invoices[1]!

// -- Two views subscribing to the same project's invoices share one real -- //
// -- SSE connection -- proven against the server's own subscriber count, -- //
// -- not client-side `.info` (see `billing.capability.ts`'s own comment on -- //
// -- why an array field's own `.info.invoices?.subscription` can't be -- //
// -- trusted). -- //
assert.equal(subscriberCountFor(projectId), 0)
const releaseViewA = billingData.subscribeToInvoices({ projectId })
const releaseViewB = billingData.subscribeToInvoices({ projectId })
await sleep(30)
assert.equal(
  subscriberCountFor(projectId),
  1,
  "two subscribers to the same capability share one real SSE connection",
)

// -- Marking an invoice paid completes optimistically, before the request -- //
// -- settles, then confirms against the real response. -- //
const payPromise = billingData.markInvoicePaid({ projectId, invoiceId: firstInvoice.id })
assert.equal(
  billingData.getSnapshot().fields.invoices.find((i) => i.id === firstInvoice.id)?.status,
  "paid",
  "the optimistic flip is visible immediately, before the request settles",
)
await payPromise
assert.equal(
  billingData.getSnapshot().fields.invoices.find((i) => i.id === firstInvoice.id)?.status,
  "paid",
  "confirmed by the real response too",
)

// -- The mutator's own response already updated `invoices` -- the live SSE -- //
// -- push (from the same change) independently confirms the same state -- //
// -- arrived over the subscription too. -- //
await sleep(30)
assert.equal(
  billingData.getSnapshot().fields.invoices.find((i) => i.id === firstInvoice.id)?.status,
  "paid",
  "the live SSE push independently carries the same confirmed state",
)

releaseViewA()
releaseViewB()
await sleep(10)
assert.equal(subscriberCountFor(projectId), 0, "unsubscribing both releases the real connection")

// -- Disputing an invoice -- the concrete scenario `reports/litigation- -- //
// -- evidence.ts` is scoped to. Sends the (console-fallback) email and -- //
// -- pushes a live update, same as any other mutator. -- //
await billingData.disputeInvoice({ projectId, invoiceId: secondInvoice.id })
assert.equal(
  billingData.getSnapshot().fields.invoices.find((i) => i.id === secondInvoice.id)?.status,
  "disputed",
)

// -- The legacy dynamic-access utility (documented via billing -- //
// -- .capability.ts's own evidence.fields.invoices.dynamicAccess citation, -- //
// -- and deliberately NOT cited for identityData.currentUser) still runs -- //
// -- cleanly against the real, current capability state either way. -- //
auditCurrentFields()

// =========================================================================
// Litigation-evidence report -- the actual point of this tier. Generated
// against this same source tree: `invoices` resolves to "declared-dynamic"
// (the citation above); `currentUser` resolves to "indeterminate" -- a
// real, undisclosed gap this script does NOT paper over.
// =========================================================================
const litigationReport = await generateLitigationEvidenceReport()

const invoicesEntry = litigationReport.fields.find(
  (f) => f.capability === "billingData" && f.field === "invoices",
)
assert.ok(invoicesEntry, "the litigation report must include the invoices field")
assert.equal(
  invoicesEntry.consumptionStatus,
  "declared-dynamic",
  "the legacy compliance-sync utility's own citation must resolve this field to declared-dynamic",
)
assert.ok(invoicesEntry.dynamicAccessCitations.length > 0)
assert.ok(invoicesEntry.handlingByOperation.length > 0, "invoices must show its own field-lifecycle handling stages")
assert.ok(
  invoicesEntry.handlingByOperation.every((stage) => stage.handling === "encrypted"),
  "every declared endpoint invoices crosses must show its declared handling state",
)

const currentUserEntry = litigationReport.fields.find(
  (f) => f.capability === "identityData" && f.field === "currentUser",
)
assert.ok(currentUserEntry, "the litigation report must include the currentUser field")
assert.equal(
  currentUserEntry.consumptionStatus,
  "indeterminate",
  "no dynamicAccess citation names identityData's own dynamic read -- a real, undisclosed gap, not a mistake this script papers over",
)
assert.ok(currentUserEntry.indeterminateSites.length > 0)

// Negative guarantee (see test/build/negative-guarantees.test.ts's own
// header comment): the report is deterministic given the same source tree,
// and every field entry's claimed status is backed by the one evidence
// source that status actually means -- never a status claimed with nothing
// behind it. This can't run as a root-level unit test (examples/ is a
// separate npm project data-cap's own test suite can't import from), so it
// runs here instead, for real, on every `npm start`.
const secondLitigationReport = await generateLitigationEvidenceReport()
assert.deepEqual(
  JSON.parse(JSON.stringify({ ...litigationReport, generatedAt: null })),
  JSON.parse(JSON.stringify({ ...secondLitigationReport, generatedAt: null })),
  "regenerating the report from the same source tree must produce identical derived facts",
)
for (const entry of litigationReport.fields) {
  switch (entry.consumptionStatus) {
    case "proven":
      assert.ok(entry.provenAccessSites.length > 0, `${entry.capability}.${entry.field}: "proven" must cite a real access site`)
      break
    case "unconsumed":
      assert.equal(entry.provenAccessSites.length, 0)
      assert.equal(entry.indeterminateSites.length, 0)
      assert.equal(entry.dynamicAccessCitations.length, 0)
      break
    case "indeterminate":
      assert.ok(
        entry.indeterminateSites.length > 0,
        `${entry.capability}.${entry.field}: "indeterminate" must cite a candidate dynamic-access site`,
      )
      break
    case "declared-dynamic":
      assert.ok(
        entry.dynamicAccessCitations.length > 0,
        `${entry.capability}.${entry.field}: "declared-dynamic" must cite the developer's own citation`,
      )
      break
    case "stale-declaration":
      assert.ok(
        entry.citationIntegrityFindings.length > 0,
        `${entry.capability}.${entry.field}: "stale-declaration" must cite the citation-integrity finding that demoted it`,
      )
      break
  }
}

// =========================================================================
// Audit-prep report -- the governance-completeness rollup across all three
// departments' own capabilities.
// =========================================================================
const auditReport = await generateAuditPrepReport()
assert.equal(auditReport.capabilityCount, 3)
assert.ok(auditReport.sensitiveFields.length >= 2, "invoices and currentUser must both appear as sensitive fields")
const billingRow = auditReport.sensitiveFields.find(
  (f) => f.capability === "billingData" && f.field === "invoices",
)
assert.ok(billingRow)
assert.match(
  billingRow.handlingDeclared,
  /^(\d+)\/\1$/,
  "every endpoint writing invoices must declare handling -- numerator must equal denominator",
)

// =========================================================================
// CI-configuration guard -- proves `--strict-docs`/`--strict-flow` genuinely
// block a real gap, against a small synthetic fixture built just for this
// (the real capabilities above are already fully documented, so running the
// same flags against them proves nothing was silently broken, not that the
// flags themselves work -- this section proves the flags work).
// =========================================================================
const guardFixtureDir = await mkdtemp(path.join(tmpdir(), "data-cap-guard-demo-"))
try {
  await writeFile(
    path.join(guardFixtureDir, "bad.capability.ts"),
    `import { documentData } from "data-cap"
import { createData } from "data-cap/runtime"

const schema = {
  fields: { ssn: "" },
  getters: {
    getSsn: {
      params: {},
      execute: async (): Promise<{ ssn: string }> => ({ ssn: "" }),
      processor: (r: { ssn: string }): { ssn: string } => r,
      writes: { ssn: true },
    },
  },
}

export const badData = createData(schema)

documentData(schema, {
  name: "bad",
  fields: {
    ssn: { sensitivity: "confidential", protections: "none" },
  },
  getters: {
    getSsn: {
      description: "Fetches a raw SSN.",
      endpoints: [{ direction: "input", kind: "api", name: "ssn-api", url: "https://api.example.com/ssn" }],
    },
  },
})
`,
    "utf8",
  )

  await assert.rejects(
    () =>
      generateDataArtifacts({
        fs: nodeBuildFileSystem,
        root: guardFixtureDir,
        docs: path.join(guardFixtureDir, "DATA.md"),
        strictDocs: true,
      }),
    DataProjectGenerationError,
    "--strict-docs must block a capability with no declared owner",
  )

  await assert.rejects(
    () =>
      generateDataArtifacts({
        fs: nodeBuildFileSystem,
        root: guardFixtureDir,
        flow: path.join(guardFixtureDir, "flow"),
        strictFlow: true,
      }),
    DataProjectGenerationError,
    "--strict-flow must block a sensitive field's boundary-crossing endpoint with no declared handling",
  )
} finally {
  await rm(guardFixtureDir, { recursive: true, force: true })
}

server.close()
await disconnectDb()
await mongod.stop()

console.log("enterprise-platform: all assertions passed.")
