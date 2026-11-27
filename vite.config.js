/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import { defineConfig } from 'vite';

// Source page lives in web/. The built site goes to dist/ (GitHub Actions deploy)
// and `npm run pages` also copies it to the repo root, so "Deploy from branch: main / root" works too.
export default defineConfig({
  root: 'web',
  base: './',
  worker: { format: 'es' },
  build: { outDir: '../dist', emptyOutDir: true, target: ['es2020', 'safari15'] },
});
