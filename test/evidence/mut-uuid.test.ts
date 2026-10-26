import { describe, expect, it } from "vitest"
import { deterministicUuid } from "../../src/evidence/uuid.js"

describe("deterministicUuid exact values", () => {
  it("pins the hash for a spread of keys", () => {
    const keys = ["", "a", "b", "ab", "ba", "anything", "x".repeat(40), "é\u{1F600}", "0", "1"]
    expect(keys.map((key) => deterministicUuid(key))).toMatchInlineSnapshot(`
      [
        "027ae52e-cfc7-5621-9593-990d4b41437c",
        "5eb8e4e4-08de-5167-8f5f-05b958089485",
        "47441078-00cf-5b72-b689-5885fdd307b0",
        "2cbb33e9-1d23-567b-a983-748780a2fccd",
        "1bd9bada-35d5-5f26-ae0a-d23e2660a00e",
        "335bb06e-0012-54b8-9b73-07b535dd11f6",
        "349d07d5-6180-5379-a411-8d606d9cb888",
        "c354ce6e-7df3-5a25-938b-e6efd2e9d8b6",
        "f74d4ea5-48cf-5fef-a93e-04175f3557ce",
        "f0354f73-910f-5585-8e90-e4e49a48fbb9",
      ]
    `)
  })

  it("keeps the version nibble 5 and the variant in 8..b over many keys", () => {
    const seen = new Set<string>()
    for (let index = 0; index < 400; index += 1) {
      const uuid = deterministicUuid(`key-${index}`)
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      seen.add(uuid.charAt(19))
    }
    expect([...seen].sort()).toEqual(["8", "9", "a", "b"])
  })
})
