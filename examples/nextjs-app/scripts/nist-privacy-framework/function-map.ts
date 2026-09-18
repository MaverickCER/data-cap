/**
 * The five core Functions of the NIST Privacy Framework (Version 1.0,
 * January 16 2020, NIST CSWP 01162020), and the Categories within each --
 * extracted directly from NIST's own published PDF
 * (https://doi.org/10.6028/NIST.CSWP.01162020, Table 2: "Privacy Framework
 * Core"). Unlike ISO/IEC/IEEE 12207 (see repo-contract's own
 * scripts/iso-12207-alignment/process-map.ts), this is a US federal
 * government work: under 17 U.S.C. Sec. 105, works of the US Government are
 * not subject to domestic copyright protection, so this file's Function and
 * Category names -- short, official identifiers, not the framework's own
 * explanatory prose -- are reproduced directly from the primary source, not
 * paraphrased from a secondary summary.
 *
 * This document's own generated output still stays on the "structure, not
 * a compliance claim" side of the same line repo-contract's ISO documents
 * do: citing which Function/Category a piece of evidence relates to is not
 * a claim of conformance with the Framework, and this generator's own
 * output document says so explicitly.
 */
export interface FunctionCategory {
  readonly id: string
  readonly name: string
}
export interface PrivacyFunction {
  readonly id: string
  readonly name: string
  readonly purpose: string
  readonly categories: readonly FunctionCategory[]
}

export const PRIVACY_FUNCTIONS: readonly PrivacyFunction[] = [
  {
    id: "IDENTIFY-P",
    name: "Identify-P",
    purpose:
      "Develop the organizational understanding to manage privacy risk for individuals arising from data processing.",
    categories: [
      { id: "ID.IM-P", name: "Inventory and Mapping" },
      { id: "ID.BE-P", name: "Business Environment" },
      { id: "ID.RA-P", name: "Risk Assessment" },
      { id: "ID.DE-P", name: "Data Processing Ecosystem Risk Management" },
    ],
  },
  {
    id: "GOVERN-P",
    name: "Govern-P",
    purpose:
      "Develop and implement the organizational governance structure to enable an ongoing understanding of the organization's risk management priorities that are informed by privacy risk.",
    categories: [
      { id: "GV.PO-P", name: "Governance Policies, Processes, and Procedures" },
      { id: "GV.RM-P", name: "Risk Management Strategy" },
      { id: "GV.AT-P", name: "Awareness and Training" },
      { id: "GV.MT-P", name: "Monitoring and Review" },
    ],
  },
  {
    id: "CONTROL-P",
    name: "Control-P",
    purpose:
      "Develop and implement appropriate activities to enable organizations or individuals to manage data with sufficient granularity to manage privacy risks.",
    categories: [
      { id: "CT.PO-P", name: "Data Processing Policies, Processes, and Procedures" },
      { id: "CT.DM-P", name: "Data Processing Management" },
      { id: "CT.DP-P", name: "Disassociated Processing" },
    ],
  },
  {
    id: "COMMUNICATE-P",
    name: "Communicate-P",
    purpose:
      "Develop and implement appropriate activities to enable organizations and individuals to have a reliable understanding and engage in a dialogue about how data are processed and associated privacy risks.",
    categories: [
      { id: "CM.PO-P", name: "Communication Policies, Processes, and Procedures" },
      { id: "CM.AW-P", name: "Data Processing Awareness" },
    ],
  },
  {
    id: "PROTECT-P",
    name: "Protect-P",
    purpose: "Develop and implement appropriate data processing safeguards.",
    categories: [
      { id: "PR.PO-P", name: "Data Protection Policies, Processes, and Procedures" },
      { id: "PR.AC-P", name: "Identity Management, Authentication, and Access Control" },
      { id: "PR.DS-P", name: "Data Security" },
      { id: "PR.MA-P", name: "Maintenance" },
      { id: "PR.PT-P", name: "Protective Technology" },
    ],
  },
]
