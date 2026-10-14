import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { fetch: "readonly", URL: "readonly", AbortSignal: "readonly" },
    },
  },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
);
