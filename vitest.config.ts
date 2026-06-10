import { defineConfig } from "vitest/config";

// Unit tests for the pure pipeline logic (legal gate, dedup). No network,
// no filesystem beyond os.tmpdir. Lives in test/ so tsc (src/scripts only)
// stays unaffected.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
