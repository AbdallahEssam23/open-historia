/*! Open Historia - the notice that the engine held a war open (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The engine withholds a record that would close the player's offered war, so
// the war stays on the map. The turn's receipt says so for the model; this says
// it once for the player, as the turn lands. It is transient by design: the
// durable fact is world.peaceOffer, which the peace panel already shows.

import React, { useEffect, useState } from "react";
import { useIsMobile } from "../../runtime/useIsMobile.js";
import { WAR_HELD_EVENT } from "../../runtime/warHoldNotice.js";

const SHOW_MS = 14000;

const noticeStyle = {
  position: "fixed",
  top: "8.5rem",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 9999,
  display: "flex",
  alignItems: "flex-start",
  gap: "0.6rem",
  maxWidth: "min(34rem, calc(100vw - 2rem))",
  padding: "0.6rem 0.8rem",
  borderRadius: "12px",
  border: "1px solid rgba(250,204,21,0.32)",
  backgroundColor: "rgba(24,20,10,0.96)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
  color: "#fde68a",
  fontFamily: "var(--oh-font-ui)",
  fontSize: "0.76rem",
  lineHeight: 1.45,
  pointerEvents: "auto",
};

// Below the fallback notice's own band, so the two never paint over each other
// when a single turn both switches the model and holds a war.
const phoneNoticeStyle = {
  top: "9rem",
  width: "max-content",
};

export const WarHoldNotice = () => {
  const [notices, setNotices] = useState([]); // [{ id, message }]
  const isMobile = useIsMobile();

  useEffect(() => {
    const timers = new Set();
    const onHeld = (event) => {
      const message = String(event.detail?.message ?? "").trim();
      if (!message) return;
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setNotices((current) => [...current.filter((notice) => notice.message !== message), { id, message }].slice(-3));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setNotices((current) => current.filter((notice) => notice.id !== id));
      }, SHOW_MS);
      timers.add(timer);
    };
    window.addEventListener(WAR_HELD_EVENT, onHeld);
    return () => {
      window.removeEventListener(WAR_HELD_EVENT, onHeld);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (!notices.length) return null;
  return (
    <div role="status" aria-live="polite" style={{ ...noticeStyle, flexDirection: "column", ...(isMobile ? phoneNoticeStyle : null) }}>
      {notices.map((notice) => (
        <div key={notice.id} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", width: "100%" }}>
          <span aria-hidden="true" style={{ color: "#facc15", fontWeight: 800 }}>!</span>
          <span style={{ flex: 1 }}>{notice.message}</span>
          <button
            type="button"
            className="oh-tap"
            aria-label="Dismiss"
            onClick={() => setNotices((current) => current.filter((item) => item.id !== notice.id))}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
};

export default WarHoldNotice;
