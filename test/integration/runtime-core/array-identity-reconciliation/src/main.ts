/**
 * Client-side pattern: a list fetched from a REST API, kept in `fields` as
 * an ordinary array while `info` tracks each item by a declared identity
 * (never array index -- an index shifts under insertion/removal/reorder,
 * silently reattaching metadata to the wrong item). `helpers.identity`
 * exposes the same two primitives the standalone runtime would use
 * internally to do this: `computeItemIdentity` (one item -> a stable key)
 * and `reconcileArrayInfo` (a full items array + the previous info map ->
 * the next info map, reusing untouched entries by reference).
 */
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import path from "node:path"
import { buildData } from "@maverickcer/data-cap"
import type { FieldInfo } from "@maverickcer/data-cap"
import { createDataStore } from "@maverickcer/data-cap/runtime"
import { identity } from "@maverickcer/data-cap/helpers"
import type { IdentityWarning } from "@maverickcer/data-cap/helpers"

interface Comment {
  readonly id: string
  readonly body: string
}

const capability = buildData({ fields: { comments: [] as Comment[] } })
const store = createDataStore(capability)

function commitComments(
  nextComments: readonly Comment[],
  touched: ReadonlySet<string> | "all",
  source: string,
): readonly IdentityWarning[] {
  const previousInfo = store.getSnapshot().info.comments
  const { info, warnings } = identity.reconcileArrayInfo<Comment, FieldInfo>(
    previousInfo,
    nextComments,
    ["id"],
    touched,
    () => ({ status: "success", source }),
  )
  store.commitAuthoritative({ comments: nextComments }, { comments: info })
  return warnings
}

// Stands in for `await fetch("/api/comments").then(r => r.json())`.
async function fetchComments(): Promise<Comment[]> {
  await new Promise((resolve) => setTimeout(resolve, 5))
  return [
    { id: "1", body: "first" },
    { id: "2", body: "second" },
  ]
}

// -- Initial population: every item is "touched" (freshly fetched) --
const firstBatch = await fetchComments()
commitComments(firstBatch, "all", "listComments")

const key1 = identity.computeItemIdentity<Comment>({ id: "1", body: "" }, ["id"], [], [])
const key2 = identity.computeItemIdentity<Comment>({ id: "2", body: "" }, ["id"], [], [])
const infoAfterFirstFetch = store.getSnapshot().info.comments
assert.ok(infoAfterFirstFetch)
const comment2InfoBeforeUpdate = infoAfterFirstFetch[key2]
assert.ok(comment2InfoBeforeUpdate)

// -- Refetch: item "1" changed, item "2" is untouched, item "3" is new --
const secondBatch: Comment[] = [
  { id: "1", body: "first (edited)" },
  { id: "2", body: "second" },
  { id: "3", body: "third" },
]
commitComments(secondBatch, new Set([key1]), "listComments")

const infoAfterSecondFetch = store.getSnapshot().info.comments
assert.ok(infoAfterSecondFetch)
const comment2InfoAfterUpdate = infoAfterSecondFetch[key2]
assert.equal(
  comment2InfoAfterUpdate,
  comment2InfoBeforeUpdate,
  "an untouched item keeps its previous FieldInfo object reference exactly -- reconciliation, not a full rebuild",
)
const key3 = identity.computeItemIdentity<Comment>({ id: "3", body: "" }, ["id"], [], [])
assert.ok(infoAfterSecondFetch[key3], "a newly-appearing identity gets a fresh info entry")

// -- Malformed-input matrix: missing key, explicit null, duplicate identity --
interface MaybeComment {
  readonly id?: string | null
  readonly body: string
}
const malformedWarnings: IdentityWarning[] = []
const malformedBatch: MaybeComment[] = [
  { id: "4", body: "ok" },
  { body: "missing id entirely" },
  { id: null, body: "explicit null id" },
  { id: "4", body: "duplicate of the first item" },
]
const keys = malformedBatch.map((item) =>
  identity.computeItemIdentity(item, ["id"], [], malformedWarnings),
)

assert.equal(
  malformedWarnings.length,
  1,
  "only the genuinely-absent key warns -- computeItemIdentity does not yet know about the later duplicate",
)
assert.equal(malformedWarnings[0]?.reason, "missing-key")
// An explicit `null` value is itself a real, canonicalizable identity
// component (distinct from a missing key's fallback token) -- it does NOT
// warn, and its key differs from the missing-key item's key.
assert.notEqual(
  keys[1],
  keys[2],
  "a missing key and an explicit null value produce different tokens",
)
assert.equal(
  keys[0],
  keys[3],
  "two items sharing the same declared id compute the same identity key",
)

const reconciledMalformed = identity.reconcileArrayInfo<MaybeComment, FieldInfo>(
  undefined,
  malformedBatch,
  ["id"],
  "all",
  () => ({ status: "success", source: "listComments" }),
)
assert.equal(
  reconciledMalformed.warnings.some((w) => w.reason === "duplicate-identity"),
  true,
  "a duplicate identity across two items is recorded as a warning, not an error",
)
// Both items sharing the duplicate identity remain in fields -- only their
// shared info SLOT collapses to one entry (last-encountered wins).
assert.equal(
  Object.keys(reconciledMalformed.info).length,
  3,
  "one slot per DISTINCT identity, not per item",
)

const summary = {
  comment2InfoReferencePreserved: comment2InfoAfterUpdate === comment2InfoBeforeUpdate,
  commentsAfterSecondFetch: store.getSnapshot().fields.comments,
  infoKeyCountAfterSecondFetch: Object.keys(infoAfterSecondFetch).length,
  malformedWarningReasons: malformedWarnings.map((w) => w.reason).sort(),
  duplicateIdentityDetected: reconciledMalformed.warnings.some(
    (w) => w.reason === "duplicate-identity",
  ),
  distinctIdentitySlotsForMalformedBatch: Object.keys(reconciledMalformed.info).length,
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("array-identity-reconciliation: all assertions passed.")
