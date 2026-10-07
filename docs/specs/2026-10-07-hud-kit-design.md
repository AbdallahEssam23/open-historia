# HUD Kit: One Source for the Outer Shell's Buttons, Menus and Timeline

> Status: designed. A UI-consistency change across the outer shell (the HUD
> chrome a player always has on screen), prompted by the roadmap work that added
> the heatmap toggle, the Stats World and Chronicle sub-tabs and the local
> model hints.

## Problem

The outer shell's finish is copied, not shared. Each panel re-declares the same
glass surface, pill radius and button shapes inline:

- `--oh-hud-blur` is re-applied ad hoc in eight files;
- the `999px` pill radius appears in 60+ places;
- the glass surface gradient is written out in `libraryBar.jsx` and again in
  `settings.jsx` with a slightly different one;
- `surfaceStyle`/`actionButtonStyle` (`libraryBar.jsx`), `buttonStyle`
  (`time.jsx`), `cardStyle` and `statsSubtabStyle` (`stats.jsx`) and `baseStyle`
  (`settings.jsx`) are near-duplicates of each other.

So the tokens in `styles.css` are the intended single source, but the JSX never
actually consumes them through one place. A change to the pill's height or the
glass gradient has to be made in six files, and they drift (the two surfaces
above already disagree).

## Goal

One module owns the outer shell's finish:

1. `src/Game/GameUI/hudKit.js` — import-free style tokens and factories, covered
   by `node --test`;
2. `src/Game/GameUI/hudKit.jsx` — thin React wrappers over those factories;
3. the shell files consume them instead of their own literals, with the rendered
   styles unchanged;
4. a guard test so the duplicate literals cannot come back.

## Non-goals

- No visual redesign. Every factory reproduces the exact style object it
  replaces, so this ships as no pixel change. That is also why it is safe to land
  without a browser in the loop.
- No migration of the whole app. The 60+ pill radii across editors, the library
  grid and the community browser stay; only the outer-shell surfaces this task
  targets move. A later pass can widen it.
- No new dependency and no CSS-in-JS runtime: the factories return plain objects,
  and the components are ordinary function components.

## Architecture

### Pure tokens and factories: `src/Game/GameUI/hudKit.js`

Import-free, so `node --test` runs it directly and it can be dropped into any
panel's graph without pulling React.

```
HUD_RADIUS = { pill, card, menu, dock, input, tab }
HUD_SURFACE                 // the glass surface (libraryBar.surfaceStyle)
HUD_BASE                    // fixed glass panel base (settings.baseStyle)
HUD_ACTION                  // the pill action button (libraryBar.actionButtonStyle)
HUD_ICON_BUTTON             // the small square icon button (time.buttonStyle)
HUD_CARD                    // the stats card (stats.cardStyle)
hudDockStyle(gapRem)        // the dock container, positioning left to the caller
hudTabButton(selected, touch)   // stats.statsSubtabStyle
hudActionButton({ touch, icon, patch })
hudTouchFit(style, touch, { icon })  // libraryBar.touchFit, moved here
mergeStyles(...parts)
```

`hudTouchFit` encodes the rule `libraryBar.jsx` documents: on a touch screen the
`.oh-tap` / `.oh-tap-row` classes set the 44 px floor, and an inline `minHeight`
would outrank them, so the floor is dropped from the inline style instead of
fighting the class.

### Components: `src/Game/GameUI/hudKit.jsx`

Thin wrappers that spread unknown props and forward `style`, `className` and
`data-*`, so a call site keeps every attribute it had:

`HudSurface`, `HudActionButton`, `HudIconButton`, `HudCard`, `HudTabButton`,
`HudMenuCard`.

### Migration (outer shell only, behaviour-preserving)

- `libraryBar.jsx`: `surfaceStyle` and `actionButtonStyle` become the kit's;
  `touchFit` moves into the kit and is imported.
- `time.jsx`: `buttonStyle` becomes `HUD_ICON_BUTTON`; the date widget's buttons
  use `HudIconButton`.
- `stats.jsx`: `cardStyle` becomes `HUD_CARD`; `statsSubtabStyle` becomes
  `hudTabButton`; the sub-tabs (Diplomacy, Economy, World, Chronicle) render
  through `HudTabButton`.
- `settings.jsx`: `baseStyle` becomes `HUD_BASE`.
- `chat.jsx`: the dock container uses `hudDockStyle`.

## Data flow

```
styles.css tokens (--oh-hud-*)
        |
        v
   hudKit.js  --styles-->  hudKit.jsx  --components-->  shell panels
        |                                                     |
        +---------------- hudKit.test.js (node --test) -------+
        +---------------- hudKitArchitecture.test.js ---------+
```

## Edge cases

- A caller that passes its own `style` wins over the base (spread after), so an
  override still works and no call site loses an attribute.
- `hudTabButton` with no `touch`: identical to the previous function.
- `hudTouchFit` with a mouse pointer: the style is returned untouched.
- A panel that imports `hudKit.js` only (no components) never pulls React.

## Testing

- `src/Game/GameUI/hudKit.test.js` (new, `node --test`): pins every factory's
  output, `hudTabButton` for both selected states and both touch values,
  `hudTouchFit` for a mouse and a finger and for an icon button, and
  `mergeStyles` order.
- `src/Game/GameUI/hudKitArchitecture.test.js` (new): none of the migrated files
  re-defines `surfaceStyle` / `actionButtonStyle` / `buttonStyle` / `cardStyle` /
  `statsSubtabStyle` / `baseStyle` as its own literal, and each imports the kit.
- `npm test` and `npm run build` stay green. The committed visual job
  (`visual/`) covers the Stats sub-tabs and the map, so it exercises the
  migrated surfaces in CI.

## Files

- New: `docs/specs/2026-10-07-hud-kit-design.md`,
  `src/Game/GameUI/hudKit.js`, `src/Game/GameUI/hudKit.jsx`,
  `src/Game/GameUI/hudKit.test.js`,
  `src/Game/GameUI/hudKitArchitecture.test.js`.
- Edit: `src/Game/GameUI/libraryBar.jsx`, `src/Game/GameUI/time.jsx`,
  `src/Game/GameUI/stats.jsx`, `src/Game/GameUI/settings.jsx`,
  `src/Game/GameUI/chat.jsx`.

## Open questions

1. Should the kit take over the `styles.css` tokens too, or read them? It reads
   them (`var(--oh-hud-*)`): the stylesheet stays the palette, the kit stays the
   shape. Moving colours into JS would duplicate the palette.
2. Should the wider pill radii migrate? Deferred; see Non-goals.

## TODO

- [ ] Write `hudKit.js` + `hudKit.test.js` (TDD).
- [ ] Write `hudKit.jsx`.
- [ ] Migrate the shell files and add the architecture guard.
- [ ] Run `npm test`, `npm run build` and eslint; confirm no pixel change.
