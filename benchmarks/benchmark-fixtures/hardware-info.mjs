// Environment metadata collector -- Node builtins only, same
// dependency-free style as ../../scripts/check-size.mjs. Best-effort: a
// field that can't be determined on this platform is `null`, never thrown.

import { execFileSync } from "node:child_process"
import os from "node:os"
import { readFileSync } from "node:fs"

function physicalCores() {
  try {
    if (process.platform === "darwin") {
      return parseInt(
        execFileSync("sysctl", ["-n", "hw.physicalcpu"], { encoding: "utf8" }).trim(),
        10,
      )
    }
    if (process.platform === "linux") {
      const cpuinfo = readFileSync("/proc/cpuinfo", "utf8")
      const ids = new Set()
      let physicalId = "0"
      for (const line of cpuinfo.split("\n")) {
        if (line.startsWith("physical id")) physicalId = line.split(":")[1]?.trim() ?? "0"
        if (line.startsWith("core id")) ids.add(`${physicalId}:${line.split(":")[1]?.trim()}`)
      }
      return ids.size || null
    }
  } catch {
    return null
  }
  return null
}

function gitInfo(root) {
  const run = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
    } catch {
      return null
    }
  }
  const commit = run(["rev-parse", "HEAD"])
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"])
  const status = run(["status", "--porcelain"])
  return {
    gitCommit: commit,
    gitBranch: branch,
    gitDirty: status === null ? null : status.length > 0,
  }
}

export function collectEnvironmentInfo() {
  const cpus = os.cpus()
  return {
    cpuModel: cpus[0]?.model ?? null,
    cpuArchitecture: os.arch(),
    processArch: process.arch,
    logicalCores: cpus.length,
    physicalCores: physicalCores(),
    cpuFrequencyMHz: cpus[0]?.speed ?? null,
    platform: process.platform,
    osRelease: os.release(),
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    nodeVersion: process.version,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    isCI: Boolean(process.env.CI),
    runner: process.env.GITHUB_ACTIONS
      ? "GitHub Actions"
      : process.env.CI
        ? "CI (unspecified)"
        : "local",
  }
}

export function collectGitInfo(root) {
  return gitInfo(root)
}

export function collectProvenance() {
  return { generatedBy: process.env.CI ? "ci" : "npm run benchmark" }
}
