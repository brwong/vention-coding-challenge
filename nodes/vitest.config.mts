import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts only runs inside the node processes that coordination.test.ts
      // spawns, and coverage does not reach into child processes.
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      // Election and membership branches mostly run in those processes too.
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
