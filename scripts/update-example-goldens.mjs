#!/usr/bin/env node
// Regenerates real, committed golden output from a fresh run. Deliberately
// NOT part of `npm run verify`/CI -- this is a human-invoked "I
// intentionally changed the observed behavior, here's the new golden" step.
// See examples/README.md.
//
// Two maps, not one: FLAGSHIPS are the 3 curated `examples/` projects;
// FIXTURES are the 16 real-mechanism regression fixtures relocated into
// `test/integration/` (see this session's three-tier restructuring). Same
// `npm start` step either way (real `node:assert/strict` checks), but only
// FIXTURES additionally golden-compare a synthetic `output.json` summary --
// FLAGSHIPS instead golden-compare data-cap's own real, generated
// documentation (REPORT_CONFIGS below), since a reader-facing example
// showing a made-up JSON summary next to its own source is confusing and
// isn't itself part of what data-cap produces (see this session's removal
// of `output.json` from the 3 flagships for the full reasoning).

import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const examplesRoot = path.join(root, "examples")
const integrationRoot = path.join(root, "test/integration")
const cliDist = path.join(root, "dist/cli/index.js")

const FLAGSHIPS = ["application", "team-service", "enterprise-platform"]

const FIXTURES = [
  "runtime-core/basic-standalone",
  "runtime-core/server-database-integration",
  "runtime-core/optimistic-mutation-concurrency",
  "runtime-core/array-identity-reconciliation",
  "subscriptions/subscription-lifecycle",
  "subscriptions/subscription-with-recover",
  "subscriptions/multi-capability-shared-transport",
  "subscriptions/socket-io-subscription",
  "coordinator/coordinator-dedup",
  "coordinator/coordinator-isolation",
  "runtime-modules/runtime-cache",
  "runtime-modules/runtime-retry",
  "adoption-patterns/tanstack-query-integration",
  "build-tooling/tsconfig-aliases",
  "build-tooling/tsconfig-aliases-consumer",
  "build-tooling/eslint-plugin-usage",
]

// data-cap CLI args (relative to the project's own directory) for each
// project whose `docs/` subdirectory is a committed, real-generator-output
// behavioral spec -- see specs/generated-artifacts.md and each project's
// own README "Generated reports" section for what these actually
// demonstrate. A project not listed here has no committed `docs/` output.
const DEFAULT_FLAGSHIP_REPORT_ARGS = [
  "--include",
  "src/**",
  "--location",
  "src/generated/data.manifest.ts",
  "--docs",
  "docs/DATA.md",
  "--ownership",
  "docs/OWNERSHIP.md",
  "--flow",
  "docs/flow",
  "--evidence",
  "docs/data.evidence.json",
]

const REPORT_CONFIGS = {
  application: DEFAULT_FLAGSHIP_REPORT_ARGS,
  "team-service": DEFAULT_FLAGSHIP_REPORT_ARGS,
  "enterprise-platform": DEFAULT_FLAGSHIP_REPORT_ARGS,
  "runtime-core/server-database-integration": ["--include", "src/**", "--docs", "docs/DATA.md"],
}

// `enterprise-platform` also has two hand-written report generators
// (`reports/litigation-evidence.ts`/`audit-prep.ts`) outside the CLI's own
// docs/ownership/flow generation -- `npm run reports` regenerates both.
const EXTRA_GOLDEN_SCRIPTS = {
  "enterprise-platform": ["reports"],
}

function updateGolden(name, projectDir, { writesOutputJson }) {
  if (!existsSync(path.join(projectDir, "node_modules"))) {
    console.log(`[skip] ${name}: node_modules not installed (run npm install in ${name} first)`)
    return
  }

  console.log(`[golden] ${name}: regenerating...`)
  execFileSync("npm", ["run", "--silent", "start"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (writesOutputJson) {
    const expectedDir = path.join(projectDir, "expected")
    mkdirSync(expectedDir, { recursive: true })
    cpSync(path.join(projectDir, "output.json"), path.join(expectedDir, "output.json"))
  }
  console.log(`[golden] ${name}: done.`)

  const reportArgs = REPORT_CONFIGS[name]
  if (!reportArgs) return
  if (!existsSync(cliDist)) {
    console.log(
      `[skip] ${name}: docs/ (dist/cli/index.js not built -- run \`npm run build\` first)`,
    )
    return
  }

  console.log(`[golden] ${name}: regenerating docs/...`)
  execFileSync("node", [cliDist, "--root", ".", ...reportArgs], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  console.log(`[golden] ${name}: docs/ done.`)

  for (const script of EXTRA_GOLDEN_SCRIPTS[name] ?? []) {
    console.log(`[golden] ${name}: running \`npm run ${script}\`...`)
    execFileSync("npm", ["run", "--silent", script], {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    console.log(`[golden] ${name}: \`npm run ${script}\` done.`)
  }
}

for (const name of FLAGSHIPS) {
  updateGolden(name, path.join(examplesRoot, name), { writesOutputJson: false })
}
for (const name of FIXTURES) {
  updateGolden(name, path.join(integrationRoot, name), { writesOutputJson: true })
}

console.log("\nGolden fixtures updated. Review the diff before committing.")
