/*! Open Historia - Gemini endpoint and request headers (c) 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Import-free on purpose: runs under node --test without a build.
//
// The Gemini key used to ride in the query string
// (`...:generateContent?key=...`), which every proxy, CDN and access log
// records. Google's documented header for the same key is x-goog-api-key, which
// intermediaries do not log. This module is the single owner of the endpoint
// string and the header shape, so the key cannot drift back into a URL through
// a second copy.
//
// The request BODY is deliberately not built here: keeping it in callGemini is
// what keeps Gemini's implicit prefix cache intact, because the stable system
// instruction stays the leading content exactly as promptLayout.js arranged it.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const getGeminiUrl = (model) =>
  `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

export const getGeminiStreamUrl = (model) =>
  `${GEMINI_API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;

export const geminiHeaders = (apiKey) => ({
  "Content-Type": "application/json",
  "x-goog-api-key": String(apiKey ?? "").trim(),
});
