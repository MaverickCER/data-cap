# Vendored standards schemas

Used only by tests, to prove that what the adapters emit is valid against the standard itself rather than against
a subset written by us. Not shipped (outside `files` in `package.json`).

| File                                         | Standard                                                          | Source                                                                                           | Retrieved  |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| `sarif-schema-2.1.0.json`                    | OASIS SARIF 2.1.0 (JSON Schema draft-04)                          | https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json       | 2026-10-25 |
| `oscal_assessment-results_schema-1.1.2.json` | NIST OSCAL 1.1.2, assessment-results model (JSON Schema draft-07) | https://github.com/usnistgov/OSCAL/releases/download/v1.1.2/oscal_assessment-results_schema.json | 2026-10-25 |

The files are byte-for-byte as published. OASIS publishes the SARIF schema under its OASIS Open licensing; NIST
publishes OSCAL as a U.S. Government work, not subject to copyright in the United States.
