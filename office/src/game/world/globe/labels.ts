import { type Camera, type Object3D, Vector3 } from "three";
import { placeLabels } from "./geo";

/**
 * The pin labels are DOM (readable text, the theme's tokens) laid over the canvas. Their
 * elements register here; the rig positions them once per rendered frame, after it has turned the
 * globe, by writing transforms and opacity straight to the elements (no React state per frame).
 */
export const labelElements = new Map<string, HTMLElement>();

export type LabelPin = { id: string; local: [number, number, number]; hq: boolean };

const world = new Vector3();
const toCamera = new Vector3();
const projected = new Vector3();

/** Below this dot product between the pin's normal and the view ray, the pin is round the back. */
const SHOW_FROM = 0.18;
const FULL_AT = 0.4;

export function layoutLabels(
  camera: Camera,
  size: { width: number; height: number },
  earth: Object3D,
  pins: LabelPin[],
  focus: { hovered: string | null; selected: string | null },
) {
  earth.updateWorldMatrix(true, false);
  const visible: {
    id: string;
    element: HTMLElement;
    anchor: { x: number; y: number };
    opacity: number;
    rank: number;
    keep: boolean;
  }[] = [];

  for (const pin of pins) {
    const element = labelElements.get(pin.id);
    if (!element) continue;
    world.set(...pin.local).applyMatrix4(earth.matrixWorld);
    const facing = toCamera.copy(camera.position).sub(world).normalize().dot(projected.copy(world).normalize());
    const hidden = facing < SHOW_FROM || (focus.selected !== null && focus.selected !== pin.id);
    if (hidden) {
      element.style.opacity = "0";
      element.style.visibility = "hidden";
      continue;
    }
    projected.copy(world).project(camera);
    visible.push({
      id: pin.id,
      element,
      anchor: { x: ((projected.x + 1) / 2) * size.width, y: ((1 - projected.y) / 2) * size.height },
      opacity: Math.min(1, (facing - SHOW_FROM) / (FULL_AT - SHOW_FROM)),
      // The hovered (or chosen) pin's label is placed first and always shown, then HQ, then the
      // most front-facing.
      rank: (pin.id === focus.hovered || pin.id === focus.selected ? 2 : 0) + (pin.hq ? 1 : 0) + facing,
      keep: pin.id === focus.hovered || pin.id === focus.selected,
    });
  }

  visible.sort((a, b) => b.rank - a.rank);
  // Read every size before writing any transform, so the browser lays out once.
  const items = visible.map((label) => ({
    anchor: label.anchor,
    width: label.element.offsetWidth,
    height: label.element.offsetHeight,
    keep: label.keep,
  }));
  const spots = placeLabels(items, size);
  visible.forEach((label, index) => {
    const { x, y, hidden } = spots[index];
    const style = label.element.style;
    if (hidden) {
      style.opacity = "0";
      style.visibility = "hidden";
      return;
    }
    style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    style.opacity = String(label.opacity);
    style.visibility = "visible";
    style.zIndex = String(visible.length - index);
  });
}
