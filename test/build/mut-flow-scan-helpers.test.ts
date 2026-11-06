import { describe, expect, it } from "vitest"
import { DEFAULT_FLOW_SINKS, holdsFields, holdsPromise } from "../../src/build/flow-scan-helpers.js"
import { EMPTY_VAL, PROMISE_HANDLE, handleVal } from "../../src/build/flow-values.js"

/** The small rules of the scan, one at a time. */
describe("flow-scan helpers", () => {
  it("the sinks a scan knows without being told, by callee and what they send data to", () => {
    expect(
      DEFAULT_FLOW_SINKS.map(
        (sink) => `${sink.callee} -> ${sink.boundary.kind}:${sink.boundary.name}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "res.json -> client-response:http-response",
        "res.send -> client-response:http-response",
        "res.end -> client-response:http-response",
        "res.write -> client-response:http-response",
        "res.render -> client-response:http-response",
        "res.redirect -> client-response:http-response",
        "reply.send -> client-response:http-response",
        "Response.json -> client-response:http-response",
        "NextResponse.json -> client-response:http-response",
        "console.log -> log:console",
        "console.info -> log:console",
        "console.warn -> log:console",
        "console.error -> log:console",
        "console.debug -> log:console",
        "console.trace -> log:console",
        "logger.info -> log:logger",
        "logger.warn -> log:logger",
        "logger.error -> log:logger",
        "logger.debug -> log:logger",
        "logger.trace -> log:logger",
        "logger.log -> log:logger",
      ]
    `)
  })

  it("a value holds fields when it is the fields object, a capability, or has one below it", () => {
    const below = { ...EMPTY_VAL, props: new Map([["a", { ...EMPTY_VAL, capability: "k" }]]) }
    expect({
      empty: holdsFields(EMPTY_VAL),
      fieldsObject: holdsFields({ ...EMPTY_VAL, fieldsOf: "k" }),
      capability: holdsFields({ ...EMPTY_VAL, capability: "k" }),
      capabilityBelow: holdsFields(below),
      deeper: holdsFields({ ...EMPTY_VAL, props: new Map([["b", below]]) }),
      plainProps: holdsFields({ ...EMPTY_VAL, props: new Map([["a", EMPTY_VAL]]) }),
    }).toMatchInlineSnapshot(`
      {
        "capability": true,
        "capabilityBelow": true,
        "deeper": true,
        "empty": false,
        "fieldsObject": true,
        "plainProps": false,
      }
    `)
  })

  it("a value holds a promise when it is one, or has one below it", () => {
    const promise = handleVal(PROMISE_HANDLE, "p")
    const below = { ...EMPTY_VAL, props: new Map([["a", promise]]) }
    expect({
      empty: holdsPromise(EMPTY_VAL),
      promise: holdsPromise(promise),
      promiseBelow: holdsPromise(below),
      deeper: holdsPromise({ ...EMPTY_VAL, props: new Map([["b", below]]) }),
      plainProps: holdsPromise({ ...EMPTY_VAL, props: new Map([["a", EMPTY_VAL]]) }),
    }).toMatchInlineSnapshot(`
      {
        "deeper": true,
        "empty": false,
        "plainProps": false,
        "promise": true,
        "promiseBelow": true,
      }
    `)
  })
})
