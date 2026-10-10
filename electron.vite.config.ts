import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    // Bundle drizzle-orm into the main-process output so the packaged app
    // (which ships no node_modules) can run Drizzle migrations at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['drizzle-orm'] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    plugins: [react()],
  },
});
