#!/usr/bin/env node
// Turns a `data-cap --json` report into GitHub PR annotations, a job-summary
// table, and a sticky PR comment. Plain Node, no dependencies -- matches
// `scripts/check-size.mjs`'s dependency-free convention, and every GitHub
// interaction goes through the preinstalled `gh` CLI rather than octokit.
//
// data-cap's `ReportResult` already unifies every generator's output into
// one `findings: ReportFinding[]` array (see src/build/findings.ts) -- unlike
// a per-generator-shaped payload, this script needs exactly one mapping from
// `ReportFinding` to a GitHub annotation, not one collector per section.

import { execFileSync } from "node:child_process"
import { appendFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

/** @typedef {{ level: "error" | "warning" | "notice", file: string | undefined, message: string, code: string }} Finding */

const SEVERITY_TO_LEVEL = { error: "error", warning: "warning", info: "notice" }

/** @param {unknown} finding @returns {Finding} */
function toFinding(finding) {
  const capability = finding.capability
  const suffix = capability ? ` (${capability.exportName})` : ""
  return {
    level: SEVERITY_TO_LEVEL[finding.severity] ?? "notice",
    file: capability?.file ?? finding.source,
    message: `${finding.message}${suffix}`,
    code: finding.code,
  }
}

/**
 * `result.findings` is present on every successful run (`--json`'s
 * `ok: true` envelope always spreads the full `ReportResult`), including
 * `--check`. `result.error.findings` is present only when the run failed
 * with a `DataProjectGenerationError` (a real blocking finding) -- a usage
 * error (e.g. no target flags given) has no `findings` at all.
 * @param {unknown} result @returns {Finding[]}
 */
export function classifyFindings(result) {
  if (Array.isArray(result?.findings)) return result.findings.map(toFinding)
  if (Array.isArray(result?.error?.findings)) return result.error.findings.map(toFinding)
  return []
}

/** @param {unknown} result @returns {string} */
export function renderMarkdownSummary(result) {
  const lines = ["# data-cap report", ""]

  if (result?.ok === false) {
    lines.push(`**Generation failed:** \`${result.error?.name ?? "Error"}\``, "")
    if (!Array.isArray(result.error?.findings) && result.error?.message) {
      lines.push(result.error.message, "")
    }
  }

  const findings = classifyFindings(result)
  const counts = { error: 0, warning: 0, notice: 0 }
  for (const finding of findings) counts[finding.level] += 1
  lines.push(
    `- Errors: ${counts.error}`,
    `- Warnings: ${counts.warning}`,
    `- Notices: ${counts.notice}`,
    "",
  )

  const blocking = findings.filter((f) => f.level === "error")
  if (blocking.length > 0) {
    lines.push("## Blocking findings", "", "| Code | File | Message |", "|---|---|---|")
    for (const f of blocking) lines.push(`| ${f.code} | ${f.file ?? "--"} | ${f.message} |`)
    lines.push("")
  }

  const boundaryCrossings = findings.filter(
    (f) => f.code === "SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY",
  )
  if (boundaryCrossings.length > 0) {
    lines.push(
      "## Sensitive data crossing an external boundary",
      "",
      "| File | Message |",
      "|---|---|",
    )
    for (const f of boundaryCrossings) lines.push(`| ${f.file ?? "--"} | ${f.message} |`)
    lines.push("")
  }

  if (result?.manifest) {
    const count = result.manifest.snapshot?.capabilities?.length ?? 0
    lines.push(
      "## Manifest",
      "",
      `Wrote \`${result.manifest.location}\` -- ${count} active capability(ies).`,
      "",
    )
  }

  if (result?.checkResult) {
    lines.push(
      "## Drift check",
      "",
      result.checkResult.ok
        ? "All generated artifacts are up to date."
        : `${result.checkResult.stale?.length ?? 0} artifact(s) are stale or missing.`,
      "",
    )
  }

  // GitHub renders fenced ```mermaid``` blocks natively in both PR comments
  // and the job summary -- overview.md (already rendered by generateFlow)
  // embeds the Data Flow Diagram in exactly that form, so it's reused
  // directly rather than re-deriving a diagram from result.flow.files here.
  const overview = result?.flow?.files?.find((f) => f.path?.endsWith("overview.md"))
  if (overview) {
    lines.push("## Data Flow Diagram + Security Data-Flow Review", "", overview.content, "")
  }

  return lines.join("\n")
}

/**
 * `file` values coming out of the CLI are absolute paths resolved against
 * the CLI's own `--root` (`cliRoot`, i.e. `working-directory`), not
 * necessarily the Action's checkout root (`workspaceRoot`) -- the two only
 * coincide when `working-directory: .`. `path.resolve(cliRoot, file)` is
 * correct whether `file` was already absolute or root-relative to `cliRoot`.
 */
export function renderAnnotations(findings, cliRoot, workspaceRoot) {
  return findings.map((finding) => {
    const command = finding.level
    if (!finding.file) return `::${command}::[${finding.code}] ${finding.message}`
    const absolute = path.resolve(cliRoot, finding.file)
    const annotationPath = path.relative(workspaceRoot, absolute)
    return `::${command} file=${annotationPath}::[${finding.code}] ${finding.message}`
  })
}

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input })
}

function listComments(prNumber) {
  const output = gh(["api", `repos/{owner}/{repo}/issues/${prNumber}/comments`, "--paginate"])
  return JSON.parse(output)
}

function upsertComment(prNumber, marker, body) {
  const fullBody = `${marker}\n${body}`
  const existing = listComments(prNumber).find(
    (c) => typeof c.body === "string" && c.body.includes(marker),
  )
  if (existing) {
    gh(
      [
        "api",
        "--method",
        "PATCH",
        `repos/{owner}/{repo}/issues/comments/${existing.id}`,
        "--input",
        "-",
      ],
      JSON.stringify({ body: fullBody }),
    )
  } else {
    gh(
      [
        "api",
        "--method",
        "POST",
        `repos/{owner}/{repo}/issues/${prNumber}/comments`,
        "--input",
        "-",
      ],
      JSON.stringify({ body: fullBody }),
    )
  }
}

function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return undefined
  try {
    return JSON.parse(readFileSync(eventPath, "utf8"))
  } catch {
    return undefined
  }
}

function main() {
  const resultPath = process.env.RESULT_PATH
  if (!resultPath) throw new Error("RESULT_PATH is required.")

  const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd()
  const workingDirectory = process.env.WORKING_DIRECTORY ?? "."
  const cliRoot = path.resolve(workspaceRoot, workingDirectory)
  const doComment = process.env.DO_COMMENT === "true"
  const doAnnotations = process.env.DO_ANNOTATIONS === "true"
  const reportKey =
    process.env.REPORT_KEY && process.env.REPORT_KEY.length > 0
      ? process.env.REPORT_KEY
      : workingDirectory

  let result
  try {
    result = JSON.parse(readFileSync(resultPath, "utf8"))
  } catch (error) {
    // A malformed/missing result file means the `npx data-cap --json` step
    // itself failed to produce valid output (package resolution failure,
    // network error, ...) -- surface that plainly instead of letting a raw
    // SyntaxError/ENOENT stack trace be this Action's only diagnostic.
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      `Failed to read or parse the data-cap result file at "${resultPath}": ${message}\n`,
    )
    process.exitCode = 1
    return
  }
  const findings = classifyFindings(result)

  if (doAnnotations) {
    for (const line of renderAnnotations(findings, cliRoot, workspaceRoot))
      process.stdout.write(`${line}\n`)
  }

  const summary = renderMarkdownSummary(result)
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath) appendFileSync(summaryPath, `${summary}\n`)

  const event = readEvent()
  const prNumber = event?.pull_request?.number
  if (doComment && process.env.GITHUB_EVENT_NAME === "pull_request" && prNumber) {
    upsertComment(prNumber, `<!-- data-cap-report:${reportKey} -->`, summary)
  }
}

// Same direct-run guard as src/cli/index.ts -- importing this module from a
// test must never have the side effect of running main().
const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  main()
}
