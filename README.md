# openSpeek

An open-source read-aloud web app: add a document, press play, follow the highlighted words.
Works on desktop and mobile browsers and can be installed as an app.

## Speech engines

| Engine | Where it runs | Notes |
|---|---|---|
| **Phonon · on this device** (default) | In the browser (WebAssembly) | [Phonon](https://github.com/gradium-ai/xn-ptts) 31m by Gradium. One-time ~65 MB download, then works offline. Text never leaves the device. English. |
| **Phonon · on server** | openSpeek server | Same voices, generated server-side for slower devices. |
| **Edge · online voices** | Microsoft, via the openSpeek server | Hundreds of voices in many languages, exact word timings. Text is sent to Microsoft; this is an unofficial use of that service and may stop working. |

The server is optional. Without it the app is a static site using in-browser Phonon.

## Features

- Paste text, rich text or a link to a web page (Ctrl/⌘ V anywhere on the library, or the Paste button), or import PDF, EPUB, DOCX, Markdown and HTML files.
- Sentence and word highlighting, tap or click any word to start listening from there, auto-scroll.
- Contents: chapters and sections with listening times and progress (a bottom sheet on phones, a panel beside the text on wide screens), the current section always shown, previous/next section (⇧← / ⇧→), section ticks on the seek bar. EPUB tables of contents and PDF bookmarks supply headings where the text lacks them.
- Speed 0.5×–3× with pitch preserved, voice picker, keyboard shortcuts, lock-screen controls.
- Library stored in the browser (IndexedDB) with resume position.
- Export a document as a WAV file.
- Light and dark themes.

## Run

```sh
npm install
npm run dev                 # client only, http://localhost:5173

# with the server (Edge TTS, server-side Phonon, fetching pages for pasted links)
(cd server && npm install)
npm run server              # API on http://localhost:8787 (the dev client proxies /api to it)

# production: one process serves the built app and the API
npm start                   # http://localhost:8787

# or with Docker, including a Phonon backend
docker compose up --build
```

Server-side Phonon needs a backend: either `PHONON_URL` pointing at Gradium's
`ptts-openai-server` (the compose file sets this up) or the `ptts` command on the PATH.
See [server/README.md](server/README.md) for configuration and [docs/server-api.md](docs/server-api.md)
for the API.

Hosting the client as static files works too (`npm run build`, serve `dist/`). Serve it with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`
to let Phonon use several threads; without them it runs on one. To use a server on another
origin, set its URL in Settings.

## Test

```sh
npm run test:all            # client (vitest) and server (node --test)
npm run typecheck
```

## Layout

- `src/tts` – speech engines · `src/player` – playback, prefetch, word tracking
- `src/ingest` – importers and sentence segmentation · `src/library` – IndexedDB storage
- `src/ui` – React interface · `server/` – optional Node server

## Licences

Phonon 31m weights are Apache-2.0; the `phonon-tts` runtime is MIT OR Apache-2.0.
