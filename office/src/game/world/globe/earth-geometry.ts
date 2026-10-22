import { BufferAttribute, Color, IcosahedronGeometry } from "three";
import { type EarthMask, isLand, vectorToLatLon } from "./geo";

export type EarthColors = { land: string[]; sea: string[] };

/** Land sits this much above the sea, so coastlines read as low steps. */
const LAND_LIFT = 0.012;

/** A small deterministic hash, so each face keeps its shade between builds. */
function shade(index: number, count: number): number {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) % count;
}

/**
 * The low-poly Earth: an icosphere whose triangles are land or sea by the mask (the centroid
 * plus a majority of the corners), shaded from small palettes and flat-lit. Three's polyhedra are
 * non-indexed, so each face owns its vertices: land faces are pushed out without stretching sea.
 * The caller disposes the geometry.
 */
export function buildEarthGeometry(detail: number, mask: EarthMask, colors: EarthColors): IcosahedronGeometry {
  const geometry = new IcosahedronGeometry(1, detail);
  const position = geometry.getAttribute("position") as BufferAttribute;
  const color = new Float32Array(position.count * 3);
  const land = colors.land.map((hex) => new Color(hex));
  const sea = colors.sea.map((hex) => new Color(hex));
  const corner: [number, number, number] = [0, 0, 0];

  for (let face = 0; face < position.count; face += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let landCorners = 0;
    for (let k = 0; k < 3; k++) {
      corner[0] = position.getX(face + k);
      corner[1] = position.getY(face + k);
      corner[2] = position.getZ(face + k);
      cx += corner[0];
      cy += corner[1];
      cz += corner[2];
      const { lat, lon } = vectorToLatLon(corner);
      if (isLand(mask, lat, lon)) landCorners++;
    }
    const centre = vectorToLatLon([cx, cy, cz]);
    const onLand = isLand(mask, centre.lat, centre.lon) ? landCorners >= 1 : landCorners >= 3;
    const palette = onLand ? land : sea;
    const tint = palette[shade(face / 3, palette.length)];
    for (let k = 0; k < 3; k++) {
      const i = face + k;
      color[i * 3] = tint.r;
      color[i * 3 + 1] = tint.g;
      color[i * 3 + 2] = tint.b;
      if (onLand) {
        position.setXYZ(i, position.getX(i) * (1 + LAND_LIFT), position.getY(i) * (1 + LAND_LIFT), position.getZ(i) * (1 + LAND_LIFT));
      }
    }
  }

  geometry.setAttribute("color", new BufferAttribute(color, 3));
  geometry.computeVertexNormals();
  return geometry;
}
