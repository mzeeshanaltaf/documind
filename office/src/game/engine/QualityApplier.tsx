import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Material, Mesh } from "three";
import { selectTier, useGame } from "@/game/store/game-store";
import { TIERS } from "./quality";

/**
 * Applies the parts of a tier change that props can't: materials compiled with (or without)
 * shadow code must recompile when shadows are switched. DPR and the shadow map's on/off are
 * Canvas props; lights size their own maps (SunLight).
 */
export function QualityApplier() {
  const scene = useThree((state) => state.scene);
  const { shadows } = TIERS[useGame(selectTier)];
  const previous = useRef(shadows);

  useEffect(() => {
    if (previous.current === shadows) return;
    previous.current = shadows;
    scene.traverse((object) => {
      const material = (object as Mesh).material as Material | Material[] | undefined;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) m.needsUpdate = true;
    });
  }, [scene, shadows]);

  return null;
}
