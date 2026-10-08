import { defineConfig } from "vitest/config";

// Tests run in plain Node; external services use local stubs.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
