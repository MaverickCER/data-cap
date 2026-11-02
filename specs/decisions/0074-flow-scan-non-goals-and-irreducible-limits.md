# 0074: What the flow scan does not follow: deliberate non-goals, irreducible limits, and the one way past a package

## Status

Accepted. Extends ADR 0070 and ADR 0071. Implemented in `src/build/flow-scan.ts`, `src/build/flow-values.ts` and `src/build/flow-heap.ts`; the
limits are pinned by `test/build/flow-reach-limits.test.ts`, the summaries by `test/build/flow-reach-summaries.test.ts`
and `test/build/flow-summaries-options.test.ts`, and the guarantee itself by `test/flow/never-silently-safe.test.ts`.

## Context

ADR 0070 and ADR 0071 set the rule the flow scan lives by: it never looks complete when it is not. What it follows it
follows; what it cannot follow it reports as an explicit `unknown` that names the data that entered it, and a trace
through an unknown is "not complete". The reach of the scan has since grown a long way (classes and `this`, default
exports and barrels, dynamic `import()`, generators, `Map` / `Set` / `Promise` / `Reflect`, `bind`, prototypes,
CommonJS, decorators, classes made per evaluation), and each step turned a row of the never-silently-safe catalog from
"honest unknown" into "followed".

What is left falls into three kinds, and they need three different answers. Some things are left out on purpose,
because following them would answer a different question than the one the scan exists to answer. Some cannot be
followed by reading source at all, because the answer is only known when the program runs. And one thing, the code in
`node_modules`, is out of reach by design (ADR 0002: the scanner never loads or evaluates what it reads), yet is where
most real data leaves an application. Treating them alike either hides a real gap behind a principled-sounding reason
or turns a decision into an accident. This ADR states each, says why, says how a project overrides it, and says how
the guarantee that none of it is silent is tested.

## Decision

### 1. Deliberate non-goals: this is a data-flow analysis, not an information-flow analysis

The scan follows data: a value, or a part of one, that is copied, passed, returned, stored, read back, spread,
destructured or transformed. It does not follow what can be _inferred_ from data.

- **Implicit flows.** Branching on tracked data (`if`, `else`, `switch`, a ternary condition, a loop bound, a `try` that
  depends on it) moves none of it. `if (user.email) res.json("yes")` sends the word "yes", not the email.
- **Values derived by inspection.** A comparison (`===`, `!==`, `==`, `<`, `>=`, ...), `!`, `typeof`, `instanceof`, `in`,
  `delete` and `void` produce a value that carries no tracked data. `res.json(user.email === "a@b.c")` sends a boolean.
  (`a && b` and `a || b` are different: their result _is_ one of the operands, so it carries them.)
- **Names.** The keys of a tracked object are field names: they come from the schema, which is public in the report.
  `Object.keys`, `Object.getOwnPropertyNames`, `Reflect.ownKeys`, `Object.hasOwn`, `Reflect.has`, `hasOwnProperty` and the
  loop variable of `for...in` answer with names, and carry no data. Reading a field _by_ those names (`obj[key]`) is a
  computed key on tracked data, which is reported as `dynamic-access` (over-approximating every property as
  `inferred`), as ever.

Why: an information-flow analysis would call nearly every function that touches a sensitive field a leak of it
(any `if` on a password hash "leaks" one bit), and a report that says everything leaks says nothing. The question the
evidence answers (which field reaches which boundary, and what policy that violates) is a data-flow question.

Override: none is needed, and none is offered. A project that must reason about decisions taken from sensitive data
states it as a policy on the function, or observes it at run time (ADR 0072). Each construct above has a test that pins
"no flow", so the decision is visible in the suite and cannot drift into an accident.

### 2. Irreducible without running the program: always an explicit unknown when tracked data reaches them

`eval(...)`, `new Function(string)` and `Function(string)`, `new Proxy(...)` (a handler can answer any property
read with anything), `with (object) { ... }` (every name inside may be a property of `object`), `setTimeout(string)`,
and `import(expression)` / `require(expression)` whose specifier is not a string literal. What they do depends on a
string or a handler that exists only at run time.

The guarantee is the one of ADR 0071, stated for these: whenever tracked data reaches one of them, the result is an
`unknown` (`unresolved-call`, `unsupported-construct`, `unresolved-import` or `unanalyzed-function`) that records the
data, and the trace of that data is not complete. When no tracked data is in reach the scan says nothing: it does not
claim to have analyzed code that it did not, and it does not invent a gap where there is none. A computed specifier is
only an unknown if tracked data decides it; a literal specifier of a project file is followed, and one of a package is
treated like any other package call (section 3).

Override: restructure the code so the specifier or the string is a literal, or record what really happened with
`data-cap/observe` and let the observation corroborate or contradict the incomplete static trace.

### 3. Calls into packages: an explicit unknown, unless the project declares what the call does

The scan reads project source only. A call into a package that receives tracked data is an `unresolved-call` unknown
(the data is assumed to come out approximately, as `inferred`). The only sound way past `node_modules` is for the
project to say what a function does, and this is an option, `summaries` (`flowSummaries` through
`generateDataArtifacts` / `computeDataArtifacts`):

```ts
type FlowSummary = { module: string; export: string } & (
  | { effect: "pass-through"; approximate?: true } //   the result holds everything the arguments hold
  | { effect: "returns-arg"; arg: number; approximate?: true } //   the result holds what argument `arg` holds
  | { effect: "sink"; boundary: { kind; name }; handling?: FlowHandling } //   the arguments leave through a boundary
  | { effect: "sanitizes" } //   the result holds none of it
  | { effect: "ignores" } //   the call neither carries data nor sends it anywhere
)
```

- **Matching.** `module` is the specifier as written; `export` is the imported name, `default`, or a dotted path to a
  member (`z.object`, `default.get`). A member of a default import also matches the bare name (`_.pick` matches `pick`),
  for packages whose default export is the object of their named exports. Named imports (renamed or not), namespace
  imports, default imports, `require`, destructured `require` and `import x = require()` are all matched. A function the
  project defines is never replaced by a summary. The first matching summary wins, so their order is part of the input.
- **Status.** Everything a summary lets the scan follow is `declared` (ADR 0071: asserted by an author, not checked
  against code), never `static`. The atoms that came out of a summarized call stay marked, so every later hop of that
  data is `declared` too, and a `sink` creates a `declared` boundary. The field read that fed the call stays `static`.
  No new edge kind is added; the status already existed.
- **A summarized call is a read.** What it is handed counts as read by the caller, so the field is not reported as
  discarded.
- **No built-in table.** The package ships no summaries. A summary is a statement about code the scan has not read, and a
  wrong one makes the evidence wrong in the dangerous direction; a table is only worth shipping where each entry's
  semantics can be stated exactly for every version, and none can be promised for code we do not control. A project
  declares the handful it uses (for example `lodash.cloneDeep` as `pass-through`, `lodash.pick` as `returns-arg 0`
  `approximate`).
- **Scope.** A summary describes a function of a module. It does not describe an object a package function returns:
  `createClient().send(user)` stays an unknown unless the client is made visible to the scan some other way.
- **The evidence cache.** The summaries are part of the evidence options key (`evidenceOptionsKey`, in their declared
  order), so changing one makes a previously written evidence file stale.

### 4. What the scan models instead of reporting (so the unknowns that remain are the ones that matter)

Builtins whose semantics are fixed by the language are modelled, not approximated: `Map`, `WeakMap`, `Set`, `WeakSet`
(construction, `get` / `set` / `add` / `forEach` / `values` / `keys` / `entries` / iteration, the ES2025 set methods),
`Map.groupBy` and `Object.groupBy`, `new Promise(executor)` with `resolve` and `reject` that settle that promise from
wherever they are called (including a later callback), `Promise.all` / `allSettled` / `race` / `any`, `Reflect.*`,
`Array.prototype.m.call(...)`, `JSON.parse(JSON.stringify(x))` and `structuredClone`, `fn.bind(thisArg, ...args)`,
constant-string keys (`o[k]` with `const k = "m"`), `yield` receiving what `next(x)` sends, constructor functions with a
`prototype` and `Object.create` / `Object.setPrototypeOf` / `__proto__`, `Class.prototype.m = ...` mixins, CommonJS
(`require`, `module.exports`, `exports`), decorators (a project decorator is called with the member, and what it returns
replaces the member; a package decorator makes the member an unknown when it is later called), and classes made per
evaluation (a class written in a function captures the variables of that call, as a closure does).

Their approximations are stated, not hidden:

- A `Map` built from `[key, value]` literals or through `set` keeps keys and values apart; one copied from any other
  iterable cannot tell them apart. A read of `m.get(k)` does not look at `k`: it gives every value.
- `Object.groupBy` gives an object whose keys the callback chooses, so any key reads every group.
- A promise is settled by every `resolve` / `reject` call the scan finds for it, in any order and from any function; a
  value awaited before it was settled is picked up by another round of the analysis.
- Every value sent in with `next(x)` is given to every `yield` of that generator evaluation, and the first `next(x)` is
  not told apart from the others.
- A decorator that rewrites a method descriptor in place (`desc.value = wrapper`) leaves the method ambiguous between
  the original and the wrapper, so the member is an unknown; a decorator that returns a function or a new descriptor is
  followed.
- An instance made by a constructor function takes a copy of what the `prototype` holds when it is made.

Two mechanisms keep the modelled values from hiding data, because the data of a promise, a closure or a class is not
in the value itself:

- **Values that carry data without holding it.** A promise made by `new Promise` holds what `resolve` and `reject` were
  given in a slot the scan fills as it meets those calls; a closure holds the variables of the call that made it; a
  class made in a function holds the same. When such a value is handed to code the scan cannot read, what it carries
  goes with it and is an unknown like any other argument. When nothing calls a closure, or a method of a class, that a
  call made, it is run on its own with the variables of that call (the last round's), so what it sends counts and what
  it returns is an unknown that names the data.
- **An analysis that does not settle is reported.** Data written into module state by one function and read by another
  analyzed earlier needs another round of the analysis; the number of rounds is capped. A project still moving data
  between functions at the cap gets one `unanalyzed-function` unknown that names no data, so every trace is incomplete
  (ADR 0071: an unknown that does not say which data it concerns concerns everything).

### 5. Aliasing through a heap: closed, with stated limits

An earlier version of this ADR listed aliasing as the largest way a leak could go unreported: the scan had no heap
model, so a store through one name into an object another name holds was only followed where the sharing was
syntactic. It is now closed, without becoming a points-to analysis (a `Val` is still a value, not a reference).

- **Allocation sites.** An object a literal, an array literal, `new` (a class, a constructor function, `Map`, `Set`) or
  `Object.create` makes carries the id of its allocation site (`Val.alloc`, an `a<n>` id for the site in the evaluation
  of the function that made it). Values merged by `||`, `?:`, a call result or a copy keep the ids of everything they
  may be; a spread, a rest and `Object.assign` make a new object (the new literal's own site), whose nested objects
  keep theirs. `accessDynamic` (a computed key, `Object.values`, `for...of` over a collection) carries every site
  below the value it reads.
- **Shared cells.** A container mutation (`push`, `unshift`, `splice`, `fill`, `Map.set`, `Set.add`, a property store,
  `Reflect.set`, the target of `Object.assign`) writes what it stores into the shared cell of every site the receiver
  may be, in `src/build/flow-heap.ts`. Reading any value (`expr`) adds the cell of every site it carries, at any depth.
  So `{ list: a.list }`, an array element, a function's result, a shallow copy, a prototype shared by instances, a
  closure's captured container and a collection's value all see the store, whatever route made the alias.
- **Order.** A cell keeps, per evaluation of a function, what that evaluation stored in the current round apart from
  earlier rounds. An evaluation that is still running does not read its own earlier-round stores back, so a store never
  shows up before the line that made it (`res.json(o); o.list.push(x)` sends nothing). Every other evaluation sees all
  of them. A store into an object whose maker is no longer running asks for another round (the existing cap and its
  `unanalyzed-function` unknown apply), so a reader analyzed before the writer sees the store.
- **Objects the scan did not see made.** A package's export and the result of a call it could not follow carry the
  site `?`. Tracked data stored into such an object is an explicit `unsupported-construct` unknown
  (`tracked data stored into an object whose origin the analysis cannot see`), because the package, not this project,
  decides who else holds it. A parameter of a function analyzed on its own is covered by the existing deferred unknown.
- **What did not change on purpose.** The earlier "may be shared" reports (`property stored into an object another name
may share`, a store through a call result, a loop element) are still emitted: a store the cells now follow is also
  reported, so the pinned `B` rows stay `B` and no trace became more complete than before. Dropping them is a separate
  decision.

The guarantee is tested by the `heap aliasing` group of the catalog (rows are `A` or `B`, never `C`),
`test/build/flow-reach-aliasing.test.ts` and `test/build/flow-heap.test.ts`.

Limits that remain, stated rather than hidden:

- **Context-insensitivity inside one evaluation.** Two objects made at the same site by the same evaluation (a loop
  that allocates, a helper called twice with the same arguments) share one cell: a store into one is seen through the
  other. This over-approximates (an extra flow), it does not miss one.
- **Identity is by site, not by value.** Two distinct arguments with the same shape made at different sites are
  different objects; the same function called with them is analysed twice. The cost is bounded by the step budget
  and the call-depth cap, as every other analysis cost.
- **Order is per round.** A store by a function that is not running is visible to every reader of the next round, even
  one that in the real program ran first; loops are still analysed once.
- **Packages hold their own heap.** An object a package returns is `?`; the scan cannot say who else holds it, and
  says so (above) instead of following it.
- **Typed arrays, `Proxy`, getters and `Object.defineProperty` accessors** keep the behaviour of sections 2 and 4.

## Consequences

- A reader of an evidence file can tell, for any gap, which of three things it is: a decision (nothing is wrong), an
  unknown the program's nature forces (look at it at run time), or a package boundary (declare what the call does).
- A project gets complete traces through the packages it depends on by writing the summaries it trusts, and the
  evidence says in every such edge that the model is the project's word.
- Aliasing no longer needs a points-to analysis: allocation-site identity plus shared cells (section 5) closes the
  hole at the cost of stated over-approximations, never of silence.
- The never-silently-safe catalog (`test/support/flow-catalog-*.ts`) is the measure. Each row leaks one field of a
  record through one syntactic form and pins what the evidence must end in: (A) the leak is followed to the sink, with the
  sibling field clean; (B) the trace is reported incomplete through an unknown that concerns the leaked field; (W) the
  whole record really is sent. The test fails on the third outcome, a complete trace that misses the leak, and each row is
  also run with the leaked field swapped for its sibling, so no field name is special. Reach improves by a row moving from
  B to A on purpose, never the other way. Forms that carry no data on purpose (section 1) are pinned in
  `flow-reach-limits.test.ts`, because "no flow, and complete" is exactly the outcome the catalog forbids for a leak.
- Adding a modelled builtin means an exact semantic, a row or more in the catalog, and a line in section 4 for what it
  approximates.
