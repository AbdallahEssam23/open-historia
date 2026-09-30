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

const replaceAt = (events, replacements) => {
    const next = asArray(events).slice();
    for (const [index, impacts] of replacements) next[index] = { ...next[index], impacts: clone(impacts) };
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
        asArray(resolved)[index]?.impacts ?? target.impacts,
    ]));
