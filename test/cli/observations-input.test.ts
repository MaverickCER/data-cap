import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readObservationsFile, readObservationsInput } from "../../src/cli/index.js"

const event = { scope: "s", boundary: { kind: "api", name: "x" }, field: "a.b" }
const skip = { scope: "s", boundary: { kind: "api", name: "x" }, field: "a", reason: "dotted-key" }

describe("readObservationsInput: the --observations file", () => {
  let dir: string
  beforeEach(async () => {
    dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "data-cap-obs-input-"))
  })
  afterEach(async () => {
    await fsPromises.rm(dir, { recursive: true, force: true })
  })
  const write = async (value: unknown): Promise<string> => {
    const file = path.join(dir, "obs.json")
    await fsPromises.writeFile(file, JSON.stringify(value), "utf8")
    return file
  }

  it("reads a bare array as events with no skips", async () => {
    expect(await readObservationsInput(await write([event]))).toEqual({
      events: [event],
      skips: [],
    })
  })

  it("reads { events, skips } so what the recorder left out reaches the claims", async () => {
    const file = await write({ events: [event], skips: [skip] })
    expect(await readObservationsInput(file)).toEqual({ events: [event], skips: [skip] })
  })

  it("treats a missing skips list as none", async () => {
    expect(await readObservationsInput(await write({ events: [event] }))).toEqual({
      events: [event],
      skips: [],
    })
  })

  it("rejects an object without an events array", async () => {
    await expect(readObservationsInput(await write({ skips: [skip] }))).rejects.toThrow(
      /JSON array of observation events, or an object with an "events" array/,
    )
  })

  it("rejects skips that are not an array", async () => {
    await expect(readObservationsInput(await write({ events: [], skips: "no" }))).rejects.toThrow(
      /"skips" must be an array/,
    )
  })

  it("rejects anything else, naming the file", async () => {
    const file = await write("text")
    await expect(readObservationsInput(file)).rejects.toThrow(`--observations ${file}`)
  })

  it("readObservationsFile still returns just the events, for either form", async () => {
    expect(await readObservationsFile(await write({ events: [event], skips: [skip] }))).toEqual([
      event,
    ])
  })
})
