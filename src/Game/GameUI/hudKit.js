/*! Open Historia — the outer shell's shared finish © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// One source for the glass surface, the buttons, the cards and the dock that the
// HUD chrome draws, so the palette tokens in styles.css are actually consumed
// through a single place instead of re-derived inline in six panels.
//
// Import-free on purpose: a panel can take a style from here without pulling
// React, and `node --test hudKit.test.js` covers every value directly.
//
// The values are not new. Each factory returns exactly the object the shell used
// to hard-code (libraryBar.surfaceStyle, settings.baseStyle, time.buttonStyle,
// stats.cardStyle, ...), which is what makes this a no-pixel-change refactor.
// hudKit.test.js pins them so they cannot quietly drift apart again.

// The radii the shell uses, named once.
export const HUD_RADIUS = Object.freeze({
    pill: "999px",
    card: "10px",
    menu: "16px",
    dock: "14px",
    input: "12px",
    tab: "8px",
});

// The glass finish (libraryBar.surfaceStyle): every floating HUD surface reads
// its palette from the stylesheet tokens, not from colours written here.
export const HUD_SURFACE = Object.freeze({
    background:
        "linear-gradient(180deg, rgba(50, 50, 55, 0.58) 0%, rgba(17, 17, 19, 0.48) 100%)",
    border: "1px solid var(--oh-hud-border)",
    boxShadow: "var(--oh-hud-shadow-soft)",
    backdropFilter: "var(--oh-hud-blur)",
    WebkitBackdropFilter: "var(--oh-hud-blur)",
});

// A fixed glass panel's base (settings.baseStyle), positioning left to callers
// that spread it and add their own top/left/size.
export const HUD_BASE = Object.freeze({
    position: "fixed",
    backgroundColor: "var(--oh-hud-bg)",
    backdropFilter: "var(--oh-hud-blur)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontFamily: "var(--oh-font-ui)",
    borderRadius: HUD_RADIUS.dock,
    border: "1px solid var(--oh-hud-border)",
    boxShadow: "var(--oh-hud-shadow-soft)",
});

// The pill action button (libraryBar.actionButtonStyle).
export const HUD_ACTION = Object.freeze({
    alignItems: "center",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: HUD_RADIUS.pill,
    color: "rgba(246,246,248,0.92)",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "0.82rem",
    fontWeight: 600,
    gap: "0.4rem",
    justifyContent: "center",
    minHeight: "2.1rem",
    padding: "0 0.95rem",
    transition: "background 0.18s ease, border-color 0.18s ease, transform 0.18s ease",
});

// The small square icon button (time.buttonStyle), used by the date widget.
export const HUD_ICON_BUTTON = Object.freeze({
    alignItems: "center",
    background: "none",
    border: "none",
    borderRadius: "6px",
    color: "rgba(255,255,255,0.7)",
    cursor: "pointer",
    display: "flex",
    flexShrink: 0,
    fontSize: "1.5rem",
    fontWeight: "900",
    height: "2rem",
    justifyContent: "center",
    lineHeight: 1,
    transition: "all 0.15s ease",
    width: "2rem",
});

// The stats card (stats.cardStyle).
export const HUD_CARD = Object.freeze({
    backgroundColor: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: HUD_RADIUS.card,
    padding: "0.6rem 0.7rem",
});

// The bottom-left launcher dock's container (chat.jsx): its gap comes from
// hudDock.js, so it is passed in, and the fixed positioning stays with the
// caller's layout.
export const hudDockStyle = (gapRem) => ({
    alignItems: "center",
    backgroundColor: "var(--oh-hud-bg)",
    backdropFilter: "var(--oh-hud-blur)",
    border: "1px solid var(--oh-hud-border)",
    borderRadius: HUD_RADIUS.dock,
    boxShadow: "var(--oh-hud-shadow-soft)",
    color: "white",
    display: "flex",
    fontFamily: "var(--oh-font-ui)",
    gap: `${gapRem}rem`,
    justifyContent: "center",
});

// A selectable sub-tab (stats.statsSubtabStyle). `touch` asks for the inline
// floor; without it the .oh-tap-row class sets the finger's 44 px instead.
export const hudTabButton = (selected, touch = false) => ({
    alignItems: "center",
    backgroundColor: selected ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.03)",
    border: `1px solid ${selected ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.09)"}`,
    borderRadius: HUD_RADIUS.tab,
    color: selected ? "#f4f4f5" : "rgba(255,255,255,0.58)",
    cursor: "pointer",
    display: "flex",
    flex: 1,
    fontSize: "0.72rem",
    fontWeight: 800,
    justifyContent: "center",
    minHeight: touch ? "2.75rem" : "2.45rem",
    padding: "0.45rem 0.55rem",
    transition: "background-color 0.15s, border-color 0.15s, color 0.15s",
});

// On a touch screen .oh-tap / .oh-tap-row (styles.css) make a control a finger's
// 44 px, but a min-height written inline beats a class. So where a finger is the
// pointer the inline floor is left out and the class sets it (an icon button's
// min-width too); with a mouse the style is returned untouched.
export const hudTouchFit = (style, touch, { icon = false } = {}) => {
    if (!touch) return style;
    return icon ? { ...style, minHeight: undefined, minWidth: undefined } : { ...style, minHeight: undefined };
};

// The pill action button with an optional patch and the touch rule applied.
export const hudActionButton = ({ touch = false, icon = false, patch = null } = {}) =>
    hudTouchFit(mergeStyles(HUD_ACTION, patch), touch, { icon });

// Later objects win, and null/undefined parts are ignored, so a call site can
// pass a conditional override without a guard.
export const mergeStyles = (...parts) => Object.assign({}, ...parts.filter(Boolean));
