import { PRIVACY_FUNCTIONS } from "./function-map.js"
import type { CategoryEvidence } from "./types.js"

/**
 * Renders `docs/ISO-IEC-27701-2025.md`. The disclaimer subtitle is load-
 * bearing, not decorative -- ISO/IEC 27701:2025 (the privacy-information-
 * management extension to ISO/IEC 27001) is itself a copyrighted,
 * purchasable standard this document never quotes or reproduces. What this
 * document actually maps this app's real, gathered evidence against is the
 * openly published NIST Privacy Framework's process structure (a US
 * federal government work, public domain under 17 U.S.C. Sec. 105 -- see
 * function-map.ts's own sourcing comment) -- chosen as the open substrate
 * because both frameworks organize privacy management around the same
 * general subject area (govern / identify / control / communicate /
 * protect data processing), so a reader evaluating ISO/IEC 27701 readiness
 * has a real, evidence-backed, non-normative starting point, never a
 * conformance claim against either standard.
 * @param input - What to render.
 * @param input.entries - Every Category's evidence status.
 * @param input.generatedAt - ISO 8601 timestamp of this render.
 * @returns The full Markdown document.
 */
export function renderAlignmentMarkdown(input: {
  readonly entries: readonly CategoryEvidence[]
  readonly generatedAt: string
}): string {
  const { entries, generatedAt } = input
  const lines: string[] = []

  lines.push("# ISO/IEC 27701:2025 evidence and alignment report")
  lines.push("")
  lines.push(
    '> **Informational Evidence and Alignment Report -- not a certification, conformity assessment, or reproduction of any standard.** ISO/IEC 27701:2025 ("Security techniques -- Extension to ISO/IEC 27001 and ISO/IEC 27002 for privacy information management") is itself a copyrighted, purchasable standard this document never quotes or reproduces. What this document actually maps this application\'s own, real evidence against is the openly published [NIST Privacy Framework](https://doi.org/10.6028/NIST.CSWP.01162020) (Version 1.0, a US federal government work, public domain) -- its five Functions and the Categories within each, a factual structure (see [`scripts/nist-privacy-framework/function-map.ts`](../scripts/nist-privacy-framework/function-map.ts)), chosen because both frameworks organize privacy management around the same general subject area. **This does not claim conformance with ISO/IEC 27701, ISO/IEC 27001, or the NIST Privacy Framework itself**, and is not a certification of any kind from any body. Every "Evidence found" entry below traces to a specific, named source -- one of `data-cap`\'s own published reference evidence projections (`data-cap/build`), applied to this application\'s own generated `docs/data.evidence.json` -- no claim here is made without a traceable evidence source. Every "No evidence" entry says so explicitly, rather than being silently omitted.',
  )
  lines.push("")
  lines.push(`_Generated ${generatedAt} against this example's own \`docs/data.evidence.json\`._`)
  lines.push("")

  const found = entries.filter((e) => e.status === "evidence-found").length
  lines.push(
    `**${String(found)} of ${String(entries.length)} Categories have evidence-backed entries below** -- the remainder are explicitly marked "No evidence" with a stated reason, most commonly because this deliberately minimal example app has no fact to offer for that Category (e.g. no third-party data processing ecosystem, no formal risk-assessment process).`,
  )
  lines.push("")

  for (const fn of PRIVACY_FUNCTIONS) {
    lines.push(`## ${fn.name}`)
    lines.push("")
    lines.push(`_${fn.purpose}_`)
    lines.push("")
    lines.push("| Category | Status | Evidence |")
    lines.push("| --- | --- | --- |")
    for (const category of fn.categories) {
      const entry = entries.find(
        (e) => e.functionId === fn.id && e.categoryId === category.id,
      )
      const status = entry?.status === "evidence-found" ? "Evidence found" : "No evidence"
      const summary = (entry?.summary ?? "Not evaluated by this generator.")
        .replace(/\|/g, "\\|")
        .replace(/\n/g, " ")
      lines.push(`| ${category.name} (${category.id}) | ${status} | ${summary} |`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
