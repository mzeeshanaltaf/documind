import type { EarthMask } from "./geo";

/** Natural Earth land mask (public/assets/LICENSES.md), 1024×512, white = land. */
const MASK_URL = "/assets/textures/earth-mask.png";

let pending: Promise<EarthMask> | null = null;

/**
 * Loads the mask once per page and keeps its red channel as bytes. Browser-only. A failed load
 * resolves to an all-sea mask, so the globe still renders (pins, labels and the list matter more
 * than the coastline).
 */
export function loadEarthMask(): Promise<EarthMask> {
  pending ??= new Promise<EarthMask>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return resolve(emptyMask());
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const data = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
      resolve({ width: canvas.width, height: canvas.height, data });
    };
    image.onerror = () => resolve(emptyMask());
    image.src = MASK_URL;
  });
  return pending;
}

function emptyMask(): EarthMask {
  return { width: 1, height: 1, data: new Uint8Array(1) };
}
