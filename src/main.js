/*! SleepyArmor Lite — Copyright (C) 2026 SamSoSleepy (SleepyShop)
 * SPDX-License-Identifier: GPL-3.0-only — free software, see LICENSE. */
import './style.css';
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
};
const t = (k) => STR[state.lang][k] ?? k;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
worker.onmessage = ({ data: m }) => {
  if (m.type === 'progress') setProgress(m.p, m.msg);
  else if (m.type === 'scanned') onScanned(m);
  else if (m.type === 'built') onBuilt(m);
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
  for (const k of keys) if (state.overrides[k]) overrides[k] = state.overrides[k];
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
  $('#result')?.scrollIntoView({ behavior: 'smooth' });
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
  store.set('settings', state.settings);
  store.set('overrides', state.overrides);
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

/** Settings form; `path` = 'g' for global or armor key for overrides. */
function settingsForm(s, path) {
  const lv = s.levels;
  let rows = `<div class="row"><b>${t('lod0')}</b><label>${t('until')} <input type="number" min="1" step="1" data-f="levels.0.distance" value="${lv[0].distance}"></label></div>`;
  for (let i = 1; i <= s.lodCount; i++) {
    const last = i === s.lodCount;
    rows += `<div class="row lv lv${i}"><b>${t('level')} ${i}</b>
      ${last ? '' : `<label>${t('until')} <input type="number" min="1" step="1" data-f="levels.${i}.distance" value="${lv[i].distance}"></label>`}
      <label>${t('res')} <select data-f="levels.${i}.resolution">${RESOLUTIONS.map((r) => opt(r, r * 100 + '%', lv[i].resolution)).join('')}</select></label>
      <label>${t('minCube')} <input type="number" min="0" step="0.5" data-f="levels.${i}.minCubeSize" value="${lv[i].minCubeSize}"></label>
      <label class="chk"><input type="checkbox" data-f="levels.${i}.dedupePlanes" ${lv[i].dedupePlanes ? 'checked' : ''}> ${t('dedupe')}</label></div>`;
  }
  const phys = [];
  for (let i = 0; i <= s.lodCount; i++) phys.push(opt(i, `${t('level')} ${i}`, s.physicsOffFrom));
  phys.push(opt(s.lodCount + 1, t('never'), s.physicsOffFrom));
  const errs = validateSettings(s);
  return `<div class="form" data-path="${esc(path)}">
    <label>${t('lodCount')} <select data-f="lodCount">${[1, 2, 3, 4].slice(0, MAX_LODS).map((n) => opt(n, n, s.lodCount)).join('')}</select></label>
    ${rows}
    <label>${t('physOff')} <select data-f="physicsOffFrom">${phys.join('')}</select></label>
    <div class="row"><label class="chk"><input type="checkbox" data-f="hide.enabled" ${s.hide.enabled ? 'checked' : ''}> ${t('hide')}</label>
      <input type="number" min="1" data-f="hide.distance" value="${s.hide.distance}" ${s.hide.enabled ? '' : 'disabled'}></div>
    ${errs.length ? `<p class="err">${t('errOrder')}</p>` : ''}
  </div>`;
}

function setField(obj, f, val) {
  const parts = f.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts.at(-1)] = val;
}

function render() {
  const s = state.settings;
  const sel = state.armors.filter((a) => state.selected.has(a.key) && isChosen(a));
  const mb = sel.reduce((sum, a) => sum + estimateExtraMB([a], settingsFor(s, state.overrides[a.key])), 0);
  const visible = state.armors.filter((a) => state.showAll || a.likelyArmor);
  const dupIds = new Set(state.duplicates.map((d) => d.identifier));

  $('#app').innerHTML = `
  <header>
    <h1>SleepyArmor <span>Lite</span></h1>
    <button id="lang" class="ghost">${state.lang === 'th' ? 'EN' : 'ไทย'}</button>
    <p>${t('tagline')}</p>
  </header>

  <section><h2>${t('s1')}</h2>
    <label class="file ${state.busy ? 'off' : ''}"><input id="files" type="file" multiple ${state.busy ? 'disabled' : ''}>${t('pick')}</label>
    <div id="progress" hidden><div class="track"><div id="bar"></div></div><small id="pmsg"></small></div>
    ${state.skipped.length ? `<details open><summary>${t('skipped')} (${state.skipped.length})</summary><ul>${state.skipped.map((x) => `<li>${esc(x.name)} — ${t('reason_' + x.reason)}</li>`).join('')}</ul></details>` : ''}
    ${state.warnings.length ? `<details><summary>${t('warnings')} (${state.warnings.length})</summary><ul class="small">${state.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
  </section>

  <section><h2>${t('s2')}</h2>
    ${!state.armors.length ? `<p class="muted">${t('none')}</p>` : `
    <div class="bar"><button id="all" class="ghost">${t('selAll')}</button><button id="nonesel" class="ghost">${t('selNone')}</button>
      <label class="chk"><input type="checkbox" id="showall" ${state.showAll ? 'checked' : ''}> ${t('showAll')}</label></div>
    ${state.duplicates.map((d) => `<div class="dup"><b>${t('dup')}</b> <code>${esc(d.identifier)}</code>${d.keys.map((k) => {
      const a = state.armors.find((x) => x.key === k);
      return `<label class="chk"><input type="radio" name="dup-${esc(d.identifier)}" data-dup="${esc(d.identifier)}" value="${esc(k)}" ${state.dupChoice[d.identifier] === k ? 'checked' : ''}> ${esc(a?.addonName || k)}</label>`;
    }).join('')}</div>`).join('')}
    <ul class="armors">${visible.map((a) => {
      const ov = state.overrides[a.key];
      const off = !isChosen(a);
      return `<li class="${off ? 'off' : ''}">
        <label class="chk main"><input type="checkbox" data-sel="${esc(a.key)}" ${state.selected.has(a.key) && !off ? 'checked' : ''} ${off ? 'disabled' : ''}>
          <span><b>${esc(a.identifier)}</b>${dupIds.has(a.identifier) ? ' ⚠️' : ''}<br><small>${esc(a.addonName)} · ${t('tex')} ${a.texW ? a.texW + '×' + a.texH : '?'} · ${a.cubeCount} ${t('cubes')} · ${t('molang')} ${a.molangLines}</small>
          ${a.warnings.length ? `<br><small class="warn">${a.warnings.map(esc).join('; ')}</small>` : ''}</span></label>
        <label class="chk"><input type="checkbox" data-ov="${esc(a.key)}" ${ov ? 'checked' : ''}> ${t('custom')}</label>
        ${ov ? settingsForm(normalizeSettings({ ...s, ...ov }), a.key) : ''}
      </li>`;
    }).join('')}</ul>`}
  </section>

  <section><h2>${t('s3')}</h2>
    <div class="bar">${t('presets')}: ${['saver', 'balanced', 'quality'].map((p) => `<button data-preset="${p}">${t('p_' + p)}</button>`).join('')}</div>
    ${settingsForm(s, 'g')}
    <div class="form" data-path="g">
      <label>${t('mem')} <select data-f="memoryMode">${['full', 'minimal', 'none'].map((m) => opt(m, t('mem_' + m), s.memoryMode)).join('')}</select></label>
      <label class="chk"><input type="checkbox" data-f="armorStand" ${s.armorStand ? 'checked' : ''}> ${t('stand')}</label>
      <label class="chk"><input type="checkbox" data-f="debug" ${s.debug ? 'checked' : ''}> ${t('debug')}</label>
    </div>
    <p class="mem">${t('memEst')} <b>${mb.toFixed(2)} MB</b></p>
  </section>

  <section><h2>${t('s4')}</h2>
    <button id="build" class="primary" ${state.busy ? 'disabled' : ''}>${state.busy ? t('building') : t('build')}${s.debug ? ' (DEBUG)' : ''}</button>
    ${state.result ? `<div id="result"><p>✅ ${t('done')} <b>${esc(state.result.fileName)}</b> (v1.0.${state.result.version}, ${(state.result.blob.size / 1048576).toFixed(2)} MB)</p>
      <a id="dl" class="btn primary" href="${state.result.url}" download="${esc(state.result.fileName)}">⬇️ ${t('download')}</a>
      <button id="share" class="btn">📤 ${t('share')}</button></div>` : ''}
    <p class="note">${t('note')}</p>
  </section>

  <section><h2>${t('s5')}</h2>
    <ul><li>🤖 ${t('android')}</li><li>🍎 ${t('ios')}</li><li>🎮 ${t('after')}</li><li>🧪 ${t('debugHelp')}</li></ul>
  </section>

  <footer>${t('footer')} · <a href="https://github.com/samsosleepy2007/Minecraft-bedrock-client-for-roleplay" target="_blank" rel="noopener">${t('source')}</a></footer>`;
}

// ---------- events (delegated) ----------
const app = document.getElementById('app');
app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'files') return onFiles([...el.files]);
  if (el.id === 'showall') state.showAll = el.checked;
  else if (el.dataset.sel) el.checked ? state.selected.add(el.dataset.sel) : state.selected.delete(el.dataset.sel);
  else if (el.dataset.dup) state.dupChoice[el.dataset.dup] = el.value;
  else if (el.dataset.ov) {
    if (el.checked) state.overrides[el.dataset.ov] = structuredClone(state.settings);
    else delete state.overrides[el.dataset.ov];
  } else if (el.dataset.f) {
    const path = el.closest('[data-path]').dataset.path;
    const target = path === 'g' ? state.settings : (state.overrides[path] = normalizeSettings({ ...state.settings, ...state.overrides[path] }));
    const v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' && el.dataset.f === 'memoryMode' ? el.value : Number(el.value);
    setField(target, el.dataset.f, v);
    const n = normalizeSettings(target);
    if (path === 'g') state.settings = n;
    else state.overrides[path] = n;
  } else return;
  save();
  render();
});
app.addEventListener('click', (e) => {
  const el = e.target.closest('button');
  if (!el) return;
  if (el.id === 'lang') {
    state.lang = state.lang === 'th' ? 'en' : 'th';
    store.set('lang', state.lang);
    document.documentElement.lang = state.lang;
  } else if (el.dataset.preset) {
    const keep = { debug: state.settings.debug, armorStand: state.settings.armorStand };
    state.settings = normalizeSettings({ ...structuredClone(PRESETS[el.dataset.preset]), ...keep });
    save();
  } else if (el.id === 'all') state.armors.forEach((a) => isChosen(a) && (state.showAll || a.likelyArmor) && state.selected.add(a.key));
  else if (el.id === 'nonesel') state.selected.clear();
  else if (el.id === 'build') return build();
  else if (el.id === 'share') return share();
  else return;
  render();
});

document.documentElement.lang = state.lang;
render();
