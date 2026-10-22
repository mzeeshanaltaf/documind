import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, DoubleSide, type Group, type InstancedMesh, Object3D, RingGeometry } from "three";
import { TIERS } from "@/game/engine/quality";
import { Interactable } from "@/game/interact/Interactable";
import { selectTier, useGame } from "@/game/store/game-store";
import { Earth } from "@/game/world/globe/Earth";
import { GLOBE_THEMES } from "@/game/world/globe/globe-theme";
import { formatLocalTime, shortOrgName } from "@/lib/format";
import { countryName, deriveLocations, type Location } from "@/lib/locations";
import { OfficeBuilding } from "./building";
import { enterOffice, useArrival } from "./CityScene";
import { CitySky } from "./CitySky";
import { type Furniture, furnitureColliders } from "./generator";
import { Colliders } from "./Ground";
import { type Kiosk as KioskSpot, hubLayout } from "./hub-layout";
import { GOLDEN_HOUR } from "./lighting";
import { box, cone, cylinder, ico, Merged, type Part, place as placed } from "./merge";
import { Pedestrians } from "./pedestrians";
import { hashString, mulberry32, range } from "./random";
import { kioskPainter, useCanvasTexture } from "./signs";
import { StreetFurniture } from "./StreetFurniture";

/**
 * The Global Hub (phase O4 › 6), Worldwide's campus: a floating island above a slowly turning
 * low-poly Earth (the O3 globe) and a layer of cloud, in a fixed golden hour. The hub building
 * stands to the north; along the plaza, one portal kiosk per office asks "Travel to Berlin?".
 */
const GRASS = "#8fae7d";
const PAVING = "#e6e7e0";
const PATH = "#cfc6ad";
const ROCK = "#8a7f72";
const ROCK_DARK = "#6f665b";
const RAIL = "#eef1ec";
/** Thinner haze than the city's, so the globe below keeps its colours. */
const HUB_FOG = { near: 150, far: 480 };

function island(radius: number): Part[] {
  const parts: Part[] = [];
  const add = (color: string, geometry: Part["geometry"]) => parts.push({ color, geometry });
  add(GRASS, cylinder(radius + 1, radius + 0.6, 1.4, 28, { at: [0, -0.7, 0] }));
  add(PAVING, cylinder(18.5, 18.5, 0.06, 28, { at: [0, 0.03, 0] }));
  add(PATH, placed(new RingGeometry(23, 25, 32), { at: [0, 0.04, 0], rot: [-Math.PI / 2, 0, 0] }));
  add(PAVING, box(3.2, 0.06, 7, { at: [0, 0.035, -19] }));
  // The rock beneath, in two jagged layers.
  add(ROCK, cone(radius + 0.6, 16, 11, { at: [0, -9.4, 0], rot: [Math.PI, 0, 0] }));
  add(ROCK_DARK, cone(radius * 0.55, 18, 7, { at: [3, -24, -2], rot: [Math.PI, 0.4, 0] }));
  const random = mulberry32(hashString("hub-rocks"));
  for (let k = 0; k < 9; k++) {
    const angle = (k / 9) * Math.PI * 2 + random();
    const r = range(random, radius * 0.45, radius * 0.85);
    add(k % 2 ? ROCK : ROCK_DARK, ico(range(random, 3, 6), 0, { at: [Math.sin(angle) * r, range(random, -10, -4), Math.cos(angle) * r] }));
  }
  // A low railing round the edge, with posts.
  const segments = 36;
  for (let k = 0; k < segments; k++) {
    const angle = (k / segments) * Math.PI * 2;
    const length = ((2 * Math.PI * radius) / segments) * 1.02;
    add(RAIL, box(length, 0.12, 0.12, { at: [Math.sin(angle) * radius, 1.0, Math.cos(angle) * radius], rot: [0, angle, 0] }));
    add(RAIL, box(0.14, 1.05, 0.14, { at: [Math.sin(angle) * radius, 0.52, Math.cos(angle) * radius] }));
  }
  return parts;
}

/** Lamps along the ring path, trees on the lawn beyond it, benches by the plaza. */
function hubFurniture(radius: number): Furniture[] {
  const items: Furniture[] = [];
  const random = mulberry32(hashString("hub-furniture"));
  for (let k = 0; k < 12; k++) {
    const angle = ((k + 0.5) / 12) * Math.PI * 2;
    items.push({ kind: "lamp", x: Math.sin(angle) * 22.4, z: Math.cos(angle) * 22.4, yaw: angle + Math.PI, scale: 0.9 });
  }
  for (let k = 0; k < 22; k++) {
    const angle = (k / 22) * Math.PI * 2 + range(random, -0.08, 0.08);
    const r = range(random, 26.5, radius - 1.6);
    // Keep the lawn north of the building open.
    if (Math.cos(angle) < -0.86) continue;
    items.push({ kind: "tree", x: Math.sin(angle) * r, z: Math.cos(angle) * r, yaw: random() * 6.3, scale: range(random, 0.8, 1.2) });
  }
  for (const x of [-4.5, 4.5]) items.push({ kind: "bench", x, z: 13.5, yaw: Math.PI, scale: 1 });
  return items;
}

const CLOUD = "#f6f1e8";
const dummy = new Object3D();
const tint = new Color();

/** A ring of puffy low-poly clouds below the island, turning slowly. */
function Clouds() {
  const group = useRef<Group>(null);
  const mesh = useRef<InstancedMesh>(null);
  const puffs = useMemo(() => {
    const random = mulberry32(hashString("hub-clouds"));
    return Array.from({ length: 90 }, (_, index) => {
      const cluster = Math.floor(index / 3);
      const angle = (cluster / 30) * Math.PI * 2 + random() * 0.15;
      const r = 55 + (cluster % 3) * 32 + random() * 14;
      return {
        x: Math.sin(angle) * r + range(random, -5, 5),
        y: -32 - (cluster % 4) * 7 + range(random, -2, 2),
        z: Math.cos(angle) * r + range(random, -5, 5),
        scale: range(random, 5, 10),
      };
    });
  }, []);
  const geometry = useMemo(() => ico(1, 1, { scale: [1.5, 0.7, 1.1] }), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const clouds = mesh.current;
    if (!clouds) return;
    puffs.forEach((puff, index) => {
      dummy.position.set(puff.x, puff.y, puff.z);
      dummy.rotation.set(0, index, 0);
      dummy.scale.setScalar(puff.scale);
      dummy.updateMatrix();
      clouds.setMatrixAt(index, dummy.matrix);
      clouds.setColorAt(index, tint.set(CLOUD).multiplyScalar(0.94 + (index % 5) * 0.015));
    });
    clouds.instanceMatrix.needsUpdate = true;
    if (clouds.instanceColor) clouds.instanceColor.needsUpdate = true;
    clouds.computeBoundingSphere();
  }, [puffs]);

  useFrame((_, delta) => group.current?.rotateY(delta * 0.006));
  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geometry, undefined, puffs.length]}>
        <meshStandardMaterial roughness={1} flatShading emissive="#ffe9cf" emissiveIntensity={0.12} />
      </instancedMesh>
    </group>
  );
}

/**
 * The O3 globe, below and out beyond the plaza's south rail. Seen from the plaza, the island's
 * rim hides anything more than about 10° below the horizon, so the globe's crown sits about 5°
 * down: turn round and it looms past the railing. It turns once every twenty minutes or so.
 */
function EarthBelow() {
  const group = useRef<Group>(null);
  useFrame((_, delta) => group.current?.rotateY(delta * 0.005));
  return (
    <group ref={group} position={[0, -72, 150]} scale={62} rotation={[0.35, 0, 0.2]}>
      <Earth detail={10} theme={GLOBE_THEMES.light} />
    </group>
  );
}

function Kiosk({ spot, place, orgName }: { spot: KioskSpot; place: Location; orgName: string }) {
  const accent = place.palette.accent;
  const detail = [place.roleLabel, place.country ? countryName(place.country) : null].filter(Boolean).join(" · ");
  const texture = useCanvasTexture(512, 320, kioskPainter(place.name, detail, accent), `${place.id}|${detail}|${accent}`);
  const travel = () => {
    const time = formatLocalTime(Date.now(), place.timezone);
    const role = place.roleLabel.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
    useGame.getState().openModal({
      type: "travel",
      locationId: place.id,
      name: place.name,
      detail: `You'll arrive outside ${shortOrgName(orgName)}'s ${place.name} ${role}, where it's ${time}.`,
    });
  };
  return (
    <group position={[spot.x, 0, spot.z]} rotation={[0, spot.yaw, 0]}>
      <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.3, 1.6]} />
        <meshStandardMaterial color={PAVING} roughness={0.8} flatShading />
      </mesh>
      {[-1.1, 1.1].map((x) => (
        <mesh key={x} position={[x, 1.6, 0]} castShadow>
          <boxGeometry args={[0.28, 2.6, 0.4]} />
          <meshStandardMaterial color={accent} roughness={0.6} flatShading />
        </mesh>
      ))}
      <mesh position={[0, 3.0, 0]} castShadow>
        <boxGeometry args={[2.6, 0.3, 0.44]} />
        <meshStandardMaterial color={accent} roughness={0.6} flatShading />
      </mesh>
      {/* The portal: a soft glow of the city's colour inside the frame. */}
      <mesh position={[0, 1.65, 0]}>
        <circleGeometry args={[0.9, 24]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.7} transparent opacity={0.6} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.95, 1.0]} rotation={[-0.35, 0, 0]}>
        <planeGeometry args={[1.5, 0.94]} />
        <meshStandardMaterial map={texture} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.5, 0.95]} rotation={[-0.35, 0, 0]}>
        <boxGeometry args={[1.6, 0.9, 0.08]} />
        <meshStandardMaterial color={RAIL} roughness={0.8} />
      </mesh>
      <Interactable id={`kiosk-${place.id}`} kind="use" label={`Travel to ${place.name}`} radius={1.9} position={[0, 0, 1.6]} onInteract={travel} />
    </group>
  );
}

export default function GlobalHub({ place }: { place: Location }) {
  const office = useGame((s) => s.office);
  const tier = TIERS[useGame(selectTier)];
  const destinations = useMemo(
    () => (office ? deriveLocations(office.org, office.documents).filter((location) => location.role !== "hub") : []),
    [office],
  );
  const layout = useMemo(() => hubLayout(destinations.length), [destinations.length]);
  const furniture = useMemo(() => hubFurniture(layout.radius), [layout.radius]);
  const orgName = office?.org.name ?? "DocuMind";
  useArrival(place, false);

  return (
    <>
      <CitySky sky={GOLDEN_HOUR} extent={32} fog={HUB_FOG} />
      <Merged build={() => island(layout.radius)} version={String(layout.radius)} castShadow={false} />
      <Colliders colliders={layout.colliders} />
      <Colliders colliders={furnitureColliders(furniture, 0)} />
      <StreetFurniture furniture={furniture} night={0} shadows={tier.shadows} base={0} />
      <OfficeBuilding
        site={layout.office}
        entrance={layout.entrance}
        base={0}
        orgName={orgName}
        placeName={place.name}
        night={0}
        onEnter={() => enterOffice(place)}
      />
      {layout.kiosks.map((spot) => (
        <Kiosk key={destinations[spot.index].id} spot={spot} place={destinations[spot.index]} orgName={orgName} />
      ))}
      <Pedestrians graph={layout.walk} count={Math.min(tier.maxNpcs, 8)} seed={hashString(place.id)} groundAt={() => 0} />
      <Clouds />
      <EarthBelow />
    </>
  );
}
