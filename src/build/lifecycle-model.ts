/**
 * `data-cap`'s Lifecycle Model (EVD-05) -- every capability and field's
 * declared lifecycle data (expiry, deprecation, removal deadline, rename
 * correlation), projected into one canonical, versioned shape, plus the
 * "expiring soon" view a documentation pass and a CI gate both want.
 *
 * Ported from env-cap's own `lifecycle-model.ts` and adapted in two ways
 * that matter:
 *
 * - Addressing. env-cap identifies a variable by a flat `key` string;
 *   `data-cap` identifies a field by its `readonly string[]` path, the same
 *   way every other model here does. A `LifecycleModelField` therefore
 *   carries `path`, not `key`.
 * - Paths. `file` is root-relative, carried through verbatim from
 *   `CapabilityNode.file` (OUT-01) rather than converted here -- unlike
 *   env-cap's version, which takes a `root` and relativizes as it goes,
 *   because its own `DiscoveredContract.file` is still absolute at that
 *   point. `buildLifecycleModel` needs no `root` for exactly that reason.
 *
 * Every fact here is **declared, never verified**: nothing expires at
 * runtime, nothing is deleted on a `removeBy`, and a `renamedFrom` is only
 * ever an authored value -- never inferred from name similarity. What this
 * model adds over reading `docs` directly is a single, sorted, versioned
 * place to read it from, and the date arithmetic (`daysRemaining`) done
 * once against one shared `now`.
 */

import type { CapabilityInventory, CapabilityNode, FieldNode } from "./inventory.js"

/** Bump only when a reader could misinterpret the shape -- same discipline every other model's schema-version constant already documents. */
export const LIFECYCLE_MODEL_SCHEMA_VERSION = 1

/** One field's declared lifecycle data. Only fields with at least one of these set appear in the model at all. */
export interface LifecycleModelField {
  /** The field's path within its capability -- `readonly string[]`, matching every other model's field addressing (never a flat key string). */
  readonly path: readonly string[]
  /** Declared ISO-8601 expiry, unparsed and uninterpreted here. */
  readonly expiresAt: string | undefined
  /** Whether the field is documented as deprecated. */
  readonly deprecated: boolean | undefined
  /** Why it's deprecated, when stated. */
  readonly deprecatedReason: string | undefined
  /** Declared ISO-8601 removal deadline -- field-level only (see `core/document.ts`). */
  readonly removeBy: string | undefined
  /** The field's previous name, when authored -- what `ChangeModel.renamedFields` correlates against. */
  readonly renamedFrom: string | undefined
  /** Declared retention policy -- a policy statement, deliberately independent of `expiresAt`'s temporal constraint (a field can be retained long after its source credential expires, and vice versa). */
  readonly retention: string | undefined
}

/** One capability's declared lifecycle data, plus every lifecycle-bearing field under it. */
export interface LifecycleModelCapability {
  /** Root-relative POSIX path -- carried through verbatim from `CapabilityNode.file`. */
  readonly file: string
  /** The binding name the capability is exported as. */
  readonly exportName: string
  /** Declared ISO-8601 expiry for the capability as a whole. */
  readonly expiresAt: string | undefined
  /** Whether the capability is documented as deprecated. */
  readonly deprecated: boolean | undefined
  /** Why it's deprecated, when stated. */
  readonly deprecatedReason: string | undefined
  /** Declared retention policy at the capability level. */
  readonly retention: string | undefined
  /** Only fields with at least one lifecycle field set, sorted by path -- same "only what's relevant" scope the rendered report uses. */
  readonly fields: readonly LifecycleModelField[]
}

/** One capability- or field-level `expiresAt` falling within the configured window (or already past it). */
export interface ExpiringEntry {
  /** Root-relative POSIX path of the declaring file. */
  readonly file: string
  /** The binding name the capability is exported as. */
  readonly exportName: string
  /** `undefined` for a capability-level `expiresAt`, set for a per-field one. */
  readonly field: readonly string[] | undefined
  /** The raw ISO-8601 date string, exactly as declared. */
  readonly expiresAt: string
  /** Whole days from `now` until expiry; negative when already expired. */
  readonly daysRemaining: number
}

/** `data-cap`'s Lifecycle Model: declared expiry/deprecation/rename data, plus the expiring-soon view. */
export interface LifecycleModel {
  /** Always `LIFECYCLE_MODEL_SCHEMA_VERSION`. */
  readonly schemaVersion: typeof LIFECYCLE_MODEL_SCHEMA_VERSION
  /** Only capabilities with at least one lifecycle-relevant field set, at the capability level or on at least one field. Sorted by `file` then `exportName`. */
  readonly capabilities: readonly LifecycleModelCapability[]
  /** Every capability-/field-level `expiresAt` within the configured window, soonest-first (already-expired entries sort first, since their `daysRemaining` is negative). */
  readonly expiring: readonly ExpiringEntry[]
}

/**
 * Parses a declared `expiresAt` as a real date, or `undefined` when it isn't
 * one.
 *
 * An unparseable value is skipped entirely rather than guessed at or
 * reported as expired: `expiresAt` is author-declared free text that nothing
 * validates at declaration time, and treating `"soon"` as an expiry would
 * manufacture a finding out of a typo. The value still appears verbatim on
 * the model's own `expiresAt`, so it is visible -- just never counted as a
 * date.
 */
function parseIsoDate(value: string): Date | undefined {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

/** Whole days from `now` to `date`, rounded up so a partial day still reads as a day remaining rather than zero. */
function daysRemainingFrom(date: Date, now: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.ceil((date.getTime() - now.getTime()) / millisecondsPerDay)
}

function toLifecycleField(field: FieldNode): LifecycleModelField {
  return {
    path: field.path,
    expiresAt: field.docs?.expiresAt,
    deprecated: field.docs?.deprecated,
    deprecatedReason: field.docs?.deprecatedReason,
    removeBy: field.docs?.removeBy,
    renamedFrom: field.docs?.renamedFrom,
    retention: field.docs?.retention,
  }
}

function hasLifecycleData(field: LifecycleModelField): boolean {
  return (
    field.expiresAt !== undefined ||
    field.deprecated !== undefined ||
    field.deprecatedReason !== undefined ||
    field.removeBy !== undefined ||
    field.renamedFrom !== undefined ||
    field.retention !== undefined
  )
}

function capabilityHasLifecycleData(capability: CapabilityNode): boolean {
  return (
    capability.docs?.expiresAt !== undefined ||
    capability.docs?.deprecated !== undefined ||
    capability.docs?.deprecatedReason !== undefined ||
    capability.docs?.retention !== undefined
  )
}

/**
 * Every capability- or field-level `expiresAt` within `expiringWithinDays`
 * of `now`, sorted soonest-first. Exported because a documentation pass, a
 * CI gate, and the Lifecycle Model itself all want the identical rule -- and
 * "what counts as expiring soon" drifting between them would be exactly the
 * kind of two-sources-of-truth bug this codebase avoids elsewhere.
 *
 * A field's own `expiresAt` is read from its declared `docs`, not from a
 * capability-inherited value: unlike `owner`/`sensitivity`, an expiry is a
 * statement about one specific thing's validity, and silently inheriting it
 * would report every field of an expiring capability as separately expiring.
 * The capability's own entry already covers that case, once.
 */
/**
 * One expiring entry for `expiresAt`, or `undefined` when it isn't a parseable
 * date or falls outside the window. `parseIsoDate` already yields `undefined`
 * for a non-date; a `Date` reaching `daysRemainingFrom` is therefore real.
 */
function expiringEntryFor(
  expiresAt: string | undefined,
  subject: Pick<ExpiringEntry, "file" | "exportName" | "field">,
  expiringWithinDays: number,
  now: Date,
): ExpiringEntry | undefined {
  // Stryker disable next-line ConditionalExpression: a type guard only.
  // `parseIsoDate(undefined)` and `parseIsoDate("not a date")` both yield
  // `undefined` (`new Date(x)` -> Invalid Date -> NaN), so the next line's
  // `date === undefined` return already covers the `undefined` case identically
  // -- there is no test that can distinguish the two.
  if (expiresAt === undefined) return undefined
  const date = parseIsoDate(expiresAt)
  if (date === undefined) return undefined
  const daysRemaining = daysRemainingFrom(date, now)
  if (daysRemaining > expiringWithinDays) return undefined
  return { ...subject, expiresAt, daysRemaining }
}

export function computeExpiringEntries(
  inventory: CapabilityInventory,
  expiringWithinDays: number,
  now: Date,
): readonly ExpiringEntry[] {
  const entries: ExpiringEntry[] = []

  for (const capability of inventory.capabilities) {
    const subject = { file: capability.file, exportName: capability.exportName }
    const capabilityEntry = expiringEntryFor(
      capability.docs?.expiresAt,
      { ...subject, field: undefined },
      expiringWithinDays,
      now,
    )
    if (capabilityEntry !== undefined) entries.push(capabilityEntry)

    for (const field of capability.fields) {
      const fieldEntry = expiringEntryFor(
        field.docs?.expiresAt,
        { ...subject, field: field.path },
        expiringWithinDays,
        now,
      )
      if (fieldEntry !== undefined) entries.push(fieldEntry)
    }
  }

  // `field` is joined with "." to a sort key ("" for a capability-level entry,
  // which therefore sorts before any field entry sharing its other keys).
  const fieldSortKey = (entry: ExpiringEntry): string => entry.field?.join(".") ?? ""
  return entries.sort(
    (a, b) =>
      a.daysRemaining - b.daysRemaining ||
      a.file.localeCompare(b.file) ||
      a.exportName.localeCompare(b.exportName) ||
      fieldSortKey(a).localeCompare(fieldSortKey(b)),
  )
}

/**
 * Projects `inventory` into `data-cap`'s Lifecycle Model. Pure -- a
 * projection over an already-built inventory, never a second scan, which is
 * why `EvidenceModel` can populate `lifecycle` unconditionally alongside
 * `capability` rather than gating it on an opt-in pass the way
 * `dependency`/`ownership` are gated on a usage scan.
 *
 * `now` is a parameter, never `new Date()` read in here: every time-
 * sensitive computation in one run must agree on the same instant, and a
 * caller-supplied clock is also what makes this testable without freezing
 * time globally.
 */
export function buildLifecycleModel(
  inventory: CapabilityInventory,
  expiringWithinDays: number,
  now: Date,
): LifecycleModel {
  const capabilities: LifecycleModelCapability[] = []

  for (const capability of inventory.capabilities) {
    const fieldPathKey = (field: LifecycleModelField): string => field.path.join(".")
    const fields = capability.fields
      .map(toLifecycleField)
      .filter(hasLifecycleData)
      .sort((a, b) => fieldPathKey(a).localeCompare(fieldPathKey(b)))

    if (!capabilityHasLifecycleData(capability) && fields.length === 0) continue

    capabilities.push({
      file: capability.file,
      exportName: capability.exportName,
      expiresAt: capability.docs?.expiresAt,
      deprecated: capability.docs?.deprecated,
      deprecatedReason: capability.docs?.deprecatedReason,
      retention: capability.docs?.retention,
      fields,
    })
  }

  capabilities.sort(
    (a, b) => a.file.localeCompare(b.file) || a.exportName.localeCompare(b.exportName),
  )

  return {
    schemaVersion: LIFECYCLE_MODEL_SCHEMA_VERSION,
    capabilities,
    expiring: computeExpiringEntries(inventory, expiringWithinDays, now),
  }
}
