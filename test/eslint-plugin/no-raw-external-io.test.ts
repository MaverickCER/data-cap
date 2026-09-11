import { RuleTester } from "eslint"
import type { Rule } from "eslint"
import { describe, it } from "vitest"
import { noRawExternalIo } from "../../src/eslint-plugin/no-raw-external-io.js"

// RuleTester's own `run()` registers cases via Mocha-style global
// `describe`/`it` by default -- vitest doesn't inject those as true globals,
// so without this, vitest reports "No test suite found in file". Wiring
// RuleTester's documented static describe/it setters to vitest's own imports
// is the supported way to integrate it with a non-Mocha runner. Mirrors
// `stable-operation-reference.test.ts` exactly.
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    // `fetch`/`XMLHttpRequest` must resolve as real ambient globals, not as
    // unresolved identifiers -- `isBareGlobal` distinguishes a global from a
    // locally-declared binding, and the "shadowed by a local declaration"
    // cases below are only meaningful if the un-shadowed case really is one.
    globals: { fetch: "readonly", XMLHttpRequest: "readonly" },
  },
})

// Built via `@typescript-eslint/utils`'s `RuleCreator`, whose generated type
// is structurally stricter than -- and not assignable to -- plain `eslint`'s
// own `Rule.RuleModule` that `RuleTester.run()` expects. Same narrow cast
// `stable-operation-reference.test.ts` uses, for the same reason.
ruleTester.run("no-raw-external-io", noRawExternalIo as unknown as Rule.RuleModule, {
  valid: [
    // -- Inside a getter's own execute: the whole point of the rule. --
    {
      code: `
        createData({
          fields: { user: {} },
          getters: {
            getUser: {
              execute: (params, signal) => fetch("/api/user", { signal }).then((r) => r.json()),
              writes: { user: true },
            },
          },
        });
      `,
    },
    // A `function` expression body, not just an arrow.
    {
      code: `
        createData({
          getters: {
            getUser: {
              execute: function (params, signal) { return fetch("/api/user"); },
            },
          },
        });
      `,
    },
    // Nested arbitrarily deep inside execute -- position, not depth, is what exempts.
    {
      code: `
        createData({
          mutators: {
            saveUser: {
              execute: async () => {
                if (true) {
                  for (const x of []) {
                    await fetch("/api/user", { method: "POST" });
                  }
                }
              },
            },
          },
        });
      `,
    },
    // -- Inside a subscription's own subscribe. --
    {
      code: `
        createData({
          subscriptions: {
            watchUser: {
              subscribe: (params, emit) => {
                fetch("/api/user/stream");
                return () => {};
              },
            },
          },
        });
      `,
    },
    // `buildData` reaches the same exemption -- the rule recognizes both call forms.
    {
      code: `
        buildData({
          getters: { getUser: { execute: () => fetch("/api/user") } },
        });
      `,
    },
    // Member-access call form (`dataCap.createData(...)`), same as the sibling rule accepts.
    {
      code: `
        dataCap.createData({
          getters: { getUser: { execute: () => fetch("/api/user") } },
        });
      `,
    },
    // -- allow-listed file: exempt wholesale, regardless of position. --
    {
      code: `fetch("/api/anything");`,
      filename: "/project/src/lib/http-client.ts",
      options: [{ allow: ["**/lib/**"] }],
    },
    // -- A locally-declared binding that merely shares the name is not the bare global. --
    {
      code: `
        function fetch(url) { return null; }
        fetch("/api/user");
      `,
    },
    {
      code: `
        import { fetch } from "./http.js";
        fetch("/api/user");
      `,
    },
    // -- A name that isn't in `functions` is never flagged. --
    { code: `new XMLHttpRequest();` },
    // -- An empty `functions` list disables the rule entirely, explicitly. --
    { code: `fetch("/api/user");`, options: [{ functions: [] }] },
  ],

  invalid: [
    // -- Outside any capability at all. --
    {
      code: `
        createData({ fields: { user: {} } });
        fetch("/api/user");
      `,
      errors: [{ messageId: "noRawExternalIo" }],
    },
    // -- A configured function name that is not a declared/ambient global at
    //    all (no `globals` entry, no local declaration) is still flagged --
    //    `isBareGlobal` treats "resolved nowhere" as a bare global.
    {
      code: `myWeirdIo("/api/user");`,
      options: [{ functions: ["myWeirdIo"] }],
      errors: [{ messageId: "noRawExternalIo", data: { name: "myWeirdIo" } }],
    },
    // -- `fetch(...)` written as the *value* of `execute` (not inside an
    //    execute *function body*) is not exempt -- the exemption is only for
    //    calls lexically inside the operation's own function literal.
    {
      code: `createData({ getters: { getUser: { execute: fetch("/api/user") } } });`,
      errors: [{ messageId: "noRawExternalIo", data: { name: "fetch" } }],
    },
    // -- Application code entirely unrelated to any capability. --
    {
      code: `
        export async function loadDashboard() {
          const response = await fetch("/api/dashboard");
          return response.json();
        }
      `,
      errors: [{ messageId: "noRawExternalIo" }],
    },
    // -- Inside a capability call, but NOT inside execute/subscribe: a
    //    `processor` transforms an already-acquired result and has no
    //    business doing its own I/O, so it gets no exemption.
    {
      code: `
        createData({
          getters: {
            getUser: {
              execute: () => Promise.resolve({}),
              processor: (raw) => { fetch("/api/audit", { method: "POST" }); return raw; },
            },
          },
        });
      `,
      errors: [{ messageId: "noRawExternalIo" }],
    },
    // -- An `execute` OUTSIDE any getters/mutators/subscriptions section is
    //    not an operation body; the section is part of what grants the
    //    exemption, not just the key name.
    {
      code: `
        const notACapability = { execute: () => fetch("/api/user") };
      `,
      errors: [{ messageId: "noRawExternalIo" }],
    },
    // -- An `execute` inside a `createData()` but under a non-section key:
    //    the intervening property must not be mistaken for a section.
    {
      code: `createData({ notASection: { execute: () => { fetch("/api/user"); } } });`,
      errors: [{ messageId: "noRawExternalIo", data: { name: "fetch" } }],
    },
    // -- `execute` referencing a module-level function: the referent's own
    //    body is a separate lexical scope, so the call inside it is not
    //    "lexically inside execute" and is still flagged. Documented
    //    behavior, not an oversight -- the rule is positional.
    {
      code: `
        const getUser = () => fetch("/api/user");
        createData({ getters: { getUser: { execute: getUser } } });
      `,
      errors: [{ messageId: "noRawExternalIo" }],
    },
    // -- A file that doesn't match the allow glob still reports. --
    {
      code: `fetch("/api/anything");`,
      filename: "/project/src/features/dashboard.ts",
      options: [{ allow: ["**/lib/**"] }],
      errors: [{ messageId: "noRawExternalIo" }],
    },
    // -- A custom `options.functions` entry, reached through `new`. --
    {
      code: `const xhr = new XMLHttpRequest();`,
      options: [{ functions: ["XMLHttpRequest"] }],
      errors: [{ messageId: "noRawExternalIo" }],
    },
    // -- Extending `functions` replaces the default list, so naming only
    //    XMLHttpRequest leaves `fetch` alone; naming both flags both.
    {
      code: `
        fetch("/api/a");
        new XMLHttpRequest();
      `,
      options: [{ functions: ["fetch", "XMLHttpRequest"] }],
      errors: [{ messageId: "noRawExternalIo" }, { messageId: "noRawExternalIo" }],
    },
    // -- The message names the offending function, not a generic "I/O". --
    {
      code: `fetch("/api/user");`,
      errors: [{ messageId: "noRawExternalIo", data: { name: "fetch" } }],
    },
  ],
})
