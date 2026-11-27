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
export function lodLine(thresholds) {
  let expr = String(thresholds.length);
  for (let i = thresholds.length - 1; i >= 0; i--) {
    const d = fmt(thresholds[i]);
    expr = i === 0 ? `v.sl_d < ${d} ? 0 : (${expr})` : `(v.sl_d < ${d} ? ${i} : (${expr}))`;
  }
  // flatten outer redundant parens of first-level form
  return `v.sl_d = q.distance_from_camera; v.sl_lod = ${expr};`;
}

const fmt = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));

/**
 * Transform pre_animation lines.
 * @param {string[]} lines original
 * @param {number[]} thresholds see lodLine
 * @param {number} physicsMaxLod physics/pre_animation runs while v.sl_lod <= this
 * @returns {string[]}
 */
export function transformPreAnimation(lines, thresholds, physicsMaxLod) {
  const src = (lines || []).filter((l) => typeof l === 'string' && l.trim());
  const out = [];
  let rest = src;
  if (src.length && isInitLine(src[0])) {
    out.push(src[0]);
    rest = src.slice(1);
  }
  out.push(lodLine(thresholds));
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
