import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { palette } from './palette'

/**
 * Golden-hour lighting rig + stylized sky backdrop, promoted from the
 * beauty-slice review scene (Task 8) so the full board shares the same
 * approved art direction. Spec: docs/superpowers/specs/2026-08-19-beauty-slice-art-direction-design.md
 */

/**
 * Stylized golden-hour backdrop: warm horizon wash all around (like a studio
 * seamless behind a photographed miniature), cool slate zenith, and an extra
 * peach glow on the sun side. Deliberately not physical — the physical sky
 * puts all warmth behind the default cameras.
 */
export function SkyBackdrop() {
  const mat = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color('#4a5d80') },
        uHorizon: { value: new THREE.Color('#e8b98a') },
        uGlow: { value: new THREE.Color('#ffcf9a') },
        uSunDir: { value: new THREE.Vector3(6.5, 2.9, 4.5).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGlow;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
          float sunAmt = pow(max(dot(d, normalize(uSunDir)), 0.0), 6.0);
          col = mix(col, uGlow, sunAmt * (1.0 - h) * 0.9);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
  }, [])
  return (
    <mesh material={mat} renderOrder={-1}>
      <sphereGeometry args={[60, 32, 16]} />
    </mesh>
  )
}

export function GoldenHourRig() {
  const sun = useRef<THREE.DirectionalLight>(null)
  return (
    <>
      {/* warm low sun, ~22 deg elevation, raking in from front-right */}
      <directionalLight
        ref={sun}
        color={palette.light.sun}
        intensity={5.5}
        position={[6.5, 2.9, 4.5]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={4}
        shadow-bias={-0.0004}
        shadow-camera-left={-5.5}
        shadow-camera-right={5.5}
        shadow-camera-top={5.5}
        shadow-camera-bottom={-5.5}
        shadow-camera-far={25}
      />
      {/* cool sky fill in the shadows */}
      <hemisphereLight args={[palette.light.skyFill, palette.light.groundFill, 0.45]} />
      {/* faint warm bounce so shadow sides don't go dead */}
      <directionalLight color="#ff9a5e" intensity={0.5} position={[-4, 1.5, -3]} />
    </>
  )
}
