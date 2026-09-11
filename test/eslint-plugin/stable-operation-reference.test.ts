import { RuleTester } from "eslint"
import type { Rule } from "eslint"
import { describe, it } from "vitest"
import { stableOperationReference } from "../../src/eslint-plugin/stable-operation-reference.js"

// RuleTester's own `run()` registers cases via Mocha-style global
// `describe`/`it` by default -- vitest doesn't inject those as true globals,
// so without this, vitest reports "No test suite found in file". Wiring
// RuleTester's documented static describe/it setters to vitest's own imports
// is the supported way to integrate it with a non-Mocha runner.
RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } })

// `stableOperationReference` is built via `@typescript-eslint/utils`'s
// `RuleCreator`, whose generated type is structurally stricter than -- and
// not assignable to -- plain `eslint`'s own `Rule.RuleModule` type
// `RuleTester.run()` expects. Both describe the same rule shape at runtime;
// a narrow cast avoids pulling in `@typescript-eslint/rule-tester` as a
// second, dedicated test dependency just to align the types.
ruleTester.run(
  "stable-operation-reference",
  stableOperationReference as unknown as Rule.RuleModule,
  {
    valid: [
      // A reference to a stable, module-level function -- exactly the sharable case.
      {
        code: `
        function getUser() {}
        createData({ getters: { getUser: { execute: getUser } } });
      `,
      },
      {
        code: `
        const getUser = () => {};
        createData({ getters: { getUser: { execute: getUser } } });
      `,
      },
      // Imported bindings are module singletons -- as stable as a local
      // module-level declaration.
      {
        code: `
        import { getUser } from "./operations.js";
        createData({ getters: { getUser: { execute: getUser } } });
      `,
      },
      // Shorthand property form resolves the same way as `execute: getUser`.
      {
        code: `
        const execute = () => {};
        createData({ getters: { getUser: { execute } } });
      `,
      },
      // A namespace-qualified call to createData -- still recognized, still valid when stable.
      {
        code: `
        function subscribeToUser() {}
        dataCap.createData({ subscriptions: { userUpdated: { subscribe: subscribeToUser } } });
      `,
      },
      // A block at module top level only ever runs once, at module
      // evaluation -- never inside a function -- so it's still stable.
      {
        code: `
        {
          const getUser = () => {};
          createData({ getters: { getUser: { execute: getUser } } });
        }
      `,
      },
      // An identifier scope analysis can't resolve (no declaration anywhere
      // in the file) can't be proven unstable either -- this rule only flags
      // what it can positively show is recreated per call.
      {
        code: `createData({ getters: { getUser: { execute: getUser } } });`,
      },
      // execute/subscribe outside a createData() call are none of this rule's business.
      { code: `const config = { execute: () => {} };` },
      { code: `someOtherFunction({ execute: () => {} });` },
      // The createData depth counter must return to 0 on exit -- an inline
      // `execute` *after* a (valid) createData call is still not this rule's
      // business.
      {
        code: `
        function getUser() {}
        createData({ getters: { getUser: { execute: getUser } } });
        const later = { execute: () => {} };
      `,
      },
      // A computed key never statically matches "execute"/"subscribe".
      {
        code: `
        const key = "execute";
        createData({ getters: { getUser: { [key]: () => {} } } });
      `,
      },
      // An unrelated key inside createData() is not this rule's concern.
      { code: `createData({ fields: { onLoad: () => {} } });` },
      // A CallExpression/MemberExpression value is outside what this rule
      // tries to statically prove stable or unstable -- deliberately left
      // alone rather than guessed at.
      {
        code: `createData({ getters: { getUser: { execute: makeGetUser() } } });`,
      },
      {
        code: `createData({ getters: { getUser: { execute: operations.getUser } } });`,
      },
    ],
    invalid: [
      {
        code: `createData({ getters: { getUser: { execute: () => {} } } });`,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "execute" } }],
      },
      {
        code: `createData({ getters: { getUser: { execute: function () {} } } });`,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "execute" } }],
      },
      {
        code: `createData({ subscriptions: { userUpdated: { subscribe: () => {} } } });`,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "subscribe" } }],
      },
      // Namespace-qualified call, still recognized.
      {
        code: `dataCap.createData({ getters: { getUser: { execute: () => {} } } });`,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "execute" } }],
      },
      // Quoted key form, still statically resolvable.
      {
        code: `createData({ getters: { getUser: { "execute": () => {} } } });`,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "execute" } }],
      },
      // Two independent offenses in one call -- both reported.
      {
        code: `createData({ getters: { getUser: { execute: () => {} } }, subscriptions: { s: { subscribe: () => {} } } });`,
        errors: [
          { messageId: "inlineFunctionLiteral", data: { key: "execute" } },
          { messageId: "inlineFunctionLiteral", data: { key: "subscribe" } },
        ],
      },
      // The offense inside createData is flagged; an inline `execute` in an
      // unrelated object literal after the call is not (depth back to 0).
      {
        code: `
        createData({ getters: { getUser: { execute: () => {} } } });
        const later = { execute: () => {} };
      `,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "execute" } }],
      },
      // A non-createData call nested inside createData must not decrement the
      // depth on its own exit -- a later sibling offense is still flagged.
      {
        code: `
        createData({ getters: {
          a: { execute: makeGetUser() },
          b: { execute: () => {} },
        } });
      `,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "execute" } }],
      },
      // Nested inside a nested object, still detected regardless of depth.
      {
        code: `createData({ mutators: { updateUser: { execute: () => {}, optimizer: () => ({}) } } });`,
        errors: [{ messageId: "inlineFunctionLiteral", data: { key: "execute" } }],
      },
      // Declared inside a factory function -- a fresh identity every time the
      // factory runs, even though it "looks" like a stable named reference.
      {
        code: `
        function createCapability() {
          const getUser = async () => {};
          return createData({ getters: { getUser: { execute: getUser } } });
        }
      `,
        errors: [{ messageId: "recreatedPerCall", data: { key: "execute", name: "getUser" } }],
      },
      // Same, with a `function` declaration instead of a `const` arrow.
      {
        code: `
        function createCapability() {
          function getUser() {}
          return createData({ getters: { getUser: { execute: getUser } } });
        }
      `,
        errors: [{ messageId: "recreatedPerCall", data: { key: "execute", name: "getUser" } }],
      },
      // A parameter is never guaranteed stable -- the caller may pass a
      // fresh function on every invocation.
      {
        code: `
        function createCapability(getUser) {
          return createData({ getters: { getUser: { execute: getUser } } });
        }
      `,
        errors: [{ messageId: "recreatedPerCall", data: { key: "execute", name: "getUser" } }],
      },
      // Recreated per call even through an intervening block scope.
      {
        code: `
        function createCapability() {
          if (true) {
            const getUser = () => {};
            return createData({ getters: { getUser: { execute: getUser } } });
          }
        }
      `,
        errors: [{ messageId: "recreatedPerCall", data: { key: "execute", name: "getUser" } }],
      },
      // Shorthand property form is recreated per call exactly like the
      // explicit `execute: execute` form would be.
      {
        code: `
        function createCapability() {
          const execute = () => {};
          return createData({ getters: { getUser: { execute } } });
        }
      `,
        errors: [{ messageId: "recreatedPerCall", data: { key: "execute", name: "execute" } }],
      },
    ],
  },
)
