import { defineConfig } from 'vite';

export default defineConfig({
  // Capacitor serves the bundle from a file:// origin, so use relative asset URLs.
  base: './',
  server: { host: true },
});
