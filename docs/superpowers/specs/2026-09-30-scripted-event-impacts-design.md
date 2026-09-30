# Scripted events with declared impacts

Date: 2026-09-30
Status: approved for implementation

## Problem

A scenario author can script history in the `worldDirection.scriptedEvents`
setting: one beat per line, a date and the author's words. The engine already
guarantees the beat happens — the skip that covers its date is asked to write it,
and a beat the answer leaves out is written by the engine in the author's words
(`ensureScriptedEvents`, `src/Game/AI/worldDirection.js`).

But the beat is **only prose**. The one the engine writes carries
`impacts: {}` (`scriptedEventFor`, `worldDirection.js:166`), and the one the model
writes carries whatever the model decided, which may be nothing. So a beat like
"Germany invades Poland" is a sentence on the timeline: no border moves, no unit
appears, no polity is founded or dissolved. The author's history is narrated, not
*realised* — the map, the ledgers and the rest of the simulation do not feel it,
and the same beat can resolve differently from one campaign to the next.

The engine already has a complete, deterministic language for realising history:
the eight `impacts` families (`regionTransfers`, `regionControlOps`,
`regionClaims`, `polityChanges`, `unitOps`, `markerOps`, `createdChats`,
`projectOps`, `src/Game/AI/gameplayPrompts.js:68`). What is missing is a way for
the author to declare which of them a scripted beat performs.

## Goals

- A scripted beat can declare the full set of engine impacts — every one of the
  eight families, with every field the model's `impacts` accepts.
- Those impacts are applied on the beat's exact date by the engine, whatever the
  model writes: **the author's word is final**.
- The author's impacts are exempt from the engine's pacing limits (the map's
  tempo), because the author knows the story.
- The existing text storage, the community-hub round trip and old scenarios keep
  working with no migration.
- A visual builder edits the same text; the text stays the source of truth and
  remains editable by hand.

## Non-goals

- War, relation, agreement and storyline ledgers are **not** authored here. They
  are turn-level ledgers decoded from model string fields and bound to events by
  index (`gameplay.js:553-570`, `:856-858`); an engine-written beat does not pass
  through that path, so authoring them needs separate machinery. A later
  increment, not this one.
- The fallback jump path (`fallbackJumpSimulation`, `gameplay.js:5954`) does not
  write scripted beats today, so author impacts do not appear on a jump that
  fails outright. Left out of the first increment on purpose; the parser is built
  so it can be wired there later.
- No map-picking of regions, no live impact preview against the world, no second
  text syntax.

## Design

### 1. The text format

The event line is unchanged. Its impacts are the indented lines that follow it,
each beginning with a verb. The block ends at the next line that starts with a
date, or at the first unindented non-blank line. Leading whitespace is tolerated.

```
1914-06-28 Archduke Franz Ferdinand is assassinated in Sarajevo.
  transfer Sarajevo -> Austria-Hungary
  claim Bosnia by Serbia

1914-08-04 Germany invades Belgium.
  control Belgium -> Germany note=the Schlieffen plan opens
  unit spawn "1st Army" owner=Germany type=infantry strength=95 at=near Aachen
```

Rules:

- A verb, then positional arguments in a fixed order per verb, then `key=value`
  pairs whose keys are the real `impacts` field names (`note`, `wholeCountry`,
  `op`, `claimantCode`, `drop`, `unitId`, `strength`, `at`, `markerId`,
  `population`, `progress`, ...).
- Values with spaces are double-quoted, with `\"` escaping a quote inside.
- `#` starts a comment line, as in the event lines.
- Names and codes are compared case-insensitively after `normalizeString`, as
  every other check in the codebase does.

Verbs cover all eight families:

| Family | Verbs |
|---|---|
| `regionTransfers` | `transfer <region> -> <toPolity>` |
| `regionControlOps` | `control <region> -> <toPolity>`, `contest <region> by <actor>`, `clear <region> from <claimant>` |
| `regionClaims` | `claim <region> by <claimant>`, `unclaim <region> by <claimant>` |
| `polityChanges` | `polity create\|restore\|update\|rename\|dissolve <nameOrCode>` |
| `unitOps` | `unit spawn\|move\|strength\|remove <unit>` |
| `markerOps` | `marker build\|update\|rename\|remove\|population <marker>` |
| `projectOps` | `project create\|update\|milestone\|complete\|cancel\|fail\|remove <name>` |
| `createdChats` | `chat <countries> title= speaker= openingMessage=` |

Backward compatibility is free. `parseScriptedEvents` already ignores any line
that does not start with a date (`worldDirection.js:119`), so a scenario with no
impacts parses to exactly the beats it does today, and an older build reading a
newer scenario ignores the impact lines instead of breaking.

### 2. The parser

A pure function in `src/Game/AI/worldDirection.js`, beside `parseScriptedEvents`,
following that file's style. `parseScriptedEvents(text)` is upgraded to return
`[{date, title, text, impacts, errors}]`; a separate
`parseEventImpactLine(line)` is testable on its own.

Tolerance and robustness:

- A line with an unknown verb, a missing required argument or an empty `key=`
  value drops **that one line** and pushes `{line, text, reason}` to `errors`.
  The event and its other, valid impacts survive.
- A failed parse never throws and never drops the beat's prose.
- `scriptedBeatsInSpan` and `beatIsWritten` are untouched, so a beat's date
  matching and the "was it written?" check behave exactly as before.

### 3. Application: the author's word is final

The wiring is one site: the scripted-events block in the segment validator
(`gameplay.js:11838-11849`). Nothing else in the pipeline changes, because the
author's impacts reach `applyEventImpactsToWorld` (`gameState.js:4459`) like any
other impact.

Attachment happens in two stages:

**Stage A — at insertion (`gameplay.js:11841`), before any validation.**

1. If the model wrote the beat itself, its `impacts` object is **stripped
   entirely**. The model keeps the prose; the author owns the mechanics.
2. If the model left the beat out, the engine writes the event as it does today,
   but with the author's real `impacts` instead of `{}`.
3. The author's impacts are emptied (`impacts: {}`) for this stage, so every
   check that follows — the `screenTerritoryBasis` net, identity checks, the
   ledgers, the canonical war check — sees only the model's output and never
   counts land the model never declared.

**Stage B — after validation succeeds, before the segment returns.** The
author's impacts are resolved and stamped onto their events:

- The existing resolvers run on the author's event list alone, as a synthetic
  container: `resolveRegionTransfers`, `resolveRegionControlOps`,
  `resolvePlacements` (for `at` on units and structures), `resolveInvitees` (for
  `chat`). Full reuse, no new logic.
- The non-strict path with `allowModel: false`: an unresolvable reference is
  **dropped and reported as a diagnostic**, never sent back to the model (the
  model cannot fix the author's data), and no extra AI request is spent. The
  feature is free and deterministic and does not depend on the model.

Why this order matters: the map's tempo (`gameplay.js:11822`) runs **before**
insertion, and every other engine limit runs in stage A on the model's impacts
only. So the author's impacts are exempt from the engine's limits **by
construction**, not by a written exception — cleaner than threading an
`authored` flag through world state.

`screenTerritoryBasis` only acts on an explicit `basis` field
(`territoryBasis.js:132`), and the author's syntax exposes no `basis` verb — the
author writes `claim`/`unclaim` explicitly. So the screen never touches the
author's intent, with no special-casing.

### 4. Determinism, rollback and the receipt

- The parser is pure, impacts are attached to fixed dates, and
  `applyEventImpactsToWorld` walks events in order, so the same save replays the
  same world.
- Impacts live in the event log, so restore, undo and Intervene bring them back
  with the event automatically, with no new work.
- The `gameplay.js:11846` receipt note changes from "with no impacts" to a note
  telling the model the declared impacts were applied and that it must carry
  their consequences; where the model's own impacts were replaced, it is told so
  plainly. This is what makes the model narrate what actually happened instead of
  inventing a rival outcome.

### 5. The visual builder

The builder lives in the Features tab, where `scriptedEvents` is edited today
(`FeaturesSectionEditor.jsx`). It is switched on by a new declarative key on the
setting definition in `server/gameFeatures.js` (for example
`editor: "scriptedEvents"`) rather than by the UI guessing the key, so any future
text setting can request its own builder the same way.

Two-way, lossless:

- Opening parses the text into cards; every UI edit re-serialises immediately to
  the same stored text.
- Any line that failed to parse is shown in a "kept as written" block and
  re-emitted verbatim — the editor never loses an author's text.
- A "edit as raw text" toggle edits the real string. Both views are the same
  field, so switching back and forth loses nothing.

Card anatomy: the date (with BCE support, `-0218-03-01`), the event text
(multiline, `data-no-translate`), and the title shown **read-only as a derived
value** because it is genuinely derived from the text
(`worldDirection.js:122-124`) — shown, never stored. Below it, the impact lines,
each a verb grouped by family (Territory / Polities / Military / Structures /
Projects / Chats), then the verb's fields and an optional `note`. Move up/down,
duplicate and delete per card, and move up/down per impact line — order matters,
because `polity create` then `update` on the same polity is a real sequence.

Input help: region and polity fields are free text with `datalist` suggestions
from the scenario catalog **when one is loaded in the editor**, plain free text
when it is not.

Diagnostics: a panel under the builder collects the parser's `errors` — line
number, text, reason — and clicking one focuses the card or line. A live
character counter on the field warns at 90% of the cap. The messages make clear
that **a clean parse means only that the syntax is well-formed**; region-name
resolution happens at play time and the receipt is the last line of defence
telling the model what was actually applied.

The setting's `maxLength` rises from 8000 to **20000** characters. Impacts are
consumed from the same cap and thirty weighty events could press it, while the
prompt does not grow: the instructions are built from `scriptedBeatsInSpan`, the
period's beats only (`gameplay.js:11838`), never the whole file.

UI and mobile follow existing patterns: `oh-tap-row` for touch rows,
`useTouchPrimary`, and the repeating-list idiom of `settings.jsx`. New UI
strings go through the current i18n layer; the author's content stays
`data-no-translate`.

### 6. Tests

All in the existing `src/Game/AI/worldDirection.test.js`:

- Every valid verb parses to the expected `impacts` shape.
- An unknown verb / a missing required argument / an empty `key=` drops that one
  line, records an error, and leaves the beat and its other lines intact.
- Quoting and `\"` escaping round-trip.
- A no-impacts text parses to the same beats as today (zero regression).
- Impact lines never leak into `title` or `text`.
- `scriptedBeatsInSpan` and `beatIsWritten` are unchanged.
- A beat's impacts, after Stage B resolution, equal the expected `impacts`
  against a small fixture world.

### 7. Docs

- `docs/ai-overview.md:370` — the scripted-events row, with the format and the
  "author's word is final, exempt from the tempo" rule.
- `docs/game-ui.md` — the builder in the Features tab.
- `wiki/tools/editor.md` — a complete copy-pasteable format example.

## Considered options

- **A separate structured `scriptedEvents: [{date,title,text,impacts}]` setting.**
  Rejected. Cleaner and directly validated, but it changes the scenario shape,
  needs migration for existing text, needs double validation, and breaks the
  hub's text round trip. The chosen format keeps one string that is still
  editable in any text editor.

- **A deterministic scheduler independent of the AI turn.** Rejected. It
  bypasses the receipt, rollback and name resolution, rebuilds existing logic,
  and risks double application. More code and more regression surface for the
  same determinism, which the two-stage approach already gives.

- **Injecting the beat into the event log as a frozen real event up front.**
  Rejected. Future events in the log break reveal and rollback semantics, spoil
  beats for the player, and disturb `beatIsWritten`.

- **The model's impacts on top of the author's.** Rejected. It reopens conflict
  (the same region moved twice, a polity dissolved then updated) and makes the
  outcome depend on the model's mood, which defeats the point.

- **Applying the engine's limits to the author's impacts too.** Rejected. A
  scripted beat could be withheld or deferred, so "realised history" becomes
  partial and depends on settings.

## Risks

- **Author data is wrong at play time** (a region name that does not resolve).
  Mitigated: dropped and reported, never a retry, never a crash, never a spent
  request.
- **A model that narrates a rival outcome.** Mitigated by stripping the model's
  impacts on an author beat and by the receipt note.
- **Editor round-trip data loss.** Mitigated by the "kept as written" block and
  the raw-text toggle.
