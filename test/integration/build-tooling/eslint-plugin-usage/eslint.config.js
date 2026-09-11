import tseslint from "typescript-eslint"
import dataCapPlugin from "@maverickcer/data-cap/eslint-plugin"

export default tseslint.config({
  files: ["src/fixtures/**/*.ts"],
  languageOptions: {
    parser: tseslint.parser,
  },
  plugins: { "data-cap": dataCapPlugin },
  rules: {
    "data-cap/stable-operation-reference": "warn",
  },
})
