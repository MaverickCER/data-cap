/**
 * Deterministic, name-based, RFC 4122 *shaped* identifiers for projections that
 * need a UUID (OSCAL requires one on almost every record). The same key always
 * yields the same identifier, so regenerating an artifact from unchanged
 * evidence produces an identical file and a diff shows only what changed.
 *
 * This is not a cryptographic UUIDv5 (no SHA-1 namespace hashing): it is a
 * 128-bit non-cryptographic hash, with the version (5) and variant bits set so
 * the result is a well-formed name-based UUID. Nothing here is a secret or a
 * security boundary. Isomorphic: no `node:crypto`.
 */

/** cyrb128 -- a small, well-distributed 128-bit string hash. */
function hash128(text: string): readonly [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (const unit of text.split("")) {
    const code = unit.charCodeAt(0)
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** A stable, well-formed (version 5, RFC 4122 variant) UUID for `key`. */
export function deterministicUuid(key: string): string {
  const hex = hash128(key)
    .map((part) => part.toString(16).padStart(8, "0"))
    .join("")
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
