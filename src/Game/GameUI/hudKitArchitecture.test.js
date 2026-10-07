/*! Open Historia — one finish for the outer shell © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/GameUI/hudKitArchitecture.test.js
//
// hudKit.js only simplifies the shell if the panels actually go through it. The
// change that undoes this is small and looks reasonable: pasting the glass
// gradient back into one more panel, or re-declaring a local pill object beside
// the kit's. These assertions are the tripwire for that drift.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(here, rel), "utf8");

// The panels the kit was carved out of. Each one now takes its shared finish
// from hudKit.js rather than keeping its own private copy.
const PANELS = ["libraryBar.jsx", "time.jsx", "stats.jsx", "settings.jsx", "chat.jsx"];

test("every migrated panel draws its shell finish from the kit", () => {
    for (const panel of PANELS) {
        assert.match(read(panel), /from "\.\/hudKit\.js"/, `${panel} does not import hudKit.js`);
    }
});

// The glass gradient is the one literal the old panels each typed out. It lives
// in hudKit.js now, and only there, so a re-paste into a panel fails here.
test("the glass gradient is defined once, in the kit", () => {
    const files = fs.readdirSync(here).filter((name) => /\.(jsx|js)$/.test(name) && !name.endsWith(".test.js"));
    const owners = files.filter((name) => /rgba\(50, 50, 55, 0\.58\)/.test(fs.readFileSync(path.join(here, name), "utf8")));
    assert.deepEqual(owners, ["hudKit.js"]);
});

// libraryBar kept surfaceStyle and actionButtonStyle as object literals; the kit
// makes them aliases, which is the change that stops the panel drifting back.
test("libraryBar aliases the kit instead of re-declaring its surfaces", () => {
    const libraryBar = read("libraryBar.jsx");
    assert.match(libraryBar, /const surfaceStyle = HUD_SURFACE/);
    assert.match(libraryBar, /const actionButtonStyle = HUD_ACTION/);
    assert.doesNotMatch(libraryBar, /const surfaceStyle = \{/);
    assert.doesNotMatch(libraryBar, /const actionButtonStyle = \{/);
});
