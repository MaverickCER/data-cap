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
  /** Present on a scope's observation spans when `scopeRoots` is on: the root span of that scope. */
  readonly parentSpanId?: string
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
  /**
   * Also emit one root span per scope (`data_cap.scope.root = "true"`, spanning the scope's first..last seen when the
   * scope carried times) and point each observation span of that scope at it with `parentSpanId`. Off by default so
   * the flat output stays byte-identical. The reader skips roots without counting them.
   */
  readonly scopeRoots?: boolean | undefined
}

/** Options for `observationsFromOtlp`. */
export interface OtlpReadOptions {
  /** The most events one span's `data_cap.count` may expand to (default 10 000), so a hostile or buggy count cannot exhaust memory. */
  readonly maxEventsPerSpan?: number | undefined
  /**
   * Also take `startTimeUnixNano`/`endTimeUnixNano` from spans NOT marked `data_cap.timed` (default false: such a
   * span's stamp is usually the exporter's own instant, not an observation time). The first event of a span gets the
   * start, the others the end. Only spans that carry the `data_cap.*` attributes are read at all. Invalid times are
   * ignored and counted in `ignoredTimes`.
   */
  readonly trustForeignTimes?: boolean | undefined
}

/** What `observationsFromOtlp` read. */
export interface OtlpReadResult {
  readonly events: readonly ObservationEvent[]
  /** Spans that had some `data_cap.*` attributes but not a usable set, or a payload that was not OTLP traces at all. */
  readonly skipped: number
  /** Start/end times that were read (the span was timed, or `trustForeignTimes` was set) but missing or not a decimal-nanosecond string; absent when none. */
  readonly ignoredTimes?: number
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

  const rooted = options.scopeRoots === true
  const rootIds = new Map(
    observation.scopes.map((scope) => [scope, hex(deterministicUuid(`span|root|${scope}`), 16)]),
  )
  const roots: OtlpSpan[] = rooted
    ? observation.scopes.map((scope) => {
        const times = observation.scopeTimes?.find((candidate) => candidate.scope === scope)
        return {
          traceId: hex(deterministicUuid(`trace|${scope}`), 32),
          spanId: hex(deterministicUuid(`span|root|${scope}`), 16),
          name: "data-cap.scope",
          kind: 1,
          startTimeUnixNano: times === undefined ? time : nanos(times.firstSeen),
          endTimeUnixNano: times === undefined ? time : nanos(times.lastSeen),
          attributes: [
            str("data_cap.scope", scope),
            str("data_cap.scope.root", "true"),
            ...(times === undefined ? [] : [str("data_cap.timed", "true")]),
          ],
          status: { code: 1 },
        }
      })
    : []

  const children: OtlpSpan[] = observation.observations.map((item) => {
    const timed = item.firstSeen !== undefined && item.lastSeen !== undefined
    const parent = rooted ? rootIds.get(item.scope) : undefined
    // Listed in key order, so the output is deterministic without a sort.
    const attributes: readonly OtlpAttribute[] = [
      str("data_cap.boundary.kind", item.boundary.kind),
      str("data_cap.boundary.name", item.boundary.name),
      { key: "data_cap.count", value: { intValue: String(item.count) } },
      str("data_cap.field", item.field),
      ...(item.handling === undefined ? [] : [str("data_cap.handling", item.handling)]),
      str("data_cap.scope", item.scope),
      ...(timed ? [str("data_cap.timed", "true")] : []),
    ]
    return {
      traceId: hex(deterministicUuid(`trace|${item.scope}`), 32),
      spanId: hex(deterministicUuid(`span|${item.id}`), 16),
      ...(parent === undefined ? {} : { parentSpanId: parent }),
      name: "data-cap.boundary.crossing",
      kind: 1,
      startTimeUnixNano: item.firstSeen === undefined ? time : nanos(item.firstSeen),
      endTimeUnixNano: item.lastSeen === undefined ? time : nanos(item.lastSeen),
      attributes,
      status: { code: 1 },
    }
  })
  const spans = [...roots, ...children]

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

/** A span's `startTimeUnixNano`/`endTimeUnixNano` (a decimal string) as epoch ms; `undefined` for anything else. */
function millisOfNanos(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined
  return Number(BigInt(value) / 1_000_000n)
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

/** What reading one span gave: its events and the times it could not use, or why it gave none. */
type SpanRead =
  | { readonly events: readonly ObservationEvent[]; readonly ignoredTimes: number }
  | "skipped"
  | "root"

/** A span time: the instant (epoch ms) when valid, else `"ignored"`. */
function spanTime(span: Record<string, unknown>, key: string): number | "ignored" {
  return millisOfNanos(span[key]) ?? "ignored"
}

/**
 * Reads one span: its events (none when it carries no `data_cap.*` attribute, so it is not data-cap's),
 * `"root"` for a scope root (carries no observation), or `"skipped"` when it has some of the attributes but not a usable set.
 */
function eventsOfSpan(span: Record<string, unknown>, max: number, trust: boolean): SpanRead {
  const handlings: readonly FlowHandling[] = [
    "plaintext",
    "masked",
    "redacted",
    "hashed",
    "encrypted",
  ]
  const attributes = attributeMap(span)
  if (![...attributes.keys()].some((key) => key.startsWith("data_cap."))) {
    return { events: [], ignoredTimes: 0 }
  }
  if (text(attributes.get("data_cap.scope.root")) === "true") return "root"
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
  // Real times only on spans this mapping marked as timed (or when the caller trusts foreign ones); an untimed
  // span's stamp is the generation instant, not an observation time.
  if (!trust && text(attributes.get("data_cap.timed")) !== "true") {
    return { events: repeated(event, attributes, max, undefined, undefined), ignoredTimes: 0 }
  }
  const start = spanTime(span, "startTimeUnixNano")
  const end = spanTime(span, "endTimeUnixNano")
  const ignoredTimes = [start, end].filter((time) => time === "ignored").length
  return {
    events: repeated(
      event,
      attributes,
      max,
      start === "ignored" ? undefined : start,
      end === "ignored" ? undefined : end,
    ),
    ignoredTimes,
  }
}

/** `data_cap.count` copies of `event`: the first stamped with `start`, the rest with `end`. */
function repeated(
  event: ObservationEvent,
  attributes: ReadonlyMap<string, Record<string, unknown>>,
  max: number,
  start: number | undefined,
  end: number | undefined,
): ObservationEvent[] {
  return Array.from({ length: count(attributes.get("data_cap.count"), max) }, (_, index) => {
    const at = index === 0 ? start : end
    return at === undefined ? event : { ...event, at }
  })
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
  let ignoredTimes = 0

  for (const span of spansOf(payload["resourceSpans"])) {
    const read = eventsOfSpan(span, max, options.trustForeignTimes === true)
    if (read === "skipped") skipped += 1
    else if (read !== "root") {
      for (const event of read.events) events.push(event)
      ignoredTimes += read.ignoredTimes
    }
  }
  return { events, skipped, ...(ignoredTimes === 0 ? {} : { ignoredTimes }) }
}
