/*! SleepyArmor Lite — Copyright (c) 2026 SamSoSleepy (SleepyShop). All rights reserved.
 * Proprietary. Unauthorized use: 5,000 THB fine + blacklist until paid. See LICENSE.txt. */

/**
 * Normalise a geometry file into a list of { id, def, format } where def has .bones.
 * Supports format 1.12+ ("minecraft:geometry": [...]) and legacy 1.8 ("geometry.x": {...}).
 */
export function listGeometries(file) {
  const res = [];
  if (!file || typeof file !== 'object') return res;
  if (Array.isArray(file['minecraft:geometry'])) {
    for (const g of file['minecraft:geometry']) {
      const id = g?.description?.identifier;
      if (id) res.push({ id, def: g, format: 'new' });
    }
  }
  for (const [k, v] of Object.entries(file)) {
    if (k.startsWith('geometry.') && v && typeof v === 'object') {
      res.push({ id: k.split(':')[0], def: v, format: 'legacy', key: k });
    }
  }
  return res;
}

export function countCubes(def) {
  let n = 0;
  for (const b of def?.bones || []) n += Array.isArray(b.cubes) ? b.cubes.length : 0;
  return n;
}

const planeAxis = (size) => (Array.isArray(size) ? size.findIndex((s) => Number(s) === 0) : -1);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function isDuplicatePlane(a, b) {
  const ax = planeAxis(a.size);
  if (ax < 0 || ax !== planeAxis(b.size)) return false;
  if (!same(a.size, b.size) || !same(a.rotation, b.rotation) || !same(a.pivot, b.pivot)) return false;
  const oa = a.origin || [0, 0, 0];
  const ob = b.origin || [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(Number(oa[i]) - Number(ob[i]));
    if (i === ax ? d > 1.0001 : d > 0.0001) return false;
  }
  return true;
}

/**
 * Reduce cubes. Bones are always kept (animations reference bone names). UVs untouched.
 * @param {object} def geometry definition (with bones)
 * @param {{minCubeSize?:number, dedupePlanes?:boolean}} opt
 */
export function reduceGeometryDef(def, opt = {}) {
  const min = Number(opt.minCubeSize) || 0;
  const out = structuredClone(def);
  for (const bone of out.bones || []) {
    if (!Array.isArray(bone.cubes)) continue;
    let cubes = bone.cubes;
    if (min > 0) {
      cubes = cubes.filter((c) => {
        const s = (c.size || [0, 0, 0]).map((x) => Math.abs(Number(x) || 0));
        return Math.max(...s) >= min;
      });
    }
    if (opt.dedupePlanes) {
      const kept = [];
      for (const c of cubes) if (!kept.some((k) => isDuplicatePlane(k, c))) kept.push(c);
      cubes = kept;
    }
    bone.cubes = cubes;
  }
  return out;
}

/** Build a geometry file (format 1.12.0) for a new id from a definition. */
export function makeGeometryFile(newId, def, srcFormat, srcKey) {
  const g = structuredClone(def);
  if (srcFormat === 'legacy') {
    const parent = typeof srcKey === 'string' && srcKey.includes(':') ? ':' + srcKey.split(':').slice(1).join(':') : '';
    return { format_version: '1.8.0', [newId + parent]: g };
  }
  g.description = { ...g.description, identifier: newId };
  return { format_version: '1.12.0', 'minecraft:geometry': [g] };
}
