"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { PipetteIcon, ShuffleIcon } from "lucide-react";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ACESFilmicToneMapping, type Group } from "three";
import { savePlayer } from "@/app/(game)/actions";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { audio } from "@/game/audio/audio";
import { Avatar } from "@/game/player/Avatar";
import {
  AVATAR_PRESETS,
  AVATAR_SLOTS,
  type AvatarColors,
  type AvatarSlot,
  resolveAvatar,
} from "@/game/player/avatar-style";
import { emit } from "@/game/quests/bus";
import { selectReducedMotion, useGame } from "@/game/store/game-store";
import { cn } from "@/lib/utils";

/**
 * The avatar editor: a live preview beside a colour picker per slot. It opens on first entry
 * and, from O5, at the Reception badge booth. Saving writes `players.avatar`.
 */
export function AvatarEditor() {
  const modal = useGame((s) => (s.modal?.type === "avatar" ? s.modal : null));
  return (
    <Dialog open={modal !== null} onOpenChange={(next) => !next && useGame.getState().closeModal()}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        {modal && <EditorBody first={modal.first ?? false} />}
      </DialogContent>
    </Dialog>
  );
}

function EditorBody({ first }: { first: boolean }) {
  const saved = useGame((s) => s.player.avatar);
  const [draft, setDraft] = useState<AvatarColors>(saved);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function pick(slot: AvatarSlot, hex: string) {
    setDraft((current) => ({ ...current, [slot]: hex.toLowerCase() }));
  }

  function shuffle() {
    const random = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
    setDraft(
      Object.fromEntries(AVATAR_SLOTS.map(({ slot }) => [slot, random(AVATAR_PRESETS[slot]).hex])) as AvatarColors,
    );
  }

  function save() {
    setError(null);
    startSaving(async () => {
      const result = await savePlayer({ avatar: draft }).catch(() => null);
      if (!result?.ok) {
        setError("Your look couldn't be saved. Check your connection and try again.");
        return;
      }
      const { setAvatar, closeModal } = useGame.getState();
      setAvatar(resolveAvatar(result.player.avatar));
      emit({ type: "avatar_saved" });
      audio.play("success", { volume: 0.6 });
      toast.success("Look saved");
      closeModal();
    });
  }

  return (
    <div className="grid sm:grid-cols-[15rem_minmax(0,1fr)]">
      <Preview colors={draft} />
      <div className="flex min-w-0 flex-col gap-5 p-5">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{first ? "Choose your look" : "Your look"}</DialogTitle>
          <DialogDescription>
            {first
              ? "Pick colours before you walk in. You can change them later at the Reception badge booth."
              : "Changes show on your avatar once you save."}
          </DialogDescription>
        </DialogHeader>
        {error && <FormAlert message={error} />}
        <div className="flex flex-col gap-4">
          {AVATAR_SLOTS.map(({ slot, label }) => (
            <SwatchGroup key={slot} slot={slot} label={label} value={draft[slot]} onPick={(hex) => pick(slot, hex)} />
          ))}
        </div>
        <DialogFooter className="-mx-5 mt-1 -mb-5 items-stretch sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={shuffle} disabled={saving}>
            <ShuffleIcon data-icon="inline-start" />
            Shuffle
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => useGame.getState().closeModal()} disabled={saving}>
              {first ? "Not now" : "Cancel"}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Spinner data-icon="inline-start" />}
              {saving ? "Saving…" : "Save look"}
            </Button>
          </div>
        </DialogFooter>
      </div>
    </div>
  );
}

function SwatchGroup({
  slot,
  label,
  value,
  onPick,
}: {
  slot: AvatarSlot;
  label: string;
  value: string;
  onPick: (hex: string) => void;
}) {
  const name = useId();
  const presets = AVATAR_PRESETS[slot];
  const custom = !presets.some((preset) => preset.hex === value);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Swatch key={preset.hex} name={name} checked={value === preset.hex} colour={preset.hex} onChange={() => onPick(preset.hex)}>
            {preset.name}
          </Swatch>
        ))}
        <label className="relative" title={`Custom ${label.toLowerCase()} colour`}>
          <input
            type="color"
            value={value}
            onChange={(event) => onPick(event.target.value)}
            className="peer absolute inset-0 size-full cursor-pointer opacity-0"
          />
          <span
            aria-hidden
            className={cn(
              "flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/15 ring-offset-2 ring-offset-background peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
              custom && "ring-2 ring-primary",
            )}
            style={custom ? { background: value } : undefined}
          >
            {!custom && <PipetteIcon className="size-3.5" />}
          </span>
          <span className="sr-only">Custom {label.toLowerCase()} colour</span>
        </label>
      </div>
    </fieldset>
  );
}

function Swatch({
  name,
  checked,
  colour,
  onChange,
  children,
}: {
  name: string;
  checked: boolean;
  colour: string;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="relative cursor-pointer" title={String(children)}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden
        className="block size-7 rounded-full ring-1 ring-foreground/15 ring-offset-2 ring-offset-background transition-shadow duration-150 peer-checked:ring-2 peer-checked:ring-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
        style={{ background: colour }}
      />
      <span className="sr-only">{children}</span>
    </label>
  );
}

/** The preview's turn angle and drag (one editor is open at a time). */
const turntable = { yaw: 0.5, dragX: null as number | null };

/** The live preview: the avatar on a turntable (still when motion is reduced; drag turns it). */
function Preview({ colors }: { colors: AvatarColors }) {
  const reduced = useGame(selectReducedMotion);

  return (
    <div
      className="relative h-44 cursor-grab touch-none bg-muted active:cursor-grabbing sm:h-auto sm:min-h-[26rem]"
      onPointerDown={(event) => {
        turntable.dragX = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (turntable.dragX === null) return;
        turntable.yaw += (event.clientX - turntable.dragX) * 0.012;
        turntable.dragX = event.clientX;
      }}
      onPointerUp={() => {
        turntable.dragX = null;
      }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 28, position: [0, 1.05, 4.4] }}
        gl={{ antialias: true }}
        onCreated={({ gl, camera }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          camera.lookAt(0, 0.88, 0);
        }}
        aria-label="Avatar preview"
        role="img"
      >
        <hemisphereLight args={["#f4f1ea", "#55625b", 1.8]} />
        <directionalLight position={[2.5, 4, 3]} intensity={2.2} />
        <Turntable spin={!reduced}>
          <Avatar colors={colors} castShadow={false} />
        </Turntable>
        <mesh rotation-x={-Math.PI / 2} position-y={-0.001}>
          <circleGeometry args={[0.55, 24]} />
          <meshStandardMaterial color="#c9d1cc" roughness={1} />
        </mesh>
      </Canvas>
      <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs text-muted-foreground">Drag to turn</p>
    </div>
  );
}

function Turntable({ spin, children }: { spin: boolean; children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame((_, delta) => {
    if (spin && turntable.dragX === null) turntable.yaw += delta * 0.35;
    if (group.current) group.current.rotation.y = turntable.yaw;
  });
  return <group ref={group}>{children}</group>;
}
