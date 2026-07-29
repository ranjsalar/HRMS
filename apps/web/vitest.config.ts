import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    css: false,
    // Real-backend integration tests (no mocked apiFetch) now make up a
    // meaningful share of this suite, and several hit the SAME single-
    // process dev API server. Running test FILES in parallel (the
    // default) meant multiple integration specs issued real concurrent
    // HTTP round-trips to that one server at once, occasionally pushing a
    // request past its timeout under CPU contention — confirmed via
    // repeated runs: 100% reliable standalone, intermittent only under
    // full-suite parallel execution (see DECISIONS.md, step 9.3/9.4).
    // Disabling file-level parallelism trades total suite wall-clock time
    // for eliminating that whole flake category — worth it since this
    // project's standard is "run everything together, all green," not
    // "fastest possible CI."
    fileParallelism: false,
  },
});
