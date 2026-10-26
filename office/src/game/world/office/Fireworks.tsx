import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { AdditiveBlending, Color, DynamicDrawUsage, type BufferGeometry, type Points } from "three";
import { audio } from "@/game/audio/audio";
import { selectReducedMotion, useGame } from "@/game/store/game-store";

/**
 * The rooftop fireworks (phase O9 › Rooftop): a short show of bursts over the city, one `Points`
 * object drawn with additive blending (so fading a particle is just darkening its colour). With
 * reduced motion nothing flies: each burst appears where it would have bloomed and fades in and
 * out, like confetti hung in the air. Starts when `launch` changes to a new number; a show in
 * progress ignores a second request.
 */
const SLOTS = 6;
const PER_BURST = 90;
const TOTAL = SLOTS * PER_BURST;
const BURSTS = 9;
const GAP_S = 0.75;
const LIFE_S = 2.3;
const GRAVITY = 5.5;
const PALETTE = ["#ffd9a0", "#9fd8c3", "#f6e5a4", "#ff9f87", "#b9c4ff", "#ffffff"].map((hex) => new Color(hex));

// Shared by the one show on the rooftop: filled in place each frame, never reallocated.
const POSITIONS = new Float32Array(TOTAL * 3);
const COLORS = new Float32Array(TOTAL * 3);

type Burst = { origin: [number, number, number]; born: number; color: Color; directions: Float32Array; speed: number };

const random = (min: number, max: number) => min + Math.random() * (max - min);

/** A burst over the skyline: on a wide ring round the deck, high enough to clear the parapet. */
function newBurst(born: number): Burst {
  const angle = random(0, Math.PI * 2);
  const distance = random(24, 42);
  const directions = new Float32Array(PER_BURST * 3);
  for (let i = 0; i < PER_BURST; i++) {
    // Uniform on a sphere.
    const z = random(-1, 1);
    const a = random(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    directions.set([r * Math.cos(a), z, r * Math.sin(a)], i * 3);
  }
  return {
    origin: [Math.cos(angle) * distance, random(14, 28), Math.sin(angle) * distance],
    born,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    directions,
    speed: random(7, 11),
  };
}

export function Fireworks({ launch }: { launch: number }) {
  const reduced = useGame(selectReducedMotion);
  const points = useRef<Points>(null);
  const geometry = useRef<BufferGeometry>(null);
  const show = useRef({ active: false, t: 0, fired: 0, slots: [] as (Burst | null)[], last: 0 });
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  });

  useEffect(() => {
    if (launch <= 0 || show.current.active) return;
    show.current = { active: true, t: 0, fired: 0, slots: Array(SLOTS).fill(null), last: 0 };
    if (points.current) points.current.visible = true;
  }, [launch]);

  useFrame((_, rawDelta) => {
    const s = show.current;
    if (!s.active) return;
    s.t += Math.min(rawDelta, 0.1);

    // Fire the next burst when its time comes.
    while (s.fired < BURSTS && s.t >= s.fired * GAP_S) {
      s.slots[s.fired % SLOTS] = newBurst(s.fired * GAP_S);
      s.last = s.fired * GAP_S;
      s.fired += 1;
      if (!reducedRef.current) audio.play("success", { volume: 0.22, rate: random(0.55, 0.85) });
    }

    const frozen = reducedRef.current;
    let live = false;
    for (let slot = 0; slot < SLOTS; slot++) {
      const burst = s.slots[slot];
      const age = burst ? s.t - burst.born : -1;
      const showing = burst !== null && age >= 0 && age <= LIFE_S;
      if (showing) live = true;
      // Reduced motion hangs the burst where it blooms (a fixed moment) and only fades it.
      const flown = frozen ? LIFE_S * 0.45 : age;
      const brightness = !showing ? 0 : frozen ? Math.sin((Math.PI * age) / LIFE_S) : Math.pow(1 - age / LIFE_S, 1.4) * Math.min(1, age * 12 + 0.3);
      for (let i = 0; i < PER_BURST; i++) {
        const at = (slot * PER_BURST + i) * 3;
        if (!burst || !showing) {
          COLORS[at] = COLORS[at + 1] = COLORS[at + 2] = 0;
          continue;
        }
        POSITIONS[at] = burst.origin[0] + burst.directions[i * 3] * burst.speed * flown;
        POSITIONS[at + 1] = burst.origin[1] + burst.directions[i * 3 + 1] * burst.speed * flown - 0.5 * GRAVITY * flown * flown * (frozen ? 0.3 : 1);
        POSITIONS[at + 2] = burst.origin[2] + burst.directions[i * 3 + 2] * burst.speed * flown;
        COLORS[at] = burst.color.r * brightness;
        COLORS[at + 1] = burst.color.g * brightness;
        COLORS[at + 2] = burst.color.b * brightness;
      }
    }
    const attributes = geometry.current?.attributes;
    if (attributes) {
      attributes.position.needsUpdate = true;
      attributes.color.needsUpdate = true;
    }
    if (!live && s.fired >= BURSTS) {
      s.active = false;
      if (points.current) points.current.visible = false;
    }
  });

  return (
    <points ref={points} visible={false} frustumCulled={false} renderOrder={3}>
      <bufferGeometry ref={geometry}>
        <bufferAttribute attach="attributes-position" args={[POSITIONS, 3]} usage={DynamicDrawUsage} />
        <bufferAttribute attach="attributes-color" args={[COLORS, 3]} usage={DynamicDrawUsage} />
      </bufferGeometry>
      <pointsMaterial size={reduced ? 0.9 : 0.6} sizeAttenuation vertexColors transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} fog={false} />
    </points>
  );
}
