import { afterEach, describe, expect, it } from "vitest";
import { isEditable, shouldIgnoreKeys } from "@/game/input/bindings";

// The editable-focus guard needs real elements, hence jsdom.
function make(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isEditable", () => {
  it("is true for text-taking fields", () => {
    expect(isEditable(make(`<input>`))).toBe(true);
    expect(isEditable(make(`<input type="search">`))).toBe(true);
    expect(isEditable(make(`<input type="email">`))).toBe(true);
    expect(isEditable(make(`<textarea></textarea>`))).toBe(true);
    expect(isEditable(make(`<select></select>`))).toBe(true);
    expect(isEditable(make(`<div contenteditable="true"></div>`))).toBe(true);
    expect(isEditable(make(`<div contenteditable=""></div>`))).toBe(true);
  });

  it("is false for buttons, toggles, sliders and plain elements", () => {
    expect(isEditable(make(`<button>Go</button>`))).toBe(false);
    expect(isEditable(make(`<input type="checkbox">`))).toBe(false);
    expect(isEditable(make(`<input type="range">`))).toBe(false);
    expect(isEditable(make(`<input type="color">`))).toBe(false);
    expect(isEditable(make(`<div contenteditable="false"></div>`))).toBe(false);
    expect(isEditable(make(`<canvas></canvas>`))).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});

describe("shouldIgnoreKeys", () => {
  it("ignores game keys while typing or while a dialog is open", () => {
    expect(shouldIgnoreKeys(make(`<input>`), false)).toBe(true);
    expect(shouldIgnoreKeys(make(`<button>Menu</button>`), true)).toBe(true);
    expect(shouldIgnoreKeys(document.body, false)).toBe(false);
    expect(shouldIgnoreKeys(make(`<button>Menu</button>`), false)).toBe(false);
  });
});
