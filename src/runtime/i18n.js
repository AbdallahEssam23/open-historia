/*! Open Historia — language setting & language catalog © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// UI language: chosen in Settings, stored on the SERVER (shared by every
// device that plays through it — desktop browser and the Android app see the
// same choice) and mirrored in localStorage so boot doesn't wait on a fetch.
// The game ships two languages: Arabic (the default) and English, the language
// the game is authored in (SOURCE_LANGUAGE) — choosing it means no translation
// work happens at all.
const STORAGE_KEY = "ui_language";
export const DEFAULT_LANGUAGE = "ar";
// The language the source strings are written in. It has no pack: the authored
// text IS the interface, so nothing needs translating in it.
export const SOURCE_LANGUAGE = "en";

// What the advisor and diplomatic chats reply in, so the interface can be read
// in one language and the chats held in another. Defaults to the UI language —
// an unset value follows it — and a player can pick a different chat language.
// Device-local: it only steers prompts.
const CHAT_STORAGE_KEY = "ai_chat_language";

// The languages a player can pick: Arabic first (the default), English second
// (the authored language, read as written). Recognizable English name first,
// endonym after.
export const LANGUAGES = [
  { code: "ar", name: "Arabic", native: "العربية" },
  { code: "en", name: "English", native: "English" },
];

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

// The languages the game ships a complete pack for (public/lang/<code>.json,
// every fixed string of the interface, and public/lang/prompts/<code>.json,
// the prompts' guidance passages; scripts/i18n/). In these the interface is
// never sent to the AI: the pack has it, and a string it lacks stays English
// rather than costing the player a request. Only what a scenario or a player
// made (scenario and game names and descriptions, custom polities, custom
// stats, region names on a hand-drawn map, community posts) is translated live.
// English (SOURCE_LANGUAGE) has no pack: its strings are the source itself.
export const SHIPPED_PACK_LANGUAGES = Object.freeze([
  "ar",
]);

export const hasShippedPack = (code) => SHIPPED_PACK_LANGUAGES.includes(code);

export const getLanguageOptions = () => LANGUAGES;

export const languageDisplayName = (code) =>
  LANGUAGES.find((entry) => entry.code === code)?.name || code;

// A stored code the picker no longer offers (a language this build dropped, or
// a hand-edited value) falls back to the default rather than stranding the
// player on an interface nothing can render.
export const normalizeLanguage = (code) =>
  typeof code === "string" && LANGUAGES.some((entry) => entry.code === code.trim())
    ? code.trim()
    : DEFAULT_LANGUAGE;

export const getStoredLanguage = () => {
  try {
    return normalizeLanguage(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
};

const writeLocalLanguage = (code) => {
  try {
    if (!code || code === DEFAULT_LANGUAGE) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, code);
    }
  } catch {
    // Private-mode storage failures just leave the game in English.
  }
};

// Persist locally AND on the server, so the choice follows the player to
// every device connected to this server (the Android app included).
export const setStoredLanguage = async (code) => {
  writeLocalLanguage(code);
  try {
    await fetch("/api/ui-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: code || DEFAULT_LANGUAGE }),
    });
  } catch {
    // Offline/hub-hosted: the local copy still applies on this device.
  }
};

// Boot-time reconcile: the server's choice wins. Returns true when the local
// value changed (caller reloads so the translator restarts cleanly).
export const syncLanguageFromServer = async () => {
  try {
    const response = await fetch("/api/ui-settings");
    if (!response.ok) {
      return false;
    }

    const settings = await response.json();
    const serverLanguage = normalizeLanguage(settings?.language);

    if (serverLanguage !== getStoredLanguage()) {
      writeLocalLanguage(serverLanguage);
      return true;
    }
  } catch {
    // Server unreachable: keep the local value.
  }

  return false;
};

export const getStoredChatLanguage = () => {
  try {
    // No explicit choice ⇒ follow the UI language.
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    return stored && stored.trim() ? normalizeLanguage(stored) : getStoredLanguage();
  } catch {
    return getStoredLanguage();
  }
};

export const setStoredChatLanguage = (code) => {
  try {
    if (!code) {
      localStorage.removeItem(CHAT_STORAGE_KEY);
    } else {
      localStorage.setItem(CHAT_STORAGE_KEY, code);
    }
  } catch {
    // Private-mode storage failures just leave the chats on the UI language.
  }
};

// getStoredChatLanguage already falls back to the UI language when unset, so
// this is just the stored (or inherited) code — no "auto" sentinel any more.
export const resolveChatLanguage = () => getStoredChatLanguage();

export const chatLanguageDiffersFromUi = () => resolveChatLanguage() !== getStoredLanguage();

export const isRtlLanguage = (code) => RTL_LANGUAGES.has(code);

// Appended to every AI system prompt (see callAI) so replies arrive in the
// player's language natively instead of being machine-translated after.
export const languageDirective = (code = getStoredLanguage(), { force = false } = {}) => {
  if (code === SOURCE_LANGUAGE && !force) {
    return "";
  }

  const name = languageDisplayName(code);
  return (
    `LANGUAGE: The player reads ${name} (${code}). ` +
    `Write ALL natural-language text in ${name} — prose replies, titles, descriptions, summaries, and suggestions. ` +
    `If the response must be JSON, keep the JSON structure, keys, ISO codes, and date formats exactly as specified, ` +
    `but write every human-readable string value in ${name}.`
  );
};

// A chat ALWAYS pins its language — force: true, even for English. English is
// unstated elsewhere (it is the authored default), but a chat is different: the
// player is conversing with a specific counterpart, and when that counterpart is
// e.g. China — or the scenario is thick with non-English context — the model
// drifts into that language with nothing to pull it back, so an English player
// gets Chinese replies. Forcing the directive (plus the "regardless of earlier
// messages" clause, which also stops a conversation drifting once one reply
// slips) makes the chat-language setting actually hold, English included.
export const chatLanguageDirective = () => {
  const code = resolveChatLanguage();
  const directive = languageDirective(code, { force: true });
  if (!directive) {
    return "";
  }

  return `${directive} Reply in ${languageDisplayName(code)} regardless of the language of earlier messages.`;
};
