import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, type InstancedMesh, Object3D } from "three";
import { rig } from "@/game/player/rig";
import type { WalkGraph } from "./generator";
import { box, cylinder, ico, mergeAll, mergeVertexColored } from "./merge";
import { hashString, mulberry32, pick, range } from "./random";

/**
 * Ambient pedestrians (phase O4 › 4): low-poly walkers on the walk graph, instanced as four
 * meshes for the whole crowd (torso with arms, head with hair, left and right leg) sharing one
 * procedural stride. They stop while the player is within a metre, and have no physics.
 */
type Walker = {
  from: number;
  to: number;
  /** Progress from `from` to `to`, 0..1. */
  t: number;
  speed: number;
  phase: number;
  heading: number;
  waiting: boolean;
};

const SHIRTS = ["#c9d2cf", "#2f4f6b", "#9c4535", "#d8c39a", "#3c4a42", "#e3e0d6", "#6b4f7a", "#2f6f5e", "#b8863b"];
const TROUSERS = ["#2f3438", "#3a4048", "#5b4c3e", "#23272b", "#6b6f70"];
const SKIN = ["#f1c9a5", "#d9a77f", "#b77b52", "#8d5a3b", "#5e3b28"];

const STOP_WITHIN = 1;
const RESUME_BEYOND = 1.4;
const HIP = 0.86;

function geometries() {
  return {
    torso: mergeAll([
      cylinder(0.19, 0.16, 0.6, 6, { at: [0, HIP + 0.32, 0] }),
      box(0.09, 0.55, 0.11, { at: [-0.25, HIP + 0.28, 0] }),
      box(0.09, 0.55, 0.11, { at: [0.25, HIP + 0.28, 0] }),
    ]),
    head: mergeVertexColored([
      { color: "#ffffff", geometry: ico(0.14, 1, { at: [0, HIP + 0.8, 0] }) },
      { color: "#2a2522", geometry: box(0.27, 0.12, 0.26, { at: [0, HIP + 0.9, -0.02] }) },
    ]),
    // Legs hang from the hip, so swinging them is a rotation about x at the instance origin.
    leg: box(0.13, HIP, 0.15, { at: [0, -HIP / 2, 0] }),
  };
}

const dummy = new Object3D();
const tint = new Color();

type PedestriansProps = {
  graph: WalkGraph;
  count: number;
  seed: number;
  /** The ground height at a point (pavements sit on the curb, crossings on the road). */
  groundAt: (x: number, z: number) => number;
};

export function Pedestrians({ graph, count, seed, groundAt }: PedestriansProps) {
  const parts = useMemo(() => geometries(), []);
  useEffect(() => () => Object.values(parts).forEach((geometry) => geometry.dispose()), [parts]);
  const random = useMemo(() => mulberry32(seed ^ hashString("pedestrians")), [seed]);
  // Nodes walkers may head for: never the office doors.
  const allowed = useMemo(() => graph.nodes.map((node) => node.kind !== "entrance"), [graph]);
  const walkers = useRef<Walker[]>([]);

  const torso = useRef<InstancedMesh>(null);
  const head = useRef<InstancedMesh>(null);
  const left = useRef<InstancedMesh>(null);
  const right = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const starts = graph.nodes.filter((node) => allowed[node.id]);
    walkers.current = Array.from({ length: count }, () => {
      const from = pick(random, starts).id;
      const to = pick(random, graph.neighbours[from].filter((id) => allowed[id]));
      return { from, to: to ?? from, t: random(), speed: range(random, 1.05, 1.5), phase: random() * 6.28, heading: 0, waiting: false };
    });
    walkers.current.forEach((_, index) => {
      torso.current?.setColorAt(index, tint.set(pick(random, SHIRTS)));
      head.current?.setColorAt(index, tint.set(pick(random, SKIN)));
      const trousers = pick(random, TROUSERS);
      left.current?.setColorAt(index, tint.set(trousers));
      right.current?.setColorAt(index, tint.set(trousers));
    });
    for (const mesh of [torso.current, head.current, left.current, right.current]) {
      if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }, [graph, count, random, allowed]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);
    const meshes = [torso.current, head.current, left.current, right.current];
    if (meshes.some((mesh) => !mesh)) return;
    walkers.current.forEach((walker, index) => {
      const edge = () => {
        const a = graph.nodes[walker.from];
        const b = graph.nodes[walker.to];
        return { a, b, length: Math.hypot(b.x - a.x, b.z - a.z) || 1 };
      };
      let { a, b, length } = edge();
      const near = Math.hypot(rig.position.x - (a.x + (b.x - a.x) * walker.t), rig.position.z - (a.z + (b.z - a.z) * walker.t));
      walker.waiting = walker.waiting ? near < RESUME_BEYOND : near < STOP_WITHIN;

      if (!walker.waiting) {
        walker.t += (walker.speed * delta) / length;
        walker.phase += walker.speed * delta * 5.2;
        if (walker.t >= 1) {
          // Next edge: any neighbour but the way back, unless it's a dead end.
          const options = graph.neighbours[walker.to].filter((id) => allowed[id] && id !== walker.from);
          const next = options.length > 0 ? options[Math.floor(Math.random() * options.length)] : walker.from;
          walker.t = ((walker.t - 1) * length) / Math.max(1, Math.hypot(graph.nodes[next].x - b.x, graph.nodes[next].z - b.z));
          walker.from = walker.to;
          walker.to = next;
          ({ a, b, length } = edge());
        }
        walker.heading = Math.atan2(b.x - a.x, b.z - a.z);
      }
      const x = a.x + (b.x - a.x) * walker.t;
      const z = a.z + (b.z - a.z) * walker.t;
      // Waiting: stand still and look at the player.
      if (walker.waiting) walker.heading = Math.atan2(rig.position.x - x, rig.position.z - z);

      const swing = walker.waiting ? 0 : Math.sin(walker.phase) * 0.55;
      const y = groundAt(x, z) + (walker.waiting ? 0 : Math.abs(Math.cos(walker.phase)) * 0.04);
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, walker.heading, 0);
      dummy.updateMatrix();
      meshes[0]!.setMatrixAt(index, dummy.matrix);
      meshes[1]!.setMatrixAt(index, dummy.matrix);
      for (const [mesh, side, sign] of [
        [meshes[2]!, -0.1, 1],
        [meshes[3]!, 0.1, -1],
      ] as const) {
        dummy.position.set(x + Math.cos(walker.heading) * side, y + HIP, z - Math.sin(walker.heading) * side);
        dummy.rotation.set(swing * sign, walker.heading, 0, "YXZ");
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
    });
    for (const mesh of meshes) mesh!.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh key={`torso:${count}`} ref={torso} args={[parts.torso, undefined, count]} castShadow frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
      <instancedMesh key={`head:${count}`} ref={head} args={[parts.head, undefined, count]} castShadow frustumCulled={false}>
        <meshStandardMaterial vertexColors roughness={0.8} flatShading />
      </instancedMesh>
      <instancedMesh key={`left:${count}`} ref={left} args={[parts.leg, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
      <instancedMesh key={`right:${count}`} ref={right} args={[parts.leg, undefined, count]} frustumCulled={false}>
        <meshStandardMaterial roughness={0.85} flatShading />
      </instancedMesh>
    </>
  );
}
