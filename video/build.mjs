// Inlines the brand fonts (woff from web/assets/fonts) into src/explainer.html -> documind-explainer.html
import { readFileSync, writeFileSync } from "node:fs";

const fonts = [
  ["Instrument Sans", 400, "instrument-sans-latin-400-normal.woff"],
  ["Instrument Sans", 500, "instrument-sans-latin-500-normal.woff"],
  ["Source Serif 4", 600, "source-serif-4-latin-600-normal.woff"],
  ["Geist Mono", 400, "geist-mono-latin-400-normal.woff"],
];

const css = fonts
  .map(([family, weight, file]) => {
    const b64 = readFileSync(new URL(`../web/assets/fonts/${file}`, import.meta.url)).toString("base64");
    return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url(data:font/woff;base64,${b64}) format("woff");}`;
  })
  .join("\n");

const src = readFileSync(new URL("./src/explainer.html", import.meta.url), "utf8");
writeFileSync(new URL("./documind-explainer.html", import.meta.url), src.replace("/*__FONTS__*/", () => css));
console.log("built documind-explainer.html");
