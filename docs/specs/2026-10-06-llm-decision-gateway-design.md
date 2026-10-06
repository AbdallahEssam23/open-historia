# The LLM strategic decision gateway

Date: 2026-10-06
Status: approved for implementation

## Problem

The deterministic core exists: the economy advances itself
(`src/engine/economyTick.js`), a war is settled from its own facts
(`src/engine/warSettlement.js`), casus belli is judged from claims and breaches
(`src/runtime/casusBelli.js`), and the turn runs every phase behind one executor
(`src/runtime/simulationTick.js`, see
`docs/specs/2026-10-06-tick-phase-unification-design.md`). The model's job on
top of that is stated in the constitution as advisor and narrator: the engine
owns the arithmetic, the model owns the story
(`docs/superpowers/specs/2026-10-01-deterministic-core-economy-design.md`).

What is missing is the half in between: an opponent has no mind. Today the
model reads a free-text war context (`buildCanonicalWarContext`) and decides,
from its own reasoning alone, whether another power declares war, opens a claim
or changes sides. Two failures follow, and both are the ones the constitution
warned about.

1. **The decision is not grounded.** The model is not handed the facts that
   would make a war legal (a standing claim, a recorded breach) in a form it can
   act on. It writes a `warUpdates start` from narrative memory, and the
   validator either accepts a plausible-sounding war with no cause or rejects a
   recorded one it did not see.
2. **A polity has no character.** There is no stored disposition anywhere: only
   free tags (`world.countryTags`), a reputation number and the ledger record.
   Every computer power therefore behaves the same way, so the world feels flat.

The constitution defers "computer-opponent decision making, war goals, peace
terms" to a later increment (non-goals, line 63). This is that increment, and
it is deliberately narrow: it gives every power in play a **derived character**
and a **menu of legal choices**, and lets the model choose within the menu.

## Goals

- A pure function derives a **personality profile** for a polity from facts the
  world already stores: tags, reputation, standing claims, active wars, recorded
  breaches and the force balance. No new authored data is required, and no
  polity is ever characterless.
- A pure function derives the **legal intent menu** for a polity: which war
  declarations, which claims and (in a later slice) which ceasefires and
  sanctions are available, and which are justified. The menu is the law; it is
  never a recommendation.
- The model chooses from the menu inside the existing turn request. **Zero
  additional provider calls.**
- The server re-derives the menu from the world and rejects any intent outside
  it. The choice is the model's; the law and the physics are the engine's.
- Byte-for-byte inert when no intent is returned: an existing world, an existing
  receipt, and the existing 3122-green suite, with no new turn phase and no
  change to `warLedger`.

## Non-goals

- **Full determinism of the choice.** The engine is deterministic; a model
  choosing inside a menu is not, and must not be. The determinism contract is
  `intent + world => result`, byte for byte, not `world => the same war`.
- **A separate opponent agent per polity.** One turn is one request. A mind per
  power would be hundreds of calls a turn, which is the cost the design exists
  to avoid.
- **The full intent set.** This design covers `declare_war` and `press_claim`
  first (`30b`). Ceasefire and sanctions ride the same shape and are a later
  slice.
- **A stored, model-authored personality.** The profile is derived every time
  from the world, like the trade field. Making it a stored field the model
  rewrites is a later increment with its own storage rule and drift guard.
- **Movement, combat orders and unit control.** The gateway decides `what`, the
  tick executor already decides `how`.
- **Any player-facing surface, scenario editor UI or schema migration.**

The increment is split in two, each with its own spec and implementation
commit, in the house pattern:

- **30a, the passive base:** the personality core, the world-context adapter and
  the strategic report. Purely additive: nothing reads them yet.
- **30b, the gateway:** the `strategicIntents` schema, the prompt directive, the
  server-side re-derivation and the application of `declare_war` and
  `press_claim`.

## Design

### 1. Layers

One direction of dependency, as with the economy core.

| Layer | Location | Rule |
| --- | --- | --- |
| Pure core | `src/engine/opponentPersonality.js` | Derives the profile from compact facts. No browser import, no clock, no entropy, imports only `./economyMath.js`. |
| Pure core | `src/engine/strategicIntent.js` (30b) | Derives the legal menu from compact facts. Same purity. |
| Adapter | `src/runtime/opponentContext.js` | Reads the normalized world, builds the compact facts, calls the personality core, assembles the report. Imports no `Game/AI` module. |
| Boundary | `src/Game/AI/strategicGateway.js` (30b) | Decodes `strategicIntents`, re-derives the menu, validates and translates to `warUpdates`/`regionClaimants`. |
| Prompt | `src/Game/AI/gameplay.js` (30b) | One directive that prints the report as given facts. |

There is no new tick phase. The gateway runs at the AI boundary where
`warUpdates` is already assembled, so it feeds the existing `warLedger`
unchanged.

### 2. The personality profile

Five closed axes, each 0-100, plus one free line:

| Field | Range | What it measures |
| --- | --- | --- |
| `aggression` | 0-100 | readiness to use force |
| `patience` | 0-100 | tolerance for waiting instead of fighting |
| `honor` | 0-100 | keeping treaties, ceasefires and its word |
| `opportunism` | 0-100 | exploiting another's weakness |
| `grievance` | 0-100 | unresolved claims and remembered wrongs |
| `character` | string | one short line that colours behaviour |
| `source` | `"derived"` \| `"authored"` | where the profile came from |

Closed axes are what make the profile auditable and impossible to hallucinate.
`character` is the only free text, and it is assembled from a **closed
vocabulary** keyed to the axis thresholds plus the polity's tags, so it is
deterministic and bounded.

The axes are an **interpretive lens, not a second authority**. A profile decides
nothing the engine computes: it is context the model reads. It never filters
the menu; the law alone decides what is legal. If it filtered, the decision
would be half deterministic and half narrative, and the contract would blur.

Derivation reads the facts and applies bounded, auditable adjustments to a base
of 50:

- `honor` rises with reputation and falls with recorded breaches.
- `aggression` rises with active wars, total mobilization and force share, and
  falls as patience rises.
- `patience` rises with honor and with a low force share.
- `opportunism` rises with low reputation, with a high force share and with
  recorded breaches by the polity.
- `grievance` rises with standing claims and with breaches committed against it.
- tags adjust the axes through one frozen table, so the map-maker's vocabulary
  ("expansionist", "revanchist", "pariah", "isolationist", "neutral") lands on
  the same numeric shape everywhere.

Every axis is clamped to 0-100 and rounded to an integer, so equal facts give an
equal profile in any process.

### 3. Where the facts come from

`aggregateWorldContext(world, polity)` reads only what `normalizeWorldState`
already carries:

| Fact | Source |
| --- | --- |
| `tags` | `resolveCountryTags(baseTags, world, polity)` |
| `reputation` | `world.internationalReputation[polity]`, default 50 |
| `claims` | regions in `world.regionClaimants` naming this polity |
| `activeWars` | `world.wars` with this polity on a side and status active |
| `breaches` | `world.agreements` breached by this polity |
| `wrongedCount` | `world.agreements` breached by another party it was bound to |
| `mobilization` | `world.economyEngine.mobilization[polity]` |
| `powerShare` | this polity's `economyEngine.pools` manpower over the strongest in play |

`baseTags` is optional and defaults to empty; the live `world.countryTags` wins
where present. A world with no tags still yields a profile from its numbers.

### 4. The polities in play

The report is not built for all 237 polities. It covers the ones whose decision
can reach the player this turn, bounded by a cap, exactly as the region
vocabulary is already tiered: the player, the belligerents of active wars, the
player's relation and agreement partners, polities holding a claim against the
player or claimed by them, and the strongest by force. The set is sorted by a
stable key before the cap, so the same world selects the same polities.

### 5. The legal menu (30b)

`deriveIntentMenu(facts)` returns the options a polity may take, each entry
carrying the reason it is legal:

| Intent | Payload | Translation | Legality |
| --- | --- | --- | --- |
| `declare_war` | `{target, goal}` | `warUpdates start` + `goals` | not self, no active war, and a standing claim or a recorded breach decides `justified` vs `unjust` |
| `press_claim` | `{regionIds}` | add the polity to `regionClaimants` | region exists and is not already owned by the claimant |

The model picks from the menu. `validateAndApplyIntent` **re-derives the menu
from the world** and rejects anything outside it, so a stale or invented option
cannot pass. An accepted `press_claim` is a small deterministic fact that makes
a later `declare_war` justified through the existing casus path: claims are
built by evidence, not by rhetoric.

`strategicIntents` is the single channel for computer-power wars. The direct
`warUpdates` path stays for what the menu does not cover (the player's own
diplomacy, pre-game history, engine-injected settlement endings). A direct
`warUpdates` that duplicates an intent is refused, so one war has one authority.

### 6. Turn flow

| Step | What happens | New |
| --- | --- | --- |
| 1 | Turn starts; the economy advances as today | no |
| 2 | `buildStrategicReport(world)` builds the profiles and menus for polities in play | 30a: profiles; 30b: menus |
| 3 | The directive prints the report as given facts inside the existing request | 30b |
| 4 | The model narrates and returns `strategicIntents` chosen from the menu | 30b |
| 5 | The gateway re-derives the menu, validates each intent and translates it to `warUpdates`/claims | 30b |
| 6 | `runTick([...])` applies `warLedger`, `casusBelli`, `settlements` as today | no |

### 7. Determinism and equivalence

- `derivePersonality`, `worldFactsFor` and (30b) `deriveIntentMenu` are pure:
  the same world gives the same output in any process. Asserted by test.
- The profile is the subject of `src/engine/enginePurity.test.js`: no
  `Date.now`, no `new Date`, no `Math.random`, no browser global, imports only
  the allow-listed engine siblings.
- The inert path proves no behaviour change: a turn that returns no intent
  produces the same world and the same receipt as today. This is the recorded
  equivalence argument for 30b.

### 8. Tests

New, beside the code:

- **Personality:** determinism across two calls; every axis inside 0-100 and an
  integer; a tag lands on its expected axis direction; a polity with no tags and
  default numbers yields the neutral profile; `character` is non-empty, single
  line and length-capped; `normalizePersonality` rejects garbage without
  throwing.
- **Context:** claims, reputation, active wars, breaches and wronged counts read
  from a small authored world; `powerShare` uses the strongest in play; the
  report is deterministic, includes the player and the belligerents, and is
  capped; the adapter imports no `Game/AI` module.
- **Architecture:** the engine core stays import-free per the existing guard.

Regression: `npm test` stays green (3122 today, 0 fail), `npx eslint` gains no
error, `npm run wiki:check` stays current.

### 9. Docs

- `docs/runtime-services.md`: the personality core and the context adapter.
- `docs/architecture.md`: the gateway at the AI boundary (30b).
- `docs/ai-overview.md`: `strategicIntents` and the menu rule (30b).

## Considered options

- **The engine decides deterministically, the model narrates.** Rejected. It is
  fully reproducible but turns the strategic mind into a formula: every
  campaign of a given world plays the same wars, which is the opposite of the
  living world this increment exists to build.
- **The model decides freely, the engine only validates.** Rejected. It leaves
  the model able to invent a war with no recorded cause and rely on the
  validator to catch it, which is the failure the menu removes: the model is
  shown what is legal before it chooses.
- **A stored, model-authored personality per polity.** Deferred, not rejected.
  It is the richest option and the natural sequel, but it needs a stored field,
  a drift guard and a write path, and it would delay a closed increment. The
  derived profile is the floor that always exists.
- **Reusing the free `countryTags` as the personality with no axes.** Rejected
  as insufficient: the character would be unbounded and could differ between
  turns for the same polity, which is exactly the flatness and the drift the
  axes are there to remove.
- **A separate opponent agent per polity.** Rejected on cost, as above.

## Risks

- **The menu is mistaken for a recommendation.** Mitigated by wording the
  directive so the menu is law, not advice, and by the model keeping the choice.
- **The profile drifts from the facts.** It cannot: it is derived, not stored.
  Its only inputs are read fresh each turn.
- **Prompt growth.** Mitigated by covering only the polities in play, with a
  hard cap and a per-polity line cap, as the region vocabulary already does.
- **Two writers of a war.** Mitigated by making `strategicIntents` the single
  channel for computer-power wars, which 30b asserts.

## Decisions taken

1. The engine computes the legal menu; the model chooses from it.
2. The profile is derived, never stored, in this increment.
3. The gateway rides the existing turn request; no opponent agent.
4. The intent set starts at `declare_war` and `press_claim`.
5. Determinism is promised on the execution, not on the choice.

## Open questions

None block 30a. The following are recorded so the plan does not silently decide
them:

- The exact axis weights are first-draft calibration, like `ECONOMY_STEP`; the
  tests assert bounds, direction and determinism, not magnitudes.
- Whether a scenario may override a polity's profile (an authored disposition
  file beside `tags.json`) is a natural follow-on, deferred with the stored
  profile.
