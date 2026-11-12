import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test file truncates the shared quire_test database in beforeEach, so files must not run at the same time.
    fileParallelism: false,
  },
});
