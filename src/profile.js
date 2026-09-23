// profile.js
// One source of truth for the form. Everything on screen (particles, shell,
// ghost, score, readout) reads this same array. Never a second copy.

export const RINGS = 192;        // rings sampled up the wall
export const CM_PER_UNIT = 70;   // world unit -> centimetres
export const R_MIN = 0.012;
export const R_MAX = 0.46;

export function makeProfile(r = 0.16) {
  const p = new Float32Array(RINGS);
  p.fill(r);
  return p;
}

export function sample(p, v) {
  const x = Math.min(Math.max(v, 0), 1) * (RINGS - 1);
  const i = Math.floor(x);
  if (i >= RINGS - 1) return p[RINGS - 1];
  const f = x - i;
  return p[i] * (1 - f) + p[i + 1] * f;
}

export function maxRadius(p) {
  let m = 0;
  for (let i = 0; i < RINGS; i++) if (p[i] > m) m = p[i];
  return m;
}

// A stroke. v0 is where the finger sits on the wall, sigma how much wall it
// touches, delta how far it moved in the radial direction.
export function brush(p, v0, sigma, delta, mode) {
  const inv = 1 / (2 * sigma * sigma);
  const mag = Math.abs(delta);
  const prev = mode === 'smooth' ? Float32Array.from(p) : null;
  for (let i = 0; i < RINGS; i++) {
    const v = i / (RINGS - 1);
    const d = v - v0;
    const w = Math.exp(-d * d * inv);
    if (w < 0.0025) continue;
    let dr = 0;
    switch (mode) {
      case 'pull':   dr = delta * w; break;
      case 'press':  dr = -mag * w; break;
      case 'ribs':   dr = mag * w * Math.sin(v * 95.0) * 1.6; break;
      case 'smooth': {
        const a = prev[Math.max(i - 4, 0)];
        const b = prev[Math.min(i + 4, RINGS - 1)];
        dr = ((a + b) * 0.5 - prev[i]) * w * 0.6;
        break;
      }
    }
    p[i] = Math.min(Math.max(p[i] + dr, R_MIN), R_MAX);
  }
}

// Centering: the first thing that happens on a real wheel. Pulls the whole
// wall toward one true radius.
export function center(p, amt) {
  let m = 0;
  for (let i = 0; i < RINGS; i++) m += p[i];
  m /= RINGS;
  for (let i = 0; i < RINGS; i++) p[i] += (m - p[i]) * amt;
}

// The wheel itself trues the form a little on every rotation.
export function relax(p, amt) {
  const t = Float32Array.from(p);
  for (let i = 1; i < RINGS - 1; i++) {
    p[i] = t[i] + ((t[i - 1] + t[i + 1]) * 0.5 - t[i]) * amt;
  }
  p[0] = t[0] + (t[1] - t[0]) * amt;
  p[RINGS - 1] = t[RINGS - 1] + (t[RINGS - 2] - t[RINGS - 1]) * amt;
}

// --- Historic forms -------------------------------------------------------
// These are stylized profiles drawn by eye from the general shape of each
// vessel type. They are not measured archaeological drawings, and the heights
// are typical ranges for the type rather than a specific object.

export const FORMS = [
  {
    id: 'free', name: 'Free', culture: 'No reference', period: '',
    heightCm: 0, pts: null,
  },
  {
    id: 'amphora', aspect: 1.55, name: 'Amphora', culture: 'Greek, Attic', period: 'about 530 BCE',
    heightCm: 45,
    pts: [[0,.44],[.05,.33],[.12,.50],[.30,.91],[.42,1.0],[.55,.88],[.70,.62],[.80,.44],[.88,.40],[.96,.46],[1,.59]],
  },
  {
    id: 'aryballos', aspect: 1.05, name: 'Aryballos', culture: 'Corinthian', period: 'about 600 BCE',
    heightCm: 7,
    pts: [[0,.30],[.10,.62],[.30,.92],[.45,1.0],[.62,.88],[.75,.55],[.84,.26],[.92,.22],[.96,.30],[1,.58]],
  },
  {
    id: 'moonjar', aspect: 1.02, name: 'Moon jar', culture: 'Korean, Joseon', period: '18th century',
    heightCm: 44,
    pts: [[0,.34],[.08,.52],[.22,.78],[.40,.95],[.50,1.0],[.62,.96],[.78,.80],[.90,.55],[.97,.40],[1,.38]],
  },
  {
    id: 'hydria', aspect: 1.4, name: 'Hydria', culture: 'Greek', period: 'about 500 BCE',
    heightCm: 42,
    pts: [[0,.38],[.06,.32],[.14,.54],[.30,.89],[.42,1.0],[.50,.97],[.62,.84],[.72,.62],[.80,.41],[.90,.35],[.97,.41],[1,.51]],
  },
  {
    id: 'olla', aspect: 0.82, name: 'Olla', culture: 'Ancestral Puebloan', period: 'about 1100 CE',
    heightCm: 30,
    pts: [[0,.18],[.08,.44],[.20,.70],[.35,.90],[.48,1.0],[.60,.97],[.72,.82],[.84,.58],[.93,.42],[1,.40]],
  },
  {
    id: 'jomon', aspect: 1.25, name: 'Jomon vessel', culture: 'Japan, Middle Jomon', period: 'about 3000 BCE',
    heightCm: 35,
    pts: [[0,.38],[.15,.44],[.35,.56],[.55,.68],[.72,.80],[.86,.90],[.95,.97],[1,1.0]],
  },
  {
    id: 'lekythos', aspect: 2.85, name: 'Lekythos', culture: 'Greek, Attic', period: 'about 460 BCE',
    heightCm: 33,
    pts: [[0,.66],[.05,.56],[.12,.86],[.30,.96],[.50,1.0],[.62,.96],[.70,.80],[.78,.46],[.86,.33],[.93,.33],[.97,.46],[1,.66]],
  },
];

function curve(pts, v) {
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1][0] < v) i++;
  const p1 = pts[i], p2 = pts[i + 1];
  const p0 = pts[Math.max(i - 1, 0)], p3 = pts[Math.min(i + 2, pts.length - 1)];
  const span = Math.max(p2[0] - p1[0], 1e-6);
  const t = Math.min(Math.max((v - p1[0]) / span, 0), 1);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1[1]) +
    (-p0[1] + p2[1]) * t +
    (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
    (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
}

// Normalized radius, peak 1.0.
export function buildForm(form) {
  const out = new Float32Array(RINGS);
  if (!form.pts) return out;
  let m = 0;
  for (let i = 0; i < RINGS; i++) {
    const r = Math.max(curve(form.pts, i / (RINGS - 1)), 0.02);
    out[i] = r;
    if (r > m) m = r;
  }
  for (let i = 0; i < RINGS; i++) out[i] /= m;
  return out;
}

// How close the silhouette is. Two honest, separate terms: the shape of the
// normalized curve, and the proportion of height to width.
export function match(p, heightUnits, form, formNorm) {
  if (!form.pts) return null;
  const pm = maxRadius(p);
  if (pm <= 0) return null;

  // Shape: how far the normalized curve sits from the reference curve.
  let acc = 0;
  for (let i = 0; i < RINGS; i++) acc += Math.abs(p[i] / pm - formNorm[i]);
  const shape = Math.max(0, 1 - (acc / RINGS) / 0.25);

  // Proportion: height over widest diameter, against the reference aspect.
  const userAspect = heightUnits / (pm * 2);
  const prop = Math.max(0, 1 - Math.abs(Math.log(userAspect / form.aspect)) / 0.6);

  return {
    shape: Math.round(shape * 100),
    proportion: Math.round(prop * 100),
    total: Math.round((shape * 0.7 + prop * 0.3) * 100),
  };
}
