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
      exclude: [
        'src/main.tsx',
        'src/interfaces/**',
        'src/test/**',
        'src/simulation/fixtures.ts',
        '**/*.test.*',
      ],
      // Regression floor, ratcheted up (never down) as coverage improves - see engineering-notes.md.
      thresholds: {
        branches: 55,
        functions: 51,
        lines: 55,
        statements: 54,
        // The sale engine is held to a much higher bar than the UI around it.
        'src/simulation/**': { branches: 75, functions: 90, lines: 90, statements: 90 },
      },
    },
  },
});
