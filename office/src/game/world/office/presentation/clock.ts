/**
 * How long the current slide has been up, for the HUD's countdown. The Director writes it every
 * frame; the presentation bar polls it a few times a second (no per-frame React state).
 */
export const slideClock = { elapsed: 0, total: 0 };
