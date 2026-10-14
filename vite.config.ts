import { defineConfig } from "vite";

const buildVersion = (process.env.CF_PAGES_COMMIT_SHA?.trim() || "dev").toLowerCase();

export default defineConfig({
  define: {
    __BIBISARU_BUILD__: JSON.stringify(buildVersion),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
