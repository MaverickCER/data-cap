import { RuleTester } from "eslint"
import type { Rule } from "eslint"
import { describe, it } from "vitest"
import { noFieldsEscape } from "../../src/eslint-plugin/no-fields-escape.js"

// RuleTester's own `run()` registers cases via Mocha-style global
// `describe`/`it` by default -- vitest doesn't inject those as true globals,
// so without this, vitest reports "No test suite found in file". Mirrors
// `stable-operation-reference.test.ts`/`no-raw-external-io.test.ts` exactly.
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

// Built via `@typescript-eslint/utils`'s `RuleCreator`, whose generated type
// is structurally stricter than -- and not assignable to -- plain `eslint`'s
// own `Rule.RuleModule` that `RuleTester.run()` expects. Same narrow cast
// the sibling rule test files use, for the same reason.
ruleTester.run("no-fields-escape", noFieldsEscape as unknown as Rule.RuleModule, {
  valid: [
    // -- A named single-field read, however it's spelled, is never flagged. --
    { code: `const x = userData.fields.email;` },
    { code: `const x = userData.getSnapshot().fields.email;` },
    { code: `const el = <Child email={userData.fields.email} />;` },
    { code: `const { email } = userData.fields;` },
    { code: `const { email, phone } = userData.fields;` },
    { code: `doSomething(userData.fields.email);` },

    // -- A named OBJECT-LITERAL property value (not JSX, not a spread) is
    //    out of this rule's scope -- unlike a JSX prop, there's no
    //    "component" on the other end whose own type constrains what it
    //    reads, and it's the SAME "revisit if usage shows drift" bar
    //    ADR 0063/0064 apply throughout. Also proves the spread check is
    //    "is this a SpreadElement", not "is the grandparent an
    //    ObjectExpression" alone -- the grandparent here IS one. --
    { code: `const obj = { data: userData.fields };` },

    // -- Spreading something unrelated is never flagged -- matched by
    //    property/method name alone, never by resolving what the base
    //    expression actually is. --
    { code: `const obj = { ...someOtherThing };` },
    { code: `const el = <Child {...otherProps} />;` },
    { code: `const { ...rest } = someOtherThing;` },
    { code: `doSomething(someOtherThing);` },
    { code: `const el = <Child data={someOtherThing} />;` },

    // -- A DIFFERENT property/method name than "fields"/"getSnapshot" is
    //    never flagged, even immediately adjacent to a real capability. --
    { code: `const el = <Child {...userData.getSnapshot().info} />;` },
    { code: `const { ...rest } = userData.getSnapshot().info;` },
    { code: `doSomething(userData.getSnapshot().info);` },

    // -- A computed (bracket) "fields" access is a different AST shape
    //    entirely -- not matched, consistent with this rule's "structural,
    //    not resolved" scope. --
    { code: `const el = <Child {...userData["fields"]} />;` },

    // -- An array spread is never matched -- `.fields`/getSnapshot() never
    //    produce an iterable, so real code never does this; the rule
    //    deliberately doesn't special-case it as a false positive to avoid. --
    { code: `const arr = [...userData.fields.tasks];` },
    { code: `const arr = [...userData.fields];` },
    { code: `const arr = [...userData.getSnapshot()];` },

    // -- A private class field/method named "fields"/"getSnapshot" is a
    //    different AST shape (`PrivateIdentifier`, never `Identifier`) --
    //    not matched, since only a non-computed *ordinary* name is. --
    { code: `class Foo { #fields = {}; m() { return { ...this.#fields }; } }` },
    {
      code: `class Foo { #getSnapshot() { return {}; } m() { return { ...this.#getSnapshot() }; } }`,
    },

    // -- A bare call with no receiver at all (not a method call through a
    //    `.` at all) is never matched -- `getSnapshot` here is a plain
    //    function, not `x.getSnapshot()`. --
    { code: `const s = { ...getSnapshot() };` },

    // -- A computed method call (`x["getSnapshot"]()`) is a different AST
    //    shape entirely, same reasoning as the computed-`.fields` case
    //    above. --
    { code: `const s = { ...userData["getSnapshot"]() };` },

    // -- A different method name than "getSnapshot" is never matched. --
    { code: `const s = { ...userData.someOtherMethod() };` },

    // -- `.fields`/`getSnapshot()` used as the CALLEE of a call, or as an
    //    element-access index, is never an "argument" -- it's not one of
    //    the call's own `arguments`. --
    { code: `userData.fields.someMethod();` },
    { code: `const k = registry[userData.getSnapshot()];` },

    // -- A plain, NON-exported local alias -- no destructuring, no spread,
    //    no export -- is never flagged; this rule follows zero hops past
    //    the immediate expression (ADR 0060's own "one level" precedent),
    //    so `const f = x.fields; someExportedFn(f);` is a real escape this
    //    rule declines to follow, the same as the build-time scanner it
    //    mirrors. See this rule's own doc comment and ADR 0064 for why
    //    this stays out of scope even though *exported* reassignment
    //    (below) does not. --
    { code: `const alias = userData.fields;` },
    { code: `const snapshot = userData.getSnapshot();` },
    { code: `let alias; alias = userData.fields;` },

    // -- A non-exported local alias in a file that ALSO exports some other,
    //    unrelated name -- proves the by-name specifier match is actually
    //    name-specific, not "this file has an `export { ... }` statement
    //    somewhere at all". --
    { code: `const alias = userData.fields;\nconst other = 5;\nexport { other };` },

    // -- Returned from a function that is NOT exported -- the same "which
    //    field(s), exactly" ambiguity as an exported return, but nothing
    //    outside this module can ever reach it, so it's not a module-
    //    boundary crossing at all. --
    { code: `function getLocal() { return userData.fields; }` },
    { code: `const getLocal = () => userData.fields;` },
    { code: `const getLocal = () => { return userData.fields; };` },

    // -- An exported function's *nested* helper function is not itself
    //    exported, even though it's lexically inside an exported one. --
    {
      code: `export function outer() { function inner() { return userData.fields; } return inner(); }`,
    },

    // -- A raw expression sitting inside a JSX child position -- not an
    //    attribute at all, so it's not a "prop" by this rule's own
    //    definition. Distinguishes "wrapped in a JSXExpressionContainer"
    //    from "specifically a JSXAttribute's value": a container can also
    //    hold an element's children. --
    { code: `const el = <Child>{userData.fields}</Child>;` },

    // -- Re-exporting a name *from another module* is never a same-file
    //    escape of this module's own local binding, even when the two
    //    happen to share a spelling -- `export { leaked } from "./other"`
    //    names `./other`'s own `leaked`, not this file's local one. --
    {
      code: `const leaked = userData.fields;\nexport { leaked } from "./other";`,
    },

    // -- Destructuring a single, specific named field is fine even when the
    //    declaration itself is exported -- exactly one field is provably
    //    read by name, the same as any other named `.fields.<name>` read;
    //    only a *rest* element (covered separately, above) or a whole-value
    //    passthrough loses that granularity. --
    { code: `export const { email } = userData.fields;` },

    // -- An anonymous default-exported function -- `export default
    //    function() {}` is the one grammatical position allowing a
    //    `FunctionDeclaration` with no name at all. Default exports aren't
    //    yet a shape this rule recognizes as "exported" (see ADR 0064's
    //    alternatives-considered); this case exists to prove that gap fails
    //    closed (never flagged) rather than crashing on the missing name. --
    { code: `export default function() { return userData.fields; };` },

    // -- allow glob exempts the whole file. --
    {
      code: `const el = <Child {...userData.fields} />;`,
      filename: "/project/src/dev-tools/debug-panel.tsx",
      options: [{ allow: ["**/dev-tools/**"] }],
    },
  ],
  invalid: [
    // -- JSX spread attribute, the motivating case: a component receiving a
    //    capability's whole .fields as a spread prop, exactly the escape
    //    ADR 0060 documents the build-time scanner widening to
    //    `indeterminate` rather than proven safe. --
    {
      code: `const el = <Child {...userData.fields} />;`,
      errors: [{ messageId: "spread" }],
    },
    {
      code: `const el = <Child {...userData.getSnapshot().fields} />;`,
      errors: [{ messageId: "spread" }],
    },
    // -- A bare getSnapshot() spread is even wider (fields AND info at once). --
    {
      code: `const el = <Child {...userData.getSnapshot()} />;`,
      errors: [{ messageId: "spread" }],
    },

    // -- Object-literal spread, outside JSX entirely. --
    {
      code: `const props = { ...userData.fields };`,
      errors: [{ messageId: "spread" }],
    },
    {
      code: `const props = { ...userData.getSnapshot().fields };`,
      errors: [{ messageId: "spread" }],
    },

    // -- Rest-destructuring, on the reading side -- same "which fields,
    //    exactly" ambiguity as a spread. --
    {
      code: `const { ...rest } = userData.fields;`,
      errors: [{ messageId: "spread" }],
    },
    {
      code: `const { email, ...rest } = userData.fields;`,
      errors: [{ messageId: "spread" }],
    },
    {
      code: `const { ...rest } = userData.getSnapshot().fields;`,
      errors: [{ messageId: "spread" }],
    },

    // -- A bare function-call argument -- the callee could do anything
    //    with it, and data-cap's build-time scanner can't tell what. --
    {
      code: `doSomething(userData.fields);`,
      errors: [{ messageId: "argument" }],
    },
    {
      code: `doSomething(userData.getSnapshot());`,
      errors: [{ messageId: "argument" }],
    },
    {
      code: `new SomeSink(userData.fields);`,
      errors: [{ messageId: "argument" }],
    },
    {
      code: `doSomething(a, userData.fields, b);`,
      errors: [{ messageId: "argument" }],
    },

    // -- A bare, NAMED JSX prop -- narrower than a spread (the prop name
    //    at least says something is being passed), but data-cap's
    //    build-time scanner is exactly as blind to which field(s) flow
    //    through it, so ADR 0064 flags this shape too. --
    {
      code: `const el = <Child data={userData.fields} />;`,
      errors: [{ messageId: "prop" }],
    },
    {
      code: `const el = <Child data={userData.getSnapshot()} />;`,
      errors: [{ messageId: "prop" }],
    },

    // -- Exported directly -- the field crosses this module's own public
    //    boundary the moment the export exists. --
    {
      code: `export const leaked = userData.fields;`,
      errors: [{ messageId: "exported" }],
    },
    {
      code: `export const leaked = userData.getSnapshot();`,
      errors: [{ messageId: "exported" }],
    },

    // -- Exported later, by name, via a separate `export { name }` --
    //    still a real, provable module-boundary crossing. --
    {
      code: `const leaked = userData.fields;\nexport { leaked };`,
      errors: [{ messageId: "exported" }],
    },

    // -- Exported later via a `export { name }` specifier list containing
    //    OTHER names too -- only one of which matches -- distinguishing
    //    "at least one specifier names this binding" from "every specifier
    //    does". --
    {
      code: `const other = 5;\nconst leaked = userData.fields;\nexport { other, leaked };`,
      errors: [{ messageId: "exported" }],
    },

    // -- Returned from an exported function, four ways: a named
    //    `export function`, an arrow with an implicit-return body, an arrow
    //    with an explicit `return` in a block body, and an anonymous
    //    function *expression* assigned to an exported const (a distinct
    //    `FunctionLike` member from the other three). --
    {
      code: `export function getLeaked() { return userData.fields; }`,
      errors: [{ messageId: "exported" }],
    },
    {
      code: `export const getLeaked = () => userData.fields;`,
      errors: [{ messageId: "exported" }],
    },
    {
      code: `export const getLeaked = () => { return userData.fields; };`,
      errors: [{ messageId: "exported" }],
    },
    {
      code: `export const getLeaked = function() { return userData.fields; };`,
      errors: [{ messageId: "exported" }],
    },

    // -- A function only *later* re-exported by name is exported all the
    //    same. --
    {
      code: `function getLeaked() { return userData.fields; }\nexport { getLeaked };`,
      errors: [{ messageId: "exported" }],
    },

    // -- A file that doesn't match the allow glob still reports. --
    {
      code: `const props = { ...userData.fields };`,
      filename: "/project/src/features/dashboard.tsx",
      options: [{ allow: ["**/dev-tools/**"] }],
      errors: [{ messageId: "spread" }],
    },

    // -- The message names the exact offending expression, not a generic
    //    "escape detected". --
    {
      code: `const otherProps = { ...userData.fields };`,
      errors: [{ messageId: "spread", data: { expr: "userData.fields" } }],
    },
    {
      code: `sendToAnalytics(userData.fields);`,
      errors: [{ messageId: "argument", data: { expr: "userData.fields" } }],
    },

    // -- Multiple independent escapes in one file each report their own
    //    finding, with their own specific kind -- one never masks another. --
    {
      code: `
        const props = { ...userData.fields };
        const el = <Child {...billingData.fields} />;
        doSomething(identityData.fields);
      `,
      errors: [{ messageId: "spread" }, { messageId: "spread" }, { messageId: "argument" }],
    },
  ],
})
