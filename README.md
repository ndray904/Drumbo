# Drumbo

Midi drum track previewer

A local browser drum workstation built with TypeScript, Vite, @tonejs/midi and Web Audio. Windows standalone and VST editions are future stages.

## Run

```sh
npm ci
npm run dev
npm test
npm run build
```

Use Node.js 24 or newer. For browser checks, run `npx playwright install --with-deps chromium` once, then `npm run test:browser`. The browser suite covers desktop and mobile touch layouts, playback, channel overrides, embedded sample export/import, IndexedDB persistence, and standalone playback without network requests.

Open `dist/drumbo-preview.html` directly in a modern browser for the self-contained build, or serve `dist/` with a static server. No CDN, uploads, external samples, or runtime network access are required. Click **Activate audio**, Play, or any pad to unlock audio on mobile. Headphones are recommended.

## Use

- Choose or drop a format 0/1 MIDI file. All tracks are combined with velocities and tempo maps preserved. Channel 10 is selected when present; choose another channel or all channels manually. SMPTE division and format 2 are explicitly rejected.
- Play/pause, stop, seek, loop, and adjust tempo. Tempo scales the full imported tempo map relative to its initial BPM; it does not flatten tempo changes. Playback uses an AudioContext-clock lookahead scheduler.
- The MIDI note map keeps all 16 kit sounds visible in equal-height compact lanes, labeled only by sound name. Hit markers and live highlights follow the selected channel (or all channels). Play, pause, stop, seek in the map, or tap a sound to audition it. The lanes stay in kit-pad order and update when notes are reassigned; hover a sound for its pad/sample and mute/solo state.
- Tap the 16 pads, load browser-decodable audio, change their unique GM mappings, set volume, mute or solo. The complete GM percussion range 35–81 is mapped by name. Unassigned notes use generated starter percussion; these are synthetic approximations, not recordings of a GM instrument set. The GM sound check respects kit mute and solo.
- Save named kits to IndexedDB on the current browser origin. Saving the same name replaces that local kit. Export JSON to back up or move kits: custom sample audio is embedded as base64. Import validates and decodes all samples before replacing the active kit. Samples are capped at 30 MB each and imported JSON at 100 MB.
- Browser audio format support varies. WAV is a portable choice. Browser storage can be cleared or evicted; export important kits. File-URL IndexedDB support varies by browser, so use a local server if saving is unavailable.

## Verification

`npm test` covers real format 0/1 binary MIDI fixtures, tempo changes, velocity, channel selection, canonical GM mappings, kit validation and mute/solo. The production build type-checks all source and generates an inline-JS/CSS preview. Generated `dist/` files are committed for recovery and direct preview.
