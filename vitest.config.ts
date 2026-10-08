import { defineConfig } from "vitest/config";

// Unit tests run in plain Node; they cover pure logic only.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
