import { noNodeFs } from "./no-node-fs.js"
import { noRawExternalIo } from "./no-raw-external-io.js"
import { stableOperationReference } from "./stable-operation-reference.js"

/**
 * `@maverickcer/data-cap/eslint-plugin` -- a flat-config-shaped plugin object
 * ({ rules: { ... } }), consumed as:
 *
 *   import dataCapPlugin from "@maverickcer/data-cap/eslint-plugin";
 *   export default [{ plugins: { "data-cap": dataCapPlugin }, rules: { "data-cap/stable-operation-reference": "warn" } }];
 *
 * A 6th public entry point alongside `.`, `./runtime`, `./build`,
 * `./helpers`, and `./evidence`.
 */
const plugin = {
  /** Every rule this plugin ships, keyed by its flat-config rule name. */
  rules: {
    /** See {@link noNodeFs}. */
    "no-node-fs": noNodeFs,
    /** See {@link noRawExternalIo}. */
    "no-raw-external-io": noRawExternalIo,
    /** See {@link stableOperationReference}. */
    "stable-operation-reference": stableOperationReference,
  },
}
export default plugin
export { noNodeFs, noRawExternalIo, stableOperationReference }
