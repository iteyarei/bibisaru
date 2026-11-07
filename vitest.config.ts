import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "apps/shop-reach/test/**/*.test.ts"],
    environment: "node",
  },
});
