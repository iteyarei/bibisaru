import { cpSync, rmSync } from "node:fs";

rmSync("public/assets", { recursive: true, force: true });
cpSync("dist/assets", "public/assets", { recursive: true });
