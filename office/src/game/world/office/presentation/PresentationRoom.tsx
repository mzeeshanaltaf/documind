import { Html, useVideoTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { type RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Color, type InstancedMesh, Matrix4, type Mesh, type Object3D, Vector3 } from "three";
import { PRESENTER_NPC, presenterFor } from "@/content/personas";
import { Interactable } from "@/game/interact/Interactable";
import { Npc } from "@/game/npc/Npc";
import { useAnswerGesture, useNpcSpeech } from "@/game/npc/use-speech";
import { rig } from "@/game/player/rig";
import { emit } from "@/game/quests/bus";
import { threadKey, useGame } from "@/game/store/game-store";
import { mergeVertexColored } from "../../city/merge";
import { SAMPLE_CITY } from "../../city/sample";
import { type Floorplan, insideRect, type Room } from "../floorplan";
import { useNear } from "../use-near";
import { SlideView } from "./deck";
import { auditoriumParts } from "./furniture";
import { type Auditorium, auditoriumLayout, type Seat } from "./layout";
import { type ProgrammeSlide, type SlideVideo } from "./slides";
import { currentEntry, seeSlide, useProgramme } from "./use-programme";

/**
 * The presentation room (phase O7): an auditorium off the lobby where the presentation always
 * runs. The screen shows the current slide as DOM (drei `Html transform`, occluded by the room's
 * walls) or the explainer as a video texture; the loop advances by itself until someone sits,
 * then ←/→ page it. Seats frame the screen and dim the room. The presenter by the lectern
 * gestures and says each slide's line, and answers questions from the overview documents.
 */
const VISUAL_RANGE = 20;
const PRESENTER_RANGE = 16;
/** The video plays while the player is seated or this close to the screen. */
const VIDEO_RANGE = 8;
/** How long the presenter's line stays up after a slide change. */
const LINE_MS = 7000;
const ROOM_NAME = "Presentation room";
const SEEN_FROM = [ROOM_NAME];
/** The screen's DOM is laid out at 960×540 px and scaled onto the 4.4 m screen. */
const SLIDE_PX = 960;
/** Exposure while seated (the house lights go down); 1 otherwise. */
const DIMMED = 0.55;

export function PresentationRoom({ plan }: { plan: Floorplan }) {
  const room = plan.rooms.find((r) => r.kind === "presentation");
  const door = plan.doors.find((d) => d.to === "presentation");
  if (!room || !door) return null;
  return <Auditorium room={room} plan={plan} doorZ={door.z} doorWidth={door.width} />;
}

function Auditorium({ room, plan, doorZ, doorWidth }: { room: Room; plan: Floorplan; doorZ: number; doorWidth: number }) {
  const layout = useMemo(() => auditoriumLayout(room, { z: doorZ, width: doorWidth }), [room, doorZ, doorWidth]);
  const programme = useProgramme();
  const near = useNear(room.rect.x, room.rect.z, VISUAL_RANGE);
  const presenterNear = useNear(room.rect.x, room.rect.z, PRESENTER_RANGE);

  useEffect(() => {
    useGame.getState().setPresentationCount(programme.length);
  }, [programme.length]);

  return (
    <>
      <RigidBody type="fixed" colliders={false} userData={{ surface: "carpet" }}>
        {layout.colliders.map((collider, index) => (
          <CuboidCollider key={index} args={collider.half} position={collider.center} />
        ))}
      </RigidBody>
      <Director programme={programme} room={room} />
      {near && (
        <>
          <Furniture room={room} layout={layout} />
          <Screen layout={layout} programme={programme} plan={plan} room={room} />
          <ProgressDots layout={layout} programme={programme} />
          <Seats layout={layout} />
        </>
      )}
      {presenterNear && <Presenter layout={layout} programme={programme} />}
    </>
  );
}

function Furniture({ room, layout }: { room: Room; layout: Auditorium }) {
  const built = useMemo(() => {
    const { matte, glow } = auditoriumParts(room, layout);
    return { matte: mergeVertexColored(matte), glow: mergeVertexColored(glow) };
  }, [room, layout]);
  useEffect(
    () => () => {
      built.matte.dispose();
      built.glow.dispose();
    },
    [built],
  );
  return (
    <group userData={{ room: "presentation" }}>
      <mesh geometry={built.matte} castShadow receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={0.85} />
      </mesh>
      <mesh geometry={built.glow}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * Runs the loop: advances every `durationS` while nobody is watching up close, records seen
 * slides (seated or reading full screen: as they come up; otherwise once a slide has run its
 * whole time with the player in the room), and dims the house lights while seated.
 */
function Director({ programme, room }: { programme: ProgrammeSlide[]; room: Room }) {
  const local = useRef({ slide: -1, timer: 0, seenKey: "" });

  useFrame((state, delta) => {
    const s = useGame.getState();
    const watching = s.player.pose === "sit" && !!s.player.seat?.view;
    const target = watching ? DIMMED : 1;
    state.gl.toneMappingExposure += (target - state.gl.toneMappingExposure) * (1 - Math.exp(-3 * Math.min(delta, 0.1)));

    const entry = currentEntry(programme, s.presentation.slide);
    if (!entry || s.world.phase !== "ready") return;
    const l = local.current;
    if (s.presentation.slide !== l.slide) {
      l.slide = s.presentation.slide;
      l.timer = 0;
    }
    const reading = s.modal?.type === "slides";
    if (watching || reading) {
      l.timer = 0;
      const key = `${entry.deck.id}:${entry.slide.id}`;
      if (l.seenKey !== key) {
        l.seenKey = key;
        seeSlide(entry);
      }
      return;
    }
    l.seenKey = "";
    l.timer += Math.min(delta, 0.25);
    if (l.timer < entry.slide.durationS) return;
    if (insideRect(room.rect, rig.position.x, rig.position.z)) seeSlide(entry);
    s.stepSlide(1);
  });

  // Leaving the office while seated: the next scene gets the house lights back.
  const gl = useThree((state) => state.gl);
  useEffect(() => () => restoreExposure(gl), [gl]);
  return null;
}

function restoreExposure(renderer: { toneMappingExposure: number }) {
  renderer.toneMappingExposure = 1;
}

/**
 * The screen: a plane on the west wall. The current slide sits on it as DOM, hidden by the
 * room's walls (invisible occluder boxes from the floor plan) when seen from outside; the video
 * slide puts the explainer on the plane itself.
 */
function Screen({ layout, programme, plan, room }: { layout: Auditorium; programme: ProgrammeSlide[]; plan: Floorplan; room: Room }) {
  const slide = useGame((s) => s.presentation.slide);
  const office = useGame((s) => s.office);
  const entry = currentEntry(programme, slide);
  const place = office?.place ?? SAMPLE_CITY;
  const slidePlace = useMemo(() => ({ id: place.id, name: place.name, hub: place.role === "hub" }), [place]);
  const occluders = useRef<Object3D>(null);
  // drei types the refs as non-null; it reads `.current` each frame, after the group mounts.
  const occlude = useMemo(() => [occluders as RefObject<Object3D>], []);
  const walls = useMemo(() => roomWalls(plan, room), [plan, room]);
  const { center, width, height, yaw } = layout.screen;
  const video = entry?.slide.kind === "video" ? entry.slide.video : undefined;

  return (
    <>
      <group ref={occluders}>
        {walls.map((wall, index) => (
          <mesh key={index} position={wall.center} visible={false}>
            <boxGeometry args={[wall.half[0] * 2, wall.half[1] * 2, wall.half[2] * 2]} />
          </mesh>
        ))}
      </group>
      <group position={center} rotation={[0, yaw, 0]}>
        {video ? (
          <Suspense fallback={<BlankScreen width={width} height={height} />}>
            <ScreenVideo video={video} width={width} height={height} />
          </Suspense>
        ) : (
          <BlankScreen width={width} height={height} />
        )}
        {entry && !video && (
          <Html
            transform
            occlude={occlude}
            position={[0, 0, 0.012]}
            distanceFactor={(width * 400) / SLIDE_PX}
            zIndexRange={[9, 0]}
            pointerEvents="none"
            className="pointer-events-none select-none"
          >
            <div aria-hidden data-slide-screen={`${entry.deck.id}:${entry.slide.id}`}>
              <SlideView entry={entry} variant="screen" place={slidePlace} />
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

function BlankScreen({ width, height }: { width: number; height: number }) {
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color="#f9fcfa" toneMapped={false} />
    </mesh>
  );
}

/** The room's own walls (with the door cut out), as occluders for the screen's DOM. */
function roomWalls(plan: Floorplan, room: Room) {
  const { x, z, w, d } = room.rect;
  return plan.walls.filter((wall) => {
    const [cx, , cz] = wall.center;
    const onX = Math.abs(Math.abs(cx - x) - w / 2) < 0.2 && Math.abs(cz - z) <= d / 2 + 0.2;
    const onZ = Math.abs(Math.abs(cz - z) - d / 2) < 0.2 && Math.abs(cx - x) <= w / 2 + 0.2;
    return onX || onZ;
  });
}

const playing = (video: HTMLVideoElement) => !video.paused && !video.ended;
/** Plain helpers: the React Compiler lint rejects mutating a value a hook returned. */
const rewind = (video: HTMLVideoElement) => {
  video.currentTime = 0;
};
const mute = (video: HTMLVideoElement, muted: boolean) => {
  video.muted = muted;
};

/**
 * The explainer on the screen (drei `useVideoTexture`, muted, no loop). It restarts each time
 * its slide comes up, plays while the player is seated or within 8 m, and pauses otherwise.
 * drei caches the video by URL, so it downloads once per visit.
 */
function ScreenVideo({ video, width, height }: { video: SlideVideo; width: number; height: number }) {
  // `loadeddata` (with preload) so the first frame is there even while it waits paused.
  const texture = useVideoTexture(video.src, {
    start: false,
    muted: true,
    loop: false,
    playsInline: true,
    crossOrigin: "anonymous",
    preload: "auto",
    unsuspend: "loadeddata",
  });
  const muted = useGame((s) => s.presentation.muted);
  const element = texture.image as HTMLVideoElement;
  const mesh = useRef<Mesh>(null);
  const wait = useRef(0);

  useLayoutEffect(() => {
    rewind(element);
    return () => element.pause();
  }, [element]);

  useEffect(() => {
    mute(element, muted || !video.hasAudio);
  }, [element, muted, video.hasAudio]);

  useFrame((_, delta) => {
    wait.current -= delta;
    if (wait.current > 0 || !mesh.current) return;
    wait.current = 0.25;
    const s = useGame.getState();
    const seated = s.player.pose === "sit" && !!s.player.seat?.view;
    const at = mesh.current.getWorldPosition(scratch);
    const near = Math.hypot(rig.position.x - at.x, rig.position.z - at.z) <= VIDEO_RANGE;
    const want = (seated || near) && s.world.phase === "ready" && document.visibilityState === "visible";
    if (want && !playing(element) && !element.ended) void element.play().catch(() => undefined);
    else if (!want && playing(element)) element.pause();
  });

  return (
    <mesh ref={mesh}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

const scratch = new Vector3();

const DOT = { size: 0.07, gap: 0.16, deckGap: 0.34 };
const DOT_COLORS = { current: new Color("#1a5d48"), seen: new Color("#5e6a64"), unseen: new Color("#c9cfc8") };
const dotMatrix = new Matrix4();

/** One dot per slide under the screen, the current one green, a gap between the two decks. */
function ProgressDots({ layout, programme }: { layout: Auditorium; programme: ProgrammeSlide[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const slide = useGame((s) => s.presentation.slide);
  const seen = useGame((s) => s.presentation.seen);
  const count = programme.length;
  const offsets = useMemo(() => {
    const raw: number[] = [];
    let at = 0;
    programme.forEach((entry, index) => {
      if (index > 0) at += entry.index === 0 ? DOT.deckGap : DOT.gap;
      raw.push(at);
    });
    const middle = (raw.at(-1) ?? 0) / 2;
    return raw.map((value) => value - middle);
  }, [programme]);

  useLayoutEffect(() => {
    const dots = mesh.current;
    if (!dots) return;
    offsets.forEach((offset, index) => {
      dotMatrix.makeTranslation(offset, 0, 0);
      dots.setMatrixAt(index, dotMatrix);
      const entry = programme[index];
      const color =
        index === slide ? DOT_COLORS.current : (seen[entry.deck.id] ?? []).includes(entry.slide.id) ? DOT_COLORS.seen : DOT_COLORS.unseen;
      dots.setColorAt(index, color);
    });
    dots.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
  }, [offsets, programme, slide, seen]);

  const { center, height, yaw } = layout.screen;
  if (count === 0) return null;
  return (
    <group position={[center[0] + 0.01, center[1] - height / 2 - 0.16, center[2]]} rotation={[0, yaw, 0]}>
      <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]}>
        <circleGeometry args={[DOT.size / 2, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/** "E · Sit" on every seat; sitting frames the screen. */
function Seats({ layout }: { layout: Auditorium }) {
  const view = layout.screen.center;
  return (
    <>
      {layout.seats.map((seat) => (
        <SeatSpot key={seat.id} seat={seat} view={view} />
      ))}
    </>
  );
}

function SeatSpot({ seat, view }: { seat: Seat; view: [number, number, number] }) {
  const [x, y, z] = seat.position;
  const sit = () => useGame.getState().sit({ id: seat.id, position: seat.position, yaw: seat.yaw, view });
  // The prompt comes from just in front of the chair (the chair block itself is solid).
  return <Interactable id={seat.id} kind="sit" label="Sit" radius={0.75} position={[x - 0.62, y, z]} onInteract={sit} />;
}

/**
 * The presenter by the lectern: gestures as each slide comes up and says its line (static, no
 * quota) while the player is in the room. E opens the chat, scoped to the overview documents.
 */
function Presenter({ layout, programme }: { layout: Auditorium; programme: ProgrammeSlide[] }) {
  const orgSlug = useGame((s) => s.office?.org.slug ?? "simtora");
  const location = useGame((s) => s.office?.place.id ?? SAMPLE_CITY.id);
  const persona = useMemo(() => presenterFor(orgSlug), [orgSlug]);
  const key = threadKey(location, PRESENTER_NPC);
  const talking = useGame((s) => s.chat[key]?.turns.at(-1)?.status === "streaming");
  const [line, setLine] = useState<string | null>(null);
  const [cue, setCue] = useState(false);
  const speech = useNpcSpeech(key, line);
  const answered = useAnswerGesture(key);
  const latest = useRef(programme);
  useLayoutEffect(() => {
    latest.current = programme;
  });

  // A new slide: the presenter turns to it with a gesture and says its line.
  useEffect(() => {
    let lineTimer: ReturnType<typeof setTimeout> | undefined;
    let cueTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useGame.subscribe((state, previous) => {
      if (state.presentation.slide === previous.presentation.slide) return;
      const entry = currentEntry(latest.current, state.presentation.slide);
      if (!entry || state.world.location.room !== ROOM_NAME) return;
      clearTimeout(lineTimer);
      clearTimeout(cueTimer);
      setLine(entry.slide.speakerLine);
      setCue(true);
      lineTimer = setTimeout(() => setLine(null), LINE_MS);
      cueTimer = setTimeout(() => setCue(false), 2400);
    });
    return () => {
      unsubscribe();
      clearTimeout(lineTimer);
      clearTimeout(cueTimer);
    };
  }, []);

  const talk = () => {
    setLine(null);
    const state = useGame.getState();
    const [x, , z] = layout.presenter.position;
    const focus: [number, number, number] = [x, 1.8, z];
    if (state.office) {
      state.startDialogue({ type: "npc", npc: PRESENTER_NPC, view: "chat" }, focus);
    } else {
      state.startDialogue(
        { type: "dialogue", npc: PRESENTER_NPC, name: persona.name, role: persona.role, lines: ["Pick an org and an office to ask me about the company."] },
        focus,
      );
    }
    emit({ type: "npc_talked", npc: PRESENTER_NPC });
  };

  return (
    <Npc
      persona={persona}
      spot={layout.presenter}
      interactId={`npc:${PRESENTER_NPC}`}
      onTalk={talk}
      talking={talking}
      gesturing={answered || cue}
      speech={speech}
      radius={2.6}
      seenFrom={SEEN_FROM}
    />
  );
}
