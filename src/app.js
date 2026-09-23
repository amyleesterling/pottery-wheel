// app.js — the wheel, the light, and everything you can do to it.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
  RINGS, CM_PER_UNIT, FORMS,
  makeProfile, sample, maxRadius, brush, center, relax, buildForm, match,
} from './profile.js';

import {
  PARTICLE_VERT, PARTICLE_FRAG, SHELL_VERT, SHELL_FRAG,
  WHEEL_VERT, WHEEL_FRAG, BEAM_VERT, BEAM_FRAG, MOTE_VERT, MOTE_FRAG,
} from './shaders.js';

// --- worlds of light ------------------------------------------------------

const WORLDS = [
  { id: 'kiln',  label: 'Kiln',  tint: 0x4668ff, accent: '#8AA3FF', bloom: 0.52 },
  { id: 'lab',   label: 'Lab',   tint: 0x16e6c8, accent: '#46E6CF', bloom: 0.44 },
  { id: 'nacre', label: 'Nacre', tint: 0xb59bff, accent: '#C6B3FF', bloom: 0.60 },
];

// Orton cone temperatures, approximate, for the firing readout.
const CONES = [
  [600, '022'], [840, '016'], [999, '06'], [1060, '04'],
  [1186, '3'], [1222, '6'], [1285, '10'],
];

const TOOLS = ['center', 'pull', 'press', 'smooth', 'ribs'];

// --- state ----------------------------------------------------------------

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = {
  profile: makeProfile(),
  height: 0.44,
  tool: 'pull',
  brushWidth: 0.085,
  rpm: reduced ? 0 : 42,
  world: 0,
  formIndex: 0,
  formNorm: new Float32Array(RINGS),
  heat: 0,
  condense: 0,
  firing: 0,          // seconds into the firing, 0 when not firing
  layers: { particles: true, shell: true, beam: true },
  orbitLock: false,
  spin: 0,
  az: 0.42, el: 0.16, dist: 1.42,
  azT: 0.42, elT: 0.16, distT: 1.42,
  framed: false,
};

function startingForm() {
  for (let i = 0; i < RINGS; i++) {
    const v = i / (RINGS - 1);
    const t = Math.max(0, (v - 0.90) / 0.10);
    const lip = 0.038 * t * t * (3 - 2 * t);
    S.profile[i] = 0.085 + 0.145 * Math.sin(Math.PI * (0.12 + 0.78 * v)) + lip;
  }
}
startingForm();

// --- three ----------------------------------------------------------------

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
renderer.setClearColor(0x06070a, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 40);
const camTarget = new THREE.Vector3(0, S.height * 0.52, 0);

// The profile lives in one half-float texture. A stroke uploads 192 values,
// and every shader reads the same ones.
const f32 = new Float32Array(1);
const i32 = new Int32Array(f32.buffer);
function toHalf(val) {
  f32[0] = val;
  const x = i32[0];
  let bits = (x >> 16) & 0x8000;
  let m = (x >> 12) & 0x07ff;
  const e = (x >> 23) & 0xff;
  if (e < 103) return bits;
  if (e > 142) { bits |= 0x7c00; bits |= ((e === 255) ? 0 : 1) && (x & 0x007fffff); return bits; }
  if (e < 113) { m |= 0x0800; bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1); return bits; }
  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
}

const halfData = new Uint16Array(RINGS);
const profTex = new THREE.DataTexture(halfData, RINGS, 1, THREE.RedFormat, THREE.HalfFloatType);
profTex.minFilter = THREE.LinearFilter;
profTex.magFilter = THREE.LinearFilter;
profTex.wrapS = THREE.ClampToEdgeWrapping;
profTex.wrapT = THREE.ClampToEdgeWrapping;
function uploadProfile() {
  for (let i = 0; i < RINGS; i++) halfData[i] = toHalf(S.profile[i]);
  profTex.needsUpdate = true;
}
uploadProfile();

const dpr = () => Math.min(window.devicePixelRatio || 1, 1.75);
const narrow = () => window.innerWidth < 720;
const aimY = () => S.height * (narrow() ? 0.30 : 0.52);

// --- the clay, as grains of light ----------------------------------------

const GRAINS = window.innerWidth < 760 ? 78000 : 240000;
const gGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(GRAINS * 3);
  const phase = new Float32Array(GRAINS);
  for (let i = 0; i < GRAINS; i++) {
    pos[i * 3 + 0] = Math.random();               // around the wheel
    pos[i * 3 + 1] = Math.random();               // up the wall
    pos[i * 3 + 2] = Math.random();               // through the wall
    phase[i] = Math.random();
  }
  gGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  gGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
}

const grainsMat = new THREE.ShaderMaterial({
  vertexShader: PARTICLE_VERT,
  fragmentShader: PARTICLE_FRAG,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uProfile: { value: profTex },
    uHeight: { value: S.height },
    uSpin: { value: 0 },
    uTime: { value: 0 },
    uWall: { value: 0.030 },
    uSize: { value: 2.4 },
    uHeat: { value: 0 },
    uCondense: { value: 0 },
    uDpr: { value: dpr() },
    uSwirl: { value: 1 },
    uWorld: { value: 0 },
    uOpacity: { value: 1 },
  },
});
const grains = new THREE.Points(gGeo, grainsMat);
grains.frustumCulled = false;
scene.add(grains);

// --- the hologram shell ---------------------------------------------------

const shellGeo = new THREE.CylinderGeometry(1, 1, 1, 180, RINGS - 1, true);
const shellMat = new THREE.ShaderMaterial({
  vertexShader: SHELL_VERT,
  fragmentShader: SHELL_FRAG,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uProfile: { value: profTex },
    uHeight: { value: S.height },
    uSpin: { value: 0 },
    uTime: { value: 0 },
    uHeat: { value: 0 },
    uWorld: { value: 0 },
    uOpacity: { value: 1 },
  },
});
const shell = new THREE.Mesh(shellGeo, shellMat);
shell.frustumCulled = false;
scene.add(shell);

// --- the wheel head, and a turned foot on the piece -----------------------

function discMaterial(tint) {
  return new THREE.ShaderMaterial({
    vertexShader: WHEEL_VERT,
    fragmentShader: WHEEL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uSpin: { value: 0 },
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uTint: { value: new THREE.Color(tint) },
    },
  });
}

const wheelMat = discMaterial(WORLDS[0].tint);
const wheel = new THREE.Mesh(new THREE.CircleGeometry(0.62, 128), wheelMat);
wheel.rotation.x = -Math.PI / 2;
scene.add(wheel);

const footMat = discMaterial(WORLDS[0].tint);
const foot = new THREE.Mesh(new THREE.CircleGeometry(1, 96), footMat);
foot.rotation.x = -Math.PI / 2;
foot.position.y = 0.0015;
scene.add(foot);

// --- the beam, and the dust that makes it visible -------------------------

const beamMat = new THREE.ShaderMaterial({
  vertexShader: BEAM_VERT,
  fragmentShader: BEAM_FRAG,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTint: { value: new THREE.Color(WORLDS[0].tint) },
    uHeat: { value: 0 },
    uStrength: { value: 0.5 },
  },
});
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.48, 0.95, 80, 1, true), beamMat);
beam.position.y = 0.475;
scene.add(beam);

const MOTES = 2600;
const moteGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(MOTES * 3);
  const phase = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    pos[i * 3 + 1] = Math.random();
    phase[i] = Math.random();
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
}
const moteMat = new THREE.ShaderMaterial({
  vertexShader: MOTE_VERT,
  fragmentShader: MOTE_FRAG,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uSpin: { value: 0 },
    uDpr: { value: dpr() },
    uTint: { value: new THREE.Color(WORLDS[0].tint) },
  },
});
const motes = new THREE.Points(moteGeo, moteMat);
motes.frustumCulled = false;
scene.add(motes);

// --- the reference form, held still while your clay turns -----------------

const ghostMat = new THREE.LineBasicMaterial({
  color: new THREE.Color(WORLDS[0].tint),
  transparent: true,
  opacity: 0.34,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
let ghost = null;

function buildGhost(norm) {
  if (ghost) { ghost.geometry.dispose(); scene.remove(ghost); ghost = null; }
  const LAT = 34, SEG = 90;
  const pts = [];
  for (let k = 0; k < LAT; k++) {
    const v = k / (LAT - 1);
    const r = sample(norm, v);
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2;
      const a1 = ((s + 1) / SEG) * Math.PI * 2;
      pts.push(r * Math.cos(a0), v, r * Math.sin(a0));
      pts.push(r * Math.cos(a1), v, r * Math.sin(a1));
    }
  }
  // two meridians, so the silhouette reads from any angle
  for (const a of [0, Math.PI / 2]) {
    for (let k = 0; k < RINGS - 1; k += 2) {
      const v0 = k / (RINGS - 1), v1 = (k + 2) / (RINGS - 1);
      pts.push(sample(norm, v0) * Math.cos(a), v0, sample(norm, v0) * Math.sin(a));
      pts.push(sample(norm, v1) * Math.cos(a), v1, sample(norm, v1) * Math.sin(a));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  ghost = new THREE.LineSegments(g, ghostMat);
  ghost.frustumCulled = false;
  scene.add(ghost);
}

// --- post -----------------------------------------------------------------

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.52, 0.55, 0.30);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(dpr());
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr());
  composer.setSize(w, h);
  bloom.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  grainsMat.uniforms.uDpr.value = dpr();
  moteMat.uniforms.uDpr.value = dpr();
}
// How far back the piece has to sit to fit the frame it actually has. A
// portrait phone is limited by width, a desktop window by height, and the
// console covers part of the bottom either way.
function fitDistance() {
  const halfV = Math.tan((camera.fov * Math.PI / 180) / 2);
  const deck = document.getElementById('console');
  const covered = deck ? deck.getBoundingClientRect().height * 0.7 : 0;
  const usable = Math.min(Math.max(1 - covered / window.innerHeight, 0.35), 0.9);

  const byHeight = (S.height * 0.62) / (halfV * usable);
  const byWidth = (Math.max(maxRadius(S.profile), 0.05) * 1.15) / (halfV * camera.aspect);
  return Math.min(Math.max(Math.max(byHeight, byWidth) * 1.4, 0.8), 3.2);
}

// Reframe on load and when the layout crosses the phone breakpoint. Not on
// every resize, so a zoom the user set is never thrown away.
let wasNarrow = null;
function frameForViewport() {
  const n = narrow();
  if (n === wasNarrow) return;
  wasNarrow = n;
  S.distT = fitDistance();
  if (!S.framed) { S.dist = S.distT; S.framed = true; }
}
addEventListener('resize', () => { resize(); frameForViewport(); });
resize();
frameForViewport();

// --- sculpting ------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const sectionPlane = new THREE.Plane();
const hit = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camFwd = new THREE.Vector3();

let dragging = null;   // 'sculpt' | 'orbit'
let last = null;
const pointers = new Map();

function sectionHit(ev) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  camera.getWorldDirection(camFwd);
  camFwd.y = 0;
  if (camFwd.lengthSq() < 1e-6) return null;
  camFwd.normalize();
  // The section plane faces the camera and contains the axis of the wheel.
  sectionPlane.setFromNormalAndCoplanarPoint(camFwd, new THREE.Vector3(0, 0, 0));
  if (!raycaster.ray.intersectPlane(sectionPlane, hit)) return null;
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  camRight.y = 0;
  camRight.normalize();
  return { h: hit.y, d: hit.dot(camRight) };
}

function applyStroke(cur) {
  const side = cur.d >= 0 ? 1 : -1;
  const v0 = Math.min(Math.max(cur.h / S.height, 0), 1);
  const dr = (cur.d - last.d) * side;

  if (S.tool === 'center') {
    center(S.profile, Math.min(Math.abs(dr) * 9 + 0.012, 0.22));
  } else {
    brush(S.profile, v0, S.brushWidth, dr, S.tool);
    // Pulling the wall upward raises the piece, the way it does on a wheel.
    if (S.tool === 'pull') {
      S.height = Math.min(Math.max(S.height + (cur.h - last.h) * 0.5, 0.12), 0.88);
    }
  }
  relax(S.profile, 0.09);
  uploadProfile();
  hideHint();
}

canvas.addEventListener('pointerdown', (ev) => {
  try { canvas.setPointerCapture(ev.pointerId); } catch (_) { /* not a live pointer */ }
  pointers.set(ev.pointerId, ev);
  if (pointers.size > 1 || ev.shiftKey || ev.button === 1 || ev.button === 2 || S.orbitLock) {
    dragging = 'orbit';
    last = { x: ev.clientX, y: ev.clientY };
  } else {
    const p = sectionHit(ev);
    if (!p) return;
    dragging = 'sculpt';
    last = p;
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  if (dragging === 'orbit') {
    S.azT -= (ev.clientX - last.x) * 0.006;
    S.elT = Math.min(Math.max(S.elT + (ev.clientY - last.y) * 0.004, -0.35), 0.95);
    last = { x: ev.clientX, y: ev.clientY };
    return;
  }
  const p = sectionHit(ev);
  if (!p) return;
  applyStroke(p);
  last = p;
});

function endDrag(ev) {
  pointers.delete(ev.pointerId);
  if (pointers.size === 0) { dragging = null; last = null; }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  S.distT = Math.min(Math.max(S.distT + ev.deltaY * 0.0012, 0.55), 3.2);
}, { passive: false });

// --- firing ---------------------------------------------------------------

let fireT = -1;
function fire() {
  if (fireT >= 0) return;
  fireT = 0;
  document.getElementById('fire').disabled = true;
}
function stepFire(dt) {
  if (fireT < 0) return;
  fireT += dt;
  const RAMP = 4.0, HOLD = 1.4, COOL = 3.4;
  if (fireT < RAMP) {
    S.heat = fireT / RAMP;
  } else if (fireT < RAMP + HOLD) {
    S.heat = 1;
  } else if (fireT < RAMP + HOLD + COOL) {
    S.heat = 1 - (fireT - RAMP - HOLD) / COOL;
  } else {
    S.heat = 0;
    fireT = -1;
    document.getElementById('fire').disabled = false;
  }
  S.condense = Math.max(S.condense, Math.min(S.heat * 1.6, 1));
}

// --- UI -------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const hint = $('hint');
let hintGone = false;
function hideHint() {
  if (hintGone) return;
  hintGone = true;
  hint.style.opacity = '0';
  setTimeout(() => { hint.hidden = true; }, 700);
}

function chip(label, active, onClick, title) {
  const b = document.createElement('button');
  b.className = 'chip' + (active ? ' on' : '');
  b.textContent = label;
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function renderTools() {
  const host = $('tools');
  host.textContent = '';
  const help = {
    center: 'Bring the whole wall onto one true radius',
    pull: 'Draw the wall out, and upward to raise the piece',
    press: 'Press the wall in toward the axis',
    smooth: 'Even out the band under your finger',
    ribs: 'Throwing rings, the spiral a hand leaves in the wall',
  };
  TOOLS.forEach((t, i) => {
    host.appendChild(chip(t, S.tool === t, () => { S.tool = t; renderTools(); }, `${i + 1}  ${help[t]}`));
  });
}

function renderWorlds() {
  const host = $('worlds');
  host.textContent = '';
  WORLDS.forEach((w, i) => {
    host.appendChild(chip(w.label, S.world === i, () => setWorld(i)));
  });
}

function renderLayers() {
  const host = $('layers');
  host.textContent = '';
  for (const k of ['particles', 'shell', 'beam']) {
    host.appendChild(chip(k, S.layers[k], () => { S.layers[k] = !S.layers[k]; renderLayers(); }));
  }
}

function renderForms() {
  const host = $('forms');
  host.textContent = '';
  FORMS.forEach((f, i) => {
    const b = chip(f.name, S.formIndex === i, () => setForm(i),
      f.pts ? `${f.culture}, ${f.period}, typically about ${f.heightCm} cm tall` : 'Throw without a reference');
    host.appendChild(b);
  });
}

function setWorld(i) {
  S.world = i;
  const w = WORLDS[i];
  const c = new THREE.Color(w.tint);
  wheelMat.uniforms.uTint.value.copy(c);
  footMat.uniforms.uTint.value.copy(c);
  beamMat.uniforms.uTint.value.copy(c);
  moteMat.uniforms.uTint.value.copy(c);
  ghostMat.color.copy(c);
  grainsMat.uniforms.uWorld.value = i;
  shellMat.uniforms.uWorld.value = i;
  bloom.strength = w.bloom;
  document.documentElement.style.setProperty('--accent', w.accent);
  renderWorlds();
}

function setForm(i) {
  S.formIndex = i;
  const f = FORMS[i];
  S.formNorm = buildForm(f);
  if (ghost) { ghost.geometry.dispose(); scene.remove(ghost); ghost = null; }
  if (f.pts) buildGhost(S.formNorm);
  $('form-note').textContent = f.pts
    ? `${f.culture}. ${f.period}. Stylized profile, not a measured drawing.`
    : 'No reference. The wheel is yours.';
  renderForms();
}

function reset() {
  S.profile.fill(0.155);
  S.height = 0.40;
  S.condense = 0;
  S.heat = 0;
  fireT = -1;
  $('fire').disabled = false;
  uploadProfile();
}

$('fire').addEventListener('click', fire);
$('reset').addEventListener('click', reset);
$('orbit').addEventListener('click', (e) => {
  S.orbitLock = !S.orbitLock;
  e.currentTarget.classList.toggle('on', S.orbitLock);
  e.currentTarget.setAttribute('aria-pressed', String(S.orbitLock));
});

$('brush').addEventListener('input', (e) => {
  S.brushWidth = Number(e.target.value) / 1000;
  $('brush-val').textContent = Math.round(S.brushWidth * 200) + '%';
});
$('rpm').addEventListener('input', (e) => { S.rpm = Number(e.target.value); });

addEventListener('keydown', (e) => {
  if (e.target.matches('input, button')) return;
  const n = Number(e.key);
  if (n >= 1 && n <= TOOLS.length) { S.tool = TOOLS[n - 1]; renderTools(); }
  else if (e.key === ' ') { e.preventDefault(); fire(); }
  else if (e.key.toLowerCase() === 'r') reset();
});

renderTools(); renderWorlds(); renderLayers(); renderForms();
setWorld(0); setForm(0);
$('brush-val').textContent = Math.round(S.brushWidth * 200) + '%';

// --- readout --------------------------------------------------------------

function coneFor(tempC) {
  let c = null;
  for (const [t, name] of CONES) if (tempC >= t) c = name;
  return c;
}

let readAcc = 0;
function updateReadout() {
  const mr = maxRadius(S.profile);
  $('r-height').textContent = (S.height * CM_PER_UNIT).toFixed(1);
  $('r-width').textContent = (mr * 2 * CM_PER_UNIT).toFixed(1);
  $('r-rpm').textContent = Math.round(S.rpm);

  const tempC = Math.round(20 + S.heat * 1265);
  const cone = coneFor(tempC);
  $('r-kiln').textContent = S.heat > 0.01 ? `${tempC}` : (S.condense > 0 ? 'fired' : 'cold');
  $('r-cone').textContent = cone ? `cone ${cone}` : (S.condense > 0 ? 'bisque' : 'greenware');
  $('r-kiln').classList.toggle('hot', S.heat > 0.15);

  const f = FORMS[S.formIndex];
  const m = match(S.profile, S.height, f, S.formNorm);
  $('match-row').hidden = !m;
  if (m) {
    $('r-match').textContent = m.total + '%';
    $('r-match-sub').textContent = `shape ${m.shape} · proportion ${m.proportion}`;
  } else {
    $('r-match-sub').textContent = '';
  }
}

// --- loop -----------------------------------------------------------------

const clock = new THREE.Clock();
let drift = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  stepFire(dt);
  S.spin += (S.rpm / 60) * Math.PI * 2 * dt;

  // camera
  if (!reduced && !dragging) drift += dt * 0.02;
  const az = S.az += (S.azT + Math.sin(drift) * 0.07 - S.az) * 0.07;
  const el = S.el += (S.elT - S.el) * 0.07;
  const di = S.dist += (S.distT - S.dist) * 0.08;
  camera.position.set(
    Math.sin(az) * Math.cos(el) * di,
    S.height * 0.52 + Math.sin(el) * di,
    Math.cos(az) * Math.cos(el) * di,
  );
  camTarget.y += (aimY() - camTarget.y) * 0.08;
  camera.lookAt(camTarget);

  // uniforms
  const heat = S.heat;
  for (const m of [grainsMat, shellMat]) {
    m.uniforms.uTime.value = t;
    m.uniforms.uSpin.value = S.spin;
    m.uniforms.uHeight.value = S.height;
    m.uniforms.uHeat.value = heat;
  }
  grainsMat.uniforms.uCondense.value = S.condense;
  grainsMat.uniforms.uWall.value = 0.030 + (S.tool === 'ribs' ? 0.004 : 0);
  shellMat.uniforms.uOpacity.value = 0.65 + S.condense * 0.85;
  grainsMat.uniforms.uOpacity.value = 1 - S.condense * 0.25;

  wheelMat.uniforms.uSpin.value = S.spin;
  wheelMat.uniforms.uTime.value = t;
  wheelMat.uniforms.uHeat.value = heat * 0.6;
  footMat.uniforms.uSpin.value = S.spin;
  footMat.uniforms.uTime.value = t;
  footMat.uniforms.uHeat.value = heat;
  const fr = Math.max(S.profile[0], 0.02) * 1.03;
  foot.scale.set(fr, 1, fr);

  beamMat.uniforms.uHeat.value = heat;
  beamMat.uniforms.uStrength.value = 0.16 + heat * 0.30;
  moteMat.uniforms.uTime.value = t;
  moteMat.uniforms.uSpin.value = S.spin;

  grains.visible = S.layers.particles;
  shell.visible = S.layers.shell;
  beam.visible = S.layers.beam;
  motes.visible = S.layers.beam;

  if (ghost) {
    const gr = S.height / (2 * FORMS[S.formIndex].aspect);
    ghost.scale.set(gr, S.height, gr);
    ghostMat.opacity = 0.30 * (1 - S.condense * 0.6);
  }

  readAcc += dt;
  if (readAcc > 0.12) { readAcc = 0; updateReadout(); }

  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Keep the piece across a republish, if the host supports it.
try {
  const hot = window.claude?.hot;
  if (hot) {
    hot.snapshot?.(() => ({
      profile: Array.from(S.profile), height: S.height,
      world: S.world, formIndex: S.formIndex, condense: S.condense,
    }));
    const boot = (d) => {
      if (!d || !d.profile) return;
      S.profile.set(d.profile);
      S.height = d.height ?? S.height;
      S.condense = d.condense ?? 0;
      uploadProfile();
      setWorld(d.world ?? 0);
      setForm(d.formIndex ?? 0);
      hideHint();
    };
    hot.ready ? hot.ready(boot) : boot(hot.data);
  }
} catch (_) { /* the page works without it */ }
