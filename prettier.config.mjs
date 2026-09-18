// Extends internal-package-contract's org-wide baseline. The values are
// currently identical to what this package's own .prettierrc.json declared
// (confirmed byte-for-byte before this migration) -- this just makes that a
// single source of truth instead of a coincidence two files agree on.
import baseline from "internal-package-contract/prettier"

export default { ...baseline }
