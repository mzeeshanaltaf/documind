import { Stars } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useState } from "react";
import { audio } from "@/game/audio/audio";
import { SunLight } from "@/game/engine/SunLight";
import { TIERS } from "@/game/engine/quality";
import { Interactable } from "@/game/interact/Interactable";
import { ACHIEVEMENTS } from "@/game/quests/definitions";
import { selectTier, type Seat, useGame, type Vec3 } from "@/game/store/game-store";
import { landmarkInfo } from "@/content/landmarks";
import { ambienceFor } from "../city/ambience";
import { Buildings } from "../city/Buildings";
import { CitySky } from "../city/CitySky";
import { CITY, type CityLayout, generateCity } from "../city/generator";
import { Ground } from "../city/Ground";
import { LANDMARKS } from "../city/landmarks";
import { SAMPLE_CITY } from "../city/sample";
import { useCanvasTexture } from "../city/signs";
import { Traffic } from "../city/traffic";
import { useCitySky } from "../city/use-city-sky";
import { Earth } from "../globe/Earth";
import { GLOBE_THEMES } from "../globe/globe-theme";
import { SANDBOX_SPAWNS } from "../sandbox/spawns";
import { countryName } from "@/lib/locations";
import { Fireworks } from "./Fireworks";
import { rooftopLayout, type RooftopLayout } from "./rooftop-layout";
import { rooftopParts } from "./rooftop-parts";
import { FAME, famePainter } from "./rooftop-texture";
import { floorplanFor, useOfficeDepartments } from "./use-floorplan";
import { mergeVertexColored } from "../city/merge";

/**
 * The rooftop lounge (phase O9 › Rooftop), reached by the corridor's lift once the core quests are
 * done: a deck with sofas, planters and string lights, a telescope that zooms to the city's
 * landmark with a fun fact, a button that launches fireworks (and does so by itself on the first
 * visit), and a wall of fame listing the player's achievements. Round the deck is the same
 * generated city as the street scene, seen from the tower's roof; Worldwide's deck floats above the
 * globe instead.
 */
const FIREWORKS_DELAY_MS = 900;
const SCOPE_FOV = 22;
/** The telescope's sight line falls at most this much per metre (about 8°). */
const SCOPE_MAX_DROP = 0.14;
/** The globe under the Worldwide deck, and where the telescope looks (below the horizon, in front). */
const HUB_GLOBE = { radius: 700, drop: 745 };
const HUB_LOOK: Vec3 = [30, -60, -120];
const HUB_SKY = "#0d1513";

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export default function RooftopScene() {
  const office = useGame((s) => s.office);
  const place = office?.place ?? SAMPLE_CITY;
  const hub = place.landmarkKit === "global-hub";
  const layout = useMemo(() => rooftopLayout(), []);
  const city = useMemo(() => (hub ? null : generateCity(place)), [hub, place]);
  const sky = useCitySky(place);
  const night = sky.night;

  // Where the telescope points: the landmark's park in the city, or down at the globe.
  const focus = useMemo(() => {
    const [tx, , tz] = layout.telescope;
    const look: Vec3 = city ? [city.landmark.park.x - city.office.rect.x, -city.office.height + 14, city.landmark.park.z - city.office.rect.z] : HUB_LOOK;
    return { look, aim: Math.atan2(look[0] - tx, look[2] - tz) };
  }, [city, layout]);

  const [launch, setLaunch] = useState(0);
  // The first visit gets a show of its own (the achievement is awarded as the scene mounts).
  const [first] = useState(() => !useGame.getState().progress.achievements.rooftop);

  useEffect(() => {
    useGame.getState().setLocation({ room: "Rooftop" });
    const sound = ambienceFor(place.landmarkKit);
    audio.loop("ambience", sound.ambience);
    audio.loop("music", sound.music);
    return () => {
      audio.loop("ambience", null);
      audio.loop("music", null);
    };
  }, [place]);

  useEffect(() => {
    if (!first) return;
    let timer: number | undefined;
    const start = () => {
      timer = window.setTimeout(() => setLaunch((n) => n + 1), FIREWORKS_DELAY_MS);
    };
    if (useGame.getState().world.phase === "ready") {
      start();
      return () => window.clearTimeout(timer);
    }
    const off = useGame.subscribe((state) => {
      if (state.world.phase !== "ready") return;
      off();
      start();
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [first]);

  return (
    <>
      {hub ? <HubSky /> : <CitySky sky={sky} extent={24} />}
      {city && <Panorama place={place} city={city} night={night} />}
      {hub && <HubGlobe />}
      <Deck layout={layout} aim={focus.aim} night={night} />
      <Stations layout={layout} look={focus.look} landmark={landmarkInfo(office?.org.slug ?? "", place)} onLaunch={() => setLaunch((n) => n + 1)} />
      <WallOfFame layout={layout} />
      <Fireworks launch={launch} />
    </>
  );
}

/** Space round the floating island: a dark sky, stars, a key light. */
function HubSky() {
  return (
    <>
      <color attach="background" args={[HUB_SKY]} />
      <hemisphereLight args={["#dfe9e4", "#1c2622", 1.1]} />
      <SunLight position={[40, 60, 30]} intensity={2} extent={24} follow far={160} />
      <Stars radius={300} depth={60} count={2200} factor={4.5} saturation={0} fade speed={0} />
    </>
  );
}

function HubGlobe() {
  return (
    <group position={[0, -HUB_GLOBE.drop, 0]} scale={HUB_GLOBE.radius}>
      <Earth detail={5} theme={GLOBE_THEMES.light} />
    </group>
  );
}

/** The street scene's city, lowered so the tower's roof is the deck: the office stands under (0, 0, 0). */
function Panorama({ place, city, night }: { place: typeof SAMPLE_CITY; city: CityLayout; night: number }) {
  const tier = TIERS[useGame(selectTier)];
  const Landmark = LANDMARKS[place.landmarkKit === "global-hub" ? "generic" : place.landmarkKit];
  return (
    <group position={[-city.office.rect.x, -city.office.height, -city.office.rect.z]}>
      <Ground layout={city} />
      <Buildings layout={city} night={night} />
      <Landmark
        site={city.landmark}
        vista={city.vista}
        garden={city.garden}
        curb={CITY.curb}
        night={night}
        accent={place.palette.accent}
        placeName={place.name}
        countryName={place.country ? countryName(place.country) : ""}
      />
      <Traffic layout={city} count={Math.min(tier.maxCars, 10)} shadows={false} />
    </group>
  );
}

/** The deck: solid pieces, merged furniture, and warm lamps once it's dark. */
function Deck({ layout, aim, night }: { layout: RooftopLayout; aim: number; night: number }) {
  const built = useMemo(() => {
    const { matte, glow, glass } = rooftopParts(layout, aim);
    return { matte: mergeVertexColored(matte), glow: mergeVertexColored(glow), glass: mergeVertexColored(glass) };
  }, [layout, aim]);
  useEffect(
    () => () => {
      built.matte.dispose();
      built.glow.dispose();
      built.glass.dispose();
    },
    [built],
  );

  return (
    <>
      <RigidBody type="fixed" colliders={false} userData={{ surface: "concrete" }}>
        {layout.colliders.map((collider, index) => (
          <CuboidCollider key={index} args={collider.half} position={collider.center} />
        ))}
      </RigidBody>
      <mesh geometry={built.matte} castShadow receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={0.85} />
      </mesh>
      <mesh geometry={built.glow}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
      <mesh geometry={built.glass}>
        <meshStandardMaterial vertexColors transparent opacity={0.22} roughness={0.1} depthWrite={false} />
      </mesh>
      {night > 0.25 && (
        <>
          <pointLight position={[-6.5, 3, 0]} color="#ffd9a0" intensity={night * 22} distance={15} />
          <pointLight position={[0, 3, -4.5]} color="#ffd9a0" intensity={night * 16} distance={12} />
        </>
      )}
    </>
  );
}

/** Everything you can use up here, each an E-press from where you stand. */
function Stations({ layout, look, landmark, onLaunch }: { layout: RooftopLayout; look: Vec3; landmark: { name: string; fact: string }; onLaunch: () => void }) {
  const office = useGame((s) => s.office);
  const departments = useOfficeDepartments();
  const [tx, , tz] = layout.telescope;

  const goDown = () => {
    audio.play("door-close", { volume: 0.5 });
    // Back to the corridor's end in the office; the dev sandbox's lift has its own landing.
    useGame.getState().transitionTo(office ? "office" : "sandbox", office ? floorplanFor(departments).spawns.lift : SANDBOX_SPAWNS.lift);
  };

  const zoom = () => {
    audio.play("ui-open", { volume: 0.4 });
    // The eye sits well behind and above the eyepiece (the view is narrow, so a closer eye would
    // fill it with the tube itself).
    const aim = Math.atan2(look[0] - tx, look[2] - tz);
    const eye: Vec3 = [tx - Math.sin(aim) * 3, 2.7, tz - Math.cos(aim) * 3];
    // The landmark is far below; looking straight at it would aim into the parapet and the deck.
    // Keep the sight line shallow (8° down at most), over the wall, towards the landmark.
    const reach = Math.hypot(look[0] - eye[0], look[2] - eye[2]);
    const aimed: Vec3 = [look[0], Math.max(look[1], eye[1] - reach * SCOPE_MAX_DROP), look[2]];
    useGame.getState().startScope(
      { eye, look: aimed, fov: SCOPE_FOV },
      { title: landmark.name, lines: [landmark.fact] },
    );
  };

  const seats = useMemo(
    () =>
      layout.sofas.map<Seat>((sofa, index) => ({ id: `rooftop:sofa:${index}`, position: [sofa.position[0], 0.15, sofa.position[2]], yaw: sofa.yaw, relaxed: true })),
    [layout],
  );

  return (
    <>
      <Interactable id="rooftop:lift" kind="open" label="Take the lift down" radius={1.7} position={layout.lift.call} onInteract={goDown} />
      <Interactable id="rooftop:telescope" kind="use" label="Look through the telescope" radius={1.5} position={[tx - 0.9, 0, tz]} onInteract={zoom} />
      <Interactable id="rooftop:fireworks" kind="use" label="Launch the fireworks" radius={1.4} position={[layout.panel[0] - 0.8, 0, layout.panel[2]]} onInteract={onLaunch} />
      <Interactable
        id="rooftop:fame"
        kind="read"
        label="Read the Wall of fame"
        radius={1.8}
        position={layout.plaque.use}
        onInteract={() => useGame.getState().openModal({ type: "journal", tab: "achievements" })}
      />
      {seats.map((seat) => (
        <Interactable
          key={seat.id}
          id={seat.id}
          kind="sit"
          label="Sit and take in the view"
          radius={0.95}
          position={[seat.position[0] + Math.sin(seat.yaw) * 0.9, 0, seat.position[2] + Math.cos(seat.yaw) * 0.9]}
          onInteract={() => useGame.getState().sit(seat)}
        />
      ))}
    </>
  );
}

/** The plaque's face: the player's achievements, repainted whenever one unlocks. */
function WallOfFame({ layout }: { layout: RooftopLayout }) {
  const achievements = useGame((s) => s.progress.achievements);
  const orgName = useGame((s) => s.office?.org.name ?? "DocuMind Office");
  const entries = useMemo(
    () =>
      ACHIEVEMENTS.map((achievement) => {
        const at = achievements[achievement.id];
        return { title: achievement.title, unlocked: Boolean(at), date: at ? date.format(new Date(at)) : "" };
      }),
    [achievements],
  );
  const texture = useCanvasTexture(FAME.width, FAME.height, famePainter(orgName, entries), JSON.stringify([orgName, entries]));
  const { center, width, height } = layout.plaque;
  return (
    <mesh position={[center[0], center[1], center[2] + 0.07]}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={texture} roughness={0.8} />
    </mesh>
  );
}
