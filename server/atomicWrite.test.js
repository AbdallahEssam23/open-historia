// Run: node --test server/atomicWrite.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { atomicExclusiveWriteSync, atomicWrite, atomicWriteSync } from "./atomicWrite.js";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "oh-atomic-"));

test("atomicWriteSync writes new content and replaces existing content", () => {
  const dir = tempDir();
  const target = path.join(dir, "save.json");
  atomicWriteSync(target, "first");
  assert.equal(fs.readFileSync(target, "utf-8"), "first");
  atomicWriteSync(target, "second");
  assert.equal(fs.readFileSync(target, "utf-8"), "second");

  const binary = path.join(dir, "asset.bin");
  atomicWriteSync(binary, Buffer.from([0x00, 0x01, 0xff]));
  assert.deepEqual(fs.readFileSync(binary), Buffer.from([0x00, 0x01, 0xff]));
});

test("a successful write leaves no temporary file behind", () => {
  const dir = tempDir();
  atomicWriteSync(path.join(dir, "only.json"), "{}");
  assert.deepEqual(fs.readdirSync(dir), ["only.json"]);
});

test("the target's directory is created when missing", () => {
  const dir = tempDir();
  const nested = path.join(dir, "a", "b", "save.json");
  atomicWriteSync(nested, "deep");
  assert.equal(fs.readFileSync(nested, "utf-8"), "deep");
});

test("a string encoding option is honored, as fs.writeFileSync does", () => {
  const dir = tempDir();
  const target = path.join(dir, "latin1.txt");
  atomicWriteSync(target, "\u00e9", "latin1");
  assert.deepEqual(fs.readFileSync(target), Buffer.from([0xe9]));
});

test("atomicWrite writes new content and replaces existing content", async () => {
  const dir = tempDir();
  const target = path.join(dir, "save.json");
  await atomicWrite(target, "first");
  assert.equal(fs.readFileSync(target, "utf-8"), "first");
  await atomicWrite(target, "second");
  assert.equal(fs.readFileSync(target, "utf-8"), "second");

  const binary = path.join(dir, "asset.bin");
  await atomicWrite(binary, Buffer.from([0x00, 0x01, 0xff]));
  assert.deepEqual(fs.readFileSync(binary), Buffer.from([0x00, 0x01, 0xff]));
});

test("an async write leaves no temporary file behind and creates the directory", async () => {
  const dir = tempDir();
  const nested = path.join(dir, "a", "b", "save.json");
  await atomicWrite(nested, "deep");
  assert.equal(fs.readFileSync(nested, "utf-8"), "deep");
  assert.deepEqual(fs.readdirSync(path.join(dir, "a", "b")), ["save.json"]);
});

test("the async and sync helpers write identical bytes", async () => {
  const dir = tempDir();
  const payload = JSON.stringify({ a: [1, 2, 3], b: "\u00e9" }, null, 2);
  const asyncTarget = path.join(dir, "async.json");
  const syncTarget = path.join(dir, "sync.json");
  await atomicWrite(asyncTarget, payload, "utf-8");
  atomicWriteSync(syncTarget, payload, "utf-8");
  assert.deepEqual(fs.readFileSync(asyncTarget), fs.readFileSync(syncTarget));
});

test("atomicExclusiveWriteSync creates once and refuses the second create", () => {
  const dir = tempDir();
  const marker = path.join(dir, "marker");
  atomicExclusiveWriteSync(marker, "id:7");
  assert.equal(fs.readFileSync(marker, "utf-8"), "id:7");
  assert.throws(() => atomicExclusiveWriteSync(marker, "id:7"), /EEXIST/);
  assert.equal(fs.readFileSync(marker, "utf-8"), "id:7", "the first marker is kept");
});

// The conversion's own regression lock: none of the converted files may write a
// whole file with a raw fs.writeFileSync again. The detector is self-checked so
// the guard can never pass by matching nothing.
const RAW_WRITE = "fs.writeFileSync(";
const rawWriteCount = (text) => text.split(RAW_WRITE).length - 1;

test("the raw-write detector matches a raw write and not the helper", () => {
  assert.equal(rawWriteCount("x = fs.writeFileSync(p, d);"), 1);
  assert.equal(rawWriteCount("atomicWriteSync(p, d);"), 0);
});

test("the converted server files never use a raw fs.writeFileSync", () => {
  const converted = [
    "libraryStore.js",
    "flagStore.js",
    "basemapStore.js",
    "mapEditorStore.js",
    "scenarioBundleNames.js",
    "server.js",
  ];
  for (const name of converted) {
    const source = fs.readFileSync(new URL(`./${name}`, import.meta.url), "utf-8");
    assert.equal(rawWriteCount(source), 0, `${name} must use server/atomicWrite.js, not a raw write`);
  }
});
