import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2021,
      globals: {
        ...globals.node,
        token: "readonly",
      },
    },
    plugins: {
      js: pluginJs,
    },
    rules: {
      "no-console": "off",
      "consistent-return": "off",
      "no-underscore-dangle": "off",
    },
  },
  pluginJs.configs.recommended,
  {
    // Allow intentionally-unused names prefixed with `_` (e.g. the `next` arg
    // an Express error handler must declare to be recognised as one). Placed
    // after the recommended config so it isn't overridden by it.
    rules: {
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];