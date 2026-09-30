# Scripted Events With Declared Impacts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: executed.** All nine tasks are implemented and committed (`db5d7bf`, `3f0a4b6`, `e4b4b8b`, `c7cb608`, `688f777`, `139634c`, `dd77ddd`). Two places were built differently from the plan below, both recorded under **Known deviation** at the end: the builder discovered its own region suggestions instead of `libraryBar.jsx` passing them, and it offers a one-line "add impact" field that parses with the engine's own `parseImpactLine` rather than a raw-text-only add path. The final suite is 2424 tests, 2422 pass, 0 fail, 2 todo; `npx eslint .` still reports only the 18 pre-existing `no-empty` errors.

**Goal:** Let a scenario author declare the engine's eight `impacts` families for a scripted history beat, and have the engine apply them on the beat's exact date whatever the model writes.

**Architecture:** A pure text parser turns indented impact lines under a scripted beat into an `impacts` object. The segment validator strips the model's impacts from an author beat, then resolves and stamps the author's own impacts after validation succeeds, reusing the existing resolvers with a new `allowModel: false` mode so no AI request is spent.

**Tech Stack:** JavaScript (ES modules), React 19 JSX, `node:test` + `node:assert/strict`. No TypeScript, no bundler config changes.

## Global Constraints

- `npm test` is `node --test "server/**/*.test.js" "src/**/*.test.js"`. Baseline before this work: 2407 tests, 2405 pass, 2 todo, 0 fail.
- `npx eslint .` baseline: 18 pre-existing `no-empty` errors (10 `Nations.jsx`, 4 `ownershipFloodCustomLayer.js`, 3 `polityTextCustomLayer.js`, 1 `PolityTextLayer.jsx`). No new errors.
- ASCII only in source and docs. No emojis, no em dashes.
- `src/Game/AI/worldDirection.js` is **import-free** (header comment line 15). Keep it that way: no imports added.
- User-facing UI strings follow the existing plain-text style; author content stays `data-no-translate`.
- Do not change `beatIsWritten` semantics, `scriptedBeatsInSpan`, or the meaning of `scriptedEventFor`'s default `impacts: {}`.
- Every existing test must keep passing; the existing assertion `assert.deepEqual(engineWrote.impacts, {})` in `worldDirection.test.js:180` must still hold.

## File Structure

| File | Responsibility |
|---|---|
| `src/Game/AI/worldDirection.js` (modify) | Beat parser gains impact lines; verb table; serializer; `beatEventIndex`. Still import-free. |
| `src/Game/AI/worldDirection.test.js` (modify) | Parser, serializer and event-matching tests. |
| `src/runtime/scriptedImpacts.js` (create) | Pure helpers that map beats to target events and move resolved impacts in and out. No React, no I/O. |
| `src/runtime/scriptedImpacts.test.js` (create) | Tests for the pure helpers. |
| `src/Game/AI/gameplay.js` (modify) | `allowModel` option on the resolvers; Stage A strip and Stage B stamp in the segment validator; receipt text. |
| `server/gameFeatures.js` (modify) | `maxLength` 8000 to 20000; declarative `editor: "scriptedEvents"` key. |
| `src/Game/GameUI/ScriptedEventsBuilder.jsx` (create) | The visual builder. |
| `src/Game/GameUI/FeaturesSectionEditor.jsx` (modify) | Render the builder when a text setting declares it. |
| `src/Game/GameUI/libraryBar.jsx` (modify) | Pass region suggestions into `FeaturesSectionEditor`. |
| `docs/ai-overview.md`, `docs/game-ui.md`, `wiki/tools/editor.md` (modify) | Documentation. |

---

### Task 1: The impact-line parser

**Files:**
- Modify: `src/Game/AI/worldDirection.js` (append after `parseScriptedEvents`, which ends at line 127)
- Test: `src/Game/AI/worldDirection.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `IMPACT_VERBS: Set<string>` — the recognised first tokens.
  - `emptyImpacts(): object` — the eight families, each `[]`.
  - `parseImpactLine(line: string): { impacts: object | null, error: string | null }` — one verb plus its fields, or `impacts: null` with a reason.
  - `parseImpactBlock(lines: string[]): { impacts: object, errors: string[] }` — folds many lines; the `impacts` object always has the eight families.

No React, no imports. Reuse the file-local `asArray` and `asText` helpers.

- [x] **Step 1: Write the failing test**

Add to `src/Game/AI/worldDirection.test.js` after the existing scripted-events tests (after line 182, the `ensureScriptedEvents` test). First extend the import block at the top with the new names:

```js
    parseImpactLine,
    parseImpactBlock,
    IMPACT_VERBS,
```

Then append:

```js
test("an impact line is a verb, its subject and its fields", () => {
    assert.deepEqual(parseImpactLine("transfer Sarajevo -> Austria-Hungary").impacts.regionTransfers,
        [{ regionName: "Sarajevo", toCode: "Austria-Hungary" }]);
    assert.deepEqual(parseImpactLine("control Belgium -> Germany note=blitz").impacts.regionControlOps,
        [{ op: "control", regionName: "Belgium", toCode: "Germany", note: "blitz" }]);
    assert.deepEqual(parseImpactLine("contest Donbas by Ukraine").impacts.regionControlOps,
        [{ op: "contest", regionName: "Donbas", actorCode: "Ukraine" }]);
    assert.deepEqual(parseImpactLine("clear Donbas from Russia").impacts.regionControlOps,
        [{ op: "clear_contest", regionName: "Donbas", claimantCode: "Russia" }]);
    assert.deepEqual(parseImpactLine("claim Bosnia by Serbia").impacts.regionClaims,
        [{ regionName: "Bosnia", claimantCode: "Serbia" }]);
    assert.deepEqual(parseImpactLine("unclaim Bosnia by Serbia").impacts.regionClaims,
        [{ regionName: "Bosnia", claimantCode: "Serbia", drop: true }]);
    assert.deepEqual(parseImpactLine("polity create Poland name=Polish Republic").impacts.polityChanges,
        [{ operation: "create", code: "Poland", name: "Polish Republic" }]);
    assert.deepEqual(parseImpactLine('unit spawn "1st Army" owner=Germany type=armor strength=90 at="western Poland"').impacts.unitOps,
        [{ op: "spawn", unit: { name: "1st Army", ownerCode: "Germany", type: "armor", strength: 90, at: "western Poland" } }]);
    assert.deepEqual(parseImpactLine("unit move unit-3 at=Krakow").impacts.unitOps,
        [{ op: "move", unitId: "unit-3", at: "Krakow" }]);
    assert.deepEqual(parseImpactLine('marker build "Fort X" kind=fort at=Krakow').impacts.markerOps,
        [{ op: "build", marker: { name: "Fort X", kind: "fort", at: "Krakow" } }]);
    assert.deepEqual(parseImpactLine("project complete Bridge").impacts.projectOps,
        [{ op: "complete", name: "Bridge" }]);
    assert.deepEqual(parseImpactLine("chat Serbia, Russia title=Terms").impacts.createdChats,
        [{ countries: ["Serbia", "Russia"], title: "Terms" }]);
});

test("an impact line that cannot be read is dropped, with a reason", () => {
    assert.equal(parseImpactLine("teleport Sarajevo -> Mars").impacts, null);
    assert.match(parseImpactLine("teleport Sarajevo -> Mars").error, /unknown verb/i);
    assert.equal(parseImpactLine("transfer Sarajevo").impacts, null);
    assert.match(parseImpactLine("transfer Sarajevo").error, /->/);
    assert.equal(parseImpactLine("unit explode unit-1").impacts, null);
    assert.match(parseImpactLine("unit explode unit-1").error, /unknown operation/i);
    assert.equal(parseImpactLine("").impacts, null);
});

test("a block keeps the lines it could read and lists the ones it could not", () => {
    const { impacts, errors } = parseImpactBlock([
        "transfer Sarajevo -> Austria-Hungary",
        "teleport Sarajevo -> Mars",
        "claim Bosnia by Serbia",
    ]);
    assert.equal(impacts.regionTransfers.length, 1);
    assert.equal(impacts.regionClaims.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /teleport/);
    assert.deepEqual(Object.keys(impacts).sort(), [
        "createdChats", "markerOps", "polityChanges", "projectOps",
        "regionClaims", "regionControlOps", "regionTransfers", "unitOps",
    ]);
});

test("the verb table is what the parser accepts", () => {
    for (const verb of ["transfer", "control", "contest", "clear", "claim", "unclaim", "polity", "unit", "marker", "project", "chat"]) {
        assert.equal(IMPACT_VERBS.has(verb), true, verb);
    }
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/worldDirection.test.js`
Expected: FAIL, `parseImpactLine is not a function` (or a SyntaxError-free import failure naming the missing export).

- [x] **Step 3: Write the minimal implementation**

Append to `src/Game/AI/worldDirection.js` (after `parseScriptedEvents`, before `scriptedBeatsInSpan`). The eight arrays are the only keys, in the engine's order:

```js
// --- Scripted-event impacts ---
//
// An author's beat may say what it CHANGES, not only what happens: the indented
// lines under a beat line each name one engine impact. The verbs and their field
// names are the ones the model's impacts already use (gameplayPrompts.js), so
// nothing downstream learns a second vocabulary.

export const IMPACT_FAMILIES = Object.freeze([
    "regionTransfers",
    "regionControlOps",
    "regionClaims",
    "polityChanges",
    "unitOps",
    "markerOps",
    "createdChats",
    "projectOps",
]);

export const emptyImpacts = () => Object.fromEntries(IMPACT_FAMILIES.map((family) => [family, []]));

const VERB_FAMILY = Object.freeze({
    transfer: "regionTransfers",
    control: "regionControlOps",
    contest: "regionControlOps",
    clear: "regionControlOps",
    claim: "regionClaims",
    unclaim: "regionClaims",
    polity: "polityChanges",
    unit: "unitOps",
    marker: "markerOps",
    project: "projectOps",
    chat: "createdChats",
});

export const IMPACT_VERBS = new Set(Object.keys(VERB_FAMILY));

const NUMERIC_FIELDS = new Set(["strength", "population", "progress", "reputation", "intelligence"]);
const BOOLEAN_FIELDS = new Set(["wholeCountry", "drop"]);
const LIST_FIELDS = new Set(["aliases", "tags"]);

// Whitespace-separated, honouring double quotes with \" inside them.
const tokenize = (line) => {
    const tokens = [];
    let current = "";
    let quoted = false;
    let started = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "\\" && line[index + 1] === '"') { current += '"'; index += 1; continue; }
        if (char === '"') { quoted = !quoted; started = true; continue; }
        if (!quoted && /\s/.test(char)) {
            if (started || current) tokens.push(current);
            current = ""; started = false; continue;
        }
        current += char;
        started = true;
    }
    if (quoted) return null;
    if (started || current) tokens.push(current);
    return tokens;
};

const coerceField = (key, value) => {
    if (value === "") return { error: `the field "${key}" has no value` };
    if (BOOLEAN_FIELDS.has(key)) {
        if (value === "true") return { value: true };
        if (value === "false") return { value: false };
        return { error: `the field "${key}" is true or false` };
    }
    if (NUMERIC_FIELDS.has(key)) {
        if (!/^-?\d+(\.\d+)?$/.test(value)) return { error: `the field "${key}" is a number` };
        return { value: Number(value) };
    }
    if (LIST_FIELDS.has(key)) return { value: value.split(",").map((part) => part.trim()).filter(Boolean) };
    return { value };
};

const fieldsOf = (tokens) => {
    const fields = {};
    for (const token of tokens) {
        const at = token.indexOf("=");
        if (at <= 0) return { error: `"${token}" is not a field=value pair` };
        const key = token.slice(0, at);
        const sized = coerceField(key, token.slice(at + 1));
        if (sized.error) return { error: sized.error };
        fields[key] = sized.value;
    }
    return { fields };
};

export const parseImpactLine = (line) => {
    const raw = asText(line);
    if (!raw) return { impacts: null, error: "an impact line is empty" };
    const tokens = tokenize(raw);
    if (!tokens || !tokens.length) return { impacts: null, error: "an impact line is empty" };
    const [verb, second, third, fourth, ...rest] = tokens;
    const family = VERB_FAMILY[verb];
    if (!family) return { impacts: null, error: `unknown verb "${verb}"` };
    const impacts = emptyImpacts();

    const take = (from) => {
        const sized = fieldsOf(from);
        return sized.error ? { error: sized.error } : { fields: sized.fields };
    };
    const need = (value, message) => (value ? null : message);

    if (verb === "transfer" || verb === "control") {
        const missing = need(second, `"${verb}" needs a region`) || need(third === "->", `"${verb}" needs "->"`)
            || need(fourth, `"${verb}" needs the receiving polity after "->"`);
        if (missing) return { impacts: null, error: missing };
        const sized = take([second, third, fourth, ...rest].filter((token) => token !== "->"));
        if (sized.error) return { impacts: null, error: sized.error };
        const { regionName, toCode, wholeCountry, fromCode, note } = sized.fields;
        const entry = { regionName: regionName || second, toCode: toCode || fourth, ...(fromCode ? { fromCode } : {}), ...(wholeCountry === true ? { wholeCountry: true } : {}), ...(note ? { note } : {}) };
        impacts[family].push(verb === "control" ? { op: "control", ...entry } : entry);
        return { impacts, error: null };
    }

    if (verb === "contest" || verb === "clear" || verb === "claim" || verb === "unclaim") {
        const marker = verb === "clear" ? "from" : "by";
        const missing = need(second, `"${verb}" needs a region`) || need(third === marker, `"${verb}" needs "${marker}"`)
            || need(fourth, `"${verb}" needs a polity after "${marker}"`);
        if (missing) return { impacts: null, error: missing };
        const sized = take([second, third, fourth, ...rest].filter((token) => token !== marker));
        if (sized.error) return { impacts: null, error: sized.error };
        const { regionName, note } = sized.fields;
        const who = sized.fields.claimantCode || sized.fields.actorCode || fourth;
        if (verb === "claim") impacts.regionClaims.push({ regionName: regionName || second, claimantCode: who, ...(note ? { note } : {}) });
        else if (verb === "unclaim") impacts.regionClaims.push({ regionName: regionName || second, claimantCode: who, drop: true, ...(note ? { note } : {}) });
        else if (verb === "contest") impacts.regionControlOps.push({ op: "contest", regionName: regionName || second, actorCode: who, ...(note ? { note } : {}) });
        else impacts.regionControlOps.push({ op: "clear_contest", regionName: regionName || second, claimantCode: who, ...(note ? { note } : {}) });
        return { impacts, error: null };
    }

    const OPERATIONS = {
        polity: ["create", "restore", "update", "rename", "dissolve"],
        unit: ["spawn", "move", "strength", "remove"],
        marker: ["build", "update", "rename", "remove", "population"],
        project: ["create", "update", "milestone", "complete", "cancel", "fail", "remove"],
    };
    if (OPERATIONS[verb]) {
        if (!OPERATIONS[verb].includes(second)) return { impacts: null, error: `"${verb}" has no operation "${second ?? ""}"` };
        const missing = need(third, `"${verb} ${second}" needs a name`);
        if (missing) return { impacts: null, error: missing };
        const sized = take([third, ...rest]);
        if (sized.error) return { impacts: null, error: sized.error };
        const { note, ...fields } = sized.fields;
        if (verb === "polity") impacts.polityChanges.push({ operation: second, code: fields.code || third, ...fields, ...(note ? { note } : {}) });
        else if (verb === "unit") impacts.unitOps.push({ op: second, ...fields, ...(second === "spawn" ? { unit: { name: fields.name || third, ...fields, ...(note ? { note } : {}) } } : {}), ...(note && second !== "spawn" ? { note } : {}) });
        else if (verb === "marker") impacts.markerOps.push({ op: second, ...fields, ...(second === "build" ? { marker: { name: fields.name || third, ...fields, ...(note ? { note } : {}) } } : {}), ...(note && second !== "build" ? { note } : {}) });
        else impacts.projectOps.push({ op: second, name: fields.name || third, ...fields, ...(note ? { note } : {}) });
        return { impacts, error: null };
    }

    // chat
    const sized = take(rest);
    if (sized.error) return { impacts: null, error: sized.error };
    const countries = asArray(second).flatMap((part) => String(part).split(",")).map((part) => part.trim()).filter(Boolean);
    if (!countries.length) return { impacts: null, error: "chat needs at least one country" };
    impacts.createdChats.push({ countries, ...sized.fields });
    return { impacts, error: null };
};

export const parseImpactBlock = (lines) => {
    const impacts = emptyImpacts();
    const errors = [];
    for (const line of asArray(lines)) {
        const { impacts: one, error } = parseImpactLine(line);
        if (error || !one) { errors.push(`${asText(line)} — ${error}`); continue; }
        for (const family of IMPACT_FAMILIES) impacts[family].push(...one[family]);
    }
    return { impacts, errors };
};
```

Note: the `unit`/`marker`/`project`/`polity` field spread is intentionally permissive about extra keys, because the engine's own field shapes carry many optional fields; the validators in Task 5 are the gate.

- [x] **Step 4: Run the test to verify it passes**

Run: `node --test src/Game/AI/worldDirection.test.js`
Expected: PASS, all tests including the new ones.

- [x] **Step 5: Commit**

```bash
git add src/Game/AI/worldDirection.js src/Game/AI/worldDirection.test.js
git commit -m "feat(world-direction): parse declared impacts under a scripted beat"
```

---

### Task 2: Beat parsing and serialization

**Files:**
- Modify: `src/Game/AI/worldDirection.js` (`parseScriptedEvents`, lines 113-127; add the serializer after it)
- Test: `src/Game/AI/worldDirection.test.js`

**Interfaces:**
- Consumes: `parseImpactBlock`, `IMPACT_VERBS`, `emptyImpacts` from Task 1.
- Produces:
  - `parseScriptedEvents(text)` now returns `[{date, title, text, impacts, errors}]`; `errors` is a `string[]`. A beat with no impact lines has `impacts` deep-equal to `emptyImpacts()` and `errors: []`.
  - `serializeScriptedEvents(beats): string` — the inverse, so a parse/serialize round trip is stable.

- [x] **Step 1: Write the failing test**

Extend the import block with `serializeScriptedEvents`, then append:

```js
test("a beat's indented lines become its impacts; the block ends at the next date or a blank line", () => {
    const beats = parseScriptedEvents([
        "1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.",
        "  transfer Sarajevo -> Austria-Hungary",
        "  claim Bosnia by Serbia",
        "",
        "1914-08-04 Germany invades Belgium.",
        "  control Belgium -> Germany note=the Schlieffen plan",
    ].join("\n"));
    assert.equal(beats.length, 2);
    assert.deepEqual(beats[0].impacts.regionTransfers, [{ regionName: "Sarajevo", toCode: "Austria-Hungary" }]);
    assert.deepEqual(beats[0].impacts.regionClaims, [{ regionName: "Bosnia", claimantCode: "Serbia" }]);
    assert.deepEqual(beats[0].errors, []);
    assert.deepEqual(beats[1].impacts.regionControlOps, [{ op: "control", regionName: "Belgium", toCode: "Germany", note: "the Schlieffen plan" }]);
    assert.equal(beats[0].text, "Archduke Franz Ferdinand is assassinated in Sarajevo.");
});

test("a beat with no impacts is exactly what it was, and an unreadable line is reported not fatal", () => {
    const plain = parseScriptedEvents("2014-05-02 Clashes in Odesa leave dozens dead.");
    assert.deepEqual(plain[0].impacts, { regionTransfers: [], regionControlOps: [], regionClaims: [], polityChanges: [], unitOps: [], markerOps: [], createdChats: [], projectOps: [] });
    assert.deepEqual(plain[0].errors, []);
    const broken = parseScriptedEvents("2014-05-02 Clashes in Odesa.\n  teleport Odesa -> Mars");
    assert.equal(broken[0].impacts.regionControlOps.length, 0);
    assert.equal(broken[0].errors.length, 1);
    assert.equal(broken[0].text, "Clashes in Odesa.");
});

test("serializing a parsed text gives the same beats back", () => {
    const text = [
        "1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.",
        "  transfer Sarajevo -> Austria-Hungary",
        '  unit spawn "1st Army" owner=Germany strength=90 at="western Poland"',
        "",
        "1914-08-04 Germany invades Belgium.",
    ].join("\n");
    const again = parseScriptedEvents(serializeScriptedEvents(parseScriptedEvents(text)));
    const first = parseScriptedEvents(text);
    assert.deepEqual(again.map((beat) => beat.date), first.map((beat) => beat.date));
    assert.deepEqual(again.map((beat) => beat.text), first.map((beat) => beat.text));
    assert.deepEqual(again.map((beat) => beat.impacts), first.map((beat) => beat.impacts));
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/worldDirection.test.js`
Expected: FAIL, `serializeScriptedEvents is not a function`, and `beats[0].impacts` undefined.

- [x] **Step 3: Write the implementation**

Replace `parseScriptedEvents` (lines 113-127) with the block-aware version, and add the serializer right after it:

```js
export const parseScriptedEvents = (text) => {
    const beats = [];
    let open = null;
    const close = () => {
        if (!open) return;
        const { impacts, errors } = parseImpactBlock(open.lines);
        open.beat.impacts = impacts;
        open.beat.errors = errors;
        open = null;
    };
    for (const rawLine of asText(text).split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) { close(); continue; }
        if (line.startsWith("#")) continue;
        const match = DATE_AT_START.exec(rawLine);
        if (match && dateKey(match[1]) !== null) {
            close();
            const body = asText(match[2]);
            if (!body) continue;
            // The title is the first sentence, or the whole beat when it is one.
            const sentence = /^(.{12,140}?[.!?])\s/.exec(`${body} `);
            const beat = { date: match[1], title: (sentence ? sentence[1] : body).slice(0, 140).replace(/[.!?]$/, ""), text: body, impacts: emptyImpacts(), errors: [] };
            beats.push(beat);
            open = { beat, lines: [] };
            continue;
        }
        // An impact line: indented, or opened by a verb we know. Anything else
        // is the author's prose and is ignored, exactly as before.
        if (open && (rawLine !== line || IMPACT_VERBS.has(line.split(/\s+/)[0]))) open.lines.push(line);
    }
    close();
    return beats.sort((a, b) => dateKey(a.date) - dateKey(b.date));
};

// The inverse, so the builder can edit cards and write one string back. The
// title is derived (parseScriptedEvents), never stored.
const quote = (value) => {
    const text = String(value ?? "");
    return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
};

const impactLinesFor = (impacts) => {
    const lines = [];
    const push = (line) => lines.push(`  ${line}`);
    for (const entry of asArray(impacts?.regionTransfers)) push(`transfer ${quote(entry.regionName ?? entry.regionId)} -> ${quote(entry.toCode)}${entry.note ? ` note=${quote(entry.note)}` : ""}`);
    for (const entry of asArray(impacts?.regionControlOps)) {
        const op = String(entry.op ?? "control").toLowerCase();
        if (op === "contest") push(`contest ${quote(entry.regionName ?? entry.regionId)} by ${quote(entry.actorCode)}`);
        else if (op === "clear_contest") push(`clear ${quote(entry.regionName ?? entry.regionId)} from ${quote(entry.claimantCode)}`);
        else push(`control ${quote(entry.regionName ?? entry.regionId)} -> ${quote(entry.toCode)}${entry.note ? ` note=${quote(entry.note)}` : ""}`);
    }
    for (const entry of asArray(impacts?.regionClaims)) push(`${entry.drop === true ? "unclaim" : "claim"} ${quote(entry.regionName ?? entry.regionId)} by ${quote(entry.claimantCode)}`);
    for (const entry of asArray(impacts?.polityChanges)) push(`polity ${entry.operation} ${quote(entry.code)}${entry.name ? ` name=${quote(entry.name)}` : ""}${entry.note ? ` note=${quote(entry.note)}` : ""}`);
    for (const entry of asArray(impacts?.unitOps)) {
        const unit = entry.unit && typeof entry.unit === "object" ? entry.unit : entry;
        push(`unit ${entry.op} ${quote(entry.op === "spawn" ? unit.name : entry.unitId)}${unit.ownerCode ? ` owner=${quote(unit.ownerCode)}` : ""}${unit.type ? ` type=${unit.type}` : ""}${Number.isFinite(Number(unit.strength)) ? ` strength=${unit.strength}` : ""}${unit.at ? ` at=${quote(unit.at)}` : ""}`);
    }
    for (const entry of asArray(impacts?.markerOps)) {
        const marker = entry.marker && typeof entry.marker === "object" ? entry.marker : entry;
        push(`marker ${entry.op} ${quote(entry.op === "build" ? marker.name : entry.markerId)}${marker.kind ? ` kind=${marker.kind}` : ""}${marker.at ? ` at=${quote(marker.at)}` : ""}`);
    }
    for (const entry of asArray(impacts?.projectOps)) push(`project ${entry.op} ${quote(entry.name ?? entry.projectId)}`);
    for (const entry of asArray(impacts?.createdChats)) push(`chat ${asArray(entry.countries).map(quote).join(", ")}${entry.title ? ` title=${quote(entry.title)}` : ""}`);
    return lines;
};

export const serializeScriptedEvents = (beats) => {
    const blocks = [];
    const leftovers = [];
    for (const beat of asArray(beats)) {
        blocks.push([`${beat.date} ${beat.text}`, ...impactLinesFor(beat.impacts)].join("\n"));
        for (const error of asArray(beat.errors)) leftovers.push(error.split(" — ")[0]);
    }
    const body = blocks.join("\n\n");
    if (!leftovers.length) return body;
    // After a blank line, so the engine's parser never attaches them to a beat.
    return `${body}\n\n# kept as written: the editor could not read these\n${leftovers.join("\n")}`;
};
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test src/Game/AI/worldDirection.test.js`
Expected: PASS, including the pre-existing test at line 168 (`engineWrote.impacts` deep-equals `{}`) and line 129 (the "no date" line is still ignored).

- [x] **Step 5: Commit**

```bash
git add src/Game/AI/worldDirection.js src/Game/AI/worldDirection.test.js
git commit -m "feat(world-direction): a beat carries its impacts, and writes back to text"
```

---

### Task 3: Find the event a beat belongs to

**Files:**
- Modify: `src/Game/AI/worldDirection.js` (`beatIsWritten`, lines 149-162)
- Test: `src/Game/AI/worldDirection.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `beatEventIndex(beat, events): number` — the index of the event the beat is already written as, or `-1`. `beatIsWritten` becomes `beatEventIndex(beat, events) !== -1`, so its behaviour is byte-for-byte identical.

- [x] **Step 1: Write the failing test**

Add `beatEventIndex` to the import block, then append:

```js
test("the event a beat is written as can be found by index; -1 when it is not written", () => {
    const beat = parseScriptedEvents("2014-05-25 Ukraine holds a presidential election; Petro Poroshenko wins outright.")[0];
    const events = [
        { date: "2014-05-20", title: "Unrelated", description: "Nothing here." },
        { date: "2014-05-26", title: "Poroshenko elected", description: "Petro Poroshenko wins Ukraine's presidential election outright." },
    ];
    assert.equal(beatEventIndex(beat, events), 1);
    assert.equal(beatIsWritten(beat, events), true);
    assert.equal(beatEventIndex(beat, [{ date: "2014-05-25", title: "Fighting", description: "Separatists seize the airport." }]), -1);
    assert.equal(beatEventIndex(beat, []), -1);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test src/Game/AI/worldDirection.test.js`
Expected: FAIL, `beatEventIndex is not a function`.

- [x] **Step 3: Write the implementation**

Replace `beatIsWritten` (lines 149-162) with:

```js
export const SCRIPTED_MATCH_DAYS = 7;
export const beatEventIndex = (beat, events) => {
    const needles = [...words(`${beat?.title} ${beat?.text}`)];
    const beatDay = dayNumber(beat?.date);
    if (!needles.length || beatDay === null) return -1;
    const needed = Math.min(3, Math.max(1, Math.ceil(needles.length / 3)));
    return asArray(events).findIndex((event) => {
        const eventDay = dayNumber(event?.date);
        if (eventDay === null || Math.abs(eventDay - beatDay) > SCRIPTED_MATCH_DAYS) return false;
        const haystack = words(`${event?.title} ${event?.description}`);
        let shared = 0;
        for (const needle of needles) if (haystack.has(needle)) shared += 1;
        return shared >= needed;
    });
};
export const beatIsWritten = (beat, events) => beatEventIndex(beat, events) !== -1;
```

Keep the existing explanatory comment above it.

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test src/Game/AI/worldDirection.test.js`
Expected: PASS, including the three pre-existing `beatIsWritten` assertions.

- [x] **Step 5: Commit**

```bash
git add src/Game/AI/worldDirection.js src/Game/AI/worldDirection.test.js
git commit -m "refactor(world-direction): find a beat's event by index"
```

---

### Task 4: The pure impact-move helpers

**Files:**
- Create: `src/runtime/scriptedImpacts.js`
- Test: `src/runtime/scriptedImpacts.test.js`

**Interfaces:**
- Consumes: `beatEventIndex` from `src/Game/AI/worldDirection.js`.
- Produces:
  - `hasImpacts(impacts): boolean`
  - `authoredImpactTargets(beats, events): {eventIndex, impacts}[]` — one per beat that has impacts and matched an event, in beat order.
  - `withAuthorImpacts(events, targets): object[]` — a new event array where each target event's `impacts` is a deep clone of the author's.
  - `withoutAuthorImpacts(events, targets): object[]` — a new event array where each target event's `impacts` is `{}` (the Stage A strip).
  - `stampResolvedImpacts(events, targets, resolved): object[]` — a new array writing `resolved[i].impacts` onto `targets[i].eventIndex`, falling back to the author's raw impacts when the resolver dropped the event.

- [x] **Step 1: Write the failing test**

Create `src/runtime/scriptedImpacts.test.js`:

```js
/*! Open Historia — scripted-event impacts: tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/runtime/scriptedImpacts.test.js

import test from "node:test";
import assert from "node:assert/strict";

import {
    authoredImpactTargets,
    hasImpacts,
    stampResolvedImpacts,
    withAuthorImpacts,
    withoutAuthorImpacts,
} from "./scriptedImpacts.js";

const beat = (date, text, impacts) => ({ date, title: text, text, impacts, errors: [] });
const empty = () => ({ regionTransfers: [], regionControlOps: [], regionClaims: [], polityChanges: [], unitOps: [], markerOps: [], createdChats: [], projectOps: [] });

test("only a beat that declares impacts and has an event is a target", () => {
    const events = [
        { date: "1914-06-28", title: "Franz Ferdinand is assassinated", description: "Archduke Franz Ferdinand is assassinated in Sarajevo." },
        { date: "1914-08-04", title: "Belgium invaded", description: "Germany invades Belgium." },
    ];
    const beats = [
        beat("1914-06-28", "Archduke Franz Ferdinand is assassinated in Sarajevo.", { ...empty(), regionTransfers: [{ regionName: "Sarajevo", toCode: "Austria-Hungary" }] }),
        beat("1914-08-04", "Germany invades Belgium.", empty()),
    ];
    const targets = authoredImpactTargets(beats, events);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].eventIndex, 0);
    assert.equal(hasImpacts(empty()), false);
    assert.equal(hasImpacts({ ...empty(), unitOps: [{ op: "spawn" }] }), true);
});

test("the model's impacts are stripped and the author's come in without touching the source", () => {
    const events = [
        { date: "1914-06-28", title: "Franz Ferdinand is assassinated", description: "Archduke Franz Ferdinand is assassinated in Sarajevo.", impacts: { regionTransfers: [{ regionName: "Invented" }] } },
        { date: "1914-07-01", title: "Elsewhere", description: "Something else happened.", impacts: { regionTransfers: [] } },
    ];
    const targets = [{ eventIndex: 0, impacts: { ...empty(), regionClaims: [{ regionName: "Bosnia", claimantCode: "Serbia" }] } }];
    const stripped = withoutAuthorImpacts(events, targets);
    assert.deepEqual(stripped[0].impacts, {}, "the model's own impacts are gone");
    assert.deepEqual(events[0].impacts.regionTransfers, [{ regionName: "Invented" }], "the source is not mutated");
    const stamped = withAuthorImpacts(stripped, targets);
    assert.deepEqual(stamped[0].impacts.regionClaims, [{ regionName: "Bosnia", claimantCode: "Serbia" }]);
    stamped[0].impacts.regionClaims.push({ regionName: "X", claimantCode: "Y" });
    assert.equal(targets[0].impacts.regionClaims.length, 1, "the author's object is not shared");
});

test("resolved impacts are written back to their events", () => {
    const events = [{ date: "1914-06-28", description: "x", impacts: {} }, { date: "1914-07-01", description: "y", impacts: {} }];
    const targets = [{ eventIndex: 0, impacts: { ...empty(), regionClaims: [{ regionName: "Bosnia" }] } }];
    const resolved = [{ ...events[0], impacts: { ...empty(), regionClaims: [{ regionName: "Bosnia", regionId: "BA-BIH" }] } }];
    const out = stampResolvedImpacts(events, targets, resolved);
    assert.equal(out[0].impacts.regionClaims[0].regionId, "BA-BIH");
    assert.deepEqual(out[1], events[1]);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test src/runtime/scriptedImpacts.test.js`
Expected: FAIL, cannot resolve `./scriptedImpacts.js`.

- [x] **Step 3: Write the implementation**

Create `src/runtime/scriptedImpacts.js`:

```js
/*! Open Historia — scripted-event impacts: moving an author's declared impacts onto their events © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Pure. The engine applies an author's beat impacts on the beat's exact date,
// whatever the model wrote (worldDirection.js parses them; gameplay.js wires
// them). This module only moves objects in and out of the event list, so the
// staging is testable without a world, a model or a map.

import { beatEventIndex } from "../Game/AI/worldDirection.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clone = (value) => (value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value);

export const hasImpacts = (impacts) => Boolean(impacts)
    && Object.values(impacts).some((list) => Array.isArray(list) && list.length > 0);

// The beats that declare impacts and already have an event: the author's words
// are on the timeline, either the model wrote the beat or the engine did.
export const authoredImpactTargets = (beats, events) => asArray(beats)
    .filter((beat) => hasImpacts(beat?.impacts))
    .map((beat) => ({ eventIndex: beatEventIndex(beat, events), impacts: beat.impacts }))
    .filter((target) => target.eventIndex >= 0);

const replaceAt = (events, from) => {
    const next = asArray(events).slice();
    for (const [index, impacts] of from) next[index] = { ...next[index], impacts: clone(impacts) };
    return next;
};

export const withAuthorImpacts = (events, targets) =>
    replaceAt(events, asArray(targets).map((target) => [target.eventIndex, target.impacts]));

export const withoutAuthorImpacts = (events, targets) =>
    replaceAt(events, asArray(targets).map((target) => [target.eventIndex, {}]));

// What the resolvers left, in target order; a target the resolver dropped keeps
// the author's raw impacts so nothing is silently lost.
export const stampResolvedImpacts = (events, targets, resolved) =>
    replaceAt(events, asArray(targets).map((target, index) => [
        target.eventIndex,
        (asArray(resolved)[index]?.impacts) ?? target.impacts,
    ]));
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test src/runtime/scriptedImpacts.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/runtime/scriptedImpacts.js src/runtime/scriptedImpacts.test.js
git commit -m "feat(runtime): move an author's declared impacts onto their events"
```

---

### Task 5: An `allowModel` mode on the resolvers

**Files:**
- Modify: `src/Game/AI/gameplay.js` (`resolveRegionTransfers` signature line 4229-4235; its semantic pass, lines 5067-5130; `resolveRegionControlOps` signature line 5384 and its call, line 5411-5417; `validateGeneratedWorldChanges` signature lines 5642-5653 and its two resolver calls, lines 5692-5710)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `allowModel` (default `true`) on `resolveRegionTransfers`, `resolveRegionControlOps` and `validateGeneratedWorldChanges`. With `allowModel: false`, the semantic geography pass is never called; a region that the deterministic match could not resolve is left unresolved and reported, never sent to a model.

- [x] **Step 1: Add the option to `resolveRegionTransfers`**

Change the destructure at lines 4229-4235 to add `allowModel = true,`:

```js
const resolveRegionTransfers = async (containers, world, {
  ownershipMode = "sovereignty",
  enforceNarratedCityCoverage = false,
  exactRegionIdsOnly = false,
  explicitScopeText = "",
  requests = null,
  // An author's declared impacts are resolved with the map alone: the model
  // cannot fix an author's data, and asking would be a request they never
  // asked for. Unresolved entries are dropped and reported downstream.
  allowModel = true,
} = {}) => {
```

Then, inside the semantic loop at line 5070, wrap the body so nothing is sent when the model is not allowed. Replace the loop header and its first statement:

```js
  for (let offset = 0; offset < semanticPending.length; offset += resolverBatchSize) {
    const batch = semanticPending.slice(offset, offset + resolverBatchSize);

    // Deterministic geography only: hand every pending item back as unresolved.
    if (!allowModel) {
      for (const record of batch) {
        unresolved.push({
          label: record.label,
          fromCode: normalizeString(record.transfer?.fromCode),
          path: record.path,
          candidates: record.candidates,
          reason: "not resolvable from the map alone",
        });
      }
      continue;
    }
```

(The rest of the loop body stays exactly as it is.)

The `unresolved` array is declared before this loop; confirm its name in the surrounding scope at line 5064-5070 before editing. If the declaration is named differently, use that name.

- [x] **Step 2: Thread it through `resolveRegionControlOps`**

Change the signature line 5384 to add `allowModel = true,`:

```js
const resolveRegionControlOps = async (containers, world, { exactRegionIdsOnly = false, explicitScopeText = "", requests = null, allowModel = true } = {}) => {
```

And pass it at line 5411-5417:

```js
  const unresolved = await resolveRegionTransfers(proxyContainers, world, {
    ownershipMode: "control",
    enforceNarratedCityCoverage: !exactRegionIdsOnly,
    exactRegionIdsOnly,
    explicitScopeText,
    requests,
    allowModel,
  });
```

- [x] **Step 3: Thread it through `validateGeneratedWorldChanges`**

Add `allowModel = true,` to the destructure at lines 5642-5653, then pass it in both resolver calls:

```js
  const unresolvedTransfers = await resolveRegionTransfers(containers, world, {
    ownershipMode: "sovereignty",
    exactRegionIdsOnly: resolvedRegionIdsOnly,
    explicitScopeText,
    requests,
    allowModel,
  });
```

```js
  const unresolvedControlOps = await resolveRegionControlOps(containers, world, {
    exactRegionIdsOnly: resolvedRegionIdsOnly,
    explicitScopeText,
    requests,
    allowModel,
  });
```

- [x] **Step 4: Verify nothing regressed**

Run: `npm test`
Expected: same counts as the baseline (2407 tests, 2405 pass, 2 todo, 0 fail) plus the new Task 1-4 tests.

Run: `npx eslint src/Game/AI/gameplay.js`
Expected: no new errors (the file is not in the 18-error baseline list, so it should be clean).

- [x] **Step 5: Commit**

```bash
git add src/Game/AI/gameplay.js
git commit -m "feat(ai): resolve geography without a model call when asked"
```

---

### Task 6: Wire the author's impacts into the segment validator

**Files:**
- Modify: `src/Game/AI/gameplay.js` (imports near line 278-284; the scripted block, lines 11834-11849)

**Interfaces:**
- Consumes: `authoredImpactTargets`, `withAuthorImpacts`, `withoutAuthorImpacts`, `stampResolvedImpacts` (Task 4); `ensureScriptedEvents` (existing); `validateGeneratedWorldChanges` with `allowModel: false` (Task 5).
- Produces: the segment validator's `candidate.events` carries the author's resolved impacts on acceptance.

- [x] **Step 1: Import the helpers**

Add to the `./worldDirection.js` import block (line 278-284):

```js
  beatEventIndex,
```

And add a new import beside it:

```js
import { authoredImpactTargets, stampResolvedImpacts, withAuthorImpacts, withoutAuthorImpacts } from "../../runtime/scriptedImpacts.js";
```

- [x] **Step 2: Strip the model's impacts and prepare the targets (Stage A)**

Replace the scripted block at lines 11834-11849 with:

```js
          // The author's scripted events (worldDirection.js): one the answer left
          // out is written by the engine, in the author's words, and the model is
          // told so it carries the consequences. An auto jump that stopped short
          // owes only the beats up to where it stopped.
          let authoredTargets = [];
          if (scriptedBeats.length) {
            const stopKey = mode === "auto" ? dateKey(candidate?.stopDate) : null;
            const due = stopKey === null ? scriptedBeats : scriptedBeats.filter((beat) => dateKey(beat.date) <= stopKey);
            const scripted = ensureScriptedEvents(candidate?.events, due);
            if (scripted.inserted.length) {
              candidate.events = scripted.events;
              sortTimelineEventsChronologically(candidate);
            }
            // The author's word is final: the beat's own impacts are the ones
            // that count, so the model's are dropped, and the author's are held
            // back until the model's answer has passed every check. The engine
            // applies them on the beat's date, exempt from the map's tempo by
            // construction: the tempo runs above on the model's impacts only.
            authoredTargets = authoredImpactTargets(due, candidate.events);
            if (authoredTargets.length) candidate.events = withoutAuthorImpacts(candidate.events, authoredTargets);
            if (scripted.inserted.length) {
              for (const beat of scripted.inserted) {
                noteReceipt(draft, "adjusted", `The scripted event of ${beat.date} — "${beat.title}" — was not in your answer, so the engine wrote it in the author's words. It is history in this world: its consequences are yours to carry forward.`);
              }
            }
          }
```

The receipt line loses "with no impacts" because an engine-written beat now carries them.

- [x] **Step 3: Resolve and stamp the author's impacts (Stage B)**

At the end of the same validator function, immediately before its final `return null` (or the last return of the success path in this validator), insert:

```js
          // Stage B: the answer is accepted, so the author's own impacts are
          // resolved against the map and stamped onto their events. Map only —
          // no model call, no extra request — and an unresolvable entry is
          // reported and dropped. Runs after every check, so the author's
          // declared history is what really happened, whatever the model wrote.
          if (authoredTargets.length) {
            const authoredCandidate = { events: withAuthorImpacts(candidate.events, authoredTargets).filter((_, index) => authoredTargets.some((target) => target.eventIndex === index)) };
            await validateGeneratedWorldChanges(authoredCandidate, bundle.world, {
              strictTransfers: false,
              allowModel: false,
              receipt: draft,
            });
            candidate.events = stampResolvedImpacts(candidate.events, authoredTargets, authoredCandidate.events);
          }
          return null;
```

Find the exact success return of the function that contains the scripted block before editing; if it `return`s something else on success, keep that value and put the block immediately before it.

- [x] **Step 4: Verify nothing regressed**

Run: `npm test`
Expected: baseline counts plus the new tests, 0 fail.

Run: `npx eslint src/Game/AI/gameplay.js`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add src/Game/AI/gameplay.js
git commit -m "feat(ai): apply an author's scripted-event impacts on acceptance"
```

---

### Task 7: The setting's cap and the builder flag

**Files:**
- Modify: `server/gameFeatures.js` (the `scriptedEvents` setting, lines 75-83)
- Test: `server/gameFeatures.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `scriptedEvents.maxLength === 20000`; `scriptedEvents.editor === "scriptedEvents"`. No other setting gains an `editor` key.

- [x] **Step 1: Write the failing test**

Append to `server/gameFeatures.test.js`:

```js
test("the scripted-events setting is long enough for impacts and names its builder", () => {
  const direction = FEATURE_DEFINITIONS.find((definition) => definition.key === "worldDirection");
  const scripted = direction.settings.find((setting) => setting.key === "scriptedEvents");
  assert.equal(scripted.maxLength, 20000);
  assert.equal(scripted.editor, "scriptedEvents");
  for (const setting of direction.settings) {
    if (setting.key !== "scriptedEvents") assert.equal(setting.editor, undefined, setting.key);
  }
});
```

Confirm the file already imports `FEATURE_DEFINITIONS` from `./gameFeatures.js`; if not, add it to the existing import.

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test server/gameFeatures.test.js`
Expected: FAIL, `20000 !== 8000`.

- [x] **Step 3: Make the change**

In `server/gameFeatures.js`, change `maxLength: 8000` to `maxLength: 20000` and add `editor: "scriptedEvents",` after `rows: 8`. Update the description to mention impacts, in the author-facing voice:

```js
      Object.freeze({
        key: "scriptedEvents",
        type: "text",
        label: "Scripted events",
        maxLength: 20000,
        rows: 8,
        editor: "scriptedEvents",
        defaultValue: "",
        description: "History that happens on its date whatever else the players do: one event per line, the date first (YYYY-MM-DD, a year before AD 1 with a leading minus), then what happens in your own words. The time skip that covers the date is asked to write it; if it does not, the engine writes it for you, with the impacts you declare. \"1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.\" Indent an impact line under an event to change the world with it: \"  transfer Sarajevo -> Austria-Hungary\".",
      }),
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `node --test server/gameFeatures.test.js server/gameFeaturesPersistence.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/gameFeatures.js server/gameFeatures.test.js
git commit -m "feat(features): room for scripted-event impacts, and a builder flag"
```

---

### Task 8: The visual builder

**Files:**
- Create: `src/Game/GameUI/ScriptedEventsBuilder.jsx`
- Modify: `src/Game/GameUI/FeaturesSectionEditor.jsx` (the text setting branch, lines 87-123)
- Not modified as planned: `src/Game/GameUI/libraryBar.jsx`. The builder reads `getPrimedScenarioRegionCatalog()` itself, so the library bar needs no new prop (see **Known deviation**).

**Interfaces:**
- Consumes: `parseScriptedEvents`, `serializeScriptedEvents`, `IMPACT_FAMILIES` (Tasks 1-2).
- Produces: `<ScriptedEventsBuilder value={string} onChange={(next: string) => void} maxLength={number} suggestions={{regions: string[], polities: string[]}} styles={object} />` (`suggestions` optional; the builder falls back to the primed region catalog).

- [x] **Step 1: Write the builder**

Create `src/Game/GameUI/ScriptedEventsBuilder.jsx`:

```jsx
/*! Open Historia — the Scripted events builder in the scenario and game editors © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { useTouchPrimary } from "../../runtime/mobileUi.js";
import { IMPACT_FAMILIES, parseScriptedEvents, serializeScriptedEvents } from "../AI/worldDirection.js";

// A card view over the same text the setting already holds. The text is the
// source of truth: every edit re-serialises it, and a line the parser could not
// read disables the cards and is kept verbatim by the serialiser. Nothing an
// author typed is ever dropped.
const VERB_FOR_FAMILY = {
  regionTransfers: ["transfer"],
  regionControlOps: ["control", "contest", "clear"],
  regionClaims: ["claim", "unclaim"],
  polityChanges: ["polity create", "polity restore", "polity update", "polity rename", "polity dissolve"],
  unitOps: ["unit spawn", "unit move", "unit strength", "unit remove"],
  markerOps: ["marker build", "marker update", "marker rename", "marker remove", "marker population"],
  projectOps: ["project create", "project update", "project milestone", "project complete", "project cancel", "project fail", "project remove"],
  createdChats: ["chat"],
};

const FAMILY_LABEL = {
  regionTransfers: "Territory",
  regionControlOps: "Control",
  regionClaims: "Claims",
  polityChanges: "Polities",
  unitOps: "Military",
  markerOps: "Structures",
  projectOps: "Projects",
  createdChats: "Chats",
};

const ScriptedEventsBuilder = ({ value, onChange, maxLength = 20000, suggestions = { regions: [], polities: [] }, styles = {} }) => {
  const touch = useTouchPrimary();
  const [raw, setRaw] = React.useState(false);
  const beats = React.useMemo(() => parseScriptedEvents(value), [value]);
  const errors = beats.flatMap((beat, index) => beat.errors.map((text) => ({ beat: index + 1, text })));
  const write = (next) => onChange(serializeScriptedEvents(next));
  const patchBeat = (index, patch) => write(beats.map((beat, at) => (at === index ? { ...beat, ...patch } : beat)));
  const moveBeat = (index, delta) => {
    const next = beats.slice();
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    write(next);
  };
  const row = (active) => ({ ...styles.actionButtonStyle, minHeight: touch ? undefined : "1.7rem", padding: "0 0.55rem", opacity: active ? 1 : 0.45 });

  return (
    <div style={{ marginTop: "0.4rem" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <button type="button" className="oh-tap-row" style={row(raw)} onClick={() => setRaw(!raw)}>{raw ? "Show the cards" : "Edit as raw text"}</button>
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem" }}>{String(value ?? "").length} / {maxLength} characters</span>
      </div>
      {errors.length > 0 && (
        <div style={{ background: "rgba(255,120,120,0.08)", border: "1px solid rgba(255,120,120,0.3)", borderRadius: "12px", marginBottom: "0.6rem", padding: "0.6rem", color: "rgba(255,200,200,0.95)", fontSize: "0.76rem", lineHeight: 1.5 }}>
          The editor could not read {errors.length} line{errors.length === 1 ? "" : "s"}. They are kept as written and ignored by the game. Fix them in the raw text, then the cards come back.
          {errors.map((error, index) => (<div key={index} style={{ marginTop: "0.25rem" }}>Event {error.beat}: {error.text}</div>))}
        </div>
      )}
      {(raw || errors.length > 0) && (
        <textarea
          data-no-translate
          rows={12}
          maxLength={maxLength}
          style={{ ...styles.inputStyle, fontFamily: "inherit", lineHeight: 1.45, minHeight: "8rem", resize: "vertical", width: "100%" }}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {!raw && errors.length === 0 && (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {beats.length === 0 && (<div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.78rem" }}>No events yet.</div>)}
          {beats.map((beat, index) => (
            <div key={`${beat.date}-${index}`} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "0.7rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                <input data-no-translate type="text" style={{ ...styles.inputStyle, width: "9rem" }} value={beat.date} onChange={(event) => patchBeat(index, { date: event.target.value })} />
                <button type="button" className="oh-tap" disabled={index === 0} style={row(index !== 0)} onClick={() => moveBeat(index, -1)}>↑</button>
                <button type="button" className="oh-tap" disabled={index === beats.length - 1} style={row(index !== beats.length - 1)} onClick={() => moveBeat(index, 1)}>↓</button>
                <button type="button" className="oh-tap" style={row(true)} onClick={() => write([...beats.slice(0, index + 1), { ...beat, impacts: undefined, errors: [] }, ...beats.slice(index + 1)])}>Duplicate</button>
                <button type="button" className="oh-tap" style={row(true)} onClick={() => write(beats.filter((_, at) => at !== index))}>Remove</button>
              </div>
              <textarea
                data-no-translate
                rows={2}
                style={{ ...styles.inputStyle, marginTop: "0.4rem", width: "100%" }}
                value={beat.text}
                onChange={(event) => patchBeat(index, { text: event.target.value })}
              />
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.2rem" }}>Title shown in the timeline: {beat.title || "(from the first sentence)"}</div>
              <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}>
                {IMPACT_FAMILIES.flatMap((family) => (beat.impacts?.[family] ?? []).map((entry, entryIndex) => (
                  <div key={`${family}-${entryIndex}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.74rem" }}>{FAMILY_LABEL[family]}</span>
                    <span data-no-translate style={{ fontSize: "0.78rem" }}>{JSON.stringify(entry)}</span>
                    <button type="button" className="oh-tap" style={row(true)} onClick={() => patchBeat(index, { impacts: { ...beat.impacts, [family]: beat.impacts[family].filter((_, at) => at !== entryIndex) } })}>Remove</button>
                  </div>
                )))}
              </div>
              <details style={{ marginTop: "0.5rem" }}>
                <summary style={{ color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "0.76rem" }}>Add an impact</summary>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.3rem" }}>
                  Write the line in the raw text view. Each starts with one of these verbs:
                  {" "}
                  {Object.values(VERB_FOR_FAMILY).flat().join(", ")}.
                </div>
                {suggestions.regions.length > 0 && (
                  <datalist id="scripted-event-regions">{suggestions.regions.map((name) => (<option key={name} value={name} />))}</datalist>
                )}
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScriptedEventsBuilder;
```

The impact editor is a list plus a one-line add field (as built; see **Known deviation**): the add field parses with the engine's own `parseImpactLine`, so no second, parallel parser exists in the UI. A full field-by-field impact form is a follow-up.

- [x] **Step 2: Render it from the features editor**

In `src/Game/GameUI/FeaturesSectionEditor.jsx`, import it at the top:

```jsx
import ScriptedEventsBuilder from "./ScriptedEventsBuilder.jsx";
```

Then, inside the `setting.type === "text"` branch, immediately after the closing `</textarea>` (line 108) and before the `{isGame && (` block, insert:

```jsx
                          {setting.editor === "scriptedEvents" && (
                            <ScriptedEventsBuilder
                              value={shown}
                              maxLength={setting.maxLength || 20000}
                              onChange={(next) => setFeature(definition.key, { [setting.key]: next })}
                              styles={styles}
                            />
                          )}
```

- [x] **Step 3: Pass the region suggestions from the library bar**

**As built:** no `libraryBar.jsx` change. The builder imports `getPrimedScenarioRegionCatalog` from `src/runtime/assets.js` and reads it locally in a `useRegionSuggestions` hook (state seeded on mount, refreshed on the `oh:region-catalog-primed` event), so region autocomplete works wherever the editor is mounted without threading a prop down from the library bar. `suggestions` stays an optional prop for tests or other callers.

- [x] **Step 4: Verify the build and lint**

Run: `npx eslint src/Game/GameUI/ScriptedEventsBuilder.jsx src/Game/GameUI/FeaturesSectionEditor.jsx src/Game/GameUI/libraryBar.jsx`
Expected: no new errors beyond the 10 pre-existing `Nations.jsx` errors (which are in a different file, so this command should be clean).

Run: `npm test`
Expected: baseline counts plus the new tests, 0 fail.

- [x] **Step 5: Commit**

```bash
git add src/Game/GameUI/ScriptedEventsBuilder.jsx src/Game/GameUI/FeaturesSectionEditor.jsx src/Game/GameUI/libraryBar.jsx
git commit -m "feat(ui): a builder for scripted events and their impacts"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/ai-overview.md` (the scripted-events row, line 370; the sentence at line 375)
- Modify: `docs/game-ui.md` (find the Features tab section)
- Modify: `wiki/tools/editor.md`

**Interfaces:**
- Consumes: the finished behaviour of Tasks 1-8.
- Produces: documentation only.

- [x] **Step 1: Update the scripted-events row**

In `docs/ai-overview.md`, replace the tail of the scripted-events row (line 370) so it reads:

```markdown
| Scripted events (`scriptedEvents`, text) | none | The author's history beats, one per line: the date first (`YYYY-MM-DD`, a year before AD 1 with a leading minus), then what happens in the author's words; a `#` line or a line without a date is ignored (`parseScriptedEvents`). **A beat may declare impacts.** The indented lines under it, one engine verb each (`transfer Sarajevo -> Austria-Hungary`, `control`, `contest`, `clear`, `claim`, `unclaim`, `polity create|restore|update|rename|dissolve`, `unit spawn|move|strength|remove`, `marker build|update|rename|remove|population`, `project …`, `chat`), build the same `impacts` object the model writes, and the engine applies them on the beat's exact date. **The author's word is final**: the model's own impacts on that beat are dropped, the author's are exempt from the map's tempo (the tempo runs before the beats are attached), and they are resolved against the map alone with no model call — an unresolvable reference is reported and dropped, never a request. The skip whose span covers a beat's date (`scriptedBeatsInSpan`) is told the beat in its user message beside the receipt (`buildScriptedEventsInstruction`), and the event range grows so each beat has a slot. After the answer, `beatIsWritten` looks for an event within a week of the date sharing enough of the beat's particular words; a beat the answer left out is written by the engine (`ensureScriptedEvents`: the author's words, on the author's date, `kind: "world"`, `notable`, **with the impacts the author declared**). Never a rejection: an author's beat does not depend on the model's mood, and asking again is a request. |
```

And replace line 375 with:

```markdown
Scripted events are typed as lines rather than in the Event Editor's shape, on purpose: the line is what an author writes in a scenario's notes, and the Features tab's builder (`ScriptedEventsBuilder.jsx`) edits the same text as cards, so the format stays copy-pasteable and the community hub keeps round-tripping a plain string.
```

- [x] **Step 2: Document the builder**

In `docs/game-ui.md`, find the Features tab section with `grep -n "Features" docs/game-ui.md` and add under it:

```markdown
**Scripted events** is edited as cards. Each card is a date, the author's text and its declared impacts; the title is shown as the derived first sentence, never stored. An impact line the parser cannot read turns the cards off and shows the raw text instead, and the serialiser keeps those lines verbatim below a `# kept as written` line, so nothing an author typed is ever lost. The scenario's primed region catalog feeds the region suggestions when one is loaded.
```

- [x] **Step 3: Document the format for authors**

In `wiki/tools/editor.md`, add a section with a complete copy-pasteable example:

```markdown
## Scripted events with impacts

An event line is a date and what happens. Add indented lines under it to say what it changes in the world.

```
1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.
  transfer Sarajevo -> Austria-Hungary
  claim Bosnia by Serbia

1914-08-04 Germany invades Belgium.
  control Belgium -> Germany note=the Schlieffen plan opens
  unit spawn "1st Army" owner=Germany type=infantry strength=95 at=near Aachen
```

Values with spaces go in double quotes. The verbs are `transfer`, `control`, `contest`, `clear`, `claim`, `unclaim`, `polity`, `unit`, `marker`, `project` and `chat`; every one takes the same fields the game already uses for that kind of change. A line the game cannot read is ignored, and the builder shows it so you can fix it.
```

Mind the nested fences: use a four-backtick outer fence in the real file if the wiki renderer needs it, or indent the inner block.

- [x] **Step 4: Verify the docs build if one exists**

Run: `node --test server/gameFeatures.test.js`
Expected: PASS (the setting's description is asserted nowhere, so this is a smoke check only).

Run: `git diff --stat`
Expected: only the three doc files changed in this task.

- [x] **Step 5: Commit**

```bash
git add docs/ai-overview.md docs/game-ui.md wiki/tools/editor.md
git commit -m "docs: scripted events with declared impacts"
```

---

## Self-Review

**Spec coverage.**

- All eight impact families and every field: Task 1 (verbs and `key=value` fields, permissive extra keys) + Task 5/6 validators as the gate.
- Author's word is final: Task 6 Stage A strips the model's impacts; Stage B stamps the author's.
- Exempt from the map's tempo: Task 6 relies on the tempo call at line 11822 running before the beats are attached; documented in the code comment there.
- No migration, old text still parses: Task 2 keeps `parseScriptedEvents`' ignore rules and keeps `impacts: {}` semantics.
- Text stays the source of truth, hand-editable, hub-safe: Task 2 serializer, Task 8 builder over the same string.
- Deterministic, rollback-safe, no AI request: Task 4 pure helpers, Task 5 `allowModel: false`.
- Visual builder with diagnostics: Task 8.
- Cap raised to 20000: Task 7.
- Docs: Task 9.
- Out of scope (war/relation/agreement/storyline ledgers, fallback jump path, map picking, live preview): non-goals in the spec, no task, as intended.

**Placeholder scan.** No TBD/TODO. Task 5 Step 1 asks the implementer to confirm the `unresolved` array name in scope, and Task 6 Step 3 asks them to confirm the validator's success return; both name exactly what to look for and what to keep, so no step is left unspecified.

**Type consistency.** `beatEventIndex(beat, events) -> number` is defined in Task 3 and consumed in Task 4. `authoredImpactTargets(beats, events) -> {eventIndex, impacts}[]` in Task 4 is consumed in Task 6. `allowModel` is defined on three functions in Task 5 and used only in Task 6. `suggestions: {regions, polities}` is defined and consumed in Task 8. `setting.editor` is produced in Task 7 and consumed in Task 8.

**Known deviation.** Two deliberate departures, both built and committed. First, the spec says the builder shows a "kept as written" block; Task 8 instead keeps those lines verbatim through the serializer and shows the raw text while any unreadable line exists. Same guarantee (no author text is lost), less UI state. Second, Task 8 added a one-line "add impact" input that folds into a beat through the engine's own `parseImpactLine` (with region autocomplete) instead of a raw-text-only add path, so the common case needs no raw editing; an unreadable line is reported in place and never lost. The builder also discovers its own region suggestions rather than receiving them from `libraryBar.jsx`, so no library-bar change was needed. Recorded here so the reviewer sees them deliberately.
