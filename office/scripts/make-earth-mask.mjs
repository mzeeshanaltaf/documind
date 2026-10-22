// Rasterizes Natural Earth's land polygons (public domain) into the globe's land/sea mask:
// a 1024×512 equirectangular greyscale PNG, 255 = land. The globe (src/game/world/globe/) samples
// it per triangle, so the exact coastline barely matters; 110m is plenty.
//
//   curl -L -o ne_110m_land.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson
//   node scripts/make-earth-mask.mjs ne_110m_land.geojson [public/assets/textures/earth-mask.png]
//
// Plain Node, no dependencies: an even-odd scanline fill, then a hand-written PNG (zlib + CRC).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const WIDTH = 1024;
const HEIGHT = 512;

const [input, output = "public/assets/textures/earth-mask.png"] = process.argv.slice(2);
if (!input) {
  console.error("Usage: node scripts/make-earth-mask.mjs <ne_110m_land.geojson> [out.png]");
  process.exit(1);
}

const geojson = JSON.parse(fs.readFileSync(input, "utf8"));

/** Every ring of every polygon, in pixel coordinates. */
const rings = [];
for (const feature of geojson.features) {
  const { type, coordinates } = feature.geometry;
  const polygons = type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      rings.push(ring.map(([lon, lat]) => [((lon + 180) / 360) * WIDTH, ((90 - lat) / 180) * HEIGHT]));
    }
  }
}

// Even-odd fill at each pixel row's centre: holes (lakes in the polygons) stay sea.
const pixels = Buffer.alloc(WIDTH * HEIGHT);
for (let row = 0; row < HEIGHT; row++) {
  const y = row + 0.5;
  const crossings = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      if (y1 <= y !== y2 <= y) crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
  }
  crossings.sort((a, b) => a - b);
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
    const to = Math.min(WIDTH - 1, Math.floor(crossings[k + 1] - 0.5));
    pixels.fill(255, row * WIDTH + from, row * WIDTH + to + 1);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 0; // greyscale
// Each scanline starts with filter type 0 (none).
const raw = Buffer.alloc((WIDTH + 1) * HEIGHT);
for (let row = 0; row < HEIGHT; row++) pixels.copy(raw, row * (WIDTH + 1) + 1, row * WIDTH, (row + 1) * WIDTH);

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, png);

const land = pixels.reduce((sum, value) => sum + (value ? 1 : 0), 0) / pixels.length;
console.log(`Wrote ${output}: ${WIDTH}×${HEIGHT}, ${png.length} bytes, ${(land * 100).toFixed(1)}% land pixels.`);
