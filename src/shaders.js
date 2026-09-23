// shaders.js
// Colour is authored linear. The composer's OutputPass applies tone mapping
// and the sRGB transfer, so nothing here encodes anything itself.

const COMMON = /* glsl */`
  #define TAU 6.28318530718

  // radius of the wall at height v, read from the profile texture
  float wallAt(sampler2D prof, float v) {
    return texture2D(prof, vec2(clamp(v, 0.0, 1.0), 0.5)).r;
  }

  vec3 hue(float h) {
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }

  // Three worlds of light. t is temperature 0..1, f is the grazing term.
  vec3 worldColour(int world, float t, float f, float v, float seed, float time) {
    if (world == 0) {
      // Kiln. Wet clay reads cold; the heat climbs from the foot upward.
      float h = clamp(t * 1.4 - v * 0.30, 0.0, 1.0);
      vec3 wet   = vec3(0.055, 0.180, 0.760);
      vec3 glow  = vec3(1.000, 0.520, 0.110);
      vec3 ember = vec3(1.000, 0.130, 0.020);
      vec3 c = mix(wet, glow, smoothstep(0.0, 0.62, h));
      c = mix(c, ember, smoothstep(0.58, 1.0, h));
      return c + f * 0.55 * mix(vec3(0.45, 0.72, 1.0), vec3(1.0, 0.85, 0.6), h);
    }
    if (world == 1) {
      // Lab. A scanning rig: sweep lines plus a calibration tick every ring.
      float scan = 0.55 + 0.45 * sin(v * 250.0 - time * 1.1);
      float tick = step(0.955, fract(v * 24.0));
      vec3 c = vec3(0.075, 0.900, 0.760) * (0.42 + 0.72 * scan);
      c += vec3(0.55, 1.0, 0.94) * tick * 0.55;
      c = mix(c, vec3(1.0, 0.94, 0.78), t * 0.82);
      return c + f * 0.40;
    }
    // Nacre. Thin film: the hue turns with the angle you see it from.
    float h = fract(f * 1.55 + v * 0.42 + seed * 0.11 + time * 0.012);
    vec3 c = hue(h) * 0.85 + 0.12;
    return mix(c, vec3(1.0, 0.76, 0.48), t * 0.6) + f * 0.2;
  }
`;

export const PARTICLE_VERT = /* glsl */`
  ${COMMON}
  uniform sampler2D uProfile;
  uniform float uHeight, uSpin, uTime, uWall, uSize, uHeat, uDpr, uSwirl, uCondense;
  attribute float aPhase;
  varying float vV, vGraze, vSeed;

  void main() {
    float u = position.x;   // 0..1 around the wheel
    float v = position.y;   // 0..1 up the wall
    float j = position.z;   // where in the wall thickness this grain sits

    float r = wallAt(uProfile, v);

    // Grains lag the wheel a little higher up the wall, the way slip does.
    float ang = u * TAU + uSpin * (1.0 - uSwirl * v * 0.35);

    // The wall is a shell of grains. Firing draws them in onto the surface.
    float spread = mix(1.0, 0.14, uCondense);
    float shell = (j - 0.5) * uWall * spread;

    // Wet clay breathes. A fired piece does not.
    float wob = (1.0 - uCondense) * 0.0055 * sin(ang * 6.0 + v * 34.0 + uTime * 2.2 + aPhase * 9.0);

    float rr = max(r + shell + wob, 0.0);
    float y = v * uHeight + (1.0 - uCondense) * 0.003 * sin(aPhase * TAU + uTime * 1.3);

    vec3 p = vec3(rr * cos(ang), y, rr * sin(ang));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    // Surface normal from the slope of the profile, for the grazing term.
    float dv = 1.0 / 192.0;
    float r1 = wallAt(uProfile, v + dv);
    float r0 = wallAt(uProfile, v - dv);
    vec2 n2 = normalize(vec2(1.0, -(r1 - r0) / (2.0 * dv * max(uHeight, 0.05))));
    vec3 N = normalize(normalMatrix * vec3(n2.x * cos(ang), n2.y, n2.x * sin(ang)));
    vGraze = pow(1.0 - abs(dot(N, normalize(-mv.xyz))), 1.6);

    vV = v;
    vSeed = aPhase;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uDpr * (1.0 + 0.45 * uHeat) / max(-mv.z, 0.05);
  }
`;

export const PARTICLE_FRAG = /* glsl */`
  ${COMMON}
  uniform int uWorld;
  uniform float uHeat, uTime, uOpacity;
  varying float vV, vGraze, vSeed;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    float grain = smoothstep(0.25, 0.015, d2);
    vec3 col = worldColour(uWorld, uHeat, vGraze, vV, vSeed, uTime);
    float a = grain * (0.030 + 0.150 * vGraze) * uOpacity;
    gl_FragColor = vec4(col, a);
  }
`;

export const SHELL_VERT = /* glsl */`
  ${COMMON}
  uniform sampler2D uProfile;
  uniform float uHeight, uSpin;
  varying float vV, vGraze, vAng;

  void main() {
    float v = uv.y;
    float ang = uv.x * TAU + uSpin;
    float r = wallAt(uProfile, v);

    vec3 p = vec3(r * cos(ang), v * uHeight, r * sin(ang));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);

    float dv = 1.0 / 192.0;
    float r1 = wallAt(uProfile, v + dv);
    float r0 = wallAt(uProfile, v - dv);
    vec2 n2 = normalize(vec2(1.0, -(r1 - r0) / (2.0 * dv * max(uHeight, 0.05))));
    vec3 N = normalize(normalMatrix * vec3(n2.x * cos(ang), n2.y, n2.x * sin(ang)));
    vGraze = pow(1.0 - abs(dot(N, normalize(-mv.xyz))), 2.2);

    vV = v;
    vAng = ang;
    gl_Position = projectionMatrix * mv;
  }
`;

export const SHELL_FRAG = /* glsl */`
  ${COMMON}
  uniform int uWorld;
  uniform float uHeat, uTime, uOpacity;
  varying float vV, vGraze, vAng;

  void main() {
    // Throwing rings: the spiral left in the wall by the potter's fingers.
    float rings = 0.5 + 0.5 * sin(vV * 190.0 + vAng * 0.6);
    vec3 col = worldColour(uWorld, uHeat, vGraze, vV, 0.0, uTime);
    col *= 0.72 + 0.28 * rings;
    float a = (0.015 + 0.26 * vGraze) * uOpacity * (0.55 + 0.8 * uHeat);
    gl_FragColor = vec4(col * (0.30 + 0.75 * uHeat), a);
  }
`;

export const WHEEL_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const WHEEL_FRAG = /* glsl */`
  #define TAU 6.28318530718
  uniform float uSpin, uTime, uHeat;
  uniform vec3 uTint;
  varying vec2 vUv;

  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    if (r > 1.0) discard;
    float a = atan(q.y, q.x) + uSpin;

    // The wheel head: turned concentric grooves and radial spokes.
    float grooves = smoothstep(0.55, 1.0, sin(r * 150.0)) * 0.30;
    float spokes  = smoothstep(0.90, 1.0, sin(a * 12.0)) * 0.16;
    float edge    = smoothstep(1.0, 0.86, r) * smoothstep(0.0, 0.10, 1.0 - r);
    float pool    = pow(1.0 - r, 3.2) * 0.22;

    float m = (grooves + spokes) * edge + pool;
    vec3 col = uTint * m + vec3(1.0, 0.45, 0.16) * pool * uHeat * 1.6;
    gl_FragColor = vec4(col * 0.75, clamp(m, 0.0, 1.0) * 0.55);
  }
`;

export const BEAM_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vView;
  varying vec3 vNrm;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNrm = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

export const BEAM_FRAG = /* glsl */`
  uniform vec3 uTint;
  uniform float uHeat, uStrength;
  varying vec2 vUv;
  varying vec3 vView;
  varying vec3 vNrm;

  void main() {
    // A cone of light only reads if its edges glow and its base fades out.
    float graze = 1.0 - abs(dot(normalize(vNrm), normalize(vView)));
    float fall = smoothstep(0.0, 0.55, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
    float a = pow(graze, 3.2) * fall * uStrength;
    vec3 col = mix(uTint, vec3(1.0, 0.62, 0.28), uHeat * 0.7);
    gl_FragColor = vec4(col * (0.5 + graze), a);
  }
`;

export const MOTE_VERT = /* glsl */`
  uniform float uTime, uDpr, uSpin;
  attribute float aPhase;
  varying float vA;
  void main() {
    float lift = mod(position.y + uTime * 0.012 + aPhase, 1.0);
    float ang = aPhase * 6.2831 + uSpin * 0.05 + uTime * 0.05;
    float rad = mix(0.06, 0.95, lift) * (0.35 + 0.65 * fract(aPhase * 7.3));
    vec3 w = vec3(cos(ang) * rad, 0.02 + lift * 1.25, sin(ang) * rad);
    vec4 mv = modelViewMatrix * vec4(w, 1.0);
    vA = (1.0 - lift) * smoothstep(0.0, 0.2, lift);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.2 + 1.8 * fract(aPhase * 3.1)) * uDpr / max(-mv.z, 0.05) * 0.7;
  }
`;

export const MOTE_FRAG = /* glsl */`
  uniform vec3 uTint;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (dot(c, c) > 0.25) discard;
    gl_FragColor = vec4(uTint, vA * 0.20);
  }
`;
