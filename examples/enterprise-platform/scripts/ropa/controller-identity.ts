// The Art. 30(1)(a) fact `run.ts` passes to `buildRopaModel()` -- see this
// directory's README: data-cap has no schema concept for an organization's
// own identity, so the simplest honest surface for it is a small,
// project-owned config file like this one, not a new data-cap feature.
//
// *** PLACEHOLDER VALUES -- REPLACE BEFORE PUBLISHING docs/ROPA.md EXTERNALLY ***
// Everything below is this fictional example platform's own made-up
// identity, for demonstration purposes only. An adopting organization must
// replace every field here with its own real controller name and contact
// details -- data-cap cannot supply or verify this information, and
// `render.ts` has no way to tell a real value from a placeholder one.
import type { ControllerIdentity } from "./types.js"

export const CONTROLLER_IDENTITY: ControllerIdentity = {
  name: "Atlas Platform, Inc. (example placeholder)",
  contact: "privacy@example.com (example placeholder)",
  // `representative`/`dpoContact` are left unset here on purpose, to also
  // demonstrate `render.ts`'s own "omitted, not a gap" handling for the two
  // conditionally-required ControllerIdentity fields (see types.ts).
}
