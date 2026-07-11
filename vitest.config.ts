import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Resolve the workspace package to its TypeScript source so tests run
      // without a prior `pnpm build` of @site-review/shared.
      "@site-review/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
});
