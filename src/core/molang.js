/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */

/** Init block pattern: "(v.xxx ?? 0) == 0 ? { ... }" */
const INIT_RE = /^\s*\(\s*(v|variable)\.[\w.]+\s*\?\?\s*0\s*\)\s*==\s*0\s*\?\s*\{/i;

/** True when braces (outside 'strings') are balanced and never go negative. */
export function bracesBalanced(line) {
  let depth = 0;
  let inStr = false;
  for (const ch of line) {
    if (ch === "'") inStr = !inStr;
    else if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth < 0) return false;
    }
  }
  return depth === 0 && !inStr;
}

export function isInitLine(line) {
  return INIT_RE.test(line);
}

const endStmt = (s) => {
  const t = s.trim();
  if (!t) return '';
  return t.endsWith(';') ? t : t + ';';
};

/**
 * Build LOD selector line.
 * @param {number[]} thresholds distance (blocks) where each level ends; length = number of levels-1
 *   e.g. [8,16,32] → lods 0..3. A final hide threshold may be appended by the caller.
 */
/**
 * Viewer-side switch: LOD is only used when this Molang condition is true on the VIEWER's device,
 * so each player can turn it on/off with their own game settings. (Queries must be confirmed in game.)
 */
// Confirmed in game: q.graphics_mode_is_any works in attachables.
// (q.client_max_render_distance and q.client_memory_tier did NOT react in attachables — removed.)
export const GATES = {
  all: null,
  graphics: "q.graphics_mode_is_any('simple')",
};
export const gateExpr = (gate) => GATES[gate] || null;

export function lodLine(thresholds, gate = null) {
  let expr = String(thresholds.length);
  for (let i = thresholds.length - 1; i >= 0; i--) {
    const d = fmt(thresholds[i]);
    expr = i === 0 ? `v.sl_d < ${d} ? 0 : (${expr})` : `(v.sl_d < ${d} ? ${i} : (${expr}))`;
  }
  // flatten outer redundant parens of first-level form
  // Gate without a nested ternary (a ternary inside the true-branch of another did not work in game):
  // the gate query returns 1.0/0.0, so multiplying keeps the distance level or forces level 0.
  const gated = gate ? ` v.sl_lod = v.sl_lod * (${gate});` : '';
  return `v.sl_d = q.distance_from_camera; v.sl_lod = ${expr};${gated}`;
}

const fmt = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));

/**
 * Transform pre_animation lines.
 * @param {string[]} lines original
 * @param {number[]} thresholds see lodLine
 * @param {number} physicsMaxLod physics/pre_animation runs while v.sl_lod <= this
 * @returns {string[]}
 */
export function transformPreAnimation(lines, thresholds, physicsMaxLod, gate = null) {
  const src = (lines || []).filter((l) => typeof l === 'string' && l.trim());
  const out = [];
  let rest = src;
  if (src.length && isInitLine(src[0])) {
    out.push(src[0]);
    rest = src.slice(1);
  }
  out.push(lodLine(thresholds, gate));
  if (rest.length) {
    const maxLod = thresholds.length;
    if (physicsMaxLod >= maxLod) {
      out.push(...rest);
    } else {
      const body = rest.map(endStmt).filter(Boolean).join(' ');
      out.push(`v.sl_lod <= ${physicsMaxLod} ? { ${body} };`);
    }
  }
  for (const l of out) {
    if (!bracesBalanced(l)) throw new Error(`Unbalanced braces after transform: ${l}`);
  }
  return out;
}

/**
 * Make every animate entry conditional on LOD.
 * @param {(string|Object<string,string>)[]} animate
 */
export function transformAnimate(animate, physicsMaxLod, maxLod) {
  if (!Array.isArray(animate)) return animate;
  if (physicsMaxLod >= maxLod) return animate;
  const cond = `v.sl_lod <= ${physicsMaxLod}`;
  return animate.map((e) => {
    if (typeof e === 'string') return { [e]: cond };
    if (e && typeof e === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(e)) {
        o[k] = typeof v === 'string' && v.trim() ? `(${v}) && ${cond}` : cond;
      }
      return o;
    }
    return e;
  });
}

/** Count Molang lines in pre_animation (non-empty). */
export const countMolang = (lines) => (Array.isArray(lines) ? lines.filter((l) => typeof l === 'string' && l.trim()).length : 0);
