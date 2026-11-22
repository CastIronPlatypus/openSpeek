/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation lets Phonon's threaded WebAssembly build run.
// `credentialless` keeps cross-origin fetches (the model on Hugging Face) working.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  base: './',
  plugins: [react()],
  // `npm run server` serves the API (Edge TTS, server-side Phonon, page fetch) on 8787.
  server: { headers: isolation, proxy: { '/api': 'http://localhost:8787' } },
  preview: { headers: isolation },
  // phonon-tts locates its worker and wasm with `new URL(..., import.meta.url)`;
  // pre-bundling would break those relative paths in dev.
  // pdf.js is imported lazily; listing it avoids a full page reload on the first PDF import in dev.
  optimizeDeps: { exclude: ['phonon-tts'], include: ['pdfjs-dist/legacy/build/pdf.mjs'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
