/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// The site is served from https://<user>.github.io/gatha/ — see SPEC.md section 2.
// Every asset URL must be built from import.meta.env.BASE_URL, never a leading slash.
export default defineConfig({
  base: '/gatha/',
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
