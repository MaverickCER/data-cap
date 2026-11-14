/**
 * The shared "expiring soon" window default.
 *
 * Its own module, rather than living next to either consumer, purely to keep
 * the import graph acyclic: `generate-data-artifacts.ts` already imports
 * `generate-documentation.ts`, so a constant declared in the orchestrator
 * and read by the generator would close a cycle.
 */

/**
 * How many days out counts as "expiring soon" when a caller does not say: 30. It matches env-cap's
 * `DEFAULT_EXPIRING_WITHIN_DAYS`, so both packages give one answer.
 */
export const DEFAULT_EXPIRING_WITHIN_DAYS = 30
