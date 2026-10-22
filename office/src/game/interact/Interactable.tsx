import type { ThreeElements } from "@react-three/fiber";
import { type ReactNode, useEffect, useRef } from "react";
import type { Group } from "three";
import { useGame } from "@/game/store/game-store";
import type { InteractKind } from "./select";

type InteractableProps = {
  id: string;
  kind: InteractKind;
  /** The prompt's verb phrase: "Talk to Hina", "Sit". */
  label: string;
  /** Reach in metres from the group's origin, on the floor plane. */
  radius?: number;
  onInteract: () => void;
  /** e.g. `card:HR`; while unmet, E shows the reason instead of acting. */
  requires?: string;
  lockedReason?: string;
  children?: ReactNode;
} & Pick<ThreeElements["group"], "position" | "rotation">;

/**
 * Something the player can use with E. It registers itself in the store; the interaction system
 * focuses the nearest one in range. The group's world position is read each tick, so moving
 * interactables (NPCs) work too.
 */
export function Interactable({
  id,
  kind,
  label,
  radius = 1.5,
  onInteract,
  requires,
  lockedReason,
  children,
  ...transform
}: InteractableProps) {
  const group = useRef<Group>(null);
  // The latest handler, without re-registering on every render.
  const handler = useRef(onInteract);
  useEffect(() => {
    handler.current = onInteract;
  });

  useEffect(() => {
    const object = group.current;
    if (!object) return;
    const { interactables } = useGame.getState();
    interactables.set(id, { id, kind, label, radius, requires, lockedReason, object, onInteract: () => handler.current() });
    return () => {
      interactables.delete(id);
      const { focus, setFocus } = useGame.getState();
      if (focus?.id === id) setFocus(null);
    };
  }, [id, kind, label, radius, requires, lockedReason]);

  return (
    <group ref={group} {...transform}>
      {children}
    </group>
  );
}
