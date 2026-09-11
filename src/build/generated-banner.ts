/**
 * The marker every build-tooling-generated file starts with, so it's
 * unambiguous the file is derived output, never hand-edited -- and so
 * `check-artifacts.ts`'s drift check can refuse to ever overwrite a
 * hand-written file that happens to occupy the same output path.
 */

/** Renders the "do not edit by hand" marker in the given comment syntax. */
export function generatedBanner(format: "ts" | "markdown" = "ts"): string {
  const text = "GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate."
  return { ts: `// ${text}`, markdown: `<!-- ${text} -->` }[format]
}

/** Whether `content` starts with a `generatedBanner()`-produced marker, in either format. */
export function isGeneratedFile(content: string): boolean {
  return (
    content.startsWith(generatedBanner("ts")) || content.startsWith(generatedBanner("markdown"))
  )
}

/**
 * Short disclaimer prepended to every artifact that renders sensitivity/
 * protections/endpoints claims (the docs catalog, ownership report,
 * data-flow diagram) -- see AGENTS.md's declared-vs-proven invariant.
 * Never omit this from an artifact that renders governance metadata: it's
 * what keeps "documented" from being misread as "verified" or "compliant."
 */
export function evidenceDisclaimer(): string {
  return "Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard."
}

/**
 * States, by concept, that this artifact is a projection of `data-cap`'s
 * Evidence Model (ADR 0050/0054) -- never a hardcoded path, since
 * `docs/data.evidence.json` only exists on a run that actually passed
 * `--evidence`; a project that never requests that flag would otherwise get
 * a banner pointing at a file that doesn't exist. `evidencePath`, when this
 * same run's own options did include `--evidence <path>`, names that
 * concrete path in addition to the concept -- callers pass it already
 * root-relative (`displayPath`), so a generated Markdown artifact never
 * embeds a machine-specific absolute path (OUT-01).
 */
export function evidenceProjectionNote(evidencePath?: string): string {
  const concept =
    "Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from."
  return evidencePath === undefined
    ? concept
    : `${concept} This run also wrote it to \`${evidencePath}\`.`
}
