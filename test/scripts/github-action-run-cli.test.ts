import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/github-action/run-cli.sh",
)

/** Runs the script in a scratch project whose `npx` just records its argv, one per line. */
function run(env: Record<string, string>, options: { local?: boolean } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "run-cli-"))
  const bin = path.join(dir, "bin")
  mkdirSync(bin)
  writeFileSync(
    path.join(bin, "npx"),
    '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\nexit "${FAKE_NPX_EXIT:-0}"\n',
  )
  chmodSync(path.join(bin, "npx"), 0o755)
  if (options.local === true) {
    mkdirSync(path.join(dir, "node_modules/.bin"), { recursive: true })
    writeFileSync(path.join(dir, "node_modules/.bin/data-cap"), "#!/bin/sh\n")
    chmodSync(path.join(dir, "node_modules/.bin/data-cap"), 0o755)
  }
  const resultPath = path.join(dir, "result.json")
  const outputPath = path.join(dir, "output")
  writeFileSync(outputPath, "")
  const child = spawnSync("bash", [script], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env["PATH"] ?? ""}`,
      RESULT_PATH: resultPath,
      GITHUB_OUTPUT: outputPath,
      ...env,
    },
  })
  return {
    stdout: child.stdout,
    status: child.status,
    argv: existsSync(resultPath)
      ? readFileSync(resultPath, "utf8").split("\n").filter(Boolean)
      : [],
    output: readFileSync(outputPath, "utf8"),
  }
}

describe("run-cli.sh", () => {
  it("prefers the project's own install and never lets an input become shell syntax", () => {
    const result = run(
      { INPUT_ARGS: "--evidence docs/e.json; echo pwned $(id)", INPUT_VERSION: "9.9.9" },
      { local: true },
    )
    expect(result.argv.slice(0, 4)).toEqual(["--no-install", "data-cap", "--json", "--evidence"])
    expect(result.argv).toContain("echo")
    expect(result.stdout).not.toContain("uid=")
    expect(result.output).toBe("exit-code=0\n")
  })

  it("fetches the scoped package at the requested version when there is no local install", () => {
    const result = run({ INPUT_ARGS: "--check", INPUT_VERSION: "0.5.3" })
    expect(result.argv).toEqual(["--yes", "data-cap@0.5.3", "--json", "--check"])
  })

  it("passes the CLI's exit code through", () => {
    const result = run({ INPUT_ARGS: "--check", INPUT_VERSION: "0.5.3", FAKE_NPX_EXIT: "3" })
    expect(result.output).toBe("exit-code=3\n")
  })

  it("refuses an unpinned run: no local install and no version", () => {
    const result = run({ INPUT_ARGS: "--check" })
    expect(result.stdout).toContain("::error::data-cap is not installed")
    expect(result.output).toBe("exit-code=2\n")
  })

  it("refuses a version that is not a plain version or dist-tag", () => {
    const result = run({ INPUT_ARGS: "--check", INPUT_VERSION: "1.0.0 --foo" })
    expect(result.stdout).toContain("::error::The 'version' input")
    expect(result.output).toBe("exit-code=2\n")
  })
})
