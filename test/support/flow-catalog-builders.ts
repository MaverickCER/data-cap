import { fn, module, userField } from "./flow-catalog.js"

/**
 * The catalog of syntactic forms behind `test/flow/never-silently-safe.test.ts`. Every form builds a tiny project
 * whose code leaks exactly one field of `userData.user` (`f`) to a sink, using that form, and says which class the
 * evidence must end up in today: `A` (the leak is followed to the sink), `B` (the trace is reported incomplete), or `W`
 * (the form sends the whole record, so both fields reach the sink).
 * Improving the scanner's reach flips a row from `B` to `A` deliberately -- never the other way, never to `C`.
 */
export interface Form {
  readonly id: string
  readonly group: string
  readonly expect: "A" | "B" | "W"
  /** Builds the project for the leaked field `f`. */
  readonly files: (f: string) => Record<string, string>
}

export const form = (
  group: string,
  id: string,
  expect: "A" | "B" | "W",
  files: (f: string) => Record<string, string>,
): Form => ({ group, id, expect, files })

/** A form made of one handler body that sends to `res.json`. */
export const body = (
  group: string,
  id: string,
  expect: "A" | "B" | "W",
  make: (f: string, u: string) => string,
  extra: (f: string, u: string) => string = () => "",
  keyword = "",
): Form =>
  form(group, id, expect, (f) => fn(make(f, userField(f)), extra(f, userField(f)), keyword))

/** A form made of module-level code that sends to `console.log` from a function `h`. */
export const mod = (
  group: string,
  id: string,
  expect: "A" | "B" | "W",
  make: (f: string, u: string) => string,
  imports = "",
): Form => form(group, id, expect, (f) => module(make(f, userField(f)), imports))

/** Extra files next to `app/p.ts`. */
export const multi = (
  group: string,
  id: string,
  expect: "A" | "B" | "W",
  make: (f: string, u: string) => Record<string, string>,
): Form => form(group, id, expect, (f) => make(f, userField(f)))
