---
"data-cap": patch
---

Documentation now describes the TypeScript 6 compiler as the package's one npm dependency, bundled inside the tarball and used only by the build entry (about 24 MB unpacked, not 26), and what installing the package adds is generated into ADOPTION.md from `package.json`. The standard-format documents data-cap generates (SARIF, OSCAL, CycloneDX, PROV-JSON, OTLP, DOT, Mermaid) are a generated table in `specs/generated-artifacts.md`, each row citing the test that checks the format. The official schemas the tests validate against are internal-package-contract's managed, hash-pinned copies; the CycloneDX files now come from the specification's `1.6.2` release instead of its `master` branch. The enterprise example's litigation-evidence report is renamed to a data-handling record, and its GDPR Art. 30(1)(e) mapping is marked partial.
