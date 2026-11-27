/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
// All processing happens here, inside the user's browser. Nothing is uploaded.
import { scanAddon, summarize, findDuplicates, buildPack } from './core/index.js';

let armors = new Map();

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'scan') {
      armors = new Map();
      const skipped = [];
      const warnings = [];
      for (let i = 0; i < msg.files.length; i++) {
        const f = msg.files[i];
        self.postMessage({ type: 'progress', p: i / msg.files.length, msg: f.name });
        try {
          const r = await scanAddon(f.name, f.buffer);
          warnings.push(...r.warnings.map((w) => `${f.name}: ${w}`));
          if (!r.armors.length) skipped.push({ name: f.name, reason: r.hasResourcePack ? 'no_attachable' : 'no_rp' });
          for (const a of r.armors) {
            if (armors.has(a.key)) a.key += '#' + i;
            armors.set(a.key, a);
          }
        } catch (e) {
          skipped.push({ name: f.name, reason: 'bad_zip', detail: String(e.message || e) });
        }
      }
      const list = [...armors.values()];
      self.postMessage({ type: 'scanned', armors: list.map(summarize), duplicates: findDuplicates(list), skipped, warnings });
    } else if (msg.type === 'build') {
      const sel = msg.keys.map((k) => armors.get(k)).filter(Boolean);
      const res = await buildPack(sel, {
        settings: msg.settings,
        overrides: msg.overrides,
        packState: msg.packState,
        onProgress: (p, m) => self.postMessage({ type: 'progress', p, msg: m }),
      });
      self.postMessage({ type: 'built', bytes: res.bytes, fileName: res.fileName, packState: res.packState, report: res.report }, [res.bytes.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e.message || e), code: e.code, identifier: e.identifier });
  }
};
