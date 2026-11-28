/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  parseBedrockJson, transformPreAnimation, transformAnimate, bracesBalanced, lodLine,
  reduceGeometryDef, countCubes, downscale, decodePng, pngSize, scanAddon, findDuplicates,
  buildPack, normalizeSettings, slugify, gateExpr, PRESETS, estimateExtraMB, textureLevels, withArmorStand, validateSettings,
} from '../src/core/index.js';
import { makeSampleAddon, makeDuplicateAddon, makeNoArmorAddon, makeTexture, HAIR_GEO } from './fixtures/sampleAddon.js';

const settings = (over = {}) => normalizeSettings({
  lodCount: 3,
  levels: [
    { distance: 8, resolution: 1 },
    { distance: 16, resolution: 0.5, minCubeSize: 1, dedupePlanes: true },
    { distance: 32, resolution: 0.25, minCubeSize: 1, dedupePlanes: true },
    { distance: 48, resolution: 0.125, minCubeSize: 2, dedupePlanes: true },
  ],
  physicsOffFrom: 1,
  hide: { enabled: true, distance: 64 },
  memoryMode: 'full',
  ...over,
});

describe('parseBedrockJson', () => {
  it('handles comments, trailing commas and // inside strings', () => {
    const j = parseBedrockJson('{ // c\n "a": "http://x", /* b */ "b": [1,2,], }');
    expect(j).toEqual({ a: 'http://x', b: [1, 2] });
  });
  it('handles escaped quotes', () => {
    expect(parseBedrockJson('{"a":"q\\"//x",}')).toEqual({ a: 'q"//x' });
  });
});

describe('pre_animation transform', () => {
  const src = [
    '(v.sl_init ?? 0) == 0 ? { v.sl_init = 1; v.hair_x = 0; };',
    'v.t = math.clamp(q.modified_move_speed * 40, 0, 60);',
    'v.hair_x = v.hair_x + 1',
  ];
  it('keeps init line first, adds LOD line, wraps the rest', () => {
    const out = transformPreAnimation(src, [8, 16, 32], 0);
    expect(out[0]).toBe(src[0]);
    expect(out[1]).toBe('v.sl_d = q.distance_from_camera; v.sl_lod = v.sl_d < 8.0 ? 0 : ((v.sl_d < 16.0 ? 1 : ((v.sl_d < 32.0 ? 2 : (3)))));');
    expect(out[2]).toBe('v.sl_lod <= 0 ? { v.t = math.clamp(q.modified_move_speed * 40, 0, 60); v.hair_x = v.hair_x + 1; };');
    expect(out).toHaveLength(3);
    out.forEach((l) => expect(bracesBalanced(l)).toBe(true));
  });
  it('works without init line', () => {
    const out = transformPreAnimation(src.slice(1), [8], 0);
    expect(out[0]).toMatch(/^v\.sl_d = q\.distance_from_camera;/);
    expect(out[1]).toMatch(/^v\.sl_lod <= 0 \? \{/);
  });
  it('lodLine yields level count', () => {
    expect(lodLine([8])).toBe('v.sl_d = q.distance_from_camera; v.sl_lod = v.sl_d < 8.0 ? 0 : (1);');
  });
  it('viewer gate wraps the LOD expression', () => {
    const l = lodLine([8], gateExpr('graphics'));
    expect(l).toBe("v.sl_d = q.distance_from_camera; v.sl_lod = v.sl_d < 8.0 ? 0 : (1); v.sl_lod = v.sl_lod * (q.graphics_mode_is_any('simple'));");
    expect(gateExpr('all')).toBe(null);
    expect(normalizeSettings({ gate: 'render' }).gate).toBe('all');
    expect(bracesBalanced(l)).toBe(true);
  });
  it('bracesBalanced detects problems', () => {
    expect(bracesBalanced('a ? { b; };')).toBe(true);
    expect(bracesBalanced('a ? { b;')).toBe(false);
    expect(bracesBalanced("v.s = '{';")).toBe(true);
  });
  it('animate becomes conditional; existing conditions are ANDed', () => {
    expect(transformAnimate(['a', { b: 'q.x' }], 1, 3)).toEqual([{ a: 'v.sl_lod <= 1' }, { b: '(q.x) && v.sl_lod <= 1' }]);
  });
});

describe('armor stand condition', () => {
  it('player-only → exact spec string', () => {
    expect(withArmorStand("query.owner_identifier == 'minecraft:player'")).toBe("q.owner_identifier == 'minecraft:player' || q.owner_identifier == 'minecraft:armor_stand'");
  });
  it('player check without spaces is recognised', () => {
    expect(withArmorStand("query.owner_identifier=='minecraft:player'")).toBe("q.owner_identifier == 'minecraft:player' || q.owner_identifier == 'minecraft:armor_stand'");
  });
  it('addon slug is a safe identifier part', () => {
    expect(slugify('30b2001d-furaychi_1.0.8_Updated Base.mcaddon')).toBe('30b2001d_furaychi_1_0_8_updated_base');
  });
  it('keeps other conditions via OR', () => {
    expect(withArmorStand('q.is_baby')).toBe("(q.is_baby) || q.owner_identifier == 'minecraft:armor_stand'");
  });
});

describe('geometry', () => {
  const def = HAIR_GEO['minecraft:geometry'][0];
  it('dedupe planes keeps 1 layer per bone, keeps all bones', () => {
    const r = reduceGeometryDef(def, { dedupePlanes: true });
    expect(r.bones.map((b) => b.name)).toEqual(def.bones.map((b) => b.name));
    expect(r.bones.find((b) => b.name === 'hair_back').cubes).toHaveLength(1);
    expect(r.bones.find((b) => b.name === 'hair_side').cubes).toHaveLength(2);
    expect(countCubes(r)).toBe(countCubes(def) - 2);
  });
  it('dedupe matches a slightly wider second layer and keeps the front-most one', () => {
    const d = { bones: [{ name: 'h', cubes: [
      { origin: [-6, 23.25, 4.2], size: [12, 0.75, 0], uv: { south: { uv: [18, 46], uv_size: [12, 0.75] } } },
      { origin: [-6.6, 23.25, 3.8], size: [13, 0.75, 0], uv: { south: { uv: [51, 41], uv_size: [13, 0.75] } } },
    ] }] };
    const r = reduceGeometryDef(d, { dedupePlanes: true });
    expect(r.bones[0].cubes).toHaveLength(1);
    expect(r.bones[0].cubes[0].size[0]).toBe(13); // z 3.8 is in front of z 4.2
  });
  it('min cube size removes tiny cubes; uv untouched', () => {
    const r = reduceGeometryDef(def, { minCubeSize: 1, dedupePlanes: true });
    expect(countCubes(def)).toBe(7);
    expect(countCubes(r)).toBe(3);
    expect(r.bones.find((b) => b.name === 'armorHead').cubes[0].uv).toEqual([0, 0]);
  });
});

describe('texture', () => {
  it('downscale halves size and thresholds alpha', () => {
    const img = decodePng(makeTexture(512));
    const small = downscale(img, 0.25);
    expect([small.width, small.height]).toEqual([128, 128]);
    const alphas = new Set();
    for (let i = 3; i < small.data.length; i += 4) alphas.add(small.data[i]);
    expect([...alphas].every((a) => a === 0 || a === 255)).toBe(true);
    const blend = downscale(img, 0.5, { alphaMode: 'blend' });
    const ba = new Set();
    for (let i = 3; i < blend.data.length; i += 4) ba.add(blend.data[i]);
    expect([...ba].some((a) => a !== 0 && a !== 255)).toBe(true);
  });
  it('pngSize reads header', () => {
    expect(pngSize(makeTexture(64))).toEqual({ width: 64, height: 64 });
  });
});

describe('settings', () => {
  it('presets normalise and validate', () => {
    for (const p of Object.values(PRESETS)) expect(validateSettings(normalizeSettings(p))).toEqual([]);
  });
  it('saver preset reduces every level like the design (25% → 12.5% → 12.5%)', () => {
    expect(textureLevels(normalizeSettings(PRESETS.saver))).toEqual([0.25, 0.125, 0.125]);
  });
  it('detects bad distance order', () => {
    const s = settings({ levels: [{ distance: 20 }, { distance: 10 }] });
    expect(validateSettings(s).length).toBeGreaterThan(0);
  });
  it('memory modes', () => {
    expect(textureLevels(settings())).toEqual([0.5, 0.25, 0.125]);
    expect(textureLevels(settings({ memoryMode: 'minimal' }))).toEqual([null, null, 0.125]);
    expect(textureLevels(settings({ memoryMode: 'none' }))).toEqual([null, null, null]);
    const mb = estimateExtraMB([{ texW: 512, texH: 512 }], settings());
    expect(mb).toBeGreaterThan(0.4);
    expect(estimateExtraMB([{ texW: 512, texH: 512 }], settings({ memoryMode: 'none' }))).toBe(0);
  });
});

describe('scan + build (fixture)', () => {
  it('scans armors and skips files without armor', async () => {
    const a = await scanAddon('Sleepy Sample.mcaddon', await makeSampleAddon());
    expect(a.armors.map((x) => x.identifier).sort()).toEqual(['sleepy:hair_helmet', 'sleepy:plate_chest']);
    const hair = a.armors.find((x) => x.identifier === 'sleepy:hair_helmet');
    expect([hair.texW, hair.texH, hair.cubeCount, hair.molangLines]).toEqual([512, 512, 7, 4]);
    const none = await scanAddon('bp.mcaddon', await makeNoArmorAddon());
    expect(none.armors).toHaveLength(0);
  });

  it('detects duplicate identifiers across addons (nested .mcpack)', async () => {
    const a = await scanAddon('A.mcaddon', await makeSampleAddon());
    const b = await scanAddon('B.mcaddon', await makeDuplicateAddon());
    const d = findDuplicates([...a.armors, ...b.armors]);
    expect(d).toHaveLength(1);
    expect(d[0].identifier).toBe('sleepy:hair_helmet');
    await expect(buildPack([...a.armors, ...b.armors], { settings: settings() })).rejects.toMatchObject({ code: 'DUPLICATE' });
  });

  it('builds a valid pack', async () => {
    const a = await scanAddon('Sleepy Sample.mcaddon', await makeSampleAddon());
    const res = await buildPack(a.armors, { settings: settings() });
    expect(res.fileName).toBe('SleepyArmorLite.mcpack');
    const z = await JSZip.loadAsync(res.bytes);
    const names = Object.keys(z.files).filter((n) => !z.files[n].dir);
    // every JSON file is strictly valid JSON
    for (const n of names.filter((n) => n.endsWith('.json'))) JSON.parse(await z.file(n).async('string'));
    expect(names).toContain('LICENSE.txt');
    expect(await z.file('LICENSE.txt').async('string')).toMatch(/GNU GENERAL PUBLIC LICENSE/);

    const m = JSON.parse(await z.file('manifest.json').async('string'));
    expect(m.header.min_engine_version).toEqual([1, 21, 0]);
    expect(m.metadata.authors).toEqual(['SamSoSleepy']);
    expect(m.header.description).toMatch(/SleepyShop/);
    expect(m.header.description).toMatch(/GPL-3\.0/);
    expect(m.header.name.replace(/§./g, '')).toBe('SleepyArmor Lite - 2 Armor');
    expect(pngSize(await z.file('pack_icon.png').async('uint8array'))).toEqual({ width: 64, height: 64 });
    expect(m.header.description).toMatch(/8\/16\/32/);
    expect(m.header.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.header.uuid).not.toBe(m.modules[0].uuid);
    expect(m.modules[0].type).toBe('resources');

    const att = JSON.parse(await z.file('attachables/sleepy_hair_helmet.json').async('string'))['minecraft:attachable'].description;
    expect(att.identifier).toBe('sleepy:hair_helmet');
    expect(att.item['sleepy:hair_helmet']).toBe("q.owner_identifier == 'minecraft:player' || q.owner_identifier == 'minecraft:armor_stand'");
    const pre = att.scripts.pre_animation;
    expect(pre[0]).toMatch(/^\(v\.sl_init \?\? 0\) == 0 \? \{/);
    expect(pre[1]).toMatch(/v\.sl_d < 64\.0 \? 3 : \(4\)/);
    expect(pre[2]).toMatch(/^v\.sl_lod <= 0 \? \{ .* \};$/);
    pre.forEach((l) => expect(bracesBalanced(l)).toBe(true));
    expect(att.scripts.animate).toEqual([{ hair_physics: 'v.sl_lod <= 0' }, { idle_sway: '(q.is_on_ground) && v.sl_lod <= 0' }]);
    expect(Object.keys(att.textures)).toEqual(['default', 'enchanted', 'lod1', 'lod2', 'lod3']);
    expect(att.geometry.lod1).toMatch(/^geometry\.sl_/);
    expect(att.render_controllers).toEqual(['controller.render.sleepy_hair_helmet_lod']);

    // textures exist with expected sizes
    for (const [i, size] of [[1, 256], [2, 128], [3, 64]]) {
      const f = z.file(att.textures[`lod${i}`] + '.png');
      expect(pngSize(await f.async('uint8array'))).toEqual({ width: size, height: size });
    }
    expect(att.textures.lod1).toMatch(/^textures\/sl_lod\/sleepy_sample\//);

    // geometry cube counts drop
    const g1 = JSON.parse(await z.file('models/entity/sl_lod/sleepy_sample/sleepy_sample_sleepy_hair_lod1.geo.json').async('string'));
    expect(g1['minecraft:geometry'][0].description.identifier).toBe(att.geometry.lod1);
    expect(countCubes(g1['minecraft:geometry'][0])).toBe(5); // tiny cubes removed (plane dedupe is off)
    expect(g1['minecraft:geometry'][0].bones).toHaveLength(5);

    // render controller
    const rcf = JSON.parse(await z.file('render_controllers/sl_lod/sleepy_sample.render_controllers.json').async('string'));
    const rc = rcf.render_controllers['controller.render.sleepy_hair_helmet_lod'];
    expect(rc.geometry).toBe('Array.geo[math.min(v.sl_lod, 3)]');
    expect(rc.textures).toEqual(['Array.tex[math.min(v.sl_lod, 3)]', 'Texture.enchanted']);
    expect(rc.arrays.textures['Array.tex']).toEqual(['Texture.default', 'Texture.lod1', 'Texture.lod2', 'Texture.lod3']);
    expect(rc.part_visibility).toEqual([{ '*': 'v.sl_lod < 4' }, { ribbon: '(q.is_sneaking) && v.sl_lod < 4' }]);
    expect(rc.materials).toEqual([{ '*': 'Material.default' }]);

    // vanilla-controller armor gets a generated controller; no animate added
    const chest = JSON.parse(await z.file('attachables/plate_chest.json').async('string'))['minecraft:attachable'].description;
    expect(chest.render_controllers).toEqual(['controller.render.sleepy_plate_chest_lod']);
    expect(chest.item).toEqual({ 'sleepy:plate_chest': "q.owner_identifier == 'minecraft:player' || q.owner_identifier == 'minecraft:armor_stand'" });
    expect(chest.scripts.pre_animation).toHaveLength(1);
    expect(chest.scripts.parent_setup).toBe('v.chest_layer_visible = 0.0;');
  });

  it('pieces sharing texture + geometry share LOD files; name counts sets', async () => {
    const a = await scanAddon('S.mcaddon', await makeSampleAddon());
    const hair = a.armors.find((x) => x.identifier === 'sleepy:hair_helmet');
    const twin = { ...hair, identifier: 'sleepy:hair_chest', key: 's::sleepy:hair_chest', attachablePath: 'attachables/hair_chest.json' };
    const res = await buildPack([hair, twin], { settings: settings() });
    const pngs = res.files.filter((f) => f.startsWith('textures/sl_lod/'));
    const geos = res.files.filter((f) => f.startsWith('models/entity/sl_lod/') && !f.includes('/original/'));
    expect(pngs).toHaveLength(3); // one per LOD level, not per piece
    expect(geos).toHaveLength(1);
    const z = await JSZip.loadAsync(res.bytes);
    const t1 = JSON.parse(await z.file('attachables/sleepy_hair_helmet.json').async('string'))['minecraft:attachable'].description;
    const t2 = JSON.parse(await z.file('attachables/hair_chest.json').async('string'))['minecraft:attachable'].description;
    expect(t2.textures).toEqual(t1.textures);
    expect(t2.geometry).toEqual(t1.geometry);
    const m = JSON.parse(await z.file('manifest.json').async('string'));
    expect(m.header.name.replace(/§./g, '')).toBe('SleepyArmor Lite - 1 Armor');
  });

  it('graphics mode: separate Simple / Fancy profiles (Fancy 0 = always full)', async () => {
    const a = await scanAddon('S.mcaddon', await makeSampleAddon());
    const res = await buildPack(a.armors, { settings: settings({ gate: 'graphics', fancy: { lodCount: 1, levels: [{ distance: 16 }, { distance: 48, resolution: 0.5 }], hide: { enabled: false } } }) });
    const z = await JSZip.loadAsync(res.bytes);
    const att = JSON.parse(await z.file('attachables/sleepy_hair_helmet.json').async('string'))['minecraft:attachable'].description;
    const pre = att.scripts.pre_animation;
    expect(pre[1]).toContain("v.sl_g = q.graphics_mode_is_any('simple');");
    expect(pre[1]).toContain('v.sl_lod = v.sl_g * math.min(v.sl_ls, 3) + (1 - v.sl_g) * (math.min(v.sl_lf, 1) + 3 * (v.sl_lf > 0));');
    expect(pre[1]).toContain('v.sl_vis = v.sl_g * (v.sl_ls < 4) + (1 - v.sl_g) * 1;');
    expect(pre[1]).not.toMatch(/\? \(v\.sl_d/); // no ternary nested in a true-branch
    expect(pre[2]).toMatch(/^v\.sl_phys > 0 \? \{/);
    expect(Object.keys(att.textures)).toEqual(['default', 'enchanted', 'lod1', 'lod2', 'lod3', 'lod4']);
    expect(pngSize(await z.file(att.textures.lod4 + '.png').async('uint8array'))).toEqual({ width: 256, height: 256 });
    const rc = JSON.parse(await z.file('render_controllers/sl_lod/s.render_controllers.json').async('string')).render_controllers['controller.render.sleepy_hair_helmet_lod'];
    expect(rc.geometry).toBe('Array.geo[math.min(v.sl_lod, 4)]');
    expect(rc.part_visibility[0]).toEqual({ '*': 'v.sl_vis > 0' });
    pre.forEach((l) => expect(bracesBalanced(l)).toBe(true));
    // Fancy with 0 levels: index stays 0
    const res0 = await buildPack(a.armors, { settings: settings({ gate: 'graphics' }) });
    const att0 = JSON.parse(await (await JSZip.loadAsync(res0.bytes)).file('attachables/sleepy_hair_helmet.json').async('string'))['minecraft:attachable'].description;
    expect(att0.scripts.pre_animation[1]).toContain('v.sl_lf = 0;');
    expect(Object.keys(att0.textures)).toEqual(['default', 'enchanted', 'lod1', 'lod2', 'lod3']);
  });

  it('pack state: keeps UUID and bumps version on rebuild; debug name', async () => {
    const a = await scanAddon('S.mcaddon', await makeSampleAddon());
    const r1 = await buildPack(a.armors, { settings: settings() });
    const r2 = await buildPack(a.armors, { settings: settings({ debug: true }), packState: r1.packState });
    expect(r2.packState.headerUuid).toBe(r1.packState.headerUuid);
    expect(r2.packState.version).toBe(r1.packState.version + 1);
    expect(r2.fileName).toBe('SleepyArmorLite_DEBUG.mcpack');
    const m = JSON.parse(await (await JSZip.loadAsync(r2.bytes)).file('manifest.json').async('string'));
    expect(m.header.version).toEqual([1, 0, 2]);
  });

  it('memory mode none: no texture files; per-armor override works', async () => {
    const a = await scanAddon('S.mcaddon', await makeSampleAddon());
    const hair = a.armors.find((x) => x.identifier === 'sleepy:hair_helmet');
    const res = await buildPack(a.armors, { settings: settings({ memoryMode: 'none' }), overrides: { [hair.key]: { lodCount: 1, hide: { enabled: false } } } });
    expect(res.files.filter((f) => f.startsWith('textures/sl_lod/'))).toEqual([]);
    // self-contained: original geometry + textures copied at their original paths
    expect(res.files).toEqual(expect.arrayContaining(['models/entity/sl_lod/s/original/entity/hair.geo.json', 'models/entity/sl_lod/s/original/entity/chest.geo.json', 'textures/models/armor/hair.png', 'textures/models/armor/plate.png']));
    const z = await JSZip.loadAsync(res.bytes);
    const att = JSON.parse(await z.file('attachables/sleepy_hair_helmet.json').async('string'))['minecraft:attachable'].description;
    expect(att.textures.lod1).toBe(att.textures.default);
    expect(att.scripts.pre_animation[1]).toBe('v.sl_d = q.distance_from_camera; v.sl_lod = v.sl_d < 8.0 ? 0 : (1);');
    const rcf = JSON.parse(await z.file('render_controllers/sl_lod/s.render_controllers.json').async('string'));
    expect(rcf.render_controllers['controller.render.sleepy_hair_helmet_lod'].part_visibility).toEqual([{ ribbon: 'q.is_sneaking' }]);
  });
});
