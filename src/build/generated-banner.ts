/**
 * The marker every build-tooling-generated file starts with, so it's
 * unambiguous the file is derived output, never hand-edited -- and so
 * `check-artifacts.ts`'s drift check can refuse to ever overwrite a
 * hand-written file that happens to occupy the same output path.
 */

/**
 * Regeneration instruction for a report the CLI does not write (ADR 0066) -- a function, not a
 * `const`, so mutation testing evaluates it per call: it is produced by the
 * project's own script calling the `data-cap/build` generators, so naming `npx data-cap` there would
 * send a reader to a command that cannot regenerate it.
 */
export function reportRegenerateHint(): string {
  return "Regenerate it by re-running the script that calls `generateDocumentation()` / `generateUsage()` / `generateFlow()` from `data-cap/build`."
}

/** The literal marker text, as a function so mutation testing evaluates it per call rather than once at load. */
function marker(): string {
  return "GENERATED FILE -- do not edit by hand."
}

/**
 * Renders the "do not edit by hand" marker in the given comment syntax.
 * @param format - Comment syntax to render in.
 * @param regenerate - How to regenerate; defaults to the CLI, which writes the manifest.
 * @returns The comment line.
 */
export function generatedBanner(
  format: "ts" | "markdown" = "ts",
  regenerate = "Run `npx data-cap` to regenerate.",
): string {
  const text = `${marker()} ${regenerate}`
  return { ts: `// ${text}`, markdown: `<!-- ${text} -->` }[format]
}

/** Whether `content` starts with a `generatedBanner()`-produced marker, in either format and with any regeneration hint. */
export function isGeneratedFile(content: string): boolean {
  return content.startsWith(`// ${marker()}`) || content.startsWith(`<!-- ${marker()}`)
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
    "Projected from data-cap's Evidence Model (https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md), the same source every other generated artifact draws from."
  return evidencePath === undefined
    ? concept
    : `${concept} This run also wrote it to \`${evidencePath}\`.`
}
