/*! Open Historia - deterministic strategic menu: the legal choices a decision picks from (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run the tests: node --test src/engine/strategicIntent.test.js
//
// The law, not advice. An opponent's mind may be the model's, but what it is
// ALLOWED to do is derived here, from compact facts the world already carries,
// and re-derived the same way before anything is applied. A menu entry names the
// option and the reason it is legal, never a recommendation; the model keeps the
// choice inside it.
//
// The module imports nothing: every input is a compact fact set, so the same
// facts yield the same menu in any process.

export const WAR_GOALS = Object.freeze(["annex", "reparations", "status_quo"]);

// A menu is a prompt budget, not a catalogue: a bound on each kind keeps the
// report a fixed size no matter how large the map grows.
export const MAX_DECLARATIONS = 6;
export const MAX_CLAIMS = 6;

const asName = (value) => String(value ?? "").trim();
const key = (value) => asName(value).toLowerCase();
const asList = (value) => (Array.isArray(value) ? value : []);

// A stable war id from the two sides, so a declaration the model narrates can
// carry the very id the ledger stores. A clash with an existing war takes the
// next free suffix rather than reusing an id already spoken for.
export const warIdFor = (actor, target, existingIds = []) => {
  const taken = new Set(asList(existingIds).map(key));
  const slug = (value) => key(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const base = `war-${slug(actor) || "actor"}-${slug(target) || "target"}`;
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-x`;
};

// The legal choices for one actor. `actor` is `{ polity, existingWarIds }`;
// `targets` are the other polities in play, each carrying whether it is already
// at war with the actor, whether it holds land the actor claims, and whether it
// is recorded as having breached an agreement against the actor. `regions` are
// the regions the actor could claim, each with its present owner.
export const deriveIntentMenu = ({ actor = {}, targets = [], regions = [] } = {}) => {
  const polity = asName(actor.polity);
  const actorKey = key(polity);
  const existingWarIds = asList(actor.existingWarIds).map(asName).filter(Boolean);
  const declareWar = [];
  const pressClaim = [];
  const seenTargets = new Set();

  for (const target of asList(targets)) {
    const name = asName(target?.polity);
    const targetKey = key(name);
    if (!name || !actorKey || targetKey === actorKey) continue;
    if (seenTargets.has(targetKey)) continue;
    if (target?.atWar === true) continue;
    seenTargets.add(targetKey);
    const reasons = [];
    if (target?.holdsActorClaim === true) reasons.push("standing claim");
    if (target?.breachedActor === true) reasons.push("recorded breach");
    declareWar.push({
      target: name,
      warId: warIdFor(polity, name, existingWarIds),
      justified: reasons.length > 0,
      reasons,
      goals: WAR_GOALS,
    });
    if (declareWar.length >= MAX_DECLARATIONS) break;
  }

  const seenRegions = new Set();
  for (const region of asList(regions)) {
    const regionId = asName(region?.regionId);
    const owner = asName(region?.owner);
    if (!regionId || !actorKey || seenRegions.has(regionId)) continue;
    if (!owner || key(owner) === actorKey) continue;
    if (region?.claimedByActor === true) continue;
    seenRegions.add(regionId);
    pressClaim.push({ regionId, owner, justified: true, reasons: ["not already held"] });
    if (pressClaim.length >= MAX_CLAIMS) break;
  }

  return { polity, declareWar, pressClaim };
};
