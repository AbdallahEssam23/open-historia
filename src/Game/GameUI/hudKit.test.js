// Run: node --test src/Game/GameUI/hudKit.test.js
//
// The shared outer-shell finish (hudKit.js). Every value here is pinned because
// the module replaced six near-duplicate literals across the shell: this test is
// what stops the source of truth drifting back apart, and it fails the moment a
// factory stops returning exactly the style the shell used to hard-code.
import test from "node:test";
import assert from "node:assert/strict";

import {
  HUD_ACTION,
  HUD_BASE,
  HUD_CARD,
  HUD_ICON_BUTTON,
  HUD_RADIUS,
  HUD_SURFACE,
  hudActionButton,
  hudDockStyle,
  hudTabButton,
  hudTouchFit,
  mergeStyles,
} from "./hudKit.js";

test("the glass surface reads the palette tokens, not its own colours", () => {
  assert.equal(
    HUD_SURFACE.background,
    "linear-gradient(180deg, rgba(50, 50, 55, 0.58) 0%, rgba(17, 17, 19, 0.48) 100%)",
  );
  assert.equal(HUD_SURFACE.border, "1px solid var(--oh-hud-border)");
  assert.equal(HUD_SURFACE.boxShadow, "var(--oh-hud-shadow-soft)");
  assert.equal(HUD_SURFACE.backdropFilter, "var(--oh-hud-blur)");
  assert.equal(HUD_SURFACE.WebkitBackdropFilter, "var(--oh-hud-blur)");
});

test("the fixed base is the glass panel settings.jsx used", () => {
  assert.equal(HUD_BASE.position, "fixed");
  assert.equal(HUD_BASE.backgroundColor, "var(--oh-hud-bg)");
  assert.equal(HUD_BASE.backdropFilter, "var(--oh-hud-blur)");
  assert.equal(HUD_BASE.borderRadius, "14px");
  assert.equal(HUD_BASE.boxShadow, "var(--oh-hud-shadow-soft)");
  assert.equal(HUD_BASE.zIndex, 9999);
});

test("the action pill and the icon button match their old literals", () => {
  assert.equal(HUD_ACTION.borderRadius, HUD_RADIUS.pill);
  assert.equal(HUD_ACTION.minHeight, "2.1rem");
  assert.equal(HUD_ACTION.display, "inline-flex");
  assert.equal(HUD_ACTION.fontWeight, 600);

  assert.equal(HUD_ICON_BUTTON.background, "none");
  assert.equal(HUD_ICON_BUTTON.border, "none");
  assert.equal(HUD_ICON_BUTTON.borderRadius, "6px");
  assert.equal(HUD_ICON_BUTTON.height, "2rem");
  assert.equal(HUD_ICON_BUTTON.width, "2rem");
});

test("the stats card matches its old literal", () => {
  assert.equal(HUD_CARD.backgroundColor, "rgba(255,255,255,0.05)");
  assert.equal(HUD_CARD.border, "1px solid rgba(255,255,255,0.08)");
  assert.equal(HUD_CARD.borderRadius, HUD_RADIUS.card);
  assert.equal(HUD_CARD.padding, "0.6rem 0.7rem");
});

test("the dock keeps its geometry from the caller and its finish from the kit", () => {
  const dock = hudDockStyle(0.75);
  assert.equal(dock.gap, "0.75rem");
  assert.equal(dock.backgroundColor, "var(--oh-hud-bg)");
  assert.equal(dock.backdropFilter, "var(--oh-hud-blur)");
  assert.equal(dock.borderRadius, HUD_RADIUS.dock);
  assert.equal(dock.display, "flex");
});

test("a tab reflects selection and drops its inline floor for a finger", () => {
  const selected = hudTabButton(true, false);
  assert.equal(selected.backgroundColor, "rgba(0,0,0,0.42)");
  assert.equal(selected.color, "#f4f4f5");
  assert.equal(selected.minHeight, "2.45rem");
  assert.equal(selected.flex, 1);

  const unselected = hudTabButton(false, false);
  assert.equal(unselected.backgroundColor, "rgba(255,255,255,0.03)");
  assert.equal(unselected.color, "rgba(255,255,255,0.58)");
  assert.equal(unselected.border, "1px solid rgba(255,255,255,0.09)");

  // The inline minHeight would beat .oh-tap-row, so a touch tab leaves it out
  // unless the caller asked for a fixed floor.
  assert.equal(hudTabButton(false, true).minHeight, "2.75rem");
});

test("touchFit drops the inline floor only where a finger is the pointer", () => {
  const style = { minHeight: "2.1rem", padding: "0 0.95rem" };
  assert.equal(hudTouchFit(style, false), style);
  assert.equal(hudTouchFit(style, false, { icon: true }), style);

  const touch = hudTouchFit(style, true);
  assert.equal(touch.minHeight, undefined);
  assert.equal(touch.padding, "0 0.95rem");

  const icon = hudTouchFit({ ...style, minWidth: "2rem" }, true, { icon: true });
  assert.equal(icon.minHeight, undefined);
  assert.equal(icon.minWidth, undefined);
});

test("hudActionButton composes the pill, its patch and the touch rule", () => {
  const plain = hudActionButton({});
  assert.deepEqual(plain, HUD_ACTION);

  const patched = hudActionButton({ patch: { fontSize: "0.68rem" } });
  assert.equal(patched.fontSize, "0.68rem");
  assert.equal(patched.borderRadius, HUD_RADIUS.pill);
  assert.equal(patched.minHeight, "2.1rem");

  const touch = hudActionButton({ touch: true });
  assert.equal(touch.minHeight, undefined);
});

test("mergeStyles applies later objects over earlier ones", () => {
  const merged = mergeStyles({ a: 1, b: 2 }, null, undefined, { b: 3 });
  assert.deepEqual(merged, { a: 1, b: 3 });
});
