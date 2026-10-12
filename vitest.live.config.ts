import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/live.manual.ts"],
    environment: "node",
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
