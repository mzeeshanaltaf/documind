/**
 * Seeded randomness for the city generator: a 32-bit FNV-1a string hash for the seed and the
 * mulberry32 PRNG, so the same location always builds the same city. Pure.
 */

export type Random = () => number;

/** FNV-1a, 32-bit, unsigned. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: a fast PRNG with a 32-bit state; returns floats in [0, 1). */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (random: Random, min: number, max: number) => min + random() * (max - min);

/** An integer in [min, max], both ends included. */
export const int = (random: Random, min: number, max: number) => Math.floor(range(random, min, max + 1));

export const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length)];
