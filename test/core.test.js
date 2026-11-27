/*! SleepyArmor Lite — Copyright (c) 2026 SamSoSleepy (SleepyShop). All rights reserved.
 * Proprietary. Unauthorized use: 5,000 THB fine + blacklist until paid. See LICENSE.txt. */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  parseBedrockJson, transformPreAnimation, transformAnimate, bracesBalanced, lodLine,
  reduceGeometryDef, countCubes, downscale, decodePng, pngSize, scanAddon, findDuplicates,
  buildPack, normalizeSettings, PRESETS, estimateExtraMB, textureLevels, withArmorStand, validateSettings,
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
    expect(await z.file('LICENSE.txt').async('string')).toMatch(/5,000/);

    const m = JSON.parse(await z.file('manifest.json').async('string'));
    expect(m.header.min_engine_version).toEqual([1, 21, 0]);
    expect(m.metadata.authors).toEqual(['SamSoSleepy']);
    expect(m.header.description).toMatch(/By SamSoSleepy/);
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
    const g1 = JSON.parse(await z.file('models/entity/sl_lod/sleepy_sample/sleepy_hair_helmet_lod1.geo.json').async('string'));
    expect(g1['minecraft:geometry'][0].description.identifier).toBe(att.geometry.lod1);
    expect(countCubes(g1['minecraft:geometry'][0])).toBe(3);
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
    expect(res.files.some((f) => f.endsWith('.png'))).toBe(false);
    const z = await JSZip.loadAsync(res.bytes);
    const att = JSON.parse(await z.file('attachables/sleepy_hair_helmet.json').async('string'))['minecraft:attachable'].description;
    expect(att.textures.lod1).toBe(att.textures.default);
    expect(att.scripts.pre_animation[1]).toBe('v.sl_d = q.distance_from_camera; v.sl_lod = v.sl_d < 8.0 ? 0 : (1);');
    const rcf = JSON.parse(await z.file('render_controllers/sl_lod/s.render_controllers.json').async('string'));
    expect(rcf.render_controllers['controller.render.sleepy_hair_helmet_lod'].part_visibility).toEqual([{ ribbon: 'q.is_sneaking' }]);
  });
});
