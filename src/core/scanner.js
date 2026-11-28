/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import JSZip from 'jszip';
import { parseBedrockJson } from './json.js';
import { listGeometries, countCubes, countPolys } from './geometry.js';
import { pngSize } from './texture.js';
import { countMolang } from './molang.js';

const dec = new TextDecoder();

/** Safe folder slug from an addon file name. */
export function slugify(name) {
  const s = String(name)
    .replace(/\.(mcaddon|mcpack|zip)$/i, '')
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
  return s || 'addon';
}

/** Flatten a zip (and nested .mcpack/.zip) into Map<path, JSZipObject>. */
async function flatten(data, prefix = '', out = new Map(), depth = 0) {
  const zip = await JSZip.loadAsync(data);
  const nested = [];
  zip.forEach((path, f) => {
    if (f.dir) return;
    if (/\.(mcpack|zip|mcaddon)$/i.test(path) && depth < 3) nested.push([path, f]);
    else out.set(prefix + path, f);
  });
  for (const [path, f] of nested) {
    try {
      await flatten(await f.async('uint8array'), prefix + path + '/', out, depth + 1);
    } catch {
      /* not a zip – ignore */
    }
  }
  return out;
}

const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

/**
 * Scan one addon file.
 * @param {string} fileName
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<{name:string, slug:string, armors:object[], warnings:string[], hasResourcePack:boolean}>}
 */
export async function scanAddon(fileName, data) {
  const files = await flatten(data);
  const warnings = [];
  const slug = slugify(fileName);
  const roots = [];
  for (const [path, f] of files) {
    if (!/(^|\/)manifest\.json$/i.test(path)) continue;
    try {
      const m = parseBedrockJson(await f.async('string'));
      if ((m.modules || []).some((x) => x.type === 'resources')) roots.push({ root: dirname(path), manifest: m });
    } catch (e) {
      warnings.push(`manifest: ${path}: ${e.message}`);
    }
  }
  // Behavior-pack items that are wearable in an armor slot → definitely armor
  const wearable = new Set();
  for (const [path, f] of files) {
    if (!/(^|\/)items\/.*\.json$/i.test(path)) continue;
    try {
      const it = parseBedrockJson(await f.async('string'))['minecraft:item'];
      const slot = it?.components?.['minecraft:wearable']?.slot || '';
      if (it?.description?.identifier && /armor/.test(slot)) wearable.add(it.description.identifier);
    } catch {
      /* ignore */
    }
  }
  const armors = [];
  for (const { root, manifest } of roots) {
    const pack = await indexPack(files, root, warnings);
    for (const [rel, att] of pack.attachables) {
      const a = describeArmor(att, rel, pack, warnings);
      if (!a) continue;
      if (wearable.has(a.identifier)) a.likelyArmor = true;
      a.addonName = fileName;
      a.slug = slug;
      a.packName = manifest?.header?.name || '';
      a.key = `${slug}::${a.identifier}`;
      armors.push(a);
    }
  }
  await readTextureSizes(armors);
  return { name: fileName, slug, armors, warnings, hasResourcePack: roots.length > 0 };
}

async function indexPack(files, root, warnings) {
  const local = new Map();
  for (const [p, f] of files) if (p.startsWith(root)) local.set(p.slice(root.length), f);
  const attachables = new Map();
  const geometries = new Map();
  const controllers = new Map();
  const readJson = async (rel) => parseBedrockJson(await local.get(rel).async('string'));
  for (const rel of local.keys()) {
    if (!/\.json$/i.test(rel)) continue;
    try {
      if (/^attachables\//i.test(rel)) {
        const j = await readJson(rel);
        if (j['minecraft:attachable']) attachables.set(rel, j);
      } else if (/^models\//i.test(rel) || /\.geo\.json$/i.test(rel)) {
        const j = await readJson(rel);
        for (const g of listGeometries(j)) geometries.set(g.id, { ...g, file: rel });
      } else if (/^render_controllers\//i.test(rel)) {
        const j = await readJson(rel);
        for (const [n, d] of Object.entries(j.render_controllers || {})) controllers.set(n, d);
      }
    } catch (e) {
      warnings.push(`JSON: ${root}${rel}: ${e.message}`);
    }
  }
  const findTexture = (ref) => {
    if (!ref) return null;
    for (const ext of ['.png', '.tga', '']) {
      const f = local.get(ref + ext);
      if (f) return { path: ref + ext, file: f, ext: ext || ref.slice(ref.lastIndexOf('.')) };
    }
    return null;
  };
  return { root, local, attachables, geometries, controllers, findTexture };
}

const ARMOR_HINT = /armor|helmet|chest|legging|boot|hair|head/i;

function describeArmor(att, rel, pack, warnings) {
  const d = att['minecraft:attachable']?.description;
  if (!d?.identifier) return null;
  const texKey = d.textures?.default ? 'default' : Object.keys(d.textures || {}).find((k) => k !== 'enchanted');
  const geoKey = d.geometry?.default ? 'default' : Object.keys(d.geometry || {})[0];
  const texRef = texKey ? d.textures[texKey] : null;
  const geoId = geoKey ? d.geometry[geoKey] : null;
  const geo = geoId ? pack.geometries.get(geoId) || null : null;
  const tex = pack.findTexture(texRef);
  const matKey = d.materials?.default ? 'default' : Object.keys(d.materials || {})[0];
  const material = matKey ? String(d.materials[matKey]) : '';
  const rcs = (d.render_controllers || []).map((r) => (typeof r === 'string' ? r : Object.keys(r)[0]));
  const w = [];
  if (!geo) w.push(`geometry ${geoId || '?'} not in pack`);
  if (!tex) w.push(`texture ${texRef || '?'} not in pack`);
  else if (tex.ext.toLowerCase() !== '.png') w.push(`texture ${tex.path} is not PNG (kept original)`);
  const itemLike = rcs.some((r) => /item/i.test(r));
  const likelyArmor = (!itemLike && geo && (geo.def.bones || []).length >= 3) || ARMOR_HINT.test(material) || rcs.some((r) => /armor/i.test(r)) || ARMOR_HINT.test(d.identifier) || ARMOR_HINT.test(rel);
  return {
    identifier: d.identifier,
    attachablePath: rel,
    attachable: att,
    texKey,
    texRef,
    texture: tex,
    texW: 0,
    texH: 0,
    geoKey,
    geometry: geo,
    material,
    cubeCount: geo ? countCubes(geo.def) : 0,
    polyCount: geo ? countPolys(geo.def) : 0,
    setKey: geo || tex ? `${geo?.id}|${tex?.path}` : d.identifier,
    molangLines: countMolang(d.scripts?.pre_animation),
    renderControllers: rcs,
    controllerDefs: Object.fromEntries(rcs.filter((n) => pack.controllers.has(n)).map((n) => [n, pack.controllers.get(n)])),
    likelyArmor,
    warnings: w,
    pack,
  };
}

/** Fill texW/texH by reading PNG header (cheap). */
export async function readTextureSizes(armors) {
  for (const a of armors) {
    if (a.texture && a.texture.ext.toLowerCase() === '.png') {
      const s = pngSize(await a.texture.file.async('uint8array'));
      if (s) {
        a.texW = s.width;
        a.texH = s.height;
      }
    }
  }
  return armors;
}

/** Group armors whose identifier appears in more than one addon. */
export function findDuplicates(armors) {
  const m = new Map();
  for (const a of armors) m.set(a.identifier, [...(m.get(a.identifier) || []), a]);
  return [...m.entries()].filter(([, l]) => l.length > 1).map(([identifier, list]) => ({ identifier, keys: list.map((a) => a.key) }));
}

/** Plain, serialisable summary for the UI. */
export const summarize = (a) => ({
  key: a.key,
  identifier: a.identifier,
  addonName: a.addonName,
  packName: a.packName,
  texW: a.texW,
  texH: a.texH,
  cubeCount: a.cubeCount,
  polyCount: a.polyCount,
  setKey: `${a.slug}|${a.setKey}`,
  geoId: a.geometry?.id || '',
  molangLines: a.molangLines,
  likelyArmor: a.likelyArmor,
  warnings: a.warnings,
});
