/**
 * `data-cap/eslint-plugin`: lint rules that keep capability code readable by the build pass:
 * `stable-operation-reference`, `no-raw-external-io`, `no-fields-escape` and `no-node-fs`.
 *
 * @packageDocumentation
 */

import { noFieldsEscape } from "./no-fields-escape.js"
import { noNodeFs } from "./no-node-fs.js"
import { noRawExternalIo } from "./no-raw-external-io.js"
import { stableOperationReference } from "./stable-operation-reference.js"

/**
 * `data-cap/eslint-plugin`: a flat-config-shaped plugin object
 * ({ rules: { ... } }), consumed as:
 *
 *   import dataCapPlugin from "data-cap/eslint-plugin";
 *   export default [{ plugins: { "data-cap": dataCapPlugin }, rules: { "data-cap/stable-operation-reference": "warn" } }];
 */
const plugin = {
  /** Every rule this plugin ships, keyed by its flat-config rule name. */
  rules: {
    /** See {@link noFieldsEscape}. */
    "no-fields-escape": noFieldsEscape,
    /** See {@link noNodeFs}. */
    "no-node-fs": noNodeFs,
    /** See {@link noRawExternalIo}. */
    "no-raw-external-io": noRawExternalIo,
    /** See {@link stableOperationReference}. */
    "stable-operation-reference": stableOperationReference,
  },
}
export default plugin
export { noFieldsEscape, noNodeFs, noRawExternalIo, stableOperationReference }
