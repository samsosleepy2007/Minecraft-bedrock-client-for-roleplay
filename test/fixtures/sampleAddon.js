/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
// Test fixture: a tiny self-made armor addon (NOT a real third-party addon).
import JSZip from 'jszip';
import { encode } from 'fast-png';

export function makeTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = (x * 255) / size;
      data[i + 1] = (y * 255) / size;
      data[i + 2] = 128;
      // left half opaque, right half: semi-transparent checker
      data[i + 3] = x < size / 2 ? 255 : ((x >> 3) + (y >> 3)) % 2 ? 200 : 40;
    }
  }
  return encode({ width: size, height: size, data, channels: 4, depth: 8 });
}

const plane = (origin, size, uv, inflate) => ({ origin, size, uv, ...(inflate ? { inflate } : {}) });

export const HAIR_GEO = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.sleepy.hair', texture_width: 128, texture_height: 128 },
      bones: [
        { name: 'root', pivot: [0, 24, 0] },
        { name: 'armorHead', parent: 'root', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0.5 }] },
        {
          name: 'hair_back',
          parent: 'armorHead',
          pivot: [0, 31, 4],
          cubes: [plane([-4, 16, 4], [8, 16, 0], [0, 32]), plane([-4, 16, 4.5], [8, 16, 0], [16, 32])],
        },
        {
          name: 'hair_side',
          parent: 'armorHead',
          pivot: [4, 31, 0],
          cubes: [plane([4, 20, -4], [0, 12, 8], [32, 32]), plane([4.4, 20, -4], [0, 12, 8], [48, 32]), { origin: [4, 30, 0], size: [0.5, 0.5, 0.5], uv: [64, 0] }],
        },
        { name: 'ribbon', parent: 'armorHead', pivot: [0, 32, 0], cubes: [{ origin: [-1, 32, -1], size: [0.4, 0.8, 0.4], uv: [70, 0] }] },
      ],
    },
  ],
};

const CHEST_GEO_LEGACY = {
  format_version: '1.8.0',
  'geometry.sleepy.chest': {
    texturewidth: 64,
    textureheight: 64,
    bones: [{ name: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], inflate: 1 }] }],
  },
};

const HAIR_ATTACHABLE = `{
  // Bedrock files often have comments
  "format_version": "1.10.0",
  "minecraft:attachable": {
    "description": {
      "identifier": "sleepy:hair_helmet",
      "item": { "sleepy:hair_helmet": "query.owner_identifier == 'minecraft:player'" },
      "materials": { "default": "entity_alphatest", "enchanted": "armor_enchanted" },
      "textures": {
        "default": "textures/models/armor/hair",
        "enchanted": "textures/misc/enchanted_item_glint", /* trailing comma next */
      },
      "geometry": { "default": "geometry.sleepy.hair" },
      "scripts": {
        "pre_animation": [
          "(v.sl_init ?? 0) == 0 ? { v.sl_init = 1; v.hair_x = 0; v.hair_v = 0; };",
          "v.target = math.clamp(q.modified_move_speed * 40, 0, 60);",
          "v.hair_v = (v.hair_v + (v.target - v.hair_x) * 0.2) * 0.8;",
          "v.hair_x = v.hair_x + v.hair_v;"
        ],
        "animate": ["hair_physics", { "idle_sway": "q.is_on_ground" }],
        "parent_setup": "v.helmet_layer_visible = 0.0;"
      },
      "animations": {
        "hair_physics": "animation.sleepy.hair.physics",
        "idle_sway": "animation.sleepy.hair.sway"
      },
      "render_controllers": ["controller.render.sleepy_hair"],
    }
  }
}`;

const CHEST_ATTACHABLE = {
  format_version: '1.10.0',
  'minecraft:attachable': {
    description: {
      identifier: 'sleepy:plate_chest',
      materials: { default: 'armor', enchanted: 'armor_enchanted' },
      textures: { default: 'textures/models/armor/plate', enchanted: 'textures/misc/enchanted_item_glint' },
      geometry: { default: 'geometry.sleepy.chest' },
      scripts: { parent_setup: 'v.chest_layer_visible = 0.0;' },
      render_controllers: ['controller.render.armor'],
    },
  },
};

const RC = {
  format_version: '1.8.0',
  render_controllers: {
    'controller.render.sleepy_hair': {
      geometry: 'Geometry.default',
      materials: [{ '*': 'Material.default' }],
      textures: ['Texture.default', 'Texture.enchanted'],
      part_visibility: [{ ribbon: 'q.is_sneaking' }],
    },
  },
};

const manifest = (type, name) => `{
  "format_version": 2,
  "header": { "name": "${name}", "description": "fixture", "uuid": "${type === 'resources' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222'}", "version": [1,0,0], "min_engine_version": [1,20,0] },
  "modules": [{ "type": "${type}", "uuid": "${type === 'resources' ? '33333333-3333-4333-8333-333333333333' : '44444444-4444-4444-8444-444444444444'}", "version": [1,0,0] }],
}`;

/** .mcaddon = folder RP + folder BP */
export async function makeSampleAddon() {
  const z = new JSZip();
  const rp = z.folder('Sleepy Sample RP');
  rp.file('manifest.json', manifest('resources', 'Sleepy Sample RP'));
  rp.file('attachables/sleepy_hair_helmet.json', HAIR_ATTACHABLE);
  rp.file('attachables/plate_chest.json', JSON.stringify(CHEST_ATTACHABLE));
  rp.file('models/entity/hair.geo.json', JSON.stringify(HAIR_GEO));
  rp.file('models/entity/chest.geo.json', JSON.stringify(CHEST_GEO_LEGACY));
  rp.file('render_controllers/hair.render_controllers.json', JSON.stringify(RC));
  rp.file('textures/models/armor/hair.png', makeTexture(512));
  rp.file('textures/models/armor/plate.png', makeTexture(64));
  const bp = z.folder('Sleepy Sample BP');
  bp.file('manifest.json', manifest('data', 'Sleepy Sample BP'));
  return z.generateAsync({ type: 'uint8array' });
}

/** A .mcpack (zipped RP, nested inside an .mcaddon) re-using the hair id → duplicate. */
export async function makeDuplicateAddon() {
  const inner = new JSZip();
  inner.file('manifest.json', manifest('resources', 'Other RP'));
  inner.file('attachables/hair.json', HAIR_ATTACHABLE);
  inner.file('models/entity/hair.geo.json', JSON.stringify(HAIR_GEO));
  inner.file('textures/models/armor/hair.png', makeTexture(128));
  const outer = new JSZip();
  outer.file('Other.mcpack', await inner.generateAsync({ type: 'uint8array' }));
  return outer.generateAsync({ type: 'uint8array' });
}

/** Behavior-pack-only addon → should be skipped. */
export async function makeNoArmorAddon() {
  const z = new JSZip();
  z.file('manifest.json', manifest('data', 'Only BP'));
  return z.generateAsync({ type: 'uint8array' });
}
