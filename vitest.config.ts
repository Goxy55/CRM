import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // Testovi dele jednu bazu; izvršavaju se redom da se ne bi mešali podaci.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
