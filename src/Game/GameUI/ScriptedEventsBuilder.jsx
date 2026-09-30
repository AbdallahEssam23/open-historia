/*! Open Historia — the Scripted events builder in the scenario and game editors © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { useTouchPrimary } from "../../runtime/mobileUi.js";
import { getPrimedScenarioRegionCatalog } from "../../runtime/assets.js";
import { IMPACT_FAMILIES, parseImpactLine, parseScriptedEvents, serializeScriptedEvents } from "../AI/worldDirection.js";

// A card view over the same text the setting already holds. The text is the
// source of truth: every edit re-serialises it. A line the parser could not read
// turns the cards off and is kept verbatim by the serialiser, so nothing an
// author typed is ever dropped.
const FAMILY_LABEL = {
  regionTransfers: "Territory",
  regionControlOps: "Control",
  regionClaims: "Claims",
  polityChanges: "Polities",
  unitOps: "Military",
  markerOps: "Structures",
  projectOps: "Projects",
  createdChats: "Chats",
};

const IMPACT_HELP = "transfer, control, contest, clear, claim, unclaim, polity, unit, marker, project, chat";

// Region names for the autocomplete. The catalog is primed by Nations before a
// player can reach an editor, and this listens for the priming event so a cold
// open still fills in once geometry parses.
const useRegionSuggestions = () => {
  const read = () => (getPrimedScenarioRegionCatalog() ?? []).map((region) => region?.name).filter(Boolean);
  const [regions, setRegions] = React.useState(read);
  React.useEffect(() => {
    const bump = () => setRegions(read());
    window.addEventListener("oh:region-catalog-primed", bump);
    bump();
    return () => window.removeEventListener("oh:region-catalog-primed", bump);
  }, []);
  return regions;
};

const ScriptedEventsBuilder = ({ value, onChange, maxLength = 20000, suggestions = { regions: [], polities: [] }, styles = {} }) => {
  const touch = useTouchPrimary();
  const primed = useRegionSuggestions();
  const [raw, setRaw] = React.useState(false);
  const [line, setLine] = React.useState({});
  const [lineError, setLineError] = React.useState({});
  const beats = React.useMemo(() => parseScriptedEvents(value), [value]);
  const regionNames = suggestions.regions?.length ? suggestions.regions : primed;
  const errors = beats.flatMap((beat, index) => beat.errors.map((text) => ({ beat: index + 1, text })));
  const write = (next) => onChange(serializeScriptedEvents(next));
  const patchBeat = (index, patch) => write(beats.map((beat, at) => (at === index ? { ...beat, ...patch } : beat)));
  const moveBeat = (index, delta) => {
    const next = beats.slice();
    const [moved] = next.splice(index, 1);
    next.splice(index + delta, 0, moved);
    write(next);
  };
  const row = (active) => ({
    ...styles.actionButtonStyle,
    minHeight: touch ? undefined : "1.7rem",
    padding: "0 0.55rem",
    opacity: active ? 1 : 0.45,
  });
  // One impact line at a time: parse it with the same parser the game uses, and
  // fold it into the beat. A bad line is shown where it was typed, never lost.
  const addImpact = (index) => {
    const text = String(line[index] ?? "").trim();
    if (!text) return;
    const { impacts, error } = parseImpactLine(text);
    if (error || !impacts) {
      setLineError((current) => ({ ...current, [index]: error }));
      return;
    }
    const beat = beats[index];
    const merged = { ...beat.impacts };
    for (const family of IMPACT_FAMILIES) merged[family] = [...(merged[family] ?? []), ...impacts[family]];
    setLineError((current) => ({ ...current, [index]: null }));
    setLine((current) => ({ ...current, [index]: "" }));
    patchBeat(index, { impacts: merged });
  };

  return (
    <div style={{ marginTop: "0.4rem" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <button type="button" className="oh-tap-row" style={row(raw)} onClick={() => setRaw(!raw)}>
          {raw ? "Show the cards" : "Edit as raw text"}
        </button>
        <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem" }}>
          {String(value ?? "").length} / {maxLength} characters
        </span>
      </div>
      {errors.length > 0 && (
        <div style={{ background: "rgba(255,120,120,0.08)", border: "1px solid rgba(255,120,120,0.3)", borderRadius: "12px", color: "rgba(255,200,200,0.95)", fontSize: "0.76rem", lineHeight: 1.5, marginBottom: "0.6rem", padding: "0.6rem" }}>
          The editor could not read {errors.length} line{errors.length === 1 ? "" : "s"}. They are kept as written and the game ignores them. Fix them below and the cards come back.
          {errors.map((error, index) => (
            <div key={index} style={{ marginTop: "0.25rem" }}>After event {error.beat}: {error.text}</div>
          ))}
        </div>
      )}
      {(raw || errors.length > 0) && (
        <textarea
          data-no-translate
          rows={12}
          maxLength={maxLength}
          style={{ ...styles.inputStyle, fontFamily: "inherit", lineHeight: 1.45, minHeight: "8rem", resize: "vertical", width: "100%" }}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {!raw && errors.length === 0 && (
        <div style={{ display: "grid", gap: "0.7rem" }}>
          {beats.length === 0 && (
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.78rem" }}>No events yet.</div>
          )}
          {beats.map((beat, index) => (
            <div key={`${beat.date}-${index}`} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "0.7rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                <input
                  data-no-translate
                  type="text"
                  style={{ ...styles.inputStyle, width: "9rem" }}
                  value={beat.date}
                  onChange={(event) => patchBeat(index, { date: event.target.value })}
                />
                <button type="button" className="oh-tap" disabled={index === 0} style={row(index !== 0)} onClick={() => moveBeat(index, -1)}>↑</button>
                <button type="button" className="oh-tap" disabled={index === beats.length - 1} style={row(index !== beats.length - 1)} onClick={() => moveBeat(index, 1)}>↓</button>
                <button type="button" className="oh-tap" style={row(true)} onClick={() => write([...beats.slice(0, index + 1), { ...beat, impacts: beat.impacts, errors: [] }, ...beats.slice(index + 1)])}>Duplicate</button>
                <button type="button" className="oh-tap" style={row(true)} onClick={() => write(beats.filter((_, at) => at !== index))}>Remove</button>
              </div>
              <textarea
                data-no-translate
                rows={2}
                style={{ ...styles.inputStyle, marginTop: "0.4rem", width: "100%" }}
                value={beat.text}
                onChange={(event) => patchBeat(index, { text: event.target.value })}
              />
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.2rem" }}>
                Title shown in the timeline: {beat.title || "(from the first sentence)"}
              </div>
              <div style={{ display: "grid", gap: "0.4rem", marginTop: "0.5rem" }}>
                {IMPACT_FAMILIES.flatMap((family) => (beat.impacts?.[family] ?? []).map((entry, entryIndex) => (
                  <div key={`${family}-${entryIndex}`} style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.74rem" }}>{FAMILY_LABEL[family]}</span>
                    <span data-no-translate style={{ fontSize: "0.78rem" }}>{JSON.stringify(entry)}</span>
                    <button
                      type="button"
                      className="oh-tap"
                      style={row(true)}
                      onClick={() => patchBeat(index, { impacts: { ...beat.impacts, [family]: beat.impacts[family].filter((_, at) => at !== entryIndex) } })}
                    >
                      Remove
                    </button>
                  </div>
                )))}
              </div>
              <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.5rem" }}>
                <input
                  data-no-translate
                  type="text"
                  list={regionNames.length > 0 ? "scripted-event-regions" : undefined}
                  placeholder="transfer Sarajevo -> Austria-Hungary"
                  style={{ ...styles.inputStyle, flex: "1 1 16rem", minWidth: "10rem" }}
                  value={line[index] ?? ""}
                  onChange={(event) => setLine((current) => ({ ...current, [index]: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addImpact(index); } }}
                />
                <button type="button" className="oh-tap-row" style={row(true)} onClick={() => addImpact(index)}>+ Add impact</button>
              </div>
              {lineError[index] && (
                <div style={{ color: "rgba(255,200,200,0.95)", fontSize: "0.72rem", marginTop: "0.25rem" }}>{lineError[index]}</div>
              )}
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.72rem", marginTop: "0.35rem" }}>
                A line starts with one of: {IMPACT_HELP}.
              </div>
              {regionNames.length > 0 && (
                <datalist id="scripted-event-regions">
                  {regionNames.map((name) => (<option key={name} value={name} />))}
                </datalist>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScriptedEventsBuilder;
