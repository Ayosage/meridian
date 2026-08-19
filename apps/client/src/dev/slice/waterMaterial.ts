import * as THREE from 'three'
import { palette } from './palette'

/** Circumradius of the tile puck (matches assets/slice.blend). */
const PUCK_R = 0.98
const MAX_TILES = 8

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec2 uTiles[${MAX_TILES}];
uniform int uTileCount;
varying vec3 vWorld;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1, 0)), u.x),
    mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x),
    u.y
  );
}

// signed distance to a pointy-top hexagon (corner on +y of the 2D plane)
float sdHexPointy(vec2 p, float r) {
  // rotate 90deg so the standard flat-top sdf becomes pointy-top
  p = vec2(p.y, p.x);
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}

void main() {
  vec2 p = vWorld.xz;

  // gentle moving ripples -> pseudo normal
  float r1 = vnoise(p * 3.1 + vec2(uTime * 0.13, uTime * 0.07));
  float r2 = vnoise(p * 6.7 - vec2(uTime * 0.09, uTime * 0.16));
  float ripple = r1 * 0.7 + r2 * 0.3;
  vec3 n = normalize(vec3((r1 - 0.5) * 0.25, 1.0, (r2 - 0.5) * 0.25));

  // distance to nearest tile edge (negative inside a tile footprint)
  float dTile = 1e5;
  for (int i = 0; i < ${MAX_TILES}; i++) {
    if (i >= uTileCount) break;
    dTile = min(dTile, sdHexPointy(p - uTiles[i], ${PUCK_R.toFixed(2)}));
  }

  // depth tint: shallower (warmer) near tiles
  float shore = 1.0 - smoothstep(0.0, 0.9, dTile);
  vec3 col = mix(uDeep, uShallow, shore * 0.85);

  // sky reflection via fresnel (kept subtle so the water stays rich, not gray)
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 3.0);
  col = mix(col, uSky, fres * 0.18);

  // sun glint, gated high so bloom picks it up
  vec3 refl = reflect(-uSunDir, n);
  float glint = pow(max(dot(refl, viewDir), 0.0), 220.0);
  col += uSunColor * glint * 2.4;

  // foam ring hugging tile bases, wobbling with time
  float wob = (vnoise(p * 11.0 + uTime * 0.35) - 0.5) * 0.018;
  float band = abs(dTile + 0.012 + wob);
  float foam = 1.0 - smoothstep(0.0, 0.03, band);
  foam *= 0.65 + 0.35 * sin(uTime * 1.3 + ripple * 6.28);
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.8);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function createWaterMaterial(tileCenters: THREE.Vector2[]): THREE.ShaderMaterial {
  const tiles = Array.from({ length: MAX_TILES }, (_, i) => tileCenters[i] ?? new THREE.Vector2(9e5, 9e5))
  const sunDir = new THREE.Vector3(6.5, 2.9, 4.5).normalize()
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(palette.water.deep) },
      uShallow: { value: new THREE.Color(palette.water.shallow) },
      uFoam: { value: new THREE.Color(palette.water.foam) },
      uSky: { value: new THREE.Color(palette.water.skyReflect) },
      uSunDir: { value: sunDir },
      uSunColor: { value: new THREE.Color(palette.light.sun) },
      uTiles: { value: tiles },
      uTileCount: { value: tileCenters.length },
    },
  })
}
