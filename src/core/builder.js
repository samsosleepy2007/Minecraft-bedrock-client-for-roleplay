/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import JSZip from 'jszip';
import { toJson } from './json.js';
import { transformPreAnimation, transformAnimate } from './molang.js';
import { reduceGeometryDef, makeGeometryFile, countCubes } from './geometry.js';
import { decodePng, encodePng, downscale, tint, DEBUG_COLORS } from './texture.js';
import { normalizeSettings, settingsFor, thresholds, textureLevels } from './settings.js';
import { LICENSE_TEXT } from './license.js';
import packIconUrl from '../assets/pack_icon.png?inline';

/** SleepyShop logo bytes for pack_icon.png */
export function packIconBytes() {
  const b64 = packIconUrl.slice(packIconUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const PACK_NAME = 'SleepyArmor Lite';
const PLAYER = "q.owner_identifier == 'minecraft:player'";
const STAND = "q.owner_identifier == 'minecraft:armor_stand'";

export const uuid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });

/** Add armor stand to an item condition (OR, keeps the original). */
export function withArmorStand(cond) {
  const c = typeof cond === 'string' ? cond.trim() : '';
  if (/armor_stand/.test(c)) return c;
  const norm = c.replace(/\bquery\./g, 'q.').replace(/\s+/g, ' ').replace(/"/g, "'");
  if (!c || norm === PLAYER) return `${PLAYER} || ${STAND}`;
  return `(${c}) || ${STAND}`;
}

const safeId = (id) => id.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

/** Build the replacement render controller. */
export function buildRenderController(base, { maxLod, hideLod, hasEnchanted }) {
  const rc = base
    ? structuredClone(base)
    : { materials: [{ '*': 'Material.default' }], textures: ['Texture.default', ...(hasEnchanted ? ['Texture.enchanted'] : [])] };
  rc.arrays = rc.arrays || {};
  rc.arrays.textures = { ...(rc.arrays.textures || {}), 'Array.tex': ['Texture.default', ...range(maxLod).map((i) => `Texture.lod${i}`)] };
  rc.arrays.geometries = { ...(rc.arrays.geometries || {}), 'Array.geo': ['Geometry.default', ...range(maxLod).map((i) => `Geometry.lod${i}`)] };
  const idx = `math.min(v.sl_lod, ${maxLod})`;
  rc.geometry = `Array.geo[${idx}]`;
  const texs = Array.isArray(rc.textures) && rc.textures.length ? [...rc.textures] : ['Texture.default'];
  let ti = texs.findIndex((t) => t === 'Texture.default');
  if (ti < 0) ti = 0;
  texs[ti] = `Array.tex[${idx}]`;
  rc.textures = texs;
  if (hideLod != null) {
    const cond = `v.sl_lod < ${hideLod}`;
    const orig = (rc.part_visibility || []).map((e) =>
      Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === 'string' ? `(${v}) && ${cond}` : v === false ? false : cond]))
    );
    rc.part_visibility = [{ '*': cond }, ...orig];
  }
  return rc;
}

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

/**
 * Build the .mcpack.
 * @param {object[]} armors armor records from scanAddon (selected; identifiers must be unique)
 * @param {object} options
 * @param {object} options.settings global settings
 * @param {Record<string,object>} [options.overrides] per-armor setting overrides keyed by armor.key
 * @param {{headerUuid?:string, moduleUuid?:string, version?:number}} [options.packState] previous pack state
 * @param {(p:number, msg:string)=>void} [options.onProgress]
 * @returns {Promise<{bytes:Uint8Array, fileName:string, packState:object, report:object[], files:string[]}>}
 */
export async function buildPack(armors, options) {
  const global = normalizeSettings(options.settings);
  const prog = options.onProgress || (() => {});
  const seen = new Map();
  for (const a of armors) {
    if (seen.has(a.identifier)) throw Object.assign(new Error(`Duplicate identifier ${a.identifier}`), { code: 'DUPLICATE', identifier: a.identifier });
    seen.set(a.identifier, a);
  }
  const zip = new JSZip();
  const usedPaths = new Set();
  const rcBySlug = new Map();
  const report = [];
  let done = 0;
  for (const a of armors) {
    prog(done / armors.length, a.identifier);
    const s = settingsFor(global, options.overrides?.[a.key]);
    report.push(await buildArmor(zip, a, s, usedPaths, rcBySlug));
    done++;
  }
  for (const [slug, rcs] of rcBySlug) {
    zip.file(`render_controllers/sl_lod/${slug}.render_controllers.json`, toJson({ format_version: '1.8.0', render_controllers: rcs }));
  }
  const prev = options.packState || {};
  const packState = {
    headerUuid: prev.headerUuid || uuid(),
    moduleUuid: prev.moduleUuid || uuid(),
    version: (Number(prev.version) || 0) + 1,
  };
  zip.file('manifest.json', toJson(makeManifest(global, packState, armors.length)));
  zip.file('LICENSE.txt', LICENSE_TEXT);
  zip.file('pack_icon.png', packIconBytes());
  prog(0.98, 'zip');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  prog(1, 'done');
  const files = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  return { bytes, fileName: global.debug ? 'SleepyArmorLite_DEBUG.mcpack' : 'SleepyArmorLite.mcpack', packState, report, files };
}

export function makeManifest(s, packState, count) {
  const t = thresholds(s, false).join('/');
  const hide = s.hide.enabled ? `§7, hide §f${s.hide.distance}` : '';
  const v = [1, 0, packState.version];
  const description = [
    `§l§bSleepy§dArmor §fLite§r §7by §6Sleepy§eShop §8(SamSoSleepy)`,
    `§aLOD §f${t} §7blocks${hide} §8| §f${count} §7armor`,
    `§eFree & open source §7(GPL-3.0) §8- §7keep the SleepyShop credit; modified versions must stay GPL-3.0.`,
    `§7Armor models/textures belong to their original creators. Personal use; keep the original add-on installed and put this pack §fABOVE§7 it.`,
    ...(s.debug ? ['§c§lDEBUG§r§c: colours show LOD levels (1 blue, 2 red, 3 green, 4 yellow)'] : []),
  ].join('\n');
  return {
    format_version: 2,
    header: {
      name: `§l§bSleepy§dArmor §fLite§r §7- §e${count} §fArmor${s.debug ? ' §c[DEBUG]' : ''}`,
      description,
      uuid: packState.headerUuid,
      version: v,
      min_engine_version: [1, 21, 0],
    },
    modules: [{ type: 'resources', uuid: packState.moduleUuid, version: v }],
    metadata: { authors: ['SamSoSleepy'], license: 'GPL-3.0-only', url: 'https://github.com/samsosleepy2007/Minecraft-bedrock-client-for-roleplay' },
  };
}

async function buildArmor(zip, a, s, usedPaths, rcBySlug) {
  const att = structuredClone(a.attachable);
  const d = att['minecraft:attachable'].description;
  const maxLod = s.lodCount;
  const hideLod = s.hide.enabled ? maxLod + 1 : null;
  const physMax = s.physicsOffFrom - 1;
  const t = thresholds(s);
  const id = safeId(a.identifier);
  const info = { key: a.key, identifier: a.identifier, textures: [], cubes: [a.cubeCount], warnings: [...a.warnings] };

  // item condition (armor stand)
  if (s.armorStand) {
    if (d.item && typeof d.item === 'object' && Object.keys(d.item).length) {
      for (const k of Object.keys(d.item)) d.item[k] = withArmorStand(d.item[k]);
    } else d.item = { [a.identifier]: withArmorStand('') };
  }

  // scripts
  d.scripts = d.scripts || {};
  d.scripts.pre_animation = transformPreAnimation(d.scripts.pre_animation || [], t, physMax);
  if (d.scripts.animate) d.scripts.animate = transformAnimate(d.scripts.animate, physMax, t.length);

  // geometry LODs
  d.geometry = { ...(d.geometry || {}) };
  const baseGeo = d.geometry[a.geoKey];
  if (a.geoKey !== 'default' && baseGeo) d.geometry.default = baseGeo;
  let prevId = d.geometry.default;
  let prevDef = a.geometry?.def;
  for (let i = 1; i <= maxLod; i++) {
    const lv = s.levels[i];
    if (prevDef && (lv.minCubeSize > 0 || lv.dedupePlanes)) {
      const red = reduceGeometryDef(prevDef, lv);
      if (countCubes(red) < countCubes(prevDef)) {
        prevId = `geometry.sl_${a.slug}_${id}_lod${i}`;
        zip.file(`models/entity/sl_lod/${a.slug}/${id}_lod${i}.geo.json`, toJson(makeGeometryFile(prevId, red, a.geometry.format, a.geometry.key)));
        prevDef = red;
      }
    }
    d.geometry[`lod${i}`] = prevId;
    info.cubes.push(prevDef ? countCubes(prevDef) : 0);
  }

  // texture LODs
  d.textures = { ...(d.textures || {}) };
  const baseTex = d.textures[a.texKey];
  if (a.texKey !== 'default' && baseTex) d.textures.default = baseTex;
  const levels = textureLevels(s);
  const canTex = a.texture && a.texture.ext.toLowerCase() === '.png';
  let img = null;
  const alphaMode = /blend|translucent/i.test(a.material) ? 'blend' : 'test';
  const texName = (a.texRef || id).split('/').pop();
  for (let i = 1; i <= maxLod; i++) {
    const r = levels[i - 1];
    let ref = baseTex;
    if (r && canTex) {
      img = img || decodePng(await a.texture.file.async('uint8array'));
      let out = r === 1 ? img : downscale(img, r, { alphaMode });
      if (s.debug) out = tint(out, DEBUG_COLORS[i] || DEBUG_COLORS[DEBUG_COLORS.length - 1]);
      ref = `textures/sl_lod/${a.slug}/${texName}_lod${i}`;
      zip.file(`${ref}.png`, encodePng(out));
      info.textures.push(`${out.width}x${out.height}`);
    } else info.textures.push('original');
    d.textures[`lod${i}`] = ref;
  }

  // render controller
  const rcName = `controller.render.${id}_lod`;
  const rcs = d.render_controllers || [];
  const first = rcs[0];
  const firstName = typeof first === 'string' ? first : first ? Object.keys(first)[0] : null;
  const base = firstName ? a.controllerDefs?.[firstName] : null;
  if (firstName && !base && firstName !== 'controller.render.armor' && firstName !== 'controller.render.default') {
    info.warnings.push(`render controller ${firstName} not in pack; generated a default one`);
  }
  const rc = buildRenderController(base, { maxLod, hideLod, hasEnchanted: !!d.textures.enchanted });
  if (!rcBySlug.has(a.slug)) rcBySlug.set(a.slug, {});
  rcBySlug.get(a.slug)[rcName] = rc;
  const newEntry = typeof first === 'object' && first ? { [rcName]: Object.values(first)[0] } : rcName;
  d.render_controllers = [newEntry, ...rcs.slice(1)];

  // attachable file path: same as original so it overrides; separate on collision
  let path = a.attachablePath;
  if (usedPaths.has(path.toLowerCase())) path = `attachables/sl_lod/${a.slug}/${a.attachablePath.replace(/^attachables\//i, '')}`;
  usedPaths.add(path.toLowerCase());
  zip.file(path, toJson(att));
  info.path = path;
  return info;
}
