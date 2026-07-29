import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "playwright-report/**",
      "packages/codec-spz/src/vendor/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      "import-x/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "import-x/order": [
        "error",
        {
          alphabetize: { caseInsensitive: true, order: "asc" },
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          "newlines-between": "always",
        },
      ],
    },
  },
  {
    files: ["apps/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: [
      "*.config.{js,mjs,ts}",
      "**/*.config.ts",
      "tests/**/*.ts",
      "**/tests/**/*.ts",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["packages/player-core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@sparkjsdev/spark", "@6g-path/gaussian-renderer-spark"],
              message: "player-core must remain independent from concrete renderers.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
