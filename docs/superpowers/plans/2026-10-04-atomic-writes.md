# Atomic Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every whole-file `fs.writeFileSync` on the server with one
atomic path (temporary sibling, file fsync, rename, directory fsync), so a crash
or power loss can never leave a torn save where a good file used to be.

**Architecture:** A new `server/atomicWrite.js` wraps `write-file-atomic` and
adds a best-effort directory fsync. Every store converts its writes to
`atomicWriteSync`; the one exclusive-create marker uses
`atomicExclusiveWriteSync` so it keeps its `O_EXCL` meaning. A source-text guard
forbids a raw `fs.writeFileSync` in the converted files.

**Tech Stack:** Node.js ESM, `node --test`, `write-file-atomic@^7.0.1`.

## Global Constraints

- Add `write-file-atomic` (^7.0.1) to `package.json` dependencies and
  `package-lock.json`. This is the one intended dependency change for the
  increment; no other manifest field changes and `ENGINE_VERSION` is untouched.
  Version 8 is rejected: it requires Node `^22.22.2` while this repo supports
  Node `^20.19.0 || >=22.12.0`. Version 7 needs only `^20.17 || >=22.9`.
- Only ASCII in every added line. No emoji, no em dash, no middle dot.
- `server/atomicWrite.js` is the ONLY module allowed to call a raw
  `fs.writeFileSync`. Every other converted file must call the helper.
- Do not delete the two semantics that are not whole-file replacement: the
  exclusive marker stays `O_EXCL` (through the exclusive helper), and
  `server/logStore.js` rotation is left untouched.
- No stored shape changes. The bytes written to each target are identical; no
  migration and no version bump.
- Every commit is conventional and carries the trailer
  `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`. The
  `prepare-commit-msg` hook appends it: never pass it with `-m`.
- Tests run with globs, never a directory: `node --test "server/*.test.js"` and
  the focused `node --test "server/<file>.test.js"`.
- Do not weaken an existing test to pass. The final bytes are unchanged, so
  every existing store test must stay green with no expectation edit.

---

## Pre-flight findings

Checked against the working tree at `7522707` before writing this plan.

1. **A dependency version in the approved spec is unusable.** The spec named
   `write-file-atomic@^8.0.0`, whose `engines` is `^22.22.2 || ^24.15.0 ||
   >=26.0.0`. This machine runs Node v22.22.0 and the repo declares
   `^20.19.0 || >=22.12.0`, so `^8.0.0` fails the engine check. The spec was
   corrected to `^7.0.1` (engines `^20.17.0 || >=22.9.0`) in commit `7522707`;
   this plan implements that.
2. **Baseline is green.** `npm test` on `7522707`: 2987 tests, 2985 pass, 0 fail,
   2 todo. `write-file-atomic` is not yet installed.
3. **The exact raw-write sites** (`rg -n "fs\.writeFileSync" server`, non-test):
   `libraryStore.js` lines 573, 1275, 2544, 2586, 2634, 2635, 3133, 3480, 3497,
   3500; `flagStore.js:29`; `basemapStore.js:39`; `mapEditorStore.js:36`;
   `scenarioBundleNames.js:71` and `:95`; `server.js` lines 122, 377, 392, 1246,
   1248, 1292. These are the complete converted set.
4. **Two sites already do temp-and-rename by hand** -
   `scenarioBundleNames.js:71-72` and `server.js:1246-1247` - and become single
   `atomicWriteSync` calls. The hub cache content type (`server.js:1248`) is a
   second, currently non-atomic write in the same block.
5. **`libraryStore.js:571` is a choke point** (`writeJsonFile`) that every meta
   and manifest write funnels through, and it already calls `ensureDirectory`.
   Converting its one line covers the JSON catalog writes.
6. **The exclusive marker** (`server.js:1292`, `{ flag: "wx" }`) is a
   create-if-absent flag. A temp-and-rename would overwrite an existing marker
   and defeat the dedupe, so it must stay a single `O_EXCL` create.
7. **Module format.** `write-file-atomic@7` is CommonJS; the server already
   imports CommonJS defaults the same way (`import express from "express"`). The
   helper uses `import writeFileAtomic from "write-file-atomic"` and
   `writeFileAtomic.sync(...)`.
8. **An existing test reads `server/scenarioBundleNames.test.js` and passes
   today** (5 tests); it must still pass after the conversion.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` (modify) | Add `write-file-atomic@^7.0.1`. |
| `server/atomicWrite.js` (create) | The one atomic path: `atomicWriteSync`, `atomicExclusiveWriteSync`. |
| `server/atomicWrite.test.js` (create) | Behavior of both helpers and the raw-write guard. |
| `server/libraryStore.js` (modify) | Convert the choke point, the binaries, the assets, and the coarse/stamp pair. |
| `server/flagStore.js`, `server/basemapStore.js`, `server/mapEditorStore.js`, `server/scenarioBundleNames.js` (modify) | Convert their whole-file writes. |
| `server/server.js` (modify) | Convert settings and the hub cache; route the marker through the exclusive helper. |

---

### Task 1: Add the dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `write-file-atomic` resolves under `node_modules` with a `.sync`
  method, and every later task may import it.

- [ ] **Step 1: Install the pinned version**

Run:

```bash
npm install write-file-atomic@^7.0.1
```

Expected: exit 0; `package.json` gains `"write-file-atomic": "^7.0.1"` in
`dependencies` and `package-lock.json` records it.

- [ ] **Step 2: Verify the resolved version and API**

Run:

```bash
node -e "import('write-file-atomic').then((m) => { const w = m.default; if (typeof w.sync !== 'function') throw new Error('no sync'); console.log('write-file-atomic ok'); })"
```

Expected: `write-file-atomic ok`.

- [ ] **Step 3: Confirm the dependency range is supported**

Run:

```bash
node -e "const p=require('./node_modules/write-file-atomic/package.json'); console.log(p.version, JSON.stringify(p.engines))"
```

Expected: a `7.x` version (NOT 8.x), since 8 requires a newer Node than this
repo targets.

- [ ] **Step 4: Run the server glob to confirm nothing moved**

Run: `node --test "server/*.test.js"`
Expected: PASS, the same tests as the baseline (adding a dependency changes no
behavior).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build(server): add write-file-atomic for durable saves"
```

---

### Task 2: The atomic write helper

**Files:**
- Create: `server/atomicWrite.js`
- Test: `server/atomicWrite.test.js`

**Interfaces:**
- Produces: `atomicWriteSync(target, data, options = {})` replaces `target` with
  `data` (string or Buffer) atomically, creating the parent directory if absent;
  `atomicExclusiveWriteSync(target, data)` creates `target` only if absent and
  throws `EEXIST` otherwise.

- [ ] **Step 1: Write the failing test**

Create `server/atomicWrite.test.js`:

```js
// Run: node --test server/atomicWrite.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { atomicExclusiveWriteSync, atomicWriteSync } from "./atomicWrite.js";

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
  void fileURLToPath;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "server/atomicWrite.test.js"`
Expected: FAIL, the module does not exist. (The raw-write guard also fails on
the not-yet-converted files, which later tasks turn green; that is expected and
is why this task's own behavior tests are the ones that must pass at Step 4.)

- [ ] **Step 3: Write the helper**

Create `server/atomicWrite.js`:

```js
/*! Open Historia - durable whole-file writes for the server stores (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test server/atomicWrite.test.js
//
// A stored artifact written with fs.writeFileSync(target, data) is truncated
// and then rewritten: a crash, a kill or a full disk in that window destroys
// the previous good file and leaves a torn one. A temporary sibling plus a
// rename makes the swap atomic - a reader and a crash see either the whole old
// file or the whole new one. This module is the one place that shape lives, so
// no store has to spell it out again.
//
// write-file-atomic does the temporary file, the file fsync and the rename. It
// does NOT fsync the directory that holds the new name, so a power loss right
// after the rename can still lose the entry; the directory fsync below closes
// that gap, best-effort, because Windows cannot open a directory as a file.

import fs from "fs";
import path from "path";
import writeFileAtomic from "write-file-atomic";

// Durability for the rename itself, not for the bytes already fsynced by the
// library. A platform that refuses to open a directory (Windows) still gets an
// atomic rename, so a failure here must never turn a succeeded write into a
// throw.
const fsyncDirectory = (target) => {
  let fd;
  try {
    fd = fs.openSync(path.dirname(target), "r");
  } catch {
    return;
  }
  try {
    fs.fsyncSync(fd);
  } catch {
    // EINVAL/ENOTSUP/EPERM on directories: nothing more this platform offers.
  } finally {
    fs.closeSync(fd);
  }
};

// Replace `target` with `data` atomically. `data` is a string or a Buffer, as
// fs.writeFileSync takes. The parent directory is created if missing, matching
// what every caller already arranged for itself before the write.
export const atomicWriteSync = (target, data, options = {}) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeFileAtomic.sync(target, data, { fsync: true, ...options });
  fsyncDirectory(target);
};

// Create `target` only if it does not exist - the one O_EXCL write this server
// makes (the import counter's once-per-install marker). A temp-and-rename would
// overwrite an existing marker and defeat the dedupe, so this stays a single
// exclusive create and lives here as the sanctioned raw write.
export const atomicExclusiveWriteSync = (target, data) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data, { flag: "wx" });
};
```

- [ ] **Step 4: Run the behavior tests**

Run: `node --test "server/atomicWrite.test.js"`
Expected: the four behavior tests PASS. The two guard tests still fail until
Tasks 3-5 convert the files; that is the intended order, and the full file goes
green after Task 5. Do not weaken the guard here.

- [ ] **Step 5: Commit**

```bash
git add server/atomicWrite.js server/atomicWrite.test.js
git commit -m "feat(server): add an atomic whole-file write helper"
```

---

### Task 3: Convert the library store

**Files:**
- Modify: `server/libraryStore.js` (the `fs.writeFileSync` sites listed above)
- Test: `server/gameBundle.test.js`, `server/scenarioBundleNames.test.js` (run
  only; no edit)

**Interfaces:**
- Consumes: `atomicWriteSync` from `server/atomicWrite.js`.
- Produces: `libraryStore.js` contains no raw `fs.writeFileSync`.

- [ ] **Step 1: Import the helper**

In `server/libraryStore.js`, beside the existing `import fs from "fs";`:

```js
import { atomicWriteSync } from "./atomicWrite.js";
```

- [ ] **Step 2: Convert the choke point**

In `writeJsonFile` (`:571-579`), replace the `fs.writeFileSync` call:

```js
const writeJsonFile = (targetPath, value) => {
  ensureDirectory(path.dirname(targetPath));
  atomicWriteSync(targetPath, JSON.stringify(value, null, 2), "utf-8");
```

Keep the `invalidateCatalogs()` line and its comment unchanged.

- [ ] **Step 3: Convert the remaining writes**

Replace each of these `fs.writeFileSync(...)` calls with `atomicWriteSync(...)`,
keeping the same target, data and encoding:

```js
// :1275  seed file copy
atomicWriteSync(target, fs.readFileSync(source));
// :2544 and :2586  asset payloads
atomicWriteSync(targetPath, dataBuffer);
// :2634 and :2635  coarse regions and their stamp
atomicWriteSync(coarsePath, JSON.stringify(coarsenFeatureCollection(data)), "utf-8");
atomicWriteSync(stampPath, stamp, "utf-8");
// :3133
atomicWriteSync(targetPath, JSON.stringify(value), "utf-8");
// :3480, :3497, :3500  uploads
atomicWriteSync(getScenarioUploadPath(scenarioId, assetKey), decoded);
atomicWriteSync(getScenarioUploadPath(scenarioId, assetKey), decoded);
atomicWriteSync(getScenarioUploadPath(scenarioId, assetKey), JSON.stringify(assetValue.data ?? {}), "utf-8");
```

The coarse/stamp pair keeps its order (coarse first, stamp second): the stamp is
the "fresh" signal, so writing it last means a crash between the two leaves a
stale stamp and the reader rebuilds, which is the self-healing direction.

- [ ] **Step 4: Confirm no raw write remains**

Run: `rg -n "fs\.writeFileSync" server/libraryStore.js`
Expected: no output.

- [ ] **Step 5: Run the store tests**

Run: `node --test "server/gameBundle.test.js" "server/scenarioBundleNames.test.js"`
Expected: PASS, unchanged expectations.

Run: `node --check server/libraryStore.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add server/libraryStore.js
git commit -m "refactor(server): write the library store atomically"
```

---

### Task 4: Convert the small stores

**Files:**
- Modify: `server/flagStore.js`, `server/basemapStore.js`,
  `server/mapEditorStore.js`, `server/scenarioBundleNames.js`

**Interfaces:**
- Consumes: `atomicWriteSync` from `server/atomicWrite.js`.
- Produces: none of these four files contains a raw `fs.writeFileSync`.

- [ ] **Step 1: Convert flagStore.js**

Add `import { atomicWriteSync } from "./atomicWrite.js";` beside its
`import fs from "fs";`. At `:29`, replace:

```js
atomicWriteSync(FLAGS_PATH, JSON.stringify({ version: 1, flags }));
```

- [ ] **Step 2: Convert basemapStore.js**

Add the import. At `:39`, replace:

```js
atomicWriteSync(target, JSON.stringify(value));
```

- [ ] **Step 3: Convert mapEditorStore.js**

Add the import. At `:36`, replace:

```js
atomicWriteSync(target, JSON.stringify(value));
```

- [ ] **Step 4: Convert scenarioBundleNames.js**

Add `import { atomicWriteSync } from "./atomicWrite.js";` beside its
`import fs from "node:fs";`. Replace the two-line temp-and-rename at `:71-72`:

```js
      fs.writeFileSync(`${file}.tmp`, bytes);
      fs.renameSync(`${file}.tmp`, file);
```

with the helper:

```js
      atomicWriteSync(file, bytes);
```

and the marker write at `:95`:

```js
  atomicWriteSync(marker, `${new Date().toISOString()}\n`);
```

- [ ] **Step 5: Confirm no raw writes remain**

Run: `rg -n "fs\.writeFileSync" server/flagStore.js server/basemapStore.js server/mapEditorStore.js server/scenarioBundleNames.js`
Expected: no output.

- [ ] **Step 6: Run the affected tests**

Run: `node --test "server/scenarioBundleNames.test.js" "server/basemapSelection.test.js" "server/editorBasemaps.test.js" "server/scenarioBasemapPersistence.test.js"`
Expected: PASS, unchanged expectations.

Run: `node --check server/flagStore.js && node --check server/basemapStore.js && node --check server/mapEditorStore.js && node --check server/scenarioBundleNames.js`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add server/flagStore.js server/basemapStore.js server/mapEditorStore.js server/scenarioBundleNames.js
git commit -m "refactor(server): write the small stores atomically"
```

---

### Task 5: Convert the server settings and hub cache

**Files:**
- Modify: `server/server.js`

**Interfaces:**
- Consumes: `atomicWriteSync`, `atomicExclusiveWriteSync` from
  `server/atomicWrite.js`.
- Produces: `server.js` keeps the exclusive marker's `O_EXCL` meaning, and
  contains no raw `fs.writeFileSync`.

- [ ] **Step 1: Import both helpers**

In `server/server.js`, beside its `import fs from "fs";`:

```js
import { atomicExclusiveWriteSync, atomicWriteSync } from "./atomicWrite.js";
```

- [ ] **Step 2: Convert the settings writes**

Replace each with `atomicWriteSync`, keeping target, data and encoding:

```js
// :122  network settings
atomicWriteSync(NETWORK_SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
// :377  saved language
atomicWriteSync(path.join(savedLangDir, `${code}.json`), JSON.stringify(saved));
// :392  UI settings
atomicWriteSync(uiSettingsFile, JSON.stringify(next, null, 2));
```

- [ ] **Step 3: Convert the hub cache writes**

Replace the block at `:1244-1251`:

```js
    try {
      fs.mkdirSync(HUB_CACHE_DIR, { recursive: true });
      fs.writeFileSync(`${cache.body}.tmp`, buffer);
      fs.renameSync(`${cache.body}.tmp`, cache.body);
      fs.writeFileSync(cache.type, contentType);
    } catch (cacheError) {
      console.warn("[hub] cache write failed:", cacheError.message);
    }
```

with:

```js
    try {
      fs.mkdirSync(HUB_CACHE_DIR, { recursive: true });
      atomicWriteSync(cache.body, buffer);
      atomicWriteSync(cache.type, contentType);
    } catch (cacheError) {
      console.warn("[hub] cache write failed:", cacheError.message);
    }
```

Keep the surrounding comment (the cache is best-effort and must not fail the
import). The explicit `mkdirSync` is kept for the directory-level reason it
states; the helper also creates the parent, which is harmless.

- [ ] **Step 4: Route the exclusive marker through the helper**

At `:1290-1295`, keep the `mkdirSync` and the try/catch that reads `EEXIST` as
"already counted", but replace the raw write:

```js
      try {
        atomicExclusiveWriteSync(marker, markerKey);
      } catch {
        return; // marker already exists — this scenario was counted on this install
      }
```

This is the one write that must NOT be a temp-and-rename: the marker's meaning
is "create if absent", so it uses the exclusive helper.

- [ ] **Step 5: Confirm no raw write remains**

Run: `rg -n "fs\.writeFileSync" server/server.js`
Expected: no output.

- [ ] **Step 6: Run the guard and the server glob**

Run: `node --test "server/atomicWrite.test.js"`
Expected: ALL tests PASS now, including the two raw-write guard tests.

Run: `node --check server/server.js`
Expected: no output.

Run: `node --test "server/*.test.js"`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add server/server.js
git commit -m "refactor(server): write settings and the hub cache atomically"
```

---

## Acceptance

After all tasks, on the final HEAD:

- `npm test` passes with 0 failures (the known `server/appUpdate.test.js` flake
  is network-only and must not be the cause of a failure).
- `node --test "server/*.test.js"` passes, including `server/atomicWrite.test.js`
  with its behavior tests and its raw-write guard.
- `npx eslint .` shows no new errors beyond the pre-existing 18 in
  `src/Game/Map/*`.
- `npm run wiki:check` prints `Wiki is current.`
- `npm run build` exits 0.
- `rg -n "fs\.writeFileSync" server --glob "*.js"` lists exactly one file,
  `server/atomicWrite.js` (the sanctioned exclusive write); `logStore.js`
  rotation remains a rename and is not in the list.
- Every commit in the increment carries the `Co-authored-by` trailer.
- `ENGINE_VERSION` is unchanged; `package.json` changes only by the added
  dependency (and `package-lock.json` by the matching entry).
