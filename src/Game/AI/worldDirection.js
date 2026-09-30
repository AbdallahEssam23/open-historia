/*! Open Historia — world direction: a scenario author's settings, read and enforced by the engine © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A scenario can already tell the simulator how to run its world in prose (the
// simulation rules, the prompt editor). Prose is a request. This is the other
// half: a few settings an author sets as NUMBERS, which the engine applies to
// what the simulator is asked for and counts on what it answers
// (server/gameFeatures.js "worldDirection"; the scenario's value, a game's
// override).
//
// None of it costs a request. Each setting shapes the one request a time skip
// already makes, and where the answer falls short it is KEPT — sending it back
// is a whole second request, on a key that may allow a few hundred a day
// (requestBudget.js) — and the simulator is told at the top of its next turn
// (runtime/applicationReceipt.js, the "short" note).
//
// DELIBERATELY IMPORT-FREE: gameplay.js hands in the resolved settings.

const asArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value) => String(value ?? "").trim();

// --- Pace ---
//
// Scales the event count a period is asked for. The floor is one event, the
// upper end never falls below the lower, and a range that was a single number
// (a skip of a few hours is exactly one event) stays a single number: pace is
// about how crowded a month is, not about whether an afternoon happened.
export const scaleEventRange = (range, pacePercent = 100) => {
    const [min, max] = asArray(range).map((value) => Math.max(0, Math.round(Number(value) || 0)));
    // Number(null) is 0, and a pace of nothing is not a pace: both are the built-in one.
    const pace = pacePercent === null || pacePercent === undefined ? 100 : Number(pacePercent);
    if (!Number.isFinite(pace) || pace <= 0 || pace === 100 || !(min > 0) || min === max) return [min || 1, Math.max(min || 1, max || 1)];
    const scaledMin = Math.max(1, Math.round((min * pace) / 100));
    const scaledMax = Math.max(scaledMin, Math.round((max * pace) / 100));
    return [scaledMin, scaledMax];
};

// --- The world's share ---
//
// An event is the player's when the simulator says so (playerRelated) or when
// its own words name the player's polity: a model that under-declares cannot
// talk its way past the count. Whole words, case folded; a short name ("Ob") is
// matched the same way and simply matches rarely.
const fold = (value) => ` ${String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

export const eventConcernsPlayer = (event, playerNames = []) => {
    if (event?.playerRelated === true) return true;
    const text = fold(`${asText(event?.title)} ${asText(event?.description)}`);
    return asArray(playerNames).some((name) => {
        const needle = fold(name);
        // Three letters at least: " ob " is in half the paragraphs ever written.
        return needle.trim().length >= 3 && text.includes(needle);
    });
};

// Below this many events a share is not a meaningful thing to ask for.
export const WORLD_SHARE_MIN_EVENTS = 3;

// null when the floor is met (or does not apply); otherwise what to say.
export const worldShareShortfall = (events, floorPercent, { playerNames = [] } = {}) => {
    const list = asArray(events);
    const floor = Number(floorPercent);
    if (!(floor > 0) || list.length < WORLD_SHARE_MIN_EVENTS) return null;
    const needed = Math.ceil((list.length * Math.min(100, floor)) / 100);
    const world = list.filter((event) => !eventConcernsPlayer(event, playerNames)).length;
    if (world >= needed) return null;
    const player = asText(asArray(playerNames)[0]) || "the player's polity";
    return {
        total: list.length,
        world,
        needed,
        text: `${world} of your ${list.length} events ${world === 1 ? "was" : "were"} about the world beyond ${player}; this scenario asks for at least ${needed} (${Math.round(floor)}%). `
            + `Other powers act on each other whether or not ${player} is watching: give them events of their own, in theatres ${player} is not in.`,
    };
};

// --- Scripted events ---
//
// An author's history beats: one per line, dated, in the author's own words.
//
//   2014-05-25  Ukraine votes: Petro Poroshenko wins the presidency outright.
//   1918-11-11 — The armistice is signed at Compiègne; the guns fall silent at 11.
//   # a line without a date, or starting with #, is ignored
//
// The date is the first thing on the line (a year before AD 1 written with a
// leading minus, as everywhere in the game); what follows, after any dash or
// colon, is the beat. A beat is HISTORY in its world: the period that covers
// its date is asked to write it, and when the answer does not, the engine
// writes it — an author's beat does not depend on the model's mood, and asking
// again would be a whole second request.
const DATE_AT_START = /^\s*(-?\d{1,4}-\d{2}-\d{2})\s*(?:[—–\-:|]+\s*)?(.*)$/;

// A date as one number that sorts, negative years included: -0218-03-01 is
// -2180301 and falls before 0001-01-01.
export const dateKey = (iso) => {
    const match = /^(-?)(\d{1,4})-(\d{2})-(\d{2})$/.exec(asText(iso));
    if (!match) return null;
    const value = Number(match[2]) * 10000 + Number(match[3]) * 100 + Number(match[4]);
    return match[1] ? -value : value;
};

// The same date as a count of days, for "within a week of": proleptic
// Gregorian, and setUTCFullYear takes the years Date.UTC would misread (a year
// under 100, a year before 1).
const dayNumber = (iso) => {
    const match = /^(-?)(\d{1,4})-(\d{2})-(\d{2})$/.exec(asText(iso));
    if (!match) return null;
    const year = Number(match[2]) * (match[1] ? -1 : 1);
    const date = new Date(0);
    date.setUTCFullYear(year, Number(match[3]) - 1, Number(match[4]));
    const value = Math.round(date.getTime() / 86400000);
    return Number.isFinite(value) ? value : null;
};

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
            const beat = {
                date: match[1],
                title: (sentence ? sentence[1] : body).slice(0, 140).replace(/[.!?]$/, ""),
                text: body,
                impacts: emptyImpacts(),
                errors: [],
            };
            beats.push(beat);
            open = { beat, lines: [] };
            continue;
        }
        // An impact line: indented, or opened by a verb we know. Anything else
        // is the author's prose and is ignored, exactly as it was before.
        if (open && (rawLine !== line || IMPACT_VERBS.has(line.split(/\s+/)[0]))) open.lines.push(line);
    }
    close();
    return beats.sort((a, b) => dateKey(a.date) - dateKey(b.date));
};

// The inverse of the parser, so the builder can edit cards and write one
// string back. The title is derived (see parseScriptedEvents), never stored.
const quoteImpact = (value) => {
    const text = String(value ?? "");
    return /\s/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
};

const impactLinesFor = (impacts) => {
    const lines = [];
    const push = (line) => lines.push(`  ${line}`);
    const note = (entry) => (entry?.note ? ` note=${quoteImpact(entry.note)}` : "");
    for (const entry of asArray(impacts?.regionTransfers)) {
        push(`transfer ${quoteImpact(entry.regionName ?? entry.regionId)} -> ${quoteImpact(entry.toCode)}${entry.wholeCountry === true ? " wholeCountry=true" : ""}${entry.fromCode ? ` fromCode=${quoteImpact(entry.fromCode)}` : ""}${note(entry)}`);
    }
    for (const entry of asArray(impacts?.regionControlOps)) {
        const op = String(entry?.op ?? "control").toLowerCase();
        if (op === "contest") push(`contest ${quoteImpact(entry.regionName ?? entry.regionId)} by ${quoteImpact(entry.actorCode)}${note(entry)}`);
        else if (op === "clear_contest") push(`clear ${quoteImpact(entry.regionName ?? entry.regionId)} from ${quoteImpact(entry.claimantCode)}${note(entry)}`);
        else push(`control ${quoteImpact(entry.regionName ?? entry.regionId)} -> ${quoteImpact(entry.toCode)}${entry.wholeCountry === true ? " wholeCountry=true" : ""}${note(entry)}`);
    }
    for (const entry of asArray(impacts?.regionClaims)) {
        push(`${entry?.drop === true ? "unclaim" : "claim"} ${quoteImpact(entry.regionName ?? entry.regionId)} by ${quoteImpact(entry.claimantCode)}${note(entry)}`);
    }
    for (const entry of asArray(impacts?.polityChanges)) {
        push(`polity ${entry.operation} ${quoteImpact(entry.code)}${entry.name ? ` name=${quoteImpact(entry.name)}` : ""}${note(entry)}`);
    }
    for (const entry of asArray(impacts?.unitOps)) {
        const op = String(entry?.op ?? "").toLowerCase();
        const unit = entry?.unit && typeof entry.unit === "object" ? entry.unit : entry;
        const subject = op === "spawn" ? unit.name : entry.unitId;
        const fields = op === "spawn"
            ? `${unit.ownerCode ? ` ownerCode=${quoteImpact(unit.ownerCode)}` : ""}${unit.type ? ` type=${unit.type}` : ""}${Number.isFinite(Number(unit.strength)) ? ` strength=${unit.strength}` : ""}${unit.at ? ` at=${quoteImpact(unit.at)}` : ""}`
            : `${entry.at ? ` at=${quoteImpact(entry.at)}` : ""}${entry.regionId ? ` regionId=${quoteImpact(entry.regionId)}` : ""}${Number.isFinite(Number(entry.strength)) ? ` strength=${entry.strength}` : ""}`;
        push(`unit ${op} ${quoteImpact(subject)}${fields}${note(entry)}`);
    }
    for (const entry of asArray(impacts?.markerOps)) {
        const op = String(entry?.op ?? "").toLowerCase();
        const marker = entry?.marker && typeof entry.marker === "object" ? entry.marker : entry;
        const subject = op === "build" ? marker.name : entry.markerId;
        const fields = op === "build"
            ? `${marker.kind ? ` kind=${marker.kind}` : ""}${marker.ownerCode ? ` ownerCode=${quoteImpact(marker.ownerCode)}` : ""}${marker.at ? ` at=${quoteImpact(marker.at)}` : ""}`
            : `${entry.name ? ` name=${quoteImpact(entry.name)}` : ""}`;
        push(`marker ${op} ${quoteImpact(subject)}${fields}${note(entry)}`);
    }
    for (const entry of asArray(impacts?.projectOps)) {
        push(`project ${entry.op} ${quoteImpact(entry.name ?? entry.projectId)}${entry.status ? ` status=${entry.status}` : ""}${Number.isFinite(Number(entry.progress)) ? ` progress=${entry.progress}` : ""}${note(entry)}`);
    }
    for (const entry of asArray(impacts?.createdChats)) {
        push(`chat ${asArray(entry.countries).map(quoteImpact).join(", ")}${entry.title ? ` title=${quoteImpact(entry.title)}` : ""}`);
    }
    return lines;
};

export const serializeScriptedEvents = (beats) => {
    const blocks = [];
    const leftovers = [];
    for (const beat of asArray(beats)) {
        blocks.push([`${beat.date} ${beat.text}`, ...impactLinesFor(beat.impacts)].join("\n"));
        // A line the parser could not read is kept verbatim. It is re-emitted
        // after a blank line, where the parser never attaches it to a beat.
        for (const error of asArray(beat.errors)) leftovers.push(String(error).replace(/ — .*$/, ""));
    }
    const body = blocks.join("\n\n");
    if (!leftovers.length) return body;
    return `${body}\n\n# kept as written: the editor could not read these\n${leftovers.join("\n")}`;
};

// --- Scripted-event impacts ---
//
// An author's beat may say what it CHANGES, not only what happens: the indented
// lines under a beat line each name one engine impact. The verbs and their
// field names are the ones the model's impacts already use (gameplayPrompts.js),
// so nothing downstream learns a second vocabulary.

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

// Whitespace-separated, honouring double quotes with \" inside them. Null on an
// unbalanced quote, which the caller reports as a bad line rather than repairs.
const tokenizeImpact = (line) => {
    const tokens = [];
    let current = "";
    let quoted = false;
    let started = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "\\" && line[index + 1] === '"') { current += '"'; index += 1; started = true; continue; }
        if (char === '"') { quoted = !quoted; started = true; continue; }
        if (!quoted && /\s/.test(char)) {
            if (started || current) tokens.push(current);
            current = "";
            started = false;
            continue;
        }
        current += char;
        started = true;
    }
    if (quoted) return null;
    if (started || current) tokens.push(current);
    return tokens;
};

const readImpactFields = (tokens) => {
    const fields = {};
    for (const token of tokens) {
        const at = token.indexOf("=");
        if (at <= 0) return { error: `"${token}" is not a field=value pair` };
        const key = token.slice(0, at);
        const rawValue = token.slice(at + 1);
        if (rawValue === "") return { error: `the field "${key}" has no value` };
        if (BOOLEAN_FIELDS.has(key)) {
            if (rawValue !== "true" && rawValue !== "false") return { error: `the field "${key}" is true or false` };
            fields[key] = rawValue === "true";
            continue;
        }
        if (NUMERIC_FIELDS.has(key)) {
            if (!/^-?\d+(\.\d+)?$/.test(rawValue)) return { error: `the field "${key}" is a number` };
            fields[key] = Number(rawValue);
            continue;
        }
        if (LIST_FIELDS.has(key)) {
            fields[key] = rawValue.split(",").map((part) => part.trim()).filter(Boolean);
            continue;
        }
        fields[key] = rawValue;
    }
    return { fields };
};

// The operations each verb accepts, so "unit explode" is a bad line rather than
// a unit op the engine would refuse later with no explanation to the author.
const VERB_OPERATIONS = Object.freeze({
    polity: ["create", "restore", "update", "rename", "dissolve"],
    unit: ["spawn", "move", "strength", "remove"],
    marker: ["build", "update", "rename", "remove", "population"],
    project: ["create", "update", "milestone", "complete", "cancel", "fail", "remove"],
});

export const parseImpactLine = (line) => {
    const raw = asText(line);
    if (!raw) return { impacts: null, error: "the line is empty" };
    const tokens = tokenizeImpact(raw);
    if (!tokens || !tokens.length) return { impacts: null, error: "the line is empty" };
    const verb = tokens[0];
    const family = VERB_FAMILY[verb];
    if (!family) return { impacts: null, error: `unknown verb "${verb}"` };

    const after = tokens.slice(1);
    const positional = after.filter((token) => !token.includes("="));
    const sized = readImpactFields(after.filter((token) => token.includes("=")));
    if (sized.error) return { impacts: null, error: sized.error };
    const fields = sized.fields;
    const impacts = emptyImpacts();
    const need = (value, message) => (value ? null : message);

    if (verb === "transfer" || verb === "control") {
        const missing = need(positional[0], `"${verb}" needs a region`)
            || need(positional[1] === "->", `"${verb}" needs "->" between region and polity`)
            || need(positional[2], `"${verb}" needs the receiving polity after "->"`);
        if (missing) return { impacts: null, error: missing };
        const entry = { regionName: positional[0], toCode: positional[2], ...fields };
        impacts[family].push(verb === "control" ? { op: "control", ...entry } : entry);
        return { impacts, error: null };
    }

    if (verb === "contest" || verb === "clear" || verb === "claim" || verb === "unclaim") {
        const marker = verb === "clear" ? "from" : "by";
        const missing = need(positional[0], `"${verb}" needs a region`)
            || need(positional[1] === marker, `"${verb}" needs "${marker}" between region and polity`)
            || need(positional[2], `"${verb}" needs a polity after "${marker}"`);
        if (missing) return { impacts: null, error: missing };
        const who = positional[2];
        if (verb === "claim") impacts.regionClaims.push({ regionName: positional[0], claimantCode: who, ...fields });
        else if (verb === "unclaim") impacts.regionClaims.push({ regionName: positional[0], claimantCode: who, drop: true, ...fields });
        else if (verb === "contest") impacts.regionControlOps.push({ op: "contest", regionName: positional[0], actorCode: who, ...fields });
        else impacts.regionControlOps.push({ op: "clear_contest", regionName: positional[0], claimantCode: who, ...fields });
        return { impacts, error: null };
    }

    if (VERB_OPERATIONS[verb]) {
        const operation = positional[0];
        if (!VERB_OPERATIONS[verb].includes(operation)) {
            return { impacts: null, error: `"${verb}" has no operation "${operation ?? ""}"` };
        }
        const subject = positional[1];
        const named = need(subject, `"${verb} ${operation}" needs a name`);
        if (named) return { impacts: null, error: named };
        if (verb === "polity") impacts.polityChanges.push({ operation, code: subject, ...fields });
        else if (verb === "unit") impacts.unitOps.push(operation === "spawn" ? { op: operation, unit: { name: subject, ...fields } } : { op: operation, unitId: subject, ...fields });
        else if (verb === "marker") impacts.markerOps.push(operation === "build" ? { op: operation, marker: { name: subject, ...fields } } : { op: operation, markerId: subject, ...fields });
        else impacts.projectOps.push({ op: operation, name: subject, ...fields });
        return { impacts, error: null };
    }

    // chat: every positional token is a country, comma-separated lists allowed.
    const countries = positional.flatMap((part) => part.split(",")).map((part) => part.trim()).filter(Boolean);
    if (!countries.length) return { impacts: null, error: "chat needs at least one country" };
    impacts.createdChats.push({ countries, ...fields });
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

// The beats a period covers: after its origin (the day itself belongs to the
// period before) up to and including its target — except on a game's very
// first skip, whose origin day nobody covered.
export const scriptedBeatsInSpan = (beats, { originDate, targetDate, includeOrigin = false } = {}) => {
    const origin = dateKey(originDate);
    const target = dateKey(targetDate);
    if (origin === null || target === null) return [];
    return asArray(beats).filter((beat) => {
        const key = dateKey(beat?.date);
        return key !== null && (key > origin || (includeOrigin && key === origin)) && key <= target;
    });
};

const STOP_WORDS = new Set(["that", "this", "with", "from", "into", "over", "after", "before", "their", "there", "which", "while", "where", "when", "have", "been", "were", "will", "would", "than", "then", "them", "they", "against", "between", "under", "about", "through", "during", "first", "second", "third", "held", "holds", "hold", "makes", "made", "make", "takes", "take", "taken", "signed", "signs", "sign", "declares", "declared", "declare", "wins", "won", "win", "dies", "died", "die", "begins", "begin", "began", "ends", "end", "ended", "falls", "fall", "fell", "opens", "open", "opened", "government", "president", "minister", "state", "states", "national", "forces", "troops", "army", "city", "region", "country", "people", "power", "powers", "war", "treaty", "election", "elections", "vote", "votes"]);
const words = (text) => new Set(String(text ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)));

// Did the answer write this beat? An event within a week of the beat's date
// that shares enough of its particular words — names, places, the things that
// make it THIS beat rather than any election or any battle.
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

// The event the engine writes for a beat the answer left out: the author's own
// words, on the author's date, marked as the world's and as worth stopping for.
export const scriptedEventFor = (beat) => ({
    date: beat.date,
    title: beat.title,
    description: beat.text,
    importance: "major",
    kind: "world",
    tags: [],
    notable: true,
    playerRelated: false,
    impacts: {},
});

// The answer with every beat of the period in it: the ones it wrote as they
// are, the rest written by the engine. Pure; returns what was done.
export const ensureScriptedEvents = (events, beats) => {
    const list = [...asArray(events)];
    const written = [];
    const inserted = [];
    for (const beat of asArray(beats)) {
        if (beatIsWritten(beat, list)) written.push(beat);
        else { list.push(scriptedEventFor(beat)); inserted.push(beat); }
    }
    return { events: list, written, inserted };
};

// What the period is told about its beats: in the user message, beside the
// receipt, because they are this period's and not the whole game's.
export const buildScriptedEventsInstruction = (beats) => {
    const list = asArray(beats);
    if (!list.length) return "";
    return "[Scripted events this period — set by this scenario's author, checked by the engine]\n"
        + "These happen in this period. Write each as its own event, dated as given, in your own words and with the impacts it implies, and let the rest of the period feel its consequences. "
        + "They are history in this world: nothing you write may contradict or pre-empt them. One the answer leaves out is written by the engine in the author's words, without its impacts.\n"
        + list.map((beat) => `- ${beat.date} — ${beat.text}`).join("\n");
};

// --- The territory tempo ---
//
// How fast the map may move: regions changing hands per thirty days, counted
// over an answer's transfers and control changes in event order. Beyond the
// ceiling an entry is withheld — the front does not move that far this period
// — and the model is told, so the next period carries it on. A whole-country
// entry is the ceiling's worth by itself. 0 is no ceiling.
export const territoryTempoAllowance = (ceilingPerMonth, spanDays) => {
    const ceiling = Number(ceilingPerMonth);
    if (!(ceiling > 0)) return Infinity;
    return Math.max(1, Math.ceil((ceiling * Math.max(1, Number(spanDays) || 1)) / 30));
};

export const applyTerritoryTempo = (events, { ceilingPerMonth, spanDays } = {}) => {
    const allowance = territoryTempoAllowance(ceilingPerMonth, spanDays);
    const list = asArray(events);
    if (!Number.isFinite(allowance)) return { events: list, withheld: 0, allowance };
    let used = 0;
    let withheld = 0;
    const next = list.map((event) => {
        const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : null;
        if (!impacts) return event;
        // A border moves on a transfer and on a control op that says "control";
        // a contest opened or cleared moves nothing and is never withheld.
        const keep = (entry) => {
            const cost = entry?.wholeCountry ? allowance : 1;
            if (used + cost > allowance) { withheld += 1; return false; }
            used += cost;
            return true;
        };
        const transfers = asArray(impacts.regionTransfers).filter((entry) => keep(entry));
        const control = asArray(impacts.regionControlOps).filter((entry) => (String(entry?.op ?? "").toLowerCase() === "control" ? keep(entry) : true));
        if (transfers.length === asArray(impacts.regionTransfers).length && control.length === asArray(impacts.regionControlOps).length) return event;
        return { ...event, impacts: { ...impacts, regionTransfers: transfers, regionControlOps: control } };
    });
    return { events: next, withheld, allowance };
};

// --- What the simulator is told ---
//
// Written LAST in the jump's instructions, where a long prompt is followed best,
// and marked as the author's. The priority rules say in so many words that they
// outrank the defaults and the field descriptions of the output function —
// without that, a rule like "no nuclear weapons before 1945" loses to a field
// description that lists nuclear programmes as a thing a polity can start.
export const PRIORITY_RULES_HEADING = "[PRIORITY RULES — set by this scenario's author]";

export const buildWorldDirectionDirective = (direction, { playerPolity = "", spanDays = 30 } = {}) => {
    if (!direction) return "";
    const player = asText(playerPolity) || "the player's polity";
    const parts = [];
    const share = Number(direction.worldShare);
    if (share > 0) {
        parts.push(
            "[The World's Share — counted by the engine]\n"
            + `At least ${Math.round(share)}% of this period's events must be developments that do not involve ${player} at all: other powers acting on each other, in theatres ${player} is not in. `
            + `An event that names ${player}, or that you mark playerRelated, counts as ${player}'s. The engine counts this on every answer and tells you when you fall short. `
            + `This is a floor on how much of the world you show, NOT a ceiling on what the world does to ${player}: meet it by writing more elsewhere, never by leaving a rival's move against the player unwritten.`,
        );
    }
    const tempo = Number(direction.territoryTempo);
    if (tempo > 0) {
        const allowance = territoryTempoAllowance(tempo, spanDays);
        parts.push(
            "[The Map's Tempo — counted by the engine]\n"
            + `In this scenario the map moves no faster than ${Math.round(tempo)} region${Math.round(tempo) === 1 ? "" : "s"} per thirty days: ${allowance} this period, across every regionTransfers entry and every regionControlOps control, counted in event order. `
            + "Beyond that the engine withholds the entry and tells you. Write fronts that grind — a river line held, a siege that drags — rather than sweeps.",
        );
    }
    const rules = asText(direction.priorityRules);
    if (rules) {
        parts.push(
            `${PRIORITY_RULES_HEADING}\n`
            + "These rules outrank everything else you have been told: the default guidance above, the simulation rules, and anything a field description of the output function suggests is possible. "
            + "Where a rule and a default disagree, the rule wins, without exception and without comment in the events.\n"
            + rules,
        );
    }
    return parts.join("\n\n");
};
