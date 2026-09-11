/**
 * Build-tooling pattern: runs the real `stable-operation-reference` ESLint
 * rule, through ESLint's own Node API, against two real fixture files --
 * one using only stable module-level references (never flagged), one with
 * both mistakes the rule exists to catch.
 */
import assert from "node:assert/strict"
import path from "node:path"
import { writeFileSync } from "node:fs"
import { ESLint } from "eslint"

const root = path.join(import.meta.dirname, "..")
const eslint = new ESLint({ cwd: root })

const results = await eslint.lintFiles(["src/fixtures/good-usage.ts", "src/fixtures/bad-usage.ts"])

const goodResult = results.find((result) => result.filePath.endsWith("good-usage.ts"))
const badResult = results.find((result) => result.filePath.endsWith("bad-usage.ts"))
assert.ok(goodResult)
assert.ok(badResult)

assert.equal(
  goodResult.messages.length,
  0,
  "stable module-level execute/subscribe references are never flagged",
)

assert.equal(
  badResult.messages.length,
  2,
  "exactly two violations: the inline arrow function and the recreated-per-call reference",
)
const messageIds = badResult.messages.map((message) => message.messageId).sort()
assert.deepEqual(messageIds, ["inlineFunctionLiteral", "recreatedPerCall"])
assert.ok(
  badResult.messages.every((message) => message.ruleId === "data-cap/stable-operation-reference"),
)

const summary = {
  goodUsageViolationCount: goodResult.messages.length,
  badUsageViolationCount: badResult.messages.length,
  badUsageMessageIds: messageIds,
  ruleId: "data-cap/stable-operation-reference",
}

writeFileSync(
  path.join(import.meta.dirname, "../output.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
)

console.log("eslint-plugin-usage: all assertions passed.")
