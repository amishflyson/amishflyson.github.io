#!/usr/bin/env node
// Checks a Refract Motion project file against catalog.json before it goes to the inbox.
//
//   node validate.mjs my-edit.refract.json          report problems
//   node validate.mjs my-edit.refract.json --fix    also fill missing defaults, ids and key order
//
// No dependencies. Exit code 1 when there are errors the app would trip over.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const fix = args.includes('--fix');
if (!file) {
  console.error('usage: node validate.mjs <project.refract.json> [--fix]');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8'));
const effects = new Map(catalog.effects.map((e) => [e.id, e]));
const transitions = new Map(catalog.transitions.map((t) => [t.id, t]));
const textAnims = new Map(catalog.textAnimations.map((a) => [a.id, a]));
const fonts = new Set(catalog.fonts.map((f) => f.family));
const eases = new Set(catalog.ease.presets);
const blends = new Set(catalog.blendModes);
const modTypes = new Map(catalog.modifiers.map((m) => [m.type, m]));

const errors = [];
const warnings = [];
let fixed = 0;
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);
const rid = () => Math.random().toString(36).slice(2, 10);
const dims = (p) => (Array.isArray(p.default) ? p.default.length : 1);
const arr = (v) => (Array.isArray(v) ? v.slice() : [v]);

const raw = JSON.parse(readFileSync(file, 'utf8'));
const doc = raw.project ? raw : { format: 'refract-project', version: 2, project: raw };
const P = doc.project;
if (doc.format !== 'refract-project') warn('file', 'missing format: "refract-project"');
if (!P || !P.compositions || !P.mainCompId) {
  err('project', 'needs compositions and mainCompId');
  report();
}
if (!P.compositions[P.mainCompId]) err('project', `mainCompId "${P.mainCompId}" is not in compositions`);

const ids = new Map();
function claim(id, where) {
  if (typeof id !== 'string' || !id) {
    if (fix) { fixed++; return rid(); }
    err(where, 'missing id');
    return id;
  }
  if (ids.has(id)) {
    if (fix) { fixed++; const n = rid(); warn(where, `duplicate id "${id}" renamed to "${n}"`); return n; }
    err(where, `duplicate id "${id}" (also at ${ids.get(id)})`);
  }
  ids.set(id, where);
  return id;
}

function checkEase(e, where) {
  if (!e || typeof e !== 'object') return err(where, 'keyframe needs an ease');
  if (e.type === 'preset' && !eases.has(e.name)) err(where, `unknown ease "${e.name}" (use e.g. "cubic.inOut")`);
  if (!['linear', 'hold', 'bezier', 'preset', 'spring'].includes(e.type)) err(where, `unknown ease type "${e.type}"`);
}

/** A Prop: { value: number[], keys?: Keyframe[], mods?: Modifier[] }. */
function checkProp(p, where, n) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.value)) return err(where, 'must be { value: [numbers] }');
  if (p.value.some((x) => typeof x !== 'number' || !Number.isFinite(x))) err(where, 'value must be finite numbers');
  if (n && p.value.length !== n) err(where, `value needs ${n} number(s), has ${p.value.length}`);
  if (p.keys) {
    if (!Array.isArray(p.keys)) return err(where, 'keys must be an array');
    for (const [i, k] of p.keys.entries()) {
      k.id = claim(k.id, `${where}.keys[${i}]`);
      if (typeof k.t !== 'number') err(`${where}.keys[${i}]`, 't (seconds) must be a number');
      if (!Array.isArray(k.v) || k.v.length !== p.value.length) err(`${where}.keys[${i}]`, `v needs ${p.value.length} number(s)`);
      checkEase(k.ease, `${where}.keys[${i}].ease`);
    }
    const sorted = [...p.keys].sort((a, b) => a.t - b.t);
    if (sorted.some((k, i) => k !== p.keys[i])) {
      if (fix) { p.keys = sorted; fixed++; } else err(where, 'keys must be sorted by t');
    }
  }
  if (p.mods) {
    for (const [i, m] of p.mods.entries()) {
      m.id = claim(m.id, `${where}.mods[${i}]`);
      const def = modTypes.get(m.type);
      if (!def) { err(`${where}.mods[${i}]`, `unknown modifier "${m.type}"`); continue; }
      if (m.enabled === undefined) { if (fix) { m.enabled = true; fixed++; } else err(`${where}.mods[${i}]`, 'needs enabled: true'); }
      m.params ??= {};
      for (const pd of def.params) if (m.params[pd.id] === undefined) { if (fix) { m.params[pd.id] = pd.default; fixed++; } else warn(`${where}.mods[${i}]`, `missing param ${pd.id}`); }
    }
  }
}

function checkParams(params, defs, where) {
  for (const k of Object.keys(params)) if (!defs.some((d) => d.id === k)) err(where, `unknown param "${k}" (valid: ${defs.map((d) => d.id).join(', ')})`);
  for (const d of defs) {
    if (!params[d.id]) {
      if (fix) { params[d.id] = { value: arr(d.default) }; fixed++; } else warn(where, `missing param "${d.id}" (default ${JSON.stringify(d.default)})`);
      continue;
    }
    checkProp(params[d.id], `${where}.${d.id}`, dims(d));
    const v = params[d.id].value?.[0];
    if (d.type === 'enum' && d.options && !d.options.some((o) => o.value === v)) err(`${where}.${d.id}`, `enum value ${v} not one of ${d.options.map((o) => `${o.value}=${o.label}`).join(', ')}`);
  }
}

const FIELD = () => ({ mode: 'none', falloff: 'smooth', invert: false, center: { value: [0.5, 0.5] }, radius: { value: [0.5] }, feather: { value: [0.5] }, aspect: { value: [1] }, angle: { value: [0] }, ring: { value: [0.2] } });

function checkEffect(e, where) {
  e.id = claim(e.id, where);
  const def = effects.get(e.type);
  if (!def) return err(where, `unknown effect "${e.type}"`);
  if (e.enabled === undefined) { if (fix) { e.enabled = true; fixed++; } else err(where, 'needs enabled'); }
  if (!e.mix) { if (fix) { e.mix = { value: [1] }; fixed++; } else err(where, 'needs mix: { value: [1] }'); } else checkProp(e.mix, `${where}.mix`, 1);
  if (!e.blend) { if (fix) { e.blend = 'normal'; fixed++; } else err(where, 'needs blend'); } else if (!blends.has(e.blend)) err(where, `unknown blend "${e.blend}"`);
  if (!e.field) { if (fix) { e.field = FIELD(); fixed++; } else err(where, 'needs field (use mode "none")'); }
  else {
    const f = FIELD();
    for (const k of Object.keys(f)) if (e.field[k] === undefined) { if (fix) { e.field[k] = f[k]; fixed++; } else err(`${where}.field`, `missing ${k}`); }
    if (!['none', 'radial', 'ring', 'linear', 'mask'].includes(e.field.mode)) err(`${where}.field`, `unknown mode "${e.field.mode}"`);
  }
  e.params ??= {};
  checkParams(e.params, def.params, `${where}(${e.type})`);
}

for (const [cid, c] of Object.entries(P.compositions)) {
  const cw = `comp ${c.name ?? cid}`;
  for (const k of ['width', 'height', 'fps', 'duration']) if (typeof c[k] !== 'number' || c[k] <= 0) err(cw, `${k} must be a positive number`);
  if (!Array.isArray(c.layers)) { err(cw, 'layers must be an array'); continue; }
  const layerIds = new Set(c.layers.map((l) => l.id));
  for (const l of c.layers) {
    const w = `layer "${l.name ?? l.id}"`;
    l.id = claim(l.id, w);
    if (!['media', 'text', 'shape', 'solid', 'adjustment', 'audio', 'merge', 'transition'].includes(l.kind)) err(w, `unknown kind "${l.kind}"`);
    if (!(l.outPoint > l.inPoint)) err(w, 'outPoint must be after inPoint');
    if (l.inPoint < 0 || l.outPoint > c.duration + 1e-6) warn(w, `runs ${l.inPoint}–${l.outPoint}s outside the comp (0–${c.duration}s)`);
    if (!blends.has(l.blend)) err(w, `unknown blend "${l.blend}"`);
    const tf = l.transform;
    if (!tf) err(w, 'needs transform');
    else {
      checkProp(tf.position, `${w}.position`, 2); checkProp(tf.scale, `${w}.scale`, 2); checkProp(tf.rotation, `${w}.rotation`, 1);
      checkProp(tf.anchor, `${w}.anchor`, 2); checkProp(tf.opacity, `${w}.opacity`, 1);
    }
    for (const [i, e] of (l.effects ?? []).entries()) checkEffect(e, `${w}.effects[${i}]`);
    if (!Array.isArray(l.effects)) { if (fix) { l.effects = []; fixed++; } else err(w, 'effects must be an array'); }
    if (l.kind === 'text') {
      const t = l.text;
      if (!t) err(w, 'text layer needs text');
      else {
        if (typeof t.content !== 'string') err(w, 'text.content must be a string');
        if (!fonts.has(t.font)) warn(w, `font "${t.font}" is not built in (fine only if it was uploaded on the device)`);
        for (const k of ['size', 'tracking', 'leading', 'strokeWidth']) checkProp(t[k], `${w}.text.${k}`, 1);
        checkProp(t.fill, `${w}.text.fill`, 4); checkProp(t.stroke, `${w}.text.stroke`, 4);
        if (t.trace) {
          const tr = t.trace;
          for (const k of ['progress', 'overlap', 'jitter', 'noise', 'distress', 'width']) checkProp(tr[k], `${w}.text.trace.${k}`, 1);
          if (!['forward', 'backward', 'center', 'random', 'together'].includes(tr.order)) err(w, `text.trace.order must be forward, backward, center, random or together`);
          const d = { on: true, reverse: false, fillAfter: true, seed: 1 };
          for (const [k, v] of Object.entries(d)) if (tr[k] === undefined) { if (fix) { tr[k] = v; fixed++; } else err(`${w}.text.trace`, `missing ${k}`); }
        }
        for (const [i, a] of (t.animators ?? []).entries()) {
          a.id = claim(a.id, `${w}.animators[${i}]`);
          const def = textAnims.get(a.type);
          if (!def) { err(`${w}.animators[${i}]`, `unknown text animation "${a.type}"`); continue; }
          const d = { enabled: true, unit: def.defaults.unit, order: 'forward', delay: 0, duration: def.defaults.duration, stagger: def.defaults.stagger, amount: 1 };
          for (const [k, v] of Object.entries(d)) if (a[k] === undefined) { if (fix) { a[k] = v; fixed++; } else err(`${w}.animators[${i}]`, `missing ${k}`); }
        }
      }
    }
    if (l.kind === 'shape') {
      const s = l.shape;
      if (!s) err(w, 'shape layer needs shape');
      else {
        if (!['rect', 'ellipse', 'polygon', 'star', 'line', 'cross', 'target', 'brackets', 'scribble'].includes(s.kind)) err(w, `unknown shape "${s.kind}"`);
        checkProp(s.size, `${w}.shape.size`, 2); checkProp(s.fill, `${w}.shape.fill`, 4); checkProp(s.stroke, `${w}.shape.stroke`, 4);
        for (const k of ['radius', 'sides', 'innerRatio', 'strokeWidth']) checkProp(s[k], `${w}.shape.${k}`, 1);
        const trim = { trimStart: 0, trimEnd: 1, trimOffset: 0, rough: 0 };
        for (const [k, v] of Object.entries(trim)) {
          if (s[k] === undefined) { if (fix) { s[k] = { value: [v] }; fixed++; } }
          else checkProp(s[k], `${w}.shape.${k}`, 1);
        }
      }
    }
    if (l.kind === 'solid' && !l.solid) err(w, 'solid layer needs solid');
    if (l.kind === 'media' && !l.assetId) err(w, 'media layer needs assetId (media can only come from the device)');
    for (const [i, m] of (l.masks ?? []).entries()) {
      const mw = `${w}.masks[${i}]`;
      m.id = claim(m.id, mw);
      if (!['rect', 'ellipse', 'path'].includes(m.kind)) err(mw, `unknown kind "${m.kind}"`);
      if (!['add', 'subtract', 'intersect'].includes(m.mode)) err(mw, `unknown mode "${m.mode}"`);
      checkProp(m.box, `${mw}.box`, 4);
      for (const k of ['roundness', 'feather', 'expansion', 'opacity']) checkProp(m[k], `${mw}.${k}`, 1);
      checkProp(m.path, `${mw}.path`);
      if (m.path?.value && m.path.value.length % 6) err(`${mw}.path`, 'path needs 6 numbers per point [x, y, inX, inY, outX, outY]');
    }
    if (l.matte && !layerIds.has(l.matte.layerId)) err(w, `matte layer "${l.matte.layerId}" not found`);
    if (l.timeFps !== undefined && !(l.timeFps >= 0)) err(w, 'timeFps must be a number ≥ 0 (0 = off)');
    if (l.motionBlur && !(l.motionBlur.shutter > 0 && l.motionBlur.samples >= 2)) err(w, 'motionBlur needs { on, shutter (degrees, e.g. 180), samples (2–32) }');
    if (l.track !== undefined && typeof l.track !== 'string') err(w, 'track must be a string id shared by the clips on one row');
    if (l.kind === 'merge') {
      if (!l.merge) err(w, 'merge layer needs merge');
      else for (const id of l.merge.members ?? []) if (!layerIds.has(id)) err(w, `merge member "${id}" not found`);
    }
    if (l.kind === 'transition') {
      const t = l.transition;
      const def = t && transitions.get(t.type);
      if (!t) err(w, 'transition layer needs transition');
      else if (!def) err(w, `unknown transition "${t.type}"`);
      else {
        for (const k of ['from', 'to']) if (!layerIds.has(t[k])) err(w, `transition ${k} layer "${t[k]}" not found`);
        t.params ??= {};
        checkParams(t.params, def.params, `${w}(${t.type})`);
      }
    }
  }
}

report();

function report() {
  for (const w of warnings) console.log(`  warn  ${w}`);
  for (const e of errors) console.log(`  ERROR ${e}`);
  if (fix && fixed) {
    writeFileSync(file, JSON.stringify(doc, null, 1));
    console.log(`fixed ${fixed} thing(s) and saved ${file}`);
  }
  console.log(errors.length ? `${errors.length} error(s), ${warnings.length} warning(s)` : `OK — ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
