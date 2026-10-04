<!-- Open Historia - durable file writes for the data store (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->

# Atomic Writes: A Save That Survives the Interruption

The next increment is not a game feature but a durability one. Every stored
artifact on the server - the library catalogs, a scenario's world, a game's
events, the basemap and flag and map-editor stores, the server's own settings
and its hub cache - is written by truncating the target file and writing the new
bytes into it. If the process is killed, the machine loses power, or the write
throws partway, the player is left with a half-written JSON file where a save
used to be. This increment replaces those writes with a single atomic path.

## Why this increment exists

1. **A direct write is not crash-safe.** `fs.writeFileSync(target, data)`
   truncates `target` and then writes. Between those two moments the file on
   disk is short, empty or half a document. A crash, a `kill -9`, a container
   eviction or a battery death in that window destroys the previous good file
   and leaves the new one in pieces. The same is true of a thrown error mid
   write.

2. **The risk is concentrated where the player keeps everything.** The library
   manifest, the scenario and game manifests, each scenario's `world.json` and
   `events.json`, and the asset payloads all pass through
   `libraryStore.js`. That is a save library, not scratch space; a torn file
   there is lost work, not a regenerated cache.

3. **The pattern already exists, in exactly two places.** `scenarioBundleNames.js`
   rewrites its cache with `writeFileSync(tmp) + renameSync(tmp, target)`, and
   `server.js` writes the hub cache body the same way. So the house already
   agrees this is the right shape; this increment makes it the one shape, applied
   everywhere a whole file is replaced, instead of a habit two call sites kept.

4. **`rename` on the same filesystem is atomic, and that is the whole trick.**
   Writing to a temporary file in the SAME directory and then renaming it over
   the target means a reader (and a crash) sees either the complete old file or
   the complete new one, never a mixture. The increment is mostly the discipline
   of never doing it any other way.

## Scope

This increment introduces one import-free-of-browser helper and routes every
whole-file replacement on the server through it.

1. A new `server/atomicWrite.js` wrapping `write-file-atomic`: a temporary file
   in the target's directory, fsync of the file, rename over the target, and a
   best-effort fsync of the directory so the rename itself survives power loss.
2. Convert every `fs.writeFileSync` that replaces a whole file in
   `libraryStore.js`, `flagStore.js`, `basemapStore.js`, `mapEditorStore.js`,
   `scenarioBundleNames.js` and `server.js` to the helper, reusing the helper in
   the two ad-hoc temp-and-rename sites that already exist.
3. Keep the two semantics that are NOT whole-file replacement: the import-ping
   marker's exclusive create (`{ flag: "wx" }`) and the log rotation
   (`logStore.js`). The marker goes through a named exclusive helper so it stays
   O_EXCL; the rotation is left untouched.
4. A test for the helper and a source-text guard that forbids a raw
   `fs.writeFileSync` in the converted files.

## Non-goals

- **Cross-file transactions.** Writing `coarse` regions and their stamp are two
  files; a crash between them can leave a stamp newer than the payload it
  describes. They are written coarse-then-stamp, and the reader already treats a
  missing or mismatched stamp as "rebuild", so the pair is self-healing. No
  multi-file commit is introduced.
- **A write queue or locking on the server.** The desktop server writes separate
  files per game (`writeQueue.js` explains why the browser needs a queue and the
  server does not). This increment makes a single write atomic; it does not
  serialize concurrent writes to the same path, which no server code performs
  today.
- **Changing any stored shape.** The bytes written to a target are identical;
  only the path they take to reach it changes. No migration, no version bump.
- **Crash-safety for the browser store.** Web mode persists to IndexedDB, which
  already has its own transaction and write-queue model. Only the server's file
  writes are in scope.
- **Retrying or reporting a failed write.** A failed atomic write throws to its
  caller exactly as `writeFileSync` did; the caller keeps whatever error
  handling it already has.

## Design

### 1. Layers

The server is plain Node with `express` and `@noble/*` as its only runtime
dependencies, so one more small, widely-used dependency is in keeping.

| Layer | Location | Rule in this increment |
|---|---|---|
| Helper | `server/atomicWrite.js` (new) | The only module allowed to call a raw `fs.writeFileSync` for whole-file replacement. Wraps `write-file-atomic` and adds a directory fsync. |
| Stores | `server/libraryStore.js`, `flagStore.js`, `basemapStore.js`, `mapEditorStore.js`, `scenarioBundleNames.js` | Replace whole-file writes with the helper. |
| Server | `server/server.js` | Same for settings and the hub cache; the `wx` marker uses the exclusive helper. |
| Dependency | `package.json` | Add `write-file-atomic` (^8.0.0). |
| Test | `server/atomicWrite.test.js` (new) | Behavior of both helpers and the raw-write guard. |

### 2. The helper

`atomicWriteSync(target, data, options)`:

1. Call `writeFileSync` from `write-file-atomic` with `{ fsync: true }` merged
   with the caller's `options`. The library writes a uniquely named temporary
   file in the target's directory, fsyncs it, and renames it over the target.
2. Then fsync the target's directory, best-effort, so the rename entry itself is
   durable. Open the directory read-only, fsync, close; swallow `EISDIR`,
   `EPERM`, `EINVAL` and `ENOTSUP`, because Windows cannot open a directory as a
   file and the rename there is already crash-atomic. Never let the directory
   fsync turn a succeeded write into a thrown one.

The reason for the explicit directory fsync: `write-file-atomic` fsyncs the
FILE it wrote, so the file's contents are durable, but fsyncing the directory
that holds the new name is a separate operation. Without it, a power loss just
after the rename can lose the directory entry while the old name remains - the
documented gap between "the bytes are on disk" and "the name points at them".
The increment chose to close it.

`atomicExclusiveWriteSync(target, data)`:

1. `fs.writeFileSync(target, data, { flag: "wx" })` - a single `O_CREAT|O_EXCL`
   open, so exactly one caller wins and every other caller gets `EEXIST`.
2. It exists so the one correct exclusive-create site has a named, documented
   home, and so the raw-write guard has one sanctioned place for an exclusive
   write that is deliberately NOT a temp-and-rename (a rename would defeat the
   O_EXCL check by overwriting).

### 3. Converted call sites

`libraryStore.js`:

- `writeJsonFile` (`:571`) - the choke point every meta and manifest write
  already funnels through, so its one line covers the catalog writes.
- the binary seed copy (`:1275`), the two asset payload writes (`:2544`,
  `:2586`), the upload writes (`:3480`, `:3497`, `:3500`), the JSON write at
  `:3133`, and the coarse-regions and stamp writes (`:2634`, `:2635`).

`flagStore.js:29`, `basemapStore.js:39`, `mapEditorStore.js:36`,
`scenarioBundleNames.js:95`.

`server.js`: the network settings (`:122`), the saved language (`:377`), the UI
settings (`:392`), and the hub-cache content type (`:1248`).

Reused: `scenarioBundleNames.js:71-72` and `server.js:1246-1247` currently spell
out temp-and-rename by hand; both become one `atomicWriteSync` call, so the
hub-cache body and the bundle-name cache use the same path as everything else.

### 4. Excluded and documented

- The import-ping marker (`server.js:1292`) keeps O_EXCL semantics through
  `atomicExclusiveWriteSync`; it is a create-if-absent flag, not a replacement.
- Log rotation (`logStore.js:74-76`) is a rename of the whole file to a backup
  name, not a content replacement, and is left as it is.

## Testing

`server/atomicWrite.test.js`, run with `node --test "server/atomicWrite.test.js"`:

1. `atomicWriteSync` writes new content and replaces existing content, and the
   target reads back byte-for-byte (string and Buffer).
2. It leaves no temporary files behind in the directory after success.
3. It creates the target's directory if absent (matching the stores' current
   `ensureDirectory` behavior being harmless to call twice).
4. `atomicExclusiveWriteSync` writes when the target is absent and throws
   `EEXIST` when it exists, leaving the original content unchanged.
5. The source-text guard: no `fs.writeFileSync(` appears in `libraryStore.js`,
   `flagStore.js`, `basemapStore.js`, `mapEditorStore.js`,
   `scenarioBundleNames.js` or `server.js` except the sanctioned
   `atomicExclusiveWriteSync` call in `atomicWrite.js` itself, which is excluded.
   The guard reads each file as text, the house pattern for a rule that cannot
   be seen from a single function.

The existing store tests (`libraryStore`, `gameBundle`, `scenarioBundleNames`,
`mapEditorStore`, `flagStore`, `basemapStore` and the editor persistence tests)
are the integration evidence: they exercise the same writes and must stay green
without an expectation change. The final content is identical, so a test that
passes today passes after the conversion.

## Compatibility

No stored shape changes and no migration is introduced. Every converted call
writes the same bytes to the same path; only a temporary sibling file and a
rename intervene. The one visible difference is that a crash now leaves the old
file intact instead of a truncated new one.

## Open questions

None block implementation. Recorded so the plan does not silently decide them.

- Whether the log rotation family (`logStore.js`, and the size-triggered
  rotation of the desktop and server logs) should also become atomic is
  deferred; rotation renames rather than rewrites, so it is a different
  operation and out of this increment's shape.
- Whether a future increment should fsync on a schedule rather than per write
  for the hottest paths is deferred; the converted writes are user-driven, not a
  hot loop, so a per-write fsync is affordable here.
