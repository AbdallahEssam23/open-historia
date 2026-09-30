/*! Open Historia — the type stacks' guardrails © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ARABIC_LABEL_FONTS,
  DISPLAY_FONT_STACK,
  MONO_FONT_STACK,
  UI_FONT_STACK,
  containsArabicScript,
} from "./fontStacks.js";

const SRC = new URL("../", import.meta.url);
const read = (relative) => fs.readFileSync(new URL(relative, SRC), "utf8");
const styles = read("styles.css");

const sourceFiles = (dir = new URL(".", SRC), out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) sourceFiles(child, out);
    // The test files talk ABOUT the fonts, so they are not scanned for them.
    else if (/\.(js|jsx|css)$/.test(entry.name) && !entry.name.endsWith(".test.js")) out.push(child);
  }
  return out;
};

// ---------------------------------------------------------------------------
// The regression this file exists for.
//
// The Arabic typefaces reach the DOM as the --oh-font-* stacks. A single
// `fontFamily: "sans-serif"` in a JSX style is not "the default" — an inline
// style outranks every stylesheet rule, so a component that hardcodes it drops
// its Arabic text back onto the device's font. That is what made one screen mix
// two Arabic faces. Ninety-one of these were removed; this fails if any returns.
// ---------------------------------------------------------------------------
test("no component hardcodes a generic font family", () => {
  // `fontFamily: "sans-serif"` in a JSX style object, or the same declaration
  // inside a CSS-in-JS template string. Either one outranks the custom property.
  const hardcoded = [
    /fontFamily: *["'](sans-serif|monospace)["']/,
    /font-family: *(sans-serif|monospace) *[;}"']/,
    /font: *["'][^"']*\b(sans-serif|monospace)["']/,
  ];
  const offenders = [];
  for (const file of sourceFiles()) {
    if (file.pathname.endsWith("/styles.css")) continue;
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, index) => {
      if (!hardcoded.some((pattern) => pattern.test(line))) return;
      offenders.push(`${path.relative(SRC.pathname, file.pathname)}:${index + 1} ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `use var(--oh-font-ui) / var(--oh-font-mono) instead:\n${offenders.join("\n")}`);
});

test("the game declares the three stacks, and the CSS agrees with fontStacks.js", () => {
  const declared = (name) => {
    const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(styles);
    assert.ok(match, `styles.css declares --${name}`);
    return match[1].replace(/\s+/g, " ").trim();
  };
  assert.equal(declared("oh-font-ui"), UI_FONT_STACK);
  assert.equal(declared("oh-font-display"), DISPLAY_FONT_STACK);
  assert.equal(declared("oh-font-mono"), MONO_FONT_STACK);
  // The reading serif is the one the loading screen uses, and it is the only
  // place EB Garamond rather than Cinzel is wanted.
  assert.match(declared("oh-font-serif"), /^"Amiri", "EB Garamond"/);
});

test("body text and the loading screen read their stack from the custom properties", () => {
  assert.match(styles, /body\s*{[^}]*font-family: var\(--oh-font-ui\)/);
  const screen = read("runtime/StartupScreen.jsx");
  assert.match(screen, /font-family: var\(--oh-font-serif\)/);
  assert.doesNotMatch(screen, /font-family: '(EB Garamond|Cinzel)'/);
  assert.ok(screen.includes("var(--oh-font-display)"), "the loading screen's Cinzel headings take the display stack");
});

// ---------------------------------------------------------------------------
// The Arabic faces, and the property that keeps them invisible to Latin text.
// ---------------------------------------------------------------------------
test("every Arabic face is bundled, declared over the Arabic blocks only, and a real woff2", () => {
  const blocks = [...styles.matchAll(/@font-face\s*{([^}]*)}/g)].map((match) => match[1]);
  const arabicFamilies = [...new Set(ARABIC_LABEL_FONTS)];
  for (const family of arabicFamilies) {
    assert.ok(
      blocks.some((block) => block.includes(`font-family: '${family}'`)),
      `${family} is declared`,
    );
  }

  const declared = blocks.filter((block) => arabicFamilies.some((family) => block.includes(`font-family: '${family}'`)));
  assert.equal(declared.length, 6, "four IBM Plex Sans Arabic weights and two Amiri weights");

  for (const block of declared) {
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
    assert.ok(range, "the face is scoped by unicode-range");
    assert.match(range, /U\+0600-06FF/, "the Arabic block is covered");
    // The whole reason the stack can put an Arabic face first: it claims no Latin
    // character, so Latin text is matched against the next family as before.
    assert.doesNotMatch(range, /U\+0000-00FF|U\+0041|U\+0061/, "the face claims no Latin character");

    const file = /url\(\.\/(assets\/fonts\/[^)]+\.woff2)\)/.exec(block)?.[1];
    assert.ok(file, "the face points at a bundled file");
    const bytes = fs.readFileSync(new URL(file, SRC));
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${file} is a woff2 font`);
  }
});

test("the OFL licence ships beside the fonts it covers", () => {
  for (const file of ["OFL-IBM-Plex-Sans-Arabic.txt", "OFL-Amiri.txt"]) {
    assert.match(read(`assets/fonts/${file}`), /SIL OPEN FONT LICENSE Version 1\.1/i, file);
  }
});

test("Arabic script is recognised, and Latin text is not", () => {
  for (const value of ["مصر", "المملكة العربية السعودية", "دولة", "۱۴۰۰"]) {
    assert.equal(containsArabicScript(value), true, value);
  }
  for (const value of ["Egypt", "United States of America", "Jan 1, 2016", "2016-01-08", "· 42", ""]) {
    assert.equal(containsArabicScript(value), false, value);
  }
  assert.equal(containsArabicScript(null), false);
});

test("the Arabic reset clears tracking and italic, and translator.js turns it on", () => {
  const rule = /\.oh-rtl[^{]*{([^}]*)}/.exec(styles)?.[1];
  assert.ok(rule, "styles.css has an .oh-rtl rule");
  assert.match(rule, /letter-spacing: normal !important/, "tracking breaks the cursive joins");
  assert.match(rule, /font-style: normal !important/, "there is no true italic Arabic");
  assert.match(rule, /font-synthesis: none/, "a missing face must not be faked");

  assert.match(read("runtime/translator.js"), /classList\.add\("oh-rtl"\)/);
});
