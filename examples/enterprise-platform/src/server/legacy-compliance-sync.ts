/**
 * A pre-existing compliance-sync utility that predates both
 * `billing.capability.ts`'s and `identity.capability.ts`'s own
 * `documentData()` calls -- kept exactly as-is (not rewritten to use a
 * static field name) specifically to demonstrate data-cap's honest
 * disclosure of dynamic field access it can't statically resolve.
 * `billing.capability.ts`'s own `evidence.fields.invoices.dynamicAccess`
 * citation names this file's exact access line for `invoices`; nothing
 * cites the `identityData` access below, so the generated audit-prep
 * report resolves it to `"indeterminate"` -- a real, undeclared gap, not a
 * mistake this file papers over. See ADR 0052/ADR 0053 for what each
 * disclosure means and how a citation is re-verified.
 */
import { billingData } from "../capabilities/billing.capability.js"
import { identityData } from "../capabilities/identity.capability.js"
import { logger } from "./logger.js"

// Field names driven by config, not a literal property access -- exactly
// the kind of access `src/build/dependency-graph.ts` can prove happens, but
// can't statically attribute to one specific field.
const BILLING_AUDITED_FIELDS: readonly "invoices"[] = ["invoices"]
const IDENTITY_AUDITED_FIELDS: readonly "currentUser"[] = ["currentUser"]

export function auditCurrentFields(): void {
  for (const fieldName of BILLING_AUDITED_FIELDS) {
    const value = billingData.getSnapshot().fields[fieldName]
    logger.info(
      { event: "audit.field_snapshot", capability: "billingData", field: fieldName, value },
      "Legacy compliance sync",
    )
  }
  for (const fieldName of IDENTITY_AUDITED_FIELDS) {
    const value = identityData.getSnapshot().fields[fieldName]
    logger.info(
      { event: "audit.field_snapshot", capability: "identityData", field: fieldName, value },
      "Legacy compliance sync",
    )
  }
}
