# Generated artifacts: what `data-cap` produces, and what it deliberately doesn't

Check here before assuming `data-cap` generates something. This page is for people and coding agents working in this repository or in a consuming project.

Every artifact comes from one run of `computeDataArtifacts`, the function `generateDataArtifacts()` and `checkArtifacts()` share. That run builds one [`CapabilityInventory`](architecture.md#report-generation-model), composes it with the other fact models into one `EvidenceModel`, and projects every artifact from it ([ADR 0054](decisions/0054-evidence-model-as-orchestrator-backbone.md)). No artifact has a second, separate pipeline.

The CLI writes only the Evidence Model, with `--evidence` ([ADR 0066](decisions/0066-cli-restricted-to-runtime-and-evidence-output.md)). The manifest, catalog, ownership report and diagrams are requested from your own build script, through the `location`, `docs`, `ownership` and `flow` options.

**Every artifact here is evidence that can support a review: security, privacy or platform. None is a compliance claim.** Static analysis of one repository cannot establish compliance with any external standard. Every rendered artifact that carries this statement opens with the same disclaimer, `evidenceDisclaimer()` in `generated-banner.ts` (`test/build/generated-banner.test.ts` holds its text):

> Machine-generated engineering artifact assembled from statically-provable
> code facts and author-declared documentation. It can support a security,
> privacy, or compliance review. It does not itself establish compliance
> with any standard.

## Declared vs. proven

Every fact in a generated artifact is one of three kinds. The data-flow sub-models add five finer statuses on top ([ADR 0071](decisions/0071-epistemic-status-on-every-flow-fact.md)). A renderer never blends the kinds or presents one as the other.

| Kind         | Examples                                                                                                                                                                                                               | What is checked                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Declared** | What the author wrote in `documentData()`: `owner`, `category`, `sensitivity`, `protections`, `retention`, `purpose`, `legalBasis`, `dataResidency`, `auditRequired`, `credentials`, `source`, `endpoints`, `metadata` | Presence only. Correctness, adequacy and enforcement are never claimed.                                                                                   |
| **Proven**   | An operation's literal `writes` shape; a dependency edge from a consuming file to a capability, field or operation                                                                                                     | Derived from the AST of the code in this repository at analysis time.                                                                                     |
| **Cited**    | `evidence.fields[key].dynamicAccess` ([ADR 0053](decisions/0053-developer-declared-dynamic-access-citations.md))                                                                                                       | Declared, then re-checked each run against a stored content hash. A pass means the cited file exists and is unchanged, not that the access happens there. |

`test/build/negative-guarantees.test.ts` checks that finding messages never call a declared fact sufficient, verified or valid. The rendered Markdown reports are not scanned for those words; review new report wording by hand.

## Built in this release

| Artifact                                                 | Generator               | What it answers                                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manifest** (`location` option)                         | `generateManifest`      | A deterministic `.ts` file re-exporting every active capability, diffed against the last run for a "changes since last report" section.                                                     |
| **Documentation catalog** (`docs` option)                | `generateDocumentation` | Per capability: fields and operations, with `description`, the declared `source`, `credentials` and `endpoints`, and `sensitivity`, `protections` and `retention` labelled as documented.   |
| **Dependency and ownership report** (`ownership` option) | `generateUsage`         | The owner-to-capability matrix, and the consumer graph proven from the AST. `ABANDONED_CAPABILITY` and `UNCONSUMED_FIELD` are warnings; unresolved and indeterminate consumers stay `info`. |
| **Data-flow diagrams** (`flow` option, `.mmd`)           | `generateFlow`          | Mermaid diagrams in OWASP data-flow vocabulary: external entities, data stores, processes inside a trust boundary, and edges styled declared (dashed) or proven (solid).                    |
| **Data-flow review** (`flow` option, `overview.md`)      | `generateFlow`          | Findings grouped by severity, led by `SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY`: a sensitive field touched by a declared external endpoint.                                                 |
| **Evidence Model** (`--evidence`)                        | `computeDataArtifacts`  | The composed `EvidenceModel` as JSON. It carries no `provenance` unless the caller supplies one, so `--check` can compare runs byte for byte.                                               |
| **JSON report** (`--json`)                               | the CLI                 | Every finding, every generator's output and the Evidence Model in one versioned envelope, validated against `data-cap/schema`.                                                              |
| **Drift check** (`--check`)                              | `checkArtifacts`        | Recomputes every requested artifact and compares it with disk. Writes nothing; exits 1 if anything is stale or missing, whatever the finding severities.                                    |

## Canonical fact models

Seven versioned, JSON-serializable models, plus the four flow sub-models (flow, policy, observation, claims) that extend the Evidence Model. Many named reports can be projected from them without `data-cap` maintaining each one ([ADR 0050](decisions/0050-fact-model-architecture.md)).

| Model                  | Builder                     | Schema                                   | What it answers                                                                             |
| ---------------------- | --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Capability Model       | `buildInventory`            | `data-cap/schema/capability-model`       | Every discovered capability's fields and operations, active or not.                         |
| Dependency Model       | `buildDependencyModel`      | `data-cap/schema/dependency-model`       | Every proven consumer relationship, by capability and by consuming file, with line numbers. |
| Ownership Model        | `buildOwnershipModel`       | `data-cap/schema/ownership-model`        | The owner-to-capability and owner-to-field matrix.                                          |
| Finding Model          | `buildFindingModel`         | `data-cap/schema/finding-model`          | Every finding, each with a structured `location`.                                           |
| Change Model           | `buildChangeModel`          | `data-cap/schema/change-model`           | The manifest diff, with an optional index of which files consume each changed capability.   |
| Runtime Contract Model | `buildRuntimeContractModel` | `data-cap/schema/runtime-contract-model` | The package's own documented execution rules, each traced to its ADR.                       |
| Evidence Model         | `buildEvidenceModel`        | `data-cap/schema/evidence-model`         | The other six composed into one artifact, which every projection reads.                     |

The reference projections are ordinary consumers of these public types: `projectGetters`, `projectMutators`, `projectSubscriptions`, `projectFields`, `renderDependencyGraphDot`, `renderOwnershipGraphDot`, `buildSarifLog`, `buildOpenApiSchemaArtifact`, and the `project*Evidence` family built with `defineEvidenceProjection()`. None has a private path a downstream tool could not use.

## Data-flow evidence projections (Experimental)

The flow evidence is part of the same Evidence Model ([ADR 0070](decisions/0070-flow-evidence-is-part-of-the-single-evidence-model.md)). Each export below is a pure function of it, exported from `data-cap/evidence`. `internal-package-contract generate` writes the table from `docs/surface.json`. Each row names the test that checks the format, and generation fails if that test is gone.

A valid document is well formed; it does not mean the facts in it are complete. DOT, Mermaid, the Markdown view and CycloneDX state the coverage and the unknowns. PROV marks each claim's `dc:traceComplete`. OSCAL and OTLP carry only each result's status. Each of these projections carries the disclaimer; the SARIF log, which holds findings rather than flows, does not (`test/evidence/flow-disclaimer.test.ts`). The rows whose test lives under `examples/` run in CI's `examples` job, which does not block a merge.

<!-- ipc:begin standards -->

| Document                                         | Standard                            | Produced by                                         | Checked against                                                                                 | Test                                            | Limits                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Findings, with code flows for a policy violation | OASIS SARIF 2.1.0                   | `buildSarifLog` (`data-cap/build`)                  | The official OASIS schema (a managed copy in `test/fixtures/standards/`)                        | `test/build/sarif-flow.test.ts`                 | A violation's `codeFlow` is the path the static scan found; the scan is syntactic and does not follow every construct (see the Guide's data-flow limits).                                                                                                                                      |
| Assessment results                               | NIST OSCAL 1.1.2 assessment-results | `buildOscalAssessmentResults` (`data-cap/evidence`) | NIST's official schema (a managed copy)                                                         | `test/evidence/flow-oscal.test.ts`              | Control ids come from you and are targeted at their assessment objective (`ac-4_obj`). Pass `assessmentPlan`; the default is a placeholder. Evidence references are text unless `evidenceHref` names the evidence file, which turns each into a back-matter resource the observations link to. |
| Data-flow bill of materials                      | CycloneDX 1.6                       | `buildCycloneDxBom` (`data-cap/evidence`)           | The official CycloneDX 1.6 schema, with the SPDX and JSF schemas it references (managed copies) | `test/evidence/flow-cyclonedx.test.ts`          | Incomplete coverage is stated in properties and annotations, not in `compositions`.                                                                                                                                                                                                            |
| Lineage                                          | W3C PROV-JSON                       | `buildProvDocument` (`data-cap/evidence`)           | Referential closure: every relation names a record that exists                                  | `test/evidence/flow-prov.test.ts`               | Not validated against a schema.                                                                                                                                                                                                                                                                |
| Observation spans                                | OpenTelemetry OTLP/JSON             | `observationsToOtlp` (`data-cap/evidence`)          | Structure, one span per observation, and that no span carries a value                           | `examples/flow-explorer/test/standards.test.ts` | Spans carry `data_cap.*` attributes; not validated against the OTLP protobuf schema.                                                                                                                                                                                                           |
| Data-flow diagram                                | Graphviz DOT                        | `renderFlowDot` (`data-cap/evidence`)               | Graphviz itself lays it out (`@viz-js/viz`)                                                     | `examples/flow-explorer/test/standards.test.ts` | Status is in text as well as colour.                                                                                                                                                                                                                                                           |
| Data-flow diagram                                | Mermaid flowchart                   | `renderFlowMermaid` (`data-cap/evidence`)           | The Mermaid parser parses it                                                                    | `examples/flow-explorer/test/standards.test.ts` | Status is in text as well as colour.                                                                                                                                                                                                                                                           |

<!-- ipc:end standards -->

None of these signs the evidence or binds it to a commit. The caller supplies `provenance` (commit, time, tool version). To give a reviewer something tamper-evident, attest the evidence file, for example with GitHub's `actions/attest`, and hand over the attestation with it.

## Deliberately not built

Each needs metadata this release does not model, or would imply an analysis `data-cap` does not perform ([ADR 0049](decisions/0049-capability-metadata-vocabulary.md)).

| Artifact                                    | Why not                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threat-model inputs                         | They need threat rules (attacker capability, mitigations, likelihood). Labelling an inventory "threat model" would imply analysis that was not done.                                                          |
| Purpose-of-processing data map              | `purpose`, `legalBasis` and `dataResidency` are modelled ([ADR 0051](decisions/0051-documentdata-metadata-and-governance-fields.md)), but no renderer ships. Project them from the Capability Model yourself. |
| OSCAL component definition or SSP data flow | A different OSCAL model from the assessment results above, and a separate schema commitment.                                                                                                                  |
| Payment-card or SOC 2 evidence packs        | No real deployment has asked for one. Record the regime in `metadata`, for example `metadata: { regulatory: "PCI-DSS" }`; `data-cap` never validates it.                                                      |
| Records of processing activities            | Not a first-party report. `examples/enterprise-platform/scripts/ropa/` builds one from the declared fields, and its README says which entries are declared, approximate or caller-supplied.                   |
| Lineage through external systems            | Out of scope: a static scan of one repository cannot see what another system does with data. `endpoints` documents the boundary, not what lies past it.                                                       |
| Validator contract report                   | There is no per-field validator vocabulary by design ([ADR 0039](decisions/0039-helpers-subpath-scope.md)).                                                                                                   |
| Per-operation cacheability report           | Cache wiring lives inside an operation's opaque `execute` body. The Runtime Contract Model describes how the cache module behaves.                                                                            |
| Executive data-architecture grade           | A headline grade is an opinion `data-cap` has no basis to assert for you ([ADR 0050](decisions/0050-fact-model-architecture.md)).                                                                             |

## Regulatory classification

`data-cap` ships no GDPR, HIPAA or PCI taxonomy. Those mean different things in different deployments, and a tool reading one repository cannot know which regime applies. Record it yourself in the open `CapabilityDocs.metadata` or `FieldDocs` bag, for example `metadata: { regulatory: "GDPR,PCI-DSS" }`. `data-cap` never validates its contents.
