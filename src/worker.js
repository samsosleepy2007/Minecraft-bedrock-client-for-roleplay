/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
// All processing happens here, inside the user's browser. Nothing is uploaded.
import { scanAddon, summarize, findDuplicates, buildPack, decodePng, encodePng, downscale, tint, DEBUG_COLORS, settingsFor, normalizeSettings } from './core/index.js';

const decoded = new Map();

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
    } else if (msg.type === 'preview') {
      // Real texture of one armor at each LOD resolution (for the level preview strip)
      const a = armors.get(msg.key);
      const s = settingsFor(normalizeSettings(msg.settings), msg.override);
      const out = [];
      if (a?.texture && a.texture.ext.toLowerCase() === '.png') {
        let img = decoded.get(a.key);
        if (!img) {
          img = decodePng(await a.texture.file.async('uint8array'));
          decoded.set(a.key, img);
        }
        const alphaMode = /blend|translucent/i.test(a.material) ? 'blend' : 'test';
        for (let i = 0; i <= s.lodCount; i++) {
          const r = i === 0 || s.memoryMode === 'none' || (s.memoryMode === 'minimal' && i < s.lodCount) ? 1 : s.levels[i].resolution;
          let im = r === 1 ? img : downscale(img, r, { alphaMode });
          if (s.debug && i > 0) im = tint(im, DEBUG_COLORS[i]);
          out.push({ r, png: encodePng(im) });
        }
      }
      self.postMessage({ type: 'preview', key: msg.key, id: msg.id, levels: out });
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
