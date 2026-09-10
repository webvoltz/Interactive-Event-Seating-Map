import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/interfaces/**', 'src/test/**', '**/*.test.*'],
      // NOT yet at the org standard (branches 85 / functions 100 / lines 90 /
      // statements 90) — most components have no tests at all yet. Set here
      // as a floor so coverage can't silently regress below where it is
      // today, while the real work of reaching full compliance is tracked
      // separately (see engineering-notes.md). Ratcheted up (never down) as
      // real coverage improves — last raised alongside the best-seats
      // solver and live seat-hold contention work, whose pure utility
      // modules landed at ~95%+ coverage each. Floored a point below the
      // actual measured numbers (branches 56.2 / functions 49.4 / lines
      // 55.1 / statements 54.1) for safety margin.
      thresholds: {
        branches: 55,
        functions: 48,
        lines: 54,
        statements: 53,
      },
    },
  },
});
