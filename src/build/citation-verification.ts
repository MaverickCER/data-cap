/**
 * Re-verifies developer-declared `evidence.fields[key].dynamicAccess`
 * citations every run -- never trusted forever. Two independent steps,
 * kept as two separate functions rather than one, since they run at
 * different points in the pipeline and need different inputs:
 *
 * - `buildCitationSnapshots` (this run): for every citation that currently
 *   resolves to a real file under `root`, computes a whole-file SHA-256 --
 *   the baseline the *next* run compares against. Never throws on a
 *   missing file; that citation simply gets no snapshot entry.
 * - `verifyDynamicAccessCitations` (this run vs. the *previous* run's
 *   snapshot): for every currently-declared citation, checks it against
 *   the previous run's recorded hash. A citation with no prior recorded
 *   hash (first time it's been seen) is never flagged -- there is nothing
 *   to have gone stale relative to yet.
 *
 * Deliberately separate from `manifest-snapshot.ts`'s own
 * `buildManifestSnapshot`, which stays synchronous/pure -- these two
 * functions are the only filesystem-touching, citation-specific part of
 * the manifest-snapshot lifecycle (see ADR 0053).
 */

import { createHash } from "node:crypto"
import path from "node:path"
import type { CapabilityInventory } from "./inventory.js"
import type { CitationSnapshotEntry, ManifestSnapshot } from "./manifest-snapshot.js"
import type { ReportFinding } from "./findings.js"
import type { BuildFileSystem } from "./types.js"

interface ParsedCitation {
  readonly relativePath: string
  readonly line: number
  readonly column: number
}

/** Parses a `"<relative-path>:<line>:<column>"` citation -- assumes the format-check `parse.ts` already applied; never re-validates format, just structure. Returns `undefined` for a citation that somehow doesn't match despite that (defensive only). */
function parseCitation(citation: string): ParsedCitation | undefined {
  const match = /^(.+):(\d+):(\d+)$/.exec(citation)
  const relativePath = match?.[1]
  const line = match?.[2]
  const column = match?.[3]
  // Stryker disable next-line ConditionalExpression,LogicalOperator: once the
  // regex matches, groups 1-3 are non-optional and therefore always present;
  // this line only exists to narrow `string | undefined` (noUncheckedIndexedAccess)
  // for the return, and no citation can make one group present but not another.
  if (relativePath === undefined || line === undefined || column === undefined) return undefined
  return { relativePath, line: Number(line), column: Number(column) }
}

interface DeclaredCitations {
  readonly capability: CapabilityInventory["capabilities"][number]
  readonly fieldKey: string
  readonly citations: readonly string[]
}

/** Every declared `dynamicAccess` citation across the inventory, one entry per capability+field it was declared on. */
function collectDeclaredCitations(inventory: CapabilityInventory): readonly DeclaredCitations[] {
  const out: DeclaredCitations[] = []
  for (const capability of inventory.capabilities) {
    const evidenceFields = capability.docs?.evidence?.fields
    if (evidenceFields === undefined) continue
    for (const [fieldKey, evidence] of Object.entries(evidenceFields)) {
      const citations = evidence.dynamicAccess
      // An empty array is not an error -- it just contributes no work below.
      if (citations === undefined) continue
      out.push({ capability, fieldKey, citations })
    }
  }
  return out
}

async function hashFile(fs: BuildFileSystem, absolutePath: string): Promise<string | undefined> {
  // A missing/unreadable file (or a race with deletion) reads back as `null`
  // rather than throwing, so "no hash" is a real, checkable value below.
  // "utf8" -> "" is an equivalent mutant: with "" the adapter returns a
  // Buffer, and `createHash().update()` over that Buffer hashes the exact
  // same bytes as over the decoded string -- byte-identical digest either way.
  // Stryker disable next-line StringLiteral
  const content = await fs.readFile(absolutePath, "utf8").then(
    (text): string | null => text,
    (): null => null,
  )
  if (content === null) return undefined
  return createHash("sha256").update(content).digest("hex")
}

/**
 * Computes this run's citation snapshots -- one `CitationSnapshotEntry` per
 * currently-declared citation that resolves to a real, readable file under
 * `root`. A capability with no declared citations at all is simply absent
 * from the returned map (never an empty-object placeholder).
 */
export async function buildCitationSnapshots(
  inventory: CapabilityInventory,
  root: string,
  fs: BuildFileSystem,
): Promise<ReadonlyMap<string, Readonly<Record<string, readonly CitationSnapshotEntry[]>>>> {
  const declared = collectDeclaredCitations(inventory)
  const result = new Map<string, Record<string, CitationSnapshotEntry[]>>()

  for (const { capability, fieldKey, citations } of declared) {
    for (const citation of citations) {
      const parsed = parseCitation(citation)
      if (parsed === undefined) continue
      const absolutePath = path.resolve(root, parsed.relativePath)
      const hash = await hashFile(fs, absolutePath)
      if (hash === undefined) continue // unresolvable this run -- no baseline recorded; DYNAMIC_ACCESS_CITATION_MISSING covers this case directly, not a stale baseline

      const capKey = `${capability.file}#${capability.exportName}`
      const byField = result.get(capKey) ?? {}
      const entries = byField[fieldKey] ?? []
      entries.push({ file: parsed.relativePath, line: parsed.line, column: parsed.column, hash })
      byField[fieldKey] = entries
      result.set(capKey, byField)
    }
  }

  return result
}

function findPreviousHash(
  previous: ManifestSnapshot | undefined,
  capabilityFile: string,
  exportName: string,
  fieldKey: string,
  citation: ParsedCitation,
): string | undefined {
  const capKey = `${capabilityFile}#${exportName}`
  const previousCapability = previous?.capabilities.find(
    (c) => `${c.file}#${c.exportName}` === capKey,
  )
  const entries = previousCapability?.citationSnapshots?.[fieldKey]
  return entries?.find(
    (e) =>
      e.file === citation.relativePath && e.line === citation.line && e.column === citation.column,
  )?.hash
}

/**
 * Re-checks every currently-declared citation against `previousSnapshot`.
 * Two independent failure modes, both real findings, never silently
 * folded into one: a citation whose file no longer resolves at all
 * (`DYNAMIC_ACCESS_CITATION_MISSING`), and one that resolves but whose
 * content hash no longer matches what was recorded last run
 * (`DYNAMIC_ACCESS_CITATION_STALE`). A citation with no prior recorded
 * hash (first time seen, or `previousSnapshot` is `undefined` -- a first
 * run) is never flagged either way -- there is nothing to have gone stale
 * relative to yet, and "missing" only means the file doesn't currently
 * resolve, not that it used to.
 *
 * Deliberately additive to, never a replacement for,
 * `FIELD_DYNAMIC_ACCESS_DECLARED` (`usage-report.ts`) -- that finding
 * states what was *asserted*; these state the assertion's own *current
 * integrity*. Both can legitimately appear together for the same field.
 */
export async function verifyDynamicAccessCitations(
  inventory: CapabilityInventory,
  previousSnapshot: ManifestSnapshot | undefined,
  root: string,
  fs: BuildFileSystem,
): Promise<readonly ReportFinding[]> {
  const declared = collectDeclaredCitations(inventory)
  const findings: ReportFinding[] = []

  for (const { capability, fieldKey, citations } of declared) {
    const ref = { file: capability.file, exportName: capability.exportName }
    const field = capability.fields.find((f) => f.path[0] === fieldKey)

    for (const citation of citations) {
      const parsed = parseCitation(citation)
      if (parsed === undefined) continue
      const absolutePath = path.resolve(root, parsed.relativePath)
      const currentHash = await hashFile(fs, absolutePath)

      if (currentHash === undefined) {
        findings.push({
          code: "DYNAMIC_ACCESS_CITATION_MISSING",
          family: "citation",
          severity: "warning",
          message: `Declared dynamicAccess citation "${citation}" on field "${fieldKey}" on "${capability.exportName}" no longer resolves to a real file -- the developer's own citation could not be re-confirmed this run.`,
          capability: ref,
          field: field?.path ?? [fieldKey],
          position: field?.declarationPosition,
        })
        continue
      }

      const previousHash = findPreviousHash(
        previousSnapshot,
        capability.file,
        capability.exportName,
        fieldKey,
        parsed,
      )
      if (previousHash !== undefined && previousHash !== currentHash) {
        findings.push({
          code: "DYNAMIC_ACCESS_CITATION_STALE",
          family: "citation",
          severity: "warning",
          message: `Declared dynamicAccess citation "${citation}" on field "${fieldKey}" on "${capability.exportName}" points to a file that has visibly changed since this citation was last confirmed -- re-verify it still describes real access at that location.`,
          capability: ref,
          field: field?.path ?? [fieldKey],
          position: field?.declarationPosition,
        })
      }
    }
  }

  return findings
}
