// ░▒▓ IMPACT FX SHADERS — GLSL ports of SquigglyFish's "Godot 4 Hit & Impact VFX + SFX" sampler (CC0 1.0) ▓▒░
// Each layer is an InstancedMesh; per instance: aAge (0..1 of its life) and aSeed (a random number).
// The billboarding the Godot shaders did in vertex() is done on the CPU (ImpactFx.tsx sets each instance's
// matrix), so these vertex shaders only shrink or stretch the quad. The depth fade (FX_SOFT) is left out.

import * as THREE from 'three'

const COMMON = /* glsl */ `
varying vec2 vUv;
varying float vAge;
varying float vSeed;
float fx_hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float fx_noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fx_hash(i), fx_hash(i + vec2(1.0, 0.0)), f.x), mix(fx_hash(i + vec2(0.0, 1.0)), fx_hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fx_fbm(vec2 p) { return fx_noise(p) * 0.5 + fx_noise(p * 2.03 + 17.0) * 0.3 + fx_noise(p * 4.1 + 43.0) * 0.2; }
`

function vertex(mod: string): string {
  return /* glsl */ `
attribute float aAge;
attribute float aSeed;
varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying vec3 vViewPos;
void main() {
  vUv = uv;
  vAge = aAge;
  vSeed = aSeed;
  float age = aAge;
  vec3 pos = position;
  ${mod}
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`
}

function fragment(uniforms: string, body: string): string {
  return /* glsl */ `
${COMMON}
varying vec3 vViewPos;
${uniforms}
void main() {
  float age = vAge;
  vec3 ALBEDO = vec3(1.0);
  float ALPHA = 1.0;
  ${body}
  if (ALPHA <= 0.002) discard;
  gl_FragColor = vec4(ALBEDO, ALPHA);
  #include <colorspace_fragment>
}`
}

const TAU = '6.28318530718'
const PI = '3.14159265359'

export type ShaderId = 'flash' | 'lines' | 'ring' | 'star' | 'shard' | 'spark' | 'twinkle' | 'plasma' | 'arcs' | 'groundRing' | 'groundCracks' | 'puff' | 'chunk'

interface ShaderDef {
  vertexMod: string
  uniforms: string
  body: string
  blend: 'add' | 'mix' | 'opaque'
  defaults: Record<string, number | [number, number, number, number] | [number, number, number]>
}

const DEFS: Record<ShaderId, ShaderDef> = {
  flash: {
    vertexMod: '', blend: 'add',
    uniforms: 'uniform vec4 color; uniform float ray_count; uniform float core_size;',
    defaults: { color: [1, 0.8, 0.45, 1], ray_count: 3, core_size: 0.35 },
    body: `
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float size = mix(0.6, 1.0, sqrt(age));
  float fade = (1.0 - age) * (1.0 - age);
  float core = exp(-pow(r / (core_size * size), 2.0) * 2.0) * (1.0 - smoothstep(0.7, 1.0, r));
  float rays = pow(abs(cos(a * ray_count)), 40.0) * (1.0 - smoothstep(0.0, size, r)) * step(0.5, ray_count);
  ALBEDO = mix(color.rgb, vec3(1.0), core * 0.6);
  ALPHA = clamp((core + rays) * fade * color.a, 0.0, 1.0);`,
  },
  lines: {
    vertexMod: '', blend: 'add',
    uniforms: 'uniform vec4 color; uniform float count; uniform float width; uniform float start_radius;',
    defaults: { color: [1, 0.85, 0.4, 1], count: 40, width: 0.022, start_radius: 0.3 },
    body: `
  float seed = floor(vSeed * 10.0);
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float n = (atan(p.y, p.x) / ${TAU} + 0.5) * count;
  float id = floor(n);
  float h1 = fx_hash(vec2(id, 1.0 + seed));
  float h2 = fx_hash(vec2(id, 7.0 + seed));
  float lateral = abs(fract(n) - 0.5) * ${TAU} / count * r;
  float grow = 1.0 - pow(1.0 - age, 3.0);
  float head = mix(start_radius, 1.0, grow) * mix(0.6, 1.0, h1);
  float len = mix(0.2, 0.5, h2) * (1.0 - age * 0.7);
  float t = (r - (head - len)) / len;
  float w = width * clamp(t, 0.0, 1.0);
  float line = (1.0 - smoothstep(w * 0.5, w, lateral)) * step(0.0, t) * step(t, 1.0) * step(0.4, h2 + h1 * 0.5);
  ALBEDO = mix(color.rgb, vec3(1.0), 0.3 * clamp(t, 0.0, 1.0));
  ALPHA = clamp(line * (1.0 - age * age) * color.a, 0.0, 1.0);`,
  },
  ring: {
    vertexMod: '', blend: 'add',
    uniforms: 'uniform vec4 color; uniform float thickness; uniform float start_radius;',
    defaults: { color: [1, 0.6, 0.25, 1], thickness: 0.12, start_radius: 0.15 },
    body: `
  float r = length(vUv * 2.0 - 1.0);
  float grow = 1.0 - pow(1.0 - age, 3.0);
  float radius = mix(start_radius, 0.95, grow);
  float w = thickness * (1.0 - age) + 0.01;
  float ring = 1.0 - smoothstep(0.0, w, abs(r - radius));
  ALBEDO = color.rgb;
  ALPHA = clamp(ring * (1.0 - age) * color.a, 0.0, 1.0);`,
  },
  star: {
    vertexMod: '', blend: 'mix',
    uniforms: 'uniform vec4 core; uniform vec4 body; uniform vec4 rim; uniform float points; uniform float short_points;',
    defaults: { core: [1, 1, 0.93, 1], body: [1, 0.82, 0.2, 1], rim: [1, 0.45, 0.05, 1], points: 5, short_points: 0.62 },
    body: `
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float pop = 1.0 - pow(1.0 - clamp(age * 9.0, 0.0, 1.0), 3.0);
  float thin = smoothstep(0.1, 1.0, age);
  float n = a / ${TAU} * points * 2.0;
  float t = abs(fract(n + 0.5) - 0.5) * 2.0;
  float tip = mix(1.0, short_points, mod(floor(n + 0.5), 2.0));
  float valley = mix(0.5, 0.02, thin * thin);
  float radius = mix(0.65, 1.0, pop) * 0.98 / (1.0 / tip + (1.0 / valley - 1.0 / tip) * t);
  float d = r / max(radius, 0.0001);
  float aa = fwidth(d) * 1.5;
  vec3 col = mix(core.rgb, body.rgb, smoothstep(0.5 - aa, 0.5, d));
  col = mix(col, rim.rgb, smoothstep(0.8 - aa, 0.8, d));
  ALBEDO = mix(core.rgb, col, smoothstep(0.04, 0.12, age));
  ALPHA = (1.0 - smoothstep(1.0 - aa, 1.0, d)) * (1.0 - smoothstep(0.8, 1.0, age));`,
  },
  shard: {
    vertexMod: 'pos.xy *= 1.0 - age * age;', blend: 'mix',
    uniforms: 'uniform vec4 light; uniform vec4 dark;',
    defaults: { light: [1, 0.95, 0.6, 1], dark: [1, 0.6, 0.1, 1] },
    body: `
  vec2 p = vUv * 2.0 - 1.0;
  float d = abs(p.x) + abs(p.y);
  ALBEDO = mix(light.rgb, dark.rgb, step(0.0, p.x));
  ALPHA = 1.0 - smoothstep(1.0 - fwidth(d) * 1.5, 1.0, d);`,
  },
  spark: {
    vertexMod: 'pos.y *= mix(1.0, 0.35, age);', blend: 'add',
    uniforms: 'uniform vec4 hot; uniform vec4 cool;',
    defaults: { hot: [1, 0.95, 0.8, 1], cool: [1, 0.45, 0.1, 1] },
    body: `
  vec2 p = vUv * 2.0 - 1.0;
  float m = (1.0 - smoothstep(0.0, 1.0, abs(p.x))) * (1.0 - smoothstep(0.2, 1.0, abs(p.y)));
  ALBEDO = mix(hot.rgb, cool.rgb, smoothstep(0.0, 0.6, age));
  ALPHA = clamp(m * (1.0 - age) * 1.5, 0.0, 1.0);`,
  },
  twinkle: {
    vertexMod: `float s = sin(age * ${PI}) * (0.65 + 0.35 * sin(age * 25.0 + aSeed * 9.0)); pos.xy *= max(s, 0.0);`, blend: 'add',
    uniforms: 'uniform vec4 color;',
    defaults: { color: [1, 0.9, 0.5, 1] },
    body: `
  vec2 p = vUv * 2.0 - 1.0;
  float glint = (1.0 - smoothstep(0.0, 0.035, abs(p.x * p.y))) * (1.0 - smoothstep(0.5, 1.0, length(p)));
  float dot_ = 1.0 - smoothstep(0.1, 0.3, length(p));
  ALBEDO = mix(color.rgb, vec3(1.0), dot_);
  ALPHA = clamp(glint + dot_, 0.0, 1.0);`,
  },
  plasma: {
    vertexMod: '', blend: 'mix',
    uniforms: 'uniform vec4 core; uniform vec4 body; uniform vec4 rim; uniform float lumpiness;',
    defaults: { core: [0.95, 1, 1, 1], body: [0.2, 0.9, 1, 1], rim: [0.1, 0.4, 1, 1], lumpiness: 0.45 },
    body: `
  float seed = vSeed * 5.0;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  vec2 dir = p / max(r, 0.001);
  float pop = 1.0 - pow(1.0 - clamp(age * 8.0, 0.0, 1.0), 3.0);
  float size = mix(0.55, 1.0, pop) * (1.0 - 0.3 * smoothstep(0.3, 1.0, age));
  float lobes = fx_noise(dir * 2.3 + seed + age * 1.5) + 0.5 * fx_noise(dir * 5.0 - seed - age * 3.0);
  float radius = size * (0.92 - lumpiness + lumpiness * lobes / 1.5);
  float d = r / max(radius, 0.001);
  float holes = fx_fbm(p * 3.5 + seed * 3.0 + vec2(0.0, age));
  float alive = step(age * 1.25 - 0.2, holes * 0.7 + (1.0 - d) * 0.55);
  float aa = fwidth(d) * 1.5;
  vec3 col = mix(core.rgb, body.rgb, smoothstep(0.48 - aa, 0.48, d + (holes - 0.5) * 0.25));
  col = mix(col, rim.rgb, smoothstep(0.8 - aa, 0.8, d + (holes - 0.5) * 0.15));
  ALBEDO = mix(core.rgb, col, smoothstep(0.03, 0.1, age));
  ALPHA = (1.0 - smoothstep(1.0 - aa, 1.0, d)) * alive;`,
  },
  arcs: {
    vertexMod: '', blend: 'add',
    uniforms: `uniform vec4 color; uniform float count; uniform float width; uniform float flicker; uniform float inner_radius;
float jag(float x, float s) { return mix(fx_hash(vec2(floor(x), s)), fx_hash(vec2(floor(x) + 1.0, s)), fract(x)) - 0.5; }`,
    defaults: { color: [0.3, 0.85, 1, 1], count: 9, width: 0.02, flicker: 7, inner_radius: 0.25 },
    body: `
  float seed = floor(vSeed * 10.0);
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float tick = floor(age * flicker);
  float n = (atan(p.y, p.x) / ${TAU} + 0.5) * count;
  float id = floor(n);
  float s = id * 13.0 + tick * 7.0 + seed;
  float h = fx_hash(vec2(s, 2.0));
  float len = mix(0.55, 1.0, fx_hash(vec2(s, 5.0))) * mix(0.75, 1.0, min(age * 6.0, 1.0));
  float along = (r - inner_radius) / max(len - inner_radius, 0.001);
  float bend = (jag(r * 9.0, s) * 0.5 + jag(r * 23.0, s + 3.0) * 0.2) * smoothstep(0.0, 0.25, along);
  float lateral = abs(fract(n) - 0.5 + bend) * ${TAU} / count * r;
  float inside = step(0.0, along) * step(along, 1.0) * step(0.35, h);
  float w = width * (1.0 - 0.6 * along);
  float line = 1.0 - smoothstep(w * 0.5, w, lateral);
  float halo = (1.0 - smoothstep(w, w * 5.0, lateral)) * 0.45;
  ALBEDO = mix(color.rgb, vec3(1.0), line);
  ALPHA = clamp((line + halo) * inside * (1.0 - age * age) * color.a, 0.0, 1.0);`,
  },
  groundRing: {
    vertexMod: '', blend: 'add',
    uniforms: 'uniform vec4 color; uniform vec4 hot; uniform float thickness; uniform float ragged;',
    defaults: { color: [1, 0.42, 0.08, 1], hot: [1, 0.95, 0.75, 1], thickness: 0.3, ragged: 0.12 },
    body: `
  float seed = vSeed * 7.0;
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float grow = 1.0 - pow(1.0 - age, 4.0);
  float n = fx_fbm(p / max(r, 0.001) * 3.5 + seed);
  float edge = mix(0.1, 0.9, grow) * (1.0 + (n - 0.5) * ragged * 2.0);
  float w = thickness * (1.0 - age * 0.6);
  float ring = (1.0 - smoothstep(0.0, 0.02, r - edge)) * pow(smoothstep(edge - w, edge, r), 2.0);
  float disc = (1.0 - smoothstep(0.0, edge, r)) * pow(1.0 - age, 4.0) * 0.7;
  ALBEDO = mix(color.rgb, hot.rgb, clamp(ring * ring + disc, 0.0, 1.0));
  ALPHA = clamp((ring + disc) * (1.0 - age * age) * color.a, 0.0, 1.0);`,
  },
  groundCracks: {
    vertexMod: '', blend: 'mix',
    uniforms: 'uniform vec4 hot; uniform vec4 cold; uniform float count; uniform float width;',
    defaults: { hot: [1, 0.75, 0.3, 1], cold: [0.04, 0.035, 0.03, 1], count: 11, width: 0.04 },
    body: `
  float seed = floor(vSeed * 10.0);
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float reach = 1.0 - pow(1.0 - clamp(age * 7.0, 0.0, 1.0), 2.0);
  float n = (atan(p.y, p.x) / ${TAU} + 0.5) * count;
  float id = floor(n);
  float h1 = fx_hash(vec2(id, 3.0 + seed));
  float h2 = fx_hash(vec2(id, 11.0 + seed));
  float wobble = (fx_noise(vec2(r * 9.0, id * 5.0 + seed)) - 0.5) * 0.7 * smoothstep(0.0, 0.3, r);
  float lateral = abs(fract(n) - 0.5 + wobble) * ${TAU} / count * r;
  float len = mix(0.45, 0.95, h1) * reach;
  float w = width * (1.0 - r / max(len, 0.001)) * mix(0.6, 1.2, h2);
  float crack = (1.0 - smoothstep(w * 0.6, w, lateral)) * step(r, len) * step(0.15, h2);
  float rr = 0.3 + (fx_noise(p * 4.0 + seed) - 0.5) * 0.14;
  float ring = (1.0 - smoothstep(width * 0.25, width * 0.45, abs(r - rr))) * step(0.42, fx_noise(p * 3.0 + seed + 20.0)) * step(0.3, reach);
  float core = 1.0 - smoothstep(0.02, 0.05, r);
  ALBEDO = mix(hot.rgb, cold.rgb, smoothstep(0.05, 0.45, age));
  ALPHA = clamp(max(max(crack, ring), core), 0.0, 1.0) * (1.0 - smoothstep(0.6, 1.0, age));`,
  },
  puff: {
    vertexMod: 'pos.xy *= mix(0.45, 1.0, 1.0 - pow(1.0 - age, 3.0));', blend: 'mix',
    uniforms: 'uniform vec4 light; uniform vec4 dark; uniform float opacity;',
    defaults: { light: [0.78, 0.7, 0.58, 1], dark: [0.36, 0.3, 0.25, 1], opacity: 0.9 },
    body: `
  float seed = vSeed * 13.0;
  vec2 p = vUv * 2.0 - 1.0;
  float n = fx_fbm(p * 1.8 + seed);
  float body = 1.0 - length(p) + (n - 0.5) * 0.7;
  float cut = mix(0.12, 0.8, age * age);
  float lit = p.y * 0.5 + (n - 0.5) * 1.2 + 0.25;
  vec3 col = mix(dark.rgb, mix(dark.rgb, light.rgb, 0.55), step(-0.1, lit));
  col = mix(col, light.rgb, step(0.35, lit));
  ALBEDO = col;
  ALPHA = smoothstep(cut, cut + 0.05, body) * opacity * (1.0 - smoothstep(0.75, 1.0, age));`,
  },
  chunk: {
    vertexMod: 'pos *= 1.0 - smoothstep(0.75, 1.0, age);', blend: 'opaque',
    uniforms: 'uniform vec4 light; uniform vec4 mid; uniform vec4 dark;',
    defaults: { light: [0.62, 0.55, 0.47, 1], mid: [0.36, 0.31, 0.27, 1], dark: [0.17, 0.14, 0.13, 1] },
    body: `
  vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  n = n.z < 0.0 ? -n : n;
  float d = dot(n, normalize((viewMatrix * vec4(0.35, 1.0, 0.3, 0.0)).xyz));
  ALBEDO = d > 0.4 ? light.rgb : (d > -0.15 ? mid.rgb : dark.rgb);`,
  },
}

function toUniform(value: number | number[]): THREE.IUniform {
  if (typeof value === 'number') return { value }
  // Godot source_color is sRGB: convert to the working (linear) space like THREE.Color does.
  const c = new THREE.Color().setRGB(value[0], value[1], value[2], THREE.SRGBColorSpace)
  return { value: new THREE.Vector4(c.r, c.g, c.b, value[3] ?? 1) }
}

export type ShaderParams = Partial<Record<string, number | [number, number, number, number] | [number, number, number]>>

const cache = new Map<string, THREE.ShaderMaterial>()

/** One material per shader and parameter set, shared by every effect for the whole session (no recompiles). */
export function impactMaterial(id: ShaderId, params: ShaderParams = {}): THREE.ShaderMaterial {
  const key = `${id}:${JSON.stringify(params)}`
  const known = cache.get(key)
  if (known) return known
  const def = DEFS[id]
  const uniforms: Record<string, THREE.IUniform> = {}
  for (const [name, value] of Object.entries({ ...def.defaults, ...params })) uniforms[name] = toUniform(value as number | number[])
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex(def.vertexMod),
    fragmentShader: fragment(def.uniforms, def.body),
    transparent: def.blend !== 'opaque',
    depthWrite: def.blend === 'opaque',
    blending: def.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  })
  // Layers that lie on the ground win the depth test against it (no flicker with the floor).
  if (id === 'groundCracks' || id === 'groundRing') {
    material.polygonOffset = true
    material.polygonOffsetFactor = -2
    material.polygonOffsetUnits = -2
  }
  cache.set(key, material)
  return material
}
