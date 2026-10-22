#!/usr/bin/env node
/**
 * Synthesizes the city ambience loops (phase O4 › 7) and encodes them with ffmpeg:
 *   public/assets/audio/ambience/{city-traffic,hub-wind}.{ogg,mp3}
 *   public/assets/audio/music/motif-<kit>.{ogg,mp3}
 * Everything is generated here from noise and simple additive voices, so the files are made
 * for this project (CC0, see public/assets/LICENSES.md). Deterministic: the same seed makes
 * the same audio. London's motif is the Westminster Quarters (1793, public domain).
 *
 *   node scripts/make-ambience.mjs            # needs ffmpeg on PATH (libvorbis + libmp3lame)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 22050;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "audio");

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A two-pole state-variable band-pass; `centre` may change per sample. */
function bandpass() {
  let low = 0;
  let band = 0;
  return (input, centre, q = 0.7) => {
    const f = 2 * Math.sin((Math.PI * Math.min(centre, RATE / 6)) / RATE);
    low += f * band;
    const high = input - low - q * band;
    band += f * high;
    return band;
  };
}

function lowpass(cutoff) {
  const a = Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  return (x) => (y = (1 - a) * x + a * y);
}

/**
 * A seamless loop of `seconds`: `bed(n)` is a continuous texture rendered with a crossfade
 * over its seam; `events` repeat every loop and are rendered three loops long so their tails
 * wrap round into the start.
 */
function loop(seconds, { bed, events = [], voice } = {}) {
  const n = Math.round(seconds * RATE);
  const fade = Math.round(1.5 * RATE);
  const out = new Float32Array(n);
  if (bed) {
    const raw = bed(n + fade);
    for (let i = 0; i < n; i++) {
      out[i] = i < fade ? raw[i] * (i / fade) + raw[n + i] * (1 - i / fade) : raw[i];
    }
  }
  if (events.length > 0) {
    const long = new Float32Array(n * 3);
    for (let copy = 0; copy < 3; copy++) {
      for (const event of events) voice(long, Math.round((event.t + copy * seconds) * RATE), event);
    }
    for (let i = 0; i < n; i++) out[i] += long[n + i];
  }
  return out;
}

/** A feedback echo over a whole (looping) buffer, wrapping round so the seam stays clean. */
function echo(buffer, seconds, feedback, mix) {
  const delay = Math.round(seconds * RATE);
  const wet = new Float32Array(buffer.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < buffer.length; i++) {
      const j = (i - delay + buffer.length) % buffer.length;
      wet[i] = buffer[j] * mix + wet[j] * feedback;
    }
  }
  return buffer.map((sample, i) => sample + wet[i]);
}

function normalize(buffer, peak = 0.7) {
  let max = 0;
  for (const sample of buffer) max = Math.max(max, Math.abs(sample));
  return max > 0 ? buffer.map((sample) => (sample / max) * peak) : buffer;
}

// ---------------------------------------------------------------------------------------------
// Beds

function trafficBed(seed) {
  return (n) => {
    const random = mulberry32(seed);
    const out = new Float32Array(n);
    const rumble = lowpass(180);
    const hum = bandpass();
    let brown = 0;
    for (let i = 0; i < n; i++) {
      const white = random() * 2 - 1;
      brown = (brown + white * 0.02) * 0.995;
      const t = i / RATE;
      const swell = 0.75 + 0.25 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1);
      out[i] = rumble(brown) * 5 * swell + hum(white, 420, 1.2) * 0.05;
    }
    return out;
  };
}

/** A car going by: band-limited noise, its pitch and loudness rising and falling. */
function carVoice(seed) {
  const random = mulberry32(seed);
  return (buffer, start, { length, level, pitch }) => {
    const n = Math.round(length * RATE);
    const filter = bandpass();
    const smooth = lowpass(2200);
    for (let i = 0; i < n && start + i < buffer.length; i++) {
      const x = i / n;
      const envelope = Math.exp(-((x - 0.5) ** 2) / 0.035);
      const centre = pitch * (0.75 + 0.5 * envelope) * (x < 0.5 ? 1.08 : 0.92);
      buffer[start + i] += smooth(filter(random() * 2 - 1, centre, 0.5)) * envelope * level;
    }
  };
}

function trafficEvents(seconds, seed) {
  const random = mulberry32(seed);
  const events = [];
  for (let t = 0.6; t < seconds - 0.5; t += 1.6 + random() * 2.6) {
    events.push({ t, length: 2.2 + random() * 1.8, level: 0.25 + random() * 0.35, pitch: 380 + random() * 380 });
  }
  return events;
}

function windBed(seed) {
  return (n) => {
    const random = mulberry32(seed);
    const out = new Float32Array(n);
    const gust = bandpass();
    const whistle = bandpass();
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const white = random() * 2 - 1;
      const sweep = 420 + 260 * Math.sin(t * 0.21) + 120 * Math.sin(t * 0.53 + 2);
      const level = 0.55 + 0.45 * Math.sin(t * 0.17 + 0.5) ** 2;
      out[i] = gust(white, sweep, 0.9) * level * 0.9 + whistle(white, 1600 + 300 * Math.sin(t * 0.3), 0.08) * 0.04;
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Voices for the motifs

const TIMBRES = {
  // Partials as [ratio, level, decay seconds].
  bell: [
    [1, 1, 2.6],
    [2.0, 0.45, 1.6],
    [2.76, 0.28, 1.1],
    [5.4, 0.12, 0.6],
  ],
  chime: [
    [1, 1, 4.5],
    [2.01, 0.5, 3],
    [3.0, 0.3, 2],
    [4.2, 0.2, 1.4],
    [5.43, 0.1, 0.9],
  ],
  pluck: [
    [1, 1, 0.9],
    [2, 0.5, 0.6],
    [3, 0.3, 0.4],
    [4, 0.15, 0.3],
  ],
  reed: [
    [1, 1, 1.4],
    [3, 0.33, 1.2],
    [5, 0.2, 1.0],
    [7, 0.12, 0.8],
  ],
  pad: [
    [1, 1, 6],
    [2, 0.35, 5],
    [3, 0.12, 4],
  ],
};

const midi = (note) => 440 * 2 ** ((note - 69) / 12);

function noteVoice(buffer, start, { note, level = 0.5, timbre = "bell", length = 3, attack = 0.005, vibrato = 0 }) {
  const partials = TIMBRES[timbre];
  const frequency = midi(note);
  const n = Math.round(length * RATE);
  for (let i = 0; i < n && start + i < buffer.length; i++) {
    if (start + i < 0) continue;
    const t = i / RATE;
    const rise = Math.min(1, t / attack);
    const wobble = vibrato ? 1 + vibrato * Math.sin(2 * Math.PI * 5.5 * t) : 1;
    let sample = 0;
    for (const [ratio, amp, decay] of partials) {
      sample += Math.sin(2 * Math.PI * frequency * ratio * wobble * t) * amp * Math.exp(-t / decay);
    }
    buffer[start + i] += sample * rise * level;
  }
}

/** Notes on a beat grid: `[beat, midi note, beats long?]`. */
function phrase(bpm, notes, options) {
  const beat = 60 / bpm;
  return notes.map(([at, note, beats = 2]) => ({ t: at * beat, note, length: beats * beat + 2, ...options }));
}

const N = { C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81 };

// Each kit's motif: original phrases in a scale that nods to the place (London excepted).
const MOTIFS = {
  // San Francisco: bright D major pentatonic, plucked, unhurried.
  "golden-gate": {
    seconds: 16,
    events: phrase(
      90,
      [
        [0, N.D4],
        [1, N.F4 + 1],
        [2, N.A4],
        [3.5, N.B4],
        [4, N.A4, 3],
        [8, N.E4],
        [9, N.F4 + 1],
        [10, N.D5],
        [11.5, N.B4],
        [12, N.A4, 3],
        [16, N.D3, 6],
      ],
      { timbre: "pluck", level: 0.42 },
    ),
    echo: [0.33, 0.35, 0.3],
  },
  // Lahore: a drone on C and G under a slow line in a Bhairav-like scale (C, D♭, E, F, G, A♭, B).
  minar: {
    seconds: 20,
    events: [
      ...[0, 5, 10, 15].flatMap((t) => [
        { t, note: N.C3, length: 6, timbre: "pad", level: 0.22, attack: 1.2 },
        { t: t + 0.4, note: N.G3, length: 6, timbre: "pad", level: 0.16, attack: 1.2 },
      ]),
      ...phrase(
        66,
        [
          [0, N.C4],
          [1, N.D4 - 1],
          [2, N.E4, 3],
          [5, N.F4],
          [6, N.G4, 3],
          [9, N.A4 - 1],
          [10, N.G4],
          [11, N.F4],
          [12, N.E4, 3],
          [15, N.D4 - 1],
          [16, N.C4, 4],
        ],
        { timbre: "pluck", level: 0.4, vibrato: 0.004 },
      ),
    ],
    echo: [0.42, 0.3, 0.25],
  },
  // Berlin: cool D minor bells in even steps.
  brandenburg: {
    seconds: 16,
    events: phrase(
      96,
      [
        [0, N.D4],
        [1, N.A4],
        [2, N.F4],
        [3, N.A4],
        [4, N.E4],
        [5, N.A4],
        [6, N.G4],
        [7, N.F4],
        [8, N.D4],
        [9, N.A4],
        [10, N.F4],
        [11, N.C5],
        [12, N.A4, 4],
        [16, N.D3, 6],
      ],
      { timbre: "bell", level: 0.36 },
    ),
    echo: [0.31, 0.32, 0.25],
  },
  // Paris: a little musette waltz in F on a reedy voice.
  eiffel: {
    seconds: 18,
    events: [
      ...phrase(
        120,
        [
          [0, N.F3, 1],
          [1, N.A3, 1],
          [2, N.C4, 1],
          [3, N.C3, 1],
          [4, N.G3, 1],
          [5, N.B3 - 1, 1],
          [6, N.F3, 1],
          [7, N.A3, 1],
          [8, N.C4, 1],
          [9, N.C3, 1],
          [10, N.E3, 1],
          [11, N.G3, 1],
        ].flatMap(([at, note, beats]) => [[at, note, beats], [at + 12, note, beats], [at + 24, note, beats]]),
        { timbre: "reed", level: 0.14, vibrato: 0.003 },
      ),
      ...phrase(
        120,
        [
          [0, N.A4, 2],
          [2, N.C5],
          [3, N.B4 - 1, 2],
          [5, N.A4],
          [6, N.G4, 3],
          [9, N.E4, 3],
          [12, N.F4, 2],
          [14, N.A4],
          [15, N.G4, 2],
          [17, N.F4],
          [18, N.E4, 2],
          [20, N.G4],
          [21, N.F4, 3],
        ],
        { timbre: "reed", level: 0.3, vibrato: 0.005 },
      ),
    ],
    echo: [0.25, 0.2, 0.2],
  },
  // Sydney: airy F lydian bells, slow.
  "opera-house": {
    seconds: 18,
    events: phrase(
      72,
      [
        [0, N.F4, 3],
        [3, N.C5],
        [4, N.B4, 2],
        [6, N.A4, 3],
        [9, N.G4],
        [10, N.B4, 2],
        [12, N.C5, 4],
        [16, N.F3, 6],
      ],
      { timbre: "chime", level: 0.32 },
    ),
    echo: [0.45, 0.4, 0.3],
  },
  // London: the Westminster Quarters on low bells (public domain, 1793), the hour's four changes.
  "elizabeth-tower": {
    seconds: 24,
    events: phrase(
      70,
      [
        // E G# F# B · E F# G# E · G# E F# B · B F# G# E (E major, bells an octave down)
        ...[
          [N.E4, N.G4 + 1, N.F4 + 1, N.B3],
          [N.E4, N.F4 + 1, N.G4 + 1, N.E4],
          [N.G4 + 1, N.E4, N.F4 + 1, N.B3],
          [N.B3, N.F4 + 1, N.G4 + 1, N.E4],
        ].flatMap((change, k) => change.map((note, i) => [k * 6 + i, note - 12, i === 3 ? 3 : 1])),
      ],
      { timbre: "chime", level: 0.4 },
    ),
    echo: [0.5, 0.3, 0.25],
  },
  // Anywhere else: a G major pentatonic bell line.
  generic: {
    seconds: 16,
    events: phrase(
      84,
      [
        [0, N.G4],
        [1, N.B4],
        [2, N.D5, 2],
        [4, N.E5],
        [5, N.D5],
        [6, N.B4, 2],
        [8, N.A4],
        [9, N.G4],
        [10, N.E4, 2],
        [12, N.G4, 3],
        [16, N.G3, 5],
      ],
      { timbre: "bell", level: 0.34 },
    ),
    echo: [0.36, 0.33, 0.25],
  },
  // The Global Hub: slow pad chords, Cmaj7 – Am7 – Fmaj7 – G6.
  "global-hub": {
    seconds: 24,
    events: [
      [N.C3, N.E4, N.G4, N.B4],
      [N.A3, N.C4, N.E4, N.G4],
      [N.F3, N.A4, N.C5, N.E5],
      [N.G3, N.B4, N.D5, N.E5],
    ].flatMap((chord, k) => chord.map((note) => ({ t: k * 6, note, length: 8, timbre: "pad", level: 0.16, attack: 1.5 }))),
    echo: [0.6, 0.3, 0.2],
  },
};

// ---------------------------------------------------------------------------------------------

function writeWav(file, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

function encode(name, samples) {
  const out = path.join(ROOT, name);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const wav = path.join(os.tmpdir(), `documind-office-${path.basename(name)}.wav`);
  writeWav(wav, samples);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "2", `${out}.ogg`]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", wav, "-c:a", "libmp3lame", "-q:a", "7", `${out}.mp3`]);
  fs.rmSync(wav);
  const size = (file) => `${Math.round(fs.statSync(file).size / 1024)} KB`;
  console.log(`${name}: ogg ${size(`${out}.ogg`)}, mp3 ${size(`${out}.mp3`)}`);
}

encode(
  "ambience/city-traffic",
  normalize(loop(24, { bed: trafficBed(11), events: trafficEvents(24, 12), voice: carVoice(13) }), 0.6),
);
encode("ambience/hub-wind", normalize(loop(24, { bed: windBed(21) }), 0.5));
for (const [kit, motif] of Object.entries(MOTIFS)) {
  const dry = loop(motif.seconds, { events: motif.events, voice: noteVoice });
  const [seconds, feedback, mix] = motif.echo;
  const smooth = lowpass(5200);
  encode(`music/motif-${kit}`, normalize(echo(dry, seconds, feedback, mix).map((sample) => smooth(sample)), 0.6));
}
