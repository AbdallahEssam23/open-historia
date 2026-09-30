/*! Open Historia — noting when the structured-output ladder fell back, and offering the setting © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// What the structured-output ladder has learned about the endpoints in use this
// session (structuredMode.js), and the three things done with it: record a drop,
// ask whether there is anything to offer, and answer that offer. Session-scoped
// on purpose — an observation about how a gateway behaved just now is not a
// setting, and the SETTING is the thing the player is offered once the evidence
// is consistent.
//
// It lives here rather than in main.jsx because the date widget (GameUI/time.jsx)
// asks the two questions, and main.jsx is the model-calling stack: importing three
// one-line functions from it put ~370 KB on the HUD shell, fetched and parsed
// while the startup screen was still counting. The observer is module state, so
// there is exactly one copy of it either way — main.jsx imports the recorder from
// here too, and neither file can drift into keeping its own.
import { getResolvedFallbackList, updateEntry } from "./providerConfig.js";
import { createModeObserver } from "./structuredMode.js";
import { logDebugEvent } from "../../runtime/debugLog.js";

const structuredModeObserver = createModeObserver();

// A call that started at one rung and succeeded lower down. Only a genuine drop
// teaches anything; succeeding where it began is the expected case.
export const noteStructuredModeLanding = (key, startedAt, landedAt, configured) => {
    if (!key) return;
    const seen = structuredModeObserver.record(key, startedAt, landedAt);
    if (!seen) return;
    logDebugEvent("ai", `Structured output fell back to ${landedAt} for ${key}.`, {
        startedAt,
        timesSeen: seen.count,
    }, { verbose: true });
    // Announced, not acted on. The UI decides whether and how to ask; nothing
    // changes until the player says so.
    if (structuredModeObserver.shouldSuggest(key, configured)) {
        try {
            window.dispatchEvent(new CustomEvent("ai:structured-mode-suggestion", {
                detail: { key, mode: landedAt },
            }));
        } catch { /* no window (tests, workers) — the observation still stands */ }
    }
};

// Asked by the UI when it wants to know whether there is anything to offer.
// The evidence is kept per Fallback entry — the id is the observer's key — so
// the first entry with something to offer is the one asked about.
export const getStructuredModeSuggestion = () => {
    for (const entry of getResolvedFallbackList()) {
        const mode = structuredModeObserver.shouldSuggest(entry.id, entry.structuredMode);
        if (mode) return { key: entry.id, mode, label: entry.label };
    }
    return null;
};

// "No thanks" — remembered for the session so it does not ask again every turn.
export const declineStructuredModeSuggestion = (key, mode) => {
    structuredModeObserver.decline(key, mode);
};

// "Yes" — write the setting on that entry, then forget the evidence so a later
// change in the endpoint's behaviour is learned fresh rather than judged
// against stale data.
export const acceptStructuredModeSuggestion = (key, mode) => {
    updateEntry(key, { structuredMode: mode });
    structuredModeObserver.clear(key);
    logDebugEvent("ai", `Structured output set to ${mode} for a Fallback entry.`, { key });
};
