/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
// Copy the built site (dist/) to the repo root for "Deploy from a branch" GitHub Pages.
import { cpSync, rmSync, writeFileSync } from 'node:fs';
rmSync('assets', { recursive: true, force: true });
cpSync('dist/assets', 'assets', { recursive: true });
cpSync('dist/index.html', 'index.html');
writeFileSync('.nojekyll', '');
console.log('root site updated');
