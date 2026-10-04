/*! Open Historia - the peace the engine offers the player (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The terms settleWar derived for one of the player's own wars, shown for a
// plain accept or decline. No narration and no request: the engine decided the
// terms, the player decides whether to take them.
import React, { useState } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { acceptPeaceOffer, declinePeaceOffer } from "../AI/gameplayLazy.js";

const termsOf = (offer) => {
  if (!offer) return [];
  const others = (offer.belligerents ?? []).filter(Boolean).join(", ");
  const lines = [`The war ${offer.warId} against ${others || "the other side"}:`];
  if (offer.white) lines.push("A white peace: no land and no reparations change hands.");
  for (const transfer of offer.transfers ?? []) {
    lines.push(`${transfer.regionId} passes from ${transfer.fromCode || "the loser"} to ${transfer.toCode || "the victor"}.`);
  }
  const { manpower = 0, materiel = 0 } = offer.reparations ?? {};
  if (manpower || materiel) {
    lines.push(`Reparations of ${manpower} manpower and ${materiel} materiel are paid.`);
  }
  if (offer.punitive && offer.white === false) lines.push("The terms are punitive.");
  return lines;
};

const backdrop = { background: "rgba(0,0,0,0.55)", inset: 0, position: "fixed", zIndex: 10001 };
const panel = {
  background: "rgba(18,18,22,0.97)",
  border: "1px solid rgba(250,204,21,0.38)",
  borderRadius: "16px",
  color: "white",
  fontFamily: "var(--oh-font-ui)",
  left: "50%",
  maxWidth: "34rem",
  padding: "1.1rem 1.2rem",
  position: "fixed",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "calc(100vw - 2rem)",
  zIndex: 10002,
};
const button = (primary, disabled) => ({
  background: primary ? "#facc15" : "rgba(255,255,255,0.06)",
  border: primary ? "none" : "1px solid rgba(255,255,255,0.16)",
  borderRadius: "10px",
  color: primary ? "#1c1917" : "rgba(255,255,255,0.85)",
  cursor: disabled ? "default" : "pointer",
  fontFamily: "inherit",
  fontSize: "0.82rem",
  fontWeight: 800,
  padding: "0.6rem 1rem",
});

export const PeaceOfferPanel = () => {
  const offer = useRuntimeState("world", (world) => world?.peaceOffer ?? null);
  const [busy, setBusy] = useState("");
  if (!offer) return null;

  const run = async (label, work) => {
    if (busy) return;
    setBusy(label);
    try {
      await work();
    } catch {
      // The offer is re-read from state; a failed action simply leaves it up.
    } finally {
      setBusy("");
    }
  };

  return (
    <div style={backdrop}>
      <div data-no-translate style={panel}>
        <div style={{ fontSize: "0.95rem", fontWeight: 800, marginBottom: "0.5rem" }}>A peace is offered</div>
        <div style={{ fontSize: "0.84rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {termsOf(offer).join("\n")}
        </div>
        <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "0.9rem" }}>
          <button style={button(false, Boolean(busy))} disabled={Boolean(busy)} onClick={() => run("decline", declinePeaceOffer)}>
            Decline
          </button>
          <button style={button(true, Boolean(busy))} disabled={Boolean(busy)} onClick={() => run("accept", acceptPeaceOffer)}>
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default PeaceOfferPanel;
