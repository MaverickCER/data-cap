/**
 * Type-level tests only -- these never run any code. `expectTypeOf`
 * assertions and `// @ts-expect-error` comments are both checked by `tsc`
 * (via `npm run typecheck`), not exercised at runtime by vitest. Every
 * positive inference assertion here is deliberately paired with at least one
 * negative (`// @ts-expect-error`) counterpart where a genuinely invalid
 * construct exists -- see specs/architecture.md's "Type-level test
 * discipline".
 */
import { describe, expectTypeOf, it } from "vitest"
import type { fields } from "../../src/core/fields.js"
import type {
  DataInfo,
  DataState,
  DeepPartial,
  FieldInfo,
  InferFields,
  InferFieldValue,
  OwnedPatch,
} from "../../src/core/types.js"

describe("InferFieldValue", () => {
  it("infers primitives, nested objects, and arrays", () => {
    expectTypeOf<InferFieldValue<string>>().toEqualTypeOf<string>()
    expectTypeOf<InferFieldValue<number>>().toEqualTypeOf<number>()
    expectTypeOf<InferFieldValue<boolean>>().toEqualTypeOf<boolean>()
    expectTypeOf<InferFieldValue<{ a: string; b: { c: number } }>>().toEqualTypeOf<{
      a: string
      b: { c: number }
    }>()
    expectTypeOf<InferFieldValue<string[]>>().toEqualTypeOf<string[]>()
    expectTypeOf<InferFieldValue<{ id: string }[]>>().toEqualTypeOf<{ id: string }[]>()
  })

  it("treats Date/URL/RegExp as opaque leaves, never decomposed into a plain object", () => {
    expectTypeOf<InferFieldValue<Date>>().toEqualTypeOf<Date>()
    expectTypeOf<InferFieldValue<URL>>().toEqualTypeOf<URL>()
    expectTypeOf<InferFieldValue<RegExp>>().toEqualTypeOf<RegExp>()
  })

  it("infers the underlying type through fields.nullable/fields.optional markers", () => {
    expectTypeOf<InferFieldValue<ReturnType<typeof fields.nullable<string>>>>().toEqualTypeOf<
      string | null
    >()
    expectTypeOf<InferFieldValue<ReturnType<typeof fields.optional<string>>>>().toEqualTypeOf<
      string | undefined
    >()
  })

  it("negative: a function-valued field never resolves to a usable type", () => {
    // Functions are never valid field values (spec: "Functions are never field data") --
    // the sound representation of that rejection is `never`, paired with build.ts's
    // runtime throw for the same case (see test/core/build.test.ts).
    expectTypeOf<InferFieldValue<() => void>>().toBeNever()
  })
})

describe("InferFields", () => {
  it("infers a complete recursive shape from a fields literal's type, no manual interface required", () => {
    // Stands in for `typeof someFieldsLiteral` -- exactly what `buildData`'s
    // own generic inference sees from an object literal passed to it. A type
    // literal exercises the same recursive machinery without an unused
    // runtime binding this purely type-level test file never executes.
    interface FieldsLiteral {
      id: string
      user: { email: string }
      comments: { id: string; body: string }[]
    }
    expectTypeOf<InferFields<FieldsLiteral>>().toEqualTypeOf<FieldsLiteral>()
  })
})

describe("DataState / DataInfo", () => {
  interface Comment {
    id: string
    body: string
  }
  interface Shape {
    id: string
    comments: Comment[]
  }

  it("fields keeps the exact application shape -- arrays stay arrays", () => {
    expectTypeOf<DataState<Shape>["fields"]>().toEqualTypeOf<Shape>()
    expectTypeOf<DataState<Shape>["fields"]["comments"]>().toEqualTypeOf<Comment[]>()
  })

  it("info represents array items as identity-keyed objects, never as an array", () => {
    expectTypeOf<DataInfo<Shape>["comments"]>().toEqualTypeOf<
      Partial<Record<string, DataInfo<Comment> & FieldInfo>> | undefined
    >()
  })

  it("every DataInfo member is optional -- an empty object is a structurally valid DataInfo", () => {
    const info: DataInfo<Shape> = {}
    expectTypeOf(info).toEqualTypeOf<DataInfo<Shape>>()
  })

  it("negative: fields and info are readonly on DataState -- direct reassignment must not type-check", () => {
    const state = {} as DataState<Shape>
    // @ts-expect-error -- `fields` is readonly
    state.fields = { id: "x", comments: [] }
    // @ts-expect-error -- `info` is readonly
    state.info = {}
  })

  it("negative: there is no dot-notation string index into fields, only real nested property access", () => {
    const value = {} as Shape
    // @ts-expect-error -- "id.nested" is not a key of Shape; field access is never a string path
    // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- satisfies noUnusedExpressions for this type-only assertion.
    void value["id.nested"]
  })
})

describe("OwnedPatch", () => {
  interface Fields {
    user: { name: string; email: string }
    post: { title: string }
  }

  it("true ownership allows the full DeepPartial subtree", () => {
    expectTypeOf<OwnedPatch<Fields, true>>().toEqualTypeOf<DeepPartial<Fields>>()
  })

  it("narrows to exactly the declared ownership shape -- a nested partial ownership only permits its own key", () => {
    interface Writes {
      user: { email: true }
    }
    expectTypeOf<OwnedPatch<Fields, Writes>>().toEqualTypeOf<{ user?: { email?: string } }>()
  })

  it("a value matching the declared ownership shape type-checks", () => {
    const patch: OwnedPatch<Fields, { user: { email: true } }> = {
      user: { email: "new@example.com" },
    }
    expectTypeOf(patch).toEqualTypeOf<{ user?: { email?: string } }>()
  })

  it("negative: a field entirely outside the declared ownership never type-checks -- a processor for writes: {user: {email: true}} cannot type-check while returning {post: ...}", () => {
    const assign = (): void => {
      const patch: OwnedPatch<Fields, { user: { email: true } }> = {
        // @ts-expect-error -- `post` is not owned by `{user: {email: true}}`
        post: { title: "sneaky" },
      }
      // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- satisfies noUnusedLocals for this type-only assertion.
      void patch
    }
    // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- satisfies noUnusedLocals for this type-only assertion.
    void assign
  })

  it("negative: a sibling field within an owned object, but itself not owned, never type-checks -- {user: {email: true}} never permits user.name", () => {
    const assign = (): void => {
      const patch: OwnedPatch<Fields, { user: { email: true } }> = {
        // @ts-expect-error -- `user.name` is not owned; only `user.email` is
        user: { name: "sneaky" },
      }
      // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- satisfies noUnusedLocals for this type-only assertion.
      void patch
    }
    // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- satisfies noUnusedLocals for this type-only assertion.
    void assign
  })
})
