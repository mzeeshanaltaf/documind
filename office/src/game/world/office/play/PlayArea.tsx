import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Mesh } from "three";
import { getLeaderboards } from "@/app/(game)/actions";
import { audio } from "@/game/audio/audio";
import { trackSources } from "@/game/audio/jukebox";
import { hasTriviaBank } from "@/game/games/trivia/banks";
import type { GameId } from "@/game/games/types";
import { Interactable } from "@/game/interact/Interactable";
import { CAFFEINE_BOOST, CAFFEINE_SECONDS } from "@/game/player/boost";
import { rig } from "@/game/player/rig";
import { emit } from "@/game/quests/bus";
import { useGame } from "@/game/store/game-store";
import type { Leaderboards } from "@/lib/leaderboard";
import { mergeVertexColored } from "../../city/merge";
import { INK, useCanvasTexture } from "../../city/signs";
import { type Floorplan, insideRect, type Room } from "../floorplan";
import { NOTICE, noticePainter } from "../signage";
import { useNear } from "../use-near";
import { playParts } from "./furniture";
import { beanbagSeats, type PlayLayout, playLayout, type Station } from "./layout";
import { BOARD, boardPainter } from "./textures";

/**
 * The play area (phase O8): the room east of the lobby, with an arcade cabinet (Policy Trivia),
 * a sorting station (Sort & Toss), a table-tennis table, beanbags, a coffee machine, a jukebox
 * and the leaderboard wall. E on a game station enters game mode (the camera locks on it and the
 * game takes the screen); everything else is a short interaction. Nothing here costs quota.
 */
const VISUAL_RANGE = 20;
const SIGN_SIZE: [number, number] = [0.96, 0.6];
/** How long the coffee machine's steam and cup show. */
const BREW_MS = 3200;

export function PlayArea({ plan }: { plan: Floorplan }) {
  const room = plan.rooms.find((r) => r.kind === "play");
  const door = plan.doors.find((d) => d.to === "play");
  if (!room || !door) return null;
  return <PlayRoom room={room} door={door} />;
}

function PlayRoom({ room, door }: { room: Room; door: { z: number; width: number } }) {
  const layout = useMemo(() => playLayout(room, door), [room, door]);
  const near = useNear(room.rect.x, room.rect.z, VISUAL_RANGE);
  const [brewing, setBrewing] = useState(false);

  const brew = () => {
    if (brewing) return;
    const state = useGame.getState();
    state.setCaffeinatedUntil(Date.now() + CAFFEINE_SECONDS * 1000);
    audio.play("success", { volume: 0.5, rate: 1.2 });
    toast("Caffeinated", { description: `Running is ${Math.round((CAFFEINE_BOOST - 1) * 100)}% faster for ${CAFFEINE_SECONDS} seconds.` });
    emit({ type: "coffee_brewed" });
    setBrewing(true);
    window.setTimeout(() => setBrewing(false), BREW_MS);
  };

  return (
    <>
      <RigidBody type="fixed" colliders={false} userData={{ surface: "wood" }}>
        {layout.colliders.map((collider, index) => (
          <CuboidCollider key={index} args={collider.half} position={collider.center} />
        ))}
      </RigidBody>
      <Stations layout={layout} onBrew={brew} />
      <Beanbags layout={layout} />
      <PlayMusic room={room} />
      {near && (
        <>
          <Furniture room={room} layout={layout} />
          <Signs layout={layout} />
          <LeaderboardWall layout={layout} />
          {brewing && <Steam position={layout.coffee.machine} />}
        </>
      )}
    </>
  );
}

function Furniture({ room, layout }: { room: Room; layout: PlayLayout }) {
  const built = useMemo(() => {
    const { matte, glow } = playParts(room, layout);
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
    <group userData={{ room: "play" }}>
      <mesh geometry={built.matte} castShadow receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={0.85} />
      </mesh>
      <mesh geometry={built.glow}>
        <meshBasicMaterial vertexColors toneMapped={false} />
      </mesh>
    </group>
  );
}

/** "E · Play …" at each station. A game opens game mode; the others open their own small UI. */
function Stations({ layout, onBrew }: { layout: PlayLayout; onBrew: () => void }) {
  const orgSlug = useGame((s) => s.office?.org.slug ?? "");
  return (
    <>
      {layout.stations.map((station) => (
        <StationSpot key={station.id} station={station} onBrew={onBrew} triviaReady={hasTriviaBank(orgSlug)} />
      ))}
    </>
  );
}

function StationSpot({ station, onBrew, triviaReady }: { station: Station; onBrew: () => void; triviaReady: boolean }) {
  const noTrivia = station.id === "trivia" && !triviaReady;

  const use = () => {
    const state = useGame.getState();
    switch (station.id) {
      case "trivia":
      case "sort_toss":
      case "table_tennis":
        if (noTrivia) {
          state.openModal({ type: "sign", title: "Policy Trivia", lines: ["No trivia for this org yet.", "The arcade needs a question bank made from the org's documents."] });
          return;
        }
        audio.play("ui-open", { volume: 0.5 });
        state.startGame(station.id as GameId, station.focus);
        emit({ type: "game_started", game: station.id as GameId });
        return;
      case "leaderboard":
        audio.play("ui-open", { volume: 0.4 });
        state.openModal({ type: "leaderboard" });
        return;
      case "jukebox":
        audio.play("ui-open", { volume: 0.4 });
        state.openModal({ type: "jukebox" });
        return;
      case "coffee":
        onBrew();
        return;
    }
  };

  return (
    <Interactable
      id={`play:${station.id}`}
      kind={station.id === "coffee" || station.id === "leaderboard" || station.id === "jukebox" ? "use" : "play"}
      label={noTrivia ? "Check the arcade cabinet" : station.label}
      radius={station.radius}
      position={station.spot}
      onInteract={use}
    />
  );
}

/** Beanbags: E sits, the camera settles; any movement stands up in front. */
function Beanbags({ layout }: { layout: PlayLayout }) {
  const seats = useMemo(() => beanbagSeats(layout), [layout]);
  return (
    <>
      {seats.map((seat) => {
        const [x, y, z] = seat.position;
        // The prompt comes from just in front of the bag, where the player stands to sit.
        const front: [number, number, number] = [x + Math.sin(seat.yaw) * 0.65, y, z + Math.cos(seat.yaw) * 0.65];
        return <Interactable key={seat.id} id={seat.id} kind="sit" label="Sit and lounge" radius={0.95} position={front} onInteract={() => useGame.getState().sit(seat)} />;
      })}
    </>
  );
}

/** The signs over the arcade and the sorting station. */
function Signs({ layout }: { layout: PlayLayout }) {
  return (
    <>
      {layout.signs.map((sign) => (
        <Sign key={sign.id} sign={sign} />
      ))}
    </>
  );
}

function Sign({ sign }: { sign: PlayLayout["signs"][number] }) {
  const texture = useCanvasTexture(NOTICE.width, NOTICE.height, noticePainter(sign.title, [sign.line], INK.green), `${sign.title}|${sign.line}`);
  return (
    <mesh position={sign.position} rotation={[0, sign.yaw, 0]}>
      <planeGeometry args={SIGN_SIZE} />
      <meshStandardMaterial map={texture} roughness={0.8} />
    </mesh>
  );
}

/**
 * The wall screen: each game's top five for the org. It fetches while the player is near and
 * again whenever a score is submitted (`scoresVersion`), and shows "Loading…" or "Couldn't
 * load" rather than an error.
 */
function LeaderboardWall({ layout }: { layout: PlayLayout }) {
  const orgId = useGame((s) => s.office?.org.id);
  const orgName = useGame((s) => s.office?.org.name ?? "DocuMind Office");
  const version = useGame((s) => s.scoresVersion);
  const [state, setState] = useState<{ boards: Leaderboards | null; failed: boolean }>({ boards: null, failed: false });

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    getLeaderboards({ orgId, period: "all" }).then(
      (boards) => live && setState({ boards, failed: boards === null }),
      () => live && setState((current) => ({ boards: current.boards, failed: current.boards === null })),
    );
    return () => {
      live = false;
    };
  }, [orgId, version]);

  const key = JSON.stringify([orgName, state.failed, state.boards]);
  const texture = useCanvasTexture(BOARD.width, BOARD.height, boardPainter(state.boards, orgName, state.failed), key);
  const { center, width, height, yaw } = layout.wall;
  return (
    <mesh position={[center[0], center[1], center[2] + 0.03]} rotation={[0, yaw, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}

/** The coffee machine's steam: three soft puffs rising from the cup for a moment. */
function Steam({ position }: { position: [number, number, number] }) {
  const puffs = useRef<(Mesh | null)[]>([]);
  const started = useRef(-1);
  useFrame((state) => {
    if (started.current < 0) started.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - started.current;
    puffs.current.forEach((puff, index) => {
      if (!puff) return;
      const phase = (t * 0.6 + index / 3) % 1;
      puff.position.set(-0.12 + Math.sin(t * 3 + index) * 0.03, 0.12 + phase * 0.5, (index - 1) * 0.06);
      puff.scale.setScalar(0.04 + phase * 0.05);
      (puff.material as { opacity: number }).opacity = 0.5 * (1 - phase);
    });
  });
  return (
    <group position={position}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(mesh) => void (puffs.current[i] = mesh)}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The jukebox's music, only while the player is in the play area: its pick, or silence. It
 * replaces the music bus for the visit and clears it on leaving, so the lobby stays quiet.
 */
function PlayMusic({ room }: { room: Room }) {
  const choice = useGame((s) => s.jukebox);
  const [inside, setInside] = useState(false);
  const wait = useRef(0);
  useFrame((_, delta) => {
    wait.current -= delta;
    if (wait.current > 0) return;
    wait.current = 0.3;
    const now = insideRect(room.rect, rig.position.x, rig.position.z);
    setInside((current) => (current === now ? current : now));
  });
  useEffect(() => {
    if (!inside || choice === "off") return;
    audio.loop("music", trackSources(choice));
    return () => audio.loop("music", null);
  }, [inside, choice]);
  return null;
}
