/*! Open Historia — the outer shell's shared controls © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Thin React wrappers over hudKit.js. They exist so the shell's buttons, cards,
// tabs and surfaces are one set of components rather than the same inline style
// re-typed at every call site. Each forwards className, style and data-* and
// spreads the rest, so a migrated call site keeps every attribute it had, and a
// caller's style wins over the base (spread after).
//
// No dependency beyond React, and the styling itself lives in hudKit.js, which
// stays import-free so `node --test` covers it.
import React from "react";

import {
    HUD_ACTION,
    HUD_CARD,
    HUD_ICON_BUTTON,
    HUD_SURFACE,
    hudTabButton,
    hudTouchFit,
    mergeStyles,
} from "./hudKit.js";

export const HudSurface = ({ style, ...rest }) => (
    <div style={mergeStyles(HUD_SURFACE, style)} {...rest} />
);

export const HudCard = ({ style, ...rest }) => (
    <div style={mergeStyles(HUD_CARD, style)} {...rest} />
);

// A pill action button. `touch` drops the inline height floor so .oh-tap-row can
// set the finger's 44 px; `icon` drops the inline width floor too.
export const HudActionButton = ({ touch = false, icon = false, style, ...rest }) => (
    <button
        type="button"
        style={hudTouchFit(mergeStyles(HUD_ACTION, style), touch, { icon })}
        {...rest}
    />
);

// The small square icon button (the date widget's arrows and today button).
export const HudIconButton = ({ style, ...rest }) => (
    <button type="button" style={mergeStyles(HUD_ICON_BUTTON, style)} {...rest} />
);

// A selectable sub-tab. aria-pressed mirrors `selected` unless the caller sets
// its own, so the control is announced correctly with no extra prop.
export const HudTabButton = ({ selected = false, touch = false, style, children, ...rest }) => (
    <button
        type="button"
        aria-pressed={selected}
        style={mergeStyles(hudTabButton(selected, touch), style)}
        {...rest}
    >
        {children}
    </button>
);

export const HudMenuCard = ({ style, ...rest }) => (
    <div className="oh-menu-card" style={mergeStyles(HUD_SURFACE, style)} {...rest} />
);
