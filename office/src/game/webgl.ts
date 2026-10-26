type Support = "unknown" | "yes" | "no";

let cached: Support = "unknown";

/** Whether this browser can create a WebGL context (probed once, then cached). Browser-only. */
function probe(): Support {
  if (cached !== "unknown") return cached;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    cached = gl ? "yes" : "no";
    // Hand the probe's context back at once: browsers cap how many may be live.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    cached = "no";
  }
  return cached;
}

/** `useSyncExternalStore` pieces: the server and the first client render both say "unknown". */
export const webglSupport = {
  subscribe: () => () => {},
  getSnapshot: probe,
  getServerSnapshot: (): Support => "unknown",
};
