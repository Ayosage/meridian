import * as THREE from 'three'

const vertexShader = /* glsl */ `
attribute float aState;
varying float vState;
varying vec3 vLocal;
varying vec3 vWorld;

void main() {
  vState = aState;
  vLocal = position;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uQualityTier; // reserved: future quality-tier switch point
varying float vState;
varying vec3 vLocal;
varying vec3 vWorld;

// cheap hash noise — deliberately neutral placeholder styling
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // base: subtle radial gradient darkening away from board center
  float dist = length(vWorld.xz) * 0.06;
  vec3 base = mix(vec3(0.13, 0.15, 0.19), vec3(0.07, 0.08, 0.11), clamp(dist, 0.0, 1.0));

  // animated shimmer
  float n = hash(floor(vWorld.xz * 3.0) + floor(uTime * 2.0));
  base += n * 0.02;

  // side faces darker than the top
  float top = smoothstep(0.02, 0.06, vLocal.y);
  base *= mix(0.55, 1.0, top);

  // state tinting: 0 none, 1 hover, 2 legal, 3 selected
  if (vState > 2.5) {
    base = mix(base, vec3(0.62, 0.5, 0.2), 0.75);
  } else if (vState > 1.5) {
    float pulse = 0.6 + 0.4 * sin(uTime * 3.0);
    base = mix(base, vec3(0.2, 0.55, 0.4), 0.55 * pulse + 0.2);
  } else if (vState > 0.5) {
    base = mix(base, vec3(0.35, 0.4, 0.5), 0.5);
  }

  gl_FragColor = vec4(base, 1.0);
}
`

export function createBoardMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uQualityTier: { value: 1 },
    },
  })
}
