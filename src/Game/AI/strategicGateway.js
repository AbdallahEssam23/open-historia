// Open Historia - strategic decision gateway (c) 2026 Nicholas Krol,
// AGPL-3.0-or-later (see LICENSE).
//
// The one door between a model's chosen intent and the world. The model picks
// from the menu it was shown; this gateway re-derives that menu from the same
// world the turn will apply to and refuses anything outside it, so a stale or
// invented option cannot pass. An accepted `declare_war` becomes the ledger
// records the war path already understands; an accepted `press_claim` becomes a
// claim op the impact path already understands. The engine owns the law and the
// physics; the choice stays the model's.

import { WAR_GOALS, deriveIntentMenu } from "../../engine/strategicIntent.js";
import { strategicInputsFor } from "../../runtime/opponentContext.js";
import { decodeWarUpdates } from "./nativeWarLedger.js";

export const MAX_STRATEGIC_INTENTS = 12;
const SEPARATOR = "~";

const asName = (value) => String(value ?? "").trim();
const asList = (value) => (Array.isArray(value) ? value : []);
const key = (value) => asName(value).toLowerCase();

// The incoming war records, from either an already-decoded array (the apply-time
// list) or the model's own newline-separated string (the segment payload). The
// original entries are preserved verbatim; only a decoded view is built for the
// duplicate check below.
const asRecords = (value) => {
  if (Array.isArray(value)) return value;
  const text = asName(value);
  return text ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
};

// The event the model stamped with the option's warId, which the prompt tells it
// to use for the declaration. The ledger then validates that the event really
// narrates a war beginning, so the gateway binds only what the model wrote.
const declarationEventIndex = (events, warId) =>
  asList(events).findIndex((event) => asName(event?.warId) === warId);

// op~polity~target~goal~regions~note. The first five fields are cut on the
// separator; the note is everything left, so a note may contain the separator.
const parseIntentRecord = (line) => {
  const text = asName(line);
  if (!text) return null;
  const fields = [];
  let rest = text;
  for (let cut = 0; cut < 5; cut += 1) {
    const pos = rest.indexOf(SEPARATOR);
    if (pos < 0) {
      fields.push(rest);
      rest = "";
      break;
    }
    fields.push(rest.slice(0, pos));
    rest = rest.slice(pos + 1);
  }
  while (fields.length < 5) fields.push("");
  const [opRaw, polityRaw, targetRaw, goalRaw, regionsRaw] = fields;
  return {
    op: asName(opRaw).toLowerCase().replace(/[ -]+/g, "_"),
    polity: asName(polityRaw),
    target: asName(targetRaw),
    goal: asName(goalRaw).toLowerCase(),
    regionIds: asName(regionsRaw).split(/[|,]/).map(asName).filter(Boolean),
    note: asName(rest),
  };
};

// A model answer, from the compact string lines or from an array either of
// lines or of already-decoded objects. Empty or unusable input is an empty list,
// never a throw: this is the inert path every existing turn takes.
export const decodeStrategicIntents = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return parseIntentRecord(entry);
        if (!entry || typeof entry !== "object") return null;
        const op = asName(entry.op).toLowerCase().replace(/[ -]+/g, "_");
        const regionIds = asList(entry.regionIds).map(asName).filter(Boolean);
        return {
          op,
          polity: asName(entry.polity ?? entry.actor),
          target: asName(entry.target),
          goal: asName(entry.goal).toLowerCase(),
          regionIds: regionIds.length ? regionIds : asName(entry.regions).split(/[|,]/).map(asName).filter(Boolean),
          note: asName(entry.note),
        };
      })
      .filter(Boolean)
      .slice(0, MAX_STRATEGIC_INTENTS);
  }
  return String(value ?? "")
    .split(/\r?\n/)
    .map(parseIntentRecord)
    .filter(Boolean)
    .slice(0, MAX_STRATEGIC_INTENTS);
};

const startRecord = ({ actor, target, warId, goal, note }) => ({
  id: warId,
  op: "start",
  // The declaration's own side first, so the ledger reads the actor as its
  // aggressor exactly as an authored start would.
  actors: [actor],
  opponents: [target],
  eventIndexes: [],
  eventIds: [],
  note: note || `${actor} declared war on ${target}.`,
  goal,
});

const goalsRecord = ({ warId, actor, goal }) => ({
  id: warId,
  op: "goals",
  actors: [`${actor}:${goal}`],
  opponents: [],
  eventIndexes: [],
  eventIds: [],
  note: "",
});

// Apply the model's chosen intents against the world, re-deriving the menu for
// each named actor. An accepted `declare_war` becomes a start record bound to
// the event that narrates it (the event is stamped with the engine's war id) and
// a goals record; an accepted `press_claim` becomes a claim op. A pair the model
// already opened through `warUpdates` keeps that direct record and the duplicate
// intent is dropped, so one war has one authority either way. Mutates the events
// array in place only to stamp a declaration's id. Returns a NEW war-update list,
// the claim ops, and what was accepted and refused. Not a throw on any input.
export const applyStrategicIntents = ({
  world,
  intents,
  warUpdates = [],
  regions = [],
  events = [],
  playerPolity = "",
} = {}) => {
  const decoded = decodeStrategicIntents(intents);
  const keptWarUpdates = asRecords(warUpdates);
  if (!decoded.length) {
    return { warUpdates: keptWarUpdates, claimOps: [], accepted: { declareWar: [], pressClaim: [], seekPeace: [] }, rejected: [] };
  }

  const eventList = asList(events);
  // The incoming records as the ledger sees them, so the duplicate check reads
  // the same actor/opponent fields whether the list arrived as lines or objects.
  const incoming = decodeWarUpdates(keptWarUpdates);

  const accepted = { declareWar: [], pressClaim: [], seekPeace: [] };
  const rejected = [];
  const generated = [];
  const claimOps = [];
  const menuCache = new Map();
  const menuFor = (polity) => {
    const cacheKey = key(polity);
    if (!menuCache.has(cacheKey)) {
      menuCache.set(cacheKey, deriveIntentMenu(strategicInputsFor(world, polity, { regions, playerPolity })));
    }
    return menuCache.get(cacheKey);
  };

  for (const intent of decoded) {
    if (!intent.polity) {
      rejected.push({ op: intent.op, polity: "", target: intent.target, reason: "no actor named" });
      continue;
    }
    const menu = menuFor(intent.polity);

    if (intent.op === "declare_war") {
      // A start record for the same pair is this intent already translated (the
      // segment pass wrote it so the ledger could see the declaration's event) or
      // the model having used the legacy channel. Either way the direct record
      // stands and the intent is the duplicate that goes, so one war has one
      // authority. Checked before legality: an applied war is not re-litigated.
      const pair = `${key(intent.polity)}|${key(intent.target)}`;
      const existing = incoming.find(
        (update) => key(update?.op) === "start" && `${key(update?.actors?.[0])}|${key(update?.opponents?.[0])}` === pair,
      );
      if (existing) {
        accepted.declareWar.push({ actor: menu.polity, target: intent.target, warId: asName(existing.id), existing: true });
        continue;
      }
      const option = menu.declareWar.find((entry) => key(entry.target) === key(intent.target));
      if (!option) {
        rejected.push({ op: "declare_war", polity: intent.polity, target: intent.target, reason: "not a legal target this turn" });
        continue;
      }
      const eventIndex = declarationEventIndex(eventList, option.warId);
      if (eventIndex < 0) {
        rejected.push({ op: "declare_war", polity: intent.polity, target: option.target, reason: "no event narrates the declaration" });
        continue;
      }
      // The goal is a closed list; an absent or unrecognised value falls to the
      // least aggressive aim rather than losing the declaration over a label.
      const goal = WAR_GOALS.includes(intent.goal) ? intent.goal : "status_quo";
      const declaration = startRecord({ actor: menu.polity, target: option.target, warId: option.warId, goal, note: intent.note });
      declaration.eventIndexes = [eventIndex];
      eventList[eventIndex] = { ...eventList[eventIndex], warId: option.warId };
      generated.push(declaration);
      generated.push(goalsRecord({ warId: option.warId, actor: menu.polity, goal }));
      accepted.declareWar.push({ actor: menu.polity, target: option.target, warId: option.warId, goal, justified: option.justified, reasons: option.reasons });
      continue;
    }

    if (intent.op === "press_claim") {
      if (!intent.regionIds.length) {
        rejected.push({ op: "press_claim", polity: intent.polity, reason: "no region named" });
        continue;
      }
      for (const regionId of intent.regionIds) {
        const option = menu.pressClaim.find((entry) => entry.regionId === regionId);
        if (!option) {
          rejected.push({ op: "press_claim", polity: intent.polity, regionId, reason: "not a region it may claim this turn" });
          continue;
        }
        claimOps.push({ regionId: option.regionId, claimantCode: menu.polity, note: intent.note });
        accepted.pressClaim.push({ actor: menu.polity, regionId: option.regionId, owner: option.owner });
      }
      continue;
    }

    if (intent.op === "seek_peace") {
      // `target` carries the war id the menu printed, so a power with two wars
      // against the same enemy is unambiguous. Nothing is applied here: the terms
      // depend on this turn's battle, which only the settlement phase has.
      const warId = asName(intent.target);
      if (!warId) {
        rejected.push({ op: "seek_peace", polity: intent.polity, reason: "no war named" });
        continue;
      }
      const option = menu.seekPeace.find((entry) => asName(entry.warId) === warId);
      if (!option) {
        rejected.push({ op: "seek_peace", polity: intent.polity, warId, reason: "not a war it may seek peace in this turn" });
        continue;
      }
      accepted.seekPeace.push({ actor: menu.polity, target: option.opponent, warId: option.warId, party: option.party === true });
      continue;
    }

    rejected.push({ op: intent.op, polity: intent.polity, reason: "unknown intent" });
  }

  return { warUpdates: [...keptWarUpdates, ...generated], claimOps, accepted, rejected };
};
