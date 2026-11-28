/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
// All processing happens here, inside the user's browser. Nothing is uploaded.
import { scanAddon, summarize, findDuplicates, buildPack, decodeImage, canDecode, flattenGlow, encodePng, downscale, tint, DEBUG_COLORS, settingsFor, normalizeSettings, reduceGeometryDef } from './core/index.js';

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
      if (a?.texture && canDecode(a.texture.path)) {
        let img = decoded.get(a.key);
        if (!img) {
          img = decodeImage(await a.texture.file.async('uint8array'), a.texture.path);
          decoded.set(a.key, img);
        }
        const glowFlat = !!(a.glow && s.glowOff && s.memoryMode !== 'none');
        const flat = glowFlat ? flattenGlow(img, /alpha/i.test(a.glow.material)) : img;
        const alphaMode = glowFlat ? 'test' : a.glow ? 'emissive' : /blend|translucent/i.test(a.material) ? 'blend' : 'test';
        let def = a.geometry?.def || null;
        for (let i = 0; i <= s.lodCount; i++) {
          if (def && i > 0 && (s.levels[i].minCubeSize > 0 || s.levels[i].dedupePlanes)) def = reduceGeometryDef(def, s.levels[i]);
          const r = i === 0 || s.memoryMode === 'none' || (s.memoryMode === 'minimal' && i < s.lodCount) ? 1 : s.levels[i].resolution;
          const base = i > 0 ? flat : img;
          let im = r === 1 ? base : downscale(base, r, { alphaMode: i > 0 ? alphaMode : 'blend' });
          if (s.debug && i > 0) im = tint(im, DEBUG_COLORS[i]);
          out.push({ r, png: encodePng(im), geo: def });
        }
      }
      self.postMessage({ type: 'preview', key: msg.key, gid: msg.gid ?? msg.key, id: msg.id, levels: out, blend: /blend|translucent/i.test(a?.material || '') || !!a?.glow });
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
