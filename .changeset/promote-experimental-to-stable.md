---
"data-cap": minor
---

Promotes every remaining Experimental-tier surface to Stable (ADR 0065):
`./build`'s `discoverCapabilityFiles`/`parseCapabilityFile`/
`linkCapabilityFiles`/`evaluateLiteral`/`resolution/*` (including the
`--package`/`--tsconfig` CLI flags and cross-package schema discovery), and
`./runtime`'s `createData`. No behavior change -- this is a compatibility
commitment change only. The Experimental tier remains defined in
`VERSIONING.md` for future genuinely-new surfaces; nothing currently ships
under it.
