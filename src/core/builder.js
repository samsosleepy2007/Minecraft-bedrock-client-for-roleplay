/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import JSZip from 'jszip';
import { toJson } from './json.js';
import { transformPreAnimation, transformAnimate, lodLine, lodLineGraphics } from './molang.js';
import { reduceGeometryDef, makeGeometryFile, countCubes } from './geometry.js';
import { decodeImage, canDecode, flattenGlow, encodePng, downscale, tint, DEBUG_COLORS } from './texture.js';
import { normalizeSettings, settingsFor, thresholds, textureLevels, fancyProfile } from './settings.js';
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
  const squash = (x) => x.replace(/\bquery\./g, 'q.').replace(/\s+/g, '').replace(/"/g, "'");
  if (!c || squash(c) === squash(PLAYER)) return `${PLAYER} || ${STAND}`;
  return `(${c}) || ${STAND}`;
}

const safeId = (id) => id.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

/** Build the replacement render controller. */
export function buildRenderController(base, { maxLod, hideLod, visCond, glowSwitch, hasEnchanted }) {
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
  if (glowSwitch) {
    // per-level material: original glow material at level 0, plain material when reduced
    rc.arrays.materials = { ...(rc.arrays.materials || {}), 'Array.sl_mat': glowSwitch.list };
    const ref = `Material.${glowSwitch.key}`;
    rc.materials = (rc.materials || [{ '*': ref }]).map((e) =>
      Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v === ref ? `Array.sl_mat[${idx}]` : v]))
    );
  }
  const cond = visCond || (hideLod != null ? `v.sl_lod < ${hideLod}` : null);
  if (cond) {
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
  // pieces of a set (head/chest/legs/feet) often share one texture + geometry: generate their LOD files once
  const shared = { files: new Map(), names: new Set(), images: new Map() };
  const report = [];
  let done = 0;
  for (const a of armors) {
    prog(done / armors.length, a.identifier);
    const s = settingsFor(global, options.overrides?.[a.key]);
    report.push(await buildArmor(zip, a, s, usedPaths, rcBySlug, shared));
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
  zip.file('manifest.json', toJson(makeManifest(global, packState, countSets(armors))));
  zip.file('LICENSE.txt', LICENSE_TEXT);
  zip.file('pack_icon.png', packIconBytes());
  prog(0.98, 'zip');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  prog(1, 'done');
  const files = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  return { bytes, fileName: global.debug ? 'SleepyArmorLite_DEBUG.mcpack' : 'SleepyArmorLite.mcpack', packState, report, files };
}

/** Number of armor sets: pieces sharing one geometry + texture count once. */
export function countSets(armors) {
  return new Set(armors.map((a) => (a.geometry || a.texture ? `${a.slug}|${a.geometry?.id}|${a.texture?.path}` : a.key))).size;
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
    ...(s.gate === 'graphics'
      ? [`§bSimple graphics§7: LOD above · §bFancy§7: ${s.fancy.lodCount ? `LOD §f${thresholds(fancyProfile(s), false).join('/')}§7 blocks${s.fancy.hide.enabled ? `, hide §f${s.fancy.hide.distance}` : ''}` : '§ffull quality'}`]
      : []),
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

/** Unique file/identifier name for a cache key (adds _2, _3 … when the base name is taken by another key). */
function sharedName(shared, key, base) {
  if (shared.files.has(key)) return { name: shared.files.get(key), fresh: false };
  let name = base;
  for (let n = 2; shared.names.has(name); n++) name = `${base}_${n}`;
  shared.names.add(name);
  shared.files.set(key, name);
  return { name, fresh: true };
}

async function buildArmor(zip, a, s, usedPaths, rcBySlug, shared) {
  const att = structuredClone(a.attachable);
  const d = att['minecraft:attachable'].description;
  // Profiles: main (everyone / Simple graphics) and, in graphics mode, Fancy.
  // Array index: 0 = original, 1..Ns = main levels, Ns+1..Ns+Nf = Fancy levels.
  const graphics = s.gate === 'graphics';
  const profiles = [{ p: s, offset: 0 }];
  if (graphics) profiles.push({ p: fancyProfile(s), offset: s.lodCount });
  const maxLod = profiles.reduce((m, x) => m + x.p.lodCount, 0);
  const pinfo = profiles.map(({ p }) => ({ n: p.lodCount, thresholds: thresholds(p), hide: p.hide.enabled, physMax: p.physicsOffFrom - 1 }));
  let lodStmt, physCond, visCond;
  if (graphics) {
    lodStmt = lodLineGraphics(pinfo[0], pinfo[1]);
    physCond = pinfo.some((x) => x.physMax < x.thresholds.length) ? 'v.sl_phys > 0' : null;
    visCond = pinfo.some((x) => x.hide) ? 'v.sl_vis > 0' : null;
  } else {
    const [m] = pinfo;
    lodStmt = lodLine(m.thresholds);
    physCond = m.physMax >= m.thresholds.length ? null : `v.sl_lod <= ${m.physMax}`;
    visCond = m.hide ? `v.sl_lod < ${m.n + 1}` : null;
  }
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
  d.scripts.pre_animation = transformPreAnimation(d.scripts.pre_animation || [], lodStmt, physCond);
  if (d.scripts.animate) d.scripts.animate = transformAnimate(d.scripts.animate, physCond);

  // geometry LODs
  d.geometry = { ...(d.geometry || {}) };
  const baseGeo = d.geometry[a.geoKey];
  if (a.geoKey !== 'default' && baseGeo) d.geometry.default = baseGeo;
  const geoBase = safeId(String(baseGeo || id).replace(/^geometry\./, ''));
  for (const { p, offset } of profiles) {
  let prevId = d.geometry.default;
  let prevDef = a.geometry?.def;
  let chain = '';
  for (let i = 1; i <= p.lodCount; i++) {
    const lv = p.levels[i];
    if (prevDef && (lv.minCubeSize > 0 || lv.dedupePlanes)) {
      const red = reduceGeometryDef(prevDef, lv);
      if (countCubes(red) < countCubes(prevDef)) {
        chain += `|${lv.minCubeSize},${lv.dedupePlanes}`;
        const { name, fresh } = sharedName(shared, `geo|${a.slug}|${a.pack?.root}|${baseGeo}${chain}`, `geometry.sl_${a.slug}_${geoBase}_lod${i}`);
        if (fresh) zip.file(`models/entity/sl_lod/${a.slug}/${name.replace(/^geometry\.sl_/, '')}.geo.json`, toJson(makeGeometryFile(name, red, a.geometry.format, a.geometry.key)));
        prevId = name;
        prevDef = red;
      }
    }
    d.geometry[`lod${offset + i}`] = prevId;
    info.cubes.push(prevDef ? countCubes(prevDef) : 0);
  }
  }

  // texture LODs
  d.textures = { ...(d.textures || {}) };
  const baseTex = d.textures[a.texKey];
  if (a.texKey !== 'default' && baseTex) d.textures.default = baseTex;
  const canTex = a.texture && canDecode(a.texture.path);
  let img = null;
  // Glow: reduced levels can drop the glow (material → alpha-test, glow pixels made solid)
  const glowFlat = !!(a.glow && s.glowOff && canTex && s.memoryMode !== 'none');
  const glowCutout = !!a.glow && /alpha/i.test(a.glow.material);
  const flatIdx = new Set();
  const alphaMode = glowFlat ? 'test' : a.glow ? 'emissive' : /blend|translucent/i.test(a.material) ? 'blend' : 'test';
  const texName = (a.texRef || id).split('/').pop();
  const texKey = `${a.slug}|${a.pack?.root}|${a.texture?.path}`;
  for (const { p, offset } of profiles) {
  const levels = textureLevels(p);
  for (let i = 1; i <= p.lodCount; i++) {
    let r = levels[i - 1];
    if (glowFlat && !r) r = 1; // need our own (solid) copy to switch off the glow
    let ref = baseTex;
    if (r && canTex) {
      const tag = `${r * 1000}${s.debug ? `_d${i}` : ''}${glowFlat ? '_flat' : ''}`;
      if (glowFlat) flatIdx.add(offset + i);
      const { name, fresh } = sharedName(shared, `tex|${texKey}|${tag}|${alphaMode}`, `textures/sl_lod/${a.slug}/${texName}_lod${i}`);
      ref = name;
      if (fresh) {
        img = img || shared.images.get(texKey) || decodeImage(await a.texture.file.async('uint8array'), a.texture.path);
        shared.images.set(texKey, img);
        const src = glowFlat ? flattenGlow(img, glowCutout) : img;
        let out = r === 1 ? src : downscale(src, r, { alphaMode });
        if (s.debug) out = tint(out, DEBUG_COLORS[i] || DEBUG_COLORS[DEBUG_COLORS.length - 1]);
        zip.file(`${ref}.png`, encodePng(out));
      }
      const w = Math.max(1, Math.round((a.texW || 0) * r)), h = Math.max(1, Math.round((a.texH || 0) * r));
      info.textures.push(a.texW ? `${w}x${h}${fresh ? '' : ' (shared)'}` : 'generated');
    } else info.textures.push('original');
    d.textures[`lod${offset + i}`] = ref;
  }
  }

  // Self-contained: copy the original geometry, texture and animation files at their original paths.
  // Then the pack works even when the original add-on is lower in the stack or only in a world
  // (no "geometry not found"); identical paths/ids mean no extra memory when both are loaded.
  if (a.pack?.local) {
    // geometry/animations are found by identifier → own folder per add-on (no path clashes);
    // the texture is referenced by path → same path as the original
    const copy = async (rel, out) => {
      if (!rel || !a.pack.local.has(rel)) return;
      const key = `${a.slug}|${a.pack.root}|${rel}`;
      if ((shared.copied ||= new Set()).has(key)) return;
      shared.copied.add(key);
      zip.file(out, await a.pack.local.get(rel).async('uint8array'));
    };
    const sub = (rel) => rel.replace(/^[^/]+\//, '');
    if (a.geometry?.file) await copy(a.geometry.file, `models/entity/sl_lod/${a.slug}/original/${sub(a.geometry.file)}`);
    if (a.texture?.path) {
      await copy(a.texture.path, a.texture.path);
      const setPath = a.texture.path.replace(/\.[^./]+$/, '') + '.texture_set.json';
      if (a.pack.local.has(setPath)) {
        await copy(setPath, setPath);
        try {
          const ts = JSON.parse(await a.pack.local.get(setPath).async('string'))['minecraft:texture_set'] || {};
          const dir = setPath.slice(0, setPath.lastIndexOf('/') + 1);
          for (const v of Object.values(ts)) {
            if (typeof v !== 'string') continue;
            for (const ext of ['.png', '.tga']) if (a.pack.local.has(dir + v + ext)) await copy(dir + v + ext, dir + v + ext);
          }
        } catch {
          /* ignore */
        }
      }
    }
    for (const animId of Object.values(d.animations || {})) {
      const f = a.pack.animations?.get(animId);
      if (f) await copy(f, `animations/sl_lod/${a.slug}/${sub(f)}`);
    }
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
  let glowSwitch = null;
  if (flatIdx.size) {
    d.materials = { ...(d.materials || {}), sl_flat: glowCutout ? 'entity_alphatest' : 'entity' };
    glowSwitch = { key: a.glow.key, list: Array.from({ length: maxLod + 1 }, (_, i) => (flatIdx.has(i) ? 'Material.sl_flat' : `Material.${a.glow.key}`)) };
    info.glow = 'off when reduced';
  }
  const rc = buildRenderController(base, { maxLod, visCond, glowSwitch, hasEnchanted: !!d.textures.enchanted });
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
