# The battle receipt tells the model why the battle went as it did

Date: 2026-10-06
Status: approved for implementation

## Problem

The engagement core computes a full tactical breakdown of every battle: the air
edge, the naval edge, the anti-type edge and the region's coastal terrain
(`docs/specs/2026-10-05-naval-air-domain-tactics-design.md`,
`docs/specs/2026-10-06-anti-type-tactics-design.md`,
`docs/specs/2026-10-06-coastal-terrain-gating-design.md`). Every one of those
fields is inert: no consumer reads `airEdge`, `navalEdge`, `antiEdge`, `antiPower`
or `coastal` anywhere in the runtime. The adapter drops them, and the only thing
the model is told about a resolved battle is a count of casualties and who took
the region:

```
"Battle of Alsace": the engine resolved the engagement in ALSACE (3 damaged,
1 destroyed); the region fell to Prussia.
```

That note says WHAT happened and never WHY. A model narrating the turn has no way
to say that Prussia held the air, that an artillery arm countered the defending
armour, or that the sea gave no shore support because the province is landlocked.
The engine did the tactical work and the narrator cannot see it.

This is the smallest increment that closes the loop: the engine owns the numbers,
the model owns the telling, and the receipt is the channel that already carries
the difference between them.

## Goals

- The tactic the core already computed reaches the model, in the same receipt
  note that reports the battle.
- A pure function turns a resolved battle into one clause naming WHO benefited,
  never by how much: the engine keeps its numbers.
- The clause is appended to the existing battle note; no new note kind, no new
  prompt block, no schema change, no migration.
- An ordinary battle with no tactical effect leaves the note byte-for-byte as it
  is today.
- The adapter stays the only place that knows the core's result shape; the core
  is untouched.

## Non-goals

- **A player-facing battle screen.** The receipt is oriented to the model. A HUD
  or a battle panel that shows these edges to the player is a separate increment
  with its own design and cannot be verified without a browser here.
- **Numbers in the note.** The clause names the side that held the air or the
  sea, never the share. A magnitude would invite the model to restate arithmetic
  it does not own.
- **Restating terrain that did nothing.** The coastal clause appears only when
  naval power was actually withheld; a landlocked battle with no fleet says
  nothing about the coast.
- **Rebalancing or recomputing anything.** The core (`src/engine/combat.js`) is
  untouched; only the adapter's result shape and the receipt text change.
- **Attributing within a multi-polity side.** A side is the unit of attribution;
  the clause names the side's leading polity, not the specific formation.

## Design

### 1. Layers

| Layer | Location | Rule in this increment |
|---|---|---|
| Pure core | `src/engine/combat.js` | **Unchanged.** It already returns the edges, the per-side domain power and `coastal`. |
| Adapter | `src/runtime/combatEngagements.js` | Forwards the tactic fields on each result and adds the pure `describeEngagementTactics(result)`. |
| Boundary | `src/Game/AI/gameplay.js` | Appends the clause to the battle receipt note it already writes. |

No new module, no new note kind, no prompt template, no schema, no migration.

### 2. What the adapter forwards

Each entry in `results` already carries `sideA` and `sideB` (the summary the
receipt loop reads). Two additions, both additive:

- top level: `airEdge`, `navalEdge`, `antiEdge`, `coastal`;
- per side: `airPower`, `navalPower`, `antiPower`, and `polity` (the side's
  leading polity, the same one the core credits a province to).

`polity` is what lets the clause name a side. It is read from the side's first
entry that fielded a unit, which is exactly the side order the adapter already
builds (`toSide`), so it is deterministic.

```
const leading = (side) => {
  for (const entry of side) {
    if ((entry?.units ?? []).length > 0) return name(entry.polity);
  }
  return "";
};
```

### 3. The clause

`describeEngagementTactics(result)` is pure and returns `""` when there is
nothing tactical to say, or a lower-case clause without a trailing period:

| Condition | Clause fragment |
|---|---|
| `airEdge > 0` / `< 0` | `<sideA/sideB polity> held the air` |
| `coastal === false` and either side has naval power | `shore support was withheld (the region is inland)` |
| otherwise `navalEdge > 0` / `< 0` | `<side> held the sea` |
| `antiEdge > 0` / `< 0` | `<side> had the counter edge` |

Fragments are joined with `; `, in that order. The coastal fragment and the
`navalEdge` fragment are mutually exclusive by construction: the core zeroes
`navalEdge` exactly when `coastal === false`, so a withheld coast never also
reports a sea holder.

```
export const describeEngagementTactics = (result) => {
  const parts = [];
  const holder = (edge) => (edge > 0 ? name(result?.sideA?.polity) : name(result?.sideB?.polity));
  if (Number(result?.airEdge)) parts.push(`${holder(result.airEdge)} held the air`);
  const hasNaval = Number(result?.sideA?.navalPower) > 0 || Number(result?.sideB?.navalPower) > 0;
  if (result?.coastal === false && hasNaval) {
    parts.push("shore support was withheld (the region is inland)");
  } else if (Number(result?.navalEdge)) {
    parts.push(`${holder(result.navalEdge)} held the sea`);
  }
  if (Number(result?.antiEdge)) parts.push(`${holder(result.antiEdge)} had the counter edge`);
  return parts.join("; ");
};
```

### 4. The note

The receipt loop in the turn already writes one note per resolved battle. It
gains the clause before its final period:

```
const tactics = describeEngagementTactics(result);
noteReceipt(receipt, "adjusted",
  `"${title}": the engine resolved the engagement in ${regionId}`
  + ` (${damaged} damaged, ${destroyed} destroyed)`
  + (controlToCode ? `; the region fell to ${controlToCode}` : "; the defender held")
  + (tactics ? `; ${tactics}.` : "."));
```

An ordinary land battle with no air, no naval power, no counter matchup and no
coastal data yields `tactics === ""`, so the note is character-for-character what
it is today.

### 5. Inert when there is nothing to say

This is the safety property. `describeEngagementTactics` returns `""` for any
battle where every edge is `0`, no naval power exists and `coastal` is not
`false` - which is every battle on the stock and `default` scenarios, and every
battle between forces with no air, sea or counter units. The appended string is
then empty and the note is unchanged. The existing note tests and the whole
combat suite pass unmodified as the regression test for this case.

## Tests

Adapter (`src/runtime/combatEngagements.test.js`):

1. **The result forwards the tactic fields**: a resolved battle carries
   `airEdge`/`navalEdge`/`antiEdge`/`coastal` and per-side `airPower`/`navalPower`/
   `antiPower`/`polity`.
2. **An air edge names the holder**: a battle where one side fields air yields a
   clause naming that side and the air.
3. **Naval support on the coast names the sea holder; inland withholds it**: a
   coastal fleet yields `<side> held the sea`, an inland fleet (populated coastal
   world) yields the withheld clause and no sea holder.
4. **A counter matchup names the counter edge**.
5. **An ordinary battle says nothing**: a plain land battle returns `""`.
6. **Determinism**: the clause is stable across two calls.

Wiring (`src/runtime/combatWiringArchitecture.test.js`):

7. A source guard that the receipt loop calls `describeEngagementTactics` and
   that the adapter exports it.

Regression:

- `npm test` stays green; the existing battle-note tests are untouched.
- `src/runtime/combatWiringArchitecture.test.js` and
  `src/engine/enginePurity.test.js` stay green.
- `npx eslint` gains no new error.

## Docs

- `docs/runtime-services.md`: the combat section notes that the battle receipt
  carries the tactical clause to the model.

## Considered options

- **A new receipt note kind ("tactics").** Rejected: the receipt kinds describe
  the fate of an operation (dropped, withheld, adjusted); a tactic is part of the
  note that already reports the battle, not a separate fate.
- **Putting the raw edges on the event impacts.** Rejected: impacts are applied
  to the world and persisted; a narrative observation is not world state, and the
  receipt is the channel built to carry exactly this.
- **Naming the specific formation that held the air.** Rejected: the side is the
  unit the war declares and the core scores; a per-formation attribution would
  need the core to expose which unit carried the edge, for no narrative gain.
- **A numeric breakdown the model can quote.** Rejected: it inverts the
  constitution - the engine owns the numbers, the model owns the telling.

## Risks

- **The existing note changing for a plain battle.** The clause is the empty
  string when nothing is tactical, so the appended text is empty rather than a
  rewritten sentence; the existing note tests pin it.
- **A very long title pushing the note past `RECEIPT_NOTE_MAX_CHARS`.** This is
  pre-existing (the note already clips at 280 chars); the clause is short and the
  clip is unchanged. A clipped note is the existing, bounded behaviour.
- **Mis-naming a side.** `polity` is the side's leading fielded polity, the same
  one the core credits a province to, so the clause names a side the same way the
  region line does.
