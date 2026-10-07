## License & Copyright

Copyright (C) 2026 Open Historia

This project is licensed under the terms of the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See the [LICENSE](LICENSE) file for details.

## About this fork

**Historia Nova** is a modified fork of **[Open Historia](https://github.com/Open-Historia/open-historia)**, distributed under the same license, **AGPL-3.0-or-later**. The upstream copyright, attribution and license notices are kept unchanged throughout the source tree. This fork's complete source is at **[AbdallahEssam23/open-historia](https://github.com/AbdallahEssam23/open-historia)**, which is the source link offered to every network user under AGPL section 13. Upstream's contributor agreement applies to contributions made to the upstream project, not here.

<!-- Open Historia — portions (install, Android app, hub & preset docs) © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). -->
<h1 align="center">Historia Nova</h1>

<div align="center">
  <strong>An open-source, AI-driven alternate-history strategy game — a fork of <a href="https://github.com/Open-Historia/open-historia">Open Historia</a>, an alternative to <a href="https://www.paxhistoria.co/games">Pax Historia</a>.</strong>
</div>

<br />

<div align="center">
  <!-- Source -->
  <a href="https://github.com/AbdallahEssam23/open-historia">
    <img src="https://img.shields.io/badge/source-GitHub-181717.svg?style=flat-square&logo=github&logoColor=white"
      alt="Source code" />
  </a>
  <!-- License -->
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg?style=flat-square"
      alt="License: AGPL-3.0" />
  </a>
  <!-- Status -->
  <a href="#">
    <img src="https://img.shields.io/badge/status-early%20development-orange.svg?style=flat-square"
      alt="Early Development" />
  </a>
</div>

<div align="center">
  <sub>Built on <a href="https://github.com/Open-Historia/open-historia">Open Historia</a> by <a href="https://github.com/Open-Historia/open-historia/graphs/contributors">its contributors</a>; rebranded as Historia Nova.
</div>

<br />
<br />

![](https://github.com/AbdallahEssam23/open-historia/blob/main/public/screenshots/screenshot.webp?raw=true)
---

## ✨ Features

- __interactive world map:__ watch territory, borders, and nations shift as history unfolds
- __ai-generated events:__ dynamic events shaped by your decisions and the state of the world
- __diplomacy:__ negotiate with AI-controlled nations through natural language chat — click any country to talk to it or get an AI intelligence briefing
- __ai advisor:__ consult your advisor for strategic guidance, economic analysis, and situation summaries
- __map editor:__ a full vector map editor (draw, split, merge, paint owners, cities) built into the scenario editor — build a world and hit *Apply & Play*
- __troops:__ deploy, move and battle armies; deployments stay pending until the AI resolves them; scenarios control which troop types exist in their era
- __scenario hub:__ browse, vote on and import community scenarios from the in-game **Community** tab, and publish your own
- __self-hostable:__ run your own instance with your own AI backend completely offline

---

## 🚀 Play

### In your browser

Host the web build yourself — nothing to install for the player. Games are saved in the
browser, and each player brings their own AI key (it goes straight to the provider, never to
the host).

Local AI (Ollama, LM Studio) needs one extra step in the browser: the server has to allow
the site's origin, e.g. start Ollama with `OLLAMA_ORIGINS=https://your-host`. The desktop
app below needs no such setup.

### Desktop (offline, single-player)

Download the latest desktop build from the
[**releases page**](https://github.com/AbdallahEssam23/open-historia/releases)
(~186 MB — code *and* all map data), unzip it anywhere, then:

- **Windows:** run the setup `.exe`, then open **Historia Nova** from the Start Menu
- **macOS:** unzip and drag **Historia Nova** to Applications (first run: right-click -> *Open*)
- **Linux:** `chmod +x Open-Historia-x86_64.AppImage` and run it

The launcher checks Node.js, downloads the map data, installs dependencies, builds,
and opens the game. To update an existing install later, run the matching
newest installer from the downloads page and run it over the top - your saves
while preserving your saves, scenarios, and map data.

> [!TIP]
> Run the launcher **normally** — it does not need (and works better without)
> administrator rights: an elevated window gets the admin account's environment,
> which can hide a Node.js that was installed for your own account.


#### Android app

Build the APK from this source (see below); the release asset name is still
`open-historia.apk` for now, a deliberately frozen download contract.
Everything is on the phone: your saves and scenarios, the scenario workshop and
the world map — it plays in airplane mode from the first launch. The community
hub and your own AI provider are the only things that use the network. A model
running on your own network (Ollama, LM Studio) works too, with no CORS setup.

<details>
<summary>Build the APK yourself (needs the Android SDK)</summary>

```bash
npm run build:android          # the app's bundle → dist-android/
cd mobile
npm install
npm run map                    # fetches + verifies the map data into map-cache/
npm run www                    # stages the bundle and the map into www/
npx cap sync android
cd android && ./gradlew assembleDebug   # gradlew.bat on Windows
```

The APK lands in `mobile/android/app/build/outputs/apk/debug/`. (Or open
`mobile/android` in Android Studio and press Run.) Maintainers: the
**Build Android APK** action in the Actions tab builds and republishes the
release APK — run it after changing `mobile/` or the client. See
[docs/mobile.md](docs/mobile.md).

</details>

### Manual

Prerequisites: [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/en) 22 LTS or newer (minimum 20.19 / 22.12 — the client build runs on Vite 7, which requires it). Building the **desktop app** needs 22.12+, which is what Electron 44 requires; the server and the web client still run on 20.19.

```bash
git clone https://github.com/AbdallahEssam23/open-historia.git
cd open-historia
node scripts/fetch-map-assets.mjs  # Download the world map data (see note below)
npm install                        # Install dependencies (includes OpenLayers etc. for the editor)
npm run build                      # Build the client
node server/server.js              # Start the server
```

Then open **http://localhost:3000** in your browser.

### Reaching the server from another device

Out of the box the server answers **only the machine it runs on** — which covers
the desktop app, Termux on the same phone, and a browser on the same computer.

To play from your phone or another computer, turn on
**Settings → Network → "Let other devices connect"**. It takes effect
immediately (no restart), it is remembered for next time, and it shows you the
exact address to type into the Android app, so you never have to go and find
your own IP:

> Type this into the Android app:
> `http://192.168.1.20:3000`

Worth knowing before you do: **the game's API has no password.** While sharing is
on, anyone who can reach that address can read, change and delete your games and
scenarios — the server can't tell them apart from you. That's fine on a home
network you control and a bad idea on café, hotel, dorm or office Wi-Fi. The
switch is off by default for that reason, not because sharing is discouraged.

Running headless — Termux, a NAS, a box with no screen to click a toggle on? Set
`OH_HOST`. It overrides the setting and makes the in-game switch read-only, so a
script and a player can't disagree about who can reach the server:

```bash
OH_HOST=0.0.0.0 node server/server.js      # every interface
OH_HOST=192.168.1.20 node server/server.js # one interface only
```

| Variable | Default | What it does |
| --- | --- | --- |
| `OH_HOST` | unset | Which interface to listen on. Overrides the Settings toggle and locks it. Anything but loopback puts the API on your network. |
| `OH_ALLOW_REMOTE_RELAY` | off | Lets other devices use this server's AI relay. Off means the relay only answers this machine, so it can't be used as a proxy by anyone else on the network. |
| `OH_RATE_LIMIT` | `1200` | Requests per minute per network client (loopback is exempt). |

> [!TIP]
> **Running the server only — Termux/Android, a headless box, a NAS?** Skip the
> desktop-app tooling:
>
> ```bash
> npm install --omit=dev --omit=optional
> ```
>
> That drops Electron and its build chain (783 packages → 286) while keeping
> everything the client build and the server actually need. On Android it is the
> difference between working and not: Electron publishes no Android build, so its
> install script exits with *"Electron builds are not available on platform:
> android"*. A plain `npm install` still succeeds there — Electron is an
> `optionalDependency`, so npm reports the failure and carries on — but there is no
> reason to download it in the first place.

> **Note:** the large map binaries (`*.pmtiles`, `public/assets/*-seed.*`, and the stock
> world `server/data/stock/regions.geojson`) are **not** in the repo — they are
> hosted as [GitHub Release assets](https://github.com/Open-Historia/open-historia/releases/tag/map-data)
> and downloaded by `scripts/fetch-map-assets.mjs`. The launcher script for your platform
> runs this for you automatically, so a plain ZIP download works too — no Git LFS needed.

---

## 🌍 Scenarios

**Modern Day** is the only built-in scenario. Additional presets — *World War II — 1939*,
*Medieval — 1200 AD*, *Rome — 117 AD*, *Mongol World — 1300 AD*, *New World — 1650*, and
*Bronze Age — 1200 BC* — can be rebuilt from the specs in `scripts/presets/` (see below) or
imported as scenario bundles.

To rebuild an official preset from source (specs live in `scripts/presets/`):

```bash
node scripts/presets/build-preset.mjs scripts/presets/wwii-1939.spec.mjs
```

The built-in Modern Day map is authored in the Scenario Workshop and lives in the repo as
`server/seed/default/regions.geojson` (with its cities, world and colours beside it); the server
copies that seed into its data directory on first run and whenever the seed's `builtInMap` changes.
`node scripts/build-default-map.mjs` regenerates the *stock* GADM world instead — the map every
scenario without one of its own (the hub presets) renders on.

## 🗺️ Map editor

Open any scenario's editor and click **🗺️ Open Map Editor** (or visit
`http://localhost:3000/?editor=1` for the standalone editor). Draw regions, split and
merge borders freehand, paint owners, import 70k cities, sign your map, then
**Apply & Play**.

## 🖥️ Host a server node

Want to help the network? Run a **content node** on your own device to cache and serve
the game's map data to nearby players so everyone loads faster. It's a one-click install
and deliberately safe — a node only ever serves **read-only, checksum-verified** map
files, and never touches anyone's games, accounts, AI keys, or code.

The content-node network is part of upstream Open Historia; this fork does not run or
operate any node registry. If you want to serve map data to nearby players, build the web
or desktop app and host it yourself.
