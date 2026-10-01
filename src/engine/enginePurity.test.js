// Run: node --test src/engine/enginePurity.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const DIRECTORY = new URL(".", import.meta.url);
const sources = () =>
  readdirSync(DIRECTORY)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
    .map((name) => ({ name, text: readFileSync(new URL(name, DIRECTORY), "utf8") }));

const ALLOWED_IMPORTS = [
  /^\.\/[a-zA-Z0-9]+\.js$/,
  /^\.\.\/runtime\/gameDates\.js$/,
  /^\.\.\/runtime\/unitMotion\.js$/,
];

test("the engine reads no clock and no entropy", () => {
  for (const { name, text } of sources()) {
    assert.equal(/Date\.now\s*\(/.test(text), false, `${name} calls Date.now`);
    assert.equal(/new\s+Date\s*\(/.test(text), false, `${name} constructs a Date`);
    assert.equal(/Math\.random\s*\(/.test(text), false, `${name} calls Math.random`);
  }
});

test("the engine touches no browser global", () => {
  for (const { name, text } of sources()) {
    for (const global of ["localStorage", "sessionStorage", "window", "document", "navigator", "fetch", "import.meta.env"]) {
      assert.equal(text.includes(global), false, `${name} references ${global}`);
    }
  }
});

test("the engine imports only its own files and the two import-free runtime helpers", () => {
  for (const { name, text } of sources()) {
    const specifiers = [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.ok(
        ALLOWED_IMPORTS.some((pattern) => pattern.test(specifier)),
        `${name} imports a module outside the allow list: ${specifier}`,
      );
    }
  }
});
