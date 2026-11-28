/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import './style.css';
import morphdom from 'morphdom';
import { STR } from './i18n.js';
import { PRESETS, RESOLUTIONS, MAX_LODS, normalizeSettings, validateSettings, estimateExtraMB, settingsFor } from './core/settings.js';

// ---------- storage (always guarded) ----------
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('sal:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('sal:' + k, JSON.stringify(v));
    } catch {
      /* private mode etc. */
    }
  },
};

// ---------- state ----------
const state = {
  lang: store.get('lang', (navigator.language || '').startsWith('th') ? 'th' : 'en') === 'en' ? 'en' : 'th',
  settings: normalizeSettings(store.get('settings', PRESETS.balanced)),
  overrides: store.get('overrides', {}), // key → full settings object
  armors: [],
  selected: new Set(),
  duplicates: [],
  dupChoice: {}, // identifier → key
  skipped: [],
  warnings: [],
  showAll: false,
  busy: false,
  result: null,
  preset: store.get('preset', 'balanced'), // null = custom
  open: {}, // armor key → preview open
  previews: {}, // armor key → { sig, levels:[{r,url}] }
  advOpen: false,
  expertOpen: false,
  sliders: store.get('sliders', { res: 50, hide: 64 }),
  howOpen: false,
};
const t = (k) => STR[state.lang][k] ?? k;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = ({ data: m }) => {
  if (m.type === 'progress') setProgress(m.p, m.msg);
  else if (m.type === 'scanned') onScanned(m);
  else if (m.type === 'built') onBuilt(m);
  else if (m.type === 'preview') onPreview(m);
  else if (m.type === 'error') {
    state.busy = false;
    setProgress(null);
    alert(m.code === 'DUPLICATE' ? t('needDup') + ` (${m.identifier})` : m.message);
    render();
  }
};

// ---------- actions ----------
async function onFiles(files) {
  if (!files.length) return;
  state.busy = true;
  state.result = null;
  render();
  setProgress(0, t('scanning'));
  const list = [];
  for (const f of files) list.push({ name: f.name, buffer: await f.arrayBuffer() });
  worker.postMessage({ type: 'scan', files: list }, list.map((x) => x.buffer));
}

function onScanned(m) {
  state.busy = false;
  setProgress(null);
  state.armors = m.armors;
  state.skipped = m.skipped;
  state.warnings = m.warnings;
  state.duplicates = m.duplicates;
  state.dupChoice = {};
  for (const d of m.duplicates) state.dupChoice[d.identifier] = d.keys[0];
  state.selected = new Set(m.armors.filter((a) => a.likelyArmor && isChosen(a)).map((a) => a.key));
  render();
}

const isChosen = (a) => !state.dupChoice[a.identifier] || state.dupChoice[a.identifier] === a.key;

function build() {
  const keys = [...state.selected].filter((k) => {
    const a = state.armors.find((x) => x.key === k);
    return a && isChosen(a);
  });
  if (!keys.length) return alert(t('needSel'));
  if (validateSettings(state.settings).length) return alert(t('errOrder'));
  const overrides = {};
  for (const k of keys) if (state.overrides[setOf(k)]) overrides[k] = state.overrides[setOf(k)];
  state.busy = true;
  state.result = null;
  render();
  setProgress(0, t('building'));
  const psKey = state.settings.debug ? 'packStateDebug' : 'packState';
  worker.postMessage({ type: 'build', keys, settings: state.settings, overrides, packState: store.get(psKey, null) });
}

function onBuilt(m) {
  state.busy = false;
  setProgress(null);
  store.set(m.fileName.includes('DEBUG') ? 'packStateDebug' : 'packState', m.packState);
  const blob = new Blob([m.bytes], { type: 'application/octet-stream' });
  if (state.result?.url) URL.revokeObjectURL(state.result.url);
  state.result = { url: URL.createObjectURL(blob), blob, fileName: m.fileName, version: m.packState.version, report: m.report };
  render();
  $('#dl')?.click();
  $('#result')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function share() {
  const r = state.result;
  const file = new File([r.blob], r.fileName, { type: 'application/octet-stream' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: r.fileName });
    else throw new Error('no share');
  } catch (e) {
    if (e?.name !== 'AbortError') $('#dl')?.click();
  }
}

function save() {
  store.set('sliders', state.sliders);
  store.set('preset', state.preset);
  store.set('settings', state.settings);
  store.set('overrides', state.overrides);
}

// ---------- armor sets: pieces (head/chest/legs/feet) sharing geometry + texture ----------
const setOf = (key) => state.armors.find((a) => a.key === key)?.setKey || key;
function armorGroups(list) {
  const m = new Map();
  for (const a of list) {
    const g = m.get(a.setKey) || { id: a.setKey, members: [] };
    g.members.push(a);
    m.set(a.setKey, g);
  }
  return [...m.values()];
}
/** "ryo_body1:ryo_body1_head" ×4 → ["head","chest","legs","feet"] (common prefix removed) */
function pieceNames(ids) {
  if (ids.length < 2) return ids;
  let pre = ids[0];
  for (const id of ids) while (!id.startsWith(pre)) pre = pre.slice(0, -1);
  return ids.map((id) => id.slice(pre.length).replace(/^[_:.-]+/, '') || id);
}

// ---------- level preview (real texture, downscaled in the worker) ----------
const effSettings = (key) => settingsFor(state.settings, state.overrides[key]);
const previewSig = (key) => JSON.stringify(effSettings(key));
function requestPreview(gid, memberKey) {
  const sig = previewSig(gid);
  const p = state.previews[gid];
  if (p && (p.sig === sig || p.pending === sig)) return;
  state.previews[gid] = { ...(p || {}), pending: sig };
  worker.postMessage({ type: 'preview', key: memberKey, gid, id: sig, settings: state.settings, override: state.overrides[gid] });
}
async function onPreview(m) {
  m.key = m.gid;
  const old = state.previews[m.key];
  if (old?.pending !== m.id) return;
  // three.js is loaded only when a preview is first needed (keeps first load small on phones)
  const { renderModel } = await import('./preview3d.js').catch(() => ({ renderModel: async () => null }));
  const levels = [];
  for (const l of m.levels) {
    // 3D render of the (reduced) model; falls back to the flat texture
    const url = (await renderModel(l.geo, l.png, { blend: m.blend }).catch(() => null)) || URL.createObjectURL(new Blob([l.png], { type: 'image/png' }));
    levels.push({ r: l.r, url });
  }
  if (state.previews[m.key]?.pending !== m.id) return levels.forEach((l) => URL.revokeObjectURL(l.url));
  old.levels?.forEach((l) => URL.revokeObjectURL(l.url));
  state.previews[m.key] = { sig: m.id, levels };
  render();
}

// ---------- rendering ----------
function setProgress(p, msg = '') {
  const el = $('#progress');
  if (!el) return;
  el.hidden = p == null;
  if (p != null) {
    $('#bar', el).style.width = Math.round(p * 100) + '%';
    $('#pmsg', el).textContent = msg;
  }
}

const opt = (v, label, cur) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;

const ICON = {
  shield: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/></svg>',
  upload: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
  down: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>',
  share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 12v8h14v-8"/></svg>',
  chev: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};

const stepHead = (n, title, extra = '') =>
  `<div class="head"><div class="title"><span class="num">${n}</span><h2>${title}</h2></div>${extra}</div>`;

/** Advanced settings form; `path` = 'g' for global or armor key for overrides. */
/**
 * Advanced per-level form; `path` = 'g' for global or the armor-set id for overrides.
 * In graphics mode it shows two profiles: Simple (main settings) and Fancy (`fancy.*`, 0 levels allowed).
 */
function settingsForm(s, path) {
  if (s.gate !== 'graphics') return profileForm(s, path, '', 1, t('lodCount'));
  return profileForm(s, path, '', 1, t('lodCountSimple')) + profileForm({ ...s.fancy, gate: 'all' }, path, 'fancy.', 0, t('lodCountFancy'));
}

function profileForm(s, path, prefix, minCount, title) {
  const f = (name) => prefix + name;
  const lv = s.levels;
  let rows = '';
  if (s.lodCount > 0) {
    rows += `<div class="lv"><b>${t('lod0')}</b><label class="fld">${t('until')} <input type="number" min="1" step="1" data-f="${f('levels.0.distance')}" value="${lv[0].distance}"></label></div>`;
  }
  for (let i = 1; i <= s.lodCount; i++) {
    const last = i === s.lodCount;
    rows += `<div class="lv"><b><i class="dot d${i}"></i>${t('level')} ${i}</b>
      ${last ? '' : `<label class="fld">${t('until')} <input type="number" min="1" step="1" data-f="${f(`levels.${i}.distance`)}" value="${lv[i].distance}"></label>`}
      <label class="fld">${t('res')} <select data-f="${f(`levels.${i}.resolution`)}">${RESOLUTIONS.map((r) => opt(r, r * 100 + '%', lv[i].resolution)).join('')}</select></label>
      <label class="fld">${t('minCube')} <input type="number" min="0" step="0.5" data-f="${f(`levels.${i}.minCubeSize`)}" value="${lv[i].minCubeSize}"></label>
      <label class="tgl">${t('dedupe')}<input type="checkbox" class="ck" data-f="${f(`levels.${i}.dedupePlanes`)}" ${lv[i].dedupePlanes ? 'checked' : ''}></label></div>`;
  }
  const phys = [];
  for (let i = 0; i <= s.lodCount; i++) phys.push(opt(i, `${t('level')} ${i}`, s.physicsOffFrom));
  phys.push(opt(s.lodCount + 1, t('never'), s.physicsOffFrom));
  const counts = [0, 1, 2, 3, 4].filter((n) => n >= minCount && n <= MAX_LODS);
  const errs = s.lodCount > 0 || s.hide.enabled ? validateSettings(normalizeSettings({ ...s, lodCount: Math.max(1, s.lodCount) })) : [];
  return `<div class="form ${prefix ? 'fancy' : ''}" data-path="${esc(path)}">
    <label class="fld"><b>${title}</b> <select data-f="${f('lodCount')}">${counts.map((n) => opt(n, n === 0 ? t('lodZero') : n, s.lodCount)).join('')}</select></label>
    ${rows}
    ${s.lodCount > 0 ? `<label class="fld">${t('physOff')} <select data-f="${f('physicsOffFrom')}">${phys.join('')}</select></label>` : ''}
    <label class="tgl">${t('hide')}<input type="checkbox" class="ck" data-f="${f('hide.enabled')}" ${s.hide.enabled ? 'checked' : ''}></label>
    ${s.hide.enabled ? `<label class="fld">${t('until')} <input type="number" min="1" data-f="${f('hide.distance')}" value="${s.hide.distance}"></label>` : ''}
    ${errs.length ? `<p class="err">${t('errOrder')}</p>` : ''}
  </div>`;
}

function setField(obj, f, val) {
  const parts = f.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts.at(-1)] = val;
}

/** Preview tiles: one per LOD level (+ a hidden tile when hiding is on). */
function previewStrip(g) {
  const a = g.members[0];
  const s = effSettings(g.id);
  const p = state.previews[g.id];
  if (!p?.levels) {
    requestPreview(g.id, a.key);
    return `<div class="prev"><p class="muted center">${a.texW ? '…' : t('noPreview')}</p></div>`;
  }
  if (p.sig !== previewSig(g.id)) requestPreview(g.id, a.key);
  if (!p.levels.length) return `<div class="prev"><p class="muted center">${t('noPreview')}</p></div>`;
  const ends = [...s.levels.slice(0, s.lodCount).map((l) => l.distance), s.hide.enabled ? s.hide.distance : '∞'];
  const tiles = p.levels.map((l, i) => {
    const from = i === 0 ? 0 : ends[i - 1];
    return { url: l.url, label: i === 0 ? t('original') : l.r === 1 ? '100%' : l.r * 100 + '%', dist: `${from}–${ends[i]} ${t('blocks')}`, hidden: false };
  });
  if (s.hide.enabled) tiles.push({ url: p.levels.at(-1).url, label: t('hiddenLbl'), dist: `${s.hide.distance}+ ${t('blocks')}`, hidden: true });
  return `<div class="prev" style="grid-template-columns:repeat(${Math.min(tiles.length, 5)},1fr)">${tiles
    .map((x) => `<div class="tile ${x.hidden ? 'hid' : ''}"><img src="${x.url}" alt="${esc(x.label)}"><span class="lbl">${esc(x.label)}</span><span class="dist">${esc(x.dist)}</span></div>`)
    .join('')}</div>`;
}

/** Patch the DOM instead of replacing it, so CSS transitions/animations keep running. */
function patch(html) {
  const next = document.createElement('main');
  next.id = 'app';
  next.innerHTML = html;
  morphdom($('#app'), next, {
    onBeforeElUpdated(from, to) {
      if (from.isEqualNode(to)) return false;
      if (from.type === 'file') return false; // never reset the file picker
      if (from.dataset?.slider && from === document.activeElement && state.dragging) return false;
      return true;
    },
  });
}

const PRESET_KEYS = ['saver', 'balanced', 'quality'];
const PRESET_SLIDERS = { saver: { res: 25, hide: 48 }, balanced: { res: 50, hide: 64 }, quality: { res: 50, hide: 128 } };
const SLIDERS = [
  { k: 'res', min: 10, max: 100 },
  { k: 'hide', min: 8, max: 128 },
];
const resFromSlider = (v) => (v >= 75 ? 1 : v >= 38 ? 0.5 : v >= 19 ? 0.25 : 0.125);
function sliderText(k, v) {
  if (k === 'res') return resFromSlider(v) * 100 + '%';
  if (v >= 128) return t('noHide');
  const last = state.settings.levels[state.settings.lodCount - 1].distance;
  return Math.max(v, last + 1) + ' ' + t('blocks');
}
/** Apply a simple slider to the global settings. */
function applySlider(k, v) {
  const s = structuredClone(state.settings);
  if (k === 'res') {
    const first = resFromSlider(v);
    for (let i = 1; i < s.levels.length; i++) s.levels[i].resolution = Math.max(0.125, first / 2 ** (i - 1));
  } else if (v >= 128) s.hide.enabled = false;
  else s.hide = { enabled: true, distance: Math.max(v, s.levels[s.lodCount - 1].distance + 1) };
  state.settings = normalizeSettings(s);
}
const pct = (o, v) => ((v - o.min) / (o.max - o.min)) * 100 + '%';
function simpleControls(s) {
  const physOn = s.physicsOffFrom <= s.lodCount;
  return `<div class="simple">
    ${SLIDERS.map((o) => {
      const v = state.sliders[o.k];
      return `<label class="sl ${state.dragging === o.k ? 'drag' : ''}" data-sl="${o.k}"><span class="slh">${t('sl_' + o.k)}<b>${sliderText(o.k, v)}</b></span>
        <span class="slt"><span class="rail"></span><span class="fill" style="width:${pct(o, v)}"></span><span class="thumb" style="left:${pct(o, v)}"></span>
        <input type="range" min="${o.min}" max="${o.max}" value="${v}" data-slider="${o.k}" aria-label="${t('sl_' + o.k)}"></span></label>`;
    }).join('')}
    <label class="tgl">${t('physFar')}<input type="checkbox" class="ck" data-phys ${physOn ? 'checked' : ''}></label>
    <label class="tgl">${t('debugShort')}<input type="checkbox" class="ck" data-f="debug" ${s.debug ? 'checked' : ''}></label>
  </div>`;
}

function render() {
  const s = state.settings;
  const sel = state.armors.filter((a) => state.selected.has(a.key) && isChosen(a));
  const mb = armorGroups(sel).reduce((sum, g) => sum + estimateExtraMB([g.members[0]], settingsFor(s, state.overrides[g.id])), 0);
  const visible = state.armors.filter((a) => state.showAll || a.likelyArmor);
  const dupIds = new Set(state.duplicates.map((d) => d.identifier));
  const pi = PRESET_KEYS.indexOf(state.preset);

  patch(`
  <div class="wrap">
  <header>
    <div class="top">
      <div class="brand"><span class="logo">${ICON.shield}</span><span>SleepyArmor Lite</span></div>
      <button id="lang" type="button" class="pill">TH / EN</button>
    </div>
    <div class="hero"><h1>${t('heroTitle')}</h1><p>${t('heroSub')}</p></div>
  </header>

  <section class="card">
    ${stepHead(1, t('s1n'))}
    <label class="drop ${state.busy ? 'off' : ''}">${ICON.upload}<span class="big">${t('tap')}</span><span class="muted sm">${t('types')}</span>
      <input id="files" type="file" multiple ${state.busy ? 'disabled' : ''}></label>
    <div id="progress" hidden><div class="track"><div id="bar"></div></div><small id="pmsg"></small></div>
    ${state.skipped.length ? `<details class="note-box"><summary>${t('skipped')} (${state.skipped.length})${ICON.chev}</summary><ul>${state.skipped.map((x) => `<li>${esc(x.name)} — ${t('reason_' + x.reason)}</li>`).join('')}</ul></details>` : ''}
    ${state.warnings.length ? `<details class="note-box"><summary>${t('warnings')} (${state.warnings.length})${ICON.chev}</summary><ul class="sm">${state.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
  </section>

  <section class="card">
    ${stepHead(2, t('s2n'), state.armors.length ? `<button id="all" type="button" class="link">${t('selAll')}</button>` : '')}
    ${!state.armors.length ? `<p class="muted sm">${t('none')}</p>` : `
    ${state.duplicates.map((d) => `<div class="dup"><b>${t('dup')}</b> <code>${esc(d.identifier)}</code>${d.keys.map((k) => {
      const a = state.armors.find((x) => x.key === k);
      return `<label class="tgl left"><input type="radio" class="ck round" name="dup-${esc(d.identifier)}" data-dup="${esc(d.identifier)}" value="${esc(k)}" ${state.dupChoice[d.identifier] === k ? 'checked' : ''}><span>${esc(a?.addonName || k)}</span></label>`;
    }).join('')}</div>`).join('')}
    ${armorGroups(visible).map((g) => {
      const a = g.members[0];
      const ov = state.overrides[g.id];
      const chosen = g.members.filter(isChosen);
      const off = !chosen.length;
      const on = !off && chosen.every((m) => state.selected.has(m.key));
      const open = !!state.open[g.id];
      const multi = g.members.length > 1;
      const title = multi ? `${(a.geoId || a.identifier).replace(/^geometry\./, '')} · ${g.members.length} ${t('pieces')}` : a.identifier;
      const stats = `${a.texW ? a.texW + '×' + a.texH : '?'} · ${a.cubeCount} ${t('cubes')}${a.polyCount ? ` · ${a.polyCount} mesh` : ''} · ${t('molang')} ${a.molangLines}`;
      return `<div class="armor ${off ? 'off' : ''}">
        <div class="arow">
          <label class="amain"><input type="checkbox" class="ck" data-sel="${esc(g.id)}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''}>
            <span class="ainfo"><span class="aname">${esc(title)}${g.members.some((m) => dupIds.has(m.identifier)) ? ' ⚠' : ''}</span>
            ${multi ? `<span class="pieces">${pieceNames(g.members.map((m) => m.identifier)).map((n) => `<i>${esc(n)}</i>`).join('')}</span>` : ''}
            <span class="asub">${esc(a.addonName)} · ${stats}</span></span></label>
          <button type="button" class="icon ${open ? 'rot' : ''}" data-open="${esc(g.id)}" aria-label="${t('previewAria')}" aria-expanded="${open}">${ICON.chev}</button>
        </div>
        ${open ? `${previewStrip(g)}
          ${a.warnings.length ? `<p class="warn sm pad">${a.warnings.map(esc).join('; ')}</p>` : ''}
          <div class="pad"><label class="tgl">${t('custom')}<input type="checkbox" class="ck" data-ov="${esc(g.id)}" ${ov ? 'checked' : ''}></label>
          ${ov ? settingsForm(normalizeSettings({ ...s, ...ov }), g.id) : ''}</div>` : ''}
      </div>`;
    }).join('')}
    <label class="tgl sm muted">${t('showAll')}<input type="checkbox" class="ck" id="showall" ${state.showAll ? 'checked' : ''}></label>`}
  </section>

  <section class="card">
    ${stepHead(3, t('s3n'))}
    <div class="seg" role="radiogroup" aria-label="Preset">
      <div class="seg-thumb" aria-hidden="true" style="transform:translateX(${Math.max(pi, 0) * 100}%);opacity:${pi < 0 ? 0 : 1}"></div>
      ${PRESET_KEYS.map((p, i) => `<button type="button" role="radio" aria-checked="${i === pi}" class="${i === pi ? 'on' : ''}" data-preset="${p}">${t('p_' + p)}</button>`).join('')}
    </div>
    <p class="hint">${pi < 0 ? t('h_custom') : t('h_' + state.preset)}</p>
    <div class="form" data-path="g">
      <p class="sub">${t('gate')}</p>
      <div class="choice" role="radiogroup" aria-label="${t('gate')}">
        ${['all', 'graphics'].map((g) => `<label class="opt ${s.gate === g ? 'on' : ''}"><input type="radio" class="ck round" name="gate" data-f="gate" value="${g}" ${s.gate === g ? 'checked' : ''}><span><b>${t('gate_' + g)}</b><small>${t('gateHelp_' + g)}</small></span></label>`).join('')}
      </div>
    </div>
    <p class="mem">${t('memEst')} <b>${mb.toFixed(2)} MB</b></p>
    <details id="adv" class="adv" ${state.advOpen ? 'open' : ''}>
      <summary>${t('advanced')}${ICON.chev}</summary>
      <div class="advbody">
        <div class="form" data-path="g">${simpleControls(s)}</div>
        <details id="expert" class="expert" ${state.expertOpen ? 'open' : ''}>
          <summary>${t('expert')}${ICON.chev}</summary>
          <div class="advbody">
            ${settingsForm(s, 'g')}
            <div class="form" data-path="g">
              <label class="fld">${t('mem')} <select data-f="memoryMode">${['full', 'minimal', 'none'].map((m) => opt(m, t('mem_' + m), s.memoryMode)).join('')}</select></label>
              <label class="tgl">${t('stand')}<input type="checkbox" class="ck" data-f="armorStand" ${s.armorStand ? 'checked' : ''}></label>
            </div>
          </div>
        </details>
      </div>
    </details>
  </section>

  <button id="build" type="button" class="cta" ${state.busy ? 'disabled' : ''}>${ICON.down}${state.busy ? t('building') : t('buildDl')}${s.debug ? ' (DEBUG)' : ''}</button>
  ${state.result ? `<div id="result" class="card result"><p>${t('done')} <b>${esc(state.result.fileName)}</b> <span class="muted sm">v1.0.${state.result.version} · ${(state.result.blob.size / 1048576).toFixed(2)} MB</span></p>
    <div class="btns"><a id="dl" class="btn" href="${state.result.url}" download="${esc(state.result.fileName)}">${ICON.down}${t('again')}</a>
    <button id="share" type="button" class="btn">${ICON.share}${t('share')}</button></div></div>` : ''}
  <p class="note">${t('note')}</p>

  <details id="how" class="card how" ${state.howOpen ? 'open' : ''}>
    <summary>${t('howto')}${ICON.chev}</summary>
    <ol><li>${t('android')}</li><li>${t('ios')}</li><li>${t('after')}</li><li>${t('afterWorld')}</li><li>${t('afterServer')}</li><li>${t('debugHelp')}</li></ol>
  </details>

  <footer>© 2026 SamSoSleepy · SleepyShop · GPL-3.0 · <a href="https://github.com/samsosleepy2007/Minecraft-bedrock-client-for-roleplay" target="_blank" rel="noopener">${t('source')}</a></footer>
  </div>`);
}

// ---------- events (delegated) ----------
const app = document.getElementById('app');
app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'files') return onFiles([...el.files]);
  if (el.id === 'showall') state.showAll = el.checked;
  else if (el.dataset.sel) {
    for (const a of state.armors) if (a.setKey === el.dataset.sel && isChosen(a)) el.checked ? state.selected.add(a.key) : state.selected.delete(a.key);
  }
  else if (el.dataset.dup) state.dupChoice[el.dataset.dup] = el.value;
  else if (el.dataset.slider) {
    state.sliders[el.dataset.slider] = Number(el.value);
    applySlider(el.dataset.slider, Number(el.value));
    state.preset = null;
  } else if (el.dataset.phys !== undefined) {
    state.settings = normalizeSettings({ ...state.settings, physicsOffFrom: el.checked ? 1 : state.settings.lodCount + 1 });
    state.preset = null;
  }
  else if (el.dataset.ov) {
    if (el.checked) state.overrides[el.dataset.ov] = structuredClone(state.settings);
    else delete state.overrides[el.dataset.ov];
  } else if (el.dataset.f) {
    const path = el.closest('[data-path]').dataset.path;
    const target = path === 'g' ? state.settings : (state.overrides[path] = normalizeSettings({ ...state.settings, ...state.overrides[path] }));
    const v = el.type === 'checkbox' ? el.checked : (el.tagName === 'SELECT' && el.dataset.f === 'memoryMode') || el.dataset.f === 'gate' ? el.value : Number(el.value);
    setField(target, el.dataset.f, v);
    const n = normalizeSettings(target);
    if (path === 'g') {
      state.settings = n;
      if (!['memoryMode', 'armorStand', 'debug', 'gate'].includes(el.dataset.f) && !el.dataset.f.startsWith('fancy.')) state.preset = null;
    }
    else state.overrides[path] = n;
  } else return;
  save();
  render();
});
app.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.slider) return;
  const o = SLIDERS.find((x) => x.k === el.dataset.slider);
  const v = Number(el.value);
  const box = el.closest('.sl');
  box.querySelector('.fill').style.width = pct(o, v);
  box.querySelector('.thumb').style.left = pct(o, v);
  box.querySelector('b').textContent = sliderText(o.k, v);
});
const endDrag = () => {
  if (!state.dragging) return;
  document.querySelector(`.sl[data-sl="${state.dragging}"]`)?.classList.remove('drag');
  state.dragging = null;
};
app.addEventListener('pointerdown', (e) => {
  if (!e.target.dataset?.slider) return;
  state.dragging = e.target.dataset.slider;
  e.target.closest('.sl').classList.add('drag');
});
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
app.addEventListener('toggle', (e) => {
  if (e.target.id === 'expert') state.expertOpen = e.target.open;
  if (e.target.id === 'adv') state.advOpen = e.target.open;
  if (e.target.id === 'how') state.howOpen = e.target.open;
}, true);
const DETAILS_STATE = { adv: 'advOpen', expert: 'expertOpen', how: 'howOpen' };
app.addEventListener('click', (e) => {
  // remember <details> state at click time, so a re-render in between cannot close it
  const sm = e.target.closest('summary');
  const key = sm && DETAILS_STATE[sm.parentElement.id];
  if (key) state[key] = !sm.parentElement.open;
  const el = e.target.closest('button');
  if (!el) return;
  if (el.id === 'lang') {
    state.lang = state.lang === 'th' ? 'en' : 'th';
    store.set('lang', state.lang);
    document.documentElement.lang = state.lang;
  } else if (el.dataset.preset) {
    const keep = { debug: state.settings.debug, armorStand: state.settings.armorStand, gate: state.settings.gate, fancy: state.settings.fancy };
    state.settings = normalizeSettings({ ...structuredClone(PRESETS[el.dataset.preset]), ...keep });
    state.preset = el.dataset.preset;
    state.sliders = { ...PRESET_SLIDERS[state.preset] };
    save();
  } else if (el.id === 'all') state.armors.forEach((a) => isChosen(a) && (state.showAll || a.likelyArmor) && state.selected.add(a.key));
  else if (el.id === 'nonesel') state.selected.clear();
  else if (el.dataset.open) state.open[el.dataset.open] = !state.open[el.dataset.open];
  else if (el.id === 'build') return build();
  else if (el.id === 'share') return share();
  else return;
  render();
});

// a chosen preset always uses its current definition (old saved values may be outdated)
if (PRESETS[state.preset]) {
  state.settings = normalizeSettings({ ...structuredClone(PRESETS[state.preset]), debug: state.settings.debug, armorStand: state.settings.armorStand, gate: state.settings.gate, fancy: state.settings.fancy });
}
document.documentElement.lang = state.lang;
render();
