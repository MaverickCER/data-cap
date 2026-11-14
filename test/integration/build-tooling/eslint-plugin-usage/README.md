# eslint-plugin-usage

**Build tooling.** Runs the real `stable-operation-reference` ESLint rule,
through ESLint's own Node API, against two real fixture files. One uses only stable module-level references (never flagged). The other has both mistakes the rule exists to catch.

`src/fixtures/*.ts` use a local stub `createData` rather than the real one
imported from `data-cap/runtime`. The rule matches a call's
`execute`/`subscribe` keys purely by name (see the rule's own doc comment),
independent of the real `createData`. So this example stays a pure
lint-behavior check. It does not also depend on runtime execution (network
calls, timers), which would be irrelevant to what's being demonstrated here.

## Run it

```sh
npm install
npm start
```

## What it proves

- A stable, module-level `execute`/`subscribe` reference is never flagged.
- An inline function literal is flagged (`inlineFunctionLiteral`).
- A reference that _looks_ stable but is declared inside a function
  (getting a fresh identity every time that function runs) is also flagged (`recreatedPerCall`). The rule finds it via real scope analysis, not only syntax.
