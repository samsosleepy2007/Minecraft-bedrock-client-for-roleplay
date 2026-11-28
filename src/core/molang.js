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
 * Viewer-side switch. Confirmed in game: q.graphics_mode_is_any works in attachables.
 * (q.client_max_render_distance and q.client_memory_tier did NOT react in attachables — removed.)
 */
export const GATES = {
  all: null,
  graphics: "q.graphics_mode_is_any('simple')",
};
export const gateExpr = (gate) => GATES[gate] || null;

const fmt = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Distance → level expression: thresholds [8,16] → "v.sl_d < 8.0 ? 0 : ((v.sl_d < 16.0 ? 1 : (2)))" (only nests in the false branch). */
export function distanceExpr(thresholds) {
  if (!thresholds.length) return '0';
  let expr = String(thresholds.length);
  for (let i = thresholds.length - 1; i >= 0; i--) {
    const d = fmt(thresholds[i]);
    expr = i === 0 ? `v.sl_d < ${d} ? 0 : (${expr})` : `(v.sl_d < ${d} ? ${i} : (${expr}))`;
  }
  return expr;
}

/**
 * Single profile LOD line (mode "everyone"). Output kept identical to the version confirmed in game.
 * @param {number[]} thresholds distance where each level ends (+ hide distance appended by the caller)
 */
export function lodLine(thresholds, gate = null) {
  const gated = gate ? ` v.sl_lod = v.sl_lod * (${gate});` : '';
  return `v.sl_d = q.distance_from_camera; v.sl_lod = ${distanceExpr(thresholds)};${gated}`;
}

/**
 * Two profiles chosen by the viewer's graphics mode (Simple / Fancy), using arithmetic only
 * (no ternary inside a ternary's true-branch — that form did not work in game).
 * Texture/geometry array index: 0 = original, 1..Ns = Simple levels, Ns+1..Ns+Nf = Fancy levels.
 * Sets v.sl_lod (array index), v.sl_vis (1 = visible), v.sl_phys (1 = physics/animation on).
 * @param {{n:number, thresholds:number[], hide:boolean, physMax:number}} S
 * @param {{n:number, thresholds:number[], hide:boolean, physMax:number}} F
 */
export function lodLineGraphics(S, F) {
  const vis = (v, p) => (p.hide ? `(${v} < ${p.thresholds.length})` : '1');
  const phys = (v, p) => `(${v} <= ${p.physMax})`;
  return [
    'v.sl_d = q.distance_from_camera;',
    `v.sl_g = ${GATES.graphics};`,
    `v.sl_ls = ${distanceExpr(S.thresholds)};`,
    `v.sl_lf = ${distanceExpr(F.thresholds)};`,
    `v.sl_lod = v.sl_g * math.min(v.sl_ls, ${S.n}) + (1 - v.sl_g) * (math.min(v.sl_lf, ${F.n}) + ${S.n} * (v.sl_lf > 0));`,
    `v.sl_vis = v.sl_g * ${vis('v.sl_ls', S)} + (1 - v.sl_g) * ${vis('v.sl_lf', F)};`,
    `v.sl_phys = v.sl_g * ${phys('v.sl_ls', S)} + (1 - v.sl_g) * ${phys('v.sl_lf', F)};`,
  ].join(' ');
}

/**
 * Transform pre_animation lines.
 * @param {string[]} lines original
 * @param {string} lodStmt LOD statement line (lodLine / lodLineGraphics)
 * @param {string|null} physCond physics runs while this is true; null = never disabled
 */
export function transformPreAnimation(lines, lodStmt, physCond) {
  if (Array.isArray(lodStmt)) {
    // legacy signature (lines, thresholds, physicsMaxLod, gate)
    const [thr, physMax, gate] = [lodStmt, physCond, arguments[3]];
    return transformPreAnimation(lines, lodLine(thr, gate ?? null), physMax >= thr.length ? null : `v.sl_lod <= ${physMax}`);
  }
  const src = (lines || []).filter((l) => typeof l === 'string' && l.trim());
  const out = [];
  let rest = src;
  if (src.length && isInitLine(src[0])) {
    out.push(src[0]);
    rest = src.slice(1);
  }
  out.push(lodStmt);
  if (rest.length) {
    if (!physCond) out.push(...rest);
    else out.push(`${physCond} ? { ${rest.map(endStmt).filter(Boolean).join(' ')} };`);
  }
  for (const l of out) {
    if (!bracesBalanced(l)) throw new Error(`Unbalanced braces after transform: ${l}`);
  }
  return out;
}

/**
 * Make every animate entry conditional.
 * @param {(string|Object<string,string>)[]} animate
 * @param {string|number|null} physCond condition string (or legacy physicsMaxLod number with maxLod)
 */
export function transformAnimate(animate, physCond, maxLod) {
  if (!Array.isArray(animate)) return animate;
  if (typeof physCond === 'number') physCond = physCond >= maxLod ? null : `v.sl_lod <= ${physCond}`;
  if (!physCond) return animate;
  const cond = physCond;
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
