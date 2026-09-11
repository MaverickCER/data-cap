import { describe, expect, it } from "vitest"
import { canonicalize, identity, processors, shape } from "../../src/helpers/index.js"
import { canonicalize as coreCanonicalize } from "../../src/core/canonicalize.js"
import {
  computeItemIdentity as coreComputeItemIdentity,
  reconcileArrayInfo as coreReconcileArrayInfo,
} from "../../src/core/identity.js"
import * as standaloneProcessors from "../../src/helpers/processors.js"
import * as standaloneShape from "../../src/helpers/shape.js"

describe("helpers public barrel", () => {
  it("exposes canonicalize as the direct core function", () => {
    expect(canonicalize).toBe(coreCanonicalize)
  })

  it("exposes identity as a namespace object wired to core's own functions", () => {
    expect(identity.computeItemIdentity).toBe(coreComputeItemIdentity)
    expect(identity.reconcileArrayInfo).toBe(coreReconcileArrayInfo)
  })

  it("exposes every processors.ts export under the processors namespace, by the same reference", () => {
    expect(processors.toString).toBe(standaloneProcessors.toString)
    expect(processors.toNumber).toBe(standaloneProcessors.toNumber)
    expect(processors.toInteger).toBe(standaloneProcessors.toInteger)
    expect(processors.toBoolean).toBe(standaloneProcessors.toBoolean)
    expect(processors.toDate).toBe(standaloneProcessors.toDate)
    expect(processors.toURL).toBe(standaloneProcessors.toURL)
    expect(processors.toRegExp).toBe(standaloneProcessors.toRegExp)
    expect(processors.toBigInt).toBe(standaloneProcessors.toBigInt)
    expect(processors.trim).toBe(standaloneProcessors.trim)
    expect(processors.toLowerCase).toBe(standaloneProcessors.toLowerCase)
    expect(processors.toUpperCase).toBe(standaloneProcessors.toUpperCase)
    expect(processors.toArray).toBe(standaloneProcessors.toArray)
    expect(processors.parseJSON).toBe(standaloneProcessors.parseJSON)
  })

  it("exposes every shape.ts export under the shape namespace, by the same reference", () => {
    expect(shape.isPlainObject).toBe(standaloneShape.isPlainObject)
    expect(shape.isDate).toBe(standaloneShape.isDate)
    expect(shape.isURL).toBe(standaloneShape.isURL)
    expect(shape.isRegExp).toBe(standaloneShape.isRegExp)
    expect(shape.isNullish).toBe(standaloneShape.isNullish)
  })
})
