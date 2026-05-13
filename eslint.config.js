export default [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["src/**/*.js", "ui/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        chrome: "readonly",
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        alert: "readonly",
        confirm: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
<<<<<<< fix-release-pipeline
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
=======
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
>>>>>>> main
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        console: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
<<<<<<< fix-release-pipeline
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
=======
      "no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
>>>>>>> main
    },
  },
];
