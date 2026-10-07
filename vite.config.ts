/*! Open Historia — portions (dev API proxy + vendor chunks) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// The big map binaries live in public/ so the dev server and the Express server can
// serve them off disk, but NEITHER build serves them from the bundle: the desktop
// streams them via /api/runtime/pmtiles/:assetKey, and the website fetches them from
// the content nodes, hash-verified against the signed manifest.
//
// Vite copies publicDir wholesale and offers no partial exclude, so it duplicated
// ~160MB into dist/ and — worse — made `npm run build:site` emit a site Cloudflare
// Pages REJECTS outright: its limit is 25 MiB per file and regions.pmtiles is ~101.
//
// The trap is that it only fires on a machine that has actually played. The files
// are gitignored and arrive from the map-data Release at first launch, so CI and a
// fresh clone build fine and the deploy failure looks random. Dropping them after
// the copy is the fix; "remember to delete them before deploying" is not.
// Never wanted in EITHER build: nothing loads a pmtiles archive from the bundle.
// The desktop streams them off disk via /api/runtime/pmtiles/:assetKey and the
// website fetches them from the content nodes, hash-verified. Copying them in only
// broke the Pages deploy at its 25 MiB-per-file limit.
const PMTILES = [
  'assets/regions.pmtiles',
  'assets/countries.pmtiles',
  'assets/cities.pmtiles',
]

// Wanted by the DESKTOP, fatal to the WEBSITE. The map editor loads these, and the
// desktop server serves exactly one directory (`app.use(express.static(distDir))`)
// — so dropping them there makes /assets/regions-seed.geojson fall through to the
// SPA fallback, answer with index.html, and the editor open with zero regions.
//
// The web build resolves them from VITE_OH_PMTILES_URL instead (see
// regionImport.js), so it never reads them from the bundle — and it must not carry
// them: regions-seed.geojson is 52.8MB at z8 and Pages rejects any file over 25MiB.
const EDITOR_SEEDS = [
  'assets/regions-seed.geojson',
  'assets/cities-seed.json',
]

// The Android bundle drops both sets as well: mobile/scripts/stage-www.mjs lays
// the trimmed archives and the web-sized seeds under www/assets itself, from the
// pinned map-data release, never from whatever a developer's public/ holds.
const dropMapBinaries = (isWeb) => {
  // Take outDir from the resolved config rather than assuming: --outDir varies
  // (dist for the desktop, dist-web for build:web/build:site).
  let outDir = 'dist'
  return {
    name: 'oh-drop-map-binaries',
    apply: 'build' as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir
    },
    closeBundle() {
      for (const rel of isWeb ? [...PMTILES, ...EDITOR_SEEDS] : PMTILES) {
        const target = path.resolve(outDir, rel)
        if (fs.existsSync(target)) fs.rmSync(target)
      }
    },
  }
}

// Identifies THIS web build. It is baked into the bundle (VITE_WEB_BUILD) and written
// to version.json beside it, so a running page can tell whether the copy of the site
// it booted from is still the one being served. Computed once per build so both halves
// always agree. A plain timestamp is enough — it only ever has to differ from the last
// deploy and compare as "newer".
const WEB_BUILD_ID = String(Date.now())

// Emits version.json into the web build output. Deployed as /play/version.json (the
// assemble step copies dist-web wholesale), which is what the update banner polls.
const emitWebVersion = (isWeb: boolean) => {
  let outDir = 'dist'
  return {
    name: 'oh-web-version',
    apply: 'build' as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir
    },
    closeBundle() {
      if (!isWeb) return
      fs.writeFileSync(
        path.resolve(outDir, 'version.json'),
        JSON.stringify({ build: WEB_BUILD_ID }),
      )
    },
  }
}

// The Android app does not report to the website's Google Analytics: its
// players never saw the site that set it up, a store listing would have to
// declare it, and on a device with no network it was one more failed request
// per start. index.html keeps the tag for the website (and the desktop, as
// before); the android build drops it, and fails if any of it survives — a
// reworded snippet must not ship silently.
const GOOGLE_TAG = /[ \t]*<!-- Google tag \(gtag\.js\) -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>\r?\n?/
const dropWebAnalytics = (isAndroid: boolean) => ({
  name: 'oh-drop-web-analytics',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    if (!isAndroid) return html
    const stripped = html.replace(GOOGLE_TAG, '')
    if (/googletagmanager|gtag\(/.test(stripped)) {
      throw new Error('oh-drop-web-analytics: the Google tag is still in the Android index.html')
    }
    return stripped
  },
})

// Android-first chunking. A handful of named vendor groups, and nothing more:
// under Capacitor every chunk is a file read off the APK, so a dozen micro-chunks
// costs more in local I/O than it saves in parse time. What the split buys is the
// shape of the BOOT: the shell (entry) and React, then the map, then the HUD, and
// the heavy simulation/editor stacks never at all unless asked for.
//
//   vendor-core         React itself. Needed for the first render, nothing else.
//   vendor-map          MapLibre GL and its React bindings, reached only through
//                       the lazily-imported Game/Map/World.jsx. Its stylesheet is
//                       imported from Game/Map/mapLibreSetup.js, not main.jsx:
//                       Rollup attaches a package's CSS to the chunk that holds
//                       its code, so a CSS import in main.jsx gave the entry a
//                       static edge to this ~1 MB chunk just to paint a startup
//                       screen that has no map on it.
//   vendor-chartjs      chart.js, the advisor panel's.
//   vendor-geo          The geometry helpers the map and the editor BOTH need.
//   engine-ai-lazy      The simulation stack (Game/AI), reached only through
//                       gameplayLazy.js; prefetched after the first world idle.
//                       Named in chunkFileNames below, not here — see the note
//                       there on why source modules are never pinned.
//
// OpenLayers is deliberately NOT pinned. A predicate that claimed the whole `ol`
// package also claimed the shared Vite preload helper, so the entry ended up with
// a static import of the entire editor chunk. Left to Rollup, OpenLayers lands in
// the editor's own lazily-imported chunk, which is where it belongs.
//
// Nothing under src/ is pinned in manualChunks, and that is not laziness. Pinning
// a single module (gameplay.js) made Rollup place gameplay.js's SHARED
// dependencies — debugLog.js, which the boot path (src/main.jsx) imports, and
// gameState.js, which the HUD imports — into the pinned chunk, which turned into
// a static entry -> engine-ai-lazy edge and put the whole simulation stack on the
// boot path (graph of the regression: a module a second importer needs gets
// hoisted into whatever chunk already owns its dependencies). Pinning the whole
// Game/AI directory fails the other way: the HUD statically imports
// gameplaySchemas, chatActions, interactiveRewind, historyConsolidation and
// nativeUnitDirector, so that would drag ~650 KB of the simulation into the HUD
// and make prefetchGameplay meaningless. A module shared between an eager and a
// lazy path has to stay Rollup's decision; manualChunks gets the packages,
// chunkFileNames gets the names.
// Suffixes, not absolute paths: this file is ESM, so there is no __dirname, and
// the build may run from any working directory.
const AI_ENTRY = '/src/Game/AI/gameplay.js'

// The package a module id belongs to, e.g. "react-dom" or "@vis.gl/react-maplibre".
// Matching the whole directory, rather than the bare specifier, is load-bearing
// for React: Vite's CJS interop splits "react-dom" into a `?commonjs-entry` stub
// and the real `react-dom/cjs/react-dom*.js` modules, so naming the specifier (as
// the previous object form did) claimed only the empty stub and left the ~240 KB
// renderer to be swept into whichever chunk happened to own it.
const packageOf = (id: string): string => {
  const marker = id.lastIndexOf('node_modules/')
  if (marker === -1) return ''
  const parts = id.slice(marker + 'node_modules/'.length).split('/')
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

// Shared by the map (Game/Map/vnext builds display meshes with it) and the
// editor (topology sweeps). Pinning it to the editor group would download the
// editor on every game start, so it stays its own small chunk.
const VENDOR_GEO = new Set([
  '@turf/area',
  '@turf/boolean-point-in-polygon',
  '@turf/centroid',
  '@turf/helpers',
  '@turf/line-intersect',
  '@turf/line-split',
  '@turf/polygon-to-line',
  '@turf/simplify',
  'd3-geo',
  'polygon-clipping',
])

const manualChunks = (id: string): string | undefined => {
  if (!id.includes('node_modules')) return undefined
  const pkg = packageOf(id)
  if (pkg === 'react' || pkg === 'react-dom' || pkg === 'scheduler') return 'vendor-core'
  if (pkg === 'maplibre-gl') return 'vendor-map'
  if (VENDOR_GEO.has(pkg)) return 'vendor-geo'
  if (pkg === 'chart.js') return 'vendor-chartjs'
  return undefined
}

// Named by role after Rollup has decided the split. chunkFileNames only chooses
// the file name, so it labels the simulation stack without touching placement.
const chunkFileNames = (chunk: { isDynamicEntry: boolean; moduleIds: string[] }) => {
  const has = (suffix: string) => chunk.moduleIds.some((id) => id.endsWith(suffix))
  if (chunk.isDynamicEntry && has(AI_ENTRY)) return 'assets/engine-ai-lazy-[hash].js'
  return 'assets/[name]-[hash].js'
}

// https://vite.dev/config/
// `--mode web` (npm run build:web / build:site / dev:web) builds the website,
// `--mode android` (npm run build:android) the Android app's bundle — the web
// build with the world map inside the APK; any other mode builds the
// local/desktop app that ships in "Download for Windows".
export default defineConfig(({ mode }) => ({
  define: {
    // Empty off the web, which is what keeps the banner inert on desktop/dev.
    'import.meta.env.VITE_WEB_BUILD': JSON.stringify(mode === 'web' ? WEB_BUILD_ID : ''),
    // Make the web flag a COMPILE-TIME literal so Rollup dead-code-eliminates
    // every `if (import.meta.env.VITE_OH_WEB)` branch — and the web backend they
    // dynamically import (src/runtime/web/*) — from the desktop build. Without
    // this the flag is only a runtime value, so `npm run build` still pulls the
    // web runtime into the graph and fails to resolve its web-only, git-ignored
    // generated seed files on any machine that hasn't run a web build first (e.g.
    // a fresh "Download for Windows" extract). Boolean is safe: every use site is
    // a plain truthiness check.
    'import.meta.env.VITE_OH_WEB': JSON.stringify(mode === 'web' || mode === 'android'),
    // The Android app is the web build with everything on the device: the map
    // under /assets instead of a content node, native file saving, native HTTP
    // for a model on the LAN. A second compile-time literal, so those branches
    // are stripped from the website exactly as the web ones are from desktop.
    'import.meta.env.VITE_OH_NATIVE': JSON.stringify(mode === 'android'),
  },
  // PTR placement runs in a module worker whose dependency graph can be
  // split into multiple chunks. Vite's default worker output is IIFE, which
  // Rollup cannot use for code-splitting builds; emit workers as native ES
  // modules so production builds match the module-worker runtime contract.
  worker: {
    format: 'es',
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    dropMapBinaries(mode === 'web' || mode === 'android'),
    emitWebVersion(mode === 'web'),
    dropWebAnalytics(mode === 'android'),
  ],
  // Proxy API calls to the Express server during `npm run dev` so the map editor's
  // save/load (and the game's runtime endpoints) work with hot-reload too.
  server: {
    // The online preview is reached through a proxy host; allow the platform's
    // wildcard so a dev server started here answers for it.
    allowedHosts: ['.monkeycode-ai.live'],
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    rollupOptions: {
      output: {
        // See manualChunks above: a few named vendor groups, and the rest of the
        // split left to Rollup so a module shared by the map and the editor does
        // not drag the editor into every game start.
        manualChunks,
        chunkFileNames,
      },
    },
  },
}))
