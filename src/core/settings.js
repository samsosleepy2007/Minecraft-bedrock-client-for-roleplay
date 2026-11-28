/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import { textureMB } from './texture.js';

/**
 * @typedef {Object} LevelCfg
 * @property {number} distance  distance (blocks) where this level ENDS
 * @property {number} resolution 1 | 0.5 | 0.25 | 0.125
 * @property {number} minCubeSize remove cubes whose largest side < this (pixels), 0 = off
 * @property {boolean} dedupePlanes remove stacked duplicate planes (e.g. 2-layer hair)
 *
 * @typedef {Object} Settings
 * @property {number} lodCount reduced levels after LOD0 (1–4)
 * @property {LevelCfg[]} levels index 0 = LOD0 (original), length >= lodCount+1
 * @property {number} physicsOffFrom first LOD where pre_animation/animate are disabled (lodCount+1 = never)
 * @property {{enabled:boolean, distance:number}} hide
 * @property {'full'|'minimal'|'none'} memoryMode
 * @property {boolean} armorStand
 * @property {boolean} debug
 */

export const RESOLUTIONS = [1, 0.5, 0.25, 0.125];
export const MAX_LODS = 4;

const L = (distance, resolution, minCubeSize = 0, dedupePlanes = false) => ({ distance, resolution, minCubeSize, dedupePlanes });

/** @type {Record<string, Settings>} */
export const PRESETS = {
  saver: {
    lodCount: 3,
    levels: [L(8, 1), L(16, 0.25, 1, true), L(32, 0.125, 2, true), L(48, 0.125, 3, true), L(64, 0.125, 3, true)],
    physicsOffFrom: 1,
    hide: { enabled: true, distance: 48 },
    memoryMode: 'full',
    armorStand: true,
    debug: false,
  },
  balanced: {
    lodCount: 2,
    levels: [L(8, 1), L(20, 0.5, 0.5, true), L(40, 0.25, 1, true), L(56, 0.125, 2, true), L(72, 0.125, 2, true)],
    physicsOffFrom: 1,
    hide: { enabled: true, distance: 64 },
    memoryMode: 'full',
    armorStand: true,
    debug: false,
  },
  quality: {
    lodCount: 1,
    levels: [L(8, 1), L(32, 0.5, 0, true), L(48, 0.25, 0.5, true), L(64, 0.125, 1, true), L(80, 0.125, 1, true)],
    physicsOffFrom: 2,
    hide: { enabled: false, distance: 96 },
    memoryMode: 'full',
    armorStand: true,
    debug: false,
  },
};

export const defaultSettings = () => structuredClone(PRESETS.balanced);

/** Fill missing fields and clamp values. Returns a new object. */
function normLevels(src, base) {
  const lv = [];
  for (let i = 0; i <= MAX_LODS; i++) {
    const l = { ...base.levels[i], ...((src || [])[i] || {}) };
    lv.push({
      distance: Math.max(1, Number(l.distance) || base.levels[i].distance),
      resolution: RESOLUTIONS.includes(Number(l.resolution)) ? Number(l.resolution) : base.levels[i].resolution,
      minCubeSize: Math.max(0, Number(l.minCubeSize) || 0),
      dedupePlanes: !!l.dedupePlanes,
    });
  }
  return lv;
}

/** LOD profile fields shared by the main (Simple / everyone) and the Fancy profile. */
function normProfile(o, base, minCount) {
  o.lodCount = Math.min(MAX_LODS, Math.max(minCount, Math.round(Number(o.lodCount ?? minCount) || 0)));
  o.levels = normLevels(o.levels, base);
  o.physicsOffFrom = Math.min(o.lodCount + 1, Math.max(0, Math.round(Number(o.physicsOffFrom ?? 1))));
  o.hide = { enabled: !!o.hide?.enabled, distance: Math.max(1, Number(o.hide?.distance) || 64) };
  return o;
}

/** Default Fancy profile: 0 levels = always full quality. */
export const defaultFancy = () => ({ lodCount: 0, levels: structuredClone(PRESETS.quality.levels), physicsOffFrom: 1, hide: { enabled: false, distance: 96 } });

/** Fill missing fields and clamp values. Returns a new object. */
export function normalizeSettings(s) {
  const base = defaultSettings();
  const o = normProfile({ ...base, ...(s || {}) }, base, 1);
  o.memoryMode = ['full', 'minimal', 'none'].includes(o.memoryMode) ? o.memoryMode : 'full';
  o.armorStand = o.armorStand !== false;
  o.debug = !!o.debug;
  o.gate = o.gate === 'graphics' ? 'graphics' : 'all';
  delete o.gateRender;
  const f = { ...defaultFancy(), ...(s?.fancy || {}) };
  o.fancy = normProfile({ lodCount: f.lodCount, levels: f.levels, physicsOffFrom: f.physicsOffFrom, hide: { ...f.hide } }, base, 0);
  return o;
}

/** The Fancy-graphics profile as full settings (memory mode / debug from the main settings). */
export function fancyProfile(s) {
  return { ...s, ...s.fancy, levels: s.fancy.levels, hide: s.fancy.hide, gate: 'all', fancy: undefined };
}

/** Validation messages (empty = OK). Distances must strictly increase. */
export function validateSettings(s) {
  const errs = [];
  if (s.gate === 'graphics' && s.fancy) errs.push(...validateSettings(fancyProfile(s)).map((e) => 'fancy:' + e));
  const t = thresholds(s, false);
  for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) errs.push(`distance_order:${i}`);
  if (s.hide.enabled && t.length && !(s.hide.distance > t[t.length - 1])) errs.push('hide_distance');
  return errs;
}

/** LOD thresholds list for Molang (hide distance appended when enabled). */
export function thresholds(s, withHide = true) {
  const t = s.levels.slice(0, s.lodCount).map((l) => l.distance);
  if (withHide && s.hide.enabled) t.push(s.hide.distance);
  return t;
}

/**
 * Which resolution each reduced LOD (1..lodCount) uses after memory mode.
 * null = reuse original texture (no new file).
 */
export function textureLevels(s) {
  const res = [];
  for (let i = 1; i <= s.lodCount; i++) {
    let r = s.levels[i].resolution;
    if (s.memoryMode === 'none') r = null;
    else if (s.memoryMode === 'minimal' && i < s.lodCount) r = null;
    if (r === 1 && !s.debug) r = null;
    if (r === null && s.debug) r = 1;
    res.push(r);
  }
  return res;
}

/** Extra texture memory (MB) for armors [{texW, texH}] under settings. */
export function estimateExtraMB(armors, s) {
  // Simple + Fancy levels; identical resolutions are generated once (shared files)
  const all = [...textureLevels(s), ...(s.gate === 'graphics' && s.fancy ? textureLevels(fancyProfile(s)) : [])];
  const lv = s.debug ? all : [...new Set(all)];
  let mb = 0;
  for (const a of armors) {
    if (!a.texW || !a.texH) continue;
    for (const r of lv) if (r) mb += textureMB(Math.max(1, Math.round(a.texW * r)), Math.max(1, Math.round(a.texH * r)));
  }
  return mb;
}

/** Merge global settings with per-armor overrides. */
export function settingsFor(global, overrides) {
  if (!overrides) return global;
  return normalizeSettings({ ...global, ...overrides, levels: (global.levels || []).map((l, i) => ({ ...l, ...((overrides.levels || [])[i] || {}) })), hide: { ...global.hide, ...(overrides.hide || {}) } });
}
