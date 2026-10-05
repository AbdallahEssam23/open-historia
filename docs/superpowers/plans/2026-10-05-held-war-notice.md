# Held War Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the player a short transient notice when the engine withheld a war record because the player's own peace offer is pending, so the war they still see is explained rather than silently unchanged.

**Architecture:** A pure, import-free `src/runtime/warHoldNotice.js` holds the event name and the message builder. `applySimulationResult` in `src/Game/AI/gameplay.js` dispatches a `CustomEvent` when `warMerge.withheldIds` is non-empty, beside the receipt note and debug log it already writes. A small toast `src/Game/GameUI/warHoldNotice.jsx`, mounted in `main.jsx` beside `FallbackSwitchNotice`, listens for that event. Nothing new is persisted.

**Tech Stack:** Node.js ESM, `node --test`, React 18 (JSX), Vite for the build.

## Global Constraints

- Pure core `src/engine/**` is untouched this increment.
- `src/runtime/**` must never import a `src/Game/AI/**` module. The reverse
  import (Game/AI or GameUI reading a runtime helper) is allowed.
- Only ASCII in every added line. No emoji, no em dash, no middle dot. The
  toast icon must be ASCII.
- No new dependency in `package.json`. No `ENGINE_VERSION` bump. No migration.
- Every commit is conventional and carries the trailer
  `Co-authored-by: monkeycode-ai <monkeycode-ai@chaitin.com>`. The
  `prepare-commit-msg` hook appends it: never pass it with `-m`.
- Tests run with globs, never a directory: `node --test "src/runtime/*.test.js"`,
  `node --test "src/Game/GameUI/*.test.js"`, `node --test "src/engine/*.test.js"`.
- Do not weaken an existing test to pass.
- `src/Game/AI/gameplay.js` imports `./main.jsx`, and `.jsx` cannot be imported
  under `node --test`, so both wirings are pinned by source-text architecture
  tests plus `node --check`.
- The hold itself and the receipt note are unchanged; this increment only adds a
  notice.

---

### Task 1: The pure held-war notice

**Files:**
- Add: `src/runtime/warHoldNotice.js`
- Add: `src/runtime/warHoldNotice.test.js`

**Interfaces:**
- Consumes: nothing; the module imports nothing.
- Produces: `WAR_HELD_EVENT` (the string `"oh:war-held"`) and
  `buildWarHoldNotice({ warIds })`, a string: `""` when there are no ids,
  otherwise a one-sentence, player-facing notice naming the held war(s).

- [ ] **Step 1: Write the failing test**

Create `src/runtime/warHoldNotice.test.js`:

```js
// Run: node --test src/runtime/warHoldNotice.test.js
import test from "node:test";
import assert from "node:assert/strict";

import { WAR_HELD_EVENT, buildWarHoldNotice } from "./warHoldNotice.js";

test("no ids is no notice", () => {
  assert.equal(buildWarHoldNotice(), "");
  assert.equal(buildWarHoldNotice({}), "");
  assert.equal(buildWarHoldNotice({ warIds: [] }), "");
  assert.equal(buildWarHoldNotice({ warIds: ["  ", "", null] }), "");
  assert.equal(buildWarHoldNotice({ warIds: "not-an-array" }), "");
});

test("one held war reads in the singular", () => {
  const notice = buildWarHoldNotice({ warIds: ["war-france-1914"] });
  assert.match(notice, /^The war war-france-1914 stays open:/);
  assert.match(notice, /until you decide the pending peace offer\.$/);
});

test("several held wars read in the plural and keep their order", () => {
  const notice = buildWarHoldNotice({ warIds: ["war-a", " war-b ", ""] });
  assert.match(notice, /^The wars war-a, war-b stay open:/);
  assert.match(notice, /pending peace offers\.$/);
});

test("the event name is the exact contract string", () => {
  assert.equal(WAR_HELD_EVENT, "oh:war-held");
  const notice = buildWarHoldNotice({ warIds: ["war-a"] });
  assert.equal(/[^\x00-\x7F]/.test(notice), false, "the notice is ASCII only");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/runtime/warHoldNotice.test.js"`
Expected: FAIL, the module `./warHoldNotice.js` cannot be found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/runtime/warHoldNotice.js`:

```js
/*! Open Historia - the notice that the engine held a war open (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/runtime/warHoldNotice.test.js
//
// When the model writes a record that would close the player's offered war, the
// turn validator refuses it and applyWarUpdates withholds it (withheldIds). The
// receipt records that for the model; this renders the same fact for the player
// as one short sentence. It imports nothing, so it runs under node --test.

// The emitter (Game/AI) and the listener (GameUI) share this one name.
export const WAR_HELD_EVENT = "oh:war-held";

export const buildWarHoldNotice = ({ warIds = [] } = {}) => {
  const ids = (Array.isArray(warIds) ? warIds : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!ids.length) return "";
  const list = ids.join(", ");
  if (ids.length === 1) {
    return `The war ${list} stays open: the engine is holding back a record that would close it until you decide the pending peace offer.`;
  }
  return `The wars ${list} stay open: the engine is holding back records that would close them until you decide the pending peace offers.`;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test "src/runtime/warHoldNotice.test.js"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/warHoldNotice.js src/runtime/warHoldNotice.test.js
git commit -m "feat(runtime): render the held war as a player notice"
```

---

### Task 2: Dispatch the notice from the turn

**Files:**
- Modify: `src/Game/AI/gameplay.js` (import after the `../../runtime/warFacts.js` import at ~306; the withheld block in `applySimulationResult` at ~7013-7020)
- Add: `src/Game/GameUI/warHoldNoticeArchitecture.test.js`

**Interfaces:**
- Consumes: `WAR_HELD_EVENT` and `buildWarHoldNotice` from Task 1; `warMerge.withheldIds` (already in scope).
- Produces: no new export. A turn that withholds a record dispatches
  `WAR_HELD_EVENT` on `window` with `detail: { message, warIds }`.

- [ ] **Step 1: Write the failing guard test**

Create `src/Game/GameUI/warHoldNoticeArchitecture.test.js`:

```js
// Run: node --test src/Game/GameUI/warHoldNoticeArchitecture.test.js
//
// gameplay.js imports main.jsx and cannot be imported by node --test, so its
// wiring is pinned by reading the source. This is the house pattern for the
// other wiring architecture guards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const gameplay = read("../../Game/AI/gameplay.js");

test("the turn announces a held war once, before the peace offer is kept", () => {
  assert.match(gameplay, /import \{ buildWarHoldNotice, WAR_HELD_EVENT \} from "\.\.\/\.\.\/runtime\/warHoldNotice\.js"/);
  const call = "dispatchEvent(new CustomEvent(WAR_HELD_EVENT";
  assert.equal(gameplay.split(call).length - 1, 1, "the held-war notice is dispatched exactly once");
  const applyAt = gameplay.indexOf("const applySimulationResult =");
  const keepAt = gameplay.indexOf("const peaceOffer = keepHeldPeaceOffer");
  const callAt = gameplay.indexOf(call);
  assert.ok(applyAt > 0 && keepAt > applyAt, "the apply span is missing");
  assert.ok(callAt > applyAt && callAt < keepAt, "the notice must fire on the turn that withheld the record");
  assert.match(gameplay, /buildWarHoldNotice\(\{ warIds: heldWarIds \}\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/GameUI/warHoldNoticeArchitecture.test.js"`
Expected: FAIL, the import, the builder call and the dispatch are absent.

- [ ] **Step 3: Import the builder and event name**

In `src/Game/AI/gameplay.js`, immediately after
`import { buildWarFactsDirective } from "../../runtime/warFacts.js";` add:

```js
import { buildWarHoldNotice, WAR_HELD_EVENT } from "../../runtime/warHoldNotice.js";
```

- [ ] **Step 4: Dispatch beside the existing hold log**

In `applySimulationResult`, replace:

```js
  if (normalizeArray(warMerge.withheldIds).length) {
    logDebugEvent("turn", `Held war operations awaiting the player's peace decision: ${normalizeArray(warMerge.withheldIds).join(", ")}.`);
  }
```

with:

```js
  if (normalizeArray(warMerge.withheldIds).length) {
    logDebugEvent("turn", `Held war operations awaiting the player's peace decision: ${normalizeArray(warMerge.withheldIds).join(", ")}.`);
    // The player sees the war still on the map but not why. Say it, once per
    // turn that actually withheld a record; the offer itself is the durable
    // fact and this notice is transient.
    const heldWarIds = normalizeArray(warMerge.withheldIds);
    const message = buildWarHoldNotice({ warIds: heldWarIds });
    if (message && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(WAR_HELD_EVENT, { detail: { message, warIds: heldWarIds } }));
    }
  }
```

Do not change the receipt loop above it, and do not change `applyWarUpdates`.

- [ ] **Step 5: Verify the guard passes and the file parses**

Run: `node --test "src/Game/GameUI/warHoldNoticeArchitecture.test.js"`
Expected: PASS, 1 test.

Run: `node --check src/Game/AI/gameplay.js`
Expected: no output (syntax OK).

- [ ] **Step 6: Commit**

```bash
git add src/Game/AI/gameplay.js src/Game/GameUI/warHoldNoticeArchitecture.test.js
git commit -m "feat(ai): announce the held war when the turn lands"
```

---

### Task 3: The toast and its mount

**Files:**
- Add: `src/Game/GameUI/warHoldNotice.jsx`
- Modify: `src/Game/GameUI/main.jsx` (import beside `FallbackSwitchNotice` at ~32; mount beside `<FallbackSwitchNotice />` at ~695)
- Modify: `src/Game/GameUI/warHoldNoticeArchitecture.test.js`

**Interfaces:**
- Consumes: `WAR_HELD_EVENT` from Task 1; the `CustomEvent` from Task 2.
- Produces: `WarHoldNotice`, a React component that renders at most three
  transient notices and nothing else.

- [ ] **Step 1: Extend the failing guard test**

Append to `src/Game/GameUI/warHoldNoticeArchitecture.test.js`:

```js
test("the shell mounts the held-war notice", () => {
  const shell = read("./main.jsx");
  assert.match(shell, /import \{ WarHoldNotice \} from "\.\/warHoldNotice\.jsx"/);
  assert.match(shell, /<WarHoldNotice \/>/);
});

test("the held-war notice listens for the event and dismisses itself", () => {
  const view = read("./warHoldNotice.jsx");
  assert.match(view, /import \{ WAR_HELD_EVENT \} from "\.\.\/\.\.\/runtime\/warHoldNotice\.js"/);
  assert.match(view, /addEventListener\(WAR_HELD_EVENT/);
  assert.match(view, /removeEventListener\(WAR_HELD_EVENT/);
  assert.match(view, /event\.detail\?\.message/);
  assert.match(view, /const SHOW_MS = \d+/);
  assert.match(view, /setTimeout\(/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "src/Game/GameUI/warHoldNoticeArchitecture.test.js"`
Expected: FAIL on the two new tests: no mount and no component file.

- [ ] **Step 3: Write the toast**

Create `src/Game/GameUI/warHoldNotice.jsx`, modeled on
`fallbackSwitchNotice.jsx`:

```jsx
/*! Open Historia - the notice that the engine held a war open (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine withholds a record that would close the player's offered war, so
// the war stays on the map. The turn's receipt says so for the model; this says
// it once for the player, as the turn lands. It is transient by design: the
// durable fact is world.peaceOffer, which the peace panel already shows.

import React, { useEffect, useState } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { WAR_HELD_EVENT } from "../../runtime/warHoldNotice.js";

const SHOW_MS = 14000;

const noticeStyle = {
  position: "fixed",
  top: "4.25rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 9999,
  display: "flex",
  alignItems: "flex-start",
  gap: "0.6rem",
  maxWidth: "min(34rem, calc(100vw - 2rem))",
  padding: "0.6rem 0.8rem",
  borderRadius: "12px",
  border: "1px solid rgba(250,204,21,0.32)",
  backgroundColor: "rgba(24,20,10,0.96)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#fde68a",
  fontFamily: "var(--oh-font-ui)",
  fontSize: "0.76rem",
  lineHeight: 1.45,
  pointerEvents: "auto",
};

// On a phone the notice drops below the game-menu button, as the fallback
// notice does.
const phoneNoticeStyle = {
  top: "4.75rem",
  width: "max-content",
};

export const WarHoldNotice = () => {
  const [notices, setNotices] = useState([]); // [{ id, message }]
  const isMobile = useIsMobile();

  useEffect(() => {
    const timers = new Set();
    const onHeld = (event) => {
      const message = String(event.detail?.message ?? "").trim();
      if (!message) return;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setNotices((current) => [...current.filter((notice) => notice.message !== message), { id, message }].slice(-3));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setNotices((current) => current.filter((notice) => notice.id !== id));
      }, SHOW_MS);
      timers.add(timer);
    };
    window.addEventListener(WAR_HELD_EVENT, onHeld);
    return () => {
      window.removeEventListener(WAR_HELD_EVENT, onHeld);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (!notices.length) return null;
  return (
    <div role="status" aria-live="polite" style={{ ...noticeStyle, flexDirection: "column", ...(isMobile ? phoneNoticeStyle : null) }}>
      {notices.map((notice) => (
        <div key={notice.id} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", width: "100%" }}>
          <span aria-hidden="true" style={{ color: "#facc15", fontWeight: 800 }}>!</span>
          <span style={{ flex: 1 }}>{notice.message}</span>
          <button
            type="button"
            className="oh-tap"
            aria-label="Dismiss"
            onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
};

export default WarHoldNotice;
```

- [ ] **Step 4: Mount it in the shell**

In `src/Game/GameUI/main.jsx`, after
`import { FallbackSwitchNotice } from "./fallbackSwitchNotice.jsx";` add:

```js
import { WarHoldNotice } from "./warHoldNotice.jsx";
```

and after `<FallbackSwitchNotice />` add:

```jsx
      <WarHoldNotice />
```

- [ ] **Step 5: Verify the guards pass and the file parses**

Run: `node --test "src/Game/GameUI/warHoldNoticeArchitecture.test.js"`
Expected: PASS, 3 tests.

Run: `npx eslint src/Game/GameUI/warHoldNotice.jsx src/Game/GameUI/main.jsx`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/Game/GameUI/warHoldNotice.jsx src/Game/GameUI/main.jsx src/Game/GameUI/warHoldNoticeArchitecture.test.js
git commit -m "feat(ui): show the held war as a transient notice"
```

---

### Task 4: Document the notice

**Files:**
- Modify: `docs/runtime-services.md` (the `| Peace offer |` row at line ~29; a paragraph after the peace-offer section ending at ~line 379)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing.

- [ ] **Step 1: Extend the table row**

Replace the `| Peace offer | ... |` row's consumer column so it names the notice too:

```markdown
| Peace offer | `src/runtime/peaceOffer.js` | chooses and normalizes the peace the engine offers the player on their own due war (the interactive-peace increment) | `src/Game/AI/gameplay.js` (the turn), `src/Game/GameUI/peaceOffer.jsx`, with a held-war notice from `src/runtime/warHoldNotice.js` |
```

- [ ] **Step 2: Add a paragraph after the peace-offer section**

After the paragraph that ends `...the casus verdict it already printed.`, insert:

```markdown
When the model writes a record that would close the player's offered war, the
engine withholds it and the war stays open. `src/runtime/warHoldNotice.js` names
the event (`oh:war-held`) and renders the fact as one short sentence;
`applySimulationResult` dispatches it when `withheldIds` is non-empty, beside the
receipt note and the debug log it already writes; and the toast
`src/Game/GameUI/warHoldNotice.jsx`, mounted in the shell, shows it and
auto-dismisses. Nothing new is stored: the durable fact is `world.peaceOffer`,
which the panel already shows, and the notice explains it for the turn it lands.
```

- [ ] **Step 3: Check the wiki freshness and commit**

Run: `npm run wiki:check`
Expected: `Wiki is current.`

```bash
git add docs/runtime-services.md
git commit -m "docs(runtime): note the held-war notice"
```

---

### Task 5: Whole-suite gate

**Files:**
- None (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: 0 failures. The baseline before this increment was 3027 tests, 3025
pass, 0 fail, 2 todo; this increment adds the new tests and must not lose any.
If a network-based test flakes (`server/appUpdate.test.js` is a known flake),
re-run once and record it.

- [ ] **Step 2: Engine purity**

Run: `node --test "src/engine/*.test.js"`
Expected: all pass (the pure core is untouched).

- [ ] **Step 3: Runtime and wiring tests**

Run: `node --test "src/runtime/*.test.js"`
Expected: all pass, including `warHoldNotice.test.js`.

Run: `node --test "src/Game/GameUI/warHoldNoticeArchitecture.test.js"`
Expected: all pass.

- [ ] **Step 4: Lint the changed files**

Run: `npx eslint src/runtime/warHoldNotice.js src/runtime/warHoldNotice.test.js src/Game/AI/gameplay.js src/Game/GameUI/warHoldNotice.jsx src/Game/GameUI/main.jsx src/Game/GameUI/warHoldNoticeArchitecture.test.js`
Expected: 0 errors (pre-existing warnings in unrelated regions are acceptable).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Record the gate**

Write the exact counts and any flake to `.superpowers/sdd/progress.md`. No
commit for this step unless a change was needed.
