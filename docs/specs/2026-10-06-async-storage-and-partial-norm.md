# Async storage and the partial normalization of the world

Date: 2026-10-06
Status: approved for implementation

## Problem

Two independent stalls sit on the save path, and both are paid on the same
turn.

1. **The server writes a save file synchronously.** Every runtime JSON asset
   - `world.json`, `events.json`, and the 8-21 MB rollback archive in
   `snapshots.json` - reaches disk through `writeJsonFile`
   (`server/libraryStore.js:572`), which calls `atomicWriteSync`
   (`server/atomicWrite.js:47`). The whole temporary write, file fsync, rename
   and directory fsync run on the one event loop that also serves the UI's
   five-second `world.json` poll. A multi-megabyte write therefore blocks the
   request that makes the page look alive, for exactly as long as the disk
   takes.

2. **`normalizeWorldState` rebuilds every scope on every call.** The function
   (`src/runtime/gameState.js:3618`) re-derives every ledger in the document
   even when one field moved. The file already says so: the `normalized` flag
   on `applyEventImpactsToWorld` exists because re-deriving a long campaign's
   world once per event batch cost `batches * world size`
   (`src/runtime/gameState.js:4667`), and the read-only view's normalize is
   instrumented at a 40 ms warning
   (`src/runtime/gameState.js:4022`). The client also normalizes the same
   `bundle.world` dozens of times in one turn, and a spread update such as
   `{ ...world, units: nextUnits }` (the shape `unitsController.js:288` and
   many `gameplay.js` writes use) rebuilds every other scope for nothing.

Neither is a correctness bug; both are wasted work and wasted allocation on a
path the player feels as lag. This increment removes the blocking server write
and teaches the world normalizer to keep the scopes that did not change.

## Goals

- A stored runtime JSON asset is written with `write-file-atomic`'s
  **asynchronous** path, so the server's event loop stays free while the bytes
  reach disk.
- The stored bytes, the shape guards, the catalog invalidation, the read-back
  and the `Prefer: return=minimal` behavior are unchanged: this is a scheduling
  change, proven by the existing route and store tests staying green.
- `normalizeWorldState` accepts an optional previous `{ raw, normalized }`
  pair and **reuses a normalized scope, by reference, when the inputs that fed
  it are reference-identical to the previous call's**. The result is
  byte-for-byte identical to a full normalize, and shares memory for the
  scopes it did not rebuild.
- Any scope whose inputs moved is rebuilt exactly as today. Nothing is
  approximated and nothing is stored.

## Non-goals

- **Converting every `writeJsonFile` caller.** The meta and manifest writes
  (scenario and game creation, renames, migrations, bundle export) are
  user-driven, small and rare. They keep the synchronous helper. Only the
  runtime asset write - the save path the poll competes with - becomes async.
- **A write queue, worker thread or file lock.** One async write is atomic;
  serializing concurrent writes to the same path is a separate problem the
  server does not have today (see the atomic-writes design's non-goals).
- **A stored normalization cache or a new persisted field.** The reuse pair is
  a caller-supplied, in-memory view. No shape changes, no migration.
- **An identity-keyed memo of `normalizeWorldState`.** Reuse is opt-in through
  the `previous` argument, never inferred from the input object's identity, so
  two callers never silently share one result. (Considered, rejected below.)
- **Reusing `relations` and `agreements`.** Their normalizers resolve every
  name through a whole-world identity index
  (`buildPolityIdentityIndex`, `src/runtime/polityIdentity.js:280`), so a
  correct reuse predicate would have to prove every index input unchanged,
  not just the field. They are rebuilt every call, as today.
- **Any new UI, prompt or scenario surface.**

The increment is split in two, each with its own implementation commit, in the
house pattern:

- **31a, async storage:** the async helper, the async store choke point, and
  the async PUT route.
- **31b, partial normalization:** the optional previous pair and the
  dependency-gated scope reuse, wired into the read-only view.

## Design

### 1. Layers

| Layer | Location | Rule in this increment |
| --- | --- | --- |
| Helper | `server/atomicWrite.js` | Add `atomicWrite(target, data, options)`, the async sibling of `atomicWriteSync`. Same temporary file, file fsync, rename, directory fsync. |
| Store | `server/libraryStore.js` | Add `writeJsonFileAsync`; make `writeRuntimeJsonAsset` async and use it for the runtime asset body. `writeJsonFile` stays for the meta and manifest writes. |
| Route | `server/server.js` | `PUT /api/runtime/json/:assetKey` awaits the store. |
| Normalizer | `src/runtime/gameState.js` | `normalizeWorldState(world, { previous })` reuses a scope when its inputs are reference-identical. |
| View | `src/runtime/gameState.js` | `readWorldStateView` passes its own cached pair; `readWorldState` passes none. |
| Tests | `server/atomicWrite.test.js`, `src/runtime/gameState.partialNormalize.test.js` (new) | Async helper behavior; equivalence and reuse of the normalizer. |

### 2. The async atomic write

`atomicWrite(target, data, options)` mirrors `atomicWriteSync`:

1. `await fs.promises.mkdir(path.dirname(target), { recursive: true })`, the
   same pre-create the synchronous helper does.
2. `await writeFileAtomic(target, data, { fsync: true, ...normalized })`. The
   package's default export is already the callback-free promise form; its
   `.sync` sibling is what the current helper calls.
3. `await fsyncDirectoryAsync(target)`: open the directory read-only, `sync()`,
   close; swallow a platform that refuses to open a directory (Windows,
   `EISDIR`, `EPERM`, `EINVAL`, `ENOTSUP`) so a succeeded rename is never
   turned into a throw.

`atomicExclusiveWriteSync` is untouched: the import-ping marker is a
create-if-absent flag written once, not a save file.

`writeRuntimeJsonAsset` becomes `async`. Its two write sites change:

- the scenario geometry branch (`server/libraryStore.js:3134`) uses
  `await atomicWrite(...)` before `writeScenarioMeta`;
- the runtime body (`server/libraryStore.js:3224`) uses
  `await writeJsonFileAsync(targetPath, canonical)`, which is `writeJsonFile`'s
  body with `await atomicWrite(...)` and the same `invalidateCatalogs()` call.

Everything else in the function - the shape guards, `canonicalizeWorldCountryRefs`,
the `snapshots` index write, `writeGameMeta`, and the sync `readRuntimeJsonAsset`
read-back - is unchanged, because the `await` has already landed the bytes.

`PUT /api/runtime/json/:assetKey` (`server/server.js:822`) becomes
`async (req, res)` and awaits the store. Express 5 forwards a rejected handler,
but the existing `try/catch -> sendError(res, 400, error)` is kept so the
error shape does not change.

### 3. Partial normalization

`normalizeWorldState(world, options = {})` gains one optional input:
`options.previous`, a `{ raw, normalized }` pair from an earlier call on the
same lineage of data. When it is absent the function behaves exactly as today.

For each scope the normalizer reconstructs, define

```
unchanged(field) = world[field] === previous.raw[field]
                || world[field] === previous.normalized[field]
```

The second test lets a caller pass an **already-normalized** value straight
back in - the shape a `{ ...view, units }` spread produces - and still hit the
cache. When `unchanged` holds, the previous normalized value is used as-is;
otherwise the existing expression runs.

Owner-resolving scopes carry their dependencies, so a change to
`polityOverrides` invalidates them even when their own field is
reference-identical:

| Scope | Reused when |
| --- | --- |
| `polityOverrides` | unchanged |
| `regionOwnershipOverrides` | unchanged and `polityOverrides` unchanged |
| `regionClaimants` | unchanged and `polityOverrides` unchanged |
| `settledRegionClaims` | unchanged and `regionClaimants` reused |
| `regionSovereigntyOverrides` | unchanged and `regionOwnershipOverrides` reused |
| `projects` | unchanged and `polityOverrides` unchanged |
| `countryStats`, `countryTags`, `intelligence`, `spies`, `units`, `markers`, `reports`, `simulationHistory`, `internationalReputation`, `wars`, `economyEngine` | unchanged |
| `pendingUnitOrders` | unchanged and `units` reused |

Everything else - the cheap scalar, string and label fields, and
`relations`/`agreements` - is recomputed exactly as today.

The `activeCatalyst` to `activeInteractive` move
(`withFormerSceneKeyMoved`, `src/runtime/gameState.js:3525`) means the moved
key is never reused; it is cheap and the move is rare.

### 4. Where the pair comes from

Only `readWorldStateView` supplies a pair, because it is the one caller that
already owns a previous raw and its normalized result and whose consumers are
read-only:

```
normalizeWorldState(raw, { previous: { raw: worldViewRaw, normalized: worldViewNormalized } })
```

`readWorldState` deliberately does NOT pass a pair: it exists to hand every
writer an independent object ("sharing one object between them would let
uncommitted mutations leak", `src/runtime/gameState.js:3999`). Reusing a scope
by reference into a working copy would reintroduce exactly that leak, so the
working-copy path keeps building fresh scopes.

The reuse contract is therefore: **a previous pair may be supplied only when
its raw and normalized have not been mutated in place since the call that
produced them.** `primeCountryStatsWorkerCommit`
(`src/runtime/gameState.js:4038`) is the one in-place patcher, and it updates
`worldViewRaw` and `worldViewNormalized` in step, so the pair it leaves behind
is still consistent. A future in-place writer must do the same.

This is the "changed scopes only" behavior: a caller that hands the view back
with one field replaced re-normalizes that field and keeps the rest by
reference, and the retained objects are the same objects, so the shipped
document is byte-for-byte what a full normalize would have produced.

### 5. Determinism and equivalence

- `normalizeWorldState(w, { previous })` is asserted to be deep-equal to
  `normalizeWorldState(w)` for every update shape the tests build, by
  `JSON.stringify` comparison. The reuse predicate only fires when the
  normalizer's inputs are identical to a previous call's, so its pure output
  is identical.
- The read-only view path is unchanged in what it returns; only how much of it
  was rebuilt changed.
- The two existing route tests (`server/runtimeJsonMinimalReturn.test.js`,
  `server/runtimeJsonShape.test.js`) are the async-write equivalence evidence:
  the same PUTs, the same stored bytes, the same 204/echo behavior.

## Tests

`server/atomicWrite.test.js`, extended:

1. `atomicWrite` writes new content and replaces existing content, string and
   Buffer, and the target reads back byte-for-byte.
2. It creates a missing parent directory and leaves no temporary file behind.
3. Its bytes equal `atomicWriteSync`'s for the same input.

`src/runtime/gameState.partialNormalize.test.js` (new):

1. **Equivalence.** For an authored world, a set of spread updates (one changed
   field at a time, and a combined update) each produce a partial result whose
   `JSON.stringify` equals a full `normalizeWorldState` of the same input.
2. **Reuse.** In a spread update that changes `units`, the untouched scopes
   (`countryStats`, `regionClaimants`, `wars`) are reference-identical to the
   previous result.
3. **Invalidation.** Changing `polityOverrides` rebuilds `regionClaimants`,
   `regionOwnershipOverrides` and `projects` even though those fields are
   reference-identical to the previous raw.
4. **No previous, no reuse.** With no `previous`, the result is a fresh object
   whose scopes are not the previous result's, matching today.

Regression: the store tests that call `writeRuntimeJsonAsset`
(`server/gameCatalog.test.js`, `server/statsDefinitionOwnership.test.js`) are
updated only by awaiting the now-async call, which preserves each test's
intent; no assertion changes. `npm test` stays green (3158 today, 0 fail),
`npx eslint` gains no error, `npm run wiki:check` stays current, and
`npm run build` succeeds.

## Docs

- `docs/server.md`: the async atomic write and the async route.
- `docs/world-state.md`: the optional previous pair, the reuse predicate and
  the no-in-place-mutation contract.

## Considered options

- **Make every `writeJsonFile` async.** Rejected. It forces ~50 meta and
  manifest callers to become async for no benefit; those writes are small and
  user-driven. Only the save path pays for the event loop.
- **A worker thread or child process for the write.** Rejected. It buys
  isolation at the cost of a serialization hop and a second copy of a
  multi-megabyte payload, and the async `fs` path already frees the loop.
- **An identity-keyed memo (WeakMap input to result).** Considered and
  rejected. It would collapse the repeated `normalizeWorldState(bundle.world)`
  calls, but returning a shared result changes the ownership contract the
  working copy relies on, and a caller that mutates a reused scope in place
  would corrupt the memo silently. The explicit `previous` argument makes the
  sharing the caller's visible choice.
- **A structural, per-field cache keyed by a cheap hash.** Rejected. A hash of
  a multi-megabyte field costs as much as normalizing it, and reference
  identity is already exact for the spread-update shapes that matter.
- **Reusing `relations` and `agreements`.** Deferred, not rejected. It is
  reachable once the identity index's inputs are enumerated and gated; this
  increment keeps correctness simple and rebuilds them.

## Risks

- **A caller mutates a reused scope in place.** The read-only view's consumers
  do not; the working-copy path never receives a pair. The contract is stated
  in `docs/world-state.md` and the reuse tests pin the intended behavior.
- **A stale pair is threaded after an in-place write.** Mitigated by threading
  the pair only from `readWorldStateView`, whose cache is refreshed on a new
  raw, and by keeping `primeCountryStatsWorkerCommit`'s raw and normalized
  patches in step.
- **The async write changes error timing.** A rejection now surfaces after an
  `await` instead of a throw; the route keeps its `try/catch`, so the HTTP
  error shape is identical.
- **The perf win is conditional.** Reuse only pays where updates preserve
  references (spread updates) or where the caller supplies the view. That is
  acceptable: the change never costs more than today, and the equivalence
  tests bound it.

## Decisions taken

1. Only the runtime asset write becomes async; meta and manifest writes stay
   synchronous.
2. `normalizeWorldState` reuse is opt-in through an explicit `previous` pair,
   never inferred from object identity.
3. Only `readWorldStateView` supplies a pair; `readWorldState` keeps building
   independent working copies.
4. `relations` and `agreements` are not reused in this increment.
5. Every reuse is dependency-gated so a single changed input rebuilds
   everything downstream of it.

## Open questions

None block 31a or 31b. The following are recorded so the plan does not silently
decide them:

- Whether the spreadsheet update callers should be moved from a fresh
  `readWorldState` to the shared view, so their spread writes hit the reuse
  path, is a follow-on that trades working-copy independence for fewer
  rebuilds; it needs its own ownership analysis.
- Whether `relations` and `agreements` reuse can be proven safe from the
  identity index's actual inputs, so a diplomacy-heavy world stops rebuilding
  them, is deferred with the index analysis above.
