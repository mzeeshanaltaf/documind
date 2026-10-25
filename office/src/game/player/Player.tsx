import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  CapsuleCollider,
  type RapierCollider,
  type RapierRigidBody,
  RigidBody,
  useRapier,
} from "@react-three/rapier";
import { useEffect, useRef, useState } from "react";
import type { Group } from "three";
import { audio, surfaceOf } from "@/game/audio/audio";
import { TIERS } from "@/game/engine/quality";
import { combineMove, NO_MOVE } from "@/game/input/bindings";
import { emit } from "@/game/quests/bus";
import { type Seat, selectTier, useGame, type Vec3 } from "@/game/store/game-store";
import { Avatar, type AvatarHandle } from "./Avatar";
import type { ClipName } from "./avatar-clips";
import { CAFFEINE_BOOST } from "./boost";
import { resetRig, rig } from "./rig";

/** Capsule: 0.6 m half-height + 0.28 m radius = 1.76 m tall; its centre sits this far above the feet. */
const HALF_HEIGHT = 0.6;
const RADIUS = 0.28;
const CENTER = HALF_HEIGHT + RADIUS;

const WALK_SPEED = 2.2;
const RUN_SPEED = 4.8;
const GRAVITY = 22;
const TURN_RATE = 12;
/** Metres per footstep sound. */
const STEP_WALK = 0.78;
const STEP_RUN = 1.45;
/** Below this the player has fallen out of the level and goes back to the spawn. */
const KILL_Y = -25;

type KinematicCharacterController = ReturnType<ReturnType<typeof useRapier>["world"]["createCharacterController"]>;

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function Player() {
  const [spawn] = useState(() => useGame.getState().world.spawn);
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const visual = useRef<Group>(null);
  const avatar = useRef<AvatarHandle>(null);
  const { world, rapier } = useRapier();

  const colors = useGame((s) => s.player.avatar);
  const displayName = useGame((s) => s.player.displayName);
  // Hidden during a conversation: the camera is close, and the tag would fill the view.
  const showTag = useGame((s) => TIERS[selectTier(s)].nameTags && s.settings.show_name_tags && !s.cameraFocus);

  // Created and freed in one effect, so StrictMode's mount-unmount-mount never leaves a freed
  // controller behind.
  const controller = useRef<KinematicCharacterController | null>(null);
  useEffect(() => {
    const kcc = world.createCharacterController(0.02);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.enableAutostep(0.32, 0.15, false);
    kcc.enableSnapToGround(0.35);
    kcc.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    kcc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    kcc.setSlideEnabled(true);
    kcc.setApplyImpulsesToDynamicBodies(true);
    controller.current = kcc;
    return () => {
      controller.current = null;
      // free() directly: Physics frees its world before children unmount, and touching the
      // world proxy after that would create a new one.
      kcc.free();
    };
  }, [world]);

  const local = useRef({
    vy: 0,
    facing: spawn.yaw,
    clip: "idle" as ClipName,
    /** The seat being sat on, kept here so standing up still knows where "in front" is. */
    seated: null as Seat | null,
    publishIn: 0,
    published: spawn.position as Vec3,
    stride: 0,
  });

  useEffect(() => {
    resetRig(spawn.position, spawn.yaw, spawn.pitch);
    rig.body = body.current;
    return () => {
      rig.body = null;
    };
  }, [spawn]);

  function play(clip: ClipName, fade?: number) {
    if (local.current.clip === clip) return;
    local.current.clip = clip;
    avatar.current?.play(clip, fade);
  }

  function footstep(running: boolean) {
    const at = body.current?.translation();
    if (!at) return;
    // What's underfoot decides the sound (a few casts per second, so a fresh ray is fine).
    const ray = new rapier.Ray({ x: at.x, y: at.y - CENTER + 0.2, z: at.z }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 1, true, undefined, undefined, undefined, body.current ?? undefined);
    audio.footstep(surfaceOf(hit?.collider.parent()?.userData), running);
  }

  useFrame((_, rawDelta) => {
    const rb = body.current;
    const col = collider.current;
    const group = visual.current;
    const kcc = controller.current;
    if (!rb || !col || !group || !kcc) return;
    // Capped at 10 fps worth of time: slower frames walk slower, but a slow device still walks
    // at full speed down to 10 fps (the controller sweeps each step, so nothing tunnels).
    const delta = Math.min(rawDelta, 1 / 10);
    const s = useGame.getState();
    const state = local.current;
    const at = rb.translation();
    group.visible = !rig.cameraTooClose;

    const blocked = s.modal !== null || s.world.phase !== "ready";
    const move = blocked ? NO_MOVE : combineMove(s.input.keyboard, s.input.touch);
    const run = !blocked && (s.input.keyboardRun || s.input.touchRun);
    const moving = move.x !== 0 || move.y !== 0;
    // An emote (O8) plays until it ends, or until the player moves or something takes over.
    if (s.emote && (moving || blocked || performance.now() >= s.emote.until)) s.setEmote(null);

    // Seated: snap onto the seat once; any movement stands up in front of it (on an auditorium
    // seat only forward/back does: sideways is the slide changer, and touch may drift sideways).
    const seat = s.player.pose === "sit" ? s.player.seat : null;
    const leaving = seat?.view ? move.y !== 0 : moving;
    if (seat && !leaving) {
      if (state.seated?.id !== seat.id) {
        state.seated = seat;
        state.vy = 0;
        state.facing = seat.yaw;
        rb.setNextKinematicTranslation({ x: seat.position[0], y: seat.position[1] + CENTER, z: seat.position[2] });
        play("sit", 0.35);
        emit({ type: "sat", seat: seat.id });
      }
      group.rotation.y = state.facing;
      rig.facing = state.facing;
      rig.position.set(at.x, at.y - CENTER, at.z);
      rig.speed = 0;
      return;
    }
    if (state.seated) {
      const out = state.seated;
      state.seated = null;
      const front = { x: Math.sin(out.yaw) * 0.6, z: Math.cos(out.yaw) * 0.6 };
      rb.setNextKinematicTranslation({ x: out.position[0] + front.x, y: out.position[1] + CENTER + 0.02, z: out.position[2] + front.z });
      if (s.player.pose === "sit") s.stand();
      play("idle", 0.3);
      return;
    }

    // Camera-relative: forward is the camera's view direction on the floor.
    const sin = Math.sin(rig.yaw);
    const cos = Math.cos(rig.yaw);
    // The coffee machine's boost (O8) makes running faster.
    const speed = run ? RUN_SPEED * (s.caffeinatedUntil > Date.now() ? CAFFEINE_BOOST : 1) : WALK_SPEED;
    const vx = (-sin * move.y + cos * move.x) * speed;
    const vz = (-cos * move.y - sin * move.x) * speed;

    state.vy = Math.max(state.vy - GRAVITY * delta, -30);
    kcc.computeColliderMovement(
      col,
      { x: vx * delta, y: state.vy * delta, z: vz * delta },
      rapier.QueryFilterFlags.EXCLUDE_SENSORS,
    );
    const step = kcc.computedMovement();
    if (kcc.computedGrounded()) state.vy = 0;

    const next = { x: at.x + step.x, y: at.y + step.y, z: at.z + step.z };
    if (next.y < KILL_Y) {
      next.x = spawn.position[0];
      next.y = spawn.position[1] + CENTER;
      next.z = spawn.position[2];
      state.vy = 0;
    }
    rb.setNextKinematicTranslation(next);

    // Face the direction of travel, turning the short way round.
    if (moving) {
      const target = Math.atan2(vx, vz);
      state.facing += angleDelta(state.facing, target) * (1 - Math.exp(-TURN_RATE * delta));
    }
    group.rotation.y = state.facing;
    rig.facing = state.facing;

    const travelled = Math.hypot(step.x, step.z);
    const actual = delta > 0 ? travelled / delta : 0;
    rig.speed += (actual - rig.speed) * (1 - Math.exp(-14 * delta));
    rig.running = run && rig.speed > 3;
    rig.position.set(at.x, at.y - CENTER, at.z);

    if (rig.speed < 0.25) {
      play(s.emote ? s.emote.clip : "idle");
      state.stride = 0;
    } else {
      play(rig.running ? "run" : "walk");
      if (!rig.running) avatar.current?.setSpeed(Math.min(1.25, Math.max(0.55, rig.speed / WALK_SPEED)));
      state.stride += travelled;
      const stepLength = rig.running ? STEP_RUN : STEP_WALK;
      if (state.stride >= stepLength && kcc.computedGrounded()) {
        state.stride -= stepLength;
        footstep(rig.running);
      }
    }

    // The store gets the position at 10 Hz, and only when it changed.
    state.publishIn -= delta;
    if (state.publishIn <= 0) {
      state.publishIn = 0.1;
      const [px, py, pz] = state.published;
      const fx = at.x;
      const fy = at.y - CENTER;
      const fz = at.z;
      if (Math.abs(fx - px) + Math.abs(fy - py) + Math.abs(fz - pz) > 0.01) {
        state.published = [Math.round(fx * 100) / 100, Math.round(fy * 100) / 100, Math.round(fz * 100) / 100];
        s.setPlayerPosition(state.published);
      }
    }
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      colliders={false}
      position={[spawn.position[0], spawn.position[1] + CENTER, spawn.position[2]]}
      enabledRotations={[false, false, false]}
      userData={{ player: true }}
    >
      <CapsuleCollider ref={collider} args={[HALF_HEIGHT, RADIUS]} />
      <group ref={visual} position={[0, -CENTER, 0]} rotation={[0, spawn.yaw, 0]}>
        <Avatar ref={avatar} colors={colors} />
        {showTag && displayName && (
          <Html position={[0, 2.02, 0]} center occlude distanceFactor={9} zIndexRange={[20, 0]}>
            <span className="pointer-events-none rounded-md bg-background/90 px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground shadow-sm ring-1 ring-foreground/10 select-none">
              {displayName}
            </span>
          </Html>
        )}
      </group>
    </RigidBody>
  );
}
