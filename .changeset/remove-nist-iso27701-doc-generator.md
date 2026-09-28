---
"data-cap": minor
---

Removes the `examples/nextjs-app` NIST-Privacy-Framework-informed alignment report generator (`scripts/nist-privacy-framework/`, `npm run docs:privacy`, and the generated `docs/ISO-IEC-27701-2025.md`). The generated document's title claimed alignment with ISO/IEC 27701:2025 — a copyrighted, purchasable standard — while its actual content was derived entirely from the openly published NIST Privacy Framework. That mismatch between the title and the real source is a real mislabeling/copyright-exposure risk, not a design preference, so the generator and its output are deleted outright with no replacement in this change. `npm run build` for the example no longer chains `docs:privacy`; the unused `tsx` devDependency is also removed.
