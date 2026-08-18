import { Canvas } from '@react-three/fiber'

export function App() {
  return (
    <Canvas camera={{ position: [0, 2, 4] }}>
      <ambientLight intensity={0.6} />
      <mesh rotation={[0.4, 0.6, 0]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshNormalMaterial />
      </mesh>
    </Canvas>
  )
}
