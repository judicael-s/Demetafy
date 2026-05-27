import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: false,
    pool: 'forks',
    server: {
      // Vite (used by Vitest 2.x ships Vite 5) predates `node:sqlite` stabilization
      // and chokes on the bare `node:` builtin import. Tell its dep resolver to leave
      // it externalized to Node's loader.
      deps: { external: [/^node:sqlite$/, /^sqlite$/] },
    },
  },
});
