/**
 * OpenTelemetry mapping for runtime observations (ADR 0070, ADR 0072): the
 * Evidence Model's `observation` as OTLP/JSON traces, and the reverse -- the
 * `data_cap.*` attributes an instrumented service puts on its own spans, read
 * back as observation events. data-cap takes **no OpenTelemetry dependency**:
 * this is a plain-data mapping, so any exporter or collector can carry it.
 *
 * What an OTel trace is evidence of matters. A span says the data crossed a
 * boundary in one execution; it does not prove that every static path is safe,
 * and it covers only the code that ran. The projection therefore emits one
 * span per aggregated observation (a summary, with the occurrence count), not
 * a timeline: observations carry no timestamps, so every span is stamped with
 * the evidence's generation instant. Names and paths only -- the reader takes
 * the documented `data_cap.*` attributes and nothing else, so a value that
 * happens to sit on a span can never be ingested.
 *
 * Isomorphic and deterministic.
 */

import type { EvidenceModel } from "../build/evidence-model.js"
import { flowBoundaryKinds } from "../flow/flow-model.js"
import type { FlowHandling } from "../flow/flow-model.js"
import type { ObservationEvent } from "../observe/index.js"
import { deterministicUuid } from "./uuid.js"

/** An OTLP/JSON attribute value, restricted to the two kinds this mapping uses. */
export type OtlpValue = { readonly stringValue: string } | { readonly intValue: string }

/** An OTLP/JSON attribute. */
export interface OtlpAttribute {
  readonly key: string
  readonly value: OtlpValue
}

/** An OTLP/JSON span, restricted to the fields this mapping populates. */
export interface OtlpSpan {
  readonly traceId: string
  readonly spanId: string
  readonly name: string
  /** `1` is SPAN_KIND_INTERNAL. */
  readonly kind: 1
  readonly startTimeUnixNano: string
  readonly endTimeUnixNano: string
  readonly attributes: readonly OtlpAttribute[]
  /** `{ code: 1 }` is STATUS_CODE_OK. */
  readonly status: { readonly code: 1 }
}

/** An OTLP/JSON traces payload, restricted to the fields this mapping populates. */
export interface OtlpTraces {
  readonly resourceSpans: readonly {
    readonly resource: { readonly attributes: readonly OtlpAttribute[] }
    readonly scopeSpans: readonly {
      readonly scope: { readonly name: string; readonly version: string }
      readonly spans: readonly OtlpSpan[]
    }[]
  }[]
}

/** Options for `observationsToOtlp`. */
export interface OtlpOptions {
  /** `service.name` of the resource (default `data-cap`). */
  readonly serviceName?: string | undefined
}

/** Options for `observationsFromOtlp`. */
export interface OtlpReadOptions {
  /** The most events one span's `data_cap.count` may expand to (default 10 000), so a hostile or buggy count cannot exhaust memory. */
  readonly maxEventsPerSpan?: number | undefined
}

/** What `observationsFromOtlp` read. */
export interface OtlpReadResult {
  readonly events: readonly ObservationEvent[]
  /** Spans that had some `data_cap.*` attributes but not a usable set, or a payload that was not OTLP traces at all. */
  readonly skipped: number
}

/** What the mapping reads from the Evidence Model. */
export type OtlpInput = Pick<EvidenceModel, "observation" | "provenance">

function str(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } }
}

function hex(uuid: string, length: number): string {
  return uuid.replace(/-/g, "").slice(0, length)
}

function nanos(iso: string): string {
  const millis = Date.parse(iso)
  return (BigInt(Number.isNaN(millis) ? 0 : millis) * 1_000_000n).toString()
}

/** Maps the observations to OTLP/JSON traces, or `undefined` when none were ingested. */
export function observationsToOtlp(
  evidence: OtlpInput,
  options: OtlpOptions = {},
): OtlpTraces | undefined {
  const { observation } = evidence
  if (observation === undefined) return undefined
  const time = nanos(evidence.provenance.generatedAt)

  const spans: OtlpSpan[] = observation.observations.map((item) => {
    // Listed in key order, so the output is deterministic without a sort.
    const attributes: readonly OtlpAttribute[] = [
      str("data_cap.boundary.kind", item.boundary.kind),
      str("data_cap.boundary.name", item.boundary.name),
      { key: "data_cap.count", value: { intValue: String(item.count) } },
      str("data_cap.field", item.field),
      ...(item.handling === undefined ? [] : [str("data_cap.handling", item.handling)]),
      str("data_cap.scope", item.scope),
    ]
    return {
      traceId: hex(deterministicUuid(`trace|${item.scope}`), 32),
      spanId: hex(deterministicUuid(`span|${item.id}`), 16),
      name: "data-cap.boundary.crossing",
      kind: 1,
      startTimeUnixNano: time,
      endTimeUnixNano: time,
      attributes,
      status: { code: 1 },
    }
  })

  return {
    resourceSpans: [
      {
        resource: { attributes: [str("service.name", options.serviceName ?? "data-cap")] },
        scopeSpans: [
          { scope: { name: "data-cap", version: evidence.provenance.toolVersion }, spans },
        ],
      },
    ],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function attributeMap(span: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>()
  const list = span["attributes"]
  if (!Array.isArray(list)) return map
  for (const entry of list) {
    if (isRecord(entry) && typeof entry["key"] === "string" && isRecord(entry["value"]))
      map.set(entry["key"], entry["value"])
  }
  return map
}

function text(value: Record<string, unknown> | undefined): string | undefined {
  const candidate = value?.["stringValue"]
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined
}

function count(value: Record<string, unknown> | undefined, max: number): number {
  const raw = value?.["intValue"]
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN
  if (!Number.isFinite(parsed)) return 1
  return Math.min(Math.max(Math.floor(parsed), 1), max)
}

/** Every span object of an OTLP/JSON traces payload whose `resourceSpans` is an array; anything malformed along the way is passed over. */
function* spansOf(resourceSpans: readonly unknown[]): Generator<Record<string, unknown>> {
  for (const resource of resourceSpans) {
    if (!isRecord(resource) || !Array.isArray(resource["scopeSpans"])) continue
    for (const scope of resource["scopeSpans"]) {
      if (!isRecord(scope) || !Array.isArray(scope["spans"])) continue
      for (const span of scope["spans"]) if (isRecord(span)) yield span
    }
  }
}

/** The observation scope of a span: its `data_cap.scope`, else its trace id. */
function scopeOfSpan(
  span: Record<string, unknown>,
  attributes: ReadonlyMap<string, Record<string, unknown>>,
): string | undefined {
  const declared = text(attributes.get("data_cap.scope"))
  if (declared !== undefined) return declared
  const traceId = span["traceId"]
  return typeof traceId === "string" && traceId.length > 0 ? traceId : undefined
}

/**
 * Reads one span: its events (none when it carries no `data_cap.*` attribute, so it is not data-cap's),
 * or `"skipped"` when it has some of them but not a usable set.
 */
function eventsOfSpan(span: Record<string, unknown>, max: number): ObservationEvent[] | "skipped" {
  const handlings: readonly FlowHandling[] = [
    "plaintext",
    "masked",
    "redacted",
    "hashed",
    "encrypted",
  ]
  const attributes = attributeMap(span)
  if (![...attributes.keys()].some((key) => key.startsWith("data_cap."))) return []
  const field = text(attributes.get("data_cap.field"))
  const kindText = text(attributes.get("data_cap.boundary.kind"))
  const kind = flowBoundaryKinds().find((candidate) => candidate === kindText)
  const name = text(attributes.get("data_cap.boundary.name"))
  const scopeId = scopeOfSpan(span, attributes)
  if (field === undefined || kind === undefined || name === undefined || scopeId === undefined)
    return "skipped"
  const handlingText = text(attributes.get("data_cap.handling"))
  const handling = handlings.find((candidate) => candidate === handlingText)
  const event: ObservationEvent = {
    scope: scopeId,
    boundary: { kind, name },
    field,
    ...(handling === undefined ? {} : { handling }),
  }
  return Array.from({ length: count(attributes.get("data_cap.count"), max) }, () => event)
}

/** Reads the `data_cap.*` attributes off any OTLP/JSON traces payload. Spans that carry none are not data-cap's and are ignored. */
export function observationsFromOtlp(
  payload: unknown,
  options: OtlpReadOptions = {},
): OtlpReadResult {
  if (!isRecord(payload) || !Array.isArray(payload["resourceSpans"]))
    return { events: [], skipped: 1 }
  const max = Math.max(1, options.maxEventsPerSpan ?? 10_000)
  const events: ObservationEvent[] = []
  let skipped = 0

  for (const span of spansOf(payload["resourceSpans"])) {
    const read = eventsOfSpan(span, max)
    if (read === "skipped") skipped += 1
    else for (const event of read) events.push(event)
  }
  return { events, skipped }
}
