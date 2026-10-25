import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  ContactShadows,
  Html,
  OrbitControls,
  RoundedBox,
} from "@react-three/drei";
import * as THREE from "three";

import { stops, type Stop } from "./town";

const worldPositions: Record<Stop, [number, number, number]> = {
  home: [-4.3, 0, 3.1],
  dealer: [-1.6, 0, -2.8],
  finance: [3.2, 0, -2.3],
  insurance: [4.4, 0, 2],
  market: [0.8, 0, 3.3],
  hq: [-4, 0, -1.3],
};

function Building3D({
  id,
  active,
  onClick,
}: {
  id: Stop;
  active: boolean;
  onClick: () => void;
}) {
  const position = worldPositions[id];
  const colors: Record<Stop, string> = {
    home: "#f7b8d3",
    dealer: "#ef4b8e",
    finance: "#cb8de0",
    insurance: "#ff9fc5",
    market: "#f4c879",
    hq: "#9d6cba",
  };
  return (
    <group
      position={position}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      scale={active ? 1.12 : 1}
    >
      <RoundedBox
        args={[id === "dealer" ? 2.1 : 1.55, id === "hq" ? 2.3 : 1.7, 1.55]}
        radius={0.22}
        smoothness={4}
        position={[0, 0.85, 0]}
        castShadow
      >
        <meshStandardMaterial
          color={colors[id]}
          roughness={0.48}
          metalness={0.04}
          emissive={active ? colors[id] : "#000000"}
          emissiveIntensity={active ? 0.12 : 0}
        />
      </RoundedBox>
      <mesh position={[0, 1.8, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[id === "finance" ? 1.25 : 1.05, 0.65, 4]} />
        <meshStandardMaterial color={id === "dealer" ? "#fff2f7" : "#ffe2ee"} />
      </mesh>
      {[-0.42, 0.42].map((x) => (
        <mesh key={x} position={[x, 0.95, 0.79]}>
          <boxGeometry args={[0.25, 0.38, 0.05]} />
          <meshStandardMaterial
            color="#713b5a"
            emissive="#f7c5dd"
            emissiveIntensity={0.25}
          />
        </mesh>
      ))}
      <mesh position={[0, 0.35, 0.8]}>
        <boxGeometry args={[0.36, 0.65, 0.06]} />
        <meshStandardMaterial color="#773754" />
      </mesh>
      <Html
        position={[0, 2.55, 0]}
        center
        distanceFactor={12}
        style={{ pointerEvents: "none" }}
      >
        <div className={`three-label ${active ? "active" : ""}`}>
          <b>{stops[id].label}</b>
          <small>{stops[id].note}</small>
        </div>
      </Html>
    </group>
  );
}

function Tree3D({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.13, 0.9, 8]} />
        <meshStandardMaterial color="#8e536d" />
      </mesh>
      <mesh position={[0, 1.15, 0]} castShadow>
        <sphereGeometry args={[0.62, 16, 12]} />
        <meshStandardMaterial color="#d965a0" roughness={0.8} />
      </mesh>
    </group>
  );
}

function MovingCar() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.x = Math.sin(clock.elapsedTime * 0.35) * 4.3;
  });
  return (
    <group ref={ref} position={[0, 0.22, 0.2]}>
      <RoundedBox
        args={[1.05, 0.35, 0.55]}
        radius={0.16}
        smoothness={3}
        castShadow
      >
        <meshStandardMaterial color="#ffffff" />
      </RoundedBox>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[0.5, 0.22, 0.45]} />
        <meshStandardMaterial color="#e54889" />
      </mesh>
    </group>
  );
}

function Robot3D({ stop, working }: { stop: Stop; working: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const target = worldPositions[stop];
  const destination = new THREE.Vector3();
  useFrame(({ clock }) => {
    if (!ref.current) return;
    ref.current.position.lerp(
      destination.set(
        target[0],
        0.1 + (working ? Math.sin(clock.elapsedTime * 6) * 0.05 : 0),
        target[2] + 1.15,
      ),
      0.035,
    );
    ref.current.rotation.y = Math.sin(clock.elapsedTime * 2) * 0.12;
  });
  return (
    <group
      ref={ref}
      position={[worldPositions.home[0], 0.1, worldPositions.home[2] + 1.15]}
    >
      <mesh position={[0, 0.62, 0]} castShadow>
        <sphereGeometry args={[0.38, 20, 16]} />
        <meshStandardMaterial color="#fff9fc" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.58, 0.34]}>
        <boxGeometry args={[0.42, 0.15, 0.06]} />
        <meshStandardMaterial
          color="#55253f"
          emissive="#ff77b0"
          emissiveIntensity={0.35}
        />
      </mesh>
      <RoundedBox
        args={[0.58, 0.55, 0.48]}
        radius={0.15}
        smoothness={3}
        position={[0, 0.12, 0]}
        castShadow
      >
        <meshStandardMaterial color="#ed4388" />
      </RoundedBox>
      <pointLight
        color="#ff9fc8"
        intensity={1.4}
        distance={2.5}
        position={[0, 0.7, 0.3]}
      />
    </group>
  );
}

export function WorldScene({
  selected,
  currentStop,
  running,
  onSelect,
}: {
  selected: Stop;
  currentStop: Stop;
  running: boolean;
  onSelect: (id: Stop) => void;
}) {
  return (
    <Canvas
      shadows
      camera={{ position: [9, 10, 12], fov: 36 }}
      onPointerMissed={() => onSelect(currentStop)}
    >
      <color attach="background" args={["#f8c9dd"]} />
      <fog attach="fog" args={["#f8c9dd", 16, 27]} />
      <ambientLight intensity={1.4} />
      <directionalLight
        position={[-5, 12, 7]}
        intensity={2.2}
        color="#fff5df"
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <Suspense fallback={null}>
        <RoundedBox
          args={[12, 0.45, 9]}
          radius={0.5}
          smoothness={5}
          position={[0, -0.35, 0]}
          receiveShadow
        >
          <meshStandardMaterial color="#efabc8" roughness={0.85} />
        </RoundedBox>
        <mesh position={[0, -0.08, 0.2]} receiveShadow>
          <boxGeometry args={[10.8, 0.08, 1.1]} />
          <meshStandardMaterial color="#ce7fa4" />
        </mesh>
        <mesh
          position={[0.25, -0.07, 0]}
          rotation={[0, Math.PI / 2, 0]}
          receiveShadow
        >
          <boxGeometry args={[8.3, 0.08, 1.05]} />
          <meshStandardMaterial color="#ce7fa4" />
        </mesh>
        {(Object.keys(stops) as Stop[]).map((id) => (
          <Building3D
            key={id}
            id={id}
            active={selected === id}
            onClick={() => onSelect(id)}
          />
        ))}
        <Tree3D position={[-2.7, 0, 2.8]} />
        <Tree3D position={[2.6, 0, 2.4]} />
        <Tree3D position={[4.8, 0, -1]} />
        <Tree3D position={[-4.7, 0, 0.5]} />
        <MovingCar />
        <Robot3D stop={currentStop} working={running} />

        <ContactShadows
          position={[0, -0.1, 0]}
          opacity={0.3}
          scale={16}
          blur={2.2}
          far={8}
          color="#8c4265"
        />
      </Suspense>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={8}
        maxDistance={21}
        maxPolarAngle={Math.PI / 2.25}
        minPolarAngle={Math.PI / 5}
        target={[0, 0.5, 0]}
      />
    </Canvas>
  );
}
